import { create } from "zustand";
import { detectPersona } from "@nexus/ai";
import { AppSettings, uid, type Attachment, type TranscriptSegment, type ProviderId, type CompanyIntel } from "@nexus/core";
import { bridge } from "./bridge";
import { engine } from "./engine";
import { emit, listen } from "@tauri-apps/api/event";

export type Mode = "ask" | "listen" | "intel";

export interface Answer {
  id: string;
  question?: string | undefined;
  persona?: string | undefined;
  text: string;
  provider?: ProviderId;
  model?: string;
  firstTokenMs?: number;
  latencyMs?: number;
  swapped?: boolean;
  citations: Array<{ docId: string; title: string; score: number }>;
  error?: string;
}

interface BufferTask {
  kind: "ask" | "suggest";
  prompt?: string;
  useScreen?: boolean;
}

interface AppStore {
  ready: boolean;
  settings: AppSettings;
  mode: Mode;
  streaming: boolean;
  answer: Answer | null;
  answersList: Answer[];
  questionBuffer: BufferTask[];
  detectedPersona: string | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  attachments: Attachment[];
  conversationId: string;

  listening: boolean;
  meetingId: string | null;
  segments: TranscriptSegment[];
  speakingMic: boolean;
  speakingSystem: boolean;
  followUps: string[];
  latestCompanyIntel: CompanyIntel | null;

  boot: () => Promise<void>;
  setMode: (mode: Mode) => void;
  saveSettings: (next: AppSettings) => Promise<void>;
  ask: (prompt: string, useScreen: boolean) => Promise<void>;
  addAttachment: (attachment: Attachment) => void;
  clearAttachments: () => void;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  pushSegment: (segment: TranscriptSegment) => void;
  setSpeaking: (source: "microphone" | "system", speaking: boolean) => void;
  suggest: () => Promise<void>;
  setLatestCompanyIntel: (intel: CompanyIntel | null) => void;
  clearScreen: () => void;
  reset: () => void;
}

const DEFAULT_SETTINGS = AppSettings.parse({
  providers: [
    { id: "gemini", enabled: true, keyRef: "gemini_api_key", priority: 10, models: {} },
    { id: "openai", enabled: true, keyRef: "openai_api_key", priority: 20, models: {} },
    { id: "ollama", enabled: false, baseUrl: "http://127.0.0.1:11434", priority: 30, models: {} },
  ],
});

export const useStore = create<AppStore>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  mode: "listen",
  streaming: false,
  answer: null,
  answersList: [],
  questionBuffer: [],
  detectedPersona: null,
  history: [],
  attachments: [],
  conversationId: uid("conv"),

  listening: false,
  meetingId: null,
  segments: [],
  speakingMic: false,
  speakingSystem: false,
  followUps: [],
  latestCompanyIntel: null,

  async boot() {
    const raw = await bridge.loadSettings();
    const parsed = raw ? AppSettings.safeParse(JSON.parse(raw)) : null;
    // A settings file from an older version that no longer validates should not
    // brick the app — fall back to defaults rather than refusing to start.
    const settings = parsed?.success ? parsed.data : DEFAULT_SETTINGS;

    await engine.configure(settings);
    await bridge.applyStealth(settings.stealth);
    
    // Load persisted company intel
    let latestCompanyIntel: CompanyIntel | null = null;
    try {
      const persisted = localStorage.getItem("latest_company_intel");
      if (persisted) latestCompanyIntel = JSON.parse(persisted);
    } catch (e) {
      console.error("failed to load latest company intel", e);
    }

    // Listen for updates from other windows
    void listen<CompanyIntel | null>("nexus://company-intel-updated", (event) => {
      // Avoid infinite cycles by setting state in memory only, without re-emitting
      set({ latestCompanyIntel: event.payload });
    });

    set({ settings, ready: true, latestCompanyIntel });
  },

  setMode(mode) {
    set({ mode });
  },

  async saveSettings(next) {
    const settings = AppSettings.parse(next);
    await bridge.saveSettings(JSON.stringify(settings));
    await engine.configure(settings);
    await bridge.applyStealth(settings.stealth);
    set({ settings });
  },

  addAttachment(attachment) {
    set((s) => ({ attachments: [...s.attachments, attachment] }));
  },

  clearAttachments() {
    set({ attachments: [] });
  },

  async ask(prompt, useScreen) {
    if (!prompt.trim()) return;
    if (get().streaming) {
      set((s) => ({ questionBuffer: [...s.questionBuffer, { kind: "ask", prompt, useScreen }] }));
      return;
    }

    const persona = detectPersona(prompt);
    set({ detectedPersona: persona });

    const attachments = [...get().attachments];
    if (useScreen) {
      try {
        const shot = await bridge.captureScreen();
        attachments.push({
          id: uid("shot"),
          kind: "screenshot",
          path: shot.dataUrl,
          mimeType: "image/png",
        });
      } catch (e) {
        console.error("screen capture failed", e);
      }
    }

    const answerId = uid("ans");
    set({
      streaming: true,
      answer: { id: answerId, question: prompt, persona, text: "", citations: [] },
      history: [...get().history, { role: "user", content: prompt }],
    });

    try {
      for await (const event of engine.ask(
        prompt,
        get().history.slice(-8),
        attachments,
        get().settings.ragEnabled,
      )) {
        switch (event.type) {
          case "start":
            set((s) => ({
              answer: s.answer ? { ...s.answer, provider: event.provider, model: event.model } : s.answer,
            }));
            break;
          case "citation":
            set((s) => ({
              answer: s.answer
                ? {
                    ...s.answer,
                    citations: [
                      ...s.answer.citations,
                      { docId: event.docId, title: event.title, score: event.score },
                    ],
                  }
                : s.answer,
            }));
            break;
          case "token":
            set((s) => ({ answer: s.answer ? { ...s.answer, text: s.answer.text + event.delta } : s.answer }));
            break;
          case "swap":
            set((s) => ({
              answer: s.answer
                ? { ...s.answer, text: "", provider: event.provider, model: event.model, swapped: true }
                : s.answer,
            }));
            break;
          case "done":
            set((s) => ({
              answer: s.answer
                ? { ...s.answer, latencyMs: event.latencyMs, firstTokenMs: event.firstTokenMs }
                : s.answer,
            }));
            break;
          case "error":
            set((s) => ({ answer: s.answer ? { ...s.answer, error: event.message } : s.answer }));
            break;
        }
      }

      const final = get().answer;
      if (final?.text) {
        const fullAnswer = { ...final, question: prompt, persona };
        set((s) => ({
          answersList: [...s.answersList.filter((a) => a.id !== final.id), fullAnswer],
          history: [...s.history, { role: "assistant", content: final.text }],
        }));
        await bridge.saveMessage({
          id: final.id,
          conversationId: get().conversationId,
          role: "assistant",
          content: final.text,
          attachments: JSON.stringify(attachments),
          citations: JSON.stringify(final.citations),
          provider: final.provider ?? null,
          model: final.model ?? null,
          latencyMs: final.latencyMs != null ? Math.round(final.latencyMs) : null,
          firstTokenMs: final.firstTokenMs != null ? Math.round(final.firstTokenMs) : null,
          createdAt: Date.now(),
        });
      }
    } finally {
      set({ streaming: false, attachments: [] });
      const nextTask = get().questionBuffer[0];
      if (nextTask) {
        set((s) => ({ questionBuffer: s.questionBuffer.slice(1) }));
        if (nextTask.kind === "ask" && nextTask.prompt) {
          void get().ask(nextTask.prompt, nextTask.useScreen ?? false);
        } else if (nextTask.kind === "suggest") {
          void get().suggest();
        }
      }
    }
  },

  async startListening() {
    const { settings } = get();
    const meetingId = uid("meet");
    await bridge.startListening({
      meetingId,
      captureMicrophone: settings.audio.captureMicrophone,
      captureSystemAudio: settings.audio.captureSystemAudio,
      ...(settings.audio.micDeviceId ? { micDeviceId: settings.audio.micDeviceId } : {}),
      ...(settings.audio.systemDeviceId ? { systemDeviceId: settings.audio.systemDeviceId } : {}),
      vadThreshold: settings.audio.vadThreshold,
      vadSilenceMs: settings.audio.vadSilenceMs,
    });
    set({ listening: true, meetingId, segments: [], mode: "listen", followUps: [] });
  },

  async stopListening() {
    await bridge.stopListening();
    const { meetingId, segments } = get();
    set({ listening: false, speakingMic: false, speakingSystem: false });

    if (meetingId && segments.length) {
      const summary = await engine.summarizeMeeting(segments);
      await bridge.finalizeMeeting({
        meetingId,
        title: summary.title,
        summary: summary.summary,
        decisions: JSON.stringify(summary.decisions),
        actionItems: JSON.stringify(summary.actionItems),
        participants: JSON.stringify(summary.participants),
      });
    }
    set({ meetingId: null });
  },

  pushSegment(segment) {
    set((s) => ({ segments: [...s.segments, segment] }));
    if (segment.isFinal && get().settings.autoRespond !== "manual-only") {
      void get().suggest();
    }
  },

  setSpeaking(source, speaking) {
    set(source === "microphone" ? { speakingMic: speaking } : { speakingSystem: speaking });
  },

  async suggest() {
    if (get().streaming) {
      set((s) => ({ questionBuffer: [...s.questionBuffer, { kind: "suggest" }] }));
      return;
    }
    const segments = get().segments;
    const lastQuestion = [...segments].reverse().find((s) => s.text.trim())?.text ?? "";
    const persona = lastQuestion ? detectPersona(lastQuestion) : (get().detectedPersona ?? undefined);
    if (persona) set({ detectedPersona: persona });

    const answerId = uid("ans");
    set({
      streaming: true,
      mode: "ask",
      answer: { id: answerId, question: lastQuestion || undefined, persona, text: "", citations: [] },
    });
    try {
      for await (const event of engine.suggest(segments)) {
        if (event.type === "token") {
          set((s) => ({ answer: s.answer ? { ...s.answer, text: s.answer.text + event.delta } : s.answer }));
        } else if (event.type === "start") {
          set((s) => ({
            answer: s.answer ? { ...s.answer, provider: event.provider, model: event.model } : s.answer,
          }));
        } else if (event.type === "done") {
          set((s) => ({
            answer: s.answer
              ? { ...s.answer, latencyMs: event.latencyMs, firstTokenMs: event.firstTokenMs }
              : s.answer,
          }));
        } else if (event.type === "error") {
          set((s) => ({ answer: s.answer ? { ...s.answer, error: event.message } : s.answer }));
        }
      }
      const final = get().answer;
      if (final?.text) {
        set((s) => ({
          answersList: [...s.answersList.filter((a) => a.id !== final.id), final],
        }));
      }
      // Follow-up generation disabled for clean UI
    } finally {
      set({ streaming: false });
      const nextTask = get().questionBuffer[0];
      if (nextTask) {
        set((s) => ({ questionBuffer: s.questionBuffer.slice(1) }));
        if (nextTask.kind === "ask" && nextTask.prompt) {
          void get().ask(nextTask.prompt, nextTask.useScreen ?? false);
        } else if (nextTask.kind === "suggest") {
          void get().suggest();
        }
      }
    }
  },

  clearScreen() {
    set({ answer: null, answersList: [], attachments: [], followUps: [], questionBuffer: [], segments: [], detectedPersona: null });
  },

  setLatestCompanyIntel(intel: CompanyIntel | null) {
    if (intel) {
      localStorage.setItem("latest_company_intel", JSON.stringify(intel));
      void emit("nexus://company-intel-updated", intel);
    } else {
      localStorage.removeItem("latest_company_intel");
      void emit("nexus://company-intel-updated", null);
    }
    set({ latestCompanyIntel: intel });
  },

  reset() {
    set({
      answer: null,
      answersList: [],
      history: [],
      attachments: [],
      conversationId: uid("conv"),
      followUps: [],
      questionBuffer: [],
      detectedPersona: null,
    });
  },
}));
