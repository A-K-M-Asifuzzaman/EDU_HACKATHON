"use client";
// Resource planning sandbox: compare three transparent, deterministic rules for sending N teams to wards. Planning simulation on
// historical replay only; outcomes are retrospective coverage counts, never prevented infections or real capacity.
import { useState } from "react";
import { api, qs } from "@/lib/api";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { Card, CardTitle, Loading, Notice, useAsync } from "./ui";
import { Chart, axisStyle } from "./echart";

const NAMES: Record<string, [string, string]> = { equal: ["Equal (risk-blind)", "#7a8a9a"], historical: ["Historical risk", "#e0a526"], forecast: ["Forecast alert priority", "#0f8b80"] };

export default function ResourceSandbox() {
  const { sel } = useSel();
  const { lang } = useI18n();
  const [teams, setTeams] = useState(10);
  const year = Number(sel.origin.slice(0, 4));
  const one = useAsync((s) => api(`/api/decision/allocate?${qs({ origin: sel.origin, horizon: sel.horizon, teams })}`, { signal: s, ttl: 300_000 }), [sel.origin, sel.horizon, teams]);
  const season = useAsync((s) => (year >= 2019 && year <= 2024 ? api(`/api/decision/allocation-season?${qs({ year, horizon: sel.horizon, teams })}`, { signal: s, ttl: 600_000 }) : Promise.resolve(null)), [year, sel.horizon, teams]);
  const a = one.data, z = season.data;
  return (<Card className="mt-5"><CardTitle title="Resource planning sandbox" sub="How would different prioritisation rules have placed a fixed number of field teams? Planning simulation on historical replay." />
    <Notice tone="warn"><b>Planning simulation, not a deployment recommendation.</b> One team per ward. Outcomes are retrospective coverage counts of what actually happened in the target week; they are not prevented infections, and real team capacity is unknown.</Notice>
    <div className="mt-4 flex flex-wrap items-end gap-4">
      <label className="w-64"><span className="eyebrow mb-1 flex justify-between"><span>Teams available</span><b className="num text-navy">{teams}</b></span>
        <input type="range" min={1} max={30} value={teams} onChange={(e) => setTeams(Number(e.target.value))} aria-label="Teams available" className="w-full accent-teal" /></label>
      <p className="text-[12px] text-ink-3">Origin {dateFmt(sel.origin, lang)}, {sel.horizon} weeks ahead (change it with the controls above). Rules: <b>equal</b> spreads teams round-robin across cities without risk information; <b>historical</b> picks wards with the highest mean weekly cases observed before the origin; <b>forecast</b> picks the highest calibrated outbreak probability.</p>
    </div>
    <Loading q={one} h={200}>{() => (<div className="mt-4 grid gap-3 lg:grid-cols-3">{(["equal", "historical", "forecast"] as const).map((k) => { const s = a.strategies[k]; return (
      <div key={k} className="rounded-xl border border-line p-3">
        <div className="flex items-center gap-2 font-semibold text-navy"><i className="h-2.5 w-2.5 rounded-full" style={{ background: NAMES[k][1] }} />{NAMES[k][0]}</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]"><div><div className="text-ink-3">Outbreak wards reached</div><b className="num text-[18px]">{s.outbreak_wards_covered}</b><span className="text-ink-3"> / {a.actual_outbreak_wards}</span></div>
          <div><div className="text-ink-3">Actual cases in chosen wards</div><b className="num text-[18px]">{s.actual_cases_covered}</b><span className="text-ink-3"> / {a.actual_cases}</span></div></div>
        <div className="mt-2 flex flex-wrap gap-1">{s.wards.map((w: any) => <span key={w.ward_id} title={`${w.ward_id}: P(outbreak) ${w.p_outbreak}, historical mean ${w.hist_mean}, actual ${w.actual}`} className={`rounded-md px-1.5 py-0.5 text-[10.5px] ${w.outbreak ? "bg-coral/15 font-semibold text-coral-d" : "bg-canvas text-ink-2"}`}>{w.ward_id.replace("_Ward_", " ")}</span>)}</div>
      </div>); })}</div>)}</Loading>
    {one.error && <p className="mt-2 text-[12px] text-ink-3">Choose a validation origin (2019–2024) to evaluate allocations retrospectively.</p>}
    {a && <p className="mt-2 text-[11px] text-ink-3">Target week {dateFmt(a.target_date, lang)}: {a.actual_outbreak_wards} of {a.wards} wards had an outbreak week (actual ≥ training q90). Red chips mark wards that turned out to be outbreak wards.</p>}
    {z && (<div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Chart height={200} ariaLabel="Share of outbreak ward-weeks reached over the whole season" option={{ grid: { left: 130, right: 30, top: 10, bottom: 24 }, tooltip: { trigger: "axis", valueFormatter: (v: any) => `${(v * 100).toFixed(1)}%` },
        xAxis: { type: "value", max: 1, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v: number) => `${v * 100}%` } }, yAxis: { type: "category", data: ["equal", "historical", "forecast"].map((k) => NAMES[k][0]), ...axisStyle },
        series: [{ type: "bar", data: ["equal", "historical", "forecast"].map((k) => ({ value: z.strategies[k].share_outbreak_wards, itemStyle: { color: NAMES[k][1], borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: "right", formatter: (p: any) => `${(p.value * 100).toFixed(1)}%` } }] }} />
      <p className="text-[12.5px] leading-relaxed text-ink-2">Across all {z.origins} origins of {z.year} ({sel.horizon} weeks ahead, {teams} teams), the share of actual outbreak ward-weeks that a team would have reached: equal <b>{(z.strategies.equal.share_outbreak_wards * 100).toFixed(1)}%</b>, historical risk <b>{(z.strategies.historical.share_outbreak_wards * 100).toFixed(1)}%</b>, forecast <b>{(z.strategies.forecast.share_outbreak_wards * 100).toFixed(1)}%</b>. Both risk-based rules beat a risk-blind spread; whether the forecast beats simple history varies by season, so read this as evidence for using risk information, not as proof the model is superior.</p>
    </div>)}
  </Card>);
}
