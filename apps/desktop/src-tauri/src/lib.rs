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

pub struct AppState {
    pub db: db::Db,
    pub db_path: Mutex<String>,
    pub stealth: Mutex<stealth::StealthConfig>,
    pub capture: Mutex<Option<audio::CaptureSession>>,
    pub active_meeting: Mutex<Option<String>>,
    pub shortcuts_enabled: AtomicBool,
}

#[cfg(target_os = "macos")]
const PRIMARY_MOD: Modifiers = Modifiers::SUPER;
#[cfg(not(target_os = "macos"))]
const PRIMARY_MOD: Modifiers = Modifiers::CONTROL;

/// Global hotkeys. These fire from inside any application, which is the whole
/// point — reaching for the mouse during a live call is what gets people caught.
const HOTKEYS: &[(&str, Modifiers, Code)] = &[
    ("toggle-overlay", PRIMARY_MOD.union(Modifiers::SHIFT), Code::Space),
    ("ask", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyA),
    ("listen", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyL),
    ("capture", PRIMARY_MOD.union(Modifiers::SHIFT), Code::KeyS),
    ("region", PRIMARY_MOD.union(Modifiers::SHIFT).union(Modifiers::ALT), Code::KeyS),
    ("suggest", PRIMARY_MOD.union(Modifiers::SHIFT), Code::Enter),
    ("panic", PRIMARY_MOD.union(Modifiers::SHIFT), Code::Backslash),
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
            });

            // Show and focus the main Overlay window on app launch
            if let Some(overlay) = app.get_webview_window("overlay") {
                let cfg = stealth::StealthConfig::default();
                if let Err(e) = stealth::apply(&overlay, &cfg) {
                    tracing::error!("failed to apply stealth: {e}");
                }
                let _ = overlay.show();
                let _ = overlay.set_focus();
            }

            register_hotkeys(app.handle())?;
            build_tray(app.handle())?;
            event_logger::log_event(1001, event_logger::LogLevel::Info, "Nexus Echo application launched successfully.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::apply_stealth,
            commands::toggle_overlay,
            commands::resize_overlay,
            commands::move_overlay,
            commands::panic_hide,
            commands::focus_overlay,
            commands::set_click_through,
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
        ])
        .on_window_event(|window, event| {
            // Closing the dashboard should leave the assistant running in the tray,
            // not quit it mid-meeting.
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

    // Unregister any existing shortcuts (e.g. from previous dev hot reloads)
    let _ = app.global_shortcut().unregister_all();

    let base_handle = app.clone();
    for (action, modifiers, code) in HOTKEYS {
        let shortcut = Shortcut::new(Some(*modifiers), *code);
        let _ = app.global_shortcut().unregister(shortcut);
        let action_str = action.to_string();
        let handle_primary = base_handle.clone();
        let handle_err = base_handle.clone();

        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let state = handle_primary.state::<AppState>();
            if !state.shortcuts_enabled.load(Ordering::SeqCst) {
                return;
            }

            match action_str.as_str() {
                "panic" => stealth::panic_hide(&handle_primary),
                "toggle-overlay" => {
                    if let Some(overlay) = handle_primary.get_webview_window("overlay") {
                        let visible = overlay.is_visible().unwrap_or(false);
                        let _ = if visible { overlay.hide() } else { overlay.show() };
                    }
                }
                _ => {
                    if let Some(overlay) = handle_primary.get_webview_window("overlay") {
                        let _ = overlay.show();
                    }
                }
            }
            // The UI decides what each action means; Rust only routes the signal.
            let _ = handle_primary.emit("nexus://hotkey", action_str.clone());
        }) {
            // Hotkey reserved by another OS application (e.g. Teams/Bitwarden). Try Alt+Shift fallback
            tracing::info!("Primary shortcut reserved for {action}: {e}. Attempting Alt+Shift fallback...");
            let fallback_shortcut = Shortcut::new(Some(Modifiers::ALT.union(Modifiers::SHIFT)), *code);
            let _ = app.global_shortcut().unregister(fallback_shortcut);
            let action_str_fallback = action.to_string();
            let handle_fallback = handle_err;

            let _ = app.global_shortcut().on_shortcut(fallback_shortcut, move |_, _, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                let state = handle_fallback.state::<AppState>();
                if !state.shortcuts_enabled.load(Ordering::SeqCst) {
                    return;
                }
                let _ = handle_fallback.emit("nexus://hotkey", action_str_fallback.clone());
            });
        }
    }
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide overlay", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Open dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Nexus-Echo-V2", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &dashboard, &quit])?;

    TrayIconBuilder::with_id("nexus-tray")
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
    Ok(())
}
