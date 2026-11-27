"use client";
// Command Center forecast instrument (night edition): the one dominant element of the cockpit. Left: what is predicted and how far to
// trust it. Right: the rain → risk instrument (observed rain, the weeks the model reads, the 2/3/4-week forecasts) and, for replayed
// weeks, the time-machine verdict against what actually happened. Every number comes from /api/forecast, /api/forecast/compare,
// /api/weather/historical, /api/forecast/series or /api/model/canonical-metrics.
import Link from "next/link";
import type { Forecast } from "@/lib/api";
import { selQuery, type Selection } from "@/lib/ctx";
import { dateFmt, num, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ProvChip, RiskBadge } from "./ui";
import { RainRisk } from "./rain-risk";

/** Uncertainty ruler (kept for other pages): 90% and 80% intervals, median, threshold and (replay only) the actual count. */
export function UncertaintyRuler({ f, dark = false }: { f: Forecast; dark?: boolean }) {
  const top = Math.max(f.upper_90, f.actual_cases ?? 0, f.outbreak_threshold ?? 0) * 1.12 + 1;
  const x = (v: number) => `${(Math.max(0, v) / top) * 100}%`;
  return (<figure className="mt-4" aria-label={`80% interval ${f.lower_80} to ${f.upper_80} cases, 90% interval ${f.lower_90} to ${f.upper_90}, median ${f.median_cases}${f.outbreak_threshold != null ? `, outbreak threshold ${f.outbreak_threshold}` : ""}${f.actual_cases != null ? `, actual ${f.actual_cases}` : ""}`}>
    <div className="relative h-9" aria-hidden>
      <div className="absolute inset-x-0 top-4 h-px bg-line" />
      <div className="absolute top-2.5 h-4 rounded-sm bg-emerald/25" style={{ left: x(f.lower_90), width: `calc(${x(f.upper_90)} - ${x(f.lower_90)})` }} />
      <div className="absolute top-2.5 h-4 rounded-sm bg-emerald/70" style={{ left: x(f.lower_80), width: `calc(${x(f.upper_80)} - ${x(f.lower_80)})` }} />
      <div className="absolute top-1 h-7 w-[3px] -translate-x-1/2 rounded bg-ink" style={{ left: x(f.median_cases) }} />
      {f.outbreak_threshold != null && <div className="absolute top-0 h-9 w-0 -translate-x-1/2 border-l-2 border-dashed border-coral" style={{ left: x(f.outbreak_threshold) }} />}
      {f.actual_cases != null && <div className="absolute top-[11px] h-3 w-3 -translate-x-1/2 rotate-45 border-2 border-canvas bg-amber" style={{ left: x(f.actual_cases) }} />}
    </div>
    <figcaption className={"mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] " + (dark ? "text-ink-2" : "text-ink-2")}>
      <span>80% {f.lower_80}-{f.upper_80}</span><span>90% {f.lower_90}-{f.upper_90}</span>
      {f.outbreak_threshold != null && <span>outbreak at {f.outbreak_threshold}</span>}{f.actual_cases != null && <span>actual {f.actual_cases}</span>}
    </figcaption>
  </figure>);
}

export function ForecastInstrument({ f, sel, canon, sourceLabel, stale, fcs, rain, clim, cases, onHorizon, replay }: {
  f: Forecast; sel: Selection; canon?: any; sourceLabel: string; stale?: boolean; fcs?: any[]; rain?: any[]; clim?: Record<string, number>; cases?: any[]; onHorizon: (h: number) => void; replay: boolean }) {
  const { lang } = useI18n();
  const q = selQuery(sel);
  const h = canon?.regimes?.out_of_time_2019_2024?.by_horizon?.[String(sel.horizon)];
  const y = f.actual_cases;
  const verdict = y == null ? null : (() => {
    const err = y - f.median_cases, in80 = y >= f.lower_80 && y <= f.upper_80, in90 = y >= f.lower_90 && y <= f.upper_90, out = f.outbreak_threshold != null && y >= f.outbreak_threshold;
    const call = f.outbreak_alert ? (out ? ["Correct alert", "text-emerald-d"] : ["False alert", "text-amber-d"]) : out ? ["Missed outbreak", "text-coral-d"] : ["Correctly quiet", "text-emerald-d"];
    return { err, in80, in90, call };
  })();
  return (<section className="card relative overflow-hidden p-0" aria-labelledby="answer-title" data-testid="answer-card" aria-busy={stale || undefined}>
    {stale && <span role="status" className="absolute right-3 top-3 z-10 rounded-[3px] bg-ink px-2.5 py-1 text-[11.5px] text-canvas">Updating for the new selection…</span>}
    <div className={"grid transition-opacity lg:grid-cols-[minmax(320px,400px)_1fr] " + (stale ? "opacity-45" : "")}>
      {/* the answer */}
      <div className="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
        <div className="text-[12.5px] font-medium text-ink-3">Forecast · {sel.horizon} weeks ahead</div>
        <h2 id="answer-title" className="mt-1 font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{sel.ward} <span className="block font-sans text-[13px] font-normal tracking-normal text-ink-3">synthetic ward, {f.city}</span></h2>
        <p className="mt-1 text-[13px] text-ink-2">Week of <b className="font-semibold text-ink">{dateFmt(f.target_date, lang)}</b>, issued <b className="font-semibold text-ink">{dateFmt(f.origin_date, lang)}</b></p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5"><RiskBadge tier={f.risk_tier} size="md" /><ProvChip tone={f.outbreak_alert ? "warn" : "ok"}>{f.outbreak_alert ? "Outbreak alert" : "No alert"}</ProvChip><ProvChip tone="neutral">{sourceLabel}</ProvChip></div>
        <div className="mt-5 grid grid-cols-[auto_1fr] items-end gap-x-7">
          <dl className="flex flex-col-reverse"><dt className="mt-1.5 text-[12px] text-ink-3">Median forecast, cases</dt><dd className="num font-display text-[80px] leading-[0.84] text-ink sm:text-[96px]">{f.median_cases}</dd></dl>
          <dl className="space-y-4 pb-1">
            <div className="flex flex-col-reverse"><dt className="mt-1 text-[12px] text-ink-3">80% range; 90%: {f.lower_90}-{f.upper_90}</dt><dd className="num font-display text-[30px] leading-none text-ink">{f.lower_80}-{f.upper_80}</dd></div>
            <div className="flex flex-col-reverse"><dt className="mt-1 text-[12px] leading-snug text-ink-3">chance of reaching {f.outbreak_threshold ?? "the threshold"} cases</dt><dd className={"num font-display text-[30px] leading-none " + (f.outbreak_alert ? "text-coral-d" : "text-ink")}>{pct(f.p_outbreak, lang)}</dd></div>
          </dl>
        </div>
        <div className="mt-6 border-t border-line pt-4 text-[13px] text-ink-2">
          <div className="font-semibold text-ink">How reliable at {sel.horizon} weeks</div>
          {h ? (<ul className="mt-1.5 space-y-1"><li>Typical error <b className="num text-ink">{num(h.mae, lang, 2)}</b> cases</li>
            <li>80% range held in <b className="num text-ink">{Math.round(h.coverage.all["80"] * 100)}%</b> of weeks, <b className="num text-coral-d">{Math.round(h.coverage.peaks["80"] * 100)}%</b> at outbreak peaks</li>
            <li>Peaks under-predicted <b className="num text-coral-d">{Math.round(h.peaks.under_share * 100)}%</b> of the time</li></ul>) : <div className="skeleton mt-2 h-14" />}
          <p className="mt-2 text-[11.5px] text-ink-3">Out-of-time replay 2019 to 2024, pooled.</p>
        </div>
      </div>
      {/* the instrument and the verdict */}
      <div className="min-w-0 p-5 sm:p-6">
        {fcs && rain ? <RainRisk origin={sel.origin} horizon={sel.horizon} fcs={fcs} rain={rain} clim={clim} cases={cases ?? []} onHorizon={onHorizon} /> : <div className="skeleton h-[290px]" aria-hidden />}
        <p className="mt-2 text-[12px] leading-relaxed text-ink-3">Rain observed before the issue date, the weeks the model reads, and the forecasts for 2, 3 and 4 weeks ahead with their 80% and 90% ranges. Select a forecast to change the horizon.</p>
        {verdict && (<div className="mt-5 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px] sm:grid-cols-[auto_1fr]">
          <div className="font-semibold text-ink">Time-machine verdict</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-2">
            <span>Actual <b className="num text-ink">{y}</b> cases, error <b className={"num " + (Math.abs(verdict.err) <= 2 ? "text-emerald-d" : "text-coral-d")}>{verdict.err > 0 ? "+" : ""}{verdict.err}</b></span>
            <span>80% range <b className={verdict.in80 ? "text-emerald-d" : "text-coral-d"}>{verdict.in80 ? "held" : "missed"}</b></span>
            <span>90% range <b className={verdict.in90 ? "text-emerald-d" : "text-coral-d"}>{verdict.in90 ? "held" : "missed"}</b></span>
            <span>Alert: <b className={verdict.call[1]}>{verdict.call[0]}</b></span></div>
          <p className="text-[11.5px] text-ink-3 sm:col-span-2">{replay ? `Out-of-time: forecast by a model trained only on seasons before ${f.target_date.slice(0, 4)}.` : "In-sample: the deployed model saw this period in training."}</p>
        </div>)}
      </div>
    </div>
    <nav aria-label="Next steps" className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-[13.5px] sm:px-6">
      {[["Explain the forecast", "/lab/"], ["Check reliability", "/evidence/"], ["Plan a response", "/response/"], ["Find hospitals from a real location", "/geography/"]].map(([label, href]) => (
        <Link key={href} href={href + q} className="group inline-flex min-h-11 items-center gap-1.5 font-medium text-ink transition-colors hover:text-emerald-d sm:min-h-9">{label}<span aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-d">→</span></Link>))}
    </nav>
  </section>);
}
