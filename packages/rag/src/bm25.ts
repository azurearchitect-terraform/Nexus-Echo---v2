/**
 * Keyword scoring that runs alongside the vector search. Embeddings miss exact
 * identifiers — error codes, ticket numbers, unusual product names — and those are
 * exactly the terms people ask about under pressure, so lexical scoring earns its keep.
 */
const STOP = new Set(
  "a an the and or but if of to in on for with is are was were be been it this that as at by from".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_+#.-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export class Bm25Index {
  private docs: Bm25Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(
    private k1 = 1.5,
    private b = 0.75,
  ) {}

  build(docs: Bm25Doc[]): void {
    this.docs = docs;
    this.df.clear();
    for (const doc of docs) {
      for (const term of new Set(doc.tokens)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
    this.avgLen = docs.length ? docs.reduce((s, d) => s + d.tokens.length, 0) / docs.length : 0;
  }

  score(query: string): Map<string, number> {
    const terms = tokenize(query);
    const N = this.docs.length;
    const scores = new Map<string, number>();
    if (!N) return scores;

    for (const doc of this.docs) {
      const counts = new Map<string, number>();
      for (const t of doc.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of terms) {
        const tf = counts.get(term);
        if (!tf) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const norm = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + (this.b * doc.tokens.length) / (this.avgLen || 1));
        score += idf * (norm / denom);
      }
      if (score > 0) scores.set(doc.id, score);
    }
    return scores;
  }
}
