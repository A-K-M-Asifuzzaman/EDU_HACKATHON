"use client";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Cloud } from "./illustrations";
import dynamic from "next/dynamic";
import { ApiError, retryable, TIER_COLOR, TIER_TEXT, type Tier } from "@/lib/api";
import { cls, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./icons";
import { useSel } from "@/lib/ctx";

// ------------------------------------------------------------------ data hook: real request states (no fake progress)
// loading → delayed (still waiting after DELAY_MS) → retrying (network, timeout or 5xx only; backoff) → ready | failed.
// A change of inputs aborts the previous request, so an outdated response can never overwrite a newer selection; previous data stay
// on screen marked `stale` (rendered dimmed with "Updating") until the new response arrives.
export type ReqStatus = "loading" | "delayed" | "retrying" | "ready" | "failed";
export const DELAY_MS = 2500;
const BACKOFF_MS = [1500, 4000];
export type AsyncState<T> = { data: T | null; error: ApiError | null; loading: boolean; status: ReqStatus; attempt: number; stale: boolean; reload: () => void };
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[], opts: { retries?: number } = {}): AsyncState<T> {
  const retries = opts.retries ?? BACKOFF_MS.length;
  const [state, set] = useState<{ data: T | null; error: ApiError | null; status: ReqStatus; attempt: number; stale: boolean }>({ data: null, error: null, status: "loading", attempt: 0, stale: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    let slow: ReturnType<typeof setTimeout> | undefined, wait: ReturnType<typeof setTimeout> | undefined;
    const run = (attempt: number) => {
      set((s) => ({ ...s, status: attempt ? "retrying" : "loading", attempt, error: null, stale: s.data != null }));
      if (!attempt) slow = setTimeout(() => set((s) => (s.status === "loading" ? { ...s, status: "delayed" } : s)), DELAY_MS);
      fn(ac.signal).then((data) => { if (!ac.signal.aborted) { clearTimeout(slow); set({ data, error: null, status: "ready", attempt, stale: false }); } })
        .catch((e) => {
          if (e?.name === "AbortError" || ac.signal.aborted) return;
          if (attempt < retries && retryable(e)) { wait = setTimeout(() => !ac.signal.aborted && run(attempt + 1), BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]); set((s) => ({ ...s, status: "retrying", attempt: attempt + 1, error: e })); return; }
          clearTimeout(slow);
          set((s) => ({ ...s, data: null, error: e instanceof ApiError ? e : new ApiError(String(e?.message ?? e), 0, "parse"), status: "failed", attempt, stale: false }));
        });
    };
    run(0);
    return () => { ac.abort(); clearTimeout(slow); clearTimeout(wait); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, loading: state.status !== "ready" && state.status !== "failed", reload: () => setTick((x) => x + 1) };
}

// ------------------------------------------------------------------ layout atoms
export function Card({ children, className = "", pad = true, as: As = "section", ...rest }: any) {
  return <As className={cls("card", pad && "p-5", className)} {...rest}>{children}</As>;
}
export function CardTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (<div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-[15px] font-semibold text-ink">{title}</h2>{sub && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{sub}</p>}</div>{right}</div>);
}
export function PageHeader({ title, sub, right, eyebrow, art }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; eyebrow?: string; art?: React.ReactNode }) {
  // Night masthead (DESIGN.md §1): a full-bleed obsidian band carries every page title; the page's working surface follows on porcelain.
  return (<header className="night relative -mt-6 mb-8 mx-[calc(50%-50vw)] overflow-hidden px-[calc(50vw-50%)]">
        <div className="relative grid gap-x-10 gap-y-3 py-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-3 text-[12.5px] font-medium text-ink-3">{eyebrow}</div>}
        <h1 className="sf-fade text-[34px] leading-[0.98] text-ink sm:text-[44px] lg:text-[52px]">{title}</h1>
        {sub && <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed text-ink-2">{sub}</p>}</div>
      {(right || art) && <div className="relative flex items-end gap-6">{right}{art && <div className="sf-fade hidden w-[150px] shrink-0 sm:block lg:w-[190px]">{art}</div>}</div>}
    </div></header>);
}
export const Skeleton = ({ h = 20, w = "100%", className = "" }: { h?: number; w?: number | string; className?: string }) => <div className={cls("skeleton", className)} style={{ height: h, width: w }} aria-hidden="true" />;

export function ErrorState({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  const { t } = useI18n();
  const msg = typeof error === "string" ? error : error.message;
  return (<div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-coral/30 bg-coral/5 p-4 text-sm"><div className="flex items-center gap-2 font-medium text-coral-d"><Icon name="alert" size={18} />{t("state.error")}</div>
    <p className="text-ink-2">{msg}</p>{onRetry && <Btn variant="ghost" onClick={onRetry}>{t("state.retry")}</Btn>}</div>);
}
export const EmptyState = ({ text }: { text?: string }) => { const { t } = useI18n(); return <div className="flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed border-line p-6 text-center text-sm text-ink-3"><Cloud mood="thinking" rain={false} className="w-24" /><span>{text ?? t("state.empty")}</span></div>; };
export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: React.ReactNode }) {
  const c = { info: "border-sky/30 bg-sky/5 text-ink-2", warn: "border-amber/50 bg-amber/10 text-ink-2", ok: "border-emerald/30 bg-mint-l text-ink-2" }[tone];
  return <div className={cls("flex gap-2 rounded-xl border p-3 text-[13px] leading-relaxed", c)}><Icon name={tone === "warn" ? "alert" : "info"} size={16} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

// ------------------------------------------------------------------ loading library (layout-preserving, honest status, retry)
export function ChartSkeleton({ h = 220 }: { h?: number }) {
  return (<div className="relative overflow-hidden rounded-control" style={{ height: h }} aria-hidden="true">
    <div className="absolute inset-y-3 left-8 w-px bg-line" /><div className="absolute bottom-6 left-8 right-3 h-px bg-line" />
    {[0.25, 0.5, 0.75].map((y) => <div key={y} className="absolute left-8 right-3 h-px bg-line/50" style={{ bottom: `calc(24px + ${y} * (100% - 36px))` }} />)}
    <div className="skeleton absolute bottom-7 left-10 right-4 top-4 opacity-60" /></div>);
}
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (<div className="overflow-hidden rounded-control border border-line" aria-hidden="true"><div className="skeleton h-8 rounded-none opacity-80" />
    {Array.from({ length: rows }, (_, i) => <div key={i} className="flex gap-3 border-t border-line px-3 py-2.5"><div className="skeleton h-3 w-1/4" /><div className="skeleton h-3 w-1/3" /><div className="skeleton ml-auto h-3 w-14" /></div>)}</div>);
}
export function ForecastSkeleton({ h = 300 }: { h?: number }) {
  return (<div className="flex flex-col gap-3" style={{ minHeight: h }} aria-hidden="true">
    <div className="skeleton h-5 w-2/3" /><div className="skeleton h-3 w-1/2" />
    <div className="flex items-center gap-4"><div className="skeleton h-20 w-20 rounded-full" /><div className="flex flex-1 flex-col gap-2"><div className="skeleton h-8 w-24" /><div className="skeleton h-3 w-3/4" /><div className="skeleton h-5 w-28" /></div></div>
    <div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-5/6" /></div>);
}
const SKEL = { chart: ChartSkeleton, table: TableSkeleton, forecast: ForecastSkeleton, block: ({ h = 220 }: { h?: number }) => <Skeleton h={h} /> };
const why = (e: ApiError) => e.kind === "timeout" ? "The service did not answer in time."
  : e.kind === "network" ? "The DengueShield service could not be reached."
  : e.kind === "server" ? `The service reported an error (${e.status}).` : e.message;

/** Status line shown under a skeleton: only states the request is actually in. Announced politely to screen readers. */
export function RequestStatus({ q, label, dark = false }: { q: Pick<AsyncState<unknown>, "status" | "attempt" | "error">; label: string; dark?: boolean }) {
  const msg = q.status === "delayed" ? `${label}: taking longer than usual. Still waiting for the service…`
    : q.status === "retrying" ? `${label}: ${q.error ? why(q.error) + " " : ""}Retrying (attempt ${q.attempt + 1} of ${BACKOFF_MS.length + 1})…`
    : `Loading ${label.toLowerCase()}…`;
  return (<p role="status" aria-live="polite" className={cls("flex items-center gap-2 font-mono text-[11.5px]", q.status === "loading" ? "sr-only" : cls("mt-2", dark ? "text-white/75" : "text-ink-2"))}>
    <span className={cls("h-1.5 w-1.5 rounded-full", q.status === "retrying" ? "bg-amber" : "bg-cyan")} aria-hidden />{msg}</p>);
}

/** Failure panel: what happened (from the real error), a retry, and somewhere useful to go that does not depend on this request. */
export function ServiceUnavailable({ error, onRetry, label = "This data" }: { error: ApiError | Error | string; onRetry?: () => void; label?: string }) {
  const e = error instanceof ApiError ? error : new ApiError(typeof error === "string" ? error : error.message, 0, "parse");
  const { set } = useSel();
  // A 4xx answer is the server explaining that this selection has no such result (for example an origin outside the 2019-2024 replay).
  // Retrying cannot help, so say so calmly and offer a selection that has one, instead of presenting it as an outage.
  if (e.kind === "client" && e.status !== 429) {
    const replay = /2019.{0,4}2024|replay|validation origin/i.test(e.message);
    return (<div role="status" className="card flex flex-col items-start gap-3 p-5 text-[14px] sm:flex-row sm:items-center">
      <Cloud mood="thinking" rain={false} className="w-20 shrink-0" />
      <div className="min-w-0 flex-1"><div className="font-display text-[17px] font-extrabold text-ink">{label} is not available for this selection</div>
        <p className="mt-1 text-ink-2">{e.message.charAt(0).toUpperCase() + e.message.slice(1)}{/[.!]$/.test(e.message) ? "" : "."}</p></div>
      {replay && <button onClick={() => set({ origin: "2024-08-05" })} className="btn-ghost inline-flex min-h-11 shrink-0 items-center px-4 text-[13.5px]">Go to the August 2024 peak</button>}
    </div>);
  }
  return (<div role="alert" className="card border-coral-d p-5 text-[14px]">
    <div className="flex items-center gap-2 font-display text-[17px] font-extrabold text-coral-d"><Icon name="alert" size={18} />{label} is unavailable right now</div>
    <p className="mt-1 text-ink-2">{why(e)}{e.kind === "server" ? "" : " Other pages that do not need this request keep working."}</p>
    <div className="mt-3 flex flex-wrap gap-2">{onRetry && <Btn variant="ghost" onClick={onRetry}>Try again</Btn>}
      <a href="/evidence/" className="inline-flex min-h-11 items-center px-3 text-[13.5px] font-bold text-emerald-d underline underline-offset-4 sm:min-h-9">Model evidence (saved results)</a></div></div>);
}

export function Loading<T>({ q, children, h = 220, kind = "block", label = "Data" }: { q: AsyncState<T> | { data: T | null; error: ApiError | null; loading: boolean; reload: () => void; status?: ReqStatus; attempt?: number; stale?: boolean };
  children: (d: T) => React.ReactNode; h?: number; kind?: keyof typeof SKEL; label?: string }) {
  const st = { status: (q as AsyncState<T>).status ?? (q.loading ? "loading" : q.error ? "failed" : "ready"), attempt: (q as AsyncState<T>).attempt ?? 0, error: q.error } as const;
  if (q.error && st.status === "failed") return <ServiceUnavailable error={q.error} onRetry={q.reload} label={label} />;
  if (!q.data) { const S = SKEL[kind]; return <div aria-busy="true"><S h={h} /><RequestStatus q={st} label={label} /></div>; }
  if ((q as AsyncState<T>).stale) return (<div className="relative" aria-busy="true"><div className="pointer-events-none opacity-45 transition-opacity">{children(q.data)}</div>
    <span role="status" className="absolute right-2 top-2 rounded-full bg-ink px-2.5 py-1 font-mono text-[11px] text-canvas">Updating for the new selection…</span></div>);
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
  const rule = { ok: "bg-[#4a2bd0]", warn: "bg-[#ffc23d]", bad: "bg-[#f2545b]" }[tone ?? "ok"];
  return (<div className="card relative overflow-hidden px-4 pb-3.5 pt-4"><span className={cls("absolute inset-x-0 top-0 h-[5px]", rule)} aria-hidden />
    <div className="text-[12px] font-semibold text-ink-3">{label}</div>
    <div className="mt-1.5 font-display text-[30px] font-extrabold leading-none tracking-[-0.02em] text-ink">{loading || value === undefined ? <Skeleton h={28} w={90} /> : value === null ? <span className="text-ink-3">-</span> : <CountUp value={value} digits={digits} suffix={suffix} />}</div>
    {hint && <div className="mt-1.5 text-[12px] leading-snug text-ink-3">{hint}</div>}</div>);
}

// ------------------------------------------------------------------ risk
export function RiskBadge({ tier, size = "md" }: { tier: Tier; size?: "sm" | "md" | "lg"; pulse?: boolean }) {
  const { t } = useI18n();
  const pad = { sm: "px-1.5 py-px text-[11px]", md: "px-2 py-0.5 text-[12px]", lg: "px-2.5 py-1 text-[13px]" }[size];
  return (<span className={cls("inline-flex items-center rounded-full border-2 border-[#1a1438] font-bold", pad)} style={{ background: TIER_COLOR[tier], color: TIER_TEXT[tier] }} title={t("risk.note")}>{t(`risk.${tier.toLowerCase()}`)}</span>);
}

// ------------------------------------------------------------------ controls
export function Btn({ children, variant = "solid", className = "", ...p }: any) {
  const v = { solid: "bg-ink text-canvas", ghost: "btn-ghost", dark: "bg-ink text-canvas", danger: "bg-coral-d text-white border-[3px] border-[#1a1438] rounded-full shadow-[3px_3px_0_#1a1438]" }[variant as string];
  return <button className={cls("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control px-3.5 py-2 text-[13px] font-medium transition active:translate-y-px disabled:opacity-50 sm:min-h-9", v, className)} {...p}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-[120px] max-w-full flex-col gap-1"><span className="eyebrow">{label}</span>{children}</label>;
}
export function Select({ label, value, onChange, options }: { label: string; value: string | number; onChange: (v: string) => void; options: { value: string | number; label: string }[] }) {
  return (<Field label={label}><div className="relative"><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none rounded-control border border-line bg-ivory py-2 pl-3 pr-8 text-sm text-ink hover:border-emerald/50">
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><Icon name="chevron" size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" /></div></Field>);
}
export function Segmented<T extends string | number>({ label, value, onChange, options }: { label?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (<div className="flex flex-col gap-1">{label && <span className="text-[12px] font-semibold text-ink-3">{label}</span>}<div role="radiogroup" aria-label={label} className="scroll-thin inline-flex max-w-full overflow-x-auto rounded-full border-[2.5px] border-ink bg-ivory p-1">
    {options.map((o) => (<button key={String(o.value)} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
      className={cls("relative min-h-10 shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] font-bold transition-colors sm:min-h-8", o.value === value ? "bg-forest text-white" : "text-ink-2 hover:bg-mint-l")}>{o.label}</button>))}</div></div>);
}
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (<div role="tablist" className="scroll-thin mb-6 flex snap-x gap-1.5 overflow-x-auto overscroll-x-contain pb-1">{tabs.map((x) => (
    <button key={x.id} role="tab" aria-selected={x.id === value} onClick={() => onChange(x.id)} className={cls("relative shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-bold transition-colors", x.id === value ? "text-white" : "text-ink-3 hover:text-forest")}>
      {x.id === value && <motion.span layoutId="tabpill" className="absolute inset-0 rounded-full border-2 border-[#1a1438] bg-[#4a2bd0]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}<span className="relative">{x.label}</span></button>))}</div>);
}
export const ProvChip = ({ children, tone = "ok" }: { children: React.ReactNode; tone?: "ok" | "warn" | "info" | "neutral" }) => (
  <span className={cls("inline-flex items-center gap-1 rounded-full border-[1.5px] px-2 py-px text-[11.5px] font-bold", tone === "ok" && "border-[#1a1438] bg-[#d9f7ea] text-[#0b5d44]", tone === "warn" && "border-[#1a1438] bg-[#fff1cc] text-[#6b4a00]", tone === "info" && "border-[#1a1438] bg-[#dbe9ff] text-[#1c3f8f]", tone === "neutral" && "border-[#1a1438] bg-[#fff] text-[#3d3566]")}>{children}</span>);

// ------------------------------------------------------------------ toast + modal
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string }[]>([]);
  const push = useCallback((m: string) => { const id = Date.now() + Math.random(); setItems((x) => [...x, { id, m }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200); }, []);
  return (<ToastCtx.Provider value={push}>{children}<div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 flex-col gap-2">
    <AnimatePresence>{items.map((i) => (<motion.div key={i.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="rounded-xl bg-forest px-4 py-2.5 text-[13px] text-white shadow-pop">{i.m}</motion.div>))}</AnimatePresence></div></ToastCtx.Provider>);
}
/** Dialog focus handling: focus moves into the dialog, Tab cycles inside it, Escape closes it, and focus returns where it was. */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current; el?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); prev?.focus?.(); };
  }, [open, onClose, ref]);
}
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);
  return (<AnimatePresence>{open && (<motion.div className="fixed inset-0 z-[70] grid place-items-center bg-forest/40 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, opacity: 0 }}
      className={cls("card max-h-[88vh] w-full overflow-auto p-6 outline-none", wide ? "max-w-4xl" : "max-w-xl")}><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold text-forest">{title}</h2>
      <button aria-label={t("act.close")} onClick={onClose} className="rounded-lg p-1.5 hover:bg-mint-l"><Icon name="close" /></button></div>{children}</motion.div></motion.div>)}</AnimatePresence>);
}
/** Resolve a relative Markdown link against the document that contains it. */
// Markdown (react-markdown + remark/rehype, ≈30 KB gzip) is loaded only where a Markdown block actually renders (Copilot, docs viewer).
export const Markdown = dynamic(() => import("./markdown").then((m) => m.Markdown), { loading: () => <div className="h-6 animate-pulse rounded bg-line/50" /> });
// first column stays visible while a wide table scrolls sideways (phones), with a soft edge shadow
const STICKY = "sticky left-0 shadow-[6px_0_8px_-8px_rgba(11,27,46,0.35)]";
export function DataTable<T extends Record<string, any>>({ rows, cols, onRow, maxH = 420, dense }: { rows: T[]; cols: { key: string; label: string; render?: (r: T) => React.ReactNode; align?: "right"; sort?: (r: T) => number | string }[]; onRow?: (r: T) => void; maxH?: number; dense?: boolean }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const sorted = sort ? [...rows].sort((a, b) => { const c = cols.find((x) => x.key === sort.k)!; const f = c.sort ?? ((r: T) => r[sort.k]); const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; }) : rows;
  return (<div className="scroll-thin overflow-auto rounded-xl border border-line" style={{ maxHeight: maxH }}><table className="w-full border-collapse text-[13px]"><thead className="sticky top-0 z-10 bg-[#f1f5f9] text-left">
    <tr>{cols.map((c, ci) => (<th key={c.key} scope="col" aria-sort={sort?.k === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cls("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2", c.align === "right" && "text-right", ci === 0 && STICKY, ci === 0 && "z-20 bg-[#f1f5f9]")}>
      {c.label ? <button className="inline-flex items-center gap-1 hover:text-forest" onClick={() => setSort((s) => (s?.k === c.key ? { k: c.key, dir: (s.dir * -1) as 1 | -1 } : { k: c.key, dir: -1 }))}>{c.label}{sort?.k === c.key && <span aria-hidden>{sort.dir === 1 ? "▲" : "▼"}</span>}</button>
        : <span className="sr-only">Select</span>}</th>))}</tr></thead>
    <tbody>{sorted.map((r, i) => (<tr key={i} onClick={() => onRow?.(r)} className={cls("group border-t border-line transition hover:bg-mint-l/60", onRow && "cursor-pointer")}>{cols.map((c, ci) => (
      <td key={c.key} className={cls("px-3", dense ? "py-1.5" : "py-2.5", c.align === "right" && "num text-right", ci === 0 && STICKY, ci === 0 && "z-[1] bg-white group-hover:bg-[#f0faf5]")}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>))}</tr>))}</tbody></table></div>);
}

/** Progress for a user-started action (route search, nearest search, report): honest elapsed time, a slow notice after 2.5 s and Cancel.
 *  Only the slow notice is announced; the ticking timer is hidden from screen readers. */
export function ActionProgress({ label, onCancel, slowText }: { label: string; onCancel?: () => void; slowText?: string }) {
  const [s, setS] = useState(0);
  useEffect(() => { const t0 = performance.now(); const id = setInterval(() => setS((performance.now() - t0) / 1000), 250); return () => clearInterval(id); }, []);
  return (<div role="status" aria-live="polite" className="rounded-control border border-line bg-white p-3 text-[13px]" data-testid="action-progress">
    <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-signal-d motion-reduce:animate-none" aria-hidden />{label}
      <span className="ml-auto font-mono text-[11px] text-ink-3" aria-hidden>{s.toFixed(1)} s</span></div>
    {s > 2.5 && <p className="mt-1 text-[12px] text-ink-3">{slowText ?? "Taking longer than usual."}</p>}
    {onCancel && <button type="button" onClick={onCancel} className="mt-2 inline-flex min-h-9 items-center rounded-control border border-line px-3 text-[12.5px] font-medium hover:bg-mint-l">Cancel</button>}</div>);
}
