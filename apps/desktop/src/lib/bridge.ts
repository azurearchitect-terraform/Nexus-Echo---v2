import { invoke } from "@tauri-apps/api/core";
import type { StealthConfig } from "@nexus/core";

/**
 * Thin, fully typed wrapper over the Rust command surface. Components never call
 * `invoke` with a raw string — a renamed command becomes a compile error here
 * instead of a runtime failure in front of the user mid-meeting.
 */
export const bridge = {
  applyStealth: (payload: StealthConfig) => invoke<StealthReport>("apply_stealth", { payload }),
  toggleOverlay: () => invoke<boolean>("toggle_overlay"),
  resizeOverlay: (height: number) => invoke<void>("resize_overlay", { height }),
  resizeOverlaySize: (width: number, height: number) => invoke<void>("resize_overlay_size", { width, height }),
  moveOverlay: (dx: number, dy: number) => invoke<void>("move_overlay", { dx, dy }),
  panicHide: () => invoke<void>("panic_hide"),
  focusOverlay: () => invoke<void>("focus_overlay"),
  setClickThrough: (payload: boolean) => invoke<void>("set_click_through", { payload }),
  toggleResizeMode: () => invoke<boolean>("toggle_resize_mode"),
  openDashboard: () => invoke<void>("open_dashboard"),

  listAudioDevices: () => invoke<AudioDevice[]>("list_audio_devices"),
  startListening: (payload: StartListenPayload) => invoke<void>("start_listening", { payload }),
  stopListening: () => invoke<number>("stop_listening"),

  captureScreen: (payload?: CaptureRegion) => invoke<Screenshot>("capture_screen", { payload }),

  setProviderKey: (keyRef: string, value: string) =>
    invoke<string>("set_provider_key", { payload: { keyRef, value } }),
  getProviderKeyHint: (payload: string) => invoke<string | null>("get_provider_key_hint", { payload }),
  resolveProviderKey: (payload: string) => invoke<string | null>("resolve_provider_key", { payload }),
  deleteProviderKey: (payload: string) => invoke<void>("delete_provider_key", { payload }),

  saveSettings: (payload: string) => invoke<void>("save_settings", { payload }),
  loadSettings: () => invoke<string | null>("load_settings"),
  saveMessage: (payload: StoredMessage) => invoke<void>("save_message", { payload }),
  loadMessages: (payload: string) => invoke<StoredMessage[]>("load_messages", { payload }),
  saveSegment: (payload: StoredSegment) => invoke<void>("save_segment", { payload }),
  finalizeMeeting: (payload: FinalizeMeetingPayload) => invoke<void>("finalize_meeting", { payload }),
  searchEverything: (payload: string) => invoke<SearchHit[]>("search_everything", { payload }),

  saveChunks: (payload: StoredChunk[]) => invoke<void>("save_chunks", { payload }),
  loadChunks: () => invoke<StoredChunk[]>("load_chunks"),
  deleteDocument: (payload: string) => invoke<void>("delete_document", { payload }),
  wipeAllData: () => invoke<void>("wipe_all_data"),

  diagnostics: () => invoke<Diagnostics>("diagnostics"),
  setShortcutsEnabled: (payload: boolean) => invoke<void>("set_shortcuts_enabled", { payload }),
  scrapeCompany: (payload: string) => invoke<string>("scrape_company", { payload }),
};

export interface StealthReport {
  visible: boolean;
  alwaysOnTop: boolean;
  captureExcluded: boolean;
  platformNote: string;
}
export interface AudioDevice {
  id: string;
  name: string;
  isInput: boolean;
  isDefault: boolean;
}
export interface StartListenPayload {
  meetingId: string;
  captureMicrophone: boolean;
  captureSystemAudio: boolean;
  micDeviceId?: string;
  systemDeviceId?: string;
  vadThreshold: number;
  vadSilenceMs: number;
}
export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Screenshot {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
}
export interface StoredMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  attachments: string;
  citations: string;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  firstTokenMs?: number | null;
  createdAt: number;
}
export interface StoredSegment {
  id: string;
  meetingId: string;
  speaker: string;
  speakerKey?: string | null;
  text: string;
  startMs: number;
  endMs: number;
  source: string;
  confidence?: number | null;
}
export interface FinalizeMeetingPayload {
  meetingId: string;
  title: string;
  summary: string;
  decisions: string;
  actionItems: string;
  participants: string;
}
export interface SearchHit {
  entityId: string;
  kind: string;
  title: string;
  snippet: string;
}
export interface StoredChunk {
  id: string;
  docId: string;
  title: string;
  text: string;
  ordinal: number;
  vector: string;
}
export interface Diagnostics {
  platform: string;
  captureExclusionSupported: boolean;
  listening: boolean;
  activeMeeting: string | null;
  dbPath: string;
}
