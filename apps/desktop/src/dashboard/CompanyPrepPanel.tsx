import { useState } from "react";
import { Briefcase, Loader2, AlertCircle, Check, Send, Globe, FileText, Code2, Heart, MessageCircleQuestion, Trash2, Sparkles, Users, DollarSign } from "lucide-react";
import { engine } from "@/lib/engine";
import type { CompanyIntel } from "@nexus/core";
import { useStore } from "@/lib/store";

export function CompanyPrepPanel() {
  const latestCompanyIntel = useStore((s) => s.latestCompanyIntel);
  const setLatestCompanyIntel = useStore((s) => s.setLatestCompanyIntel);
  const [url, setUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [intel, setIntel] = useState<CompanyIntel | null>(latestCompanyIntel);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleInvestigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setIntel(null);
    setSavedSuccess(false);
    setStatusText("Fetching website content from company servers...");

    try {
      // 1. Scrape & Analyze via engine
      setStatusText("Analyzing with AI brain and correlating with JD...");
      const result = await engine.analyzeCompany(url.trim(), jdText.trim() || null);
      
      setIntel(result);
      setLatestCompanyIntel(result);

      // Auto-sync Active Target Company & JD in settings for live overlay prompt injection
      const { settings, saveSettings } = useStore.getState();
      await saveSettings({
        ...settings,
        targetCompany: result.name,
        targetJd: jdText.trim() ? jdText.trim() : `${result.coreBusiness}\nTech Stack: ${result.techStack.join(", ")}`,
      });

      setStatusText("");
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-8 animate-fadeIn">
      <header>
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Smart Company Investigator</h2>
        </div>
        <p className="text-[13px] text-white/40 mt-1">
          Provide a company's website to crawl and build a comprehensive intelligence profile. The results are automatically indexed in your local RAG database so the live overlay has access during your interview.
        </p>
      </header>

      {/* ---------- input form ---------- */}
      <form onSubmit={(e) => void handleInvestigate(e)} className="space-y-4 rounded-xl border border-white/5 bg-white/[0.02] p-5">
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-white/50 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-accent" /> Company Website URL
          </label>
          <input
            type="text"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            placeholder="google.com or https://google.com"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3.5 py-2 text-[13px] focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-white/50 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-accent" /> Job Description (Optional)
          </label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            disabled={loading}
            placeholder="Paste the Job Description or requirements here to cross-reference and align technical stack and questions..."
            rows={4}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3.5 py-2.5 text-[13px] focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50 transition-colors"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          {loading ? (
            <div className="flex items-center gap-2 text-[12.5px] text-white/60">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              <span>{statusText}</span>
            </div>
          ) : (
            <div />
          )}
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-4 py-2 text-[12.5px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-40 transition-all active:scale-[0.98]"
          >
            <Send className="h-3.5 w-3.5" />
            Investigate Website
          </button>
        </div>
      </form>

      {/* ---------- error state ---------- */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/5 p-4 text-danger animate-shake">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-[12.5px]">
            <h4 className="font-semibold">Investigation Failed</h4>
            <p className="mt-0.5 text-white/60 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* ---------- success feedback ---------- */}
      {savedSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-accent animate-fadeIn">
          <Check className="h-4 w-4" />
          <p className="text-[12.5px]">Company Profile generated and saved to your RAG Knowledge Base successfully!</p>
        </div>
      )}

      {/* ---------- result profile ---------- */}
      {intel && (
        <div className="space-y-6 animate-slideUp">
          <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
            {/* Header info */}
            <div className="border-b border-white/5 bg-white/[0.01] px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-md font-semibold text-accent">{intel.name}</h3>
                <p className="text-[11px] text-white/35 mt-0.5">Automated Intelligence Summary</p>
              </div>
              <button
                onClick={() => {
                  setLatestCompanyIntel(null);
                  setIntel(null);
                  setUrl("");
                  setJdText("");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] font-medium text-danger hover:bg-danger/20 transition-colors"
                title="Delete this company profile from intel HUD and memory"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Intel Profile
              </button>
            </div>

            {/* Content fields */}
            <div className="p-5 space-y-5">
              <div className="space-y-1.5">
                <h4 className="text-[12px] font-semibold text-white/50 flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-accent/80" /> Core Business & Revenue Drivers
                </h4>
                <p className="text-[13px] leading-relaxed text-white/75 bg-black/20 p-3 rounded-lg border border-white/5">
                  {intel.coreBusiness}
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[12px] font-semibold text-white/50 flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 text-accent/80" /> Technical Landscape & Culture
                </h4>
                <p className="text-[13px] leading-relaxed text-white/75 bg-black/20 p-3 rounded-lg border border-white/5">
                  {intel.technicalLandscape}
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[12px] font-semibold text-white/50 flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-accent/80" /> Recent News & Partnerships
                </h4>
                <p className="text-[13px] leading-relaxed text-white/75 bg-black/20 p-3 rounded-lg border border-white/5">
                  {intel.recentNews}
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[12px] font-semibold text-white/50 flex items-center gap-1.5">
                  <Heart className="h-3.5 w-3.5 text-accent/80" /> Why It Matters To You
                </h4>
                <p className="text-[13px] leading-relaxed text-white/75 bg-black/20 p-3 rounded-lg border border-white/5">
                  {intel.whyItMatters}
                </p>
              </div>

              <div className="space-y-1.5 mt-2">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <h4 className="text-[12px] font-semibold text-amber-500/90 flex items-center gap-1.5 mb-2 uppercase tracking-wider">
                    The Golden Formula (60-90s Elevator Pitch)
                  </h4>
                  <p className="text-[13.5px] leading-relaxed text-amber-500/80 italic font-serif">
                    "{intel.goldenFormula}"
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[12px] font-semibold text-white/50 flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 text-accent/80" /> Core Tech Stack &amp; Keywords
                </h4>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {intel.techStack.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-white/70 hover:border-accent/40 hover:text-accent transition-colors"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Expected Interviewer Questions based on JD */}
          {intel.jdInterviewQuestions && intel.jdInterviewQuestions.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-[13.5px] font-semibold text-accent flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-accent" /> Expected Interviewer Questions (Based on JD)
              </h4>
              <p className="text-[12px] text-white/40 leading-relaxed">
                High-probability technical &amp; scenario questions the interviewer is likely to ask you based on this Job Description, along with expert answer keys:
              </p>

              <div className="space-y-3">
                {intel.jdInterviewQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-accent/20 bg-accent/[0.03] p-4.5 space-y-3 hover:border-accent/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 font-mono text-[11px] font-semibold text-accent">
                          {idx + 1}
                        </span>
                        <h5 className="text-[13px] font-semibold text-white/95 leading-snug">{q.question}</h5>
                      </div>
                      <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent shrink-0">
                        {q.category}
                      </span>
                    </div>

                    <div className="pl-7">
                      <div className="rounded-lg bg-black/30 p-3 border border-white/5 space-y-1">
                        <p className="text-[10px] text-accent/80 font-mono uppercase tracking-wider font-semibold">Suggested Answer Key</p>
                        <p className="text-[12.5px] text-white/80 leading-relaxed">{q.suggestedAnswer}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Salary Negotiation Strategy */}
          {intel.salaryNegotiationStrategy && (
            <div className="space-y-3 pt-2">
              <h4 className="text-[13.5px] font-semibold text-emerald-400 flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-emerald-400" /> Salary Negotiation Strategy
              </h4>
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4.5 space-y-2">
                <p className="text-[12.5px] leading-relaxed text-emerald-400/90 font-medium">
                  {intel.salaryNegotiationStrategy}
                </p>
              </div>
            </div>
          )}

          {/* Discussion Questions section */}
          <div className="space-y-3">
            <h4 className="text-[13.5px] font-semibold text-accent flex items-center gap-1.5">
              <MessageCircleQuestion className="h-4 w-4" /> Recommended End-of-Session Discussion Q&amp;A
            </h4>
            <p className="text-[12px] text-white/40 leading-relaxed">
              These strategic questions are designed based on your 16 years of architecture experience, tailored to this company's culture and system footprint. Use them to establish a healthy peer-to-peer discussion:
            </p>
            
            <div className="space-y-3">
              {intel.questions.map((q, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-white/5 bg-white/[0.02] p-4.5 space-y-3 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-between rounded-full bg-accent/20 text-center font-mono text-[11px] font-semibold text-accent pt-[1px] pl-[6px]">
                      {idx + 1}
                    </span>
                    <h5 className="text-[13px] font-semibold text-white/90 leading-snug">{q.question}</h5>
                  </div>
                  
                  <div className="pl-7 space-y-2">
                    <div className="rounded-lg bg-black/25 p-3 border border-white/5">
                      <p className="text-[10px] text-white/35 font-medium uppercase tracking-wider">Strategic Rationale</p>
                      <p className="text-[12.5px] text-white/60 leading-relaxed mt-0.5">{q.context}</p>
                    </div>

                    <div className="rounded-lg bg-black/25 p-3 border border-white/5">
                      <p className="text-[10px] text-white/35 font-medium uppercase tracking-wider">Suggested Points to Bring Up (From Your 16 Years Exp)</p>
                      <ul className="list-disc list-inside text-[12.5px] text-white/60 space-y-1 mt-1 leading-relaxed">
                        {q.suggestedPoints.map((point, pIdx) => (
                          <li key={pIdx}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* HR & Recruiter Intelligence section */}
          {intel.hrQuestions && intel.hrQuestions.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-white/10 mt-6">
              <h4 className="text-[13.5px] font-semibold text-fuchsia-400 flex items-center gap-1.5">
                <Users className="h-4 w-4 text-fuchsia-400" /> HR &amp; Recruiter Intelligence
              </h4>
              <p className="text-[12px] text-white/40 leading-relaxed">
                Specific questions to ask during cultural or HR screening rounds to assess work-life balance, benefits, and company values:
              </p>
              
              <div className="space-y-3">
                {intel.hrQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.03] p-4.5 space-y-3 hover:border-fuchsia-400/30 transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-400/20 font-mono text-[11px] font-semibold text-fuchsia-400">
                        {idx + 1}
                      </span>
                      <h5 className="text-[13px] font-semibold text-white/90 leading-snug">{q.question}</h5>
                    </div>
                    
                    <div className="pl-7 space-y-2">
                      <div className="rounded-lg bg-black/25 p-3 border border-fuchsia-400/10">
                        <p className="text-[10px] text-fuchsia-400/60 font-medium uppercase tracking-wider">Why Ask This</p>
                        <p className="text-[12.5px] text-white/70 leading-relaxed mt-0.5">{q.context}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
