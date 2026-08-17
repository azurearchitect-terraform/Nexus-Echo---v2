/**
 * Minimal SSE reader. Every provider below streams over `text/event-stream`,
 * and the difference between them is only the JSON shape of each `data:` frame.
 */
function parseSSEFrame(frame: string): Record<string, unknown> | undefined {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!payload || payload === "[DONE]") return undefined;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function* readSSE(
  response: Response,
): AsyncGenerator<Record<string, unknown>, void, unknown> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText} ${body.slice(0, 400)}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response has no body stream");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      const finalFrame = parseSSEFrame(buffer);
      if (finalFrame) yield finalFrame;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const parsed = parseSSEFrame(frame);
      if (parsed) yield parsed;
    }
  }
}

/** Reads newline-delimited JSON (Ollama's streaming format). */
export async function* readNDJSON(
  response: Response,
): AsyncGenerator<Record<string, unknown>, void, unknown> {
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response has no body stream");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer) as Record<string, unknown>;
        } catch {
          /* ignore a truncated final record */
        }
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
}
