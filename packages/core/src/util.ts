export const uid = (prefix = "id"): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Naive but effective: does this utterance look like a question aimed at the user? */
const QUESTION_LEADS =
  /\b(what|why|how|when|where|who|which|can you|could you|would you|do you|did you|have you|tell me|walk me|explain|describe|talk about|your thoughts|any questions)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (t.endsWith("?")) return true;
  return QUESTION_LEADS.test(t);
}

/** Runs promises concurrently, resolves with the first to satisfy `accept`, aborts the rest. */
export async function raceAccepted<T>(
  factories: Array<(signal: AbortSignal) => Promise<T>>,
  accept: (value: T) => boolean,
): Promise<T> {
  const controllers = factories.map(() => new AbortController());
  const errors: unknown[] = [];
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let pending = factories.length;
    factories.forEach((factory, i) => {
      const controller = controllers[i];
      if (!controller) return;
      factory(controller.signal)
        .then((value) => {
          if (settled || !accept(value)) return;
          settled = true;
          controllers.forEach((c, j) => j !== i && c.abort());
          resolve(value);
        })
        .catch((err) => errors.push(err))
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !settled) reject(new AggregateError(errors, "all candidates failed"));
        });
    });
  });
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
