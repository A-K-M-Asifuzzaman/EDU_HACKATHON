"use client";
// The Operations engine: one scenario, four stages in causal order. The rail shows what each stage computed (each stage publishes the
// API result it already fetched, see usePlanState.report); presets set the same shared plan state the stage controls use. The rail
// doubles as the stage navigation; on phones a bottom bar and a sheet replace the sticky rail.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { CITIES, useDecisionGuard, type PlanShared, type Service } from "./supply-allocation";
import { PRESETS as EFFECTS } from "./vector-control";
import { PRESETS as BEDS } from "./hospital-surge";
import { Btn, Select, useToast } from "./ui";
import { scenarioSearch } from "@/lib/plan-scenario";

const STAGES = [
  { id: "supply", no: "01", verb: "Allocate", line: "Saline, kits, beds and spraying crews under the stock limit, by ward priority." },
  { id: "surge", no: "02", verb: "Surge", line: "Projected bed need against illustrative ward beds; overflow moves only within a city." },
  { id: "vector", no: "03", verb: "Intervene", line: "What crews could change 2 to 4 weeks ahead, under effects you assume." },
  { id: "dispatch", no: "04", verb: "Dispatch", line: "A ward brief that records this exact scenario." },
  { id: "alert-queue", no: "05", verb: "Review", line: "Local drafts for forecast alerts in the planning scope." },
] as const;
const n0 = (x: number) => x.toLocaleString("en");
const n1 = (x: number) => x.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function OpsEngine({ shared, stages }: { shared: PlanShared; stages: Record<(typeof STAGES)[number]["id"], ReactNode> }) {
  const { sel } = useSel();
  const { lang, t } = useI18n();
  const toast = useToast();
  const { blocked } = useDecisionGuard();
  const root = useRef<HTMLElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState<string>("supply");
  const [inView, setInView] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [present, setPresent] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (root.current && document.fullscreenEnabled) await root.current.requestFullscreen();
      else toast(t("ops.fullscreenUnavailable"));
    } catch {
      toast(t("ops.fullscreenUnavailable"));
    }
  };

  useEffect(() => {                                   // scrollspy and engine visibility: observers only, no scroll listeners or timers
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-40% 0px -55% 0px" });
    STAGES.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el); });
    const vis = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    if (root.current) vis.observe(root.current);
    return () => { io.disconnect(); vis.disconnect(); };
  }, []);
  useEffect(() => {                                   // sticky offsets follow the real site header (it is taller with the section bar)
    const h = document.querySelector("header"), el = root.current;
    if (!h || !el) return;
    const set = () => el.style.setProperty("--ops-top", `${Math.round(h.getBoundingClientRect().height)}px`);
    set(); const ro = new ResizeObserver(set); ro.observe(h); return () => ro.disconnect();
  }, []);
  const openSheet = () => { setSheet(true); dlg.current?.showModal(); };

  const r = shared.reports;
  const a = r.allocate?.failed ? null : r.allocate;
  const s = r.surge?.failed ? null : r.surge;
  const v = r.intervene?.failed ? null : r.intervene;
  const ds = r.dispatch?.failed ? null : r.dispatch;
  const review = r.review?.failed ? null : r.review;
  const ward = ds && !ds.stale ? ds : null;
  const paused = blocked ? t("ops.paused") : null;
  const nodes = [
    { k: "Forecast", to: "supply", failed: r.allocate?.failed, stale: a?.stale, value: paused ?? (a && `${n0(a.cases)} cases`), sub: a && `week of ${dateFmt(a.target, lang)}` },
    { k: "Demand", to: "supply", failed: r.allocate?.failed, stale: a?.stale, value: paused ?? (a && `${n0(a.totals.hospital_beds_required.demand)} beds`), sub: a && `${n0(a.totals.saline_bags_needed.demand)} saline bags, ${n0(a.totals.diagnostic_kits_needed.demand)} kits` },
    { k: "Allocation", to: "supply", failed: r.allocate?.failed, stale: a?.stale, bad: a?.counts.critical > 0,
      value: paused ?? (a && `${a.totals.saline_bags_needed.demand ? Math.round((100 * a.totals.saline_bags_needed.allocated) / a.totals.saline_bags_needed.demand) : 100}% supplied`),
      sub: a && `${a.counts.critical} wards critical, ${a.totals.crews.assigned} of ${a.totals.crews.needed} crews` },
    { k: "Surge", to: "surge", failed: r.surge?.failed, stale: s?.stale, bad: s?.totals.unresolved > 0, value: paused ?? (s && (s.totals.unresolved ? `${s.totals.unresolved} without a bed` : "all placed")), sub: s && `${s.totals.transferred} moved, beds at ${s.capPct}%` },
    { k: "Intervention", to: "vector", failed: r.intervene?.failed, stale: v?.stale, value: paused ?? (v?.over ? "over crew budget" : v && `${n1(v.totals.prevented_window)} fewer cases`), sub: v?.totals && `assumed effect, range ${n1(v.totals.prevented_window_low)} to ${n1(v.totals.prevented_window_high)}` },
    { k: "Dispatch", to: "dispatch", failed: r.dispatch?.failed, stale: ds?.stale, value: paused ?? (ds && ds.id), sub: ds && `brief for ${ds.ward}` },
    { k: t("ops.review"), to: "alert-queue", failed: r.review?.failed, stale: review?.stale, value: review && `${review.reviewed}/${review.total} ${t("ops.reviewed")}`, sub: t("ops.localDrafts") },
  ];

  return (<section id="engine" ref={root} data-theme="dim" aria-labelledby="engine-title" className="ops-engine relative -mx-4 mt-6 scroll-mt-16 px-3 pb-24 pt-5 sm:mx-0 sm:rounded-[20px] sm:px-5 lg:pb-8">
    <div className="flex flex-wrap items-end justify-between gap-3 px-1">
      <div><h2 id="engine-title" className="font-display text-[clamp(26px,3.2vw,36px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Operations engine</h2>
        <p className="mt-1.5 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-2">One scenario drives all four stages. The forecast sets demand, stock limits what is allocated, beds decide the overflow, crews change the outlook, and the brief records the result.</p></div>
      <p className="num text-[12.5px] text-ink-3">Forecast issued {dateFmt(sel.origin, lang)}, {sel.horizon} weeks ahead</p>
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <Btn variant="ghost" aria-pressed={present} onClick={() => setPresent(p => !p)}>{t(present ? "ops.endPresentation" : "ops.present")}</Btn>
      <Btn variant="ghost" onClick={toggleFullscreen}>{t(fullscreen ? "ops.exitFullscreen" : "ops.fullscreen")}</Btn>
    </div>
    <fieldset hidden={present} className="ops-panel mt-4 min-w-0 p-4" disabled={!shared.readyScenario}>
      <ScenarioControls shared={shared} />
    </fieldset>

    <section aria-label={t("ops.wardSummary")} className="ops-panel mt-3 grid gap-3 p-4 sm:grid-cols-[1fr_2fr]" data-testid="ops-ward-summary">
      <div>
        <h3 className="text-[13px] font-semibold text-ink-3">{t("ops.wardSummary")}</h3>
        <p className="mt-0.5 font-display text-[19px] font-bold text-ink">{sel.ward}</p>
        <p className="text-[12px] text-ink-2">{shared.city === "All" ? t("ops.allCities") : shared.city}{ward?.city && shared.city === "All" ? ` · ${ward.city}` : ""}</p>
      </div>
      {ward ? <dl className="grid grid-cols-3 gap-2 self-center text-[12px] text-ink-2">
        <div><dt>{t("ops.plannedCases")}</dt><dd className="num mt-0.5 text-lg font-bold text-ink">{n0(ward.planned)}</dd></div>
        <div><dt>{t("ops.saline")}</dt><dd className="num mt-0.5 text-lg font-bold text-ink">{n0(ward.saline.allocated)} / {n0(ward.saline.required)}</dd></div>
        <div><dt>{t("ops.withoutBed")}</dt><dd className="num mt-0.5 text-lg font-bold text-ink">{n0(ward.withoutBed)}</dd></div>
      </dl> : <p role="status" className="self-center text-[12px] text-ink-2">{paused ?? (r.dispatch?.failed ? t("ops.unavailable") : t("state.loading"))}</p>}
    </section>

    {/* the causal rail: what each stage computed, in order; sticky on desktop, a grid on phones */}
    <nav aria-label="Engine stages" className="z-20 -mx-3 mt-4 bg-[#0e0f1a] px-3 py-2 sm:-mx-5 sm:px-5 lg:sticky lg:top-[var(--ops-top,108px)] lg:border-b lg:border-[#2a2d4a]">
      <div className="flex items-stretch gap-2">
        <ol className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">{nodes.map((n, i) => (
          <li key={n.k} className="min-w-0"><RailNode n={n} i={i} on={active === n.to} last={i === nodes.length - 1} /></li>))}</ol>
        <div className="hidden shrink-0 self-center lg:flex"><button type="button" onClick={openSheet} className="ops-chip">Scenario</button></div>
      </div>
    </nav>

    <fieldset className="contents" disabled={!shared.readyScenario}>
    {STAGES.map((st) => (<div key={st.id} className="mt-8">
      <div className="flex items-start gap-3 px-1">
        <span aria-hidden className="num font-display text-[40px] font-extrabold leading-[0.9] tracking-[-0.04em] text-ink-3">{st.no}</span>
        <div><p className="font-display text-[19px] font-extrabold leading-tight text-ink">{st.verb}</p><p className="text-[12.5px] text-ink-3">{st.line}</p></div>
      </div>
      {stages[st.id]}
    </div>))}
    </fieldset>

    <div className={"fixed inset-x-0 bottom-0 z-40 border-t border-[#3a3e66] bg-[#0e0f1a] pb-[env(safe-area-inset-bottom)] lg:hidden " + (inView ? "" : "hidden")}>
      <div className="mx-auto flex max-w-xl items-stretch gap-1 px-2 py-1.5">
        {STAGES.map((st) => (<a key={st.id} href={`#${st.id}`} aria-current={active === st.id ? "step" : undefined}
          className={"flex min-h-11 flex-1 flex-col items-center justify-center rounded-lg text-[11.5px] font-semibold leading-tight " + (active === st.id ? "bg-[#eef0ff] text-[#0e0f1a]" : "text-ink-2")}>
          <span className="num text-[12px] font-extrabold">{st.no}</span>{st.verb}</a>))}
        <button type="button" onClick={openSheet} className="flex min-h-11 flex-1 flex-col items-center justify-center rounded-lg border border-[#3a3e66] text-[11.5px] font-semibold text-ink">Scenario</button>
      </div>
    </div>

    <dialog ref={dlg} className="ops-sheet" aria-labelledby="ops-sheet-title" onClose={() => setSheet(false)} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3"><h2 id="ops-sheet-title" className="font-display text-[20px] font-extrabold text-ink">Scenario</h2>
          <button type="button" onClick={() => dlg.current?.close()} className="ops-chip">Done</button></div>
        <p className="mt-1 text-[12.5px] text-ink-3">Every stage recomputes as you change these.</p>
        {sheet && <div className="mt-4"><ScenarioControls shared={shared} /></div>}
      </div>
    </dialog>
  </section>);
}

function RailNode({ n, i, on, last }: { n: { k: string; to: string; value: any; sub: any; stale?: boolean; bad?: boolean; failed?: boolean }; i: number; on: boolean; last: boolean }) {
  const { t } = useI18n();
  const prev = useRef(n.value);
  const [flash, setFlash] = useState(0);
  useEffect(() => { if (n.value && prev.current && prev.current !== n.value) setFlash((f) => f + 1); prev.current = n.value; }, [n.value]);
  return (<a href={`#${n.to}`} aria-current={on ? "step" : undefined}
    className={"ops-node flex h-full min-h-[64px] flex-col rounded-xl border px-3 py-2 " + (on ? "border-[#9ea3c9] bg-[#1c1f36]" : "border-[#2a2d4a] bg-[#151729] hover:border-[#3a3e66]")}>
    {flash > 0 && <span key={flash} aria-hidden className="ops-flash" />}
    <span className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-ink-3"><span><span className="num mr-1">{i + 1}</span>{n.k}</span>
      {n.stale ? <span className="text-[11px] text-[#ffd36e]">{t("ops.updating")}</span> : !last && <span aria-hidden className="hidden text-[#3a3e66] lg:inline">▸</span>}</span>
    <span key={String(n.value)} className={"ops-tick num mt-0.5 line-clamp-2 text-[15px] font-extrabold leading-tight [overflow-wrap:anywhere] " + (n.bad || n.failed ? "text-coral-d" : "text-ink")}>{n.failed ? t("ops.unavailable") : (n.value ?? "…")}</span>
    <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3 lg:hidden xl:block">{n.failed ? t("ops.seeStage") : n.sub ?? (n.value === t("ops.paused") ? t("ops.outOfTime") : t("state.loading"))}</span>
  </a>);
}

function Chips<T extends string | number>({ label, value, options, onChange, note }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; note?: string }) {
  return (<div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1.5">
    <span aria-hidden className="flex items-baseline gap-2 text-[12px] font-semibold text-ink-3">{label}{note && <span className="num font-normal">{note}</span>}</span>
    <div className="flex flex-wrap gap-1.5">{options.map((o) => (
      <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className="ops-chip">{o.label}</button>))}</div>
  </div>);
}

function ScenarioControls({ shared: p }: { shared: PlanShared }) {
  const { sel, set, wards } = useSel();
  const { t } = useI18n();
  const toast = useToast();
  const visibleWards = p.city === "All" ? wards : wards.filter(w => w.city === p.city);
  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.search = scenarioSearch(sel, p, url.searchParams);
    try {
      await navigator.clipboard.writeText(url.href);
      toast(t("scenario.linkCopied"));
    } catch {
      toast(t("scenario.linkBlocked"));
    }
  };
  const effKey = Object.entries(EFFECTS).find(([, x]) => x.effect === p.eff.effect && x.coverage === p.eff.coverage && x.delay === p.eff.delay && x.buildup === p.eff.buildup)?.[0] ?? "custom";
  const custom = (v: number, opts: number[], f: (v: number) => string) => (opts.includes(v) ? undefined : `set to ${f(v)}`);
  return (<div className="grid gap-4">
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="w-[200px] max-w-full"><Select label="City" value={p.city} onChange={p.setCity} options={[{ value: "All", label: "All five cities" }, ...CITIES.map((c) => ({ value: c, label: c }))]} /></div>
      <div className="w-[200px] max-w-full"><Select label={t("ctl.ward")} value={sel.ward} onChange={ward => set({ ward })}
        options={visibleWards.map(w => ({ value: w.ward_id, label: w.ward_id }))} /></div>
      <Chips label="Plan for" value={p.service} onChange={(v) => p.setService(v as Service)} options={[{ value: "median", label: "Median" }, { value: "p80", label: "Upper 80%" }, { value: "p90", label: "Upper 90%" }]} />
      <Chips label="Regional stock" value={p.stock} onChange={p.setStock} note={custom(p.stock, [30, 60, 100], (v) => `${v}%`)} options={[30, 60, 100].map((v) => ({ value: v, label: `${v}%` }))} />
      <Chips label="Spraying crews" value={p.crews} onChange={p.setCrews} note={custom(p.crews, [0, 20, 40, 60], String)} options={[0, 20, 40, 60].map((v) => ({ value: v, label: String(v) }))} />
      <Chips label="Ward beds" value={p.capPct} onChange={p.setCapPct} note={custom(p.capPct, BEDS.map((b) => b.value), (v) => `${v}%`)} options={BEDS.map((b) => ({ value: b.value, label: b.value === 100 ? "Baseline" : `+${b.value - 100}%` }))} />
      <Chips label="Assumed crew effect" value={effKey} onChange={(k) => { const x = EFFECTS[k]; if (x) p.setEff((e) => ({ ...e, effect: x.effect, coverage: x.coverage, delay: x.delay, buildup: x.buildup })); }}
        note={effKey === "custom" ? "custom" : undefined} options={Object.entries(EFFECTS).map(([k, x]) => ({ value: k, label: x.label }))} />
    </div>
    {p.unsupported && <p role="status" className="text-sm text-ink-2">{t("scenario.unknownVersion")}</p>}
    <div className="flex flex-wrap gap-2">
      <Btn variant="ghost" disabled={!p.readyScenario} onClick={copyLink}>{t("scenario.copyLink")}</Btn>
      <Btn variant="ghost" disabled={!p.readyScenario} onClick={p.reset}>{t("scenario.reset")}</Btn>
    </div>
    <p className="text-[12px] leading-relaxed text-ink-3">Stock limits supplies, not beds: Stage 2 beds are a separate illustrative number and are never added to stock. Beds change the overflow, never the forecast. Crew effects are assumptions, not measured outcomes.</p>
  </div>);
}
