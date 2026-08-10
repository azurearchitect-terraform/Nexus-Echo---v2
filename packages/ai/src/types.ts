import type { Attachment, ProviderId } from "@nexus/core";

export interface GenerateOptions {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  attachments?: Attachment[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** When true, instructs the provider to return raw JSON (no markdown fences). */
  jsonMode?: boolean;
  signal: AbortSignal;
}

export interface TokenChunk {
  delta: string;
  done: boolean;
}

export interface Provider {
  id: ProviderId;
  /** Streams tokens as they arrive. Must respect `options.signal` promptly. */
  stream(options: GenerateOptions): AsyncIterable<TokenChunk>;
  embed?(texts: string[], model: string): Promise<number[][]>;
  /** Cheap reachability probe used by the health tracker. */
  ping(signal: AbortSignal): Promise<boolean>;
}

export interface ProviderCredentials {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}
