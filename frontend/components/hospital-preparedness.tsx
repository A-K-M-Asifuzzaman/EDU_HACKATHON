"use client";
// Hospital preparedness command workspace (mentor scope). Every number comes from GET /api/preparedness/plan: a deterministic engine
// over FICTIONAL planning hospitals (synthetic_demo) driven by the organizer-dataset forecast. Real facilities appear only in the
// emergency discovery panel, with capacity and availability shown as unknown.
import { useEffect, useState } from "react";
import { api, BASE, qs } from "@/lib/api";
import { srcParam, useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { Chart } from "./echart";
import { CITIES, Live, useDebounced, useDecisionGuard, type PlanShared } from "./supply-allocation";
import { CITY_POS } from "./citymap";
import { Select, useAsync } from "./ui";

type Controls = { shock: number; non_dengue: number; dengue_now: number; closed: number; surge: number; reserve: number | null; saline: number; kits: number;
  lead: number | null; los: number; los_other: number; crews: number };
const DEFAULTS: Controls = { shock: 1, non_dengue: 100, dengue_now: 100, closed: 0, surge: 100, reserve: null, saline: 100, kits: 100, lead: null, los: 5, los_other: 6, crews: 0 };
// The mentor story: forecast pressure, a +100% outbreak shock, saline and kits at 60% with a 10-day lead time, other illnesses 5% higher, 20 crews
export const MENTOR_DEMO: Controls = { ...DEFAULTS, shock: 2, saline: 60, kits: 60, lead: 10, non_dengue: 105, crews: 20 };
const STATE_LABEL = { baseline: "Baseline", crisis: "Crisis", response: "Optimized response" } as const;
type StateKey = keyof typeof STATE_LABEL;
const SEV: Record<string, string> = { Normal: "#3fd3a5", Watch: "#5fc3f0", Warning: "#ffc23d", Critical: "#ff9a52", "Emergency Surge": "#ff6b72", Unknown: "#9ea3c9" };
const C = { other: "#6b7194", dengue: "#b4a6ff", free: "#262a48", reserve: "#ffc23d", surge: "#3fd3a5", short: "#ff6b72", saline: "#5fc3f0", kits: "#ffc23d" };
const wk = (w: number | null | undefined) => (w ? `week ${w}` : "not within 4 weeks");

function Chips<T extends string | number | null>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (<div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1.5"><span aria-hidden className="text-[12px] font-semibold text-ink-3">{label}</span>
    <div className="flex flex-wrap gap-1.5">{options.map(([v, l]) => <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)} className="ops-chip">{l}</button>)}</div></div>);
}
const Pill = ({ s }: { s: string }) => <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-bold" style={{ borderColor: SEV[s] ?? "#9ea3c9", color: SEV[s] ?? "#eef0ff" }}><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: SEV[s] }} />{s}</span>;

export default function HospitalPreparedness({ shared }: { shared: PlanShared }) {
  const { sel } = useSel();
  const { lang } = useI18n();
  const { blocked, notice } = useDecisionGuard();
  const [c, setC] = useState<Controls>(DEFAULTS);
  const [view, setView] = useState<StateKey>("crisis");
  const set = (p: Partial<Controls>) => setC((x) => ({ ...x, ...p }));
  const city = shared.city;
  const p = useDebounced({ c, city, service: shared.service }, 250);
  const query = qs({ origin: sel.origin, service: p.service, city: p.city, source: srcParam(sel), shock: p.c.shock, non_dengue: p.c.non_dengue, dengue_now: p.c.dengue_now,
    closed: p.c.closed, surge: p.c.surge, reserve: p.c.reserve ?? undefined, saline: p.c.saline, kits: p.c.kits, lead: p.c.lead ?? undefined, los: p.c.los, los_other: p.c.los_other, crews: p.c.crews });
  const q = useAsync((s) => (blocked ? Promise.resolve(null) : api<any>(`/api/preparedness/plan?${query}`, { signal: s, timeout: 60_000 })), [query, blocked]);
  const demo = () => { setC(MENTOR_DEMO); if (shared.city === "All") shared.setCity("Dhaka North"); setView("crisis"); };
  const isDemo = JSON.stringify(c) === JSON.stringify(MENTOR_DEMO);

  return (<section id="prepare" data-theme="dim" aria-labelledby="prepare-title" className="ops-engine relative -mx-4 mt-6 scroll-mt-16 px-3 pb-8 pt-5 sm:mx-0 sm:rounded-[20px] sm:px-5">
    <div className="flex flex-wrap items-end justify-between gap-3 px-1">
      <div><h2 id="prepare-title" className="font-display text-[clamp(26px,3.2vw,36px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Hospital preparedness</h2>
        <p className="mt-1.5 max-w-[72ch] text-[13.5px] leading-relaxed text-ink-2">If an outbreak comes, what should hospitals prepare? Beds that are already partly full of other patients, saline, diagnostic kits, referrals and contacts, week by week. The hospitals here are fictional planning hospitals; the forecast comes from the organizer's synthetic dataset, not live surveillance.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={demo} aria-pressed={isDemo} className="ops-chip !border-[#ffd36e] !text-[#ffd36e] aria-pressed:!bg-[#ffd36e] aria-pressed:!text-[#0e0f1a]">Mentor demonstration</button>
        <button type="button" onClick={() => setC(DEFAULTS)} className="ops-chip">Reset preparedness</button></div>
    </div>

    {blocked ? <div className="mt-4">{notice}</div> : (<>
    {/* A: command bar */}
    <div className="ops-panel mt-4 grid gap-4 p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="w-[190px] max-w-full"><Select label="Planning area" value={city} onChange={shared.setCity} options={[{ value: "All", label: "All five cities" }, ...CITIES.map((x) => ({ value: x, label: x }))]} /></div>
        <Chips label="Outbreak shock" value={c.shock} onChange={(v) => set({ shock: v })} options={[[1, "Forecast"], [1.25, "+25%"], [1.5, "+50%"], [2, "+100%"], [3, "+200%"]]} />
        <Chips label="Saline in stock" value={c.saline} onChange={(v) => set({ saline: v })} options={[[100, "100%"], [60, "60%"], [30, "30%"]]} />
        <Chips label="Diagnostic kits in stock" value={c.kits} onChange={(v) => set({ kits: v })} options={[[100, "100%"], [60, "60%"], [30, "30%"]]} />
        <Chips label="Resupply lead time" value={c.lead} onChange={(v) => set({ lead: v })} options={[[null, "As planned"], [5, "5 days"], [10, "10 days"], [14, "14 days"]]} />
        <Chips label="Other-illness patients" value={c.non_dengue} onChange={(v) => set({ non_dengue: v })} options={[[100, "As now"], [105, "+5%"], [115, "+15%"]]} />
        <Chips label="Surge beds available" value={c.surge} onChange={(v) => set({ surge: v })} options={[[100, "All"], [50, "Half"], [0, "None"]]} />
      </div>
      <details className="text-[13px]"><summary className="cursor-pointer font-semibold text-ink-2">More assumptions: closures, reserve, length of stay, existing dengue patients, crews</summary>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-4">
          <Chips label="Beds closed" value={c.closed} onChange={(v) => set({ closed: v })} options={[[0, "None"], [10, "10%"], [25, "25%"]]} />
          <Chips label="Protected reserve" value={c.reserve} onChange={(v) => set({ reserve: v })} options={[[null, "Planned (10%)"], [5, "5%"], [15, "15%"]]} />
          <Chips label="Dengue stay (days)" value={c.los} onChange={(v) => set({ los: v })} options={[[3, "3"], [5, "5"], [7, "7"]]} />
          <Chips label="Dengue patients already admitted" value={c.dengue_now} onChange={(v) => set({ dengue_now: v })} options={[[100, "As now"], [150, "+50%"], [200, "x2"]]} />
          <Chips label="Spraying crews (Stage 3 effect)" value={c.crews} onChange={(v) => set({ crews: v })} options={[[0, "None"], [20, "20"], [40, "40"]]} />
        </div></details>
      <p className="text-[12px] leading-relaxed text-ink-3">Shock changes dengue demand only. Beds and closures change the overflow, never the forecast. Stock here is hospital inventory, kept apart from the Stage 1 regional stock.</p>
    </div>

    <Live q={q} h={520} label="Hospital preparedness">{(d: any) => <Workspace d={d} view={view} setView={setView} lang={lang} query={query} />}</Live>
    </>)}
  </section>);
}

function Workspace({ d, view, setView, lang, query }: { d: any; view: StateKey; setView: (v: StateKey) => void; lang: string; query: string }) {
  const st = d.states[view], cr = d.states.crisis.summary, rs = d.states.response.summary, base = d.states.baseline.summary;
  const td = d.forecast.target_dates;
  const [day, setDay] = useState(0);                                  // 0 = peak view; 1-28 = that day's census
  const [play, setPlay] = useState(false);
  useEffect(() => {                                                   // plays only after the user presses Play, stops at day 28
    if (!play) return;
    const id = setInterval(() => setDay((x) => { if (x >= 28) { setPlay(false); return x; } return x + 1; }), 380);
    return () => clearInterval(id);
  }, [play]);
  const weekDate = (w: number | null) => (w && w >= 2 ? ` (${dateFmt(td[String(w)], lang as any)})` : "");
  return (<div className="mt-5 grid gap-5">
    {/* B: executive answers */}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="prep-answers">
      <Answer q="Are hospitals prepared?" a={<span className="flex flex-wrap gap-1.5"><Pill s={cr.status} /></span>} sub={`after the response: ${rs.status_after_response}`} />
      <Answer q="What shortage?" a={`${cr.peak_needed} need / ${cr.capacity} beds`} sub={`${cr.other_now} other-illness and ${cr.dengue_now} dengue patients now`} />
      <Answer q="When?" a={wk(cr.first_reserve_breach_week)} sub={`reserve reached; beds run out ${wk(cr.first_shortage_week)}${weekDate(cr.first_shortage_week)}`} />
      <Answer q="Extra beds" a={String(cr.extra_beds_to_protect_reserve)} sub="to admit everyone and keep the reserve" />
      <Answer q="Supplies to order" a={`${cr.saline_required} saline`} sub={`${cr.kits_required} diagnostic kits; first saline stockout ${wk(cr.first_saline_stockout_week)}`} />
      <Answer q="Alternatives" a={`${rs.referred_28d ?? rs.referred} referrals`} sub={`${rs.unresolved_28d != null ? "28-day plan" : "peak-day plan"}: ${(rs.unresolved_28d ?? rs.bed_gap_after_referral) ? `${rs.unresolved_28d ?? rs.bed_gap_after_referral} still without a bed after surge and referrals` : "surge beds and referrals leave nobody without a bed"}`} />
    </div>

    <div role="group" aria-label="Scenario state" className="flex flex-wrap items-center gap-1.5">
      {(Object.keys(STATE_LABEL) as StateKey[]).map((k) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className="ops-chip">{STATE_LABEL[k]}</button>)}
      <span className="num ml-1 text-[12px] text-ink-3">Scenario <code data-testid="prep-scenario-id" className="text-ink">{d.scenario_id}</code></span></div>

    {/* C: hospital digital twin */}
    <section aria-labelledby="twin-title"><div className="flex flex-wrap items-end justify-between gap-3"><h3 id="twin-title" className="text-[14px] font-semibold text-ink">Hospital bed boards {day ? `on day ${day}` : "at the peak"}: {STATE_LABEL[view].toLowerCase()}</h3>
      <div className="flex flex-wrap items-center gap-2"><button type="button" className="ops-chip" onClick={() => { if (day >= 28) setDay(0); setPlay((x) => !x); }} aria-pressed={play}>{play ? "Pause" : "Play 28 days"}</button>
        <label className="flex items-center gap-2 text-[12px] text-ink-3">Day<input type="range" min={0} max={28} value={day} onChange={(e) => { setPlay(false); setDay(Number(e.target.value)); }} aria-label="Day shown on the bed boards (0 = peak)" className="w-40 accent-[#ffd36e]" /><b className="num w-12 text-ink">{day || "peak"}</b></label></div></div>
      <p className="mt-0.5 text-[12.5px] text-ink-3">One cell per bed. Grey: other illnesses. Lilac: dengue. Dark: free. Amber outline: protected reserve. Green dashes: surge beds opened. Red cells outside the board: patients the beds cannot hold.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{st.hospitals.map((h: any) => <BedBoard key={h.id} h={h} day={day} />)}</div></section>

    {/* D + E: timeline and inventory */}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="ops-panel p-3"><h3 className="px-1 text-[14px] font-semibold text-ink">Preparedness timeline (planning network)</h3>
        <p className="px-1 text-[12px] text-ink-3">Days 1-28 after the forecast issued {dateFmt(d.origin, lang as any)}. Week 1 is scenario-derived; weeks 2-4 are the forecast.</p>
        <Chart option={timeline(st.daily)} height={260} ariaLabel="Patients needing a bed against open beds and the reserve line, days 1 to 28; the bed boards and tables give the same numbers" /></div>
      <Inventory st={st} />
    </div>

    {/* F: crisis lab */}
    <section aria-labelledby="lab-title" className="ops-panel p-4"><h3 id="lab-title" className="text-[14px] font-semibold text-ink">Crisis laboratory: baseline, crisis and optimized response</h3>
      <div className="mt-3 overflow-x-auto"><table className="num w-full min-w-[560px] text-[12.5px]"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-3 font-semibold">Measure</th>{(Object.keys(STATE_LABEL) as StateKey[]).map((k) => <th key={k} className="py-1 pr-3 text-right font-semibold">{STATE_LABEL[k]}</th>)}</tr></thead>
        <tbody>{([["Status", (s: any, k: StateKey) => <Pill s={k === "response" ? s.status_after_response : s.status} />], ["Peak patients needing a bed", (s: any) => s.peak_needed], ["Open beds", (s: any) => s.capacity],
          ["Extra beds to keep the reserve", (s: any) => s.extra_beds_to_protect_reserve], ["Bed gap on the worst day", (s: any) => s.bed_gap_worst_day], ["Referred on the worst day (peak-day plan)", (s: any) => s.referred],
          ["Bed gap on the worst day after referral", (s: any) => s.bed_gap_after_referral], ["Referred over 28 days (28-day plan)", (s: any) => s.referred_28d ?? "-"],
          ["Without a bed over 28 days, after referrals", (s: any) => s.unresolved_28d ?? "-"], ["Dengue patients turned away (4 weeks, before referral)", (s: any) => s.unresolved_dengue],
          ["Saline to order / still unmet", (s: any) => `${s.saline_required} / ${s.saline_unmet}`], ["Kits to order / still unmet", (s: any) => `${s.kits_required} / ${s.kits_unmet}`]] as [string, (s: any, k: StateKey) => any][]).map(([label, f]) => (
          <tr key={label} className="border-t border-line"><th className="py-1.5 pr-3 text-left font-normal text-ink-2">{label}</th>{(Object.keys(STATE_LABEL) as StateKey[]).map((k) => <td key={k} className="py-1.5 pr-3 text-right text-ink">{f(d.states[k].summary, k)}</td>)}</tr>))}</tbody></table></div>
      <p className="mt-2 text-[12px] text-ink-3">Response = crisis + surge beds opened + orders placed today (they arrive after the lead time) + referrals inside the planning network. Remaining shortages are shown, not hidden. Baseline uses the forecast with the planned hospital settings{d.intervention ? " and the same assumed crew effect" : ""}.</p></section>

    {d.states.response.inventory_compare && <InventoryPolicies ic={d.states.response.inventory_compare} crisis={d.states.crisis.summary} />}

    {/* G: transfer network */}
    <TransferNetwork st={d.states.response} />

    {/* H: real emergency discovery */}
    <RealDiscovery city={d.city} />

    {/* I: action panel */}
    <section aria-labelledby="act-title" className="ops-panel p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="act-title" className="text-[14px] font-semibold text-ink">Preparation plan</h3>
      <div className="flex flex-wrap gap-1.5">{(["html", "csv", "txt"] as const).map((f) => <a key={f} className="ops-chip" href={`${BASE}/api/preparedness/brief?${query}&format=${f}`} download aria-label={`Download the preparation brief as ${f.toUpperCase()}`}>{f.toUpperCase()}</a>)}</div></div>
      <ol className="mt-3 grid gap-2">{d.actions.map((a: any, i: number) => (<li key={i} className="grid gap-x-3 rounded-lg border border-line p-2.5 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_auto]">
        <span><b className="text-ink">{a.action}</b>{a.quantity != null && <b className="num ml-1.5 text-[#ffd36e]">{a.quantity}</b>}<span className="block text-ink-3">{a.why}. Trigger: {a.trigger}.</span>
          {a.where?.length > 0 && <span className="mt-1 block text-ink-2">Where: {a.where.join("; ")}</span>}</span>
        <span className="text-ink-2 sm:text-right">{a.when}</span></li>))}</ol>
      <p className="mt-2 text-[12px] text-ink-3">Every item is computed from this scenario (rule ids in the brief). Planning suggestions only: not an operational or clinical order, no dosage or treatment advice.</p></section>

    <section aria-labelledby="sig-title" className="ops-panel p-4"><h3 id="sig-title" className="text-[14px] font-semibold text-ink">Outbreak signal</h3>
      <p className="mt-1 text-[12.5px] text-ink-2">{d.detection_note}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-[12.5px]">{Object.entries(d.signals).map(([k, s]: any) => (<span key={k} className="num rounded-lg border border-line px-2.5 py-1.5 text-ink-2">{k}: {s.available ? <>last observed week {s.last_week}, z {s.z_last}, CUSUM {s.cusum.at(-1)} ({s.cusum_alarm ? "above" : "below"} {s.threshold_cusum})</> : s.reason}</span>))}</div>
      <p className="mt-2 text-[11.5px] text-ink-3">Historical replay of the organizer&apos;s synthetic series up to the forecast origin. A shock above is a hypothetical stress test, not a detected outbreak.</p></section>

    <details className="ops-panel p-4 text-[12.5px] text-ink-2"><summary className="cursor-pointer font-semibold text-ink">Data sources and assumptions</summary>
      <ul className="mt-2 grid gap-1">{d.provenance.map((x: any) => <li key={x.what}><b className="text-ink">{x.what}</b>: {x.source}. {x.note}</li>)}</ul>
      <ul className="mt-2 list-disc space-y-1 pl-5">{d.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
      <p className="mt-2">{d.fixture_label} {d.fixture_basis}</p>
      <p className="mt-2">Checks on every state: {Object.entries(d.states.response.checks).map(([k, v]) => `${k.replace(/_/g, " ")} ${v ? "holds" : "FAILS"}`).join(", ")}; referral plan {d.states.response.network.certificate ? "matches an independent max-flow" : "FAILED its max-flow check"}.</p></details>
  </div>);
}

/** Dynamic threshold gauge: patients needing a bed against the reserve line (routine limit) and the open beds. */
function Gauge({ need, limit, cap }: { need: number; limit: number; cap: number }) {
  const top = Math.max(need, cap, 1), col = need > cap ? C.short : need > limit ? C.reserve : C.surge;
  return (<div className="mt-2" role="img" aria-label={`${need} patients need a bed; reserve line ${limit}; ${cap} open beds`}>
    <div className="relative h-2.5 overflow-hidden rounded-full bg-[#262a48]">
      <span className="ops-growx absolute inset-0 rounded-full" style={{ background: col, transform: `scaleX(${need / top})` }} />
      <span className="absolute inset-y-0 w-[2px] bg-[#ffc23d]" style={{ left: `${(100 * limit) / top}%` }} />
      <span className="absolute inset-y-0 w-[2px] bg-[#eef0ff]" style={{ left: `calc(${(100 * cap) / top}% - 2px)` }} /></div>
    <div className="num mt-0.5 flex justify-between text-[10.5px] text-ink-3"><span>need {need}</span><span>reserve line {limit}</span><span>beds {cap}</span></div></div>);
}

const Answer = ({ q, a, sub }: { q: string; a: React.ReactNode; sub: string }) => (
  <div className="ops-panel p-3"><div className="text-[12px] font-semibold text-ink-3">{q}</div><div className="num mt-1 font-display text-[19px] font-extrabold leading-tight text-ink">{a}</div><p className="mt-1 text-[11.5px] leading-snug text-ink-3">{sub}</p></div>);

function BedBoard({ h, day }: { h: any; day: number }) {
  const b = h.beds, cap = b.capacity, at = day ? h.occ[day - 1] : null;
  const peak = at ? at[2] : b.peak_needed;                           // patients needing a bed (all admitted would need)
  const other = Math.min(at ? at[0] : b.other_now, cap), dengue = Math.max(0, Math.min(cap, peak) - other);
  const over = Math.max(0, peak - cap), shown = Math.min(over, 40);
  const cells = Array.from({ length: cap }, (_, i) => (i < other ? "other" : i < other + dengue ? "dengue" : "free"));
  const reserveFrom = cap - b.reserve, surgeFrom = cap - b.surge_open;
  return (<div className="ops-panel p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[13px] font-bold text-ink">{h.name}</div>
      <div className="num text-[11.5px] text-ink-3">{peak} need {day ? `on day ${day}` : "at peak"} / {cap} beds{b.surge_open ? ` (${b.surge_open} surge)` : ""}</div></div><Pill s={h.status} /></div>
    <Gauge need={peak} limit={b.routine_limit} cap={cap} />
    <div role="img" aria-label={`${h.name}: ${b.other_now} other-illness patients, ${b.dengue_now} dengue patients now, ${peak} needing a bed at the peak, ${cap} beds, reserve ${b.reserve}${over ? `, ${over} without a bed` : ""}`}
      className="mt-2 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cap > 150 ? 20 : 14}, minmax(0, 1fr))` }}>
      {cells.map((k, i) => <span key={i} className="aspect-square rounded-[2px] transition-colors duration-500 motion-reduce:transition-none"
        style={{ background: C[k as keyof typeof C], outline: i >= reserveFrom ? `1px solid ${C.reserve}` : i >= surgeFrom ? `1px dashed ${C.surge}` : "none", outlineOffset: -1, transitionDelay: `${Math.min(i, 160) * 3}ms` }} />)}
    </div>
    {over > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-[2px]" aria-hidden>{Array.from({ length: shown }, (_, i) => <span key={i} className="h-2 w-2 rounded-[2px]" style={{ background: C.short }} />)}<span className="num ml-1 text-[11.5px] font-bold text-coral-d">{over} without a bed</span></div>}
    <dl className="num mt-2 grid grid-cols-2 gap-x-3 text-[11.5px]"><dt className="text-ink-3">Free now</dt><dd className="text-right text-ink">{b.free_now}</dd>
      <dt className="text-ink-3">Reserve reached</dt><dd className="text-right text-ink">{wk(b.reserve_breach_week)}</dd>
      <dt className="text-ink-3">Extra beds needed</dt><dd className="text-right text-ink">{b.extra_beds_to_protect_reserve}</dd></dl>
  </div>);
}

function timeline(daily: any[]) {
  const x = daily.map((r) => `D${r.day}`);
  return { tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { fontSize: 11 } }, grid: { left: 40, right: 12, top: 34, bottom: 28 },
    xAxis: { type: "category", data: x, axisLabel: { interval: 6, fontSize: 10 } }, yAxis: { type: "value", name: "beds", splitLine: { lineStyle: { color: "#2a2d4a" } } },
    series: [
      { name: "Other illnesses", type: "line", stack: "occ", areaStyle: { opacity: 0.55 }, symbol: "none", lineStyle: { width: 0 }, itemStyle: { color: C.other }, data: daily.map((r) => r.occupied_other) },
      { name: "Dengue admitted", type: "line", stack: "occ", areaStyle: { opacity: 0.7 }, symbol: "none", lineStyle: { width: 0 }, itemStyle: { color: C.dengue }, data: daily.map((r) => r.occupied_dengue) },
      { name: "Need a bed", type: "line", symbol: "none", lineStyle: { width: 2.5 }, itemStyle: { color: C.short }, data: daily.map((r) => r.needed) },
      { name: "Open beds", type: "line", symbol: "none", lineStyle: { width: 2 }, itemStyle: { color: "#eef0ff" }, data: daily.map((r) => r.capacity) },
      { name: "Reserve line", type: "line", symbol: "none", lineStyle: { width: 1.5, type: "dashed" }, itemStyle: { color: C.reserve }, data: daily.map((r) => r.routine_limit) }] };
}

function Inventory({ st }: { st: any }) {
  const hs = st.hospitals.filter((h: any) => h.role !== "referral");
  const tot = (res: string, k: string) => hs.reduce((a: number, h: any) => a + (h.inventory[res][k] ?? 0), 0);
  const first = (res: string, k: string) => Math.min(...hs.map((h: any) => h.inventory[res][k] ?? 99));
  return (<div className="ops-panel p-3"><h3 className="px-1 text-[14px] font-semibold text-ink">Inventory control</h3>
    <div className="mt-2 grid grid-cols-2 gap-3">{(["saline", "kits"] as const).map((res) => {
      const open = tot(res, "opening"), dem = tot(res, "demand_total"), rec = tot(res, "received_total"), reserve = tot(res, "reserve"), unmet = tot(res, "unmet_total"), close = tot(res, "closing");
      const top = Math.max(open + rec, dem, 1), so = first(res, "stockout_day");
      return (<div key={res} className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink-2">{res === "saline" ? "Saline bags" : "Diagnostic kits"}</div>
        <div role="img" aria-label={`${res}: opening ${open}, four-week demand ${dem}, deliveries ${rec}, unmet ${unmet}, closing ${close}, safety stock ${reserve}`} className="relative mt-2 h-36 overflow-hidden rounded-[14px_14px_10px_10px] border border-[#3a3e66] bg-[#0e0f1a]">
          <span className="ops-grow absolute inset-x-0 bottom-0 h-full" style={{ background: `${C[res]}55`, transform: `scaleY(${Math.min(1, (open + rec) / top)})` }} />
          <span className="ops-grow absolute inset-x-0 bottom-0 h-full" style={{ background: C[res], transform: `scaleY(${Math.min(1, close / top)})` }} />
          <span className="absolute inset-x-0 border-t-2 border-dashed" style={{ borderColor: C.reserve, bottom: `${Math.min(100, (100 * reserve) / top)}%` }} />
          <span className="absolute inset-x-0 border-t-2" style={{ borderColor: C.short, bottom: `${Math.min(100, (100 * dem) / top)}%` }} />
        </div>
        <dl className="num mt-2 grid grid-cols-2 gap-x-2 text-[11.5px]">
          <dt className="text-ink-3">Opening + deliveries</dt><dd className="text-right text-ink">{open} + {rec}</dd>
          <dt className="text-ink-3">4-week demand</dt><dd className="text-right text-ink">{dem}</dd>
          <dt className="text-ink-3">Unmet</dt><dd className={"text-right " + (unmet ? "font-bold text-coral-d" : "text-ink")}>{unmet}</dd>
          <dt className="text-ink-3">Stockout</dt><dd className="text-right text-ink">{so < 99 ? `day ${so}` : "none"}</dd>
          <dt className="text-ink-3">Reorder point</dt><dd className="text-right text-ink">{tot(res, "reorder_point")}</dd>
          <dt className="text-ink-3">To order</dt><dd className="text-right font-bold text-[#ffd36e]">{tot(res, "procurement_required")}</dd></dl>
      </div>);
    })}</div>
    <p className="mt-2 px-1 text-[11.5px] text-ink-3">Light fill: stock plus deliveries. Solid: left after four weeks. Red line: four-week demand. Amber dashes: safety stock. Closing = opening + received − used; unmet demand is kept apart.</p></div>);
}

function InventoryPolicies({ ic, crisis }: { ic: any; crisis: any }) {
  const cols: [string, string][] = [["no_action", "No action"], ["procurement_only", "Procurement only"], ["redistribution_only", "Redistribution only"], ["redistribution_and_procurement", "Redistribution + procurement"]];
  const left = (day: number | null) => (day ? `day ${day}` : "not within 28 days");
  return (<section aria-labelledby="inv-pol" className="ops-panel p-4"><h3 id="inv-pol" className="text-[14px] font-semibold text-ink">Emergency inventory: four policies (units still unmet over 28 days)</h3>
    <div className="mt-2 flex flex-wrap gap-2" data-testid="stockout-countdown">
      <span className="ops-chip !cursor-default">Saline runs out: <b className="num ml-1 text-ink">{left(crisis.first_saline_stockout_day)}</b></span>
      <span className="ops-chip !cursor-default">Kits run out: <b className="num ml-1 text-ink">{left(crisis.first_kits_stockout_day)}</b></span></div>
    <div className="mt-3 overflow-x-auto"><table className="num w-full min-w-[560px] text-[12.5px]"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-3 font-semibold">Resource</th>{cols.map(([k, l]) => <th key={k} className="py-1 pr-3 text-right font-semibold">{l}</th>)}</tr></thead>
      <tbody>{(["saline", "kits"] as const).map((r) => (<tr key={r} className="border-t border-line"><th className="py-1.5 pr-3 text-left font-normal text-ink-2">{r === "saline" ? "Saline bags" : "Diagnostic kits"}</th>
        {cols.map(([k]) => { const best = k === "redistribution_and_procurement"; return <td key={k} className={"py-1.5 pr-3 text-right " + (best ? "font-bold text-[#ffd36e]" : "text-ink")}>{ic[r][k]}</td>; })}</tr>))}</tbody></table></div>
    {(["saline", "kits"] as const).map((r) => ic[r].redistribution.transfers.length > 0 && (<p key={r} className="mt-2 text-[12px] text-ink-2"><b className="text-ink">{r === "saline" ? "Saline" : "Kits"} moved on day 1:</b> {ic[r].redistribution.transfers.map((t: any) => `${t.units} from ${t.from_name} to ${t.to_name} (arrives day ${t.arrival_day})`).join("; ")}. Donors had {ic[r].redistribution.donor_available} to spare above their safety stock; receivers needed {ic[r].redistribution.receiver_need} after arrival.</p>))}
    <p className="mt-2 text-[11.5px] text-ink-3">Checks: donors keep their safety stock {ic.checks.donors_keep_safety_stock ? "holds" : "FAILS"}; conservation {ic.checks.conservation ? "holds" : "FAILS"}. Quantities are aggregate planning units, not dosage.</p></section>);
}

function TransferNetwork({ st }: { st: any }) {
  const te = st.network.time_expanded;
  const [mode, setMode] = useState<"28d" | "peak">(te?.available ? "28d" : "peak");
  const nodes = st.network.nodes, tr = mode === "28d" && te?.available ? te.transfers : st.network.transfers;
  const W = 640, H = 300, cx = W / 2, cy = H / 2, R = 115;
  const ref = nodes.find((n: any) => n.role === "referral");
  const ring = nodes.filter((n: any) => n.role !== "referral");
  const pos: Record<string, [number, number]> = {};
  ring.forEach((n: any, i: number) => { const a = (2 * Math.PI * i) / Math.max(1, ring.length) - Math.PI / 2; pos[n.id] = [cx + R * 1.9 * Math.cos(a), cy + R * Math.sin(a)]; });
  if (ref) pos[ref.id] = [cx, cy];
  return (<section aria-labelledby="net-title" className="ops-panel p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="net-title" className="text-[14px] font-semibold text-ink">{mode === "28d" ? "Referral plan over 28 days" : `Referral network at the worst day (week ${st.network.worst_week})`}</h3>
      <div role="group" aria-label="Referral plan" className="flex gap-1.5">{te?.available && <button type="button" aria-pressed={mode === "28d"} onClick={() => setMode("28d")} className="ops-chip">28-day plan</button>}<button type="button" aria-pressed={mode === "peak"} onClick={() => setMode("peak")} className="ops-chip">Peak day</button></div></div>
    <p className="mt-0.5 text-[12.5px] text-ink-3">Fictional planning hospitals only; arrows are the computed referrals (patients). Positions are abstract. Real transfers need clinical coordination and the receiving hospital&apos;s confirmation.</p>
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full max-w-[760px]" role="img" aria-label={`${tr.length} referral links moving ${st.network.placed} patients; ${st.network.unresolved} still without a bed`}>
      <defs><marker id="prep-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8z" fill={C.surge} /></marker></defs>
      {tr.map((t: any) => { const [x1, y1] = pos[t.from], [x2, y2] = pos[t.to]; const L = Math.hypot(x2 - x1, y2 - y1) || 1; const mx = (x1 + x2) / 2 - (40 * (y2 - y1)) / L, my = (y1 + y2) / 2 + (40 * (x2 - x1)) / L;   // bend sideways so labels never sit on the straight line
        return (<g key={`${t.from}>${t.to}`}><path className="ops-draw" pathLength={1} d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} fill="none" stroke={C.surge} strokeWidth={Math.min(9, 1.5 + t.patients / 6)} markerEnd="url(#prep-head)" opacity={0.85} />
          <text x={(x1 + 2 * mx + x2) / 4} y={(y1 + 2 * my + y2) / 4 - 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#eef0ff" stroke="#151729" strokeWidth="3" paintOrder="stroke">{t.patients}</text></g>); })}
      {nodes.map((n: any) => { const [x, y] = pos[n.id]; const u = n.limit ? Math.min(1.4, n.needed / n.limit) : 0; const r = n.role === "referral" ? 30 : 22;
        return (<g key={n.id}><circle cx={x} cy={y} r={r} fill="#1c1f36" stroke={n.gap ? C.short : n.spare ? C.surge : "#9ea3c9"} strokeWidth={2.5} />
          <circle cx={x} cy={y} r={r - 6} fill="none" stroke={u > 1 ? C.short : C.dengue} strokeWidth={5} pathLength={1} strokeDasharray={`${Math.min(1, u)} 1`} transform={`rotate(-90 ${x} ${y})`} />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#eef0ff">{n.id}</text>
          <text x={x} y={y + r + 14} textAnchor="middle" fontSize="10.5" fill="#9ea3c9">{n.gap ? `${n.gap} over` : `${n.spare} spare`}</text></g>); })}
    </svg>
    {mode === "28d" && te?.available ? <p className="num text-[12px] text-ink-2" data-testid="te-evidence">Patients without a bed over 28 days: {te.unresolved_without_referral} without referrals, {te.unresolved} with this plan ({te.referred} referred). {te.method}; re-simulated day by day: {Object.entries(te.checks).map(([k, v]) => `${k.replace(/_/g, " ")} ${v ? "holds" : "FAILS"}`).join(", ")}.</p>
      : <p className="num text-[12px] text-ink-2">Bed gap {st.network.gap}, placed {st.network.placed}, still without a bed {st.network.unresolved}. Linear program (max patients placed, then same-city first), checked by an independent max-flow: {st.network.certificate ? "match" : "MISMATCH"}.</p>}
    {tr.length > 0 && <table className="num mt-2 w-full max-w-[640px] text-[12.5px]"><thead><tr className="text-left text-ink-3"><th className="font-semibold">From</th><th className="font-semibold">To</th><th className="text-right font-semibold">Patients</th></tr></thead>
      <tbody>{tr.map((t: any) => <tr key={`${t.from}>${t.to}`} className="border-t border-line"><td className="py-1 text-ink">{t.from_name}</td><td className="text-ink">{t.to_name}{t.first_day ? <span className="block text-[11px] text-ink-3">days {t.first_day}-{t.last_day}</span> : null}</td><td className="text-right text-ink">{t.patients}</td></tr>)}</tbody></table>}
  </section>);
}

const CENTRE: Record<string, [number, number]> = { ...CITY_POS, All: CITY_POS["Dhaka South"] };

function RealDiscovery({ city }: { city: string }) {
  const [from, setFrom] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const r = useAsync((s) => (from ? api<any>(`/api/preparedness/referrals?${qs({ lat: from.lat, lon: from.lon })}`, { signal: s, ttl: 120_000, timeout: 60_000 }) : Promise.resolve(null)), [from?.lat, from?.lon]);
  const centre = CENTRE[city] ?? CENTRE.All;
  const nat = r.data?.emergency ?? [{ number: "999", label: "National Emergency Service (police, fire service, ambulance)" }, { number: "16263", label: "Shasthya Batayon: DGHS health call centre (medical advice, 24/7)" }];
  const tiers: [string, string][] = [["nearby", "Nearby (up to 15 min by road)"], ["wider_city", "Wider city (15-30 min)"], ["district", "Rest of the district"], ["neighbouring_districts", "Neighbouring districts"], ["other_region", "Other bundled region (no road route)"]];
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => setFrom({ lat: p.coords.latitude, lon: p.coords.longitude, label: "your location (used once, not stored)" }), () => {}, { timeout: 10_000 });
  return (<section aria-labelledby="real-title" className="ops-panel p-4"><h3 id="real-title" className="text-[14px] font-semibold text-ink">Real hospitals and emergency contacts</h3>
    <p className="mt-0.5 text-[12.5px] text-ink-3">OpenStreetMap facilities bundled with the app. Their capacity and bed availability are unknown: the planning numbers above never apply to them.</p>
    <div className="mt-3 flex flex-wrap gap-2">{nat.map((n: any) => <a key={n.number} href={`tel:${n.number}`} className="ops-chip !min-h-11 gap-2 !border-[#ff6b72]"><b className="num text-[15px] text-ink">{n.number}</b><span className="text-[12px] font-normal text-ink-2">{n.label}</span></a>)}</div>
    <p className="mt-2 text-[11.5px] text-ink-3">Numbers checked 27 Nov 2026 against national press, the ITU project record and DGHS/WHO material; 16263&apos;s continuity has been questioned in the press, so call 999 if it does not answer. No ambulance-provider number is published here.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="ops-chip" onClick={() => setFrom({ lat: centre[1], lon: centre[0], label: `${city === "All" ? "Dhaka South" : city} centre` })}>Search from the {city === "All" ? "Dhaka South" : city} centre</button>
      <button type="button" className="ops-chip" onClick={locate}>Use my location</button>
      <a className="ops-chip" href="/geography/">Open Map &amp; Emergency Routing</a></div>
    {from && <p className="mt-2 text-[12px] text-ink-3">From {from.label}.</p>}
    {r.loading && <p role="status" className="mt-2 text-[12.5px] text-ink-2">Searching the bundled road graph…</p>}
    {r.error && <p className="mt-2 text-[12.5px] text-coral-d">Road search unavailable here. Call 999 or the hospital directly.</p>}
    {r.data && <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="real-tiers">{tiers.filter(([k]) => r.data.tiers[k]?.length).map(([k, label]) => (
      <div key={k}><div className="text-[12px] font-semibold text-ink-3">{label}</div>
        <ul className="mt-1 grid gap-1.5">{r.data.tiers[k].slice(0, 4).map((f: any) => (<li key={f.id} className="rounded-lg border border-line p-2 text-[12.5px]">
          <b className="text-ink">{f.name}</b><span className="num block text-ink-3">{f.est_time_s != null ? `${Math.max(1, Math.round(f.est_time_s / 60))} min, ${(f.distance_m / 1000).toFixed(1)} km by road (estimated)` : `${f.straight_line_km} km straight line; ${f.route_note}`}</span>
          <span className="block text-ink-3">{f.capacity} {f.availability}</span>
          {f.phone.length > 0 ? <span className="block">{f.phone.map((n: string) => <a key={n} href={`tel:${n.replace(/[^+\d]/g, "")}`} className="mr-2 font-semibold text-[#5fc3f0] underline">{n}</a>)}<span className="text-[11px] text-ink-3">{f.phone_source}</span></span>
            : <span className="block text-[11.5px] text-ink-3">No phone in the bundled data.</span>}</li>))}</ul></div>))}</div>}
  </section>);
}
