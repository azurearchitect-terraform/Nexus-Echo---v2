import type { NexusPlugin, PluginContext, Permission } from "@nexus/plugin-sdk";
import type { TranscriptSegment } from "@nexus/core";
import { engine } from "./engine";
import { useStore } from "./store";

export interface LoadedPlugin {
  manifest: NexusPlugin["manifest"];
  plugin: NexusPlugin;
  enabled: boolean;
}

/**
 * The host builds each plugin a context object containing only the capabilities its
 * manifest declared. A plugin without `network` does not receive a `fetch` at all,
 * so there is no permission check to bypass — the method simply does not exist.
 */
class PluginHost {
  private plugins = new Map<string, LoadedPlugin>();

  register(plugin: NexusPlugin, enabled = true): void {
    this.plugins.set(plugin.manifest.id, { manifest: plugin.manifest, plugin, enabled });
    if (enabled) void plugin.activate?.(this.contextFor(plugin));
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.plugins.get(id);
    if (!entry) return;
    entry.enabled = enabled;
    if (enabled) void entry.plugin.activate?.(this.contextFor(entry.plugin));
    else void entry.plugin.deactivate?.();
  }

  private contextFor(plugin: NexusPlugin): PluginContext {
    const granted = new Set<Permission>(plugin.manifest.permissions);
    const context: PluginContext = {
      log: (...args) => console.log(`[plugin:${plugin.manifest.id}]`, ...args),
    };

    if (granted.has("transcript:read")) {
      context.getTranscript = () => useStore.getState().segments;
    }
    if (granted.has("knowledge:read")) {
      context.search = (query, topK = 4) => engine.rag?.search(query, topK) ?? Promise.resolve([]);
    }
    if (granted.has("network")) {
      context.fetch = globalThis.fetch.bind(globalThis);
    }
    if (granted.has("notify")) {
      context.notify = (title, body) => {
        void import("@tauri-apps/plugin-notification").then((m) =>
          m.sendNotification({ title, body }),
        );
      };
    }
    if (granted.has("clipboard")) {
      context.copy = async (text) => {
        const m = await import("@tauri-apps/plugin-clipboard-manager");
        await m.writeText(text);
      };
    }
    return context;
  }

  async emitTranscriptSegment(segment: TranscriptSegment): Promise<void> {
    for (const entry of this.plugins.values()) {
      if (!entry.enabled || !entry.plugin.onTranscriptSegment) continue;
      try {
        await entry.plugin.onTranscriptSegment(segment, this.contextFor(entry.plugin));
      } catch (e) {
        // A failing plugin must never take the assistant down mid-meeting.
        console.error(`[plugin:${entry.manifest.id}] transcript hook failed`, e);
      }
    }
  }

  async transformAnswer(text: string): Promise<string> {
    let output = text;
    for (const entry of this.plugins.values()) {
      if (!entry.enabled || !entry.plugin.onAnswerComplete) continue;
      if (!entry.manifest.permissions.includes("answer:transform")) continue;
      try {
        const result = await entry.plugin.onAnswerComplete(
          output,
          { type: "done", requestId: "", latencyMs: 0, firstTokenMs: 0 },
          this.contextFor(entry.plugin),
        );
        if (typeof result === "string") output = result;
      } catch (e) {
        console.error(`[plugin:${entry.manifest.id}] answer hook failed`, e);
      }
    }
    return output;
  }
}

export const pluginHost = new PluginHost();
