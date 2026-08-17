mod audio;
mod commands;
mod db;
mod event_logger;
mod secrets;
mod scraper;
mod stealth;
mod vision;

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// Windows-only: low-level keyboard hook so Right Ctrl registers as the "suggest"
/// trigger without relying on RegisterHotKey, which does not accept bare modifier VKs.
#[cfg(target_os = "windows")]
mod rctrl_hook {
    use std::sync::OnceLock;
    use std::sync::atomic::Ordering;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_RCONTROL;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW,
        HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    static HANDLE: OnceLock<AppHandle> = OnceLock::new();

    unsafe extern "system" fn proc(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if ncode >= 0 {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let msg = wparam.0 as u32;
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                && info.vkCode == u32::from(VK_RCONTROL.0)
            {
                if let Some(app) = HANDLE.get() {
                    let state = app.state::<crate::AppState>();
                    if state.shortcuts_enabled.load(Ordering::SeqCst) {
                        if let Some(ov) = app.get_webview_window("overlay") {
                            let _ = ov.show();
                        }
                        let _ = app.emit("nexus://hotkey", "suggest");
                    }
                }
            }
        }
        CallNextHookEx(HHOOK(std::ptr::null_mut()), ncode, wparam, lparam)
    }

    pub fn install(app: AppHandle) {
        let _ = HANDLE.set(app);
        std::thread::spawn(|| unsafe {
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc), None, 0) {
                Ok(_hook) => {
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
                }
                Err(e) => tracing::warn!("Right Ctrl hook could not be installed: {e}"),
            }
        });
    }
}

pub struct AppState {
    pub db: db::Db,
    pub db_path: Mutex<String>,
    pub stealth: Mutex<stealth::StealthConfig>,
    pub capture: Mutex<Option<audio::CaptureSession>>,
    pub active_meeting: Mutex<Option<String>>,
    pub shortcuts_enabled: AtomicBool,
    pub overlay_interactive: AtomicBool,
}

#[cfg(target_os = "macos")]
const PRIMARY_MOD: Modifiers = Modifiers::SUPER;
#[cfg(not(target_os = "macos"))]
const PRIMARY_MOD: Modifiers = Modifiers::CONTROL;

const HOTKEYS: &[(&str, Modifiers, Code)] = &[
    ("toggle-overlay", PRIMARY_MOD.union(Modifiers::SHIFT), Code::Space),
    ("ask", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyA),
    ("listen", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyL),
    ("capture", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyS),
    ("region", PRIMARY_MOD.union(Modifiers::SHIFT).union(Modifiers::ALT), Code::KeyS),
    ("suggest", Modifiers::empty(), Code::ControlRight),
    ("panic", PRIMARY_MOD.union(Modifiers::SHIFT), Code::Backslash),
    ("move_up", PRIMARY_MOD, Code::ArrowUp),
    ("move_down", PRIMARY_MOD, Code::ArrowDown),
    ("move_left", PRIMARY_MOD, Code::ArrowLeft),
    ("move_right", PRIMARY_MOD, Code::ArrowRight),
    ("quit_app", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyQ),
    ("toggle_dashboard", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyD),
    ("resize_mode", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyR),
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nexus_echo_lib=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("nexus-echo.db");
            let database = db::Db::open(db_path.clone())?;

            app.manage(AppState {
                db: database,
                db_path: Mutex::new(db_path.to_string_lossy().to_string()),
                stealth: Mutex::new(stealth::StealthConfig::default()),
                capture: Mutex::new(None),
                active_meeting: Mutex::new(None),
                shortcuts_enabled: AtomicBool::new(true),
                overlay_interactive: AtomicBool::new(true),
            });

            let cfg = stealth::StealthConfig::default();
            if let Some(overlay) = app.get_webview_window("overlay") {
                if let Err(e) = stealth::apply(&overlay, &cfg) {
                    tracing::error!("failed to apply stealth: {e}");
                }
                let _ = overlay.show();
                let _ = overlay.set_focus();
            }

            register_hotkeys(app.handle())?;
            #[cfg(target_os = "windows")]
            rctrl_hook::install(app.handle().clone());
            build_tray(app.handle(), cfg.hide_from_taskbar)?;
            event_logger::log_event(1001, event_logger::LogLevel::Info, "Nexus Echo application launched successfully.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::apply_stealth,
            commands::toggle_overlay,
            commands::resize_overlay,
            commands::resize_overlay_size,
            commands::move_overlay,
            commands::panic_hide,
            commands::focus_overlay,
            commands::set_click_through,
            commands::toggle_resize_mode,
            commands::open_dashboard,
            commands::list_audio_devices,
            commands::start_listening,
            commands::stop_listening,
            commands::capture_screen,
            commands::set_provider_key,
            commands::get_provider_key_hint,
            commands::resolve_provider_key,
            commands::delete_provider_key,
            commands::save_settings,
            commands::load_settings,
            commands::save_message,
            commands::load_messages,
            commands::save_segment,
            commands::finalize_meeting,
            commands::search_everything,
            commands::save_chunks,
            commands::load_chunks,
            commands::delete_document,
            commands::wipe_all_data,
            commands::diagnostics,
            commands::set_shortcuts_enabled,
            commands::scrape_company,
            commands::export_bundle,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "dashboard" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start Nexus Echo");
}

fn register_hotkeys(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    let base_handle = app.clone();
    for (action, modifiers, code) in HOTKEYS {
        let shortcut = Shortcut::new(Some(*modifiers), *code);
        let _ = app.global_shortcut().unregister(shortcut);
        let action_str = action.to_string();
        let handle_primary = base_handle.clone();
        let handle_err = base_handle.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_, _, event| {
            if event.state() != ShortcutState::Pressed { return; }
            let state = handle_primary.state::<AppState>();
            if !state.shortcuts_enabled.load(Ordering::SeqCst) { return; }
            match action_str.as_str() {
                "panic" => stealth::panic_hide(&handle_primary),
                "move_up" => start_continuous_move(handle_primary.clone(), 0, -20, 0x26),    // VK_UP
                "move_down" => start_continuous_move(handle_primary.clone(), 0, 20, 0x28),  // VK_DOWN
                "move_left" => start_continuous_move(handle_primary.clone(), -20, 0, 0x25), // VK_LEFT
                "move_right" => start_continuous_move(handle_primary.clone(), 20, 0, 0x27), // VK_RIGHT
                "toggle-overlay" => {
                    if let Some(overlay) = handle_primary.get_webview_window("overlay") {
                        let visible = overlay.is_visible().unwrap_or(false);
                        let _ = if visible { overlay.hide() } else { overlay.show() };
                    }
                }
                "toggle_dashboard" => {
                    if let Some(dash) = handle_primary.get_webview_window("dashboard") {
                        let visible = dash.is_visible().unwrap_or(false);
                        if visible {
                            let _ = dash.hide();
                        } else {
                            let _ = dash.show();
                            let _ = dash.set_focus();
                        }
                    }
                }
                "resize_mode" => {
                    if let Ok(interactive) = crate::commands::toggle_resize_mode_inner(&handle_primary, &state) {
                        let _ = handle_primary.emit("nexus://resize-mode", interactive);
                    }
                }
                "quit_app" => {
                    std::process::exit(0);
                }
                _ => {
                    if let Some(overlay) = handle_primary.get_webview_window("overlay") {
                        let _ = overlay.show();
                    }
                }
            }
            let _ = handle_primary.emit("nexus://hotkey", action_str.clone());
        }) {
            tracing::info!("Primary shortcut reserved for {action}: {e}. Trying Alt+Shift fallback...");
            let fallback_shortcut = Shortcut::new(Some(Modifiers::ALT.union(Modifiers::SHIFT)), *code);
            let _ = app.global_shortcut().unregister(fallback_shortcut);
            let action_str_fallback = action.to_string();
            let handle_fallback = handle_err;
            let _ = app.global_shortcut().on_shortcut(fallback_shortcut, move |_, _, event| {
                if event.state() != ShortcutState::Pressed { return; }
                let state = handle_fallback.state::<AppState>();
                if !state.shortcuts_enabled.load(Ordering::SeqCst) { return; }
                let _ = handle_fallback.emit("nexus://hotkey", action_str_fallback.clone());
            });
        }
    }
    Ok(())
}

fn start_continuous_move(app: tauri::AppHandle, dx: i32, dy: i32, vkey: u16) {
    // Move immediately for single tap
    let _ = crate::commands::move_overlay(app.clone(), dx, dy);
    
    tauri::async_runtime::spawn(async move {
        // Wait for potential auto-repeat threshold (like OS keyboard settings)
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        
        loop {
            #[cfg(target_os = "windows")]
            let is_down = unsafe {
                windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(vkey.into()) & (0x8000_u16 as i16) != 0
            };
            #[cfg(not(target_os = "windows"))]
            let is_down = false; // Smooth move fallback for mac/linux

            if !is_down {
                break;
            }

            let _ = crate::commands::move_overlay(app.clone(), dx, dy);
            tokio::time::sleep(std::time::Duration::from_millis(16)).await; // ~60fps smooth movement
        }
    });
}

fn build_tray(app: &tauri::AppHandle, hidden: bool) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide overlay", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Open dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Nexus-Echo-V2", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &dashboard, &quit])?;

    let tray = TrayIconBuilder::with_id("nexus-tray")
        .icon(tauri::include_image!("icons/tray.png"))
        .tooltip("Nexus-Echo-V2")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(overlay) = app.get_webview_window("overlay") {
                    let visible = overlay.is_visible().unwrap_or(false);
                    let _ = if visible { overlay.hide() } else { overlay.show() };
                }
            }
            "dashboard" => {
                if let Some(dash) = app.get_webview_window("dashboard") {
                    let _ = dash.show();
                    let _ = dash.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    // Hide tray icon completely when stealth/hide_from_taskbar is enabled
    if hidden {
        let _ = tray.set_visible(false);
    }

    Ok(())
}
