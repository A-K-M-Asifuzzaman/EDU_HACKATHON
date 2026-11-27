"use client";
// Landing page, night edition: "Monsoon Intelligence" (DESIGN.md). Every visual is real output or real data:
//   hero        rain atmosphere scaled to the observed rainfall of the selected ward and week; the rain → risk instrument
//               (/api/weather/historical, /api/forecast/series, /api/forecast/compare) inside the live readout (/api/forecast)
//   the wire    all 60 synthetic wards for the week (/api/risk/wards)
//   01 rain     which rain weeks the model reads, per horizon
//   02 window   the whole season of out-of-time forecasts with the issue line
//   03 evidence the honest weakness in one number, the reliability table and every model configuration compared
//   04 response the 60 wards as an abstract risk field
//   05 navigation every hospital and clinic routed to (/api/facilities)
//   06 trust    limits, sealed test year, reproducibility; then the tools index
import Link from "next/link";
import dynamic from "next/dynamic";
import { api, qs, seasonUrl, addWeeks, type Forecast } from "@/lib/api";
import { selQuery, srcParam, useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, num } from "@/lib/format";
import { RequestStatus, useAsync } from "@/components/ui";
import { ForecastPreview } from "@/components/forecast-preview";
import { SeasonFigure } from "@/components/season-figure";
import { RainRisk } from "@/components/rain-risk";
import Reveal from "@/components/reveal";
import WardWire from "@/components/ward-wire";
import RiskField from "@/components/risk-field";
import { Cloud, Folder, Houses, Magnifier, MapPin, ShieldChart, Skyline } from "@/components/illustrations";

const FacilityMap = dynamic(() => import("@/components/facility-map"), { ssr: false, loading: () => <div className="skeleton h-[320px]" /> });
const ModelStrip = dynamic(() => import("@/components/model-strip"), { ssr: false, loading: () => <div className="skeleton h-[240px]" /> });
const RainField = dynamic(() => import("@/components/rain-field"), { ssr: false });
const H = [2, 3, 4] as const;

function Chapter({ n, id, title, children, className = "", art }: { n: string; id: string; title: string; children?: React.ReactNode; className?: string; art?: React.ReactNode }) {
  return (<div className={className}>
    <div className="flex items-center gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-[2.5px] border-[#1a1438] bg-[#ffc23d] font-display text-[16px] font-extrabold text-[#1a1438] shadow-[3px_3px_0_#1a1438]">{n}</span><span className="h-[2.5px] flex-1 rounded bg-ink/15" aria-hidden /></div>
    <div className="mt-5 flex items-end justify-between gap-4"><h2 id={id} className="font-display text-[36px] font-extrabold leading-[0.98] tracking-[-0.025em] text-ink sm:text-[52px]">{title}</h2>{art && <div className="hidden w-[104px] shrink-0 sm:block">{art}</div>}</div>
    {children}</div>);
}

/** Which rain weeks the model reads for a given horizon: weeks 2, 3 and 4 before the target; weeks not yet fallen use typical rain. */
function LagDiagram({ h }: { h: number }) {
  const weeks = [-6, -5, -4, -3, -2, -1, 0], W = 560, cw = W / weeks.length, latest = -h - 1, issue = weeks.indexOf(-h);
  return (<svg viewBox={`0 0 ${W} 132`} className="w-full" role="img" aria-label={`At ${h} weeks ahead, rain ${[2, 3, 4].filter((l) => -l <= latest).map((l) => `${l} weeks`).join(" and ") || "no week"} before the target is observed when the forecast is issued; ${[2, 3, 4].filter((l) => -l > latest).map((l) => `${l} weeks`).join(" and ") || "none"} use typical rain for that week.`}>
    {weeks.map((w, i) => { const lag = -w, inWin = lag >= 2 && lag <= 4, obs = w <= latest, x = i * cw + 4; return (<g key={w}>
      <rect x={x} y={40} width={cw - 8} height={48} rx="3" fill={inWin ? (obs ? "var(--color-sky)" : "transparent") : "var(--color-paper-3)"} stroke={inWin ? "var(--color-sky)" : "none"} strokeWidth="1.5" strokeDasharray={inWin && !obs ? "5 3" : undefined} style={{ transition: "fill .35s" }} />
      <text x={x + (cw - 8) / 2} y={69} fontSize="13" textAnchor="middle" fontWeight="600" fill={inWin && obs ? "#0b0e15" : "var(--color-ink-2)"}>{w === 0 ? "target" : `${lag} wk`}</text></g>); })}
    {issue >= 0 && <g style={{ transform: `translateX(${issue * cw}px)`, transition: "transform .45s cubic-bezier(.2,.7,.2,1)" }}><line x1={0} x2={0} y1={26} y2={100} stroke="var(--color-ink)" /><text x={-6} y={22} fontSize="12.5" textAnchor="end" fill="var(--color-ink)" fontWeight="600">issued</text></g>}
    <text x="4" y="120" fontSize="12.5" fill="var(--color-ink-3)">Solid: rain already observed. Dashed: typical rain for that week. Grey: not read.</text>
  </svg>);
}

/** 80% coverage on a 0-100% strip: all weeks and outbreak peaks against the 80% target tick. No filled track. */
function CoverageStrip({ all, peaks }: { all: number; peaks: number }) {
  const x = (v: number) => 6 + v * 148;
  return (<svg viewBox="0 0 160 26" className="h-[26px] w-[160px]" aria-hidden>
    <line x1={6} x2={154} y1={13} y2={13} stroke="var(--color-line)" /><line x1={x(0.8)} x2={x(0.8)} y1={4} y2={22} stroke="var(--color-ink-3)" strokeDasharray="2 2" />
    <circle cx={x(peaks)} cy={13} r="5" fill="var(--color-coral)" /><circle cx={x(all)} cy={13} r="5" fill="var(--color-ink)" />
  </svg>);
}

export default function Landing() {
  const { sel, set, meta, ready } = useSel();
  const { t, lang } = useI18n();
  const q = selQuery(sel);
  const base = { origin: sel.origin, horizon: sel.horizon, source: srcParam(sel) };
  const fc = useAsync((s) => api(`/api/forecast?${qs({ ward_id: sel.ward, ...base })}`, { signal: s }), [sel.ward, sel.origin, sel.horizon, sel.source, ready]);
  const f: Forecast | undefined = fc.data?.forecast;
  const year = Number((f?.target_date ?? sel.origin).slice(0, 4));
  const sUrl = seasonUrl(sel.ward, sel.horizon, sel.origin);
  const series = useAsync((s) => api(sUrl, { signal: s }), [sUrl, ready]);
  const season: number = series.data?.season ?? year;                    // a forward origin shows the last replay season, then its own forecast
  const rain = useAsync((s) => (season >= 2019 ? api(`/api/weather/historical?${qs({ ward_id: sel.ward, start: `${season}-01-01`, end: `${season}-12-31`, metric: "rainfall_mm" })}`, { signal: s, ttl: 600_000 }) : Promise.resolve(null)), [sel.ward, season, ready]);
  const near = useAsync((s) => api(`/api/weather/historical?${qs({ ward_id: sel.ward, start: addWeeks(sel.origin, -10), end: sel.origin, metric: "rainfall_mm" })}`, { signal: s, ttl: 600_000 }), [sel.ward, sel.origin, ready]);
  const cmp = useAsync((s) => api(`/api/forecast/compare?${qs({ ward_id: sel.ward, origin: sel.origin, source: srcParam(sel) })}`, { signal: s }), [sel.ward, sel.origin, sel.source, ready]);
  const wards = useAsync((s) => api(`/api/risk/wards?${qs(base)}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const canon = useAsync((s) => api("/api/model/canonical-metrics", { signal: s, ttl: 3_600_000 }), []);
  const routing = useAsync((s) => api("/api/routing/status", { signal: s, ttl: 3_600_000 }), []);
  const C = canon.data?.regimes;
  const hz = C?.out_of_time_2019_2024?.by_horizon?.[String(sel.horizon)];
  const R = routing.data, fac = R?.manifest?.facilities, bench = R?.benchmark;
  const roadKm = R ? Object.values(R.manifest?.areas ?? {}).reduce((a: number, x: any) => a + (x.total_road_km ?? 0), 0) : null;
  const target = f?.target_date;
  const nearRows: any[] = near.data?.rows ?? [];
  const issueRain = nearRows.length ? nearRows[nearRows.length - 1] : null;
  const W60: Forecast[] = wards.data?.wards ?? [];
  const alerts = W60.filter((w) => w.outbreak_alert).length;

  const instrument = cmp.data?.forecasts && near.data ? (
    <RainRisk origin={sel.origin} horizon={sel.horizon} fcs={cmp.data.forecasts.filter((x: any) => !x.error)} rain={nearRows} clim={near.data.climatology_by_iso_week}
      cases={series.data?.series ?? []} onHorizon={(h) => set({ horizon: h })} />)
    : cmp.status === "failed" ? null : <div className="skeleton h-[250px] sm:h-[290px]" aria-hidden />;

  return (<div>
    {/* ================================================================== hero */}
    <section aria-labelledby="land-title" className="night relative overflow-hidden">
      <div className="absolute inset-0 [mask-image:linear-gradient(180deg,#000_55%,transparent)]"><RainField mm={issueRain?.rainfall_mm ?? null} /></div>
      <Skyline className="pointer-events-none absolute inset-x-0 bottom-0 h-[90px] w-full sm:h-[140px]" />
      <div className="relative mx-auto max-w-[1320px] px-4 pb-28 sm:px-8 sm:pb-40">
        <p className="border-b border-line py-4 text-[12.5px] text-ink-3">{t("land.eyebrow")}</p>
        <div className="grid gap-x-12 gap-y-7 pt-7 sm:pt-12 lg:grid-cols-12">
          <h1 id="land-title" className="sf-fade text-[38px] leading-[0.94] tracking-[-0.03em] text-ink sm:text-[68px] lg:col-span-12 xl:text-[92px]">{t("land.h1a")} <em className="block not-italic text-[#ffd36e]">{t("land.h1b")}</em></h1>
          <div className="sf-fade [animation-delay:.15s] lg:col-span-8 lg:col-start-5 lg:row-start-2"><ForecastPreview fc={fc} canon={canon.data} visual={instrument} /></div>
          <div className="flex flex-col lg:col-span-4 lg:row-start-2">
            <p className="max-w-[38ch] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">{t("land.lead")}</p>
            <div className="mt-6 hidden flex-wrap items-center gap-x-5 gap-y-3 sm:flex">
              <Link href={`/command/${q}`} className="inline-flex min-h-12 items-center bg-ink px-6 text-[15.5px] text-canvas">{t("land.cta.command")}</Link>
              <Link href="/evidence/" className="btn-ghost inline-flex min-h-12 items-center px-5 text-[15px]">{t("land.cta.evidence")}</Link>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-line pt-5 lg:mt-12 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-line lg:border-t lg:pt-0">
              {[["60", "synthetic wards forecast every week"], [hz ? hz.mae.toFixed(2) : "…", `cases typical error at ${sel.horizon} weeks, out-of-time`], [bench ? `${bench.equal_costs}/${bench.pairs}` : "…", "test routes where A* matched Dijkstra"]].map(([v, l]) => (
                <div key={l} className="flex flex-col-reverse lg:flex-row-reverse lg:items-baseline lg:justify-end lg:gap-4 lg:py-3.5"><dt className="mt-1 text-[12.5px] leading-snug text-ink-3 lg:mt-0">{l}</dt><dd className="num font-display text-[30px] leading-none text-ink lg:w-[150px] lg:shrink-0 lg:text-[34px]">{v}</dd></div>))}
            </dl>
            {issueRain && <p className="mt-6 text-[12px] leading-relaxed text-ink-3 lg:mt-auto lg:pt-6">The rain behind this page is drawn from data: its density follows the {Math.round(issueRain.rainfall_mm)} mm observed in {sel.ward} in the week of {dateFmt(issueRain.date, lang)}.</p>}
          </div>
        </div>
      </div>
    </section>

    {/* ================================================================== the wire */}
    <WardWire wards={W60} q={q} />

    <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
      {/* ---------------------------------------------------------------- 01 the rain signal */}
      <Reveal as="section" aria-labelledby="ch-rain" className="mt-20 grid gap-10 sm:mt-28 lg:grid-cols-12 lg:gap-12">
        <Chapter n="01" id="ch-rain" title="The rain signal" className="lg:col-span-5" art={<Cloud className="w-full" />}>
          <div className="mt-5 max-w-[50ch] space-y-3 text-[15.5px] leading-relaxed text-ink-2">
            <p>Mosquitoes need standing water and a few weeks to breed, so rain shows up in case counts later. The model reads rainfall two, three and four weeks before the target week, and the third week counts most.</p>
            <p>When a forecast is issued, some of those weeks have not happened yet. For them it uses the typical rainfall for that time of year, never the rain that actually fell.</p>
            <p>It also uses the season and each ward's vulnerability (drainage, density, sanitation). It does not use recent case counts.</p>
          </div>
        </Chapter>
        <figure className="card m-0 p-5 sm:p-6 lg:col-span-7 lg:mt-16">
          <LagDiagram h={sel.horizon} />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">Forecast horizon
            {H.map((h) => <button key={h} onClick={() => set({ horizon: h })} aria-pressed={sel.horizon === h} className={"min-h-11 rounded-full border-2 px-4 text-[13.5px] font-bold transition-colors sm:min-h-9 " + (sel.horizon === h ? "border-[#1a1438] bg-[#4a2bd0] text-white" : "border-[#1a1438] bg-ivory text-ink-2 hover:bg-mint-l")}>{h} weeks</button>)}</div>
        </figure>
      </Reveal>

      {/* ---------------------------------------------------------------- 02 the forecast window */}
      <Reveal as="section" aria-labelledby="ch-window" className="mt-24 sm:mt-32">
        <Chapter n="02" id="ch-window" title="The forecast window" art={<ShieldChart className="w-full" />}>
          <p className="mt-4 max-w-[64ch] text-[15.5px] leading-relaxed text-ink-2">A whole season for one ward, each week forecast {sel.horizon} weeks before it happened by a model that had never seen that season. Move along it to read any week; select one to make it the forecast above.</p>
        </Chapter>
        <div className="card mt-8 p-4 sm:p-6">
          {series.data && !series.data.series?.length ? <p className="max-w-[68ch] text-[13.5px] text-ink-2">Replayed forecasts start with 2019 origins. For earlier weeks only the forecast above is shown.</p>
            : series.data?.series && target ? (<SeasonFigure rows={series.data.series} rain={rain.data?.rows} origin={f!.origin_date} target={target} horizon={sel.horizon}
              threshold={f?.outbreak_threshold} onPick={(o) => set({ origin: o })}
              caption={<><b className="font-semibold text-ink-2">Fig. 1.</b> {sel.ward}, {season} season, every forecast made {sel.horizon} weeks ahead by a model trained only on earlier seasons. Shaded: the 80% and 90% ranges; line: the median; dots: reported cases, hollow once they fall after the issue date. Rain after the issue date had not fallen when the forecast was made and was never used.</>} />)
            : series.status === "failed" ? <p className="text-[13.5px] text-ink-2" role="alert">The season figure is unavailable right now. The forecast above is unaffected.</p>
            : <div aria-busy="true"><div className="skeleton h-[380px]" /><RequestStatus q={series} label="Season figure" /></div>}
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- 03 the model's evidence */}
      <Reveal as="section" aria-labelledby="ch-evidence" className="night mx-[calc(50%-50vw)] mt-24 px-[calc(50vw-50%)] py-16 sm:mt-32 sm:py-24">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12">
          <Chapter n="03" id="ch-evidence" title="The model's evidence" className="lg:col-span-5" art={<Magnifier className="w-full" />}>
            <div className="mt-7">
              <div className="num font-display text-[120px] leading-[0.82] tracking-[-0.035em] text-[#ffa3a8] sm:text-[168px]">{hz ? Math.round(hz.coverage.peaks["80"] * 100) : "…"}<span className="text-[0.42em] tracking-normal">%</span></div>
              <p className="mt-5 max-w-[36ch] text-[16px] leading-relaxed text-ink-2">of outbreak-peak weeks fell inside the 80% range at {sel.horizon} weeks ahead, against {hz ? Math.round(hz.coverage.all["80"] * 100) : "…"}% of all weeks. Peaks are where the model is weakest, and every forecast page says so.</p>
            </div>
          </Chapter>
          <div className="lg:col-span-7 lg:pt-16">
            <p className="max-w-[62ch] text-[15.5px] leading-relaxed text-ink-2">Every forecast from 2019 to 2024 was made by a model trained only on earlier seasons, then compared with what happened.</p>
            <div className="card scroll-thin mt-6 overflow-x-auto p-4 sm:p-5" tabIndex={0} aria-label="Reliability by horizon, scrollable">
              <table className="num w-full min-w-[600px] text-left text-[14px]">
                <thead><tr className="border-b border-ink text-[12px] text-ink-3"><th className="py-2 pr-4 font-semibold">Horizon</th><th className="py-2 pr-4 text-right font-semibold">Typical error</th><th className="py-2 pr-4 text-right font-semibold">80% range held</th><th className="py-2 pr-4 text-right font-semibold">at outbreak peaks</th><th className="py-2 pr-4 font-semibold">Against the 80% target</th><th className="py-2 text-right font-semibold">Peaks under-predicted</th></tr></thead>
                <tbody>{C ? H.map((h) => { const r = C.out_of_time_2019_2024.by_horizon[String(h)]; return (
                  <tr key={h} onClick={() => set({ horizon: h })} className={"cursor-pointer border-b border-line transition-colors hover:bg-mint-l " + (sel.horizon === h ? "bg-paper-3" : "")}><td className="whitespace-nowrap py-3.5 pr-4 font-medium text-ink">{h} weeks</td><td className="pr-4 text-right">{r.mae.toFixed(2)} cases</td>
                    <td className="pr-4 text-right">{Math.round(r.coverage.all["80"] * 100)}%</td><td className="pr-4 text-right text-coral-d">{Math.round(r.coverage.peaks["80"] * 100)}%</td>
                    <td className="pr-4"><CoverageStrip all={r.coverage.all["80"]} peaks={r.coverage.peaks["80"]} /></td><td className="text-right">{Math.round(r.peaks.under_share * 100)}%</td></tr>); })
                  : H.map((h) => <tr key={h} className="border-b border-line"><td colSpan={6} className="py-3.5"><div className="skeleton h-4" /></td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">Pooled over all ward-weeks. Light dot: all weeks; red dot: outbreak-peak weeks; dashed tick: the 80% target. Seasons 2022 to 2024 also guided the choice of model, so these are validation figures, not a blind test.</p>
            {canon.status === "failed" && <p role="alert" className="mt-2 text-[13px] text-coral-d">Reliability figures are unavailable right now. <Link href="/evidence/" className="underline">Model Evidence</Link> has the saved results.</p>}
          </div>
        </div>
        <div className="card mt-14 p-5 sm:p-7">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3"><h3 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-ink sm:text-[32px]">Every model we tried</h3>
            <Link href="/evidence/" className="btn-ghost inline-flex min-h-11 items-center px-5 text-[14px]">Open the Model Comparison Explorer</Link></div>
          <ModelStrip />
        </div>
      </Reveal>

      {/* ---------------------------------------------------------------- 04 from risk to response */}
      <Reveal as="section" aria-labelledby="ch-response" className="mt-24 grid gap-x-12 gap-y-8 sm:mt-32 lg:grid-cols-12">
        <Chapter n="04" id="ch-response" title="From risk to response" className="lg:col-span-4" art={<Houses className="w-full" />}>
          <p className="mt-5 max-w-[40ch] text-[15.5px] leading-relaxed text-ink-2">The same forecast for every synthetic ward, ranked, so a health office can see where to look first. Response planning stays generic: options and a review queue, never quantities or orders.</p>
          <div className="mt-7 flex items-baseline gap-4"><span className="num font-display text-[64px] leading-none text-ink">{W60.length ? alerts : "…"}</span><span className="text-[14px] leading-snug text-ink-3">of {W60.length || 60} wards on outbreak alert for the week of {target ? dateFmt(target, lang) : "…"}</span></div>
          <Link href={`/response/${q}`} className="btn-ghost mt-6 inline-flex min-h-11 items-center px-5 text-[14px]">Open Response Intelligence</Link>
        </Chapter>
        <div className="card p-5 sm:p-6 lg:col-span-8 lg:mt-16">{W60.length ? <RiskField wards={W60} selected={sel.ward} onPick={(w) => set({ ward: w, city: "All" })} />
          : wards.status === "failed" ? <p role="alert" className="text-[13.5px] text-ink-2">The ward ranking is unavailable right now.</p> : <div aria-busy="true"><div className="skeleton h-[260px]" /><RequestStatus q={wards} label="Ward ranking" /></div>}</div>
      </Reveal>

      {/* ---------------------------------------------------------------- 05 geospatial navigation */}
      <Reveal as="section" aria-labelledby="ch-geo" className="mt-24 grid gap-x-12 gap-y-8 sm:mt-32 lg:grid-cols-12">
        <div className="card p-5 sm:p-6 lg:order-2 lg:col-span-7"><FacilityMap /></div>
        <Chapter n="05" id="ch-geo" title="Geospatial navigation" className="lg:order-1 lg:col-span-5" art={<MapPin className="w-full" />}>
          <dl className="mt-7 grid grid-cols-3 gap-4 border-y border-line py-4">
            <div className="flex flex-col-reverse justify-end"><dt className="mt-1 text-[12px] text-ink-3">facilities mapped</dt><dd className="num font-display text-[32px] leading-none text-ink">{fac ? num(fac.count, lang) : "…"}</dd></div>
            <div className="flex flex-col-reverse justify-end"><dt className="mt-1 text-[12px] text-ink-3">km of road, one-way rules kept</dt><dd className="num font-display text-[32px] leading-none text-ink">{roadKm ? num(Math.round(roadKm), lang) : "…"}</dd></div>
            <div className="flex flex-col-reverse justify-end"><dt className="mt-1 text-[12px] text-ink-3">routes where A* matched Dijkstra</dt><dd className="num font-display text-[32px] leading-none text-ink">{bench ? `${bench.equal_costs}/${bench.pairs}` : "…"}</dd></div>
          </dl>
          <p className="mt-5 text-[15.5px] leading-relaxed text-ink-2">Hospitals, clinics and roads come from OpenStreetMap; routes run on the directed road network. Emergency search lists general hospitals only and marks an emergency tag as unverified. There is no live traffic, bed or doctor data, so call before travelling.</p>
          <Link href="/geography/" className="btn-ghost mt-5 inline-flex min-h-11 items-center px-5 text-[14px]">Open the map and routing</Link>
        </Chapter>
      </Reveal>

      {/* ---------------------------------------------------------------- 06 scientific trust */}
      <Reveal as="section" aria-labelledby="ch-trust" className="night mx-[calc(50%-50vw)] mt-24 px-[calc(50vw-50%)] py-16 sm:mt-32 sm:py-24">
        <Chapter n="06" id="ch-trust" title="Scientific trust" art={<Folder className="w-full" />} />
        <dl className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[["Not live surveillance", "Every number replays the organizers' synthetic data for 2019 to 2024. The 60 wards are synthetic and cannot be placed on real ward boundaries, so maps stay at city level."],
            ["Not medical advice", "Nothing here is advice for a patient. In an emergency call 999 or open Emergency help at the top of every page."],
            ["Outbreak peaks", "Peaks are usually under-predicted and the 80% range is too narrow there. A peak-aware interval method (E1) is a research candidate and is not deployed."],
            ["The 2025 test year", "Sealed. It has never been read, trained on or shown."],
            ["Reproducibility", `Dataset SHA-256 ${meta?.data?.dataset_sha256?.slice(0, 12) ?? "…"}, model bundle ${meta?.model?.bundle_sha256?.slice(0, 12) ?? "…"}. One command rebuilds and serves everything, and automated tests check the reported numbers.`],
            ["Your data", "No accounts and no tracking cookies. A location you share is used only to compute routes."]].map(([k, v]) => (
            <div key={k} className="card p-5"><dt className="font-display text-[21px] font-extrabold tracking-[-0.01em] text-ink">{k}</dt><dd className="mt-1.5 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">{v}</dd></div>))}
        </dl>
      </Reveal>

      {/* ---------------------------------------------------------------- tools */}
      <Reveal as="section" aria-labelledby="land-tools" className="mb-24 mt-24 sm:mb-32 sm:mt-32">
        <h2 id="land-tools" className="font-display text-[34px] font-extrabold tracking-[-0.025em] text-ink sm:text-[46px]">Tools</h2>
        <ul className="mt-6 grid gap-x-12 md:grid-cols-2">
          {[[t("nav.command"), "One ward's forecast, how reliable it is and the next step.", `/command/${q}`], [t("nav.lab"), "Horizons, rainfall lags, drivers, the rainfall what-if and Climate Futures.", `/lab/${q}`],
            [t("nav.wards"), "All 60 synthetic wards ranked by outbreak probability.", `/wards/${q}`], [t("nav.response"), "Alerts to review and the Operations engine: allocate stock, route bed overflow, test crews, write the brief.", `/response/${q}#engine`],
            [t("nav.geography"), "General hospitals by road from a real location.", "/geography/"], [t("nav.evidence"), "Validation, model comparison, calibration and provenance.", "/evidence/"]].map(([name, d, href]) => (
            <li key={href} className="border-t border-line"><Link href={href} className="group flex min-h-11 items-baseline justify-between gap-4 py-5">
              <span><span className="block font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink transition-colors group-hover:text-emerald-d">{name}</span><span className="mt-1 block text-[14px] text-ink-3">{d}</span></span>
              <span aria-hidden className="text-[20px] text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-emerald-d">→</span></Link></li>))}
        </ul>
      </Reveal>
    </div>
  </div>);
}
