//! Every command validates its payload before touching state, mirrors the Zod
//! schema on the TypeScript side, and returns a typed error string rather than
//! panicking across the FFI boundary.

use crate::{audio, db, secrets, stealth, vision, AppState};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------- stealth

#[tauri::command]
pub fn apply_stealth(
    app: AppHandle,
    payload: stealth::StealthConfig,
    state: State<'_, AppState>,
) -> CmdResult<stealth::StealthReport> {
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window is not available".to_string())?;
    stealth::apply(&window, &payload).map_err(err)?;
    *state.stealth.lock() = payload;
    Ok(stealth::verify(&window))
}

#[tauri::command]
pub fn toggle_overlay(app: AppHandle) -> CmdResult<bool> {
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window is not available".to_string())?;
    let visible = window.is_visible().map_err(err)?;
    if visible {
        window.hide().map_err(err)?;
    } else {
        window.show().map_err(err)?;
        // Deliberately no `set_focus()` — taking focus is what exposes the overlay
        // in a screen share, because the app underneath visibly deactivates.
    }
    Ok(!visible)
}

#[tauri::command]
pub fn panic_hide(app: AppHandle) -> CmdResult<()> {
    stealth::panic_hide(&app);
    Ok(())
}

#[tauri::command]
pub fn set_click_through(app: AppHandle, payload: bool) -> CmdResult<()> {
    app.get_webview_window("overlay")
        .ok_or_else(|| "overlay window is not available".to_string())?
        .set_ignore_cursor_events(payload)
        .map_err(err)
}

#[tauri::command]
pub fn open_dashboard(app: AppHandle) -> CmdResult<()> {
    let window = app
        .get_webview_window("dashboard")
        .ok_or_else(|| "dashboard window is not available".to_string())?;
    window.show().map_err(err)?;
    window.set_focus().map_err(err)
}

// ---------------------------------------------------------------- audio

#[tauri::command]
pub fn list_audio_devices() -> CmdResult<Vec<audio::AudioDevice>> {
    audio::list_devices().map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartListenPayload {
    pub meeting_id: String,
    pub capture_microphone: bool,
    pub capture_system_audio: bool,
    pub mic_device_id: Option<String>,
    pub system_device_id: Option<String>,
    pub vad_threshold: f32,
    pub vad_silence_ms: u32,
}

#[tauri::command]
pub fn start_listening(
    app: AppHandle,
    payload: StartListenPayload,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    if payload.vad_threshold < 0.0 || payload.vad_threshold > 1.0 {
        return Err("vadThreshold must be between 0 and 1".into());
    }
    if state.capture.lock().is_some() {
        return Err("a listening session is already running".into());
    }

    state.db.create_meeting(&payload.meeting_id, "Untitled meeting").map_err(err)?;

    let (running, epoch, session) = audio::new_session();

    if payload.capture_microphone {
        let stream = audio::start_stream(
            app.clone(),
            payload.mic_device_id.clone(),
            audio::Source::Microphone,
            payload.vad_threshold,
            payload.vad_silence_ms,
            running.clone(),
            epoch,
        )
        .map_err(err)?;
        session.attach(stream);
    }

    if payload.capture_system_audio {
        match audio::start_stream(
            app.clone(),
            payload.system_device_id.clone(),
            audio::Source::System,
            payload.vad_threshold,
            payload.vad_silence_ms,
            running.clone(),
            epoch,
        ) {
            Ok(stream) => session.attach(stream),
            // A missing loopback device should degrade to mic-only, not kill the
            // session — this is the single most common setup failure on Windows.
            Err(e) => tracing::warn!("system audio unavailable, continuing mic-only: {e}"),
        }
    }

    *state.active_meeting.lock() = Some(payload.meeting_id);
    *state.capture.lock() = Some(session);
    Ok(())
}

#[tauri::command]
pub fn stop_listening(state: State<'_, AppState>) -> CmdResult<u64> {
    let mut guard = state.capture.lock();
    let elapsed = match guard.as_ref() {
        Some(session) => {
            session.stop();
            session.elapsed_ms()
        }
        None => 0,
    };
    *guard = None;
    *state.active_meeting.lock() = None;
    Ok(elapsed)
}

// ---------------------------------------------------------------- vision

#[tauri::command]
pub fn capture_screen(
    app: AppHandle,
    payload: Option<vision::CaptureRegion>,
) -> CmdResult<vision::Screenshot> {
    vision::capture(&app, payload).map_err(err)
}

// ---------------------------------------------------------------- secrets

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretPayload {
    pub key_ref: String,
    pub value: String,
}

#[tauri::command]
pub fn set_provider_key(payload: SecretPayload) -> CmdResult<String> {
    if payload.value.trim().is_empty() {
        return Err("credential cannot be empty".into());
    }
    secrets::set_secret(&payload.key_ref, &payload.value).map_err(err)?;
    Ok(secrets::mask(&payload.value))
}

#[tauri::command]
pub fn get_provider_key_hint(payload: String) -> CmdResult<Option<String>> {
    Ok(secrets::get_secret(&payload).map_err(err)?.map(|s| secrets::mask(&s)))
}

/// Returns the real key. Only the router calls this, and only in-process — the
/// value is never persisted anywhere the frontend can read it back later.
#[tauri::command]
pub fn resolve_provider_key(payload: String) -> CmdResult<Option<String>> {
    secrets::get_secret(&payload).map_err(err)
}

#[tauri::command]
pub fn delete_provider_key(payload: String) -> CmdResult<()> {
    secrets::delete_secret(&payload).map_err(err)
}

// ---------------------------------------------------------------- storage

#[tauri::command]
pub fn save_settings(payload: String, state: State<'_, AppState>) -> CmdResult<()> {
    serde_json::from_str::<serde_json::Value>(&payload).map_err(|_| "settings must be valid JSON".to_string())?;
    state.db.set_setting("app_settings", &payload).map_err(err)
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    state.db.get_setting("app_settings").map_err(err)
}

#[tauri::command]
pub fn save_message(payload: db::StoredMessage, state: State<'_, AppState>) -> CmdResult<()> {
    state.db.upsert_conversation(&payload.conversation_id, "Chat").map_err(err)?;
    state.db.insert_message(&payload).map_err(err)
}

#[tauri::command]
pub fn load_messages(payload: String, state: State<'_, AppState>) -> CmdResult<Vec<db::StoredMessage>> {
    state.db.list_messages(&payload).map_err(err)
}

#[tauri::command]
pub fn save_segment(payload: db::StoredSegment, state: State<'_, AppState>) -> CmdResult<()> {
    state.db.insert_segment(&payload).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeMeetingPayload {
    pub meeting_id: String,
    pub title: String,
    pub summary: String,
    pub decisions: String,
    pub action_items: String,
    pub participants: String,
}

#[tauri::command]
pub fn finalize_meeting(
    payload: FinalizeMeetingPayload,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    state
        .db
        .finalize_meeting(
            &payload.meeting_id,
            &payload.summary,
            &payload.decisions,
            &payload.action_items,
            &payload.participants,
            &payload.title,
        )
        .map_err(err)
}

#[tauri::command]
pub fn search_everything(payload: String, state: State<'_, AppState>) -> CmdResult<Vec<db::SearchHit>> {
    if payload.trim().is_empty() {
        return Ok(vec![]);
    }
    state.db.search(&payload, 40).map_err(err)
}

#[tauri::command]
pub fn save_chunks(payload: Vec<db::StoredChunk>, state: State<'_, AppState>) -> CmdResult<()> {
    state.db.save_chunks(&payload).map_err(err)
}

#[tauri::command]
pub fn load_chunks(state: State<'_, AppState>) -> CmdResult<Vec<db::StoredChunk>> {
    state.db.load_chunks().map_err(err)
}

#[tauri::command]
pub fn delete_document(payload: String, state: State<'_, AppState>) -> CmdResult<()> {
    state.db.delete_document(&payload).map_err(err)
}

#[tauri::command]
pub fn wipe_all_data(state: State<'_, AppState>) -> CmdResult<()> {
    state.db.wipe().map_err(err)
}

// ---------------------------------------------------------------- diagnostics

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub platform: String,
    pub capture_exclusion_supported: bool,
    pub listening: bool,
    pub active_meeting: Option<String>,
    pub db_path: String,
}

#[tauri::command]
pub fn diagnostics(state: State<'_, AppState>) -> CmdResult<Diagnostics> {
    Ok(Diagnostics {
        platform: std::env::consts::OS.to_string(),
        capture_exclusion_supported: cfg!(any(target_os = "macos", target_os = "windows")),
        listening: state.capture.lock().is_some(),
        active_meeting: state.active_meeting.lock().clone(),
        db_path: state.db_path.lock().clone(),
    })
}

#[tauri::command]
pub fn set_shortcuts_enabled(state: State<'_, AppState>, payload: bool) -> CmdResult<()> {
    state.shortcuts_enabled.store(payload, Ordering::SeqCst);
    Ok(())
}
