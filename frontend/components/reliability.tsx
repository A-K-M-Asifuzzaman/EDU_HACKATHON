"use client";
// Forecast Reliability Center + Outbreak Alert Policy Simulator. Saved out-of-time artifacts only (seasons 2019-2024); nothing is refitted.
import { useMemo, useState } from "react";
import { api, qs } from "@/lib/api";
import { cls } from "@/lib/format";
import { Card, CardTitle, DataTable, Kpi, Loading, Notice, Segmented, useAsync } from "./ui";
import { Chart, axisStyle } from "./echart";

const f2 = (x: any) => (x == null ? "—" : Number(x).toFixed(2));
const f3 = (x: any) => (x == null ? "—" : Number(x).toFixed(3));
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];

export default function ReliabilityCenter() {
  const [h, setH] = useState(3);
  const diag = useAsync((s) => api(`/api/model/diagnostics?horizon=${h}`, { signal: s, ttl: 600_000 }), [h]);
  const cal = useAsync((s) => api("/api/model/calibration", { signal: s, ttl: 600_000 }), []);
  const nb = useMemo(() => { const ic = cal.data?.interval_coverage ?? []; return { 80: ic.find((r: any) => r.method === "nb_coverage" && r.level === 0.8), 90: ic.find((r: any) => r.method === "nb_coverage" && r.level === 0.9) }; }, [cal.data]);
  const d = diag.data;
  return (<div className="grid gap-5">
    <div className="flex flex-wrap items-end gap-3"><Segmented label="Forecast horizon" value={h} onChange={(v) => setH(Number(v))} options={[2, 3, 4].map((x) => ({ value: x, label: `${x} weeks` }))} />
      <p className="max-w-2xl text-[12px] text-ink-3">Every number below comes from saved out-of-time predictions: each season 2019–2024 was forecast by a model trained only on earlier seasons, with calibration and alert thresholds learned on the two previous seasons. The 2025 test year is locked. Nothing is refitted here.</p></div>
    <Loading q={diag} h={120}>{() => (<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label={`MAE · ${h} weeks`} value={d.mae} digits={2} hint="cases per ward-week" />
      <Kpi label="RMSE" value={d.rmse} digits={2} hint={`bias ${f2(d.bias)}`} />
      <Kpi label="Alert recall" value={d.alert.recall * 100} digits={1} suffix="%" tone="warn" hint={`precision ${(d.alert.precision * 100).toFixed(1)}%`} />
      <Kpi label="False-alert rate" value={d.alert.false_alert_rate * 100} digits={1} suffix="%" tone="bad" hint="non-outbreak weeks flagged" />
      <Kpi label="80% interval coverage" value={d.coverage["80"] * 100} digits={1} suffix="%" hint={`mean width ${f2(d.coverage.mean_width_80)} cases`} />
      <Kpi label="90% interval coverage" value={d.coverage["90"] * 100} digits={1} suffix="%" hint={`mean width ${f2(d.coverage.mean_width_90)} cases`} />
      <Kpi label="80% coverage at peaks" value={d.coverage["80_high_weeks"] * 100} digits={1} suffix="%" tone="bad" hint={`pooled, ${h} weeks`} />
      <Kpi label="Peaks under-predicted" value={d.high_incidence.under_share * 100} digits={0} suffix="%" tone="bad" hint={`mean bias ${f2(d.high_incidence.bias)} cases`} />
    </div>)}</Loading>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardTitle title="Coverage by incidence severity" sub="The known weakness: intervals are honest on average and optimistic at outbreak peaks" />
        <Loading q={cal} h={160}>{() => (<table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase text-ink-3"><th className="py-1">Weeks</th><th>80% nominal</th><th>90% nominal</th><th>Width 80% / 90%</th></tr></thead><tbody>
          <tr className="border-t border-line"><td className="py-1.5">All weeks</td><td className="num">{f3(nb[80]?.coverage)}</td><td className="num">{f3(nb[90]?.coverage)}</td><td className="num">{f2(nb[80]?.width)} / {f2(nb[90]?.width)}</td></tr>
          <tr className="border-t border-line bg-coral/5"><td className="py-1.5 font-semibold">High-incidence (≥ q90)</td><td className="num font-bold text-coral-d">{f3(nb[80]?.coverage_high)}</td><td className="num font-bold text-coral-d">{f3(nb[90]?.coverage_high)}</td><td className="num">{f2(nb[80]?.width_high)} / {f2(nb[90]?.width_high)}</td></tr>
          <tr className="border-t border-line"><td className="py-1.5">Zero-case weeks</td><td className="num">{f3(nb[80]?.coverage_zero)}</td><td className="num">{f3(nb[90]?.coverage_zero)}</td><td /></tr>
        </tbody></table>)}</Loading>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">Deployed calibration (NB, dispersion learned on prior seasons): mean over 6 seasons × 3 horizons, as documented (≈ 61% and 74% at peaks). The KPI above is pooled over ward-weeks for the selected horizon, so it differs slightly.</p>
        {d && <Chart height={200} ariaLabel="Error by size of the actual outcome" option={{ grid: { left: 44, right: 10, top: 28, bottom: 30 }, legend: { top: 0, textStyle: { fontSize: 11 } }, tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: d.by_outcome_size.map((r: any) => r.bucket), name: "actual cases", nameLocation: "middle", nameGap: 22, ...axisStyle }, yAxis: { type: "value", ...axisStyle },
          series: [{ name: "MAE", type: "bar", data: d.by_outcome_size.map((r: any) => r.mae), itemStyle: { color: "#0f8b80", borderRadius: [4, 4, 0, 0] } }, { name: "Bias (forecast − actual)", type: "line", data: d.by_outcome_size.map((r: any) => r.bias), itemStyle: { color: "#b3262c" } }] }} />}
      </Card>
      <Card><CardTitle title="Validation by season" sub={`Out-of-time MAE per season, ${h} weeks ahead (2019–2021 robustness, 2022–2024 benchmark)`} />
        {d && <Chart height={220} ariaLabel="MAE by validation season" option={{ grid: { left: 40, right: 10, top: 20, bottom: 28 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: d.by_season.map((r: any) => r.year), ...axisStyle }, yAxis: { type: "value", name: "MAE", ...axisStyle },
          series: [{ type: "bar", data: d.by_season.map((r: any) => ({ value: r.mae, itemStyle: { color: r.year >= 2022 ? "#0b1b2e" : "#7a8a9a", borderRadius: [4, 4, 0, 0] } })), label: { show: true, position: "top", fontSize: 10, formatter: (p: any) => p.value.toFixed(2) } }] }} />}
        <CardTitle title="Is the outbreak probability calibrated?" sub="Predicted P(outbreak) vs observed outbreak share, binned (reliability diagram)" />
        {d && <Chart height={200} ariaLabel="Reliability diagram" option={{ grid: { left: 40, right: 10, top: 10, bottom: 34 }, tooltip: { trigger: "item", formatter: (p: any) => `predicted ${f3(p.value[0])}<br/>observed ${f3(p.value[1])}<br/>n = ${p.data.n}` },
          xAxis: { type: "value", min: 0, max: 1, name: "predicted", nameLocation: "middle", nameGap: 22, ...axisStyle }, yAxis: { type: "value", min: 0, max: 1, ...axisStyle },
          series: [{ type: "line", data: [[0, 0], [1, 1]], symbol: "none", lineStyle: { type: "dashed", color: "#9aa7b4" }, silent: true }, { type: "scatter", data: d.reliability.map((r: any) => ({ value: [r.predicted, r.observed], n: r.n })), symbolSize: (v: any, p: any) => Math.max(6, Math.min(22, Math.sqrt(p.data.n) / 5)), itemStyle: { color: "#2bb5cf" } }] }} />}
      </Card>
    </div>
    <AlertSimulator h={h} />
  </div>);
}

function AlertSimulator({ h }: { h: number }) {
  const [years, setYears] = useState<number[]>(YEARS);
  const [tau, setTau] = useState(0.3);
  const curve = useAsync((s) => api(`/api/decision/alert-curve?${qs({ horizon: h, years: years.join(",") })}`, { signal: s, ttl: 600_000 }), [h, years.join(",")]);
  const c = curve.data;
  const at = c?.curve.find((r: any) => Math.abs(r.threshold - tau) < 1e-6);
  const row = (name: string, r: any, note: string) => ({ name, note, ...r });
  const pct = (x: any) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
  return (<Card><CardTitle title="Outbreak alert policy simulator" sub="Retrospective policy exploration on saved out-of-time predictions (2019–2024). The deployed alert rule is unchanged." />
    <Notice tone="warn">Choosing a threshold here and reading its numbers off the same seasons is <b>optimistic</b>: it is not a validated result. The honest comparison is the deployed rule and the nested re-selection (threshold chosen on the two previous seasons only).</Notice>
    <div className="mt-4 flex flex-wrap items-end gap-5">
      <label className="min-w-[260px] flex-1"><span className="eyebrow mb-1 flex justify-between"><span>Alert threshold on P(outbreak)</span><b className="num text-navy">{tau.toFixed(2)}</b></span>
        <input type="range" min={0.02} max={0.98} step={0.02} value={tau} onChange={(e) => setTau(Number(e.target.value))} aria-label="Alert threshold" className="w-full accent-teal" /></label>
      <div><span className="eyebrow mb-1 block">Seasons</span><div className="flex flex-wrap gap-1">{YEARS.map((y) => (<button key={y} aria-pressed={years.includes(y)} onClick={() => setYears((ys) => (ys.includes(y) ? (ys.length > 1 ? ys.filter((x) => x !== y) : ys) : [...ys, y].sort()))}
        className={cls("min-h-10 min-w-[52px] rounded-lg border px-3 py-2 text-[13px] sm:min-h-0 sm:min-w-0 sm:px-2 sm:py-1 sm:text-[12px]", years.includes(y) ? "border-navy bg-navy text-white" : "border-line text-ink-3")}>{y}</button>))}</div></div>
    </div>
    <Loading q={curve} h={260}>{() => (<div className="mt-4 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Chart height={260} ariaLabel="Recall, precision, F1 and false-alert rate by threshold" option={{ grid: { left: 40, right: 12, top: 30, bottom: 30 }, legend: { top: 0, textStyle: { fontSize: 11 } }, tooltip: { trigger: "axis", valueFormatter: (v: any) => (v == null ? "—" : Number(v).toFixed(3)) },
        xAxis: { type: "category", data: c.curve.map((r: any) => r.threshold.toFixed(2)), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 5 } }, yAxis: { type: "value", min: 0, max: 1, ...axisStyle },
        series: [["Recall", "recall", "#0f8b80"], ["Precision", "precision", "#0b1b2e"], ["F1", "f1", "#2bb5cf"], ["False-alert rate", "false_alert_rate", "#b3262c"]].map(([n, k, col], i) => ({ name: n, type: "line", symbol: "none", data: c.curve.map((r: any) => r[k]), lineStyle: { color: col, width: 2 }, itemStyle: { color: col },
          ...(i === 0 ? { markLine: { symbol: "none", silent: true, lineStyle: { color: "#e0a526", width: 2 }, label: { show: false }, data: [{ xAxis: tau.toFixed(2) }] } } : {}) })) }} />
      <div className="grid grid-cols-2 gap-2 text-[13px]">{at && [["True alerts", at.tp], ["False alerts", at.fp], ["Missed outbreaks", at.fn], ["Flagged ward-weeks", at.flagged], ["Recall", pct(at.recall)], ["Precision", pct(at.precision)], ["F1", f3(at.f1)], ["False-alert rate", pct(at.false_alert_rate)]].map(([k, v]) => (
        <div key={k as string} className="rounded-xl border border-line p-2.5"><div className="text-[11px] text-ink-3">{k}</div><div className="num text-[18px] font-bold text-navy">{typeof v === "number" ? v.toLocaleString() : v}</div></div>))}
        <p className="col-span-2 text-[11px] text-ink-3">{c.rows.toLocaleString()} ward-weeks, {c.outbreak_weeks.toLocaleString()} outbreak weeks (base rate {pct(c.base_rate)}). {c.definition}.</p></div>
    </div>)}</Loading>
    {c && <div className="mt-4"><DataTable dense rows={[row("Deployed rule (as validated)", c.deployed, "threshold tuned per season on the two previous seasons"), ...(c.nested ? [row("Nested F1 re-selection", c.nested, `thresholds ${c.nested.seasons.map((s: any) => `${s.year}: ${s.tau}`).join(", ")}; seasons ${c.nested.seasons[0].year}+ only`)] : []),
      row(`Selected threshold ${tau.toFixed(2)}`, at ?? {}, "retrospective; optimistic if tuned here"), row(`Best in-sample F1 (${c.best_in_sample.threshold.toFixed(2)})`, c.best_in_sample, "optimistic: chosen and scored on the same rows")]}
      cols={[{ key: "name", label: "Policy", render: (r: any) => <b>{r.name}</b> }, { key: "recall", label: "Recall", align: "right" as const, render: (r: any) => pct(r.recall) }, { key: "precision", label: "Precision", align: "right" as const, render: (r: any) => pct(r.precision) },
        { key: "f1", label: "F1", align: "right" as const, render: (r: any) => f3(r.f1) }, { key: "false_alert_rate", label: "False-alert rate", align: "right" as const, render: (r: any) => pct(r.false_alert_rate) }, { key: "flagged", label: "Flagged", align: "right" as const }, { key: "note", label: "How it was chosen", render: (r: any) => <span className="text-[11.5px] text-ink-3">{r.note}</span> }]} /></div>}
  </Card>);
}
