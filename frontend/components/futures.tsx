"use client";
// Climate Futures 2026-2030: exploratory multi-year scenario explorer. All numbers come from /api/scenarios/* (server-side Monte Carlo).
// Deliberately separate from the validated 2-4-week forecast: different model, different metrics, different label.
import { useState } from "react";
import { api, qs } from "@/lib/api";
import { Card, CardTitle, DataTable, Kpi, Loading, Notice, Segmented, useAsync } from "./ui";
import { Chart, axisStyle } from "./echart";

const SCEN = [{ value: "typical", label: "Typical" }, { value: "wetter", label: "Wetter (+20% rain)" }, { value: "drier", label: "Drier (−20% rain)" }, { value: "warmer", label: "Warmer (+1 °C)" }, { value: "custom", label: "Custom" }];
const CITIES = ["All", "Dhaka North", "Dhaka South", "Chattogram", "Gazipur", "Narayanganj"];
const YEARS = [2026, 2027, 2028, 2029, 2030];
const n0 = (x: any) => (x == null ? "—" : Math.round(Number(x)).toLocaleString("en-US"));
const pct = (x: any) => (x == null ? "—" : `${(Number(x) * 100).toFixed(0)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wkLabel = (i: number) => `${MONTHS[Math.min(11, Math.floor((i * 7) / 30.5))]} w${i + 1}`;

function RangeTile({ label, lo, hi, hint }: { label: string; lo: number; hi: number; hint?: string }) {
  return (<div className="card relative overflow-hidden p-4"><span className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-violet-500" />
    <div className="eyebrow">{label}</div><div className="num mt-2 text-[24px] font-bold leading-none tracking-[-0.02em] text-navy">{n0(lo)}–{n0(hi)}</div>
    {hint && <div className="mt-1.5 text-xs text-ink-3">{hint}</div>}</div>);
}

function download(name: string, text: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function ClimateFutures() {
  const [scenario, setScenario] = useState("typical");
  const [rain, setRain] = useState(1.0), [temp, setTemp] = useState(0);
  const [year, setYear] = useState(2026), [city, setCity] = useState("All"), [draws, setDraws] = useState(500);
  const [cmpA, setCmpA] = useState("typical"), [cmpB, setCmpB] = useState("wetter");
  const custom = scenario === "custom" ? { rain_mult: rain, temp_offset: temp } : {};
  const run = useAsync((s) => api(`/api/scenarios/run?${qs({ scenario, year, city, draws, ...custom })}`, { signal: s, ttl: 600_000 }), [scenario, rain, temp, year, city, draws]);
  const cmp = useAsync((s) => api(`/api/scenarios/compare?${qs({ a: cmpA, b: cmpB, year, city, draws })}`, { signal: s, ttl: 600_000 }), [cmpA, cmpB, year, city, draws]);
  const bt = useAsync((s) => api("/api/scenarios/backtest", { signal: s, ttl: 3_600_000 }), []);

  function exportCsv() {
    const r: any = run.data; if (!r) return;
    const head = [`# DengueShield AI exploratory climate scenario (not a forecast). scenario=${r.scenario} rain_mult=${r.assumptions.rain_mult} temp_offset_c=${r.assumptions.temp_offset_c} year=${r.year} city=${r.city} draws=${r.draws} seed=${r.seed}`,
      `# training data: synthetic organizer data 2016-2024 (2025 holdout never used); weather: ${r.assumptions.weather}`, "week,median,p10,p90"];
    download(`dengueshield_scenario_${r.scenario}_${r.year}_${r.city.replace(/\s/g, "_")}.csv`, head.concat(r.summary.weekly_median.map((m: number, i: number) => `${i + 1},${m},${r.summary.weekly_q10[i]},${r.summary.weekly_q90[i]}`)).join("\n"));
  }

  return (<section className="mt-8 grid gap-5" aria-label="Climate Futures 2026–2030">
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><span className="rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">Exploratory multi-year climate scenario</span>
          <h2 className="mt-2 text-xl font-bold text-ink">Climate Futures 2026–2030</h2>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">What-if seasons under hypothetical weather. A separate seasonal model, trained on 2016–2024 and simulated server-side by Monte Carlo. This is <b>not</b> the validated 2–4-week forecast, and its numbers are not forecasts of real dengue or real climate.</p></div>
        <span className="rounded-full border border-emerald/40 bg-mint-l px-2.5 py-1 text-[11px] font-semibold text-emerald-d">Short range stays: “Validated 2–4-week forecast”</span>
      </div>
      <div className="mt-3"><Notice tone="warn">Retrospective test (2019–2024, each year predicted from earlier years only): without knowing the weather, this engine is only about as accurate as seasonal climatology. With the true weather it would be far better, so rainfall matters, but future weather is unknown. Scenario differences are conditional model outputs, not causal effects. The 2025 holdout is never used; 2026–2030 are treated as equally uncertain years because 2016–2024 shows no trend.</Notice></div>
    </Card>

    <Card><CardTitle title="Scenario controls" sub="Assumptions, not predictions. Bounds keep inputs inside the observed weather range." />
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Scenario" value={scenario} onChange={(v) => setScenario(String(v))} options={SCEN} />
        <label className="text-[12px] text-ink-3">Year<select aria-label="Scenario year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="ml-2 rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink">{YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="text-[12px] text-ink-3">City<select aria-label="Scenario city" value={city} onChange={(e) => setCity(e.target.value)} className="ml-2 rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink">{CITIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <Segmented label="Simulation draws" value={draws} onChange={(v) => setDraws(Number(v))} options={[200, 500, 1000].map((x) => ({ value: x, label: String(x) }))} />
      </div>
      {scenario === "custom" && (<div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-[12px] text-ink-3">Rainfall multiplier: <b className="text-ink">{rain.toFixed(2)}×</b><input aria-label="Rainfall multiplier" type="range" min={0.7} max={1.3} step={0.05} value={rain} onChange={(e) => setRain(Number(e.target.value))} className="w-full accent-violet-600" /></label>
        <label className="text-[12px] text-ink-3">Temperature offset: <b className="text-ink">{temp >= 0 ? "+" : ""}{temp.toFixed(1)} °C</b><input aria-label="Temperature offset" type="range" min={-1} max={2} step={0.5} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="w-full accent-violet-600" /></label>
      </div>)}
    </Card>

    <Loading q={run} h={320}>{(r: any) => { const T = r.summary.total; return (<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={`Median cases · ${r.year}`} value={T.median} hint={r.city === "All" ? "all 60 synthetic wards" : r.city} />
        <RangeTile label="50% simulation range" lo={T.q50[0]} hi={T.q50[1]} hint="cases in the year" />
        <RangeTile label="80% simulation range" lo={T.q80[0]} hi={T.q80[1]} hint={`90%: ${n0(T.q90[0])} – ${n0(T.q90[1])}`} />
        <Kpi label="P(above historical median)" value={r.threshold.p_exceed * 100} digits={0} suffix="%" tone="warn" hint={`threshold ${n0(r.threshold.value)} cases/yr`} />
        <Kpi label="Climatology reference" value={r.climatology.median} hint={`80%: ${n0(r.climatology.q80[0])} – ${n0(r.climatology.q80[1])}`} tone="ok" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardTitle title={`Weekly seasonal trajectory · ${r.year}`} sub={`${SCEN.find((s) => s.value === r.scenario)?.label} · median with 10–90% simulation band`} />
          <Chart height={280} ariaLabel="Weekly scenario trajectory" option={{ grid: { left: 46, right: 12, top: 20, bottom: 30 }, tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: r.summary.weekly_median.map((_: any, i: number) => wkLabel(i)), ...axisStyle, axisLabel: { interval: 8, fontSize: 10 } }, yAxis: { type: "value", name: "cases/week", ...axisStyle },
            series: [{ name: "p10", type: "line", data: r.summary.weekly_q10, stack: "b", lineStyle: { opacity: 0 }, symbol: "none" },
              { name: "10–90%", type: "line", data: r.summary.weekly_q90.map((v: number, i: number) => v - r.summary.weekly_q10[i]), stack: "b", lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(124,58,237,.18)" }, symbol: "none" },
              { name: "Median", type: "line", data: r.summary.weekly_median, lineStyle: { width: 2.5, color: "#7c3aed" }, itemStyle: { color: "#7c3aed" }, symbol: "none" }] }} /></Card>
        <Card><CardTitle title="Multi-year view: history and 2026–2030 scenario" sub="Bars: observed synthetic totals 2016–2024 · 2025 sealed (holdout, not used) · lines: scenario median and 80% range" />
          <Chart height={280} ariaLabel="Multi-year scenario fan chart" option={(() => { const hy = Object.keys(r.history), fy = Object.keys(r.by_year), xs = [...hy, "2025", ...fy];
            return { grid: { left: 54, right: 12, top: 20, bottom: 30 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: xs, ...axisStyle }, yAxis: { type: "value", name: "cases/year", ...axisStyle },
              series: [{ name: "Observed (synthetic)", type: "bar", data: xs.map((y) => r.history[y] ?? null), itemStyle: { color: "#94a3b8", borderRadius: [4, 4, 0, 0] }, barWidth: "55%",
                  markArea: { silent: true, itemStyle: { color: "rgba(148,163,184,.15)" }, label: { show: true, color: "#64748b", fontSize: 10, formatter: "2025 sealed" }, data: [[{ xAxis: "2025" }, { xAxis: "2025" }]] } },
                { name: "p10", type: "line", data: xs.map((y) => r.by_year[y]?.q80[0] ?? null), stack: "f", lineStyle: { opacity: 0 }, symbol: "none" },
                { name: "80% range", type: "line", data: xs.map((y) => (r.by_year[y] ? r.by_year[y].q80[1] - r.by_year[y].q80[0] : null)), stack: "f", lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(124,58,237,.18)" }, symbol: "none" },
                { name: "Scenario median", type: "line", data: xs.map((y) => r.by_year[y]?.median ?? null), lineStyle: { width: 2.5, color: "#7c3aed" }, itemStyle: { color: "#7c3aed" } }] }; })()} /></Card>
        <Card><CardTitle title="Peak-week timing" sub="Share of simulated seasons peaking in each week (backtest peak-timing error ≈ 4–5 weeks)" />
          <Chart height={220} ariaLabel="Peak week distribution" option={{ grid: { left: 40, right: 12, top: 14, bottom: 30 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: r.summary.peak_week.map((_: any, i: number) => wkLabel(i)), ...axisStyle, axisLabel: { interval: 8, fontSize: 10 } }, yAxis: { type: "value", ...axisStyle, axisLabel: { formatter: (v: number) => `${Math.round((v / r.draws) * 100)}%` } },
            series: [{ type: "bar", data: r.summary.peak_week, itemStyle: { color: "#a78bfa", borderRadius: [3, 3, 0, 0] } }] }} /></Card>
        <Card><CardTitle title="City burden under this scenario" sub={`${r.year} · median and 80% simulation range`} right={<button onClick={exportCsv} className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold hover:bg-mint-l">Export CSV</button>} />
          <DataTable dense rows={Object.entries(r.summary.cities).map(([c, v]: any) => ({ c, ...v }))} cols={[{ key: "c", label: "City" }, { key: "median", label: "Median", align: "right", render: (x: any) => n0(x.median) }, { key: "q80", label: "80% range", align: "right", render: (x: any) => `${n0(x.q80[0])} – ${n0(x.q80[1])}` }, { key: "q90", label: "90% range", align: "right", render: (x: any) => `${n0(x.q90[0])} – ${n0(x.q90[1])}` }]} /></Card>
      </div></>); }}</Loading>

    <Card><CardTitle title="Compare two hypothetical futures" sub="Paired simulation: both use the same random draws, so the difference isolates the weather assumption" />
      <div className="flex flex-wrap gap-4"><Segmented label="Scenario A" value={cmpA} onChange={(v) => setCmpA(String(v))} options={SCEN.slice(0, 4)} /><Segmented label="Scenario B" value={cmpB} onChange={(v) => setCmpB(String(v))} options={SCEN.slice(0, 4)} /></div>
      <Loading q={cmp} h={200}>{(c: any) => (<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Difference B − A" value={c.difference.mean} hint={`80%: ${n0(c.difference.q80[0])} to ${n0(c.difference.q80[1])}`} tone={c.difference.mean > 0 ? "bad" : "ok"} />
          <Kpi label="Relative change" value={c.difference.relative_pct} digits={1} suffix="%" hint={`B higher in ${pct(c.difference.share_of_draws_b_higher)} of draws`} />
          <Kpi label="P(above median) · A" value={c.a.p_exceed * 100} digits={0} suffix="%" hint={`80% range ${n0(c.a.q80[0])}–${n0(c.a.q80[1])}`} />
          <Kpi label="P(above median) · B" value={c.b.p_exceed * 100} digits={0} suffix="%" hint={`80% range ${n0(c.b.q80[0])}–${n0(c.b.q80[1])}`} />
          <p className="col-span-2 text-[11.5px] text-ink-3">{c.warning}</p></div>
        <Chart height={240} ariaLabel="Scenario comparison weekly profile" option={{ grid: { left: 46, right: 12, top: 26, bottom: 30 }, legend: { top: 0 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: c.a.weekly_median.map((_: any, i: number) => wkLabel(i)), ...axisStyle, axisLabel: { interval: 8, fontSize: 10 } }, yAxis: { type: "value", name: "median cases/week", ...axisStyle },
          series: [{ name: `A: ${c.a.name}`, type: "line", data: c.a.weekly_median, symbol: "none", lineStyle: { width: 2, color: "#64748b" }, itemStyle: { color: "#64748b" } }, { name: `B: ${c.b.name}`, type: "line", data: c.b.weekly_median, symbol: "none", lineStyle: { width: 2.5, color: "#7c3aed" }, itemStyle: { color: "#7c3aed" } }] }} />
      </div>)}</Loading>
    </Card>

    <Card><CardTitle title="Season-ahead backtest (2019–2024)" sub="Each year simulated by a model fit only on earlier years · mean over six seasons · computed live from the engine" />
      <Loading q={bt} h={160}>{(b: any) => (<><DataTable dense rows={b.mean} cols={[{ key: "model", label: "Model", render: (r: any) => <b>{r.model}</b> }, { key: "ward_week_mae", label: "Ward-week MAE", align: "right", render: (r: any) => r.ward_week_mae.toFixed(3) }, { key: "ward_week_rmse", label: "RMSE", align: "right", render: (r: any) => r.ward_week_rmse.toFixed(3) }, { key: "annual_ape", label: "Annual total error", align: "right", render: (r: any) => pct(r.annual_ape) }, { key: "peak_week_error", label: "Peak timing error (wk)", align: "right", render: (r: any) => r.peak_week_error.toFixed(1) }, { key: "cov80_ward_week", label: "80% cov. (ward-week)", align: "right", render: (r: any) => pct(r.cov80_ward_week) }, { key: "cov90_ward_week", label: "90% cov. (ward-week)", align: "right", render: (r: any) => pct(r.cov90_ward_week) }, { key: "cov80_annual_city", label: "80% cov. (city-year)", align: "right", render: (r: any) => pct(r.cov80_annual_city) }]} />
        <p className="mt-2 text-[12px] text-ink-3">The oracle row uses the real target-year weather and is a diagnostic ceiling, never available for the future. Ranges are labelled “simulation ranges”: at ward-week level they were conservative (covering more than nominal); city-year coverage rests on only 30 city-seasons.</p></>)}</Loading>
    </Card>
  </section>);
}
