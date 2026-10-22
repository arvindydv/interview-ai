//! Screenshot capture for "Screenshot Solve" (spec D1/D2/D4).
//!
//! Captures the monitor the overlay is on, downscales to the vision model's native resolution and
//! JPEG-encodes it. Full images stay in Rust (keyed by id) until a question is sent; the webview only
//! gets a small thumbnail, so large images never round-trip through IPC.
//!
//! Capture backends: `xcap` (native APIs) on Windows and macOS. On Linux, a frame from the
//! xdg-desktop-portal ScreenCast interface (read with GStreamer at runtime, so no PipeWire/clang at
//! build time), falling back to the Screenshot portal, which flashes the screen and plays a shutter
//! sound on GNOME. The desktop may ask the user to pick a screen the first time.

use std::{
    collections::VecDeque,
    io::Cursor,
    sync::Mutex,
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, RgbaImage};
use serde::Serialize;

/// Long edge after downscaling; must match IMAGE_LIMITS.maxEdgePx in packages/shared.
const MAX_EDGE_PX: u32 = 1568;
const THUMB_HEIGHT_PX: u32 = 144;
/// Pending (not yet sent) screenshots kept in memory; the oldest is dropped beyond this.
const MAX_PENDING: usize = 12;

#[derive(Clone, Serialize)]
pub struct Shot {
    pub id: String,
    pub width: u32,
    pub height: u32,
    /// data:image/jpeg;base64,... thumbnail for the chat bar.
    pub thumb: String,
}

#[derive(Default)]
pub struct Screenshots(Mutex<VecDeque<(String, Vec<u8>)>>);

impl Screenshots {
    fn insert(&self, id: String, jpeg: Vec<u8>) {
        let mut q = self.0.lock().unwrap();
        q.push_back((id, jpeg));
        while q.len() > MAX_PENDING {
            q.pop_front();
        }
    }

    pub fn discard(&self, id: &str) {
        self.0.lock().unwrap().retain(|(i, _)| i != id);
    }

    /// Removes and returns the given screenshots as base64 JPEGs, in the order requested.
    pub fn take(&self, ids: &[String]) -> Result<Vec<String>> {
        let mut q = self.0.lock().unwrap();
        ids.iter()
            .map(|id| {
                let pos = q.iter().position(|(i, _)| i == id).ok_or_else(|| anyhow!("Screenshot expired, capture it again"))?;
                let (_, bytes) = q.remove(pos).expect("position is valid");
                Ok(B64.encode(bytes))
            })
            .collect()
    }

    /// Downscales, encodes and stores a captured screen; returns its id and thumbnail.
    pub fn store(&self, raw: RgbaImage) -> Result<Shot> {
        let full = downscale(raw, MAX_EDGE_PX);
        let (width, height) = full.dimensions();
        let jpeg = encode_jpeg(&full, 85)?;

        let thumb_w = (width as f32 * THUMB_HEIGHT_PX as f32 / height as f32).round().max(1.0) as u32;
        let thumb = image::imageops::resize(&full, thumb_w, THUMB_HEIGHT_PX, FilterType::Triangle);
        let thumb = format!("data:image/jpeg;base64,{}", B64.encode(encode_jpeg(&thumb, 70)?));

        let id = uuid::Uuid::new_v4().to_string();
        self.insert(id.clone(), jpeg);
        Ok(Shot { id, width, height, thumb })
    }
}

/// A monitor rectangle in physical pixels (from Tauri's monitor list).
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A capture that is ready to take. Opening one can be slow (the Linux screencast session, which may
/// ask the user the first time), so the caller opens it first and hides the overlay only for the
/// instant of `capture()`. `all` is every monitor, used to locate `target` in a whole-desktop image.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub struct Source {
    target: Option<Rect>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl Source {
    pub async fn open(target: Option<Rect>, _all: Vec<Rect>, _data_dir: std::path::PathBuf) -> Self {
        Self { target }
    }

    pub async fn capture(self) -> Result<RgbaImage> {
        let target = self.target;
        tauri::async_runtime::spawn_blocking(move || {
            use xcap::Monitor;
            let monitor = target
                .and_then(|r| Monitor::from_point(r.x + r.width as i32 / 2, r.y + r.height as i32 / 2).ok())
                .or_else(|| Monitor::all().ok()?.into_iter().find(|m| m.is_primary().unwrap_or(false)))
                .or_else(|| Monitor::all().ok()?.into_iter().next())
                .ok_or_else(|| anyhow!("No display found to capture"))?;
            monitor.capture_image().map_err(|e| anyhow!(permission_hint(&e.to_string())))
        })
        .await?
    }
}

/// Linux: one frame from a ScreenCast portal session, read with GStreamer's pipewiresrc. Unlike the
/// Screenshot portal, this doesn't flash the screen or play GNOME's shutter sound. The session is
/// persisted with a restore token, so the monitor picker only appears the first time. If the
/// screencast path isn't available (no GStreamer PipeWire plugin, portal refused), falls back to
/// the Screenshot portal.
#[cfg(target_os = "linux")]
pub enum Source {
    Cast(linux_cast::Cast),
    Portal { target: Option<Rect>, all: Vec<Rect> },
}

#[cfg(target_os = "linux")]
impl Source {
    pub async fn open(target: Option<Rect>, all: Vec<Rect>, data_dir: std::path::PathBuf) -> Self {
        match linux_cast::Cast::open(&data_dir).await {
            Ok(cast) => Self::Cast(cast),
            Err(e) => {
                log::warn!("screenshot: screencast unavailable, using the screenshot portal: {e:#}");
                Self::Portal { target, all }
            }
        }
    }

    pub async fn capture(self) -> Result<RgbaImage> {
        match self {
            Self::Cast(cast) => cast.grab().await,
            Self::Portal { target, all } => portal_screenshot(target, all).await,
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_cast {
    use std::{os::fd::{AsRawFd, OwnedFd}, path::{Path, PathBuf}, time::Duration};

    use anyhow::{anyhow, Context, Result};
    use ashpd::desktop::{
        screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType},
        PersistMode, Session,
    };
    use image::RgbaImage;

    /// The frame must arrive quickly; otherwise fall back rather than leave the overlay hidden.
    const GRAB_TIMEOUT: Duration = Duration::from_secs(4);

    pub struct Cast {
        session: Session<Screencast>,
        fd: OwnedFd,
        node: u32,
    }

    fn token_file(data_dir: &Path) -> PathBuf {
        data_dir.join("screencast.token")
    }

    impl Cast {
        pub async fn open(data_dir: &Path) -> Result<Self> {
            // Check for the GStreamer plugin first, so a missing one never opens a portal dialog.
            which_gst().context("GStreamer's pipewiresrc isn't installed")?;
            let token_path = token_file(data_dir);
            let token = std::fs::read_to_string(&token_path).ok();

            let proxy = Screencast::new().await?;
            let session = proxy.create_session(Default::default()).await?;
            proxy
                .select_sources(
                    &session,
                    SelectSourcesOptions::default()
                        .set_cursor_mode(CursorMode::Hidden)
                        .set_sources(Some(SourceType::Monitor.into()))
                        .set_multiple(false)
                        .set_restore_token(token.as_deref().map(str::trim))
                        .set_persist_mode(PersistMode::ExplicitlyRevoked),
                )
                .await?
                .response()?;
            let streams = proxy.start(&session, None, Default::default()).await?.response()?;
            // Restore tokens are single use: keep the new one for the next capture.
            if let Some(t) = streams.restore_token() {
                if let Err(e) = std::fs::write(&token_path, t) {
                    log::warn!("screenshot: couldn't save the screencast token: {e}");
                }
            }
            let node = streams.streams().first().ok_or_else(|| anyhow!("No screen was shared"))?.pipe_wire_node_id();
            let fd = proxy.open_pipe_wire_remote(&session, Default::default()).await?;
            Ok(Self { session, fd, node })
        }

        pub async fn grab(self) -> Result<RgbaImage> {
            let result = self.read_frame().await;
            let _ = self.session.close().await;
            result
        }

        async fn read_frame(&self) -> Result<RgbaImage> {
            // The child inherits the PipeWire fd: clear close-on-exec so it survives exec.
            rustix::io::fcntl_setfd(&self.fd, rustix::io::FdFlags::empty())?;
            let child = tokio::process::Command::new("gst-launch-1.0")
                .args(["-q", "pipewiresrc", &format!("fd={}", self.fd.as_raw_fd()), &format!("path={}", self.node)])
                .args(["num-buffers=1", "always-copy=true", "!", "videoconvert", "!", "pngenc", "compression-level=1"])
                .args(["!", "fdsink", "fd=1"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .context("Couldn't start gst-launch-1.0")?;
            let out = tokio::time::timeout(GRAB_TIMEOUT, child.wait_with_output())
                .await
                .map_err(|_| anyhow!("Timed out waiting for a screen frame"))??;
            if !out.status.success() || out.stdout.is_empty() {
                return Err(anyhow!("GStreamer failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
            }
            Ok(image::load_from_memory(&out.stdout).context("Couldn't decode the screen frame")?.to_rgba8())
        }
    }

    fn which_gst() -> Result<()> {
        let ok = std::process::Command::new("gst-inspect-1.0")
            .args(["--exists", "pipewiresrc"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if ok { Ok(()) } else { Err(anyhow!("gst-inspect-1.0 --exists pipewiresrc failed")) }
    }
}

#[cfg(target_os = "linux")]
async fn portal_screenshot(target: Option<Rect>, all: Vec<Rect>) -> Result<RgbaImage> {
    use ashpd::desktop::screenshot::Screenshot;

    log::info!("screenshot: requesting portal capture");
    let response = Screenshot::request()
        .interactive(false)
        .modal(false)
        .send()
        .await
        .inspect(|_| log::info!("screenshot: portal request sent, waiting for response"))
        .and_then(|r| r.response())
        .map_err(|e| anyhow!("Couldn't capture the screen (the desktop's screenshot service refused or isn't running): {e}"))?;
    let path = url::Url::parse(response.uri().as_str())
        .ok()
        .and_then(|u| u.to_file_path().ok())
        .ok_or_else(|| anyhow!("Screenshot service returned an unexpected location"))?;
    let bytes = std::fs::read(&path).context("Couldn't read the captured screenshot")?;
    // The portal writes a new file for this request (KDE puts it in ~/Pictures, GNOME in a temp dir).
    // It's ours and may show interview content, so remove it once read.
    if let Err(e) = std::fs::remove_file(&path) {
        log::warn!("screenshot: couldn't remove portal file {}: {e}", path.display());
    }
    let desktop = image::load_from_memory(&bytes).context("Couldn't decode the screenshot")?.to_rgba8();
    Ok(crop_to_monitor(desktop, target, &all))
}

/// The portal returns the whole desktop; cut out the overlay's monitor.
#[cfg(target_os = "linux")]
fn crop_to_monitor(desktop: RgbaImage, target: Option<Rect>, all: &[Rect]) -> RgbaImage {
    let (Some(t), false) = (target, all.len() <= 1) else { return desktop };
    let min_x = all.iter().map(|r| r.x).min().unwrap_or(0);
    let min_y = all.iter().map(|r| r.y).min().unwrap_or(0);
    let max_x = all.iter().map(|r| r.x + r.width as i32).max().unwrap_or(1);
    let max_y = all.iter().map(|r| r.y + r.height as i32).max().unwrap_or(1);
    // The image may be in a different pixel scale than Tauri's physical coordinates.
    let sx = desktop.width() as f64 / (max_x - min_x).max(1) as f64;
    let sy = desktop.height() as f64 / (max_y - min_y).max(1) as f64;
    let x = (((t.x - min_x) as f64) * sx).round().max(0.0) as u32;
    let y = (((t.y - min_y) as f64) * sy).round().max(0.0) as u32;
    let w = ((t.width as f64) * sx).round() as u32;
    let h = ((t.height as f64) * sy).round() as u32;
    if x >= desktop.width() || y >= desktop.height() {
        return desktop;
    }
    let w = w.min(desktop.width() - x);
    let h = h.min(desktop.height() - y);
    image::imageops::crop_imm(&desktop, x, y, w, h).to_image()
}

fn downscale(img: RgbaImage, max_edge: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    let edge = w.max(h);
    if edge <= max_edge {
        return img;
    }
    let scale = max_edge as f32 / edge as f32;
    let (nw, nh) = (((w as f32) * scale).round() as u32, ((h as f32) * scale).round() as u32);
    // CatmullRom keeps small code text legible after downscaling.
    image::imageops::resize(&img, nw.max(1), nh.max(1), FilterType::CatmullRom)
}

fn encode_jpeg(img: &RgbaImage, quality: u8) -> Result<Vec<u8>> {
    let rgb = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut out = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut out, quality).encode_image(&rgb).context("JPEG encoding failed")?;
    Ok(out.into_inner())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn permission_hint(err: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("Couldn't capture the screen. Allow Friday AI under System Settings → Privacy & Security → Screen Recording, then restart it. ({err})")
    } else {
        format!("Couldn't capture the screen: {err}")
    }
}
