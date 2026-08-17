import type { SpeechQualityMetrics } from "@nexus/core";

/**
 * Comprehensive speech quality analyzer for interview responses.
 * All analysis is performed locally (no API calls).
 * 
 * Metrics calculated:
 * - Words per minute
 * - Filler word detection and frequency
 * - Pause analysis and hesitation patterns
 * - Clarity assessment (sentence completion)
 * - Confidence scoring from delivery patterns
 * - Overall composite speech quality score
 */

// Common filler words to detect
const FILLER_WORDS = new Set([
  "um", "uh", "er", "ah", "uhm", "hmm", "erm",
  "like", "basically", "actually", "really", "just", "you know",
  "sort of", "kind of", "i mean", "well", "anyway", "so"
]);

// Regex to find filler words (case-insensitive, word boundaries)
const FILLER_WORD_REGEX = new RegExp(
  `\\b(${Array.from(FILLER_WORDS).join("|")})\\b`,
  "gi"
);

// Regex for sentence delimiters (simplified)
const SENTENCE_REGEX = /[.!?;]+/g;
const WORD_BOUNDARY_REGEX = /\b[\w'-]+\b/g;

interface SegmentTiming {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Analyze speech quality from transcript and timing data.
 * @param transcript - The full transcript of the response
 * @param segments - Array of transcript segments with timing info
 * @returns SpeechQualityMetrics with all computed scores
 */
export function analyzeSpeechQuality(
  transcript: string,
  segments: SegmentTiming[]
): SpeechQualityMetrics {
  if (!transcript || !segments.length) {
    return {
      wordsPerMinute: 0,
      fillerWordCount: 0,
      fillerWordPercentage: 0,
      averagePauseDurationMs: 0,
      significantPauseCount: 0,
      pauseToSpeechRatio: 0,
      claritySentenceCompletion: 0,
      confidenceFromDelivery: 0,
      speechRateConsistency: 0,
      fillerWordInstances: [],
      overallSpeechQuality: 0,
    };
  }

  // Calculate basic metrics
  const wordCount = countWords(transcript);
  const durationMs = calculateDuration(segments);
  const durationMinutes = durationMs / 60000;
  
  const wordsPerMinute = durationMinutes > 0 ? Math.round(wordCount / durationMinutes) : 0;
  
  // Filler word analysis
  const { fillerCount, fillerInstances } = detectFillerWords(transcript, segments);
  const fillerPercentage = wordCount > 0 ? Math.round((fillerCount / wordCount) * 100) : 0;
  
  // Pause analysis
  const { avgPauseDurationMs, significantPauses, pauseRatio } = analyzePauses(segments);
  
  // Clarity assessment
  const claritySentenceCompletion = assessSentenceCompletion(transcript);
  
  // Confidence scoring from delivery patterns
  const confidenceScore = assessConfidenceFromDelivery(
    wordsPerMinute,
    avgPauseDurationMs,
    fillerPercentage,
    pauseRatio
  );
  
  // Speech rate consistency
  const rateConsistency = assessSpeechRateConsistency(segments);
  
  // Calculate composite score
  const overallScore = calculateCompositeScore({
    wordsPerMinute,
    fillerPercentage,
    avgPauseDurationMs,
    pauseRatio,
    claritySentenceCompletion,
    confidenceScore,
    rateConsistency,
  });

  return {
    wordsPerMinute,
    fillerWordCount: fillerCount,
    fillerWordPercentage: fillerPercentage,
    averagePauseDurationMs: Math.round(avgPauseDurationMs),
    significantPauseCount: significantPauses,
    pauseToSpeechRatio: Math.round(pauseRatio * 100) / 100,
    claritySentenceCompletion,
    confidenceFromDelivery: confidenceScore,
    speechRateConsistency: rateConsistency,
    fillerWordInstances: fillerInstances,
    overallSpeechQuality: overallScore,
  };
}

/**
 * Count words in transcript (simple word boundary regex)
 */
function countWords(text: string): number {
  const matches = text.match(WORD_BOUNDARY_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Calculate total duration from segments
 */
function calculateDuration(segments: SegmentTiming[]): number {
  if (!segments.length) return 0;
  const start = Math.min(...segments.map(s => s.startMs));
  const end = Math.max(...segments.map(s => s.endMs));
  return Math.max(0, end - start);
}

/**
 * Detect filler words and their positions
 */
function detectFillerWords(
  transcript: string,
  segments: SegmentTiming[]
): { fillerCount: number; fillerInstances: any[] } {
  const instances: any[] = [];
  let match;
  let fillerCount = 0;

  // Reset regex lastIndex for proper iteration
  FILLER_WORD_REGEX.lastIndex = 0;

  while ((match = FILLER_WORD_REGEX.exec(transcript)) !== null) {
    fillerCount++;
    
    // Find which segment this filler word belongs to for timing
    const characterPosition = match.index;
    const word = (match[1] ?? "").toLowerCase();
    
    // Estimate timestamp based on character position in transcript
    const timestamp = estimateTimestamp(characterPosition, transcript, segments);
    
    instances.push({
      word,
      position: characterPosition,
      timestamp,
    });
  }

  return { fillerCount, fillerInstances: instances };
}

/**
 * Estimate timestamp for a character position in transcript
 * (rough approximation based on segment distribution)
 */
function estimateTimestamp(charPosition: number, transcript: string, segments: SegmentTiming[]): number {
  if (!segments.length || !transcript.length) return 0;
  
  const ratio = charPosition / transcript.length;
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  
  if (!firstSegment || !lastSegment) return 0;
  
  const duration = lastSegment.endMs - firstSegment.startMs;
  
  return Math.round(firstSegment.startMs + duration * ratio);
}

/**
 * Analyze pauses between segments
 */
function analyzePauses(segments: SegmentTiming[]): {
  avgPauseDurationMs: number;
  significantPauses: number;
  pauseRatio: number;
} {
  if (segments.length < 2) {
    return { avgPauseDurationMs: 0, significantPauses: 0, pauseRatio: 0 };
  }

  const pauses: number[] = [];
  let significantPauseCount = 0;
  let totalSpeakingTime = 0;
  let totalDuration = 0;

  // Sort segments by start time
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);

  // Calculate gaps between segments
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current || !next) continue;
    
    const gapMs = next.startMs - current.endMs;
    if (gapMs > 0) {
      pauses.push(gapMs);
      if (gapMs > 500) significantPauseCount++;
    }
  }

  // Calculate speaking time
  sorted.forEach(seg => {
    const segmentDuration = seg.endMs - seg.startMs;
    totalSpeakingTime += segmentDuration;
  });

  // Total time span
  const firstSeg = sorted[0];
  const lastSeg = sorted[sorted.length - 1];
  if (firstSeg && lastSeg) {
    totalDuration = lastSeg.endMs - firstSeg.startMs;
  }

  const avgPauseMs = pauses.length > 0 
    ? pauses.reduce((a, b) => a + b, 0) / pauses.length 
    : 0;

  const pauseRatio = totalDuration > 0 
    ? (totalDuration - totalSpeakingTime) / totalDuration 
    : 0;

  return {
    avgPauseDurationMs: avgPauseMs,
    significantPauses: significantPauseCount,
    pauseRatio: Math.max(0, Math.min(1, pauseRatio)),
  };
}

/**
 * Assess clarity based on sentence completion
 * Higher = more complete sentences, lower = more fragments
 */
function assessSentenceCompletion(transcript: string): number {
  if (!transcript.trim()) return 0;

  const words = transcript.match(WORD_BOUNDARY_REGEX) || [];
  const sentences = transcript.match(SENTENCE_REGEX) || [];
  
  if (!words.length) return 0;

  // Average words per sentence
  const avgWordsPerSentence = sentences.length > 0 
    ? words.length / sentences.length 
    : words.length;

  // Good sentences typically have 8-20 words
  // Score is higher if we're in that range
  const optimalWordsPerSentence = 12;
  const clarity = Math.min(100, Math.round((avgWordsPerSentence / optimalWordsPerSentence) * 100));

  // If too many sentences (fragmented), penalize
  if (sentences.length > words.length * 0.15) {
    return Math.max(40, clarity - 20);
  }

  return clarity;
}

/**
 * Assess confidence from delivery patterns
 * Lower filler %, steady pace, fewer pauses = more confident
 */
function assessConfidenceFromDelivery(
  wordsPerMinute: number,
  avgPauseDurationMs: number,
  fillerPercentage: number,
  pauseRatio: number
): number {
  let confidence = 100;

  // Filler words penalty (more fillers = less confident)
  // 0-2% filler = excellent, 10%+ = concerning
  if (fillerPercentage > 10) confidence -= 30;
  else if (fillerPercentage > 5) confidence -= 15;
  else if (fillerPercentage > 2) confidence -= 5;

  // Speech rate consideration
  // Very slow (<100 wpm) or very fast (>180 wpm) = less confident
  if (wordsPerMinute < 100) confidence -= 10;
  else if (wordsPerMinute > 180) confidence -= 10;

  // Pause analysis
  // Frequent long pauses = hesitation = less confident
  if (avgPauseDurationMs > 2000) confidence -= 15;
  else if (avgPauseDurationMs > 1000) confidence -= 8;

  // Pause ratio: high ratio of pauses = less confident
  if (pauseRatio > 0.4) confidence -= 15;
  else if (pauseRatio > 0.25) confidence -= 8;

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Assess speech rate consistency throughout response
 * Measures stability in pacing
 */
function assessSpeechRateConsistency(segments: SegmentTiming[]): number {
  if (segments.length < 3) return 100; // Not enough data

  const rates: number[] = [];

  // Calculate WPM for consecutive chunks
  for (let i = 0; i < segments.length; i++) {
    const chunk = segments[i];
    if (!chunk) continue;
    
    const durationMs = chunk.endMs - chunk.startMs;
    if (durationMs < 100) continue; // Skip very short segments

    const words = countWords(chunk.text);
    const durationMinutes = durationMs / 60000;
    const wpm = durationMinutes > 0 ? words / durationMinutes : 0;
    
    if (wpm > 0) rates.push(wpm);
  }

  if (rates.length < 2) return 100;

  // Calculate standard deviation
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((sum, rate) => sum + Math.pow(rate - mean, 2), 0) / rates.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation (lower = more consistent)
  const cv = mean > 0 ? stdDev / mean : 0;

  // Convert to 0-100 score (lower variation = higher score)
  // CV > 0.3 = 40, CV < 0.1 = 100
  const consistency = Math.max(0, Math.min(100, Math.round(100 - cv * 200)));

  return consistency;
}

/**
 * Calculate composite overall speech quality score
 * Weights different metrics to produce a single 0-100 score
 */
function calculateCompositeScore(metrics: {
  wordsPerMinute: number;
  fillerPercentage: number;
  avgPauseDurationMs: number;
  pauseRatio: number;
  claritySentenceCompletion: number;
  confidenceScore: number;
  rateConsistency: number;
}): number {
  // Weights (sum to 100)
  const weights = {
    clarity: 25,           // Clarity is most important
    confidence: 25,        // Confidence/delivery matters
    fillerPenalty: 20,     // Fewer fillers is better
    pauseQuality: 15,      // Pauses should be controlled
    consistency: 15,       // Consistent pacing is good
  };

  let score = 0;

  // Clarity component (direct)
  score += metrics.claritySentenceCompletion * (weights.clarity / 100);

  // Confidence component (direct)
  score += metrics.confidenceScore * (weights.confidence / 100);

  // Filler penalty component (inverse: fewer fillers = higher score)
  const fillerScore = Math.max(0, 100 - metrics.fillerPercentage * 5);
  score += fillerScore * (weights.fillerPenalty / 100);

  // Pause quality (optimal pause duration is 500-1000ms)
  const pauseQuality = metrics.avgPauseDurationMs > 0
    ? Math.max(0, 100 - Math.abs(750 - metrics.avgPauseDurationMs) / 10)
    : 50;
  score += pauseQuality * (weights.pauseQuality / 100);

  // Consistency component (direct)
  score += metrics.rateConsistency * (weights.consistency / 100);

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Generate human-readable feedback based on speech metrics
 */
export function generateSpeechFeedback(metrics: SpeechQualityMetrics): string[] {
  const feedback: string[] = [];

  // Filler words feedback
  if (metrics.fillerWordPercentage > 10) {
    feedback.push(`⚠️ High filler word usage (${metrics.fillerWordPercentage}%). Focus on pausing instead of saying "um" or "like".`);
  } else if (metrics.fillerWordPercentage > 5) {
    feedback.push(`💡 Moderate filler usage (${metrics.fillerWordPercentage}%). Try slowing down to eliminate fillers.`);
  } else if (metrics.fillerWordCount === 0) {
    feedback.push(`✅ Excellent! Zero filler words detected.`);
  }

  // Pace feedback
  if (metrics.wordsPerMinute < 100) {
    feedback.push(`🐢 Speaking slowly (${metrics.wordsPerMinute} WPM). Consider picking up the pace slightly.`);
  } else if (metrics.wordsPerMinute > 180) {
    feedback.push(`🚀 Speaking very quickly (${metrics.wordsPerMinute} WPM). Slow down to ensure clarity.`);
  } else {
    feedback.push(`✅ Good speaking pace (${metrics.wordsPerMinute} WPM).`);
  }

  // Pause feedback
  if (metrics.averagePauseDurationMs > 2000) {
    feedback.push(`⏸️ Long pauses detected (${Math.round(metrics.averagePauseDurationMs / 1000)}s avg). These suggest hesitation.`);
  } else if (metrics.significantPauseCount > 5) {
    feedback.push(`💭 Multiple significant pauses. Be more concise and structured.`);
  }

  // Clarity feedback
  if (metrics.claritySentenceCompletion < 60) {
    feedback.push(`📝 Fragmented delivery. Build longer, more complete sentences.`);
  } else if (metrics.claritySentenceCompletion > 85) {
    feedback.push(`✅ Clear, well-structured delivery.`);
  }

  // Confidence feedback
  if (metrics.confidenceFromDelivery < 50) {
    feedback.push(`😰 Delivery suggests low confidence. Work on steadier pacing and fewer fillers.`);
  } else if (metrics.confidenceFromDelivery > 80) {
    feedback.push(`💪 Confident and composed delivery.`);
  }

  // Overall score
  if (metrics.overallSpeechQuality < 50) {
    feedback.push(`🎯 Overall speech quality needs improvement. Focus on the above areas.`);
  } else if (metrics.overallSpeechQuality > 80) {
    feedback.push(`🌟 Excellent overall delivery!`);
  }

  return feedback;
}

