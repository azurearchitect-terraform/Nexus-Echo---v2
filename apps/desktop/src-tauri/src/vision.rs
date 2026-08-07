//! Screen capture for vision mode.
//!
//! Capture happens in Rust rather than through `getDisplayMedia` for two reasons:
//! the browser API triggers a visible OS recording indicator, and it cannot exclude
//! our own overlay from the frame. Capturing natively avoids both — the screenshot
//! is taken after hiding the overlay for a single frame, so the model never sees
//! the assistant's own answer echoed back at it.

use anyhow::{anyhow, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    /// `data:image/png;base64,...` — passed straight into the vision request.
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub captured_at: i64,
}

pub fn capture(app: &AppHandle, region: Option<CaptureRegion>) -> Result<Screenshot> {
    // Blink the overlay out so it never lands in its own screenshot.
    let overlay = app.get_webview_window("overlay");
    let was_visible = overlay.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if was_visible {
        if let Some(w) = &overlay {
            let _ = w.hide();
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
    }

    let result = capture_inner(region);

    if was_visible {
        if let Some(w) = &overlay {
            let _ = w.show();
        }
    }
    result
}

fn capture_inner(region: Option<CaptureRegion>) -> Result<Screenshot> {
    let monitors = xcap::Monitor::all().map_err(|e| anyhow!("monitor enumeration failed: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| anyhow!("no primary monitor"))?;

    let mut image = monitor.capture_image().map_err(|e| anyhow!("capture failed: {e}"))?;

    if let Some(r) = region {
        let (iw, ih) = (image.width(), image.height());
        let x = r.x.max(0) as u32;
        let y = r.y.max(0) as u32;
        let w = r.width.min(iw.saturating_sub(x));
        let h = r.height.min(ih.saturating_sub(y));
        if w == 0 || h == 0 {
            return Err(anyhow!("selected region is empty"));
        }
        image = image::imageops::crop_imm(&image, x, y, w, h).to_image();
    }

    // Downscale wide screenshots: vision models gain nothing above ~1600px and the
    // upload cost is what dominates time-to-first-token.
    if image.width() > 1600 {
        let ratio = 1600.0 / image.width() as f32;
        let new_h = (image.height() as f32 * ratio) as u32;
        image = image::imageops::resize(&image, 1600, new_h, image::imageops::FilterType::Triangle);
    }

    let (width, height) = (image.width(), image.height());
    let mut png = std::io::Cursor::new(Vec::<u8>::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| anyhow!("png encode failed: {e}"))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    Ok(Screenshot {
        data_url: format!("data:image/png;base64,{encoded}"),
        width,
        height,
        captured_at: chrono::Utc::now().timestamp_millis(),
    })
}
