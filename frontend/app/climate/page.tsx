"use client";
import { useMemo, useState } from "react";
import { api, qs, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { monthName, num } from "@/lib/format";
import { Card, CardTitle, DataTable, ErrorState, Kpi, Notice, PageHeader, ProvChip, Segmented, Select, Skeleton, useAsync } from "@/components/ui";
import { Chart, axisStyle } from "@/components/echart";

const SRC_COLOR = { nasa_power: "#0b5cad", open_meteo: "#e8782f", organizer: "#8d99ae" } as const;
const SRC_NAME = { nasa_power: "NASA POWER", open_meteo: "Open-Meteo", organizer: "Organizer (synthetic)" } as const;
type Prov = "nasa_power" | "open_meteo";

async function safe(path: string, signal: AbortSignal) {      // a failing provider must never break the page
  try { return await api(path, { ttl: 300_000, signal }); } catch (e: any) { if (e?.name === "AbortError") throw e; return { status: "unavailable", error: e instanceof ApiError ? e.message : String(e) }; }
}

export default function Climate() {
  const { t, lang } = useI18n();
  const [city, setCity] = useState("Dhaka");
  const [range, setRange] = useState("2016-2024");
  const [prov, setProv] = useState<Prov>("nasa_power");
  const [metric, setMetric] = useState<"rain_mm" | "temp_c" | "rh_pct">("rain_mm");
  const [from, to] = range.split("-").map(Number);
  const start = `${from}-01-01`, end = `${to}-12-31`;
  const compare = useAsync((s) => safe(`/api/climate/compare?${qs({ city, start, end })}`, s), [city, range]);
  const nasa = useAsync((s) => safe(`/api/climate/observations?${qs({ provider: "nasa_power", city, start, end })}`, s), [city, range]);
  const om = useAsync((s) => safe(`/api/climate/observations?${qs({ provider: "open_meteo", city, start, end })}`, s), [city, range]);
  const now = useAsync((s) => safe(`/api/climate/current?${qs({ city })}`, s), [city]);
  const D = { nasa_power: nasa.data, open_meteo: om.data };
  const cur = D[prov];
  const ok = (x: any) => x && x.status === "ok";
  const C = compare.data;
  const unit = { rain_mm: "mm/month", temp_c: "°C", rh_pct: "%" }[metric];
  const label = { rain_mm: "Rainfall", temp_c: "Mean temperature", rh_pct: "Relative humidity" }[metric];

  const clim = useMemo(() => {
    if (!C || C.status === "unavailable" || !C.monthly_climatology) return {};
    const m = (k: string) => (C.monthly_climatology[k] ?? []).map((r: any) => r[metric]);
    return { nasa_power: m("nasa_power"), open_meteo: m("open_meteo"), organizer: (C.organizer_reference?.monthly_climatology ?? []).map((r: any) => r[metric]) };
  }, [C, metric]);
  const climOpt = { grid: { left: 54, right: 16, top: 34, bottom: 30 }, legend: { top: 0 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: Array.from({ length: 12 }, (_, i) => monthName(i + 1, lang)), ...axisStyle }, yAxis: { type: "value", name: unit, ...axisStyle },
    series: (["nasa_power", "open_meteo", "organizer"] as const).filter((k) => (clim as any)[k]?.length).map((k) => ({ name: SRC_NAME[k], type: k === "organizer" ? "line" : "bar", data: (clim as any)[k], color: SRC_COLOR[k], barMaxWidth: 16, lineStyle: { type: "dashed", width: 2.5 }, symbol: "diamond", itemStyle: { borderRadius: [3, 3, 0, 0] } })) };
  const weekly = ok(cur) ? cur.weekly : [];
  const weeklyOpt = { grid: { left: 54, right: 16, top: 24, bottom: 56 }, tooltip: { trigger: "axis" }, dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }], legend: { top: 0 }, xAxis: { type: "category", data: weekly.map((w: any) => w.week), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, hideOverlap: true } },
    yAxis: [{ type: "value", name: "mm/week", ...axisStyle }, { type: "value", name: "°C / %", ...axisStyle, splitLine: { show: false } }],
    series: [{ name: "Rain (mm/week)", type: "bar", data: weekly.map((w: any) => w.rain_mm), itemStyle: { color: SRC_COLOR[prov] } }, { name: "Temp °C", type: "line", yAxisIndex: 1, data: weekly.map((w: any) => w.temp_c), symbol: "none", lineStyle: { color: "#d93a42", width: 1.6 } }, { name: "RH %", type: "line", yAxisIndex: 1, data: weekly.map((w: any) => w.rh_pct), symbol: "none", lineStyle: { color: "#7a5cc7", width: 1.4 } }] };
  const monthlyHeat = useMemo(() => {
    if (!ok(cur)) return {};
    const ys = Array.from(new Set(cur.monthly.map((r: any) => r.year))) as number[]; const d = cur.monthly.map((r: any) => [r.month - 1, ys.indexOf(r.year), r[metric === "rain_mm" ? "rain_mm" : metric]]);
    const vals = d.map((x: any) => x[2]);
    return { grid: { left: 54, right: 14, top: 8, bottom: 64 }, tooltip: { formatter: (p: any) => `${ys[p.value[1]]} ${monthName(p.value[0] + 1, lang)}: <b>${num(p.value[2], lang, 1)}</b> ${unit}` }, xAxis: { type: "category", data: Array.from({ length: 12 }, (_, i) => monthName(i + 1, lang)), splitArea: { show: true }, axisLabel: { fontSize: 10 } }, yAxis: { type: "category", data: ys.map(String), inverse: true, axisLabel: { fontSize: 10 } },
      visualMap: { min: Math.min(...vals), max: Math.max(...vals), orient: "horizontal", left: "center", bottom: 0, inRange: { color: metric === "rain_mm" ? ["#f7f9fb", "#9ecbea", "#1f5f99"] : ["#f7f9fb", "#f5b544", "#d93a42"] } }, series: [{ type: "heatmap", data: d }] };
  }, [cur, metric, lang, unit]);
  const annual = ok(cur) ? cur.annual_rain : [];

  return (<>
    <PageHeader eyebrow="Real-world climate · kept separate from the synthetic training data" title={t("nav.climate")} sub="NASA POWER and Open-Meteo observations at city-centre coordinates, compared with the synthetic organizer weather the model was trained on. None of these real observations is an input to any forecast." right={<ProvChip tone="info">Real observations ≠ model inputs</ProvChip>} />
    <div className="card mb-5 flex flex-wrap items-end gap-4 p-4">
      <Select label={t("ctl.city")} value={city} onChange={setCity} options={["Dhaka", "Chattogram", "Gazipur", "Narayanganj"].map((c) => ({ value: c, label: c }))} />
      <Select label="Period" value={range} onChange={setRange} options={[["2016-2024", "2016–2024 (model development years)"], ["2022-2024", "2022–2024"], ["2019-2021", "2019–2021"], ["2010-2015", "2010–2015 (before the dataset)"]].map(([v, l]) => ({ value: v, label: l }))} />
      <Segmented label="Detail source" value={prov} onChange={setProv} options={[{ value: "nasa_power", label: "NASA POWER" }, { value: "open_meteo", label: "Open-Meteo" }]} />
      <Segmented label="Metric" value={metric} onChange={setMetric} options={[{ value: "rain_mm", label: "Rain" }, { value: "temp_c", label: "Temp" }, { value: "rh_pct", label: "RH" }]} />
    </div>

    {(nasa.data?.status === "unavailable" || om.data?.status === "unavailable") && <div className="mb-4"><Notice tone="warn"><b>{t("state.degraded")}</b> {nasa.data?.status === "unavailable" && "NASA POWER is unreachable. "}{om.data?.status === "unavailable" && "Open-Meteo is unreachable. "}Cached copies are used when available; forecasts and every other page are unaffected.</Notice></div>}

    <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <Card><CardTitle title={`Now in ${city}`} sub="Open-Meteo current conditions and 7-day outlook (real; not used by the dengue model)" right={now.data?.status === "ok" && <ProvChip tone="ok">live</ProvChip>} />
        {!now.data ? <Skeleton h={190} /> : now.data.status !== "ok" ? <Notice tone="warn">{now.data.error ?? "Open-Meteo unavailable."}</Notice> : (<>
          <div className="mb-3 grid grid-cols-3 gap-2"><Kpi label="Temp °C" value={now.data.current.temperature_c} digits={1} /><Kpi label="Humidity %" value={now.data.current.relative_humidity_pct} /><Kpi label="Rain mm" value={now.data.current.precipitation_mm} digits={1} /></div>
          <Chart height={150} ariaLabel="7-day forecast rainfall and temperature" option={{ grid: { left: 40, right: 36, top: 22, bottom: 24 }, tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { fontSize: 10 } }, xAxis: { type: "category", data: now.data.forecast_7d.map((d: any) => d.date.slice(5)), ...axisStyle }, yAxis: [{ type: "value", ...axisStyle }, { type: "value", ...axisStyle, splitLine: { show: false } }], series: [{ name: "Rain mm", type: "bar", data: now.data.forecast_7d.map((d: any) => d.rain_mm), itemStyle: { color: "#e8782f" } }, { name: "Temp °C", type: "line", yAxisIndex: 1, data: now.data.forecast_7d.map((d: any) => d.temp_c), color: "#d93a42" }] }} />
          <p className="mt-1 text-[11px] text-ink-3">Observed at {now.data.current.observed_at} (local). Weather data by Open-Meteo.com · CC BY 4.0.</p></>)}</Card>
      <Card><CardTitle title={`${label}: seasonal comparison of three sources`} sub={`Monthly climatology, ${range}. Real sources disagree with each other and with the synthetic organizer weather.`} />
        {!C ? <Skeleton h={290} /> : <Chart option={climOpt} height={290} ariaLabel={`Monthly ${label} by source`} />}</Card>
    </div>

    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Max daily rain (mm)" value={ok(cur) ? cur.extremes.max_daily_rain_mm : undefined} digits={1} hint={ok(cur) ? cur.extremes.max_daily_rain_date : SRC_NAME[prov]} loading={!cur} />
      <Kpi label="Max 7-day rain (mm)" value={ok(cur) ? cur.extremes.max_7day_rain_mm : undefined} digits={0} hint={SRC_NAME[prov]} loading={!cur} />
      <Kpi label="Missing days" value={ok(cur) ? cur.extremes.missing_days : undefined} hint="fill values treated as missing" tone="ok" loading={!cur} />
      <Kpi label="Days analysed" value={ok(cur) ? cur.n_days : undefined} hint={ok(cur) ? `${cur.range.start} → ${cur.range.end}` : ""} loading={!cur} />
    </div>

    {!cur ? <Skeleton h={300} /> : !ok(cur) ? <ErrorState error={cur.error ?? "unavailable"} /> : (<div className="grid gap-5">
      <Card><CardTitle title={`Weekly weather, ${SRC_NAME[prov]}`} sub="Complete Monday–Sunday weeks (the organizer's weekly grid). Zoom with the slider." right={<ProvChip tone="info">{SRC_NAME[prov]}</ProvChip>} /><Chart option={weeklyOpt} height={320} ariaLabel="Weekly rainfall, temperature and humidity" /></Card>
      <div className="grid gap-5 lg:grid-cols-2"><Card><CardTitle title={`${label} by month and year`} sub={`${SRC_NAME[prov]} · ${unit}`} /><Chart option={monthlyHeat} height={340} ariaLabel="Month by year heatmap" /></Card>
        <Card><CardTitle title="Annual rainfall" sub={`${SRC_NAME[prov]} · mm`} /><Chart height={340} ariaLabel="Annual rainfall" option={{ grid: { left: 54, right: 16, top: 16, bottom: 30 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: annual.map((a: any) => a.year), ...axisStyle }, yAxis: { type: "value", name: "mm", ...axisStyle }, series: [{ type: "bar", data: annual.map((a: any) => a.rain_mm), itemStyle: { color: SRC_COLOR[prov], borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", fontSize: 10, formatter: (p: any) => Math.round(p.value) } }] }} /></Card></div>
      <Card><CardTitle title="Monthly rainfall analysis" sub={`Totals, wet days (≥ ${cur.extremes.wet_day_threshold_mm} mm/day) and heaviest day, long-term monthly mean`} /><DataTable dense maxH={320} rows={cur.monthly_climatology.map((m: any) => ({ ...m, month_name: monthName(m.month, lang) }))} cols={[{ key: "month_name", label: "Month" }, { key: "rain_mm", label: "Rain mm", align: "right" }, { key: "wet_days", label: "Wet days", align: "right" }, { key: "temp_c", label: "Temp °C", align: "right" }, { key: "rh_pct", label: "RH %", align: "right" }]} /></Card></div>)}

    {C && C.provider_disagreement && <Card className="mt-5"><CardTitle title="How much do NASA POWER and Open-Meteo disagree?" sub="Monthly mean rainfall difference (NASA − Open-Meteo, mm/month)" /><Chart height={240} ariaLabel="Provider rainfall disagreement" option={{ grid: { left: 54, right: 16, top: 12, bottom: 30 }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: C.provider_disagreement.map((r: any) => monthName(r.month, lang)), ...axisStyle }, yAxis: { type: "value", ...axisStyle }, series: [{ type: "bar", data: C.provider_disagreement.map((r: any) => r.rain_mm_nasa_minus_openmeteo), itemStyle: { color: (p: any) => (p.value >= 0 ? "#0b5cad" : "#e8782f") } }] }} /></Card>}

    <Card className="mt-5"><CardTitle title="Source attribution, resolution and caveats" />
      <div className="grid gap-4 lg:grid-cols-2">{(["nasa_power", "open_meteo"] as const).map((k) => { const pv = (D[k] && D[k].provenance) || C?.sources?.[k]?.provenance; return pv ? (<div key={k} className="rounded-xl border border-line p-4 text-[13px] text-ink-2"><h3 className="mb-1 font-semibold text-forest">{pv.name}</h3>
        <p><b>Variables:</b> {Object.entries(pv.variables).map(([a, b]) => `${a} = ${b}`).join("; ")}</p><p className="mt-1"><b>Resolution:</b> {pv.resolution}</p><p className="mt-1"><b>Nature:</b> {pv.nature}. <b>Time standard:</b> {pv.time_standard}.</p><p className="mt-1"><b>Attribution:</b> {pv.attribution}</p><p className="mt-1"><b>Terms:</b> {pv.license}</p></div>) : null; })}</div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-ink-2">{(C?.caveats ?? []).map((c: string) => <li key={c}>{c}</li>)}<li>The organizer's weather is synthetic. This page never substitutes real observations into the validated model; the model's 3–4 week forecasts use past-year climatology of the organizer data where future rainfall would be needed.</li></ul></Card>
  </>);
}
