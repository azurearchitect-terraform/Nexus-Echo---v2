import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { z } from "zod";

/**
 * Typed IPC wrapper. Nothing in the UI calls `invoke` directly — every command
 * goes through here so the response is parsed against its schema before it can
 * reach a React component. A malformed payload throws at the boundary, not
 * three renders later inside a component.
 */
export async function call<TIn, TOut>(
  command: string,
  input: TIn,
  inSchema: z.ZodType<TIn>,
  outSchema: z.ZodType<TOut>,
): Promise<TOut> {
  const parsedIn = inSchema.parse(input);
  const raw = await invoke(command, { payload: parsedIn });
  return outSchema.parse(raw);
}

export function subscribe<T>(channel: string, schema: z.ZodType<T>, onEvent: (value: T) => void) {
  const unlisten = listen<unknown>(channel, (e: { payload: unknown }) => {
    const parsed = schema.safeParse(e.payload);
    if (parsed.success) onEvent(parsed.data);
    else console.error(`[ipc] dropped malformed ${channel} event`, parsed.error.flatten());
  });
  return () => {
    void unlisten.then((fn: () => void) => fn());
  };
}

export const CHANNELS = {
  stream: "nexus://stream",
  transcript: "nexus://transcript",
  vad: "nexus://vad",
  hotkey: "nexus://hotkey",
  meeting: "nexus://meeting",
  indexing: "nexus://indexing",
} as const;
