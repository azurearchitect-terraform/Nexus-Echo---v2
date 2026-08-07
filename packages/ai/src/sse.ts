/**
 * Minimal SSE reader. Every provider below streams over `text/event-stream`,
 * and the difference between them is only the JSON shape of each `data:` frame.
 */
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
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload) as Record<string, unknown>;
        } catch {
          /* keep-alive or partial frame — ignore */
        }
      }
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
    if (done) break;
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
