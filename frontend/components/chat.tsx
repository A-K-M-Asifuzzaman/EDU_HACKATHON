"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { cls } from "@/lib/format";
import { Icon } from "./icons";
import { Btn, Markdown, Notice, ProvChip, useToast } from "./ui";

interface Source { id: string; source: string; heading: string; excerpt: string }
interface Msg { role: "user" | "assistant"; text: string; sources?: Source[]; tools?: string[]; cost?: number; error?: string; disabled?: boolean; cached?: boolean }
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");

const SUGGEST = {
  en: ["Why was the Poisson GLM chosen instead of LightGBM?", "What does the three-week rainfall lag mean?", "Which wards have the highest predicted outbreak probability?", "Why is the 4-week forecast more uncertain?",
    "What is the difference between MAE and RMSE?", "How reliable are the forecast intervals?", "What limitations does the dataset have?", "Why is this ward considered high risk?"],
  bn: ["লাইটজিবিএমের বদলে পয়সন জিএলএম কেন বেছে নেওয়া হলো?", "তিন সপ্তাহের বৃষ্টির ল্যাগ বলতে কী বোঝায়?", "কোন ওয়ার্ডগুলোর প্রাদুর্ভাবের সম্ভাবনা সবচেয়ে বেশি?", "৪ সপ্তাহের পূর্বাভাসে অনিশ্চয়তা বেশি কেন?",
    "এমএই ও আরএমএসই-র পার্থক্য কী?", "পূর্বাভাসের ব্যবধি কতটা নির্ভরযোগ্য?", "এই ডেটাসেটের সীমাবদ্ধতা কী?", "এই ওয়ার্ডকে উচ্চ ঝুঁকির কেন ধরা হচ্ছে?"],
};

export function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const { sel } = useSel();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { api("/api/assistant/status", { ttl: 60_000 }).then(setStatus).catch(() => setStatus({ enabled: false, reason_disabled: "API unreachable" })); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  useEffect(() => () => abort.current?.abort(), []);

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    const hist = msgs.slice(-4).map((m) => ({ role: m.role, content: m.text.slice(0, 400) }));
    setMsgs((m) => [...m, { role: "user", text }, { role: "assistant", text: "", tools: [] }]);
    const upd = (f: (m: Msg) => Msg) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? f(x) : x)));
    abort.current = new AbortController();
    try {
      const r = await fetch(BASE + "/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal,
        body: JSON.stringify({ message: text.slice(0, 1200), language: lang, ward_id: sel.ward, origin: sel.origin, horizon: sel.horizon, history: hist }) });
      const ctype = r.headers.get("content-type") || "";
      if (!r.ok) { const b = await r.json().catch(() => ({})); upd((m) => ({ ...m, error: b.detail || b.error || `Request failed (${r.status})` })); return; }
      if (ctype.includes("application/json")) { const b = await r.json(); upd((m) => ({ ...m, text: b.message || "", sources: b.sources, disabled: b.enabled === false })); return; }
      const rd = r.body!.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith("data:")) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "sources") upd((m) => ({ ...m, sources: ev.sources }));
          else if (ev.type === "delta") upd((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.type === "tool") upd((m) => ({ ...m, tools: [...(m.tools || []), ev.name] }));
          else if (ev.type === "done") upd((m) => ({ ...m, cost: ev.usage?.est_cost_usd, cached: ev.cached }));
          else if (ev.type === "error") upd((m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (e: any) { if (e?.name !== "AbortError") upd((m) => ({ ...m, error: "Could not reach the assistant. The rest of DengueShield is unaffected." })); }
    finally { setBusy(false); }
  }
  const sug = SUGGEST[lang];
  return (
    <div className={cls("flex flex-col", compact ? "h-full" : "h-[calc(100vh-190px)] min-h-[520px]")}>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
        {status && !status.enabled && <Notice tone="warn"><b>{t("copilot.disabled")}.</b> {status.reason_disabled} Retrieved source documents are still shown for each question.</Notice>}
        {msgs.length === 0 && (<div className="space-y-3">
          <p className="text-sm text-ink-2">{t("copilot.scope")}</p>
          {status?.enabled && <div className="flex flex-wrap gap-1.5"><ProvChip tone="info">{status.model}</ProvChip><ProvChip>{status.retrieval}</ProvChip><ProvChip tone="warn">≤ {status.limits.requests_per_hour_per_session}/h · cap ${status.limits.budget_usd}</ProvChip></div>}
          <div className="flex flex-wrap gap-2">{sug.map((q) => (<button key={q} onClick={() => send(q)} className="rounded-xl border border-line bg-white px-3 py-2 text-left text-[13px] text-ink-2 shadow-sm transition hover:border-emerald/40 hover:bg-mint-l">{q}</button>))}</div></div>)}
        {msgs.map((m, i) => (<motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
          <div className={cls("max-w-[92%] rounded-2xl px-4 py-3", m.role === "user" ? "bg-forest text-white" : "card")}>
            {m.role === "user" ? <p className="text-sm">{m.text}</p> : (<>
              {m.tools && m.tools.length > 0 && <div className="mb-2 flex flex-wrap gap-1"><span className="eyebrow mr-1">{t("copilot.tools")}</span>{Array.from(new Set(m.tools)).map((x) => <ProvChip key={x} tone="info">{x}</ProvChip>)}</div>}
              {m.text && !m.disabled ? <Markdown>{m.text}</Markdown> : !m.error && !m.disabled && !m.text && <div className="flex gap-1 py-1" aria-label={t("state.loading")}>{[0, 1, 2].map((d) => <motion.span key={d} className="h-2 w-2 rounded-full bg-emerald" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ repeat: Infinity, duration: 1, delay: d * 0.18 }} />)}</div>}
              {m.disabled && <Notice tone="warn">{m.text}</Notice>}
              {m.error && <Notice tone="warn">{m.error}</Notice>}
              {m.sources && m.sources.length > 0 && (<details className="mt-3 rounded-xl bg-canvas p-2.5"><summary className="cursor-pointer text-xs font-semibold text-forest">{t("copilot.sources")} ({m.sources.length})</summary>
                <ul className="mt-2 space-y-2">{m.sources.map((s) => (<li key={s.id} className="text-xs"><b className="text-emerald-d">[{s.id}]</b> <span className="font-medium">{s.source}</span> › {s.heading}<p className="mt-0.5 line-clamp-3 text-ink-3">{s.excerpt}</p></li>))}</ul></details>)}
              {m.text && <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3"><button className="inline-flex items-center gap-1 hover:text-forest" onClick={() => { navigator.clipboard?.writeText(m.text); toast(t("act.copied")); }}><Icon name="check" size={12} />{t("act.copy")}</button>
                {m.cached && <span>cached</span>}{m.cost !== undefined && <span>≈ ${m.cost.toFixed(4)} (estimate)</span>}</div>}</>)}
          </div></motion.div>))}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={1200} placeholder={t("copilot.placeholder")} aria-label={t("copilot.placeholder")} className="min-w-0 flex-1 rounded-xl border border-line bg-white px-4 py-2.5 text-sm shadow-sm focus:border-emerald" />
        <Btn type="submit" disabled={busy || !input.trim()}><Icon name="send" size={16} />{t("copilot.send")}</Btn></form>
      <p className="mt-2 text-[11px] text-ink-3">{sel.ward} · {sel.origin} · {sel.horizon}w — {t("disc.official")}</p>
    </div>);
}

export function CopilotFab() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (<>
    <button onClick={() => setOpen(true)} aria-label={t("copilot.title")} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-emerald to-forest px-4 py-3 text-sm font-semibold text-white shadow-pop transition hover:scale-[1.03] active:scale-95">
      <Icon name="copilot" size={18} /><span className="hidden sm:inline">{t("copilot.title")}</span></button>
    <AnimatePresence>{open && (<motion.div className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-forest/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <motion.aside role="dialog" aria-label={t("copilot.title")} className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col bg-canvas p-4 shadow-pop" initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: "spring", stiffness: 360, damping: 36 }}>
        <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-base font-semibold text-forest"><Icon name="copilot" />{t("copilot.title")}</h2>
          <button onClick={() => setOpen(false)} aria-label={t("act.close")} className="rounded-lg p-1.5 hover:bg-mint-l"><Icon name="close" /></button></div>
        <ChatPanel compact /></motion.aside></motion.div>)}</AnimatePresence></>);
}
