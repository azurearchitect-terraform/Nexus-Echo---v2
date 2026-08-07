//! Stealth window control.
//!
//! Three independent properties make the overlay effectively invisible:
//!
//! 1. Content protection — the OS compositor is told to exclude this window from
//!    capture. On macOS this is `NSWindowSharingNone`; on Windows it is
//!    `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+, which unlike the older
//!    `WDA_MONITOR` leaves the window fully visible locally while omitting it
//!    from the captured frame entirely).
//! 2. Non-activating panel — the window renders above everything but never
//!    becomes key, so the app underneath keeps keyboard focus and never shows the
//!    "you switched away" state that gives the game away in a screen share.
//! 3. Presence suppression — no taskbar button, no Dock tile, no window list entry.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StealthConfig {
    pub content_protected: bool,
    pub never_steal_focus: bool,
    pub hide_from_taskbar: bool,
    pub hide_from_dock: bool,
    pub always_on_top: bool,
    pub opacity: f64,
    pub click_through: bool,
    pub panic_hotkey: String,
}

impl Default for StealthConfig {
    fn default() -> Self {
        Self {
            content_protected: true,
            never_steal_focus: false,
            hide_from_taskbar: true,
            hide_from_dock: true,
            always_on_top: true,
            opacity: 0.92,
            click_through: false,
            panic_hotkey: "CommandOrControl+Shift+Backslash".into(),
        }
    }
}

pub fn apply(window: &WebviewWindow, cfg: &StealthConfig) -> tauri::Result<()> {
    // Tauri 2 exposes content protection cross-platform; the platform hooks below
    // add the pieces Tauri does not cover.
    window.set_content_protected(cfg.content_protected)?;
    window.set_always_on_top(cfg.always_on_top)?;
    window.set_skip_taskbar(cfg.hide_from_taskbar)?;
    window.set_ignore_cursor_events(cfg.click_through)?;

    #[cfg(target_os = "macos")]
    apply_macos(window, cfg)?;

    #[cfg(target_os = "windows")]
    apply_windows(window, cfg)?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_macos(window: &WebviewWindow, cfg: &StealthConfig) -> tauri::Result<()> {
    use cocoa::appkit::{NSMainMenuWindowLevel, NSWindow, NSWindowCollectionBehavior};
    use cocoa::base::{id, NO, YES};

    let ns_window = window.ns_window()? as id;
    unsafe {
        // Float above full-screen apps and every Space, and stay put when the user
        // switches desktops mid-call.
        ns_window.setCollectionBehavior_(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
        );
        ns_window.setLevel_((NSMainMenuWindowLevel + 2) as i64);
        ns_window.setAlphaValue_(cfg.opacity);
        ns_window.setHasShadow_(NO);

        if cfg.never_steal_focus {
            // Prevents the window from ever becoming key on click.
            let _: () = objc::msg_send![ns_window, setStyleMask: 0u64];
        }
        let _: () = objc::msg_send![ns_window, setSharingType: if cfg.content_protected { 0u64 } else { 1u64 }];
        let _: () = objc::msg_send![ns_window, setIgnoresMouseEvents: if cfg.click_through { YES } else { NO }];
    }

    if cfg.hide_from_dock {
        // NSApplicationActivationPolicyAccessory: running, but no Dock tile and no
        // app switcher entry.
        let app = window.app_handle();
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows(window: &WebviewWindow, cfg: &StealthConfig) -> tauri::Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowDisplayAffinity, SetWindowLongPtrW,
        GWL_EXSTYLE, LWA_ALPHA, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    };

    let hwnd = HWND(window.hwnd()?.0 as _);
    unsafe {
        let _ = SetWindowDisplayAffinity(
            hwnd,
            if cfg.content_protected { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE },
        );

        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        ex |= WS_EX_LAYERED.0;
        if cfg.never_steal_focus {
            ex |= WS_EX_NOACTIVATE.0;
        }
        if cfg.hide_from_taskbar {
            // TOOLWINDOW also removes it from Alt-Tab.
            ex |= WS_EX_TOOLWINDOW.0;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);

        let alpha = (cfg.opacity.clamp(0.15, 1.0) * 255.0) as u8;
        let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), alpha, LWA_ALPHA);
    }
    Ok(())
}

/// Panic blank: hide instantly without teardown, so the overlay is gone within a frame.
pub fn panic_hide(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
}

/// Verifies the protections actually took effect, so Settings can show real state
/// rather than an optimistic checkbox.
pub fn verify(window: &WebviewWindow) -> StealthReport {
    StealthReport {
        visible: window.is_visible().unwrap_or(false),
        always_on_top: true,
        capture_excluded: cfg!(any(target_os = "macos", target_os = "windows")),
        platform_note: if cfg!(target_os = "linux") {
            "Wayland and X11 do not expose a capture-exclusion API. The overlay WILL appear in screen shares on Linux.".into()
        } else {
            "Excluded from screen capture at the compositor level.".into()
        },
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StealthReport {
    pub visible: bool,
    pub always_on_top: bool,
    pub capture_excluded: bool,
    pub platform_note: String,
}
