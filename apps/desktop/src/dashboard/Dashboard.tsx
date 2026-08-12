import { useEffect, useState } from "react";
import {
  Briefcase,
  Database,
  FileText,
  Gauge,
  KeyRound,
  MessageSquare,
  Puzzle,
  Shield,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { bridge, type Diagnostics } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { SettingsPanel } from "./SettingsPanel";
import { StealthPanel } from "./StealthPanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { MeetingsPanel } from "./MeetingsPanel";
import { PluginsPanel } from "./PluginsPanel";
import { CompanyPrepPanel } from "./CompanyPrepPanel";
import { InterviewPrepPanel } from "./InterviewPrepPanel";

type Tab = "meetings" | "knowledge" | "company" | "interview" | "providers" | "stealth" | "plugins" | "about";

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "meetings", label: "Meetings & chats", icon: <MessageSquare className="h-4 w-4" /> },
  { id: "knowledge", label: "Knowledge", icon: <FileText className="h-4 w-4" /> },
  { id: "company", label: "Company Prep", icon: <Briefcase className="h-4 w-4" /> },
  { id: "interview", label: "Interview Lab", icon: <Sparkles className="h-4 w-4" /> },
  { id: "providers", label: "Providers & routing", icon: <KeyRound className="h-4 w-4" /> },
  { id: "stealth", label: "Stealth & privacy", icon: <Shield className="h-4 w-4" /> },
  { id: "plugins", label: "Plugins", icon: <Puzzle className="h-4 w-4" /> },
  { id: "about", label: "Diagnostics", icon: <Gauge className="h-4 w-4" /> },
];

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("meetings");
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const { ready, settings } = useStore();
  const isBooting = !ready;

  useEffect(() => {
    void bridge.diagnostics().then(setDiag);
  }, [tab]);

  return (
    <div className="flex h-screen bg-[#0a0c11] text-white">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/5 bg-black/30 p-3">
        <div className="mb-6 px-2 pt-2">
          <h1 className="text-sm font-semibold tracking-tight">Nexus-Echo-V2</h1>
          <p className="text-[11px] text-white/30">Local-first · v2.0.1</p>
          {isBooting && <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/20">Starting…</p>}
        </div>

        <nav className="space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-[11px]">
          <Row label="Routing" value={settings.routing.mode} />
          <Row label="Platform" value={diag?.platform ?? "—"} />
          <Row
            label="Capture-proof"
            value={diag?.captureExclusionSupported ? "yes" : "no"}
            tone={diag?.captureExclusionSupported ? "good" : "warn"}
          />
          <div className="flex items-center gap-1.5 pt-1 text-white/30">
            <Database className="h-3 w-3" />
            <span className="truncate" title={diag?.dbPath}>
              stored locally
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {tab === "meetings" && <MeetingsPanel />}
          {tab === "knowledge" && <KnowledgePanel />}
          {tab === "company" && <CompanyPrepPanel />}
          {tab === "interview" && <InterviewPrepPanel />}
          {tab === "providers" && <SettingsPanel />}
          {tab === "stealth" && <StealthPanel />}
          {tab === "plugins" && <PluginsPanel />}
          {tab === "about" && <DiagnosticsPanel diag={diag} />}
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/35">{label}</span>
      <span className={cn(tone === "good" ? "text-accent" : tone === "warn" ? "text-warn" : "text-white/60")}>
        {value}
      </span>
    </div>
  );
}

function DiagnosticsPanel({ diag }: { diag: Diagnostics | null }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">Diagnostics</h2>
        <p className="text-[13px] text-white/40">Everything below is read from the running process.</p>
      </header>

      <dl className="space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-[13px]">
        <Entry k="Platform" v={diag?.platform ?? "—"} />
        <Entry k="Capture exclusion" v={diag?.captureExclusionSupported ? "supported" : "not supported"} />
        <Entry k="Listening" v={diag?.listening ? "active" : "idle"} />
        <Entry k="Database" v={diag?.dbPath ?? "—"} />
      </dl>

      <div className="rounded-xl border border-danger/20 bg-danger/5 p-4">
        <h3 className="text-[13px] font-medium text-danger">Erase everything</h3>
        <p className="mt-1 text-[12px] text-white/50">
          Deletes every chat, meeting, transcript, and indexed document from this machine. Provider
          keys in the OS keychain are not touched. This cannot be undone.
        </p>
        {confirming ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void bridge.wipeAllData().then(() => setConfirming(false))}
              className="rounded-lg bg-danger px-3 py-1.5 text-[12px] font-medium text-black"
            >
              Yes, erase it all
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg border border-danger/30 px-3 py-1.5 text-[12px] text-danger"
          >
            Erase all local data
          </button>
        )}
      </div>
    </section>
  );
}

function Entry({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/40">{k}</dt>
      <dd className="truncate font-mono text-[12px] text-white/70">{v}</dd>
    </div>
  );
}
