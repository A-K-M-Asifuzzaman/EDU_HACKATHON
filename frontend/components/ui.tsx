"use client";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { ApiError, TIER_COLOR, type Tier } from "@/lib/api";
import { cls, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./icons";

// ------------------------------------------------------------------ data hook (abortable, with reload)
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    set((s) => ({ ...s, loading: true, error: null }));
    fn(ac.signal).then((data) => { if (!ac.signal.aborted) set({ data, error: null, loading: false }); })
      .catch((e) => { if (e?.name !== "AbortError" && !ac.signal.aborted) set({ data: null, error: e, loading: false }); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((x) => x + 1) };
}

// ------------------------------------------------------------------ layout atoms
export function Card({ children, className = "", pad = true, as: As = "section", ...rest }: any) {
  return <As className={cls("card", pad && "p-5", className)} {...rest}>{children}</As>;
}
export function CardTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (<div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-[15px] font-semibold text-navy">{title}</h2>{sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}</div>{right}</div>);
}
export function PageHeader({ title, sub, right, eyebrow }: { title: string; sub?: string; right?: React.ReactNode; eyebrow?: string }) {
  return (<header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <div className="eyebrow mb-1.5 flex items-center gap-2 text-teal"><span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_0_3px_rgba(43,181,207,0.18)]" />{eyebrow}</div>}<h1 className="text-[27px] font-bold tracking-[-0.02em] text-navy sm:text-[32px]">{title}</h1>
    {sub && <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-ink-2">{sub}</p>}</div>{right}</header>);
}
export const Skeleton = ({ h = 20, w = "100%", className = "" }: { h?: number; w?: number | string; className?: string }) => <div className={cls("skeleton", className)} style={{ height: h, width: w }} aria-hidden="true" />;

export function ErrorState({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  const { t } = useI18n();
  const msg = typeof error === "string" ? error : error.message;
  return (<div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-coral/30 bg-coral/5 p-4 text-sm"><div className="flex items-center gap-2 font-medium text-coral-d"><Icon name="alert" size={18} />{t("state.error")}</div>
    <p className="text-ink-2">{msg}</p>{onRetry && <Btn variant="ghost" onClick={onRetry}>{t("state.retry")}</Btn>}</div>);
}
export const EmptyState = ({ text }: { text?: string }) => { const { t } = useI18n(); return <div className="grid place-items-center rounded-xl border border-dashed border-line p-8 text-sm text-ink-3">{text ?? t("state.empty")}</div>; };
export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: React.ReactNode }) {
  const c = { info: "border-sky/30 bg-sky/5 text-ink-2", warn: "border-amber/50 bg-amber/10 text-ink-2", ok: "border-emerald/30 bg-mint-l text-ink-2" }[tone];
  return <div className={cls("flex gap-2 rounded-xl border p-3 text-[13px] leading-relaxed", c)}><Icon name={tone === "warn" ? "alert" : "info"} size={16} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

export function Loading<T>({ q, children, h = 220 }: { q: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode; h?: number }) {
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Skeleton h={h} />;
  return <>{children(q.data)}</>;
}

// ------------------------------------------------------------------ KPI with count-up
export function CountUp({ value, digits = 0, suffix = "" }: { value: number; digits?: number; suffix?: string }) {
  const { lang } = useI18n();
  const reduce = useReducedMotion();
  const [v, setV] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (reduce) { setV(value); prev.current = value; return; }
    const c = animate(prev.current, value, { duration: 0.7, ease: "easeOut", onUpdate: (x) => setV(x) });
    prev.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <span className="num">{num(v, lang, digits)}{suffix}</span>;
}
export function Kpi({ label, value, digits = 0, suffix, hint, tone, loading }: { label: string; value?: number | null; digits?: number; suffix?: string; hint?: string; tone?: "ok" | "warn" | "bad"; loading?: boolean }) {
  const bar = { ok: "bg-emerald", warn: "bg-amber", bad: "bg-coral" }[tone ?? "ok"];
  return (<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="card card-hover relative overflow-hidden p-4">
    <span className={cls("absolute inset-x-4 top-0 h-[3px] rounded-b-full", bar)} /><div className="eyebrow">{label}</div>
    <div className="mt-2 text-[30px] font-bold leading-none tracking-[-0.02em] text-navy">{loading || value === undefined || value === null ? <Skeleton h={30} w={90} /> : <CountUp value={value} digits={digits} suffix={suffix} />}</div>
    {hint && <div className="mt-1.5 text-xs text-ink-3">{hint}</div>}</motion.div>);
}

// ------------------------------------------------------------------ risk
export function RiskBadge({ tier, size = "md", pulse }: { tier: Tier; size?: "sm" | "md" | "lg"; pulse?: boolean }) {
  const { t } = useI18n();
  const pad = { sm: "px-2 py-0.5 text-[11px]", md: "px-2.5 py-1 text-xs", lg: "px-3.5 py-1.5 text-sm" }[size];
  return (<span className={cls("inline-flex items-center gap-1.5 rounded-full font-semibold text-white", pad, pulse && tier === "Critical" && "pulse-critical")} style={{ background: TIER_COLOR[tier] }} title={t("risk.note")}>
    <span className="h-1.5 w-1.5 rounded-full bg-white/90" />{t(`risk.${tier.toLowerCase()}`)}</span>);
}

// ------------------------------------------------------------------ controls
export function Btn({ children, variant = "solid", className = "", ...p }: any) {
  const v = { solid: "bg-emerald text-white hover:bg-emerald-d shadow-sm", ghost: "bg-white text-forest border border-line hover:bg-mint-l", dark: "bg-forest text-white hover:bg-forest-2", danger: "bg-coral-d text-white hover:bg-coral shadow-sm" }[variant as string];
  return <button className={cls("inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium transition active:scale-[0.98] disabled:opacity-50", v, className)} {...p}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-[120px] max-w-full flex-col gap-1"><span className="eyebrow">{label}</span>{children}</label>;
}
export function Select({ label, value, onChange, options }: { label: string; value: string | number; onChange: (v: string) => void; options: { value: string | number; label: string }[] }) {
  return (<Field label={label}><div className="relative"><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none rounded-xl border border-line bg-white py-2 pl-3 pr-8 text-sm text-ink shadow-sm hover:border-emerald/50">
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><Icon name="chevron" size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" /></div></Field>);
}
export function Segmented<T extends string | number>({ label, value, onChange, options }: { label?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (<div className="flex flex-col gap-1">{label && <span className="eyebrow">{label}</span>}<div role="radiogroup" aria-label={label} className="scroll-thin inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-white p-0.5 shadow-sm">
    {options.map((o) => (<button key={String(o.value)} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
      className={cls("relative shrink-0 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition", o.value === value ? "bg-forest text-white" : "text-ink-2 hover:bg-mint-l")}>{o.label}</button>))}</div></div>);
}
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (<div role="tablist" className="scroll-thin -mx-1 mb-5 flex snap-x gap-1 overflow-x-auto overscroll-x-contain px-1 pb-1">{tabs.map((x) => (
    <button key={x.id} role="tab" aria-selected={x.id === value} onClick={() => onChange(x.id)} className={cls("relative shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-medium transition", x.id === value ? "text-forest" : "text-ink-3 hover:text-forest")}>
      {x.id === value && <motion.span layoutId="tabpill" className="absolute inset-0 rounded-xl bg-mint-l ring-1 ring-mint" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}<span className="relative">{x.label}</span></button>))}</div>);
}
export const ProvChip = ({ children, tone = "ok" }: { children: React.ReactNode; tone?: "ok" | "warn" | "info" }) => (
  <span className={cls("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", tone === "ok" && "border-emerald/25 bg-mint-l text-emerald-d", tone === "warn" && "border-amber/50 bg-amber/10 text-amber-d", tone === "info" && "border-sky/25 bg-sky/10 text-sky")}>{children}</span>);

// ------------------------------------------------------------------ toast + modal
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string }[]>([]);
  const push = useCallback((m: string) => { const id = Date.now() + Math.random(); setItems((x) => [...x, { id, m }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200); }, []);
  return (<ToastCtx.Provider value={push}>{children}<div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 flex-col gap-2">
    <AnimatePresence>{items.map((i) => (<motion.div key={i.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="rounded-xl bg-forest px-4 py-2.5 text-[13px] text-white shadow-pop">{i.m}</motion.div>))}</AnimatePresence></div></ToastCtx.Provider>);
}
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open, onClose]);
  return (<AnimatePresence>{open && (<motion.div className="fixed inset-0 z-[70] grid place-items-center bg-forest/40 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, opacity: 0 }}
      className={cls("card max-h-[88vh] w-full overflow-auto p-6", wide ? "max-w-4xl" : "max-w-xl")}><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold text-forest">{title}</h2>
      <button aria-label={t("act.close")} onClick={onClose} className="rounded-lg p-1.5 hover:bg-mint-l"><Icon name="close" /></button></div>{children}</motion.div></motion.div>)}</AnimatePresence>);
}
/** Resolve a relative Markdown link against the document that contains it. */
function resolveDoc(from: string, href: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of href.split("#")[0].split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
}
export function Markdown({ children, docPath, docs, onDoc, chat, onCite }: { children: string; docPath?: string; docs?: string[]; onDoc?: (path: string) => void; chat?: boolean; onCite?: (id: string) => void }) {
  const sectionId = (slug: string) => `doc-section-${docPath}-${slug}`;
  return <div className={cls("prose-md text-[13.5px] leading-relaxed", chat && "prose-chat")}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}
    components={{ h2: ({ children }) => {
      const slug = String(children).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, "-");
      return <h2 id={docPath ? sectionId(slug) : undefined} tabIndex={docPath ? -1 : undefined}>{children}</h2>;
    }, a: ({ href, children }) => {
      const cite = href?.match(/cite-(S\d+)$/);
      if (onCite && cite) return <button type="button" onClick={() => onCite(cite[1])} className="ds-cite" title={`Show source ${cite[1]}`}>{cite[1]}</button>;
      if (docPath && href?.startsWith("#")) {
        const id = sectionId(href.slice(1));
        return <a href={`#${id}`} onClick={(e) => {
          e.preventDefault();
          const heading = document.getElementById(id);
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: "start" });
        }} className="text-emerald-d underline">{children}</a>;
      }
      const rel = !!href && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href);
      if (docPath && onDoc && rel) {
        const target = resolveDoc(docPath, href!);
        if (target && docs?.includes(target)) return <a href={`#${target}`} onClick={(e) => { e.preventDefault(); onDoc(target); }} className="text-emerald-d underline">{children}</a>;
        return <span title="Not available in the in-app viewer; see the repository">{children}</span>;
      }
      return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-emerald-d underline">{children}</a>;
    } }}>{children}</ReactMarkdown></div>;
}
// first column stays visible while a wide table scrolls sideways (phones), with a soft edge shadow
const STICKY = "sticky left-0 shadow-[6px_0_8px_-8px_rgba(11,27,46,0.35)]";
export function DataTable<T extends Record<string, any>>({ rows, cols, onRow, maxH = 420, dense }: { rows: T[]; cols: { key: string; label: string; render?: (r: T) => React.ReactNode; align?: "right"; sort?: (r: T) => number | string }[]; onRow?: (r: T) => void; maxH?: number; dense?: boolean }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const sorted = sort ? [...rows].sort((a, b) => { const c = cols.find((x) => x.key === sort.k)!; const f = c.sort ?? ((r: T) => r[sort.k]); const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; }) : rows;
  return (<div className="scroll-thin overflow-auto rounded-xl border border-line" style={{ maxHeight: maxH }}><table className="w-full border-collapse text-[13px]"><thead className="sticky top-0 z-10 bg-[#f1f5f9] text-left">
    <tr>{cols.map((c, ci) => (<th key={c.key} scope="col" aria-sort={sort?.k === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cls("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2", c.align === "right" && "text-right", ci === 0 && STICKY, ci === 0 && "z-20 bg-[#f1f5f9]")}>
      <button className="inline-flex items-center gap-1 hover:text-forest" onClick={() => setSort((s) => (s?.k === c.key ? { k: c.key, dir: (s.dir * -1) as 1 | -1 } : { k: c.key, dir: -1 }))}>{c.label}{sort?.k === c.key && <span aria-hidden>{sort.dir === 1 ? "▲" : "▼"}</span>}</button></th>))}</tr></thead>
    <tbody>{sorted.map((r, i) => (<tr key={i} onClick={() => onRow?.(r)} className={cls("group border-t border-line transition hover:bg-mint-l/60", onRow && "cursor-pointer")}>{cols.map((c, ci) => (
      <td key={c.key} className={cls("px-3", dense ? "py-1.5" : "py-2.5", c.align === "right" && "num text-right", ci === 0 && STICKY, ci === 0 && "z-[1] bg-white group-hover:bg-[#f0faf5]")}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>))}</tr>))}</tbody></table></div>);
}
