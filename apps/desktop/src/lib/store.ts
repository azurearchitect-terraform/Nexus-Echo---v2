import { create } from "zustand";
import { detectPersona } from "@nexus/ai";
import { AppSettings, uid, type Attachment, type TranscriptSegment, type ProviderId, type CompanyIntel } from "@nexus/core";
import { bridge } from "./bridge";
import { engine, verifyAzureSpecs } from "./engine";
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
  verifiedSpec?: { isVerified: boolean; terms: string[] };
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
  endInterviewQuestions: Array<{ question: string; context: string; followUpNote: string }>;
  latestCompanyIntel: CompanyIntel | null;
  manualPersona: string | null;

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
  generateEndQuestions: () => Promise<void>;
  setManualPersona: (persona: string | null) => void;
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

let suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const NON_QUESTION_PHRASES = new Set([
  "hello", "hi", "hey", "thank you", "thanks", "okay", "ok", "got it", "sure",
  "mhm", "yeah", "yes", "no", "cool", "alright", "right", "good morning",
  "good afternoon", "bye", "see you", "ding", "chime", "ping", "bell", "beep",
  "sound", "noise", "thank you very much", "thanks a lot", "sounds good",
  "makes sense", "i see", "understood", "great", "perfect", "awesome",
  "testing", "microphones", "check"
]);

const QUESTION_INDICATORS = [
  "what", "why", "how", "when", "where", "who", "which",
  "can", "could", "would", "should", "explain", "describe", "tell",
  "difference", "versus", "compare", "architecture", "design", "implement",
  "experience", "scenario", "suppose", "consider", "imagine", "given",
  "have you", "do you", "did you", "is there", "are there", "what is",
  "what are", "how do", "how to", "why do", "why is", "can you", "could you"
];

const INCOMPLETE_TRAILING_WORDS = [
  "and", "or", "so", "but", "with", "that", "where", "if", "then", "to",
  "for", "about", "is", "are", "a", "an", "the", "suppose", "consider",
  "imagine", "given", "when", "as", "like", "because"
];

export function isActionableQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  if (NON_QUESTION_PHRASES.has(lower)) return false;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length < 3) {
    if (trimmed.endsWith("?")) return true;
    if (words.some((w) => ["what", "why", "how", "explain"].includes(w))) return true;
    return false;
  }

  if (trimmed.endsWith("?")) return true;
  return QUESTION_INDICATORS.some((ind) => lower.includes(ind));
}

export function isIncompleteScenario(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return false;

  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const lastWord = words[words.length - 1];
  if (lastWord && INCOMPLETE_TRAILING_WORDS.includes(lastWord)) return true;

  const startsWithScenario = ["suppose", "consider", "imagine", "given", "scenario", "let's say"].some((s) => lower.startsWith(s));
  if (startsWithScenario && !lower.includes("what") && !lower.includes("how") && !lower.includes("why") && !lower.includes("explain")) {
    return true;
  }

  return false;
}

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
  endInterviewQuestions: [],
  latestCompanyIntel: null,

  manualPersona: null,

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

    void listen<Array<{ question: string; context: string; followUpNote: string }>>("nexus://end-questions-updated", (event) => {
      set({ endInterviewQuestions: event.payload });
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

    const persona = get().manualPersona || detectPersona(prompt);
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
        const verifiedSpec = verifyAzureSpecs(final.text);
        const fullAnswer = { ...final, question: prompt, persona, verifiedSpec };
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
      void emit("nexus://meeting-finalized", { meetingId, summary });
    }
    set({ meetingId: null });
  },

  pushSegment(segment) {
    set((s) => ({ segments: [...s.segments, segment] }));
    if (segment.isFinal && get().settings.autoRespond !== "manual-only") {
      if (suggestDebounceTimer) {
        clearTimeout(suggestDebounceTimer);
        suggestDebounceTimer = null;
      }

      const recentSegments = get().segments.slice(-3);
      const combinedText = recentSegments.map((s) => s.text).join(" ");

      // Auto-trigger end-of-interview candidate questions when interviewer asks "do you have any questions for us?"
      if (/do you have any questions|any questions for (us|me|our team)|any questions from your/i.test(combinedText)) {
        void get().generateEndQuestions();
      }

      if (!isActionableQuestion(combinedText)) {
        return; // Ignore notification noise, casual remarks, non-questions
      }

      if (isIncompleteScenario(combinedText)) {
        // Speaker paused mid-scenario — wait 1600ms for them to complete before generating
        suggestDebounceTimer = setTimeout(() => {
          suggestDebounceTimer = null;
          void get().suggest();
        }, 1600);
      } else {
        void get().suggest();
      }
    }
  },

  setSpeaking(source, speaking) {
    set(source === "microphone" ? { speakingMic: speaking } : { speakingSystem: speaking });
  },

  async generateEndQuestions() {
    const questions = await engine.generateEndInterviewQuestions(get().segments);
    set({ endInterviewQuestions: questions });
    void emit("nexus://end-questions-updated", questions);
  },

  async suggest() {
    if (get().streaming) {
      set((s) => ({ questionBuffer: [...s.questionBuffer, { kind: "suggest" }] }));
      return;
    }
    const segments = get().segments;
    const recent = segments.slice(-3);
    const lastQuestion = recent.map((s) => s.text.trim()).filter(Boolean).join(" ") || "Live Question";
    const persona = get().manualPersona || (lastQuestion ? detectPersona(lastQuestion) : (get().detectedPersona ?? undefined));
    if (persona) set({ detectedPersona: persona });

    const answerId = uid("ans");
    set({
      streaming: true,
      answer: { id: answerId, question: lastQuestion || undefined, persona, text: "", citations: [] },
    });
    try {
      for await (const event of engine.suggest(segments)) {
        if (event.type === "token") {
          set((s) => ({ answer: s.answer ? { ...s.answer, text: s.answer.text + event.delta } : s.answer }));
        } else if (event.type === "swap") {
          // Deep model is taking over — clear the fast answer so deep streams in cleanly
          set((s) => ({
            answer: s.answer
              ? { ...s.answer, text: "", provider: event.provider, model: event.model, swapped: true }
              : s.answer,
          }));
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
        const verifiedSpec = verifyAzureSpecs(final.text);
        const verifiedAnswer = { ...final, verifiedSpec };
        set((s) => ({
          answersList: [...s.answersList.filter((a) => a.id !== final.id), verifiedAnswer],
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

  setManualPersona(persona) {
    set({ manualPersona: persona, detectedPersona: persona });
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
