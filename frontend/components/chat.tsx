"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { cls } from "@/lib/format";
import { Icon } from "./icons";
import { Btn, Markdown, Notice, ProvChip, useFocusTrap, useToast } from "./ui";

interface Source { id: string; source: string; heading: string; excerpt: string }
interface Msg { role: "user" | "assistant"; text: string; sources?: Source[]; tools?: string[]; cost?: number; error?: string; disabled?: boolean; cached?: boolean }
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");

// page-aware suggestions shown first (answered from the same read-only tools and indexed documents)
const CONTEXT: Record<string, { en: string[]; bn: string[] }> = {
  "/geography/": { en: ["Find hospitals in Gazipur that list a phone number", "How does the A* routing work and how is it verified?"],
                   bn: ["গাজীপুরে ফোন নম্বরসহ হাসপাতাল খুঁজে দাও", "এ-স্টার রুটিং কীভাবে কাজ করে এবং কীভাবে যাচাই করা হয়?"] },
  "/evidence/": { en: ["How often does the outbreak alert miss real outbreaks?", "Why do the intervals under-cover outbreak peaks?"],
                  bn: ["প্রাদুর্ভাব সতর্কতা কত ঘন ঘন আসল প্রাদুর্ভাব মিস করে?", "প্রাদুর্ভাবের শীর্ষে ব্যবধিগুলো কেন কম কভার করে?"] },
  "/command/": { en: ["Which wards have the highest outbreak probability for the selected week?", "What drives this forecast most?"],
                 bn: ["নির্বাচিত সপ্তাহে কোন ওয়ার্ডগুলোর প্রাদুর্ভাবের সম্ভাবনা সবচেয়ে বেশি?", "এই পূর্বাভাসকে সবচেয়ে বেশি কী প্রভাবিত করে?"] },
  "/lab/": { en: ["What does the three-week rainfall lag mean?", "Why is the 4-week forecast more uncertain?"],
             bn: ["তিন সপ্তাহের বৃষ্টির ল্যাগ বলতে কী বোঝায়?", "৪ সপ্তাহের পূর্বাভাসে অনিশ্চয়তা বেশি কেন?"] },
  "/response/": { en: ["Which wards have the highest outbreak probability for the selected week?", "Why should risk tiers not be treated as official warning levels?"],
                  bn: ["নির্বাচিত সপ্তাহে কোন ওয়ার্ডগুলোর প্রাদুর্ভাবের সম্ভাবনা সবচেয়ে বেশি?", "ঝুঁকির স্তরকে কেন সরকারি সতর্কতা স্তর হিসেবে ধরা উচিত নয়?"] },
};
const SUGGEST = {
  en: ["Why was the Poisson GLM chosen instead of LightGBM?", "What does the three-week rainfall lag mean?", "Which wards have the highest predicted outbreak probability?", "Why is the 4-week forecast more uncertain?",
    "What is the difference between MAE and RMSE?", "How reliable are the forecast intervals?", "What limitations does the dataset have?", "Why is this ward considered high risk?"],
  bn: ["লাইটজিবিএমের বদলে পয়সন জিএলএম কেন বেছে নেওয়া হলো?", "তিন সপ্তাহের বৃষ্টির ল্যাগ বলতে কী বোঝায়?", "কোন ওয়ার্ডগুলোর প্রাদুর্ভাবের সম্ভাবনা সবচেয়ে বেশি?", "৪ সপ্তাহের পূর্বাভাসে অনিশ্চয়তা বেশি কেন?",
    "এমএই ও আরএমএসই-র পার্থক্য কী?", "পূর্বাভাসের ব্যবধি কতটা নির্ভরযোগ্য?", "এই ডেটাসেটের সীমাবদ্ধতা কী?", "এই ওয়ার্ডকে উচ্চ ঝুঁকির কেন ধরা হচ্ছে?"],
};

const TOOL_LABEL: Record<string, string> = { get_ward_forecast: "Ward forecast", get_risk_rankings: "Risk rankings", compare_wards: "Ward comparison",
  get_model_metrics: "Validated model metrics", get_feature_importance: "Feature importance", get_data_profile: "Data profile", find_health_facilities: "Hospital directory" };
const CAPS = [{ i: "dashboard", c: "#ffc23d", t: "Forecasts", d: "Any ward, week and horizon" }, { i: "evidence", c: "#3dd598", t: "Evidence", d: "MAE, coverage, alerts" },
  { i: "geography", c: "#ff9ea3", t: "Hospitals", d: "914 OSM facilities" }, { i: "provenance", c: "#8fe3ff", t: "Methods", d: "Cited project documents" }];
// [S1] or [S1, S2] -> fragment links the Markdown renderer turns into citation pills
const withCites = (t: string) => t.replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (_, ids: string) => ids.split(/\s*,\s*/).map((id) => `[${id}](#cite-${id})`).join(""));

function Avatar({ size = 32, pulse = false }: { size?: number; pulse?: boolean }) {
  return (<span className={cls("relative grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald via-forest to-obsidian text-white shadow-[0_6px_18px_-6px_rgba(75,69,209,.8)]", pulse && "ds-avatar-pulse")} style={{ width: size, height: size }}>
    <Icon name="shield" size={Math.round(size * 0.55)} /></span>);
}

// Honest retrieval label: "BM25 only" means plain keyword search (no embeddings are called); "hybrid" adds the semantic index.
const retrievalLabel = (r?: string) => !r ? "keyword search" : r.startsWith("hybrid") ? "keyword + semantic search" : `keyword search only${r.includes("stale") ? " (semantic index out of date)" : ""}`;

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
    const ac = (abort.current = new AbortController());
    let idle = false, wd: ReturnType<typeof setTimeout> | undefined;          // inactivity watchdog: no bytes for 45 s → stop waiting
    const kick = () => { clearTimeout(wd); wd = setTimeout(() => { idle = true; ac.abort(); }, 45_000); };
    kick();
    try {
      const r = await fetch(BASE + "/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ message: text.slice(0, 1200), language: lang, ward_id: sel.ward, origin: sel.origin, horizon: sel.horizon, history: hist }) });
      kick();
      const ctype = r.headers.get("content-type") || "";
      if (!r.ok) { const b = await r.json().catch(() => ({})); upd((m) => ({ ...m, error: b.detail || b.error || `Request failed (${r.status})` })); return; }
      if (ctype.includes("application/json")) { const b = await r.json(); upd((m) => ({ ...m, text: b.message || "", sources: b.sources, disabled: b.enabled === false })); return; }
      const rd = r.body!.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        kick();
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
    } catch (e: any) {
      if (idle) upd((m) => ({ ...m, error: "The assistant stopped responding (no data for 45 seconds). Try again; the rest of DengueShield is unaffected." }));
      else if (e?.name !== "AbortError") upd((m) => ({ ...m, error: "Could not reach the assistant. The rest of DengueShield is unaffected." }));
    }
    finally { clearTimeout(wd); setBusy(false); }
  }
  const path = usePathname() || "/";
  // selection-aware first: questions about the ward and horizon the user is looking at right now
  const selSug = lang === "bn" ? [`${sel.ward}-এর ${sel.horizon} সপ্তাহের পূর্বাভাস এমন কেন?`, `${sel.ward}-এর ${sel.horizon} সপ্তাহের পূর্বাভাস কতটা নির্ভরযোগ্য?`]
    : [`Why is ${sel.ward} forecast this way ${sel.horizon} weeks ahead?`, `How reliable is the ${sel.horizon}-week forecast for ${sel.ward}?`];
  const sug = Array.from(new Set([...selSug, ...(CONTEXT[path]?.[lang] ?? []), ...SUGGEST[lang]])).slice(0, compact ? 4 : 6);
  const openSources = (i: number) => { const d = document.getElementById(`ds-src-${i}`) as HTMLDetailsElement | null; if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "nearest" }); } };
  return (
    <div className={cls("flex flex-col", compact ? "h-full min-h-0" : "h-[calc(100vh-250px)] min-h-[540px]")}>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
        {status && !status.enabled && <Notice tone="warn"><b>{t("copilot.disabled")}.</b> {status.reason_disabled} Retrieved source documents are still shown for each question.</Notice>}
        {msgs.length === 0 && (<div className="ds-chat-hero rounded-3xl p-5 sm:p-6">
          <div className="flex items-center gap-3"><Avatar size={44} />
            <div><div className="text-[17px] font-bold text-white">{t("copilot.title")}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-emerald-100"><span className="ds-status-dot" />{status?.enabled ? `${status.model} · ${retrievalLabel(status.retrieval)}` : `retrieval-only mode (no AI generation) · ${retrievalLabel(status?.retrieval)}`}</div></div></div>
          <p className="mt-3 text-[13px] leading-relaxed text-white/80">{t("copilot.scope")}</p>
          {!compact && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{CAPS.map((c) => (<div key={c.t} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur"><span className="grid h-9 w-9 place-items-center rounded-[10px] border-2 border-[#1a1438] text-[#1a1438] shadow-[2px_2px_0_#1a1438]" style={{ background: c.c }} aria-hidden><Icon name={c.i} size={17} /></span><div className="mt-2 text-[12.5px] font-semibold text-white">{c.t}</div><div className="text-[11px] leading-snug text-white/60">{c.d}</div></div>))}</div>}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">{sug.map((q, i) => (<motion.button key={q} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }} onClick={() => send(q)}
            className="group flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.08] px-3.5 py-2.5 text-left text-[13px] text-white/90 transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-white/[0.14]">
            <span className="mt-0.5 text-emerald-300 transition group-hover:translate-x-0.5" aria-hidden>→</span>{q}</motion.button>))}</div>
          {status?.enabled && <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] text-white/60"><span className="rounded-full border border-white/15 px-2 py-0.5">≤ {status.limits.requests_per_hour_per_session} questions/h</span><span className="rounded-full border border-white/15 px-2 py-0.5">budget cap ${status.limits.budget_usd}</span><span className="rounded-full border border-white/15 px-2 py-0.5">read-only tools</span></div>}
        </div>)}
        {msgs.map((m, i) => {
          const last = i === msgs.length - 1, streaming = busy && last && m.role === "assistant";
          if (m.role === "user") return (<motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
            <div className="max-w-[85%] rounded-3xl rounded-br-md bg-gradient-to-br from-forest to-emerald px-4 py-2.5 text-sm text-white shadow-[0_8px_24px_-12px_rgba(75,69,209,.7)]">{m.text}</div></motion.div>);
          return (<motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2.5">
            <Avatar size={32} pulse={streaming} />
            <div className="min-w-0 max-w-[94%] flex-1">
              <div className="mb-1 flex items-center gap-2 text-[11.5px]"><b className="text-forest">{t("copilot.title")}</b>{streaming && <span className="text-ink-3">thinking with live data…</span>}{m.cached && <span className="rounded-full bg-mint-l px-1.5 text-emerald-d">cached</span>}</div>
              <div className="ds-answer rounded-3xl rounded-tl-md border border-line bg-white px-4 py-3 shadow-[0_10px_30px_-18px_rgba(11,27,46,.35)]">
                {m.tools && m.tools.length > 0 && (<div className="mb-3 rounded-2xl border border-emerald/15 bg-gradient-to-r from-mint-l/70 to-white p-2.5">
                  <div className="eyebrow mb-1.5 text-emerald-d">{t("copilot.tools")}</div>
                  <ol className="space-y-1">{Array.from(new Set(m.tools)).map((x, k, arr) => (<li key={x} className="flex items-center gap-2 text-[12px]">
                    <span className={cls("grid h-4 w-4 place-items-center rounded-full text-[11px] text-white", streaming && k === arr.length - 1 && !m.text ? "animate-pulse bg-amber" : "bg-emerald")}>{streaming && k === arr.length - 1 && !m.text ? "…" : "✓"}</span>
                    <span className="font-medium text-ink">{TOOL_LABEL[x] ?? "Live tool"}</span><code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-ink-3 ring-1 ring-line">{x}</code></li>))}</ol></div>)}
                {m.text && !m.disabled ? <div className={cls(streaming && "ds-streaming")}><Markdown chat onCite={(n) => openSources(i)}>{withCites(m.text)}</Markdown></div>
                  : !m.error && !m.disabled && !m.text && <div className="flex items-center gap-1.5 py-1" aria-label={t("state.loading")}>{[0, 1, 2].map((d) => <motion.span key={d} className="h-2 w-2 rounded-full bg-gradient-to-br from-emerald to-forest" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.9, delay: d * 0.15 }} />)}<WaitHint /></div>}
                {m.disabled && <Notice tone="warn">{m.text}</Notice>}
                {m.error && <Notice tone="warn">{m.error}</Notice>}
                {m.sources && m.sources.length > 0 && (<details id={`ds-src-${i}`} className="group mt-3 rounded-2xl border border-line bg-canvas/70 p-2.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-forest"><span className="grid h-5 w-5 place-items-center rounded-full bg-forest text-[11px] text-white">{m.sources.length}</span>{t("copilot.sources")} ({m.sources.length})<span className="ml-auto text-ink-3 transition group-open:rotate-180">▾</span></summary>
                  <ul className="mt-2.5 grid gap-2">{m.sources.map((s) => (<li key={s.id} className="rounded-xl border border-line bg-white p-2.5 text-xs"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-md bg-gradient-to-br from-emerald to-forest px-1.5 py-0.5 text-[11px] font-bold text-white">{s.id}</span><span className="font-semibold text-ink">{s.source}</span><span className="text-ink-3">› {s.heading}</span></div><p className="mt-1 line-clamp-3 text-ink-3">{s.excerpt}</p></li>))}</ul></details>)}
              </div>
              {m.text && !streaming && <div className="mt-1.5 flex items-center gap-3 pl-1 text-[11px] text-ink-3"><button className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-mint-l hover:text-forest" onClick={() => { navigator.clipboard?.writeText(m.text); toast(t("act.copied")); }}><Icon name="check" size={12} />{t("act.copy")}</button>
                {m.cost !== undefined && <span>≈ ${m.cost.toFixed(4)} (estimate)</span>}</div>}
            </div></motion.div>);
        })}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="ds-composer mt-3 flex items-center gap-2 rounded-full border border-line bg-white p-1.5 pl-4 shadow-[0_10px_30px_-16px_rgba(11,27,46,.4)] focus-within:border-emerald focus-within:ring-4 focus-within:ring-emerald/10">
        <Icon name="copilot" size={18} className="shrink-0 text-emerald" />
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={1200} placeholder={t("copilot.placeholder")} aria-label={t("copilot.placeholder")} className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none" />
        {input.length > 900 && <span className="text-[11px] text-ink-3">{input.length}/1200</span>}
        {busy ? <button type="button" onClick={() => abort.current?.abort()} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white"><span className="h-2.5 w-2.5 rounded-[3px] bg-white" />Stop</button>
          : <button type="submit" disabled={!input.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-emerald to-forest px-4 py-2 text-[13px] font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"><Icon name="send" size={15} />{t("copilot.send")}</button>}
      </form>
      <p className="mt-2 text-center text-[11px] text-ink-3">{sel.ward} · {sel.origin} · {sel.horizon}w — {t("disc.official")}</p>
    </div>);
}

// Copilot launcher in the sticky top bar. It used to be a floating button, which covered the bottom-right of whatever card sat
// there (e.g. the Command Center reliability box on desktop); in the bar it can never obscure content.
export function CopilotLauncher() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const drawer = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(drawer, open, close);
  if ((usePathname() || "").startsWith("/copilot")) return null;      // the full Copilot is already on this page
  return (<>
    <button onClick={() => setOpen(true)} aria-label={t("copilot.title")} aria-haspopup="dialog" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border-2 border-white/35 px-2.5 text-[13px] font-bold text-white transition-colors hover:border-white hover:bg-white/10 sm:min-h-10 xl:px-3">
      <Icon name="copilot" size={17} /><span className="hidden xl:inline">Copilot</span></button>
    <AnimatePresence>{open && (<motion.div className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-forest/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <motion.aside ref={drawer} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("copilot.title")} className="absolute inset-y-0 right-0 flex w-full max-w-[500px] flex-col bg-canvas shadow-pop outline-none" initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: "spring", stiffness: 360, damping: 36 }}>
        <div className="ds-chat-head flex items-center justify-between px-4 py-3"><h2 className="flex items-center gap-2.5 text-base font-semibold text-white"><Avatar size={30} /><span>{t("copilot.title")}<span className="flex items-center gap-1.5 text-[11px] font-normal text-emerald-100"><span className="ds-status-dot" />grounded · read-only tools</span></span></h2>
          <button onClick={() => setOpen(false)} aria-label={t("act.close")} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white"><Icon name="close" /></button></div>
        <div className="min-h-0 flex-1 p-4"><ChatPanel compact /></div></motion.aside></motion.div>)}</AnimatePresence></>);
}

/** Shown under the typing dots once the first words take longer than 6 s (the request is still running; Stop is next to the input). */
function WaitHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(id); }, []);
  return slow ? <span role="status" className="ml-2 text-[12px] text-ink-3">Still waiting for the first words. You can stop and ask again.</span> : null;
}
