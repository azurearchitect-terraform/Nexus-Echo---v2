import { definePlugin } from "@nexus/plugin-sdk";
import type { TranscriptSegment } from "@nexus/core";

/**
 * Reference plugin. It demonstrates the whole surface — a transcript hook, a
 * commitment detector, and a meeting-end handler — while staying genuinely useful.
 *
 * Commitments ("I'll send that over", "let me follow up") are caught live rather
 * than at summary time, because the sentence that creates an obligation is often
 * the one nobody writes down.
 */

const COMMITMENT = /\b(i'?ll|i will|we'?ll|we will|let me|i can|i'?m going to)\s+(\w+)/i;
const DEADLINE = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|by \w+|eod|eow)\b/i;

interface Commitment {
  text: string;
  speaker: string;
  atMs: number;
  deadline: string | null;
}

const commitments: Commitment[] = [];

export default definePlugin({
  manifest: {
    id: "meeting-intelligence",
    name: "Meeting intelligence",
    version: "2.0.1",
    description:
      "Catches commitments and deadlines as they are spoken, and files them with the meeting summary.",
    author: "Nexus Echo",
    permissions: ["transcript:read", "notify"],
    hooks: ["onTranscriptSegment", "onMeetingEnd"],
  },

  onTranscriptSegment(segment: TranscriptSegment, context) {
    if (!COMMITMENT.test(segment.text)) return;

    const deadline = segment.text.match(DEADLINE)?.[0] ?? null;
    commitments.push({
      text: segment.text.trim(),
      speaker: segment.speaker,
      atMs: segment.startMs,
      deadline,
    });

    // Notify only when a date was attached — an undated "I'll take a look" is not
    // worth interrupting anyone over, and false positives train people to ignore alerts.
    if (deadline) {
      context.notify?.("Commitment captured", `${segment.speaker}: ${segment.text.slice(0, 80)}`);
    }
  },

  onMeetingEnd(_segments, context) {
    if (!commitments.length) return;
    context.log(`captured ${commitments.length} commitments`);
    const dated = commitments.filter((c) => c.deadline);
    if (dated.length) {
      context.notify?.(
        "Meeting ended",
        `${dated.length} dated commitment${dated.length === 1 ? "" : "s"} were made.`,
      );
    }
    commitments.length = 0;
  },

  commands: [
    {
      id: "list-commitments",
      title: "Show commitments from this meeting",
      run(context) {
        context.log(commitments);
      },
    },
  ],
});
