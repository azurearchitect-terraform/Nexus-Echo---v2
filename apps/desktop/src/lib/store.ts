import { create } from "zustand";
import { detectPersona, analyzeSpeechQuality, generateSpeechFeedback } from "@nexus/ai";
import {
  AppSettings,
  uid,
  type Attachment,
  type TranscriptSegment,
  type ProviderId,
  type CompanyIntel,
  type SpeakerPacing,
  type SpeechQualityMetrics,
  isActionableQuestion,
  analyzeQuestionCompleteness,
  QUESTION_INDICATORS,
} from "@nexus/core";
import { bridge } from "./bridge";
import { engine, verifyAzureSpecs } from "./engine";
import { emit, listen } from "@tauri-apps/api/event";
import type { CoverageChecklistItem, FollowUpPrediction, InterviewCoachInsight, InterviewDebrief, InterviewMode, StoryBankItem } from "@nexus/core";
import {
  loadInterviewDebriefs,
  loadInterviewMode,
  loadStoryBank,
  saveInterviewDebriefs,
  saveInterviewMode,
  saveStoryBank,
  matchStoryBank,
  buildCoverageChecklist,
  buildDebriefFromInsight,
  buildInterviewCoachInsight,
} from "./interview";

export type Mode = "ask" | "listen" | "intel";

export interface Answer {
  id: string;
  createdAt: number;
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
  isCached?: boolean;
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
  endInterviewQuestions: Array<{ question: string; context: string; followUpNote: string; expectedAnswer: string; professionalExample: string; category: "Technical" | "HR" }>;
  isGeneratingEndQuestions: boolean;
  latestCompanyIntel: CompanyIntel | null;
  manualPersona: string | null;
  interviewMode: InterviewMode;
  storyBank: StoryBankItem[];
  coachInsight: InterviewCoachInsight | null;
  coverageChecklist: CoverageChecklistItem[];
  nextQuestions: FollowUpPrediction[];
  interviewDebriefs: InterviewDebrief[];
  speechMetrics: SpeechQualityMetrics | null;
  speechFeedback: string[];

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
  suggest: (isSpeculative?: boolean) => Promise<void>;
  generateCoachingTip: () => Promise<void>;
  generateEndQuestions: () => Promise<void>;
  analyzeInterviewTurn: (question: string, answer: string, transcript?: string) => Promise<void>;
  setManualPersona: (persona: string | null) => void;
  setInterviewMode: (mode: InterviewMode) => void;
  addStory: (story: Omit<StoryBankItem, "id" | "createdAt">) => void;
  updateStory: (id: string, story: Partial<StoryBankItem>) => void;
  deleteStory: (id: string) => void;
  setLatestCompanyIntel: (intel: CompanyIntel | null) => void;
  clearScreen: () => void;
  reset: () => void;
  setSpeakerPacing: (pacing: SpeakerPacing, isAutoOverride?: boolean) => Promise<void>;
  stopGeneration: (currentDisplayed?: string) => void;
  isSmartWaiting: boolean;
  smartWaitConfidence: number | null;
  cancelSmartWait: () => void;
  sendNow: () => void;
  
  isSpeculating: boolean;
  speculativeAnswer: Answer | null;
  isSpeculationComplete: boolean;
  finalizeAnswer: (final: Answer, lastQuestion: string, segments: TranscriptSegment[]) => void;
}

const DEFAULT_SETTINGS = AppSettings.parse({
  providers: [
    { id: "gemini", enabled: true, keyRef: "gemini_api_key", priority: 10, models: {} },
    { id: "openai", enabled: true, keyRef: "openai_api_key", priority: 20, models: {} },
    { id: "ollama", enabled: false, baseUrl: "http://127.0.0.1:11434", priority: 30, models: {} },
  ],
  targetRole: "Senior Azure Architect",
  experienceYears: 16,
});

let suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let smartWaitTimer: ReturnType<typeof setTimeout> | null = null;
let speculativeWaitTimer: ReturnType<typeof setTimeout> | null = null;
let speculativeAbortController: AbortController | null = null;
let activeAbortController: AbortController | null = null;
let lastSuggestSegmentIndex = -1; // Track which segment index was last consumed by suggest()
const SETTINGS_UPDATED_EVENT = "nexus://settings-updated";

function hexToRgbStr(hex: string): string {
  const cleanHex = hex.replace("#", "");
  if (cleanHex.length !== 6) return "110 231 183"; // default emerald-300
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyThemeColors(settings: AppSettings) {
  if (typeof document !== "undefined") {
    const rgb = hexToRgbStr(settings.accentColor || "#6ee7b7");
    document.documentElement.style.setProperty("--color-accent", rgb);
    document.documentElement.style.setProperty("--color-accent-muted", rgb);
    document.documentElement.style.setProperty("--color-accent-deep", rgb);
  }
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
  isGeneratingEndQuestions: false,
  latestCompanyIntel: null,
  isSmartWaiting: false,
  smartWaitConfidence: null,
  
  isSpeculating: false,
  speculativeAnswer: null,
  isSpeculationComplete: false,

  manualPersona: null,
  interviewMode: loadInterviewMode(),
  storyBank: loadStoryBank(),
  coachInsight: null,
  coverageChecklist: [],
  nextQuestions: [],
  interviewDebriefs: loadInterviewDebriefs(),
  speechMetrics: null,
  speechFeedback: [],

  async boot() {
    const raw = await bridge.loadSettings();
    const parsed = raw ? AppSettings.safeParse(JSON.parse(raw)) : null;
    // A settings file from an older version that no longer validates should not
    // brick the app — fall back to defaults rather than refusing to start.
    const settings = parsed?.success ? parsed.data : DEFAULT_SETTINGS;

    set({
      settings,
      latestCompanyIntel: null,
      interviewMode: loadInterviewMode(),
      storyBank: loadStoryBank(),
      coachInsight: null,
      coverageChecklist: [],
      nextQuestions: [],
      interviewDebriefs: loadInterviewDebriefs(),
    });

    await engine.configure(settings);
    await bridge.applyStealth(settings.stealth);
    applyThemeColors(settings);
    
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

    void listen<Array<{ question: string; context: string; followUpNote: string; expectedAnswer: string; professionalExample: string; category: "Technical" | "HR" }>>("nexus://end-questions-updated", (event) => {
      set({ endInterviewQuestions: event.payload });
    });

    void listen<string>(SETTINGS_UPDATED_EVENT, async (event) => {
      const currentSettings = get().settings;
      if (JSON.stringify(currentSettings) === event.payload) return;

      const parsedSettings = AppSettings.safeParse(JSON.parse(event.payload));
      if (!parsedSettings.success) return;

      await engine.configure(parsedSettings.data);
      await bridge.applyStealth(parsedSettings.data.stealth);
      applyThemeColors(parsedSettings.data);
      set({ settings: parsedSettings.data });
    });

    set({ settings, ready: true, latestCompanyIntel });
  },

  setMode(mode) {
    set({ mode });
  },

  async saveSettings(next) {
    const settings = AppSettings.parse(next);
    const serializedSettings = JSON.stringify(settings);
    await bridge.saveSettings(serializedSettings);
    await engine.configure(settings);
    await bridge.applyStealth(settings.stealth);
    applyThemeColors(settings);
    set({ settings });
    await emit(SETTINGS_UPDATED_EVENT, serializedSettings);
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
      answer: { id: answerId, createdAt: Date.now(), question: prompt, persona, text: "", citations: [] },
      history: [...get().history, { role: "user", content: prompt }],
    });

    try {
      for await (const event of engine.ask(
        prompt,
        get().history.slice(-8),
        attachments,
        get().settings.ragEnabled,
      )) {
        if (!get().streaming) break;
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
                ? { ...s.answer, latencyMs: event.latencyMs, firstTokenMs: event.firstTokenMs, isCached: (event as any).isCached }
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
        // Disabled to save credits as per Option A
        // void get().analyzeInterviewTurn(prompt, final.text, get().segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n"));
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

    if (smartWaitTimer) clearTimeout(smartWaitTimer);
    if (speculativeWaitTimer) clearTimeout(speculativeWaitTimer);
    if (suggestDebounceTimer) clearTimeout(suggestDebounceTimer);
    activeAbortController?.abort();
    speculativeAbortController?.abort();
    smartWaitTimer = null;
    speculativeWaitTimer = null;
    suggestDebounceTimer = null;
    activeAbortController = null;
    speculativeAbortController = null;
    lastSuggestSegmentIndex = -1;

    let silenceMs = settings.audio.vadSilenceMs;
    const pacing = settings.audio.speakerPacing ?? "normal";
    if (pacing === "fast") silenceMs = 650;
    else if (pacing === "slow") silenceMs = 1800;
    else if (pacing === "auto") silenceMs = 1200;
    else silenceMs = Math.max(silenceMs, 1100);

    await bridge.startListening({
      meetingId,
      captureMicrophone: settings.audio.captureMicrophone,
      captureSystemAudio: settings.audio.captureSystemAudio,
      ...(settings.audio.micDeviceId ? { micDeviceId: settings.audio.micDeviceId } : {}),
      ...(settings.audio.systemDeviceId ? { systemDeviceId: settings.audio.systemDeviceId } : {}),
      vadThreshold: settings.audio.vadThreshold,
      vadSilenceMs: silenceMs,
    });
    set({
      listening: true,
      meetingId,
      segments: [],
      mode: "listen",
      followUps: [],
      answer: null,
      questionBuffer: [],
      streaming: false,
      isSmartWaiting: false,
      smartWaitConfidence: null,
      isSpeculating: false,
      speculativeAnswer: null,
      isSpeculationComplete: false,
    });
  },

  async stopListening() {
    await bridge.stopListening();
    const { meetingId, segments } = get();
    set({ listening: false, speakingMic: false, speakingSystem: false });

    if (meetingId && segments.length) {
      try {
        // Get user's spoken answer transcript
        const userSpokenSegments = segments.filter((s) => s.source === "microphone" && s.text.trim().length > 10);
        const userSpokenText = userSpokenSegments.map((s) => s.text.trim()).join("\n\n");
        
        // Analyze speech quality metrics
        let speechMetrics: SpeechQualityMetrics | null = null;
        let speechFeedback: string[] = [];
        if (userSpokenText && userSpokenSegments.length > 0) {
          try {
            // Convert segments to timing format for analysis
            const timingSegments = userSpokenSegments.map(s => ({
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            }));
            
            speechMetrics = analyzeSpeechQuality(userSpokenText, timingSegments);
            speechFeedback = generateSpeechFeedback(speechMetrics);
            set({ speechMetrics, speechFeedback });
            console.log("[Speech Analytics]", speechMetrics);
          } catch (err) {
            console.warn("[Speech Analytics] Failed to analyze speech quality:", err);
          }
        }

        const summary = await engine.summarizeMeeting(segments);
        await bridge.finalizeMeeting({
          meetingId,
          title: summary.title || "Untitled meeting",
          summary: summary.summary || "No summary available.",
          decisions: JSON.stringify(summary.decisions || []),
          actionItems: JSON.stringify(summary.actionItems || []),
          participants: JSON.stringify(summary.participants || []),
        });
        void emit("nexus://meeting-finalized", { meetingId, summary, speechMetrics, speechFeedback });

        // Index the user's spoken answers into RAG so the system learns their style!
        if (userSpokenText) {
          const docId = `user_speech_${meetingId}`;
          const title = `User Spoken Answers (${summary.title || "Untitled"})`;
          void engine.indexUserSpeech(docId, title, userSpokenText).catch(console.error);
        }
      } catch (err) {
        // Fallback when AI summarization fails (no provider configured, API error, timeout, etc)
        console.error("[Meeting Summary] AI summarization failed, emitting fallback summary:", err);
        
        const fallbackSummary = {
          title: "Interview Session",
          summary: `Interview captured ${segments.length} transcript segments. AI summarization failed - check your provider configuration and API keys in Settings.`,
          decisions: [],
          actionItems: [],
          openQuestions: [],
          participants: [],
        };
        
        await bridge.finalizeMeeting({
          meetingId,
          title: fallbackSummary.title,
          summary: fallbackSummary.summary,
          decisions: JSON.stringify(fallbackSummary.decisions),
          actionItems: JSON.stringify(fallbackSummary.actionItems),
          participants: JSON.stringify(fallbackSummary.participants),
        });
        
        // Emit the event even on failure so the debrief panel shows something
        void emit("nexus://meeting-finalized", { meetingId, summary: fallbackSummary });
      }
    } else if (meetingId && !segments.length) {
      // Handle case where meeting exists but no segments were captured
      console.warn("[Meeting Summary] No transcript segments captured during interview");
      const emptySummary = {
        title: "Interview Session (No Audio)",
        summary: "No audio segments were captured during this interview session. Please check your microphone settings and audio permissions.",
        decisions: [],
        actionItems: [],
        openQuestions: [],
        participants: [],
      };
      
      await bridge.finalizeMeeting({
        meetingId,
        title: emptySummary.title,
        summary: emptySummary.summary,
        decisions: JSON.stringify(emptySummary.decisions),
        actionItems: JSON.stringify(emptySummary.actionItems),
        participants: JSON.stringify(emptySummary.participants),
      });
      
      void emit("nexus://meeting-finalized", { meetingId, summary: emptySummary });
    }
    set({ meetingId: null });
  },

  async setSpeakerPacing(pacing, isAutoOverride = false) {
    const { settings, listening, meetingId } = get();
    
    // Preserve "auto" configuration settings when dynamically overriding VAD parameters
    const targetPacing = isAutoOverride ? "auto" : pacing;
    
    const updatedSettings = {
      ...settings,
      audio: {
        ...settings.audio,
        speakerPacing: targetPacing,
      },
    };
    set({ settings: updatedSettings });
    await bridge.saveSettings(JSON.stringify(updatedSettings));

    // If currently listening, swap the VAD parameters dynamically without restarting the meeting session
    if (listening && meetingId) {
      await bridge.stopListening();
      
      let silenceMs = settings.audio.vadSilenceMs;
      // Use the actual target pacing (e.g. slow) if we are dynamically overriding in auto mode
      const activePacing = isAutoOverride ? pacing : targetPacing;
      if (activePacing === "fast") silenceMs = 650;
      else if (activePacing === "slow") silenceMs = 1800;
      else if (activePacing === "auto") silenceMs = 1200;
      else silenceMs = Math.max(silenceMs, 1100);

      try {
        await bridge.startListening({
          meetingId,
          captureMicrophone: settings.audio.captureMicrophone,
          captureSystemAudio: settings.audio.captureSystemAudio,
          ...(settings.audio.micDeviceId ? { micDeviceId: settings.audio.micDeviceId } : {}),
          ...(settings.audio.systemDeviceId ? { systemDeviceId: settings.audio.systemDeviceId } : {}),
          vadThreshold: settings.audio.vadThreshold,
          vadSilenceMs: silenceMs,
        });
        console.log(`[Pacing] Swapped VAD silence threshold dynamically to: ${silenceMs}ms (${activePacing})`);
      } catch (e) {
        console.error("[Pacing] Failed to restart audio after pacing change:", e);
        set({ listening: false });
      }
    }
  },

  pushSegment(segment) {
    set((s) => ({ segments: [...s.segments, segment] }));
    if (segment.isFinal) {
      // Save segment to database so meeting transcripts are persisted
      void bridge.saveSegment({
        id: segment.id,
        meetingId: segment.meetingId,
        speaker: segment.speaker,
        speakerKey: null,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        source: segment.source,
        confidence: null,
      }).catch(console.error);

      const settings = get().settings;
      const isMicOnly = settings.audio.captureMicrophone && !settings.audio.captureSystemAudio;
      // In dual-capture mode treat mic as question source when no system audio has arrived
      // yet (e.g. solo testing). Once the interviewer speaks the first segment, revert to
      // the normal dual-capture roles (system = interviewer, mic = candidate).
      const hasReceivedSystemAudio = get().segments.some((s) => s.source === "system");
      const effectiveMicOnly = isMicOnly || (settings.audio.captureMicrophone && settings.audio.captureSystemAudio && !hasReceivedSystemAudio);
      const isInterviewerSource = segment.source === "system" || effectiveMicOnly;

      // If the candidate starts speaking (microphone segment in dual-capture mode) and we have a pending suggestion or countdown,
      // it means the interviewer finished and the candidate started answering. Trigger suggest() immediately!
      if (!effectiveMicOnly && segment.source === "microphone") {
        if (suggestDebounceTimer) {
          clearTimeout(suggestDebounceTimer);
          suggestDebounceTimer = null;
        }
        if (smartWaitTimer) {
          clearTimeout(smartWaitTimer);
          smartWaitTimer = null;
          set({ isSmartWaiting: false, smartWaitConfidence: null });
          console.log("[SmartWait] Candidate started speaking. Triggering suggested answer immediately!");
          void get().suggest();
          lastSuggestSegmentIndex = get().segments.length - 1;
        }
        return; // In dual mode, candidate speaking does not start a new interviewer question countdown
      }

      // ONLY trigger live suggestions if auto-respond is enabled
      if (settings.autoRespond !== "manual-only" && isInterviewerSource) {
        // ── SHORT SEGMENT GUARD ──
        // In production, speaker audio capture produces micro-segments (filler words,
        // background noise transcribed as "um", "right", etc.). These should NOT cancel
        // an active smartWait timer, otherwise the timer never fires and auto-send breaks.
        const segWords = segment.text.trim().split(/\s+/).filter(Boolean);
        const isShortFiller = segWords.length < 3 && !segment.text.trim().endsWith("?") &&
          !QUESTION_INDICATORS.some((q) => segment.text.toLowerCase().includes(q));

        if (isShortFiller && smartWaitTimer) {
          // Short filler while already waiting — just append the segment, don't reset the timer
          console.log(`[SmartWait] Short filler segment ignored (${segWords.length} words): "${segment.text.trim()}"`);
          return;
        }

        // A later transcript chunk means the interviewer continued speaking. Stop
        // any answer generated from the incomplete chunk instead of queueing a
        // second answer and leaving stale text on screen.
        if (get().streaming && activeAbortController) {
          activeAbortController.abort();
          activeAbortController = null;
          set({ streaming: false, answer: null, questionBuffer: [] });
        }

        // Cancel active smart wait — speaker is speaking a substantial new segment
        if (smartWaitTimer) {
          clearTimeout(smartWaitTimer);
          smartWaitTimer = null;
          set({ isSmartWaiting: false, smartWaitConfidence: null });
        }
        if (suggestDebounceTimer) {
          clearTimeout(suggestDebounceTimer);
          suggestDebounceTimer = null;
        }
        if (speculativeWaitTimer) {
          clearTimeout(speculativeWaitTimer);
          speculativeWaitTimer = null;
        }
        if (speculativeAbortController) {
          speculativeAbortController.abort();
          speculativeAbortController = null;
        }
        if (get().isSpeculating) {
          set({ speculativeAnswer: null, isSpeculating: false, isSpeculationComplete: false });
          console.log("[Speculative] Interrupted by new speech. Resetting background generation.");
        }

        // ── SEGMENT WINDOW: Only combine segments SINCE the last answered question ──
        // This prevents new questions from merging with already-answered ones.
        const allSegments = get().segments;
        const lastAnsweredIdx = lastSuggestSegmentIndex;
        const freshSegments = lastAnsweredIdx >= 0
          ? allSegments.slice(lastAnsweredIdx + 1)
          : allSegments.slice(-5);
        const combinedText = freshSegments
          .filter((s) => s.source === segment.source)
          .map((s) => s.text)
          .join(" ");

        // Auto-trigger end-of-interview candidate questions when interviewer asks "do you have any questions for us?"
        if (/do you have any questions|any questions for (us|me|our team)|any questions from your/i.test(combinedText)) {
          void get().generateEndQuestions();
        }

        if (!isActionableQuestion(combinedText, settings.autoRespond)) {
          return; // Ignore noise and non-questions
        }

        // Auto-pacing detection: if the interviewer has consecutive segments within 3 seconds,
        // and we are in "auto" pacing mode, dynamically adjust VAD silence threshold to "slow"
        if (settings.audio.speakerPacing === "auto") {
          const systemSegments = allSegments.filter((s) => s.source === segment.source);
          if (systemSegments.length >= 2) {
            const last = systemSegments[systemSegments.length - 1];
            const prev = systemSegments[systemSegments.length - 2];
            if (last && prev) {
              const gap = last.startMs - prev.endMs;
              // If they pause for 800ms - 3000ms and continue, they are a slow speaker!
              if (gap > 800 && gap < 3000) {
                console.log("[Pacing] Slow speaker detected dynamically (gap = " + gap + "ms). Switching to slow pacing.");
                void get().setSpeakerPacing("slow", true); // Dynamic override
              }
            }
          }
        }

        // ── SMART WAIT: Question Completion Detection ──
        const sttConfidence = segment.confidence ?? undefined;
        const completeness = analyzeQuestionCompleteness(combinedText, sttConfidence);

        // Pacing multiplier: slow speakers get slightly longer waits, fast speakers get snappier responses
        const pacing = settings.audio.speakerPacing;
        let pacingMultiplier = 1.0;
        if (pacing === "fast") pacingMultiplier = 0.5;
        else if (pacing === "slow") pacingMultiplier = 1.5;
        else if (pacing === "auto") pacingMultiplier = 1.1;

        // Dynamic wait time based on completeness confidence
        // Production-tuned: responsive and crisp so the candidate never has to wait unnecessarily
        let waitMs: number;
        if (completeness >= 0.75) {
          waitMs = Math.round(250 * pacingMultiplier);
        } else if (completeness >= 0.50) {
          waitMs = Math.round(650 * pacingMultiplier);
        } else if (completeness >= 0.30) {
          waitMs = Math.round(1100 * pacingMultiplier);
        } else {
          waitMs = Math.round(1600 * pacingMultiplier);
        }

        // Give conferencing audio enough time to deliver another chunk. A very
        // short completion timer answers natural mid-question pauses in Teams.
        const minimumWaitMs = pacing === "fast" ? 500 : pacing === "normal" ? 900 : 1200;
        waitMs = Math.min(Math.max(waitMs, minimumWaitMs), 2200);

        console.log(
          `[SmartWait] Completeness: ${(completeness * 100).toFixed(0)}% | ` +
          `Wait: ${waitMs}ms | Pacing: ${pacing} (×${pacingMultiplier}) | ` +
          `Text: "${combinedText.slice(0, 60)}${combinedText.length > 60 ? "…" : ""}"`
        );

        set({ isSmartWaiting: true, smartWaitConfidence: completeness });

        // Speculative Execution Timer
        const baseSpeculativeMs = settings.routing.speculativeWaitMs ?? 300;
        const dynamicSpeculativeMs = Math.round(baseSpeculativeMs * pacingMultiplier);
        
        // Set this up if smart wait is going to take longer than speculative wait anyway.
        if (waitMs > dynamicSpeculativeMs) {
          speculativeWaitTimer = setTimeout(() => {
            speculativeWaitTimer = null;
            void get().suggest(true);
          }, dynamicSpeculativeMs);
        }

        smartWaitTimer = setTimeout(() => {
          smartWaitTimer = null;
          set({ isSmartWaiting: false, smartWaitConfidence: null });
          // suggest() snapshots the fresh segments synchronously. Mark them consumed
          // only afterward so the complete question reaches the answer engine.
          void get().suggest();
          lastSuggestSegmentIndex = get().segments.length - 1;
        }, waitMs);
      }
    }
  },

  setSpeaking(source, speaking) {
    set(source === "microphone" ? { speakingMic: speaking } : { speakingSystem: speaking });
  },

  async generateEndQuestions() {
    set({ isGeneratingEndQuestions: true });
    try {
      const questions = await engine.generateEndInterviewQuestions(get().segments);
      set({ endInterviewQuestions: questions });
      void emit("nexus://end-questions-updated", questions);
    } finally {
      set({ isGeneratingEndQuestions: false });
    }
  },

  async analyzeInterviewTurn(question, answer, transcript) {
    const trimmedQuestion = question.trim();
    const trimmedAnswer = answer.trim();
    if (!trimmedQuestion || !trimmedAnswer) return;

    const state = get();
    const localStories = state.storyBank;
    const localCoach = buildInterviewCoachInsight(trimmedQuestion, trimmedAnswer, state.interviewMode, localStories);

    let remoteCoach: InterviewCoachInsight | null = null;
    try {
      remoteCoach = await engine.analyzeInterviewTurn({
        question: trimmedQuestion,
        answer: trimmedAnswer,
        mode: state.interviewMode,
        ...(transcript ? { transcript } : {}),
        ...(localStories.length ? { storyBank: localStories } : {}),
      });
    } catch (e) {
      console.error("interview analysis failed", e);
    }

    const matchedStories = matchStoryBank(trimmedQuestion, trimmedAnswer, localStories);
    const topStory = matchedStories[0];
    const checklist = (remoteCoach?.checklist?.length ? remoteCoach.checklist : localCoach.checklist).map((item) => ({
      ...item,
      covered: item.covered || buildCoverageChecklist(trimmedQuestion, trimmedAnswer, state.interviewMode).some((fallback) => fallback.label === item.label && fallback.covered),
    }));
    const nextQuestions = (remoteCoach?.likelyFollowUps?.length ? remoteCoach.likelyFollowUps : localCoach.likelyFollowUps).slice(0, 3);
    const coachInsight: InterviewCoachInsight = {
      ...(remoteCoach ?? localCoach),
      summary: remoteCoach?.summary || localCoach.summary,
      overallScore: remoteCoach?.overallScore ?? localCoach.overallScore,
      structureScore: remoteCoach?.structureScore ?? localCoach.structureScore,
      clarityScore: remoteCoach?.clarityScore ?? localCoach.clarityScore,
      specificityScore: remoteCoach?.specificityScore ?? localCoach.specificityScore,
      confidenceScore: remoteCoach?.confidenceScore ?? localCoach.confidenceScore,
      strengths: [...new Set([...(remoteCoach?.strengths ?? localCoach.strengths), ...(topStory ? [`Best story match: ${topStory.title}`] : [])])].slice(0, 4),
      gaps: remoteCoach?.gaps ?? localCoach.gaps,
      coachingTip: remoteCoach?.coachingTip || localCoach.coachingTip,
      nextBestMove: remoteCoach?.nextBestMove || localCoach.nextBestMove,
      suggestedStoryTags: [...new Set([...(remoteCoach?.suggestedStoryTags ?? localCoach.suggestedStoryTags), ...(topStory?.tags ?? [])])].slice(0, 4),
      checklist,
      likelyFollowUps: nextQuestions,
      storyMatchHint: topStory ? `${topStory.title} (${Math.round(topStory.score * 100)}% match)` : remoteCoach?.storyMatchHint || localCoach.storyMatchHint,
    };

    const debrief = buildDebriefFromInsight(trimmedQuestion, trimmedAnswer, state.interviewMode, coachInsight, topStory?.title);
    const debriefs = [...state.interviewDebriefs.filter((item) => item.question !== trimmedQuestion || item.answer !== trimmedAnswer), debrief];

    set({
      coachInsight,
      coverageChecklist: checklist,
      nextQuestions,
      interviewDebriefs: debriefs,
    });
    saveInterviewDebriefs(debriefs);
  },

  setInterviewMode(mode) {
    saveInterviewMode(mode);
    set({ interviewMode: mode });
  },

  addStory(story) {
    const next: StoryBankItem = {
      ...story,
      id: uid("story"),
      createdAt: Date.now(),
    };
    const stories = [...get().storyBank, next];
    saveStoryBank(stories);
    set({ storyBank: stories });
  },

  updateStory(id, story) {
    const stories = get().storyBank.map((item) => (item.id === id ? { ...item, ...story } : item));
    saveStoryBank(stories);
    set({ storyBank: stories });
  },

  deleteStory(id) {
    const stories = get().storyBank.filter((item) => item.id !== id);
    saveStoryBank(stories);
    set({ storyBank: stories });
  },

  async generateCoachingTip() {
    if (get().streaming) return; // Drop if already busy
    const segments = get().segments;
    
    const answerId = uid("ans");
    set({
      streaming: true,
      answer: { id: answerId, createdAt: Date.now(), question: "Coaching Tip", persona: "Interview Coach", text: "", citations: [] },
    });
    
    try {
      for await (const event of engine.generateCoachingTip(segments)) {
        if (!get().streaming) break;
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
    } finally {
      set({ streaming: false });
    }
  },

  async suggest(isSpeculative = false) {
    const allSegments = get().segments;
    const segments = lastSuggestSegmentIndex >= 0
      ? allSegments.slice(lastSuggestSegmentIndex + 1)
      : allSegments.slice(-5);
    const lastQuestion = segments.map((s) => s.text.trim()).filter(Boolean).join(" ") || "Live Question";

    if (!isSpeculative) {
      if (get().isSpeculating) {
        console.log("[Speculative] Promoting background answer to foreground!");
        const isComplete = get().isSpeculationComplete;
        const ans = get().speculativeAnswer;

        set({
          isSpeculating: false,
          isSpeculationComplete: false,
          speculativeAnswer: null,
          answer: ans,
          streaming: !isComplete
        });

        if (ans) {
          if (isComplete && ans.text) {
            get().finalizeAnswer(ans, lastQuestion, segments);
            const nextTask = get().questionBuffer[0];
            if (nextTask) {
              set((s) => ({ questionBuffer: s.questionBuffer.slice(1) }));
              if (nextTask.kind === "suggest") void get().suggest();
            }
          } else {
            // Transfer speculative abort controller to active abort controller
            activeAbortController = speculativeAbortController;
            speculativeAbortController = null;
          }
        }
        return;
      }

      if (get().streaming) {
        set((s) => ({ questionBuffer: [...s.questionBuffer, { kind: "suggest" }] }));
        return;
      }
    }
    
    if (get().streaming && isSpeculative) return;

    const persona = get().manualPersona || (lastQuestion ? detectPersona(lastQuestion) : (get().detectedPersona ?? undefined));
    if (persona) set({ detectedPersona: persona });

    // Each suggestion must own its record. Reusing a recent ID let a new
    // auto-trigger overwrite a still-recent answer with its partial stream.
    const answerId = uid("ans");

    let abortController: AbortController | undefined;

    if (isSpeculative) {
      speculativeAbortController = new AbortController();
      abortController = speculativeAbortController;
      console.log("[Speculative] Starting background generation...");
      set({
        isSpeculating: true,
        speculativeAnswer: { id: answerId, createdAt: Date.now(), question: lastQuestion || undefined, persona, text: "", citations: [] },
      });
    } else {
      activeAbortController = new AbortController();
      abortController = activeAbortController;
      set({
        streaming: true,
        isSpeculating: false,
        isSpeculationComplete: false,
        speculativeAnswer: null,
        answer: { id: answerId, createdAt: Date.now(), question: lastQuestion || undefined, persona, text: "", citations: [] },
      });
    }

    try {
      for await (const event of engine.suggest(segments, abortController?.signal)) {
        const state = get();
        const isPromoted = isSpeculative && !state.isSpeculating;
        const targetKey = (isSpeculative && !isPromoted) ? "speculativeAnswer" : "answer";

        if (!isSpeculative && !state.streaming) break;
        if (isSpeculative && !state.isSpeculating && !state.streaming) break;
        
        const currentAns = state[targetKey];
        if (!currentAns) continue;

        if (event.type === "token") {
          set({ [targetKey]: { ...currentAns, text: currentAns.text + event.delta } });
        } else if (event.type === "swap") {
          set({ [targetKey]: { ...currentAns, text: "", provider: event.provider, model: event.model, swapped: true } });
        } else if (event.type === "start") {
          set({ [targetKey]: { ...currentAns, provider: event.provider, model: event.model } });
        } else if (event.type === "done") {
          set({ [targetKey]: { ...currentAns, latencyMs: event.latencyMs, firstTokenMs: event.firstTokenMs, isCached: (event as any).isCached } });
        } else if (event.type === "error" && !abortController?.signal.aborted) {
          set({ [targetKey]: { ...currentAns, error: event.message } });
        }
      }
      
      if (isSpeculative && get().isSpeculating) {
        set({ isSpeculationComplete: true });
        return; // Finished speculatively but never promoted
      }

      const final = get().answer;
      if (final?.text && !abortController?.signal.aborted) {
        get().finalizeAnswer(final, lastQuestion, segments);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") console.error(e);
      else console.log("[Suggest] Stream aborted.");
    } finally {
      if (isSpeculative && get().isSpeculating) {
        // Do not clear isSpeculating here, it was handled by isSpeculationComplete
      } else {
        set({ streaming: false });
        const nextTask = get().questionBuffer[0];
        if (nextTask) {
          set((s) => ({ questionBuffer: s.questionBuffer.slice(1) }));
          if (nextTask.kind === "suggest") void get().suggest();
        }
      }
    }
  },

  clearScreen() {
    lastSuggestSegmentIndex = -1;
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
    if (smartWaitTimer) {
      clearTimeout(smartWaitTimer);
      smartWaitTimer = null;
    }
    if (suggestDebounceTimer) {
      clearTimeout(suggestDebounceTimer);
      suggestDebounceTimer = null;
    }
    lastSuggestSegmentIndex = -1;
    set({
      answer: null,
      answersList: [],
      history: [],
      attachments: [],
      conversationId: uid("conv"),
      followUps: [],
      questionBuffer: [],
      detectedPersona: null,
      isSmartWaiting: false,
      smartWaitConfidence: null,
    });
  },

  stopGeneration(currentDisplayed?: string) {
    if (smartWaitTimer) {
      clearTimeout(smartWaitTimer);
      smartWaitTimer = null;
    }
    if (suggestDebounceTimer) {
      clearTimeout(suggestDebounceTimer);
      suggestDebounceTimer = null;
    }
    
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    set((state) => {
      const updates: any = { streaming: false, questionBuffer: [], isSmartWaiting: false, smartWaitConfidence: null };
      if (currentDisplayed !== undefined && state.answer) {
        updates.answer = { ...state.answer, text: currentDisplayed };
      }
      return updates;
    });
  },

  cancelSmartWait() {
    if (smartWaitTimer) {
      clearTimeout(smartWaitTimer);
      smartWaitTimer = null;
    }
    if (suggestDebounceTimer) {
      clearTimeout(suggestDebounceTimer);
      suggestDebounceTimer = null;
    }
    set({ isSmartWaiting: false, smartWaitConfidence: null });
    console.log("[SmartWait] Wait canceled by user (Hold).");
  },

  sendNow() {
    if (smartWaitTimer) {
      clearTimeout(smartWaitTimer);
      smartWaitTimer = null;
    }
    if (suggestDebounceTimer) {
      clearTimeout(suggestDebounceTimer);
      suggestDebounceTimer = null;
    }
    set({ isSmartWaiting: false, smartWaitConfidence: null });
    void get().suggest();
  },

  finalizeAnswer(final: Answer) {
    const verifiedSpec = verifyAzureSpecs(final.text);
    const verifiedAnswer = { ...final, verifiedSpec };
    set((s) => ({
      answersList: [...s.answersList.filter((a) => a.id !== final.id), verifiedAnswer],
    }));

    void bridge.saveMessage({
      id: final.id,
      conversationId: get().conversationId,
      role: "assistant",
      content: final.text,
      attachments: JSON.stringify([]),
      citations: JSON.stringify(final.citations),
      provider: final.provider ?? null,
      model: final.model ?? null,
      latencyMs: final.latencyMs != null ? Math.round(final.latencyMs) : null,
      firstTokenMs: final.firstTokenMs != null ? Math.round(final.firstTokenMs) : null,
      createdAt: Date.now(),
    }).catch(console.error);

    // Disabled to save credits as per Option A
    // void get().analyzeInterviewTurn(lastQuestion, final.text, segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n"));
  }
}));
