import { z } from "zod";

/**
 * Every value that crosses the JS <-> Rust boundary is validated against a schema
 * defined here. The Rust side mirrors these with serde structs; the schemas are the
 * single source of truth and are re-validated on both ends of every IPC call.
 */

export const ProviderId = z.enum(["openai", "gemini", "ollama", "azure-openai", "custom"]);
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * hybrid-race  -> fire Gemini and OpenAI at once, stream whichever first token wins.
 * hybrid-tier  -> fast model answers instantly, deep model silently refines and replaces.
 * single       -> exactly one provider, no fan-out. Chosen from `primary`.
 * offline      -> Ollama only, no network egress at all.
 */
export const RoutingMode = z.enum(["hybrid-race", "hybrid-tier", "single", "offline"]);
export type RoutingMode = z.infer<typeof RoutingMode>;

export const ModelRole = z.enum(["fast", "deep", "vision", "embed"]);
export type ModelRole = z.infer<typeof ModelRole>;

export const ProviderConfig = z.object({
  id: ProviderId,
  enabled: z.boolean().default(true),
  baseUrl: z.string().url().optional(),
  /** Key is never stored here — only a keychain handle. */
  keyRef: z.string().optional(),
  models: z.record(ModelRole, z.string()).default({}),
  /** Lower = preferred when latency ties. */
  priority: z.number().int().min(0).max(100).default(50),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const RoutingPolicy = z.object({
  mode: RoutingMode.default("hybrid-race"),
  primary: ProviderId.default("gemini"),
  secondary: ProviderId.default("openai"),
  /** Abort the loser of a race once the winner streams this many tokens. */
  raceCancelAfterTokens: z.number().int().min(1).default(12),
  /** Hard ceiling on time-to-first-token before failing over. */
  firstTokenTimeoutMs: z.number().int().min(200).default(2500),
  /** Speculative prefetch: start generating before the user finishes speaking. */
  speculativePrefetch: z.boolean().default(true),
  /** Refuse any network call regardless of provider config. */
  airgapped: z.boolean().default(false),
});
export type RoutingPolicy = z.infer<typeof RoutingPolicy>;

export const StealthConfig = z.object({
  /** Excludes the window from OS screen-capture APIs. */
  contentProtected: z.boolean().default(true),
  /** Window can become key/active when user types in Ask mode. */
  neverStealFocus: z.boolean().default(false),
  hideFromTaskbar: z.boolean().default(true),
  hideFromDock: z.boolean().default(true),
  alwaysOnTop: z.boolean().default(true),
  /** Overlay opacity, 0.15..1.0 */
  opacity: z.number().min(0.15).max(1).default(0.92),
  /** Click-through: mouse events pass to the window below except on controls. */
  clickThrough: z.boolean().default(false),
  /** Instantly blank the overlay on this hotkey. */
  panicHotkey: z.string().default("CommandOrControl+Shift+Backslash"),
});
export type StealthConfig = z.infer<typeof StealthConfig>;

export const AudioConfig = z.object({
  captureMicrophone: z.boolean().default(false),
  captureSystemAudio: z.boolean().default(true),
  micDeviceId: z.string().optional(),
  systemDeviceId: z.string().optional(),
  sampleRate: z.number().int().default(16000),
  /** Energy threshold below which a frame counts as silence. */
  vadThreshold: z.number().min(0).max(1).default(0.01),
  /** Silence duration that closes an utterance. */
  vadSilenceMs: z.number().int().default(500),
  diarize: z.boolean().default(true),
  language: z.string().default("auto"),
  /** Which STT engine to use: auto = try gemini then openai then local */
  sttEngine: z.enum(["auto", "gemini", "openai-whisper", "local-whisper"]).default("auto"),
});
export type AudioConfig = z.infer<typeof AudioConfig>;

export const AutoRespondTrigger = z.enum(["question-detected", "every-pause", "manual-only"]);

export const AppSettings = z.object({
  routing: RoutingPolicy.default({}),
  stealth: StealthConfig.default({}),
  audio: AudioConfig.default({}),
  providers: z.array(ProviderConfig).default([]),
  autoRespond: AutoRespondTrigger.default("question-detected"),
  telemetry: z.literal(false).default(false),
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  systemPrompt: z.string().default(""),
  ragEnabled: z.boolean().default(true),
});
export type AppSettings = z.infer<typeof AppSettings>;

export const TranscriptSegment = z.object({
  id: z.string(),
  meetingId: z.string(),
  speaker: z.string(),
  /** Stable speaker cluster id from diarization. */
  speakerKey: z.string().optional(),
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  source: z.enum(["microphone", "system"]),
  isFinal: z.boolean().default(false),
  confidence: z.number().min(0).max(1).optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const Attachment = z.object({
  id: z.string(),
  kind: z.enum(["image", "document", "screenshot"]),
  path: z.string(),
  mimeType: z.string(),
  /** OCR/extracted text, kept in context for follow-ups. */
  extractedText: z.string().optional(),
  bytes: z.number().int().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

export const ChatMessage = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  attachments: z.array(Attachment).default([]),
  createdAt: z.number(),
  provider: ProviderId.optional(),
  model: z.string().optional(),
  latencyMs: z.number().optional(),
  firstTokenMs: z.number().optional(),
  citations: z.array(z.object({ docId: z.string(), title: z.string(), score: z.number() })).default([]),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const AskRequest = z.object({
  conversationId: z.string(),
  prompt: z.string().min(1),
  attachments: z.array(Attachment).default([]),
  /** Attach a fresh screenshot to this turn. */
  useScreen: z.boolean().default(false),
  /** Override the global routing policy for this single turn. */
  routingOverride: RoutingPolicy.partial().optional(),
  useRag: z.boolean().default(true),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const StreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), requestId: z.string(), provider: ProviderId, model: z.string() }),
  z.object({ type: z.literal("token"), requestId: z.string(), delta: z.string() }),
  z.object({ type: z.literal("citation"), requestId: z.string(), docId: z.string(), title: z.string(), score: z.number() }),
  z.object({ type: z.literal("swap"), requestId: z.string(), provider: ProviderId, model: z.string(), reason: z.string() }),
  z.object({ type: z.literal("done"), requestId: z.string(), latencyMs: z.number(), firstTokenMs: z.number() }),
  z.object({ type: z.literal("error"), requestId: z.string(), message: z.string(), recoverable: z.boolean() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export const Meeting = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  participants: z.array(z.string()).default([]),
  summary: z.string().optional(),
  decisions: z.array(z.string()).default([]),
  actionItems: z
    .array(z.object({ text: z.string(), owner: z.string().optional(), due: z.string().optional() }))
    .default([]),
});
export type Meeting = z.infer<typeof Meeting>;

export const RagDocument = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  mimeType: z.string(),
  chunkCount: z.number().int(),
  indexedAt: z.number(),
});
export type RagDocument = z.infer<typeof RagDocument>;

export const RagHit = z.object({
  docId: z.string(),
  chunkId: z.string(),
  title: z.string(),
  text: z.string(),
  score: z.number(),
});
export type RagHit = z.infer<typeof RagHit>;
