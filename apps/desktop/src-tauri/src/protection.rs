//! Whether the OS can keep our windows out of screen sharing and screenshots (spec E4).
//!
//! Tauri's `content_protected` uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows
//! and `NSWindow.sharingType = .none` on macOS; Linux has no equivalent, so it does nothing there.
//! The overlay shows this status so nobody is surprised in the middle of a call.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Protection {
    /// "hidden": excluded from capture · "not_guaranteed": may show up · "visible": will show up.
    pub level: &'static str,
    pub detail: String,
}

pub fn status() -> Protection {
    let info = os_info::get();
    let (major, minor, patch) = match info.version() {
        os_info::Version::Semantic(a, b, c) => (*a, *b, *c),
        _ => (0, 0, 0),
    };
    if cfg!(target_os = "windows") {
        // WDA_EXCLUDEFROMCAPTURE needs Windows 10 version 2004 (build 19041) or later.
        if major > 10 || (major == 10 && patch >= 19041) {
            Protection { level: "hidden", detail: "Hidden from screen sharing and screenshots.".into() }
        } else {
            Protection {
                level: "visible",
                detail: "This Windows version can't hide windows from screen sharing. Update to Windows 10 2004 or later.".into(),
            }
        }
    } else if cfg!(target_os = "macos") {
        if major != 0 && major <= 14 {
            Protection { level: "hidden", detail: "Hidden from screen sharing and screenshots.".into() }
        } else {
            Protection {
                level: "not_guaranteed",
                detail: format!(
                    "On macOS {major}.{minor}, apps that capture with ScreenCaptureKit can still show the overlay. \
                     Share a single window or tab instead of the entire screen, or hide the overlay while sharing."
                ),
            }
        }
    } else {
        Protection {
            level: "visible",
            detail: "Linux can't hide windows from screen sharing. Share a single window or tab instead of the \
                     entire screen, or hide the overlay while sharing."
                .into(),
        }
    }
}
