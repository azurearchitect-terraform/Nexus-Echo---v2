import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { engine } from "@/lib/engine";
import { uid } from "@nexus/core";
import * as pdfjsLib from "pdfjs-dist";

// Use CDN for worker to avoid complex bundler configurations with Vite + Tauri
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface DocRow {
  id: string;
  title: string;
  chunks: number;
}

export function KnowledgePanel() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!engine.rag) return;
    setDocs(engine.rag.listDocuments());
  }, []);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Documents", extensions: ["txt", "md", "markdown", "json", "csv", "log", "pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];

    for (const path of paths) {
      const title = path.split(/[/\\]/).pop() ?? path;
      const ext = title.split('.').pop()?.toLowerCase();
      setBusy(title);
      setProgress(0);
      try {
        let text = "";

        if (ext === "pdf") {
          const bytes = await readFile(path);
          const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
          const pages = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pageText = content.items.map((item: any) => item.str).join(" ");
            pages.push(pageText);
          }
          text = pages.join("\n\n");
        } else if (ext === "json") {
          const raw = await readTextFile(path);
          try {
            const parsed = JSON.parse(raw);
            // Format with double newlines so the semantic chunker can cleanly split objects
            if (Array.isArray(parsed)) {
              text = parsed.map(item => JSON.stringify(item, null, 2)).join("\n\n");
            } else {
              text = Object.entries(parsed)
                .map(([k, v]) => `[${k}]:\n${JSON.stringify(v, null, 2)}`)
                .join("\n\n");
            }
          } catch {
            text = raw; // Fallback to raw if invalid JSON
          }
        } else {
          text = await readTextFile(path);
        }

        const docId = uid("doc");
        const chunks = await engine.rag!.addDocument(docId, title, text, (done, total) =>
          setProgress(Math.round((done / total) * 100)),
        );
        setDocs((d) => [...d, { id: docId, title, chunks }]);
      } catch (e) {
        console.error("indexing failed", e);
      } finally {
        setBusy(null);
      }
    }
  };

  const remove = async (id: string) => {
    await engine.rag?.removeDocument(id);
    setDocs((d) => d.filter((doc) => doc.id !== id));
  };

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Knowledge</h2>
          <p className="text-[13px] text-white/40">
            Indexed documents are searched on every question and cited in the answer. Embeddings run
            locally when Ollama is enabled, so nothing here leaves your machine.
          </p>
        </div>
        <button
          onClick={() => void addFiles()}
          disabled={!!busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Add files
        </button>
      </header>

      {busy && (
        <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <div className="flex-1">
            <p className="text-[12.5px]">Indexing {busy}</p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {docs.length === 0 && !busy ? (
        <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-[13px] text-white/30">
          Nothing indexed yet. Add your notes, specs, or a CV and answers start citing them.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5"
            >
              <FileText className="h-4 w-4 shrink-0 text-white/30" />
              <span className="flex-1 truncate text-[13px]">{doc.title}</span>
              <span className="font-mono text-[11px] text-white/30">{doc.chunks} chunks</span>
              <button onClick={() => void remove(doc.id)} className="text-white/30 hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
