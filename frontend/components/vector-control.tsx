"use client";
// Problem 3 (Phase 2 onsite): vector-control scenario workstation. Crews deployed at the forecast origin change the saved forecast at 2, 3
// and 4 weeks through an explicit, user-set response model; the scenario then flows into Supply allocation (same stock) and Hospital surge
// (same illustrative capacity). Every number comes from GET /api/intervention/simulate on the local API. The dataset holds no spraying or
// larvicide records, so every effect is an assumption and every "prevented" figure is a counterfactual estimate, never a measurement.
import { useEffect, useMemo, useState } from "react";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { Chart } from "./echart";
import { Icon } from "./icons";
import { Live, PlanShared, Range, useDecisionGuard, useScenarioRequest } from "./supply-allocation";
import { planParams } from "@/lib/plan-scenario";
import { Btn, Card, DataTable, Notice, ProvChip, RiskBadge, Segmented, Tabs } from "./ui";

type Mode = "optimized" | "manual" | "stage1";
export const PRESETS: Record<string, { effect: number; coverage: number; delay: number; buildup: number; label: string }> = {
  cautious: { effect: 15, coverage: 25, delay: 1, buildup: 2, label: "Cautious" },
  moderate: { effect: 30, coverage: 35, delay: 1, buildup: 2, label: "Moderate" },
  strong: { effect: 45, coverage: 50, delay: 1, buildup: 1, label: "Strong" },
};
const RES = [["saline_bags_needed", "Saline bags"], ["diagnostic_kits_needed", "Diagnostic kits"], ["hospital_beds_required", "Hospital beds"]] as const;
const n1 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toLocaleString("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const arrow = (a: number, b: number) => <span className="num whitespace-nowrap">{a} <span className="text-ink-3">→</span> <b>{b}</b></span>;

function preventedOption(d: any) {
  const hs: string[] = d.horizons.map(String);
  const t = d.totals.by_horizon;
  return {
    grid: { left: 44, right: 16, top: 28, bottom: 44 },
    tooltip: { trigger: "axis", formatter: (ps: any[]) => { const h = hs[ps[0].dataIndex]; const x = t[h];
      return `Week of ${d.target_dates[h]} (+${h} weeks)<br/>Forecast ${n1(x.baseline)}, scenario ${n1(x.scenario)}<br/>Prevented ${n1(x.prevented)} (range ${n1(x.prevented_low)} to ${n1(x.prevented_high)})<br/>Effect timing ${Math.round(x.timing * 100)}%`; } },
    xAxis: { type: "category", data: hs.map((h) => `+${h} weeks`), axisTick: { show: false } },
    yAxis: { type: "value", name: "Cases prevented", nameTextStyle: { align: "left" }, splitLine: { lineStyle: { color: "#eef2f6" } } },
    series: [
      { type: "bar", name: "Cases prevented", data: hs.map((h) => +t[h].prevented.toFixed(2)), barWidth: "38%", itemStyle: { color: "#4a2bd0", borderRadius: [4, 4, 0, 0] } },
      { type: "custom", name: "Sensitivity range", z: 10, data: hs.map((h, i) => [i, t[h].prevented_low, t[h].prevented_high]),
        renderItem: (_: any, a: any) => { const lo = a.coord([a.value(0), a.value(1)]), hi = a.coord([a.value(0), a.value(2)]), w = 9, st = { stroke: "#1a1438", lineWidth: 2 };
          return { type: "group", children: [{ type: "line", shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: st },
            { type: "line", shape: { x1: hi[0] - w, y1: hi[1], x2: hi[0] + w, y2: hi[1] }, style: st }, { type: "line", shape: { x1: lo[0] - w, y1: lo[1], x2: lo[0] + w, y2: lo[1] }, style: st }] }; } },
    ],
  };
}

function curveOption(d: any) {
  const e = d.settings.effect;
  return {
    grid: { left: 40, right: 8, top: 16, bottom: 30 },
    tooltip: { trigger: "axis", formatter: (ps: any[]) => { const r = d.response_curve[ps[0].dataIndex]; const prev = d.response_curve[ps[0].dataIndex - 1];
      return `${r.crews} crew${r.crews === 1 ? "" : "s"}: ${Math.round(r.coverage * 100)}% of the ward treated, up to ${(e * r.coverage * 100).toFixed(1)}% fewer cases${prev ? `<br/>this crew adds ${(e * (r.coverage - prev.coverage) * 100).toFixed(1)} points` : ""}`; } },
    xAxis: { type: "category", name: "crews", nameLocation: "middle", nameGap: 20, data: d.response_curve.map((r: any) => String(r.crews)), axisTick: { show: false } },
    yAxis: { type: "value", max: 80, axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: "#eef2f6" } } },
    series: [{ type: "bar", data: d.response_curve.map((r: any) => +(e * r.coverage * 100).toFixed(2)), barWidth: "55%", itemStyle: { color: "#1baf7a", borderRadius: [4, 4, 0, 0] } }],
  };
}

export default function VectorControl({ shared }: { shared: PlanShared }) {
  const { sel } = useSel();
  const { lang } = useI18n();
  const { crews, setCrews, maxCrews, setMaxCrews } = shared;
  const { vecMode: mode, setVecMode: setMode, manual, setManual, eff, setEff } = shared;
  const { blocked, notice } = useDecisionGuard();
  const [tab, setTab] = useState("crews");
  const [showAll, setShowAll] = useState(false);
  const used = Object.values(manual).reduce((a, b) => a + b, 0);
  const overBudget = mode === "manual" && used > crews;
  const query = planParams(sel, shared);
  const q = useScenarioRequest(shared.readyScenario && !blocked && !overBudget ? `/api/intervention/simulate?${query}` : null);
  const d: any = q.data;
  const { report } = shared;
  useEffect(() => { report("intervene", q.status === "failed" ? { failed: true } : d ? { totals: d.totals, stale: !!q.stale } : overBudget ? { over: true } : null); }, [d, q.stale, q.status, overBudget, report]);
  const preset = Object.entries(PRESETS).find(([, v]) => v.effect === eff.effect && v.coverage === eff.coverage && v.delay === eff.delay && v.buildup === eff.buildup)?.[0] ?? "custom";
  const switchMode = (m: Mode) => {
    if (m === "manual" && mode !== "manual" && d && !q.stale) setManual(Object.fromEntries(d.wards.filter((w: any) => w.crews > 0).map((w: any) => [w.ward_id, w.crews])));
    setMode(m);
  };
  const step = (w: string, delta: number) => setManual((m) => { const v = Math.max(0, Math.min(maxCrews, (m[w] ?? 0) + delta)); const next = { ...m, [w]: v }; if (!v) delete next[w]; return next; });
  const rows = useMemo(() => {
    if (!d) return [];
    const withSums = d.wards.map((w: any) => ({ ...w, base_window: Object.values(w.by_horizon).reduce((a: number, x: any) => a + x.baseline, 0),
      low: Object.values(w.by_horizon).reduce((a: number, x: any) => a + x.prevented_low, 0), high: Object.values(w.by_horizon).reduce((a: number, x: any) => a + x.prevented_high, 0) }));
    const byWeight = [...withSums].sort((a, b) => b.window_weight - a.window_weight || a.ward_id.localeCompare(b.ward_id));
    if (mode === "manual" || showAll) return mode === "manual" ? byWeight : [...withSums.filter((w: any) => w.crews).sort((a: any, b: any) => a.roi_rank - b.roi_rank), ...byWeight.filter((w: any) => !w.crews)];
    return withSums.filter((w: any) => w.crews).sort((a: any, b: any) => a.roi_rank - b.roi_rank);
  }, [d, mode, showAll]);

  return (<Card id="vector" className="mt-5 scroll-mt-20" aria-labelledby="vector-title">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="vector-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Icon name="spray" size={18} className="text-forest" />Vector-control scenarios</h2>
        <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-snug text-ink-3">What spraying and larvicide crews could change 2 to 4 weeks ahead, under effects you set. The dataset has no intervention records, so every effect here is an assumption and every prevented case is a scenario estimate.</p></div>
      <div className="flex flex-wrap gap-2"><ProvChip tone="warn">Assumed effects, not measured</ProvChip><ProvChip tone="info">Runs offline</ProvChip></div>
    </div>

    {blocked ? notice : (<div className="grid gap-5 lg:grid-cols-[336px_minmax(0,1fr)]">
      <aside aria-label="Scenario settings" className="self-start rounded-2xl border-2 border-ink/80 bg-ivory p-4 lg:sticky lg:top-24">
        <Segmented label="Crew deployment" value={mode} onChange={(v) => switchMode(v as Mode)} options={[{ value: "optimized", label: "Optimized" }, { value: "manual", label: "Manual" }, { value: "stage1", label: "Supply plan" }]} />
        <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{mode === "optimized" ? "Each crew goes where it prevents the most modelled cases." : mode === "manual" ? "Add or remove crews ward by ward in the table." : "The coverage-first crews from Supply allocation, unchanged."}</p>
        <div className="mt-4 space-y-4">
          <Range label="Crews available (shared)" value={crews} min={0} max={120} step={1} onChange={setCrews} fmt={(v) => String(v)} />
          <Range label="Most crews per ward (shared)" value={maxCrews} min={1} max={6} step={1} onChange={setMaxCrews} fmt={(v) => String(v)} />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <Segmented label="Effect preset (illustrative)" value={preset} onChange={(v) => { const x = PRESETS[v as string]; if (x) setEff((e) => ({ ...e, ...x })); }} options={Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label }))} />
          <div className="mt-4 space-y-4">
            <Range label="Largest case reduction (E)" value={eff.effect} min={0} max={80} step={1} onChange={(v) => setEff((e) => ({ ...e, effect: v }))} fmt={(v) => `${v}%`} />
            <Range label="Ward share one crew treats (a)" value={eff.coverage} min={5} max={100} step={5} onChange={(v) => setEff((e) => ({ ...e, coverage: v }))} fmt={(v) => `${v}%`} />
            <Range label="Delay before any effect (d)" value={eff.delay} min={0} max={3} step={1} onChange={(v) => setEff((e) => ({ ...e, delay: v }))} fmt={(v) => `${v} wk`} />
            <Range label="Weeks to full effect (w)" value={eff.buildup} min={1} max={3} step={1} onChange={(v) => setEff((e) => ({ ...e, buildup: v }))} fmt={(v) => `${v} wk`} />
            <Range label="Sensitivity: low effect" value={eff.sensLow} min={0} max={100} step={10} onChange={(v) => setEff((e) => ({ ...e, sensLow: v }))} fmt={(v) => `${v}% of E`} />
            <Range label="Sensitivity: high effect" value={eff.sensHigh} min={100} max={200} step={10} onChange={(v) => setEff((e) => ({ ...e, sensHigh: v }))} fmt={(v) => `${v}% of E`} />
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-line bg-white p-3 text-[12px] leading-relaxed text-ink-2">
          <div className="font-semibold text-ink">Response model</div>
          <p className="mt-1">Coverage C(k) = 1 − (1 − a)<sup>k</sup></p><p>Timing T(h) = min(1, max(0, (h − d) / w))</p><p>Reduction R = E × C(k) × T(h), at most 80%</p>
          <p className="mt-1 text-ink-3">Scenario cases = (1 − R) × forecast. No crews or no effect gives the forecast exactly.</p></div>
      </aside>

      <div className="min-w-0">
        {overBudget && <Notice tone="warn"><b>The manual plan uses {used} crews but only {crews} are available.</b> Remove crews in the table or raise the budget.</Notice>}
        <Live q={q} h={520} label="Vector-control scenario">{() => (<div>
          {Object.keys(d.horizons_missing).length > 0 && <div className="mb-3"><Notice tone="warn">No out-of-time forecast for {Object.keys(d.horizons_missing).map((h) => `+${h} weeks`).join(" and ")} from this origin (the target falls in the next replay season); the totals cover {d.horizons.map((h: number) => `+${h}`).join(", ")} weeks only.</Notice></div>}
          <div className="rounded-2xl border-2 border-ink bg-mint-l p-4">
            <div className="text-[12.5px] font-semibold text-ink-3">Scenario estimate: cases prevented in the weeks of {d.horizons.map((h: number) => dateFmt(d.target_dates[h], lang)).join(", ")}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1"><span data-testid="prevented-total" className="font-display text-[40px] font-extrabold leading-none text-ink">{n1(d.totals.prevented_window)}</span>
              <span className="text-[13px] text-ink-2">range {n1(d.totals.prevented_window_low)} to {n1(d.totals.prevented_window_high)}, of {n1(d.totals.baseline_window)} forecast cases</span></div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
              <div><div className="text-ink-3">Crews used</div><b className="num text-ink">{d.totals.crews.assigned} of {d.totals.crews.total}</b></div>
              <div><div className="text-ink-3">Per crew</div><b className="num text-ink">{n1(d.totals.per_crew)} cases</b></div>
              <div><div className="text-ink-3">Optimized plan</div><b className="num text-ink">{n1(d.totals.compare.optimized)}</b></div>
              <div><div className="text-ink-3">Supply-plan crews</div><b className="num text-ink">{n1(d.totals.compare.stage1_rule)}</b></div></div>
            {d.totals.crews_by_city && <p data-testid="crews-by-city" className="mt-2 text-[12px] text-ink-2"><b>Crews by city</b> (one shared budget): {Object.entries(d.totals.crews_by_city).map(([c, n]) => `${c} ${n}`).join(", ")}.</p>}
            {d.totals.crews.unassigned > 0 && <p className="mt-2 text-[12px] text-ink-3">{d.totals.crews.unassigned} crew{d.totals.crews.unassigned === 1 ? "" : "s"} unassigned{mode === "optimized" ? ": every ward is at its crew limit or has no projected cases" : ""}.</p>}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-line p-3"><div className="text-[13px] font-semibold text-ink">Cases prevented by week</div>
              <p className="text-[12px] text-ink-3">Bars: central assumption. Whiskers: low and high effect. Later weeks gain more because the effect builds up.</p>
              <Chart option={preventedOption(d)} height={230} ariaLabel="Cases prevented at 2, 3 and 4 weeks with sensitivity range; the table below gives the same numbers" /></div>
            <div className="rounded-xl border border-line p-3"><div className="text-[13px] font-semibold text-ink">Diminishing returns in one ward</div>
              <p className="text-[12px] text-ink-3">Reduction at full strength by crews sent to one ward. Each extra crew treats a share of what is still untreated.</p>
              <Chart option={curveOption(d)} height={230} ariaLabel="Case reduction at full strength for 0 to the maximum crews per ward" /></div>
          </div>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] text-[12.5px]"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-3 font-semibold">Target week</th><th className="pr-3 text-right font-semibold">Forecast</th><th className="pr-3 text-right font-semibold">Scenario</th><th className="pr-3 text-right font-semibold">Prevented (range)</th><th className="text-right font-semibold">Effect timing</th></tr></thead>
            <tbody>{d.horizons.map((h: number) => { const x = d.totals.by_horizon[h]; return (<tr key={h} className="border-t border-line"><td className="py-1.5 pr-3">+{h} weeks, {dateFmt(d.target_dates[h], lang)} <span className="text-ink-3">({d.sources[h] === "replay" ? "validated replay" : "deployed model, out-of-time"})</span></td>
              <td className="num pr-3 text-right">{n1(x.baseline)}</td><td className="num pr-3 text-right">{n1(x.scenario)}</td><td className="num pr-3 text-right"><b>{n1(x.prevented)}</b> <span className="text-ink-3">({n1(x.prevented_low)} to {n1(x.prevented_high)})</span></td><td className="num text-right">{Math.round(x.timing * 100)}%</td></tr>); })}</tbody></table></div>

          <div className="mt-5"><Tabs group="vector" value={tab} onChange={setTab} tabs={[{ id: "crews", label: "Crew plan and ROI" }, { id: "supplies", label: "Supplies" }, { id: "hospital", label: "Hospital" }, { id: "sensitivity", label: "Sensitivity" }, { id: "sources", label: "Sources and limits" }]} /></div>

          {tab === "crews" && (<div role="tabpanel" aria-label="Crew plan and ROI">
            <p className="text-[12.5px] text-ink-2">{d.totals.weakest_assigned_gain !== null && d.totals.best_unused_gain !== null
              ? (d.totals.weakest_assigned_gain >= d.totals.best_unused_gain - 1e-9 ? <>Optimality check passed: the weakest crew in this plan prevents {n1(d.totals.weakest_assigned_gain)} cases; the best unused option would prevent {n1(d.totals.best_unused_gain)}. No single move can do better under these assumptions.</>
                : <>This plan can be improved: the weakest crew prevents {n1(d.totals.weakest_assigned_gain)} cases while an unused option would prevent {n1(d.totals.best_unused_gain)}. Try Optimized.</>) : "No crews deployed."}</p>
            {mode === "manual" && <p className="mt-1 text-[12.5px] font-semibold text-ink">{crews - used} of {crews} crews left to place.</p>}
            {mode !== "manual" && <label className="mt-2 inline-flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-[#4a2bd0]" />Show wards without crews</label>}
            <div className="mt-2"><DataTable dense maxH={460} rows={rows} cols={[
              { key: "roi_rank", label: "ROI rank", align: "right", render: (w: any) => w.roi_rank ?? "-" },
              { key: "ward_id", label: "Ward", render: (w: any) => <span><b>{w.ward_id}</b><span className="block text-[11px] text-ink-3">{w.city}</span></span> },
              { key: "risk_tier", label: "Risk", render: (w: any) => <RiskBadge tier={w.risk_tier} size="sm" /> },
              { key: "base_window", label: "Forecast, weeks 2-4", align: "right", render: (w: any) => n1(w.base_window) },
              { key: "crews", label: "Crews", align: "right", render: (w: any) => mode === "manual" ? (<span className="inline-flex items-center gap-1">
                <button type="button" aria-label={`Remove a crew from ${w.ward_id}`} disabled={!manual[w.ward_id]} onClick={() => step(w.ward_id, -1)} className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink text-[16px] font-bold disabled:opacity-30 sm:h-9 sm:w-9">−</button>
                <b className="num w-5 text-center">{manual[w.ward_id] ?? 0}</b>
                <button type="button" aria-label={`Add a crew to ${w.ward_id}`} disabled={(manual[w.ward_id] ?? 0) >= maxCrews || used >= crews} onClick={() => step(w.ward_id, 1)} className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-[#4a2bd0] text-[16px] font-bold text-white disabled:opacity-30 sm:h-9 sm:w-9">+</button></span>) : <b className="num">{w.crews}</b> },
              { key: "prevented_window", label: "Prevented (range)", align: "right", render: (w: any) => <span className="num"><b>{n1(w.prevented_window)}</b><span className="block text-[11px] text-ink-3">{n1(w.low)} to {n1(w.high)}</span></span> },
              { key: "per_crew", label: "Per crew", align: "right", render: (w: any) => n1(w.per_crew) },
              { key: "next_crew_gain", label: "Next crew adds", align: "right", render: (w: any) => w.next_crew_gain === null ? "at limit" : n1(w.next_crew_gain) }]} /></div>
            <p className="mt-2 text-[12px] text-ink-3">ROI = modelled cases prevented per crew over the three forecast weeks, under the assumptions on the left. Ties go to the ward with the higher outbreak probability, then ward ID.</p>
          </div>)}

          {tab === "supplies" && (<div role="tabpanel" aria-label="Supplies" className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-3 font-semibold">At +{d.planning_horizon} weeks ({d.settings.service_label})</th><th className="pr-3 text-right font-semibold">Stock (same)</th><th className="pr-3 text-right font-semibold">Projected demand</th><th className="pr-3 text-right font-semibold">Change in demand</th><th className="pr-3 text-right font-semibold">Short</th><th className="text-right font-semibold">Stock not needed</th></tr></thead>
              <tbody>{RES.map(([k, label]) => { const x = d.resources.totals[k]; return (<tr key={k} className="border-t border-line"><td className="py-2 pr-3 font-semibold text-ink">{label}</td><td className="num pr-3 text-right">{x.supply}</td>
                <td className="pr-3 text-right">{arrow(x.baseline_demand, x.scenario_demand)}</td><td className="num pr-3 text-right font-bold text-ink">−{x.demand_saving}</td><td className="pr-3 text-right">{arrow(x.baseline_unmet, x.scenario_unmet)}</td><td className="num text-right">{x.stock_not_required}</td></tr>); })}</tbody></table>
            <p className="mt-2 text-[12px] text-ink-3">{d.resources.note} Rounded once, through the dataset's resource rule, after scaling the forecast.</p></div>)}

          {tab === "hospital" && (<div role="tabpanel" aria-label="Hospital">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Bed demand", "demand"], ["Over capacity", "deficit"], ["Transfers", "transferred"], ["No bed in own city", "unresolved"]].map(([l, k]) => (
              <div key={k} className="rounded-xl border border-line p-3"><div className="text-[12px] font-semibold text-ink-3">{l}</div><div className="mt-1 text-[18px]">{arrow(d.hospital.totals.baseline[k], d.hospital.totals.scenario[k])}</div></div>))}</div>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-[13px]"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-3 font-semibold">City</th><th className="pr-3 text-right font-semibold">Capacity</th><th className="pr-3 text-right font-semibold">Bed demand</th><th className="pr-3 text-right font-semibold">Over capacity</th><th className="pr-3 text-right font-semibold">Transfers</th><th className="text-right font-semibold">No bed</th></tr></thead>
              <tbody>{d.hospital.cities.map((c: any) => (<tr key={c.city} className="border-t border-line"><td className="py-2 pr-3 font-semibold text-ink">{c.city}</td><td className="num pr-3 text-right">{c.capacity}</td><td className="pr-3 text-right">{arrow(c.baseline_demand, c.scenario_demand)}</td>
                <td className="pr-3 text-right">{arrow(c.baseline_deficit, c.scenario_deficit)}</td><td className="pr-3 text-right">{arrow(c.baseline_transferred, c.scenario_transferred)}</td><td className="pr-3 text-right">{arrow(c.baseline_unresolved, c.scenario_unresolved)}</td></tr>))}</tbody></table></div>
            <p className="mt-2 text-[12px] text-ink-3">{d.hospital.note} Capacity is {d.settings.capacity_pct}% of the illustrative baseline set in Hospital surge.</p></div>)}

          {tab === "sensitivity" && (<div role="tabpanel" aria-label="Sensitivity" className="overflow-x-auto">
            <p className="mb-2 text-[12.5px] text-ink-2">Cases prevented over the three weeks for the same crews, if the effect were smaller or larger and arrived sooner or later.</p>
            <table className="w-full min-w-[420px] text-[13px]"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-3 font-semibold">Effect (share of E)</th>{[0, 1, 2, 3].map((x) => <th key={x} className="pr-3 text-right font-semibold">delay {x} wk</th>)}</tr></thead>
              <tbody>{Array.from(new Set(d.sensitivity.map((r: any) => r.effect_multiplier))).map((m: any) => (<tr key={m} className="border-t border-line"><td className="py-2 pr-3 font-semibold">{Math.round(m * 100)}%</td>
                {[0, 1, 2, 3].map((dl) => { const r = d.sensitivity.find((x: any) => x.effect_multiplier === m && x.delay === dl); const cur = m === 1 && dl === d.settings.delay;
                  return <td key={dl} className={"num pr-3 text-right " + (cur ? "rounded bg-mint-l font-bold text-ink" : "")}>{n1(r?.prevented_window)}</td>; })}</tr>))}</tbody></table></div>)}

          {tab === "sources" && (<div role="tabpanel" aria-label="Sources and limits" className="grid gap-3 md:grid-cols-2">
            {[["Observed data", d.disclosure.observed, "#5e567f"], ["Saved forecasts", d.disclosure.forecast, "#4a2bd0"], ["Your assumptions", d.disclosure.assumptions, "#c98500"], ["Scenario estimates", d.disclosure.scenario, "#1baf7a"]].map(([t, body, c]) => (
              <div key={t} className="rounded-xl border border-line border-l-[5px] p-3" style={{ borderLeftColor: c }}><div className="text-[13px] font-semibold text-ink">{t}</div><p className="mt-1 text-[12.5px] leading-snug text-ink-2">{body}</p></div>))}
            <div className="rounded-xl border border-line border-l-[5px] border-l-[#c2303a] p-3 md:col-span-2"><div className="text-[13px] font-semibold text-ink">Limitations</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-2">{d.disclosure.limitations.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
          </div>)}
        </div>)}</Live>
        {mode === "manual" && used > 0 && <div className="mt-3"><Btn variant="ghost" onClick={() => setManual({})}>Clear manual crews</Btn></div>}
      </div>
    </div>)}
  </Card>);
}
