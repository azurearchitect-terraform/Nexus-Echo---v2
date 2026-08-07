import type { RagHit } from "@nexus/core";
import { chunkText, type Chunk } from "./chunk";
import { cosine } from "./vector";
import { Bm25Index, tokenize } from "./bm25";

export interface EmbeddedChunk extends Chunk {
  title: string;
  vector: number[];
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

/** Persistence is delegated to the Rust/SQLite side; this class owns retrieval logic. */
export interface RagPersistence {
  saveChunks(chunks: EmbeddedChunk[]): Promise<void>;
  loadChunks(): Promise<EmbeddedChunk[]>;
  deleteDocument(docId: string): Promise<void>;
}

/**
 * Hybrid retrieval: dense vectors find meaning, BM25 finds exact strings, and the
 * two ranked lists are fused with Reciprocal Rank Fusion. RRF is used rather than a
 * weighted score blend because the two scores are on incomparable scales and any
 * fixed weight ends up tuned to one corpus and wrong on the next.
 */
export class RagStore {
  private chunks: EmbeddedChunk[] = [];
  private bm25 = new Bm25Index();
  private ready = false;

  constructor(
    private embed: Embedder,
    private persistence: RagPersistence,
  ) {}

  async init(): Promise<void> {
    this.chunks = await this.persistence.loadChunks();
    this.reindexLexical();
    this.ready = true;
  }

  private reindexLexical(): void {
    this.bm25.build(this.chunks.map((c) => ({ id: c.id, tokens: tokenize(`${c.title} ${c.text}`) })));
  }

  get documentCount(): number {
    return new Set(this.chunks.map((c) => c.docId)).size;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  async addDocument(
    docId: string,
    title: string,
    text: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const pieces = chunkText(docId, text);
    if (!pieces.length) return 0;

    const embedded: EmbeddedChunk[] = [];
    const BATCH = 32;
    for (let i = 0; i < pieces.length; i += BATCH) {
      const batch = pieces.slice(i, i + BATCH);
      const vectors = await this.embed(batch.map((c) => c.text));
      batch.forEach((chunk, j) => {
        embedded.push({ ...chunk, title, vector: vectors[j] ?? [] });
      });
      onProgress?.(Math.min(i + BATCH, pieces.length), pieces.length);
    }

    await this.persistence.saveChunks(embedded);
    this.chunks = [...this.chunks.filter((c) => c.docId !== docId), ...embedded];
    this.reindexLexical();
    return embedded.length;
  }

  async removeDocument(docId: string): Promise<void> {
    await this.persistence.deleteDocument(docId);
    this.chunks = this.chunks.filter((c) => c.docId !== docId);
    this.reindexLexical();
  }

  async search(query: string, topK = 5): Promise<RagHit[]> {
    if (!this.ready || !this.chunks.length || !query.trim()) return [];

    const [queryVector] = await this.embed([query]);
    const dense = queryVector
      ? this.chunks
          .map((c) => ({ id: c.id, score: cosine(queryVector, c.vector) }))
          .sort((a, b) => b.score - a.score)
      : [];

    const lexical = [...this.bm25.score(query).entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);

    const K = 60; // RRF damping constant
    const fused = new Map<string, number>();
    dense.slice(0, 50).forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (K + i + 1)));
    lexical.slice(0, 50).forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (K + i + 1)));

    const byId = new Map(this.chunks.map((c) => [c.id, c]));
    const best = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
    const max = best[0]?.[1] ?? 1;

    return best.flatMap(([id, score]) => {
      const chunk = byId.get(id);
      if (!chunk) return [];
      return [
        {
          docId: chunk.docId,
          chunkId: chunk.id,
          title: chunk.title,
          text: chunk.text,
          score: score / max,
        },
      ];
    });
  }
}
