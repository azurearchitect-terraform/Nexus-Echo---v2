import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Camera,
  Command,
  Ear,
  Eye,
  EyeOff,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  Square,
  X,
  Zap,
} from "lucide-react";
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
export function Overlay() {
  const {
    ready,
    mode,
    setMode,
    streaming,
    answer,
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
    attachments,
    addAttachment,
    clearAttachments,
    reset,
  } = useStore();

  const [input, setInput] = useState("");
  const [useScreen, setUseScreen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      const text = await transcribe(wavBase64, settings.audio.language);
      if (!text.trim()) return;

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
      pushSegment(segment);

      // Auto-respond only fires on someone else's question. Reacting to the
      // user's own speech produces answers to questions they just asked aloud,
      // which is noise at exactly the wrong moment.
      const trigger = useStore.getState().settings.autoRespond;
      if (source === "system" && trigger === "question-detected" && looksLikeQuestion(text)) {
        void useStore.getState().suggest();
      }
    });
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

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col p-2">
      <section className="panel no-select flex min-h-0 flex-1 flex-col overflow-hidden">
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
          </div>

          <div className="flex flex-1 items-center gap-3">
            {listening ? (
              <>
                <Waveform active={speakingMic} tone="mic" />
                <Waveform active={speakingSystem} tone="system" />
              </>
            ) : (
              <StatusDot active label={settings.routing.mode.replace("-", " ")} />
            )}
            {answer?.firstTokenMs ? (
              <span className="font-mono text-[10px] text-white/30" title="Time to first token">
                <Zap className="mr-0.5 inline h-2.5 w-2.5" />
                {formatMs(answer.firstTokenMs)}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-0.5 no-drag">
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
              {mode === "listen" && !answer?.text ? (
                <Transcript segments={segments} />
              ) : answer ? (
                <div className="animate-fade-up">
                  {answer.error ? (
                    <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                      {answer.error}
                    </p>
                  ) : (
                    <Markdown>{answer.text || "…"}</Markdown>
                  )}

                  {answer.citations.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {answer.citations.map((c) => (
                        <span
                          key={c.docId}
                          className="rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent/80"
                        >
                          {c.title}
                        </span>
                      ))}
                    </div>
                  )}

                  {answer.provider && (
                    <p className="mt-2 font-mono text-[10px] text-white/25">
                      {answer.provider} · {answer.model}
                      {answer.swapped && " · refined"}
                      {answer.latencyMs ? ` · ${formatMs(answer.latencyMs)}` : ""}
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState mode={mode} />
              )}

              {followUps.length > 0 && mode === "listen" && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {followUps.map((q) => (
                    <button
                      key={q}
                      onClick={() => void ask(q, false)}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60
                                 transition-colors hover:border-accent/40 hover:text-white"
                    >
                      {q}
                    </button>
                  ))}
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void (listening ? stopListening() : startListening())}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                      listening
                        ? "bg-danger/15 text-danger hover:bg-danger/25"
                        : "bg-accent/15 text-accent hover:bg-accent/25",
                    )}
                  >
                    {listening ? <Square className="h-3 w-3" /> : <Ear className="h-3.5 w-3.5" />}
                    {listening ? "Stop" : "Start listening"}
                  </button>

                  <button
                    onClick={() => void suggest()}
                    disabled={streaming || !segments.length}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-white/70
                               transition-colors hover:bg-white/10 disabled:opacity-30"
                  >
                    Suggest a reply
                  </button>

                  <span className="ml-auto flex items-center gap-1 text-[10px] text-white/25">
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
            </footer>
          </>
        )}
      </section>

      {answer && !streaming && (
        <button
          onClick={reset}
          className="mx-auto mt-1 text-[10px] text-white/20 transition-colors hover:text-white/50"
        >
          new conversation
        </button>
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
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
      <p className="text-[12px] text-white/35">
        {mode === "ask"
          ? "Ask a question, or capture your screen."
          : "Start listening and Nexus will follow the room."}
      </p>
      <div className="flex gap-1.5 text-[10px] text-white/25">
        <span className="kbd">⌘⇧Space</span> toggle
        <span className="kbd">⌘⇧S</span> capture
        <span className="kbd">⌘⇧L</span> listen
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
  const provider = settings.providers.find((p) => p.id === "openai" && p.enabled);

  if (settings.routing.airgapped || !provider) {
    // Local Whisper via the whisper.cpp server API.
    const res = await fetch("http://127.0.0.1:8080/inference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: wavBase64, language }),
    }).catch(() => null);
    if (!res?.ok) return "";
    const json = (await res.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }

  const { bridge: b } = await import("@/lib/bridge");
  const apiKey = provider.keyRef ? await b.resolveProviderKey(provider.keyRef) : null;
  if (!apiKey) return "";

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
  }).catch(() => null);
  if (!res?.ok) return "";
  const json = (await res.json()) as { text?: string };
  return json.text?.trim() ?? "";
}
