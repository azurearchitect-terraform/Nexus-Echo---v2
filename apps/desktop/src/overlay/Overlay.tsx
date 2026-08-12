import { useEffect, useRef, useState } from "react";
import { useTypewriter } from "@/hooks/useTypewriter";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Camera,
  Check,
  Command,
  Copy,
  Ear,
  Eraser,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Paperclip,
  Send,
  Sparkles,
  Square,
  Sun,
  X,
  Zap,
  Briefcase,
  ShieldCheck,
  Building2,
  Trash2,
  HelpCircle,
  Clock,
  ShieldAlert,
  Lightbulb,
} from "lucide-react";

function isTrapQuestion(text?: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /mistake|failure|conflict|leaving|left|scope creep|delay|weakness|disagree|argument|violation|over budget|failed|challenge/.test(lower);
}

function AnswerPacingTimer() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toString().padStart(2, "0");
  const timeStr = `${mins}:${secs}`;

  let colorClass = "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  let label = "Pace: Great";
  if (elapsed >= 30 && elapsed < 60) {
    colorClass = "text-amber-400 border-amber-500/30 bg-amber-500/10";
    label = "Pace: Ideal Window";
  } else if (elapsed >= 60) {
    colorClass = "text-rose-400 border-rose-500/30 bg-rose-500/10 animate-pulse";
    label = "Pace: Wrap Up Soon";
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono ${colorClass}`} title="Target spoken duration: 45-75 seconds">
      <Clock className="h-3 w-3" />
      <span>{label} ({timeStr})</span>
    </span>
  );
}
import type { RoutingMode } from "@nexus/core";
import { useStore } from "@/lib/store";
import { bridge } from "@/lib/bridge";
import { Markdown } from "@/components/Markdown";
import { StatusDot } from "@/components/StatusDot";
import { Waveform } from "@/components/Waveform";
import { Transcript } from "@/components/Transcript";
import { cn } from "@/lib/cn";
import { uid, formatMs, looksLikeQuestion, type TranscriptSegment } from "@nexus/core";

/**
 * Overlay layout rationale
 * ------------------------
 * Everything is arranged around a single constraint: the user gets roughly two
 * seconds of glance time before the silence in the room becomes noticeable.
 *
 * - The answer occupies the largest region and sits at a fixed position, so the
 *   eye always lands in the same place instead of hunting.
 * - Controls are pushed to the edges and dimmed to 40% opacity. They are muscle
 *   memory via hotkeys; visually they must not compete with the answer.
 * - Nothing animates on arrival except a 160ms fade-up. Motion in peripheral
 *   vision is what makes a viewer's eye jump to a screen-shared window.
 * - The header is the only drag region, so grabbing the panel never selects text.
 */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={cn("flex items-center gap-1.5 rounded bg-white/5 px-2 py-1 text-[10px] text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors", className)}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Overlay() {
  const {
    ready,
    mode,
    setMode,
    streaming,
    answer,
    answersList,
    endInterviewQuestions,
    isGeneratingEndQuestions,
    latestCompanyIntel,
    coachInsight,
    nextQuestions,
    ask,
    listening,
    startListening,
    stopListening,
    segments,
    speakingMic,
    speakingSystem,
    pushSegment,
    setSpeaking,
    suggest,
    followUps,
    settings,
    saveSettings,
    attachments,
    addAttachment,
    clearAttachments,
    reset,
  } = useStore();

  const [input, setInput] = useState("");
  const [useScreen, setUseScreen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveQuestion, setLiveQuestion] = useState<string | null>(null);
  const [endQnATab, setEndQnATab] = useState<"Technical" | "HR">("Technical");
  const [answerFontSize, setAnswerFontSize] = useState<number>(14);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startResize = (edge: "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest") => {
    try {
      void (getCurrentWindow() as any).startResizing(edge);
    } catch (e) {
      console.error("failed to start resizing", e);
    }
  };

  // Smooth character-drip typewriter for the live streaming answer.
  // Architecture: rAF loop drains pending chars at 3 chars/frame — no setTimeout jitter.
  const typedText = useTypewriter(answer?.text ?? "", streaming, 3);

  // ---- hotkeys from the Rust side -------------------------------------------
  useEffect(() => {
    const unlisten = listen<string>("nexus://hotkey", async (event) => {
      switch (event.payload) {
        case "ask":
          setMode("ask");
          inputRef.current?.focus();
          break;
        case "listen":
          if (listening) await stopListening();
          else await startListening();
          break;
        case "capture":
          setUseScreen(true);
          inputRef.current?.focus();
          break;
        case "suggest":
          await suggest();
          break;
        default:
          break;
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [listening, setMode, startListening, stopListening, suggest]);

  // ---- Auto-start listening when entering Listen mode -----------------------
  useEffect(() => {
    if (mode === "listen" && !listening && ready) {
      void startListening();
    }
  }, [mode, listening, ready, startListening]);

  // ---- Auto-expand window height when answer arrives/streams -----------------
  useEffect(() => {
    if (streaming || answer?.text || answersList.length > 0) {
      void bridge.resizeOverlay(740);
    } else {
      void bridge.resizeOverlay(320);
    }
  }, [streaming, answer?.text, answersList.length]);

  // ---- VAD indicator ---------------------------------------------------------
  useEffect(() => {
    const unlisten = listen<{ source: "microphone" | "system"; speaking: boolean }>(
      "nexus://vad",
      (event) => setSpeaking(event.payload.source, event.payload.speaking),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [setSpeaking]);

  // ---- finished utterances -> transcription ---------------------------------
  useEffect(() => {
    const unlisten = listen<{
      source: "microphone" | "system";
      startMs: number;
      endMs: number;
      wavBase64: string;
    }>("nexus://utterance", async (event) => {
      const { source, startMs, endMs, wavBase64 } = event.payload;
      // Filter out short notification chimes/pings (< 600ms)
      if (endMs - startMs < 600) return;

      const rawText = await transcribe(wavBase64, settings.audio.language);
      const text = rawText.trim();
      if (!text) return;

      // Filter out non-speech notification noise artifacts generated by STT
      const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
      const noisePatterns = [
        "ding", "chime", "bell", "ping", "beep", "music", "noise",
        "u y", "u", "y", "th", "shh", "ah", "oh"
      ];
      if (
        text.startsWith("[") && text.endsWith("]") ||
        text.startsWith("(") && text.endsWith(")") ||
        noisePatterns.includes(lower) ||
        lower.length < 3
      ) {
        return;
      }

      // Flash the question immediately — before AI starts thinking.
      // This gives the user instant visual confirmation of what was heard.
      setLiveQuestion(text);
      setTimeout(() => setLiveQuestion(null), 8000);

      const segment: TranscriptSegment = {
        id: uid("seg"),
        meetingId: useStore.getState().meetingId ?? "",
        speaker: source === "microphone" ? "You" : "Speaker",
        text,
        startMs,
        endMs,
        source: source === "microphone" ? "microphone" : "system",
        isFinal: true,
      };
      pushSegment(segment);    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [pushSegment, settings.audio.language]);

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt) return;
    setInput("");
    await ask(prompt, useScreen);
    setUseScreen(false);
  };

  const attachScreenshot = async () => {
    const shot = await bridge.captureScreen();
    addAttachment({ id: uid("shot"), kind: "screenshot", path: shot.dataUrl, mimeType: "image/png" });
  };

  const copyAnswer = async () => {
    if (!answer?.text) return;
    await navigator.clipboard.writeText(answer.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showEndQuestions = endInterviewQuestions && endInterviewQuestions.length > 0;

  useEffect(() => {
    if (showEndQuestions) {
      bridge.resizeOverlay(850).catch(console.error);
    }
  }, [showEndQuestions]);
  
  const normalizedTechQuestions = [
    ...(latestCompanyIntel?.questions?.map(q => ({ 
      question: q.question, 
      context: q.context, 
      tip: q.suggestedPoints?.join(' • '), 
      expectedAnswer: q.expectedAnswer,
      professionalExample: q.professionalExample,
      source: 'Prep' 
    })) || []),
    ...(endInterviewQuestions?.filter(q => q.category === 'Technical').map(q => ({ 
      question: q.question, 
      context: q.context, 
      tip: q.followUpNote, 
      expectedAnswer: q.expectedAnswer,
      professionalExample: q.professionalExample,
      source: 'Live' 
    })) || [])
  ];

  const normalizedHrQuestions = [
    ...(latestCompanyIntel?.hrQuestions?.map(q => ({ 
      question: q.question, 
      context: q.context, 
      tip: q.suggestedPoints?.join(' • '), 
      expectedAnswer: q.expectedAnswer,
      professionalExample: q.professionalExample,
      source: 'Prep' 
    })) || []),
    ...(endInterviewQuestions?.filter(q => q.category === 'HR').map(q => ({ 
      question: q.question, 
      context: q.context, 
      tip: q.followUpNote, 
      expectedAnswer: q.expectedAnswer,
      professionalExample: q.professionalExample,
      source: 'Live' 
    })) || [])
  ];

  return (
    <div className="flex h-screen flex-col p-2">
      {!ready && (
        <div className="absolute left-3 top-3 z-50 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/40 backdrop-blur">
          Starting...
        </div>
      )}
      <section className="panel relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          onMouseDown={() => startResize("North")}
          className="no-drag absolute left-3 right-3 top-0 z-30 h-5 cursor-n-resize"
          title="Drag the top edge to resize"
        >
          <div className="mx-auto mt-1.5 h-1.5 w-28 rounded-full bg-white/25" />
        </div>
        <div
          onMouseDown={() => startResize("West")}
          className="no-drag absolute bottom-3 left-0 top-3 z-30 w-5 cursor-w-resize"
          title="Drag the left edge to resize"
        />
        <div
          onMouseDown={() => startResize("East")}
          className="no-drag absolute bottom-3 right-0 top-3 z-30 w-5 cursor-e-resize"
          title="Drag the right edge to resize"
        />
        {/* ---------- header: the only drag surface ---------- */}
        <header className="drag-region flex shrink-0 items-center gap-3 border-b border-glass-edge px-3 py-2">
          <div className="flex items-center gap-1 rounded-lg bg-black/30 p-0.5 no-drag">
            <ModeTab
              icon={<MessageSquare className="h-3 w-3" />}
              label="Ask"
              active={mode === "ask"}
              onClick={() => setMode("ask")}
            />
            <ModeTab
              icon={<Ear className="h-3 w-3" />}
              label="Listen"
              active={mode === "listen"}
              onClick={() => setMode("listen")}
            />
            <ModeTab
              icon={<Briefcase className="h-3 w-3" />}
              label="Intel"
              active={mode === "intel"}
              onClick={() => setMode("intel")}
            />
          </div>

          <div className="flex flex-1 items-center gap-2.5">
            <select
              value={settings.routing.mode}
              onChange={(e) =>
                void saveSettings({
                  ...settings,
                  routing: { ...settings.routing, mode: e.target.value as RoutingMode },
                })
              }
              className="no-drag rounded-md border border-white/20 bg-neutral-900/90 px-2 py-0.5 font-mono text-[10px] text-white shadow-sm hover:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer [color-scheme:dark]"
              title="Change Speed Mode directly from main screen"
            >
              <option value="hybrid-race" className="bg-neutral-900 text-white font-mono text-[11px] py-1">⚡ Hybrid Race</option>
              <option value="hybrid-tier" className="bg-neutral-900 text-white font-mono text-[11px] py-1">🎯 Hybrid Tier</option>
              <option value="single" className="bg-neutral-900 text-white font-mono text-[11px] py-1">👤 Single Provider</option>
              <option value="offline" className="bg-neutral-900 text-white font-mono text-[11px] py-1">🔒 Offline (Ollama)</option>
            </select>

            <div className="flex items-center gap-1.5 border-l border-white/10 pl-2 no-drag">
              <button
                onClick={async () => {
                  const newSettings = { ...settings, audio: { ...settings.audio, captureMicrophone: !settings.audio.captureMicrophone } };
                  await saveSettings(newSettings);
                  if (listening) {
                    await stopListening();
                    await startListening();
                  }
                }}
                className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors ${
                  settings.audio.captureMicrophone ? "bg-accent/20 text-accent hover:bg-accent/30" : "bg-neutral-800 text-white/40 hover:bg-neutral-700"
                }`}
                title="Toggle Microphone (Your Voice)"
              >
                {settings.audio.captureMicrophone ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
                {listening && settings.audio.captureMicrophone && <Waveform active={speakingMic} tone="mic" />}
              </button>

              <button
                onClick={async () => {
                  const newSettings = { ...settings, audio: { ...settings.audio, captureSystemAudio: !settings.audio.captureSystemAudio } };
                  await saveSettings(newSettings);
                  if (listening) {
                    await stopListening();
                    await startListening();
                  }
                }}
                className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors ${
                  settings.audio.captureSystemAudio ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-neutral-800 text-white/40 hover:bg-neutral-700"
                }`}
                title="Toggle System Audio (Meeting Audio)"
              >
                {settings.audio.captureSystemAudio ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                {listening && settings.audio.captureSystemAudio && <Waveform active={speakingSystem} tone="system" />}
              </button>
            </div>

            <div className="flex items-center gap-1 border-l border-white/10 pl-2 no-drag" title="UI Accent Color">
              <input
                type="color"
                value={settings.accentColor || "#6ee7b7"}
                onChange={(e) => void saveSettings({ ...settings, accentColor: e.target.value })}
                className="h-4 w-4 cursor-pointer rounded-full bg-transparent p-0 border-0 overflow-hidden"
                style={{ WebkitAppearance: 'none' }}
              />
            </div>

            {answer?.firstTokenMs ? (
              <span className="font-mono text-[10px] text-white/30 ml-auto" title="Time to first token">
                <Zap className="mr-0.5 inline h-2.5 w-2.5" />
                {formatMs(answer.firstTokenMs)}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-0.5 no-drag">
            <button
              className="btn-ghost"
              onClick={() => setAnswerFontSize(Math.max(10, answerFontSize - 2))}
              title="Decrease text size"
            >
              <span className="text-[12px] font-bold">A-</span>
            </button>
            <button
              className="btn-ghost"
              onClick={() => setAnswerFontSize(Math.min(24, answerFontSize + 2))}
              title="Increase text size"
            >
              <span className="text-[14px] font-bold">A+</span>
            </button>
            <button
              className="btn-ghost"
              onClick={() => useStore.getState().clearScreen()}
              title="Clear screen (keep history)"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
            <button className="btn-ghost" onClick={() => setCollapsed((c) => !c)} title="Collapse">
              {collapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
            <button className="btn-ghost" onClick={() => void bridge.openDashboard()} title="Dashboard">
              <LayoutDashboard className="h-3.5 w-3.5" />
            </button>
            <button className="btn-ghost" onClick={() => void bridge.panicHide()} title="Hide (⌘⇧\)">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {!collapsed && (
          <>
            {/* ---------- body ---------- */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">

              {/* Live End-of-Interview Candidate Questions Banner */}
              {showEndQuestions && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-4 animate-fadeIn no-drag">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-white">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-[12px] font-bold uppercase tracking-wide font-mono">End-of-Interview Questions (To Ask Them)</span>
                    </div>
                    <button
                      onClick={() => useStore.setState({ endInterviewQuestions: [] })}
                      className="text-[10px] text-amber-400/60 hover:text-amber-400 font-mono"
                    >
                      Dismiss
                    </button>
                  </div>
                  
                  <p className="text-[11.5px] text-amber-400/80 leading-normal">
                    Combined strategic prep questions and live tailored questions from the conversation.
                  </p>

                  {/* Tabs */}
                  <div className="flex space-x-2 border-b border-amber-500/20 pb-2">
                    <button
                      onClick={() => setEndQnATab("Technical")}
                      className={`px-3 py-1 text-[11px] font-mono rounded transition-colors ${
                        endQnATab === "Technical" 
                          ? "bg-amber-500/20 text-white font-bold border border-amber-500/30" 
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      Technical Role
                    </button>
                    <button
                      onClick={() => setEndQnATab("HR")}
                      className={`px-3 py-1 text-[11px] font-mono rounded transition-colors ${
                        endQnATab === "HR" 
                          ? "bg-amber-500/20 text-white font-bold border border-amber-500/30" 
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      HR & Culture
                    </button>
                  </div>

                  {/* Technical Section */}
                  {endQnATab === "Technical" && normalizedTechQuestions.length > 0 && (
                    <div className="space-y-2.5">
                      {normalizedTechQuestions.map((q, idx) => (
                        <div key={`tech-${idx}`} className="rounded-lg border border-amber-500/20 bg-black/50 p-3 space-y-1.5 relative overflow-hidden animate-fadeIn">
                          {q.source === 'Prep' && (
                            <div className="absolute top-0 right-0 bg-amber-500/20 text-amber-500 px-1.5 py-0.5 text-[8px] font-mono rounded-bl">PREP</div>
                          )}
                          <div className="flex items-start gap-2">
                            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-400 font-mono">
                              {idx + 1}
                            </span>
                            <p className="text-[12.5px] font-semibold text-white/95 leading-normal pr-6">{q.question}</p>
                          </div>
                          <div className="pl-6 space-y-1">
                            <p className="text-[11px] text-amber-500/70 italic">{q.context}</p>
                            {q.tip && (
                              <div className="rounded bg-white/[0.03] p-1.5 text-[10.5px] text-white/60 font-mono">
                                💡 Tip: {q.tip}
                              </div>
                            )}
                            {q.expectedAnswer && (
                              <div className="rounded bg-emerald-500/10 border border-emerald-500/20 p-2 space-y-1 mt-1">
                                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Expected Answer</div>
                                <p className="text-[11px] text-emerald-300/90 leading-snug">{q.expectedAnswer}</p>
                              </div>
                            )}
                            {q.professionalExample && (
                              <div className="rounded bg-blue-500/10 border border-blue-500/20 p-2 space-y-1 mt-1">
                                <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">Professional Example</div>
                                <p className="text-[11px] text-blue-300/90 leading-snug">{q.professionalExample}</p>
                              </div>
                            )}
                          </div>
                          <div className="pl-6 pt-1 flex items-center gap-2">
                            <button
                              onClick={() => void navigator.clipboard.writeText(q.question)}
                              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/40 hover:text-white transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {endQnATab === "Technical" && normalizedTechQuestions.length === 0 && (
                    <div className="py-4 text-center text-amber-500/50 text-[11px] font-mono italic">
                      No technical questions generated yet.
                    </div>
                  )}

                  {/* HR Section */}
                  {endQnATab === "HR" && normalizedHrQuestions.length > 0 && (
                    <div className="space-y-2.5">
                      {normalizedHrQuestions.map((q, idx) => (
                        <div key={`hr-${idx}`} className="rounded-lg border border-amber-500/20 bg-black/50 p-3 space-y-1.5 relative overflow-hidden animate-fadeIn">
                          {q.source === 'Prep' && (
                            <div className="absolute top-0 right-0 bg-amber-500/20 text-amber-500 px-1.5 py-0.5 text-[8px] font-mono rounded-bl">PREP</div>
                          )}
                          <div className="flex items-start gap-2">
                            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-400 font-mono">
                              {idx + 1}
                            </span>
                            <p className="text-[12.5px] font-semibold text-white/95 leading-normal pr-6">{q.question}</p>
                          </div>
                          <div className="pl-6 space-y-1">
                            <p className="text-[11px] text-amber-500/70 italic">{q.context}</p>
                            {q.tip && (
                              <div className="rounded bg-white/[0.03] p-1.5 text-[10.5px] text-white/60 font-mono">
                                💡 Tip: {q.tip}
                              </div>
                            )}
                            {q.expectedAnswer && (
                              <div className="rounded bg-emerald-500/10 border border-emerald-500/20 p-2 space-y-1 mt-1">
                                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Expected Answer</div>
                                <p className="text-[11px] text-emerald-300/90 leading-snug">{q.expectedAnswer}</p>
                              </div>
                            )}
                            {q.professionalExample && (
                              <div className="rounded bg-blue-500/10 border border-blue-500/20 p-2 space-y-1 mt-1">
                                <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">Professional Example</div>
                                <p className="text-[11px] text-blue-300/90 leading-snug">{q.professionalExample}</p>
                              </div>
                            )}
                          </div>
                          <div className="pl-6 pt-1 flex items-center gap-2">
                            <button
                              onClick={() => void navigator.clipboard.writeText(q.question)}
                              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/40 hover:text-white transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {endQnATab === "HR" && normalizedHrQuestions.length === 0 && (
                    <div className="py-4 text-center text-amber-500/50 text-[11px] font-mono italic">
                      No HR questions generated yet.
                    </div>
                  )}
                </div>
              )}

              {/* Live capture banner: "Hearing…" while speaker is active, question flash after STT */}
              {(speakingSystem || speakingMic || liveQuestion) && mode === "listen" && (
                <div className="animate-fade-up mb-3 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2.5">
                  {liveQuestion ? (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] text-accent/70 uppercase tracking-widest">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                        Captured — processing…
                      </div>
                      <p className="text-[14px] font-medium text-accent leading-snug">{liveQuestion}</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <span className="h-2 w-2 rounded-full bg-accent animate-pulse shrink-0" />
                      <div className="flex-1">
                        <span className="font-mono text-[10px] text-accent/80 uppercase tracking-widest">
                          {speakingSystem ? "Speaker" : "You"} is speaking…
                        </span>
                        <div className="mt-1 flex items-end gap-[2px] h-4">
                          {[3,5,7,4,6,8,3,5,4,7,5,3,6,4,7].map((h, i) => (
                            <span
                              key={i}
                              className="rounded-sm bg-accent/50 w-[3px]"
                              style={{
                                height: `${h}px`,
                                animation: `pulseSoft ${0.4 + (i % 4) * 0.15}s ease-in-out infinite`,
                                animationDelay: `${i * 40}ms`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {mode === "ask" ? (
                answersList.length > 0 || answer ? (
                  <div className="space-y-4 flex flex-col">
                    {answer && !answersList.some((a) => a.id === answer.id) && (
                      <div className="animate-fade-up border-b border-accent/20 pb-4 mb-2">
                        {answersList.length > 0 && (
                          <div className="mb-3 flex items-center justify-center gap-2 font-mono text-[9px] text-accent">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                            <span>STREAMING ANSWER</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                          </div>
                        )}

                        {answer.question && (
                          <div className="mb-2 flex items-start justify-between text-[14px] font-medium text-white/80">
                            <span className="font-mono text-accent">Q: {answer.question}</span>
                            <div className="flex items-center gap-1.5 ml-2 shrink-0">
                              <AnswerPacingTimer />
                              {answer.persona && (
                                <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">
                                  {answer.persona}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Trap Question Guardrail Banner */}
                        {isTrapQuestion(answer.question) && (
                          <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11.5px] text-emerald-300 animate-fadeIn">
                            <ShieldAlert className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span><strong>Trap Question Guardrail:</strong> Lead with resolution, SLAs, governance & lessons learned. Do not criticize past teams.</span>
                          </div>
                        )}

                        {answer.error ? (
                          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                            {answer.error}
                          </p>
                        ) : (
                          <div className="relative group">
                            <div style={{ fontSize: `${answerFontSize}px` }}>
                              <Markdown>{answer?.text || "…"}</Markdown>
                              {streaming && (
                                <span
                                  className="inline-block h-4 w-[2px] rounded-sm bg-accent align-middle ml-0.5 animate-[typewriterBlink_0.6s_ease-in-out_infinite]"
                                />
                              )}
                            </div>
                            {!streaming && answer?.text && (
                              <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <CopyButton text={answer.text} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {[...answersList].reverse().map((item, idx) => (
                      <div key={item.id} className="animate-fade-up pb-4 border-b border-white/5 last:border-0">
                        {item.question && (
                          <div className="mb-2 flex items-start justify-between text-[14px] font-medium text-white/80">
                            <span className="font-mono text-accent">Q: {item.question}</span>
                            {item.persona && (
                              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40 ml-2 shrink-0">
                                {item.persona}
                              </span>
                            )}
                          </div>
                        )}

                        {item.error ? (
                          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                            {item.error}
                          </p>
                        ) : (
                          <div className="opacity-80 relative group">
                            <div style={{ fontSize: `${answerFontSize}px` }}>
                              <Markdown>{item.text || "…"}</Markdown>
                            </div>
                            <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <CopyButton text={item.text} />
                            </div>
                          </div>
                        )}

                        {item.citations && item.citations.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.citations.map((c) => (
                              <span
                                key={c.docId}
                                className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40"
                              >
                                {c.title}
                              </span>
                            ))}
                          </div>
                        )}

                        {item.verifiedSpec?.isVerified && (
                          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-400 w-fit">
                            <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                            <span>✓ Verified Azure Spec: {item.verifiedSpec.terms.join(" · ")}</span>
                          </div>
                        )}

                        {item.provider && (
                          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-white/25 no-drag">
                            <span>
                              {item.provider} · {item.model}
                              {item.swapped && " · refined"}
                              {item.latencyMs ? ` · ${formatMs(item.latencyMs)}` : ""}
                            </span>
                            <button
                              onClick={() => void navigator.clipboard.writeText(item.text)}
                              className="flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
                              title="Copy answer to clipboard"
                            >
                              <Copy className="h-2.5 w-2.5" />
                              Copy
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState mode={mode} />
                )
              ) : mode === "listen" ? (
                <div className="flex flex-col gap-0 h-full overflow-y-auto pr-1">
                  <Transcript segments={segments} />

                  {/* Appended Q&A Feed (Newest Question on Top) */}
                  {(() => {
                    const activeAnswerList = [
                      ...answersList.filter((a) => a.id !== answer?.id),
                      ...(answer && (answer.text || streaming) ? [answer] : []),
                    ].reverse();

                    if (activeAnswerList.length === 0) return null;

                    return (
                      <div className="mt-3 pt-2 border-t border-white/10 space-y-4">
                        {activeAnswerList.map((item, idx) => {
                          const isCurrentStreaming = streaming && item.id === answer?.id;
                          return (
                            <div key={item.id} className="animate-fade-up">
                              {/* Question Label */}
                              <div className="mb-1.5 flex items-start gap-1.5 font-semibold text-accent text-[13px]">
                                <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-accent" />
                                <span>Q: {item.question || "Live Question"}</span>
                              </div>

                              {/* Answer Text */}
                              <div className="text-[12.5px] leading-relaxed text-white/90">
                                <Markdown>{item.text || "…"}</Markdown>
                                {isCurrentStreaming && (
                                  <span className="inline-block h-4 w-[2px] rounded-sm bg-accent align-middle ml-0.5 animate-[typewriterBlink_0.6s_ease-in-out_infinite]" />
                                )}
                              </div>

                              {item.verifiedSpec?.isVerified && (
                                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-400 w-fit">
                                  <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                                  <span>✓ Verified Azure Spec: {item.verifiedSpec.terms.join(" · ")}</span>
                                </div>
                              )}

                              {/* End of Answer Divider Marker */}
                              <div className="my-3 flex items-center gap-2 text-white/20 select-none">
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                                <span className="text-[9px] font-mono uppercase tracking-widest text-white/35">End of Answer</span>
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              ) : mode === "intel" ? (
                <CompanyIntelHUD />
              ) : (
                <EmptyState mode={mode} />
              )}

              {(coachInsight || nextQuestions.length > 0) && (
                <div className="mx-3 mb-3 rounded-xl border border-accent/20 bg-accent/[0.05] p-3.5 no-drag">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-accent">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Interview coach</span>
                    </div>
                    {coachInsight && (
                      <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        Score {coachInsight.overallScore}/100
                      </span>
                    )}
                  </div>

                  {coachInsight && (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-white/80">
                      {coachInsight.coachingTip || coachInsight.summary}
                    </p>
                  )}

                  {coachInsight?.storyMatchHint && (
                    <p className="mt-1.5 text-[11.5px] text-white/45">
                      Best story match: <span className="text-accent">{coachInsight.storyMatchHint}</span>
                    </p>
                  )}

                  {nextQuestions.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {nextQuestions.slice(0, 2).map((item) => (
                        <div key={`${item.question}-${item.priority}`} className="flex items-start gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                          <div>
                            <p className="text-[12px] text-white/85">{item.question}</p>
                            {item.reason && <p className="text-[11px] text-white/35">{item.reason}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ---------- footer ---------- */}
            <footer className="shrink-0 border-t border-glass-edge px-2 py-2">
              {mode === "ask" ? (
                <div className="flex items-end gap-1.5">
                  <button
                    className={cn("btn-ghost", useScreen && "bg-accent/15 text-accent")}
                    onClick={() => setUseScreen((v) => !v)}
                    title="Attach a fresh screenshot to this message"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                  <button className="btn-ghost" onClick={() => void attachScreenshot()} title="Capture now">
                    <Paperclip className="h-4 w-4" />
                  </button>

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={() => void bridge.focusOverlay()}
                    onClick={() => void bridge.focusOverlay()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void submit();
                      }
                      if (e.key === "Escape") void bridge.panicHide();
                    }}
                    rows={1}
                    placeholder="Ask anything…"
                    className="max-h-24 min-h-[34px] flex-1 resize-none rounded-lg border border-white/10 bg-black/30
                               px-2.5 py-2 text-[13px] text-white placeholder:text-white/25
                               focus:border-accent/40 focus:outline-none"
                  />

                  <button
                    className="btn-ghost text-accent disabled:opacity-30"
                    onClick={() => void submit()}
                    disabled={streaming || !input.trim()}
                  >
                    {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 no-drag font-mono text-[10px]">
                  {(() => {
                    const geminiProv = settings.providers.find((p) => p.id === "gemini" && p.enabled);
                    const openaiProv = settings.providers.find((p) => p.id === "openai" && p.enabled);
                    const hasGeminiKey = Boolean(geminiProv?.keyRef);
                    const hasOpenAIKey = Boolean(openaiProv?.keyRef);
                    const sttLabel = hasGeminiKey ? "STT: Gemini 3.6 Flash" : hasOpenAIKey ? "STT: Whisper" : "STT: No Key";
                    return (
                      <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                        <span
                          onClick={() => void bridge.openDashboard()}
                          className={cn(
                            "flex items-center gap-1 rounded border px-1.5 py-0.5 cursor-pointer transition-colors",
                            hasGeminiKey
                              ? "border-accent/30 bg-accent/10 text-accent"
                              : "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"
                          )}
                          title={hasGeminiKey ? "Gemini API Key Active" : "Gemini API key missing. Click to open Settings."}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", hasGeminiKey ? "bg-accent" : "bg-warn animate-pulse")} />
                          Gemini
                        </span>

                        <span
                          onClick={() => void bridge.openDashboard()}
                          className={cn(
                            "flex items-center gap-1 rounded border px-1.5 py-0.5 cursor-pointer transition-colors",
                            hasOpenAIKey
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                              : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10"
                          )}
                          title={hasOpenAIKey ? "OpenAI API Key Active" : "OpenAI API key optional. Click to open Settings."}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", hasOpenAIKey ? "bg-emerald-400" : "bg-white/30")} />
                          OpenAI
                        </span>

                        <span
                          onClick={() => void bridge.openDashboard()}
                          className={cn(
                            "flex items-center gap-1 rounded border px-1.5 py-0.5 cursor-pointer transition-colors",
                            hasGeminiKey || hasOpenAIKey
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                              : "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"
                          )}
                          title={hasGeminiKey || hasOpenAIKey ? `Active Speech Engine: ${sttLabel}` : "No STT key configured. Click to open Settings."}
                        >
                          <Mic className={cn("h-2.5 w-2.5", hasGeminiKey || hasOpenAIKey ? "text-emerald-400" : "text-warn")} />
                          {sttLabel}
                        </span>

                        <span
                          className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/40"
                          title="Local Voice Activity Detection runs 100% free on-device. Zero API cost while idle."
                        >
                          ⚡ Local VAD · $0.00
                        </span>
                      </div>
                    );
                  })()}

                  <span className="ml-auto flex items-center gap-1 text-[10px] text-white/25 shrink-0">
                    <Command className="h-2.5 w-2.5" />
                    <span className="kbd">⌘⇧↵</span>
                  </span>
                </div>
              )}

              {attachments.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-white/40">
                  {attachments.length} attached
                  <button onClick={clearAttachments} className="text-danger hover:underline">
                    clear
                  </button>
                </div>
              )}

              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 no-drag font-mono text-[10px] text-white/50 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sun className="h-3 w-3 text-amber-400 shrink-0" />
                  <span className="shrink-0 text-white/60">Opacity:</span>
                  <input
                    type="range"
                    min="0.30"
                    max="1.00"
                    step="0.05"
                    value={settings.stealth.opacity ?? 0.92}
                    onChange={(e) =>
                      void saveSettings({
                        ...settings,
                        stealth: { ...settings.stealth, opacity: parseFloat(e.target.value) },
                      })
                    }
                    className="h-1.5 w-20 cursor-pointer accent-accent bg-white/20 rounded-lg appearance-none"
                    title="Adjust window opacity (30% - 100%)"
                  />
                  <span className="w-6 text-right text-accent font-semibold">
                    {Math.round((settings.stealth.opacity ?? 0.92) * 100)}%
                  </span>
                </div>

                {/* Persona Selector & End Q&A Button Moved to Bottom Toolbar */}
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={useStore.getState().manualPersona || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      useStore.getState().setManualPersona(val || null);
                    }}
                    className="w-[110px] truncate rounded border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-purple-300 font-mono text-[10px] focus:outline-none cursor-pointer no-drag hover:bg-purple-500/25 transition-colors"
                    title="Interviewer Persona Mode: Auto-Detect or Manual Override"
                  >
                    <option value="" className="bg-neutral-900 text-purple-300">
                      ⚡ Auto-Detect
                    </option>
                    <option value="Executive / Director" className="bg-neutral-900 text-white">
                      🏢 Executive
                    </option>
                    <option value="Technical Architect" className="bg-neutral-900 text-white">
                      💻 Architect
                    </option>
                    <option value="Recruiter / HR" className="bg-neutral-900 text-white">
                      👥 Recruiter
                    </option>
                  </select>

                  <div className="flex items-center gap-1 border-l border-white/10 pl-2">
                    <span className="text-[9.5px] text-white/40 font-mono">Size:</span>
                    <button
                      onClick={() => void bridge.resizeOverlay(450)}
                      className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9.5px] text-white/70 hover:bg-white/15 hover:text-white transition-colors"
                      title="Resize to Compact Height (450px)"
                    >
                      450px
                    </button>
                    <button
                      onClick={() => void bridge.resizeOverlay(650)}
                      className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9.5px] text-white/70 hover:bg-white/15 hover:text-white transition-colors"
                      title="Resize to Standard Height (650px)"
                    >
                      650px
                    </button>
                    <button
                      onClick={() => void bridge.resizeOverlay(850)}
                      className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9.5px] text-white/70 hover:bg-white/15 hover:text-white transition-colors"
                      title="Resize to Tall Height (850px)"
                    >
                      850px
                    </button>
                  </div>

                  <button
                    className="flex items-center gap-1 rounded bg-accent/15 border border-accent/30 px-2 py-0.5 text-[10.5px] font-semibold text-accent hover:bg-accent/25 transition-colors no-drag"
                    onClick={() => void useStore.getState().generateCoachingTip()}
                    title="Get a quick actionable coaching tip based on the live interview"
                  >
                    <Lightbulb className="h-3 w-3" />
                    Coach Me
                  </button>

                  <button
                    className="flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400 hover:bg-amber-500/25 transition-colors no-drag disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => void useStore.getState().generateEndQuestions()}
                    disabled={isGeneratingEndQuestions}
                    title="Generate 4-5 impressive candidate questions based on the live interview transcript"
                  >
                    {isGeneratingEndQuestions ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <HelpCircle className="h-3 w-3" />
                    )}
                    End Q&amp;A
                  </button>

                  {/* Corner Drag Handle for Super Easy Window Resizing */}
                  <div
                    onMouseDown={() => {
                      try {
                        startResize("SouthEast");
                      } catch (e) {
                        console.error("failed to start resizing", e);
                      }
                    }}
                    className="no-drag cursor-nwse-resize p-1 text-accent hover:text-white transition-colors flex items-center justify-center font-bold text-[13px] rounded bg-accent/15 border border-accent/30 hover:bg-accent/30 ml-1"
                    title="Click & Drag Corner to Resize Window Easily"
                  >
                    ⇲
                  </div>
                </div>
              </div>

              {/* Bottom Edge Native Resize Bar */}
              <div
                onMouseDown={() => {
                  try {
                    startResize("South");
                  } catch (e) {
                    console.error("failed to start resizing", e);
                  }
                }}
                className="no-drag h-8 w-full cursor-s-resize border-t border-white/10 bg-white/[0.02] transition-colors flex items-center justify-center gap-2 rounded-b-xl opacity-80 hover:bg-accent/15 hover:opacity-100"
                title="Drag the bottom edge to resize height"
              >
                <div className="h-1.5 w-16 rounded-full bg-white/35" />
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">Resize</span>
              </div>
            </footer>
          </>
        )}
      </section>

      {answer && !streaming && (
        <div className="mx-auto mt-1 flex gap-3 text-[10px]">
          <button
            onClick={() => useStore.getState().clearScreen()}
            className="text-white/40 transition-colors hover:text-white"
            title="Clear active screen display but keep full question history"
          >
            clear screen (keep history)
          </button>
          <button
            onClick={reset}
            className="text-white/20 transition-colors hover:text-white/50"
            title="Start new conversation"
          >
            new conversation
          </button>
        </div>
      )}
    </div>
  );
}

function ModeTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ mode }: { mode: "ask" | "listen" }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘⇧" : "Ctrl+Shift+";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
      <p className="text-[12px] text-white/35">
        {mode === "ask"
          ? "Ask a question, or capture your screen."
          : "Start listening and Nexus will follow the room."}
      </p>
      <div className="flex gap-1.5 text-[10px] text-white/25">
        <span className="kbd">{mod}Space</span> toggle
        <span className="kbd">{mod}S</span> capture
        <span className="kbd">{mod}L</span> listen
      </div>
    </div>
  );
}

/**
 * Speech-to-text. Routed through whichever engine the user configured; the local
 * Whisper path keeps audio on-device, which matters more here than anywhere else
 * in the app, because meeting audio contains other people who never consented.
 */
async function transcribe(wavBase64: string, language: string): Promise<string> {
  const settings = useStore.getState().settings;
  const { bridge: b } = await import("@/lib/bridge");
  const sttEngine = settings.audio.sttEngine ?? "auto";

  const tryGemini = async (): Promise<string> => {
    const gemini = settings.providers.find((p) => p.id === "gemini" && p.enabled);
    if (!gemini?.keyRef) return "";
    const apiKey = await b.resolveProviderKey(gemini.keyRef).catch(() => null);
    if (!apiKey) return "";
    const candidateModels = Array.from(
      new Set([gemini.models?.fast || "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash"])
    );
    for (const model of candidateModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: "Transcribe the following spoken audio exactly as spoken. Output ONLY the verbatim transcript text with no commentary or preambles." },
                  { inlineData: { mimeType: "audio/wav", data: wavBase64 } },
                ],
              }],
            }),
          },
        );
        if (res.ok) {
          const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text?.trim()) return text.trim();
        }
      } catch { /* try next model */ }
    }
    return "";
  };

  const tryOpenAI = async (): Promise<string> => {
    const openai = settings.providers.find((p) => p.id === "openai" && p.enabled);
    if (!openai?.keyRef) return "";
    const apiKey = await b.resolveProviderKey(openai.keyRef).catch(() => null);
    if (!apiKey) return "";
    try {
      const binary = atob(wavBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "audio/wav" }), "chunk.wav");
      form.append("model", "whisper-1");
      if (language !== "auto") form.append("language", language);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (res.ok) {
        const json = (await res.json()) as { text?: string };
        if (json.text?.trim()) return json.text.trim();
      }
    } catch { /* fall through */ }
    return "";
  };

  const tryLocal = async (): Promise<string> => {
    try {
      const res = await fetch("http://127.0.0.1:8080/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: wavBase64, language }),
      });
      if (res.ok) {
        const json = (await res.json()) as { text?: string };
        if (json.text?.trim()) return json.text.trim();
      }
    } catch { /* fall through */ }
    return "";
  };

  // Route directly to the chosen engine, or cascade for "auto"
  if (sttEngine === "gemini") return tryGemini();
  if (sttEngine === "openai-whisper") return tryOpenAI();
  if (sttEngine === "local-whisper") return tryLocal();

  // auto: gemini → openai → local
  return (await tryGemini()) || (await tryOpenAI()) || (await tryLocal());
}

function CompanyIntelHUD() {
  const intel = useStore((s) => s.latestCompanyIntel);
  const ask = useStore((s) => s.ask);
  const [tab, setTab] = useState<"jd" | "ask">("jd");

  if (!intel) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-6 space-y-2">
        <Briefcase className="h-8 w-8 text-white/20" />
        <h4 className="text-[13px] font-semibold text-white/65">No Company Intel Loaded</h4>
        <p className="text-[11.5px] text-white/35 max-w-[240px] leading-normal">
          Go to the Dashboard &gt; Company Prep and investigate a company website to load strategic interview questions here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4 animate-fadeIn no-drag">
      {/* Company Name & Pitch */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
        <div className="flex items-center justify-between text-amber-500">
          <div className="flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold tracking-wider uppercase font-mono">Strategic Pitch ({intel.name})</span>
          </div>
          <button
            onClick={() => useStore.getState().setLatestCompanyIntel(null)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-danger/80 hover:bg-danger/20 hover:text-danger transition-colors"
            title="Clear this company profile"
          >
            <Trash2 className="h-3 w-3" />
            Clear Intel
          </button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-amber-500/80 italic font-serif">
          "{intel.goldenFormula}"
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/10 pb-2">
        <button
          onClick={() => setTab("jd")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === "jd" ? "bg-accent/20 text-accent" : "text-white/40 hover:text-white/70"
          }`}
        >
          Expected Questions (Based on JD)
        </button>
        <button
          onClick={() => setTab("ask")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === "ask" ? "bg-accent/20 text-accent" : "text-white/40 hover:text-white/70"
          }`}
        >
          Questions to Ask Interviewer
        </button>
      </div>

      {/* Questions list */}
      {tab === "jd" ? (
        <div className="space-y-2.5">
          {(!intel.jdInterviewQuestions || intel.jdInterviewQuestions.length === 0) ? (
            <p className="text-[12px] text-white/40 italic p-2">No specific JD interview questions generated yet. Re-run company prep with a JD pasted.</p>
          ) : (
            intel.jdInterviewQuestions.map((q, idx) => (
              <div key={idx} className="rounded-lg border border-accent/20 bg-accent/[0.02] p-3 space-y-2 hover:border-accent/40 transition-colors">
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-start gap-2">
                    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] font-semibold text-accent font-mono">
                      {idx + 1}
                    </span>
                    <h5 className="text-[12.5px] font-semibold text-white/95 leading-normal">{q.question}</h5>
                  </div>
                  <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-mono text-accent shrink-0">
                    {q.category}
                  </span>
                </div>
                
                <div className="pl-6.5 rounded bg-black/30 p-2 border border-white/5 space-y-0.5">
                  <span className="text-[9.5px] font-mono uppercase tracking-wider text-accent/70">Answer Key:</span>
                  <p className="text-[11.5px] text-white/75 leading-relaxed">{q.suggestedAnswer}</p>
                </div>

                <div className="pl-6.5 pt-0.5">
                  <button
                    onClick={() => void ask(q.question, false)}
                    className="rounded bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/20 transition-colors"
                  >
                    Generate AI Response
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {intel.questions.map((q, idx) => (
            <div key={idx} className="rounded-lg border border-white/5 bg-white/[0.01] p-3 space-y-2 hover:border-white/10 transition-colors">
              <div className="flex items-start gap-2">
                <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent font-mono">
                  {idx + 1}
                </span>
                <h5 className="text-[12.5px] font-semibold text-white/95 leading-normal">{q.question}</h5>
              </div>
              
              <p className="text-[11.5px] text-white/50 pl-6 leading-relaxed">
                {q.context}
              </p>

              <div className="pl-6 flex flex-wrap gap-1.5">
                {q.suggestedPoints.map((pt, pIdx) => (
                  <span key={pIdx} className="rounded border border-white/5 bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/40">
                    {pt}
                  </span>
                ))}
              </div>

              <div className="pl-6 pt-1">
                <button
                  onClick={() => void ask(q.question, false)}
                  className="rounded bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/20 transition-colors"
                >
                  Ask AI about this
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
