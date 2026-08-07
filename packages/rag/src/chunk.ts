export interface Chunk {
  id: string;
  docId: string;
  text: string;
  ordinal: number;
}

/**
 * Splits on semantic boundaries first (headings, then paragraphs, then sentences)
 * and only falls back to a hard character cut when a single sentence is enormous.
 * Overlap carries the tail of each chunk into the next so a fact that straddles a
 * boundary is still retrievable.
 */
export function chunkText(docId: string, text: string, size = 1100, overlap = 180): Chunk[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n(?=#{1,6}\s)|\n\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buffer = "";

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({ id: `${docId}::${chunks.length}`, docId, text: trimmed, ordinal: chunks.length });
    buffer = overlap > 0 ? trimmed.slice(-overlap) : "";
  };

  for (const block of blocks) {
    if (block.length > size) {
      const sentences = block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block];
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > size) flush();
        buffer += sentence;
        while (buffer.length > size * 1.5) {
          chunks.push({
            id: `${docId}::${chunks.length}`,
            docId,
            text: buffer.slice(0, size),
            ordinal: chunks.length,
          });
          buffer = buffer.slice(size - overlap);
        }
      }
      continue;
    }
    if (buffer.length + block.length > size) flush();
    buffer += (buffer ? "\n\n" : "") + block;
  }
  flush();
  return chunks;
}
