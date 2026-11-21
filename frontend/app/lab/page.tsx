"use client";
import { useMemo } from "react";
import { api, qs, addWeeks } from "@/lib/api";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import ControlsBar from "@/components/controls";
import HorizonCompare from "@/components/horizons";
import RainTimeline from "@/components/rainline";
import { Card, CardTitle, EmptyState, Loading, Notice, PageHeader, ProvChip, RiskBadge, useAsync } from "@/components/ui";
import { DriverBars, FanChart } from "@/components/charts";
import { Chart, axisStyle } from "@/components/echart";

export default function Lab() {
  const { sel, ready } = useSel();
  const { t, lang } = useI18n();
  const src = srcParam(sel);
  const cmp = useAsync((s) => api(`/api/forecast/compare?${qs({ ward_id: sel.ward, origin: sel.origin, source: src })}`, { signal: s }), [sel.ward, sel.origin, sel.source, ready]);
  const fc = useAsync((s) => api(`/api/forecast?${qs({ ward_id: sel.ward, origin: sel.origin, horizon: sel.horizon, source: src })}`, { signal: s }), [sel.ward, sel.origin, sel.horizon, sel.source, ready]);
  const rain = useAsync((s) => api(`/api/weather/historical?${qs({ ward_id: sel.ward, start: addWeeks(sel.origin, -10), end: addWeeks(sel.origin, 0), metric: "rainfall_mm" })}`, { signal: s }), [sel.ward, sel.origin, ready]);
  const year = Number(sel.origin.slice(0, 4));
  const series = useAsync((s) => (year >= 2019 && year <= 2024 ? api(`/api/forecast/series?${qs({ ward_id: sel.ward, horizon: sel.horizon, year })}`, { signal: s }) : Promise.resolve(null)), [sel.ward, sel.horizon, year, ready]);
  const cal = useAsync((s) => api("/api/model/calibration", { ttl: 300_000, signal: s }), [ready]);
  const rainMap = useMemo(() => Object.fromEntries((rain.data?.rows ?? []).map((r: any) => [r.date, r.rainfall_mm])), [rain.data]);
  const widths = useMemo(() => {
    const rows = (cal.data?.interval_coverage_detail ?? []).filter((r: any) => r.method === "nb_coverage" && r.level === 0.8);
    return [2, 3, 4].map((h) => { const r = rows.filter((x: any) => x.horizon === h); return r.length ? r.reduce((a: number, b: any) => a + b.width, 0) / r.length : null; });
  }, [cal.data]);

  const rangeOpt = useMemo(() => {
    const f = (cmp.data?.forecasts ?? []).filter((x: any) => !x.error);
    return { grid: { left: 50, right: 20, top: 30, bottom: 40 }, tooltip: { trigger: "item", formatter: (p: any) => { const x = f[p.dataIndex]; return x ? `<b>${x.horizon} ${t("ctl.weeks")}</b> → ${x.target_date}<br/>${t("fc.median")} ${x.median_cases} · ${t("fc.mean")} ${x.expected_cases.toFixed(1)}<br/>80%: ${x.lower_80}–${x.upper_80} · 90%: ${x.lower_90}–${x.upper_90}${x.actual_cases !== null ? `<br/>${t("fc.actual")}: ${x.actual_cases}` : ""}` : ""; } },
      xAxis: { type: "category", data: f.map((x: any) => `${x.horizon}w\n${x.target_date.slice(5)}`), ...axisStyle }, yAxis: { type: "value", name: t("fc.cases"), min: 0, max: Math.ceil(Math.max(5, ...f.map((x: any) => Math.max(x.upper_90, x.actual_cases ?? 0))) * 1.12), ...axisStyle },
      series: [{ type: "custom", renderItem: (_: any, api: any) => { const i = api.value(0); const c = api.coord([i, 0]); const yy = (v: number) => api.coord([i, v])[1]; const x = c[0]; const w = api.size([1, 0])[0] * 0.18;
        return { type: "group", children: [{ type: "line", shape: { x1: x, y1: yy(api.value(1)), x2: x, y2: yy(api.value(4)) }, style: { stroke: "#9fe7c2", lineWidth: 10, lineCap: "round" } },
          { type: "line", shape: { x1: x, y1: yy(api.value(2)), x2: x, y2: yy(api.value(3)) }, style: { stroke: "#0e8f66", lineWidth: 10, lineCap: "round" } },
          { type: "circle", shape: { cx: x, cy: yy(api.value(5)), r: 7 }, style: { fill: "#073b2b", stroke: "#fff", lineWidth: 2 } },
          { type: "path", shape: { pathData: "M0 -7 L7 0 L0 7 L-7 0 Z", x: x + w, y: yy(api.value(6)) }, style: { fill: "#3b82c4", stroke: "#fff", lineWidth: 1.5 } },
          ...(api.value(7) >= 0 ? [{ type: "circle", shape: { cx: x - w, cy: yy(api.value(7)), r: 5 }, style: { fill: "#ea575b", stroke: "#fff", lineWidth: 2 } }] : [])] }; },
        data: f.map((x: any, i: number) => [i, x.lower_90, x.lower_80, x.upper_80, x.upper_90, x.median_cases, x.expected_cases, x.actual_cases ?? -1]), z: 5 }] };
  }, [cmp.data, t]);

  return (<>
    <PageHeader eyebrow={t("mode.replay")} title={t("nav.lab")} sub="Pick a ward and a forecast origin, compare the 2-, 3- and 4-week forecasts, see exactly which rainfall each one relies on, and where the uncertainty comes from." />
    <ControlsBar show={["city", "ward", "origin", "horizon", "source"]} />
    <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
      <Card><CardTitle title={`${t("sec.compare")}`} sub={`${sel.ward} · ${t("fc.origin")} ${dateFmt(sel.origin, lang)}`} />
        <HorizonCompare />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-ink-3"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-forest" />{t("fc.median")}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rotate-45 bg-sky" />{t("fc.mean")}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-coral" />{t("fc.actual")}</span></div></Card>
      <Card><CardTitle title="Forecast ranges by horizon" sub="Wider bars = more uncertainty (dark = 80% interval, light = 90%)" />
        <Loading q={cmp} h={300}>{() => <Chart option={rangeOpt} height={300} ariaLabel="Median, mean and prediction intervals for horizons 2, 3 and 4 weeks" />}</Loading></Card>
    </div>

    <Card className="mt-5"><CardTitle title={t("avail.title")} sub={`${t("avail.key")} ${lang === "bn" ? "" : "Rainfall after the origin is never used."}`} right={<ProvChip tone="info">{sel.horizon} {t("ctl.weeks")}</ProvChip>} />
      <Loading q={rain} h={250}>{(r: any) => <RainTimeline origin={sel.origin} horizon={sel.horizon} rain={rainMap} clim={r.climatology_by_iso_week} />}</Loading>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">{(cmp.data?.availability ?? []).map((a: any) => (<div key={a.horizon} className={"rounded-xl border p-3 text-[12.5px] " + (a.horizon === sel.horizon ? "border-emerald bg-mint-l" : "border-line")}><b>{a.horizon}w</b>: {dateFmt(a.key_rain_week, lang)} — {a.observed_at_origin ? <span className="text-emerald-d">{t("avail.observed")}</span> : <span className="text-amber-d">{t("avail.projected")}</span>}</div>))}</div>
      <p className="mt-3 text-xs text-ink-3">Under convention B the forecast is issued on the Monday labelling week t, so week t is not yet observed. Hatched weeks are shown as past-year climatology; the model uses a projection of the same kind there. Real future rainfall would only be a what-if input, and none is used here.</p></Card>

    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card><CardTitle title={t("sec.fan")} sub={`${sel.horizon} ${t("ctl.weeks")} · ${year}`} />
        {series.data ? <FanChart series={series.data.series} markDate={fc.data?.forecast.target_date} height={300} /> : <EmptyState text="Validated replay covers 2019–2024 origins." />}</Card>
      <Card><CardTitle title={t("sec.drivers")} sub={t("drv.note")} />
        <Loading q={fc} h={190}>{(d: any) => d.drivers?.log_rate_contributions ? <DriverBars contrib={d.drivers.log_rate_contributions} height={190} /> : <EmptyState />}</Loading>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">{fc.data && <><RiskBadge tier={fc.data.forecast.risk_tier} size="sm" /><span>{fc.data.forecast.source === "replay" ? t("fc.out_of_sample") : fc.data.forecast.in_sample ? t("fc.in_sample") : "forward forecast"}</span></>}</div></Card>
    </div>

    <Card className="mt-5"><CardTitle title="Why the 4-week forecast is more uncertain" sub="Calibrated 80% interval width (cases), averaged over validation seasons 2019–2024" />
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_2fr]"><div className="space-y-2">{[2, 3, 4].map((h, i) => (<div key={h} className="flex items-center gap-3"><span className="num w-8 text-sm font-bold">{h}w</span><div className="h-3 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-gradient-to-r from-mint to-emerald" style={{ width: `${((widths[i] ?? 0) / 3.5) * 100}%`, transition: "width .6s" }} /></div><span className="num w-10 text-right text-sm">{widths[i]?.toFixed(1) ?? "—"}</span></div>))}</div>
        <Notice tone="warn">{t("lim.noweather")} {t("lim.peaks")} {t("lim.cover")}</Notice></div></Card>
  </>);
}
