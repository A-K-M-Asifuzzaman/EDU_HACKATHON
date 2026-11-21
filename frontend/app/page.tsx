"use client";
import Link from "next/link";
import { useMemo } from "react";
import { motion } from "motion/react";
import { api, qs, addWeeks, TIERS, type Forecast } from "@/lib/api";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, download, num, pct } from "@/lib/format";
import { buildBrief } from "@/lib/brief";
import ControlsBar from "@/components/controls";
import { Card, CardTitle, EmptyState, ErrorState, Kpi, Loading, Notice, ProvChip, RiskBadge, Skeleton, useAsync } from "@/components/ui";
import { DriverBars, FanChart, Gauge, TierBar } from "@/components/charts";
import { Chart, axisStyle } from "@/components/echart";
import HorizonCompare from "@/components/horizons";

export default function CommandCenter() {
  const { sel, set, ready, error, reload, meta } = useSel();
  const { t, lang } = useI18n();
  const src = srcParam(sel);
  const base = { origin: sel.origin, horizon: sel.horizon, source: src };
  const summary = useAsync((s) => api(`/api/reports/summary?${qs(base)}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const ranking = useAsync((s) => api(`/api/risk/wards?${qs({ ...base, limit: 10 })}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const fc = useAsync((s) => api(`/api/forecast?${qs({ ward_id: sel.ward, ...base })}`, { signal: s }), [sel.ward, sel.origin, sel.horizon, sel.source, ready]);
  const year = Number(sel.origin.slice(0, 4));
  const series = useAsync((s) => (year >= 2019 && year <= 2024 ? api(`/api/forecast/series?${qs({ ward_id: sel.ward, horizon: sel.horizon, year })}`, { signal: s }) : Promise.resolve(null)), [sel.ward, sel.horizon, year, ready]);
  const rain = useAsync((s) => api(`/api/weather/historical?${qs({ ward_id: sel.ward, start: addWeeks(sel.origin, -26), end: addWeeks(sel.origin, 0), metric: "rainfall_mm" })}`, { signal: s }), [sel.ward, sel.origin, ready]);
  const metrics = useAsync((s) => api("/api/model/metrics", { signal: s, ttl: 3_600_000 }), []);
  const calib = useAsync((s) => api("/api/model/calibration", { signal: s, ttl: 3_600_000 }), []);
  const cov = useMemo(() => {
    const ic = calib.data?.interval_coverage ?? []; const g = (lvl: number) => ic.find((r: any) => r.method === "nb_coverage" && r.level === lvl);
    return g(0.8) ? { c80: g(0.8).coverage, c90: g(0.9)?.coverage, h80: g(0.8).coverage_high } : null;
  }, [calib.data]);
  const f: Forecast | undefined = fc.data?.forecast;
  const S = summary.data;
  const tierCounts = S?.tier_counts ?? {};
  const rainOpt = useMemo(() => {
    const r = rain.data; if (!r) return {};
    const clim = r.climatology_by_iso_week;
    const wk = (d: string) => { const dt = new Date(d + "T00:00:00Z"); const t0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); return Math.min(52, Math.ceil(((+dt - +t0) / 86400000 + t0.getUTCDay() + 1) / 7)); };
    return { grid: { left: 44, right: 16, top: 24, bottom: 30 }, legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
      xAxis: { type: "category", data: r.rows.map((x: any) => x.date.slice(5)), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, hideOverlap: true } }, yAxis: { type: "value", name: "mm/week", ...axisStyle },
      series: [{ name: "Rainfall (organizer weather)", type: "bar", data: r.rows.map((x: any) => x.rainfall_mm), itemStyle: { color: "#3b82c4", borderRadius: [3, 3, 0, 0] } },
        { name: "Typical for the week (2016–2024)", type: "line", data: r.rows.map((x: any) => clim[String(wk(x.date))] ?? null), symbol: "none", lineStyle: { color: "#f5b544", width: 2, type: "dashed" } }] };
  }, [rain.data]);

  return (<>
    <section className="hero-surface relative mb-5 overflow-hidden rounded-[22px] p-6 shadow-[var(--shadow-pop)] sm:p-8" aria-labelledby="cc-title">
      <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse at 70% 30%, #000 0%, transparent 70%)" }} />
      <div className="relative grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mint/85"><span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">{t("mode.replay")}</span><span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">2025 holdout locked</span></div>
          <h1 id="cc-title" className="text-[30px] font-bold leading-tight tracking-[-0.025em] sm:text-[38px]">{t("nav.command")}</h1>
          <p className="mt-1 text-[19px] font-semibold leading-snug sm:text-[23px]"><span className="text-gradient">Forecast dengue 2–4 weeks ahead.</span> Route people to care.</p>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/75">{S ? <>For the week of <b className="text-white">{dateFmt(S.target_date, lang)}</b> (forecast made {dateFmt(S.origin, lang)}, {sel.horizon} weeks ahead), the model expects <b className="text-white">{num(S.median_cases_total, lang)}</b> cases across {S.wards} synthetic wards, with <b className="text-white">{S.alerts}</b> wards on outbreak alert. {S.source === "replay" ? "Validated out-of-time replay." : "Deployed model, recomputed on demand."}</> : t("mode.replay.desc")}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link href="/geography/" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-navy shadow-lg transition hover:-translate-y-0.5">Open map &amp; emergency routing →</Link>
            <Link href="/copilot/" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">Ask the Copilot</Link>
            <button disabled={!S} onClick={() => download(`dengueshield_brief_${sel.origin}_h${sel.horizon}.html`, buildBrief({ sel, S, f, top: ranking.data?.wards ?? [], metrics: metrics.data, coverage: cov, meta }), "text/html")} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15 disabled:opacity-50">Download intelligence brief</button>
          </div>
        </div>
        <div className="glass-dark rounded-2xl p-4 sm:p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mint/80">Validated performance · out-of-time 2022–2024</div>
          <div className="mt-3 grid grid-cols-3 gap-2">{[2, 3, 4].map((h) => { const m = metrics.data?.champion?.validation?.B?.[h]?.bench_2022_2024; return (<div key={h} className="rounded-xl bg-white/6 p-3 ring-1 ring-white/10"><div className="text-[11px] text-white/60">{h}-week MAE</div><div className="num mt-0.5 text-[24px] font-bold">{m ? m.mae.toFixed(2) : "…"}</div><div className="text-[10.5px] text-white/50">cases / week</div></div>); })}</div>
          <div className="mt-3 space-y-1.5 text-[12.5px] text-white/75">
            <div className="flex justify-between"><span>80% / 90% interval coverage</span><b className="num text-white">{cov ? `${cov.c80.toFixed(2)} / ${cov.c90?.toFixed(2)}` : "…"}</b></div>
            <div className="flex justify-between"><span>80% coverage at outbreak peaks</span><b className="num text-amber">{cov ? cov.h80.toFixed(2) : "…"}</b></div>
            <p className="pt-1 text-[11px] leading-snug text-white/55">Peaks are under-predicted by about 3 cases; intervals are honest on average and optimistic at peaks. Model: ridge Poisson GLM, 24 features.</p>
          </div>
        </div>
      </div>
    </section>
    {error && <div className="mb-4"><ErrorState error={error} onRetry={reload} /></div>}
    <ControlsBar />
    {S && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-3"><ProvChip tone={S.source === "replay" ? "ok" : "warn"}>{S.source === "replay" ? t("src.replay") : t("src.bundle")}</ProvChip>
      <span>{t("fc.origin")}: <b className="text-ink">{dateFmt(S.origin, lang)}</b> → {t("fc.target")}: <b className="text-ink">{dateFmt(S.target_date, lang)}</b></span>
      {S.source === "bundle" && Number(S.target_date.slice(0, 4)) <= 2024 && <ProvChip tone="warn">{t("fc.in_sample")}</ProvChip>}</div>}
    {summary.error && <div className="mb-4"><ErrorState error={summary.error} onRetry={summary.reload} /></div>}

    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Kpi label={t("kpi.expected")} value={S?.expected_cases_total} digits={0} hint={`${S?.wards ?? 60} ${t("kpi.wards")}`} loading={!S} />
      <Kpi label={t("kpi.median")} value={S?.median_cases_total} hint={t("fc.median")} loading={!S} />
      <Kpi label={t("kpi.alerts")} value={S?.alerts} tone={S && S.alerts > 15 ? "bad" : "warn"} hint={`/ ${S?.wards ?? 60} ${t("kpi.wards")}`} loading={!S} />
      <Kpi label={t("kpi.prob")} value={S ? S.mean_p_outbreak * 100 : undefined} digits={0} suffix="%" tone="warn" loading={!S} />
      <Kpi label={t("kpi.actual")} value={S?.actual_cases_total ?? undefined} tone="ok" hint={S?.actual_cases_total == null ? "—" : "replay only"} loading={!S} />
    </div>

    {f && <Card className="mb-5"><div className="grid items-center gap-4 sm:grid-cols-[auto_1fr_auto]">
      <div className="min-w-[150px]"><Gauge value={f.p_outbreak} tier={f.risk_tier} height={130} /></div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4"><div><div className="eyebrow">{t("fc.median")}</div><div className="num text-2xl font-bold text-forest">{f.median_cases}</div></div>
        <div><div className="eyebrow">{t("fc.mean")}</div><div className="num text-2xl font-bold text-forest">{num(f.expected_cases, lang, 1)}</div></div>
        <div><div className="eyebrow">{t("fc.interval80")} / 90%</div><div className="num text-base font-semibold">{f.lower_80}–{f.upper_80} / {f.lower_90}–{f.upper_90}</div></div>
        <div><div className="eyebrow">{t("fc.threshold")}</div><div className="num text-base font-semibold">≥ {f.outbreak_threshold} {t("fc.cases")}</div></div></div>
      <div className="flex flex-col items-start gap-2 sm:items-end"><RiskBadge tier={f.risk_tier} size="lg" pulse /><ProvChip tone={f.outbreak_alert ? "warn" : "ok"}>{f.outbreak_alert ? t("fc.yes") : t("fc.no")}</ProvChip>
        {f.actual_cases !== null && <span className="text-xs text-ink-3">{t("fc.actual")}: <b className="num text-coral-d">{f.actual_cases}</b></span>}</div></div></Card>}

    <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <Card>
        <CardTitle title={`${t("sec.fan")} — ${sel.ward}`} sub={`${sel.horizon} ${t("ctl.weeks")} · ${t("fresh.convention")}`} right={f && <RiskBadge tier={f.risk_tier} pulse />} />
        {series.data ? <FanChart series={series.data.series} markDate={f?.target_date} /> : series.loading ? <Skeleton h={320} /> : <EmptyState text="The validated replay covers origins 2019–2024. For later origins only the live forecast point is shown." />}
        {fc.data && <p className="mt-2 text-xs text-ink-3">{fc.data.forecast.source === "replay" ? t("src.replay.desc") : t("src.bundle.desc")}</p>}
      </Card>
      <Card>
        <CardTitle title={t("sec.compare")} sub={`${sel.ward} · ${dateFmt(sel.origin, lang)}`} />
        <HorizonCompare />
        <Link href="/lab/" className="mt-3 inline-block text-[13px] font-medium text-emerald-d underline underline-offset-4">{t("nav.lab")} →</Link>
      </Card>

      <Card className="xl:col-span-1">
        <CardTitle title={t("sec.ranking")} sub={t("risk.note")} right={<Link href="/wards/" className="text-[13px] font-medium text-emerald-d underline underline-offset-4">{t("nav.wards")} →</Link>} />
        <Loading q={ranking} h={380}>{(d: any) => (<ol className="space-y-1.5">{d.wards.map((w: Forecast, i: number) => (
          <motion.li key={w.ward_id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
            <button onClick={() => set({ ward: w.ward_id, city: "All" })} aria-pressed={w.ward_id === sel.ward} className={"grid w-full grid-cols-[22px_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:bg-mint-l/70 " + (w.ward_id === sel.ward ? "border-emerald bg-mint-l" : "border-line bg-white")}>
              <span className="num text-xs text-ink-3">{i + 1}</span>
              <span><span className="text-[13px] font-semibold text-ink">{w.ward_id}</span> <span className="text-xs text-ink-3">· {w.city}</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line"><motion.span className="block h-full rounded-full" style={{ background: "linear-gradient(90deg,#9fe7c2,#d93a42)" }} initial={{ width: 0 }} animate={{ width: `${w.p_outbreak * 100}%` }} /></span></span>
              <span className="text-right"><span className="num block text-sm font-bold">{pct(w.p_outbreak, lang)}</span><span className="num block text-[11px] text-ink-3">{w.median_cases} [{w.lower_90}–{w.upper_90}]</span></span></button></motion.li>))}</ol>)}</Loading>
      </Card>

      <div className="grid gap-5">
        <Card><CardTitle title={t("sec.distribution")} sub={`${S?.wards ?? 60} ${t("kpi.wards")} · ${t("risk.note")}`} />
          {S ? <TierBar counts={tierCounts} /> : <Skeleton h={200} />}
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-ink-3">{TIERS.map((x) => <span key={x}><b style={{ color: "#44566a" }}>{t(`risk.${x.toLowerCase()}`)}</b>: {t(`risk.${x.toLowerCase()}.desc`)}</span>)}</div></Card>
        <Card><CardTitle title={t("sec.drivers")} sub={t("drv.note")} />
          <Loading q={fc} h={150}>{(d: any) => d.drivers?.log_rate_contributions ? <DriverBars contrib={d.drivers.log_rate_contributions} /> : <EmptyState text="Drivers unavailable for this selection." />}</Loading></Card>
      </div>

      <Card><CardTitle title={t("sec.weather")} sub={`${sel.ward} · 26 weeks before the origin · organizer (synthetic) weather`} />
        <Loading q={rain} h={230}>{() => <Chart option={rainOpt} height={230} ariaLabel="Weekly rainfall before the forecast origin" />}</Loading></Card>
      <Card><CardTitle title={t("avail.title")} sub={t("avail.key")} />
        <Loading q={fc} h={180}>{(d: any) => (<ul className="space-y-2">{d.availability.map((a: any) => (<li key={a.horizon} className={"flex items-start gap-3 rounded-xl border p-3 text-[13px] " + (a.horizon === sel.horizon ? "border-emerald bg-mint-l" : "border-line")}>
          <span className="num mt-0.5 rounded-lg bg-forest px-2 py-0.5 text-xs font-bold text-white">{a.horizon}w</span>
          <span><b>{dateFmt(a.key_rain_week, lang)}</b> — {a.observed_at_origin ? <span className="text-emerald-d">{t("avail.observed")}</span> : <span className="text-amber-d">{t("avail.projected")}</span>}</span></li>))}</ul>)}</Loading></Card>
    </div>

    <Card className="mt-5"><CardTitle title={t("sec.limits")} />
      <ul className="grid gap-2 text-[13px] text-ink-2 md:grid-cols-2"><li className="flex gap-2"><span className="text-coral">●</span>{t("lim.peaks")}</li><li className="flex gap-2"><span className="text-coral">●</span>{t("lim.cover")}</li>
        <li className="flex gap-2"><span className="text-amber">●</span>{t("lim.noweather")}</li><li className="flex gap-2"><span className="text-amber">●</span>{t("lim.synthetic")}</li></ul>
      <p className="mt-3 text-xs text-ink-3">{t("disc.official")} · {meta?.model?.name} · bundle {meta?.model?.bundle_sha256?.slice(0, 10)} · data SHA-256 {meta?.data?.dataset_sha256?.slice(0, 10)}</p></Card>
  </>);
}
