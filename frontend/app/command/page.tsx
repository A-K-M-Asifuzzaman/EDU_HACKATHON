"use client";
// Command Center, the cockpit (night edition, DESIGN.md). One dominant instrument in the night band: the forecast for the selected ward
// with its uncertainty, the rain → risk instrument and the time-machine verdict. Then, on porcelain: the season, all 60 wards, what
// drives the forecast, the known limitations and one recommended next step. Every number comes from the API.
import Link from "next/link";
import { useMemo } from "react";
import { api, qs, addWeeks, TIERS, type Forecast } from "@/lib/api";
import { useSel, srcParam, selQuery } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, download, num, pct } from "@/lib/format";
import { buildBrief } from "@/lib/brief";
import ControlsBar from "@/components/controls";
import { Btn, EmptyState, ErrorState, ForecastSkeleton, Kpi, Loading, ProvChip, RequestStatus, RiskBadge, ServiceUnavailable, useAsync } from "@/components/ui";
import { DriverBars } from "@/components/charts";
import { ForecastInstrument } from "@/components/forecast-instrument";
import { SeasonFigure } from "@/components/season-figure";
import RiskField from "@/components/risk-field";
import Reveal from "@/components/reveal";
import { Icon } from "@/components/icons";

function Section({ id, title, sub, right, children }: { id: string; title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (<Reveal as="section" aria-labelledby={id} className="mt-14 sm:mt-20">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
      <div><h2 id={id} className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[36px]">{title}</h2>{sub && <p className="mt-1 max-w-[70ch] text-[13.5px] text-ink-3">{sub}</p>}</div>{right}</div>
    {children}</Reveal>);
}

export default function CommandCenter() {
  const { sel, set, error, reload, meta, ready } = useSel();
  const { t, lang } = useI18n();
  const src = srcParam(sel);
  const base = { origin: sel.origin, horizon: sel.horizon, source: src };
  const summary = useAsync((s) => api(`/api/reports/summary?${qs(base)}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const ranking = useAsync((s) => api(`/api/risk/wards?${qs(base)}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const fc = useAsync((s) => api(`/api/forecast?${qs({ ward_id: sel.ward, ...base })}`, { signal: s }), [sel.ward, sel.origin, sel.horizon, sel.source, ready]);
  const cmp = useAsync((s) => api(`/api/forecast/compare?${qs({ ward_id: sel.ward, origin: sel.origin, source: src })}`, { signal: s }), [sel.ward, sel.origin, sel.source, ready]);
  const year = Number(sel.origin.slice(0, 4));
  const series = useAsync((s) => (year >= 2019 && year <= 2024 ? api(`/api/forecast/series?${qs({ ward_id: sel.ward, horizon: sel.horizon, year })}`, { signal: s }) : Promise.resolve(null)), [sel.ward, sel.horizon, year, ready]);
  const rain = useAsync((s) => api(`/api/weather/historical?${qs({ ward_id: sel.ward, start: addWeeks(sel.origin, -26), end: addWeeks(sel.origin, 0), metric: "rainfall_mm" })}`, { signal: s }), [sel.ward, sel.origin, ready]);
  const metrics = useAsync((s) => api("/api/model/metrics", { signal: s, ttl: 3_600_000 }), []);
  const calib = useAsync((s) => api("/api/model/calibration", { signal: s, ttl: 3_600_000 }), []);
  const canon = useAsync((s) => api("/api/model/canonical-metrics", { signal: s, ttl: 3_600_000 }), []);
  const cov = useMemo(() => {
    const ic = calib.data?.interval_coverage ?? []; const g = (lvl: number) => ic.find((r: any) => r.method === "nb_coverage" && r.level === lvl);
    return g(0.8) ? { c80: g(0.8).coverage, c90: g(0.9)?.coverage, h80: g(0.8).coverage_high } : null;
  }, [calib.data]);
  const f: Forecast | undefined = fc.data?.forecast;
  const S = summary.data;
  const all: Forecast[] = ranking.data?.wards ?? [];
  const top = all.slice(0, 10);
  const q = selQuery(sel);
  const sitrep = () => {
    const html = buildBrief({ sel, S, f, top, metrics: metrics.data, coverage: cov, meta });
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else { download(`dengueshield_sitrep_${sel.origin}_h${sel.horizon}.html`, html, "text/html"); }
  };
  // one recommended next step, chosen from the forecast itself (alert → plan a response; otherwise → look at the wards at risk)
  const next = f ? (f.outbreak_alert
    ? { title: `Plan a response for ${sel.ward}`, why: `On outbreak alert: ${pct(f.p_outbreak, lang)} chance of reaching ${f.outbreak_threshold} cases or more in the week of ${dateFmt(f.target_date, lang)}.`, href: "/response/" }
    : { title: "See which wards are at risk this week", why: `${sel.ward} is not on alert (${pct(f.p_outbreak, lang)}). ${S ? `${S.alerts} of ${S.wards} synthetic wards are.` : ""}`, href: "/wards/" }) : null;
  const replay = (fc.data?.forecast.source ?? S?.source) === "replay";

  return (<>
    {/* ================================================================ the night band: the cockpit's one instrument */}
    <header className="night relative -mt-6 mx-[calc(50%-50vw)] overflow-hidden px-[calc(50vw-50%)] pb-10 pt-6 sm:pb-14 sm:pt-10">
      <div className="relative">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-ink-3">{t("mode.replay")}, 2025 test year sealed</div>
            <h1 className="sf-fade mt-1 text-[40px] leading-[0.96] text-ink sm:text-[60px]">{t("nav.command")}</h1>
            <p className="mt-2 hidden max-w-[70ch] text-[14.5px] leading-relaxed text-ink-2 sm:block">{S ? <>Week of <b className="font-semibold text-ink">{dateFmt(S.target_date, lang)}</b>, forecast made {dateFmt(S.origin, lang)}, {sel.horizon} weeks ahead: <b className="num font-semibold text-ink">{num(S.median_cases_total, lang)}</b> cases expected across {S.wards} synthetic wards, <b className="num font-semibold text-coral-d">{S.alerts}</b> on outbreak alert. {S.source === "replay" ? "Validated out-of-time replay." : ""}</> : <span className="skeleton inline-block h-4 w-96 align-middle" />}</p>
          </div>
          <div className="hidden flex-wrap gap-2 sm:flex">{/* phones: these follow the instrument, so the forecast stays in the first screen */}
            <Btn variant="ghost" disabled={!S || !f} title={!S || !f ? "Available once the forecast and ward ranking have loaded" : undefined} onClick={sitrep}><Icon name="download" size={16} />Weekly situation report</Btn>
            <Link href={`/lab/${q}`} className="inline-flex min-h-11 items-center gap-1.5 bg-ink px-4 py-2 text-[13.5px] text-canvas sm:min-h-9">Explain this forecast</Link>
          </div>
        </div>
        {error && <div className="mt-4"><ErrorState error={error} onRetry={reload} /></div>}
        <div className="mt-6 flex flex-col">
          <ControlsBar />
          <div className="order-first mb-5 lg:order-none lg:mb-0">
            {f ? <ForecastInstrument f={f} sel={sel} canon={canon.data} sourceLabel={f.source === "replay" ? t("src.replay") : t("src.bundle")} stale={fc.stale}
                fcs={cmp.data?.forecasts?.filter((x: any) => !x.error)} rain={rain.data?.rows?.slice(-10)} clim={rain.data?.climatology_by_iso_week} cases={series.data?.series} onHorizon={(h) => set({ horizon: h })} replay={replay} />
              : fc.status === "failed" && fc.error ? <ServiceUnavailable error={fc.error} onRetry={fc.reload} label="The forecast" />
              : <div className="card p-5" aria-busy="true"><ForecastSkeleton h={420} /><RequestStatus q={fc} label="Forecast" /></div>}
            <div className="mt-5 flex flex-wrap gap-2 sm:hidden">
            <Btn variant="ghost" disabled={!S || !f} title={!S || !f ? "Available once the forecast and ward ranking have loaded" : undefined} onClick={sitrep}><Icon name="download" size={16} />Weekly situation report</Btn>
            <Link href={`/lab/${q}`} className="inline-flex min-h-11 items-center gap-1.5 bg-ink px-4 py-2 text-[13.5px] text-canvas sm:min-h-9">Explain this forecast</Link>
            </div>
          </div>
          {S && <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3"><ProvChip tone={S.source === "replay" ? "ok" : "warn"}>{S.source === "replay" ? t("src.replay") : t("src.bundle")}</ProvChip>
            <span>{t("fc.origin")}: <b className="text-ink">{dateFmt(S.origin, lang)}</b>, {t("fc.target")}: <b className="text-ink">{dateFmt(S.target_date, lang)}</b></span>
            {S.source === "bundle" && Number(S.target_date.slice(0, 4)) <= 2024 && <ProvChip tone="warn">{t("fc.in_sample")}</ProvChip>}</div>}
        </div>
      </div>
    </header>
    {summary.error && <div className="mt-6"><ErrorState error={summary.error} onRetry={summary.reload} /></div>}

    {/* ================================================================ the season */}
    <Section id="cc-season" title="The season so far" sub={`${sel.ward}, every week of ${year} forecast ${sel.horizon} weeks ahead by a model trained only on earlier seasons. Select a week to make it the forecast above.`}>
      {year >= 2019 && year <= 2024 ? (series.data?.series && f ? <SeasonFigure rows={series.data.series} rain={rain.data?.rows} origin={f.origin_date} target={f.target_date} horizon={sel.horizon} threshold={f.outbreak_threshold} onPick={(o) => set({ origin: o })} />
        : series.status === "failed" && series.error ? <ServiceUnavailable error={series.error} onRetry={series.reload} label="The season timeline" />
        : <div aria-busy="true"><div className="skeleton h-[380px]" /><RequestStatus q={series} label="Season timeline" /></div>)
        : <EmptyState text="The validated replay covers origins 2019 to 2024. For later origins only the forecast above is shown." />}
    </Section>

    {/* ================================================================ all wards */}
    <Section id="cc-wards" title="All 60 synthetic wards this week" sub={t("risk.note")} right={<Link href={`/wards/${q}`} className="text-[13.5px] font-medium text-emerald-d underline decoration-1 underline-offset-[5px]">{t("nav.wards")}</Link>}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5" aria-busy={!S || undefined}>
        <Kpi label={t("kpi.expected")} value={S ? Math.round(S.expected_cases_total) : undefined} hint={`${S?.wards ?? 60} ${t("kpi.wards")}`} />
        <Kpi label={t("kpi.median")} value={S?.median_cases_total} hint={t("fc.median")} />
        <Kpi label={t("kpi.alerts")} value={S?.alerts} hint={`of ${S?.wards ?? 60} ${t("kpi.wards")}`} tone="bad" />
        <Kpi label={t("kpi.prob")} value={S ? Math.round(S.mean_p_outbreak * 100) : undefined} suffix="%" hint="mean across wards" tone="warn" />
        <Kpi label={t("kpi.actual")} value={S ? S.actual_cases_total ?? null : undefined} hint={S?.actual_cases_total == null ? "not available" : "replay only"} />
      </div>
      <div className="mt-10 grid gap-10 xl:grid-cols-[1.15fr_1fr]">
        <div>
          <h3 className="mb-3 text-[15px] font-semibold text-ink">{t("sec.ranking")}</h3>
          <Loading q={ranking} h={380} kind="table" label="Ward ranking">{() => (<table className="num w-full text-left text-[13.5px]">
            <thead><tr className="border-b border-ink text-[12px] text-ink-3"><th className="w-8 py-2 font-semibold">#</th><th className="py-2 font-semibold">Ward</th><th className="hidden py-2 font-semibold sm:table-cell">City</th><th className="py-2 font-semibold">Tier</th><th className="py-2 text-right font-semibold">Chance</th><th className="py-2 text-right font-semibold">Median [90%]</th></tr></thead>
            <tbody>{top.map((w, i) => (<tr key={w.ward_id} className={"border-b border-line transition-colors hover:bg-mint-l " + (w.ward_id === sel.ward ? "bg-paper-3" : "")}>
              <td className="py-2.5 text-ink-3">{i + 1}</td>
              <td><button onClick={() => set({ ward: w.ward_id, city: "All" })} aria-pressed={w.ward_id === sel.ward} className="min-h-9 text-left font-semibold text-ink hover:text-emerald-d hover:underline">{w.ward_id}</button></td>
              <td className="hidden text-ink-2 sm:table-cell">{w.city}</td><td><RiskBadge tier={w.risk_tier} size="sm" /></td>
              <td className={"text-right font-semibold " + (w.outbreak_alert ? "text-coral-d" : "text-ink")}>{pct(w.p_outbreak, lang)}</td><td className="text-right text-ink-2">{w.median_cases} [{w.lower_90}-{w.upper_90}]</td></tr>))}</tbody></table>)}</Loading>
          <p className="mt-2 text-[12px] text-ink-3">Top 10 by outbreak probability. Select a ward to forecast it above.</p>
        </div>
        <div><h3 className="mb-3 text-[15px] font-semibold text-ink">{t("sec.distribution")}</h3>
          {all.length ? <RiskField wards={all} selected={sel.ward} onPick={(w) => set({ ward: w, city: "All" })} /> : <div className="skeleton h-[220px]" />}
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-ink-3">{TIERS.map((x) => <span key={x}><b className="text-ink-2">{t(`risk.${x.toLowerCase()}`)}</b>: {t(`risk.${x.toLowerCase()}.desc`)}</span>)}</div></div>
      </div>
    </Section>

    {/* ================================================================ drivers */}
    <Section id="cc-drivers" title="What drives this forecast" sub={t("drv.note")}>
      <div className="grid gap-10 xl:grid-cols-2">
        <div><h3 className="mb-3 text-[15px] font-semibold text-ink">{t("sec.drivers")}</h3>
          <Loading q={fc} h={170} kind="chart" label="Drivers">{(d: any) => d.drivers?.log_rate_contributions ? <DriverBars contrib={d.drivers.log_rate_contributions} /> : <EmptyState text="Drivers unavailable for this selection." />}</Loading></div>
        <div><h3 className="mb-3 text-[15px] font-semibold text-ink">{t("avail.title")}</h3><p className="-mt-2 mb-3 text-[12.5px] text-ink-3">{t("avail.key")}</p>
          <Loading q={fc} h={150} kind="table" label="Data availability">{(d: any) => (<table className="w-full text-left text-[13.5px]"><tbody>{d.availability.map((a: any) => (
            <tr key={a.horizon} className={"border-b border-line " + (a.horizon === sel.horizon ? "bg-paper-3" : "")}><td className="num w-24 py-2.5 font-semibold text-ink">{a.horizon} weeks</td><td className="text-ink">{dateFmt(a.key_rain_week, lang)}</td>
              <td className={"text-right " + (a.observed_at_origin ? "text-emerald-d" : "text-amber-d")}>{a.observed_at_origin ? t("avail.observed") : t("avail.projected")}</td></tr>))}</tbody></table>)}</Loading></div>
      </div>
    </Section>

    {/* ================================================================ limits and next step */}
    <Section id="cc-limits" title="Known limitations">
      <ul className="grid gap-x-10 gap-y-3 text-[14px] leading-relaxed text-ink-2 md:grid-cols-2">
        {[t("lim.peaks"), t("lim.cover"), t("lim.noweather"), t("lim.synthetic")].map((x) => <li key={x} className="border-t border-line pt-3">{x}</li>)}</ul>
      <p className="mt-4 text-[12px] text-ink-3">{t("disc.official")}. {meta?.model?.name}, bundle {meta?.model?.bundle_sha256?.slice(0, 10)}, data SHA-256 {meta?.data?.dataset_sha256?.slice(0, 10)}. <Link className="underline" href="/evidence/">Full evidence</Link></p>
    </Section>

    <Section id="cc-next" title="Recommended next step">
      {next ? (<div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div><div className="text-[12.5px] font-medium text-ink-3">Suggested from this forecast</div>
          <Link href={next.href + q} className="mt-1 inline-block font-display text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink underline decoration-2 underline-offset-[6px] hover:text-emerald-d sm:text-[36px]">{next.title}</Link>
          <p className="mt-2 max-w-[60ch] text-[14px] text-ink-2">{next.why}</p><p className="mt-2 text-[12px] text-ink-3">A planning aid on synthetic data, not an instruction; nothing is sent to field teams.</p></div>
        <ul className="divide-y divide-line border-y border-line text-[14px]">
          {[["Response Intelligence", "Ranked alerts, review queue, resource sandbox", `/response/${q}`], ["Map and emergency routing", "General hospitals by road from a real location", "/geography/"]].map(([a, b, h]) => (
            <li key={h}><Link href={h} className="group flex items-baseline justify-between gap-3 py-3.5"><span><b className="block font-semibold text-ink group-hover:text-emerald-d">{a}</b><span className="text-[13px] text-ink-3">{b}</span></span><span aria-hidden className="text-ink-3 group-hover:text-emerald-d">→</span></Link></li>))}</ul>
      </div>) : <div className="skeleton h-24" />}
    </Section>
  </>);
}
