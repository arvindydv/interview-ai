//! Screenshot capture for "Screenshot Solve" (spec D1/D2/D4).
//!
//! Captures the monitor the overlay is on, downscales to the vision model's native resolution and
//! JPEG-encodes it. Full images stay in Rust (keyed by id) until a question is sent; the webview only
//! gets a small thumbnail, so large images never round-trip through IPC.
//!
//! Capture backends: `xcap` (native APIs) on Windows and macOS; the xdg-desktop-portal Screenshot
//! interface on Linux, which works on GNOME and KDE under Wayland and X11 without PipeWire/clang at
//! build time. The desktop may ask the user to allow screenshots the first time.

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

/// Captures `target` (the overlay's monitor). `all` is every monitor, used on Linux to locate the
/// target inside the portal's whole-desktop image.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub async fn capture_screen(target: Option<Rect>, _all: Vec<Rect>) -> Result<RgbaImage> {
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

#[cfg(target_os = "linux")]
pub async fn capture_screen(target: Option<Rect>, all: Vec<Rect>) -> Result<RgbaImage> {
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
        format!("Couldn't capture the screen. Allow Parakeet under System Settings → Privacy & Security → Screen Recording, then restart it. ({err})")
    } else {
        format!("Couldn't capture the screen: {err}")
    }
}
