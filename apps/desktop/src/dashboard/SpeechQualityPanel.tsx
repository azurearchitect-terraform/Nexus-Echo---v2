import { useStore } from "@/lib/store";
import { Zap, Mic, Volume2, Lightbulb } from "lucide-react";

export function SpeechQualityPanel() {
  const { speechMetrics, speechFeedback } = useStore();

  if (!speechMetrics) {
    return null;
  }

  // Determine quality tier based on overall score
  const getQualityTier = (score: number) => {
    if (score >= 85) return { tier: "Excellent", color: "text-green-400", bgColor: "bg-green-400/10" };
    if (score >= 70) return { tier: "Good", color: "text-blue-400", bgColor: "bg-blue-400/10" };
    if (score >= 55) return { tier: "Fair", color: "text-yellow-400", bgColor: "bg-yellow-400/10" };
    return { tier: "Needs Work", color: "text-red-400", bgColor: "bg-red-400/10" };
  };

  const qualityTier = getQualityTier(speechMetrics.overallSpeechQuality);

  // Helper to show score with color-coding
  const ScoreIndicator = ({ score, max = 100 }: { score: number; max?: number }) => {
    const percentage = (score / max) * 100;
    let color = "bg-green-500";
    if (percentage < 50) color = "bg-red-500";
    else if (percentage < 70) color = "bg-yellow-500";
    else if (percentage < 85) color = "bg-blue-500";

    return (
      <div className="flex items-center gap-2">
        <div className="h-2 w-24 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full ${color} transition-all`}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>
        <span className="text-[12px] font-semibold text-white/80 w-8 text-right">{Math.round(score)}</span>
      </div>
    );
  };

  return (
    <section className="space-y-6 animate-fadeIn">
      <header>
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Speech Quality Analytics</h2>
        </div>
        <p className="text-[13px] text-white/40 mt-0.5">
          Real-time analysis of your speech delivery patterns, pacing, and confidence indicators.
        </p>
      </header>

      {/* Overall Score Card */}
      <div className={`rounded-xl border border-accent/30 ${qualityTier.bgColor} p-6 space-y-3`}>
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-mono uppercase tracking-wider text-white/60">Overall Quality Score</h3>
          <span className={`text-lg font-bold ${qualityTier.color}`}>
            {Math.round(speechMetrics.overallSpeechQuality)}/100
          </span>
        </div>
        <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full ${qualityTier.color.replace("text-", "bg-")} transition-all`}
            style={{ width: `${speechMetrics.overallSpeechQuality}%` }}
          />
        </div>
        <p className={`text-[12px] font-semibold ${qualityTier.color}`}>{qualityTier.tier}</p>
      </div>

      {/* Delivery Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Speaking Pace */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <h4 className="text-[12px] font-semibold text-white/70 flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5" />
            Speaking Pace
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-[11px] text-white/60">Words/Minute</span>
              <span className="text-[12px] font-semibold text-white/90">{speechMetrics.wordsPerMinute}</span>
            </div>
            <ScoreIndicator score={Math.min(200, speechMetrics.wordsPerMinute)} max={200} />
            <p className="text-[10px] text-white/40 mt-1">
              {speechMetrics.wordsPerMinute < 100
                ? "Speaking slowly - consider picking up pace"
                : speechMetrics.wordsPerMinute > 180
                  ? "Speaking quickly - ensure clarity"
                  : "Good pace"}
            </p>
          </div>
        </div>

        {/* Filler Words */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <h4 className="text-[12px] font-semibold text-white/70 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            Filler Words
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-[11px] text-white/60">Instances</span>
              <span className="text-[12px] font-semibold text-white/90">{speechMetrics.fillerWordCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] text-white/60">Percentage</span>
              <span className="text-[12px] font-semibold text-white/90">{speechMetrics.fillerWordPercentage}%</span>
            </div>
            <ScoreIndicator score={Math.max(0, 100 - speechMetrics.fillerWordPercentage * 5)} max={100} />
            <p className="text-[10px] text-white/40 mt-1">
              {speechMetrics.fillerWordPercentage > 10
                ? "High usage - focus on pausing instead"
                : speechMetrics.fillerWordPercentage > 5
                  ? "Moderate usage - try slowing down"
                  : "Excellent!"}
            </p>
          </div>
        </div>

        {/* Clarity */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <h4 className="text-[12px] font-semibold text-white/70">Clarity Score</h4>
          <ScoreIndicator score={speechMetrics.claritySentenceCompletion} max={100} />
          <p className="text-[10px] text-white/40 mt-2">
            {speechMetrics.claritySentenceCompletion < 60
              ? "More structured sentences needed"
              : speechMetrics.claritySentenceCompletion > 85
                ? "Clear, well-structured delivery"
                : "Good clarity overall"}
          </p>
        </div>

        {/* Confidence */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <h4 className="text-[12px] font-semibold text-white/70">Confidence Score</h4>
          <ScoreIndicator score={speechMetrics.confidenceFromDelivery} max={100} />
          <p className="text-[10px] text-white/40 mt-2">
            {speechMetrics.confidenceFromDelivery < 50
              ? "Work on steady pacing and fewer fillers"
              : speechMetrics.confidenceFromDelivery > 80
                ? "Strong, confident delivery"
                : "Confident overall"}
          </p>
        </div>
      </div>

      {/* Pause Analysis */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
        <h4 className="text-[12px] font-semibold text-white/70">Pause Patterns</h4>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-2">
            <p className="text-[11px] text-white/60">Avg Pause</p>
            <p className="text-[13px] font-semibold text-white/90">
              {Math.round(speechMetrics.averagePauseDurationMs / 1000 * 100) / 100}s
            </p>
          </div>
          <div className="p-2">
            <p className="text-[11px] text-white/60">Significant Pauses</p>
            <p className="text-[13px] font-semibold text-white/90">{speechMetrics.significantPauseCount}</p>
          </div>
          <div className="p-2">
            <p className="text-[11px] text-white/60">Pause Ratio</p>
            <p className="text-[13px] font-semibold text-white/90">{Math.round(speechMetrics.pauseToSpeechRatio * 100)}%</p>
          </div>
        </div>
        {speechMetrics.averagePauseDurationMs > 2000 && (
          <p className="text-[10px] text-yellow-400/80 mt-2">
            ⚠️ Long pauses detected - consider a more concise delivery
          </p>
        )}
      </div>

      {/* Speech Rate Consistency */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
        <h4 className="text-[12px] font-semibold text-white/70">Speaking Consistency</h4>
        <ScoreIndicator score={speechMetrics.speechRateConsistency} max={100} />
        <p className="text-[10px] text-white/40 mt-2">
          {speechMetrics.speechRateConsistency > 80
            ? "Very consistent pacing throughout"
            : speechMetrics.speechRateConsistency > 60
              ? "Generally consistent with minor variations"
              : "Variable pacing - work on steadiness"}
        </p>
      </div>

      {/* Feedback & Recommendations */}
      {speechFeedback && speechFeedback.length > 0 && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-accent" />
            <h4 className="text-[12px] font-semibold text-accent">Coaching Insights</h4>
          </div>
          <ul className="space-y-2">
            {speechFeedback.map((feedback, idx) => (
              <li key={idx} className="text-[12px] text-white/75 leading-relaxed">
                {feedback}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filler Word Instances */}
      {speechMetrics.fillerWordInstances && speechMetrics.fillerWordInstances.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <h4 className="text-[12px] font-semibold text-white/70">Filler Words Detected</h4>
          <div className="flex flex-wrap gap-2">
            {speechMetrics.fillerWordInstances.slice(0, 10).map((instance, idx) => (
              <span
                key={idx}
                className="inline-block px-2 py-1 rounded-md bg-red-500/20 text-[11px] text-red-300 border border-red-500/30"
              >
                {instance.word}
              </span>
            ))}
            {speechMetrics.fillerWordInstances.length > 10 && (
              <span className="text-[11px] text-white/40 px-2 py-1">
                +{speechMetrics.fillerWordInstances.length - 10} more
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
