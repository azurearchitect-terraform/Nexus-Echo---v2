import { z } from "zod";
import type { RagHit, StreamEvent, TranscriptSegment } from "@nexus/core";

/**
 * Plugin permissions are capability grants, not advisory labels. The host builds a
 * per-plugin API object containing only the methods its manifest requested, so a
 * plugin without `network` genuinely has no fetch to call — there is nothing to
 * enforce at call time because the capability was never handed over.
 */
export const Permission = z.enum([
  "transcript:read",
  "transcript:write",
  "answer:read",
  "answer:transform",
  "knowledge:read",
  "knowledge:write",
  "network",
  "clipboard",
  "notify",
  "ui:panel",
]);
export type Permission = z.infer<typeof Permission>;

export const PluginManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  name: z.string().min(1),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  permissions: z.array(Permission).default([]),
  /** Hooks this plugin implements, declared so the host can skip idle plugins. */
  hooks: z
    .array(z.enum(["onTranscriptSegment", "onAnswerComplete", "onMeetingEnd", "onCommand"]))
    .default([]),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

export interface PluginContext {
  /** Only present with `transcript:read`. */
  getTranscript?: () => TranscriptSegment[];
  /** Only present with `knowledge:read`. */
  search?: (query: string, topK?: number) => Promise<RagHit[]>;
  /** Only present with `network`. */
  fetch?: typeof fetch;
  /** Only present with `notify`. */
  notify?: (title: string, body: string) => void;
  /** Only present with `clipboard`. */
  copy?: (text: string) => Promise<void>;
  log: (...args: unknown[]) => void;
}

export interface PluginCommand {
  id: string;
  title: string;
  run: (context: PluginContext) => Promise<void> | void;
}

export interface NexusPlugin {
  manifest: PluginManifest;
  /** Called once when the plugin is enabled. */
  activate?: (context: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;

  onTranscriptSegment?: (segment: TranscriptSegment, context: PluginContext) => void | Promise<void>;
  /** Return a string to rewrite the answer before it renders; return void to leave it alone. */
  onAnswerComplete?: (
    text: string,
    meta: Extract<StreamEvent, { type: "done" }>,
    context: PluginContext,
  ) => string | void | Promise<string | void>;
  onMeetingEnd?: (segments: TranscriptSegment[], context: PluginContext) => void | Promise<void>;
  commands?: PluginCommand[];
}

export function definePlugin(plugin: NexusPlugin): NexusPlugin {
  PluginManifest.parse(plugin.manifest);
  return plugin;
}
