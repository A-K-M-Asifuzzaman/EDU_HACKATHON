"use client";
// The wire: every synthetic ward's real forecast for the selected week, as a slow moving strip under the hero. Pauses on hover and
// keyboard focus; under prefers-reduced-motion it is a still, horizontally scrollable list. Data: /api/risk/wards.
import Link from "next/link";
import { TIER_COLOR, type Forecast } from "@/lib/api";
import { pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function WardWire({ wards, q }: { wards: Forecast[]; q: string }) {
  const { t, lang } = useI18n();
  if (!wards.length) return <div className="h-[52px] border-y border-line" aria-hidden />;
  const item = (w: Forecast, k: string, dup = false) => (<li key={k} aria-hidden={dup || undefined} className="flex shrink-0 items-baseline gap-2.5 px-5 py-3.5 text-[13px]">
    <span className="h-2 w-2 translate-y-[-1px] self-center rounded-[2px]" style={{ background: TIER_COLOR[w.risk_tier] }} aria-hidden />
    <b className="font-semibold text-ink">{w.ward_id}</b><span className="text-ink-3">{w.city}</span>
    <span className="num font-display text-[17px] text-ink">{w.median_cases}</span><span className="text-ink-3">cases</span>
    <span className={"num " + (w.outbreak_alert ? "text-coral-d" : "text-ink-2")}>{pct(w.p_outbreak, lang)}</span>
    <span className="text-[11.5px] text-ink-3">{t(`risk.${w.risk_tier.toLowerCase()}`)}</span></li>);
  return (<section aria-label="All 60 synthetic wards this week" className="wire relative border-y border-line">
    <div className="scroll-thin overflow-x-auto motion-safe:overflow-hidden" tabIndex={0} aria-label="Ward forecasts, scrollable">
      <ul className="wire-track flex w-max">{wards.map((w) => item(w, w.ward_id))}{wards.map((w) => item(w, "b" + w.ward_id, true))}</ul>
    </div>
    <Link href={`/wards/${q}`} className="absolute inset-y-0 right-0 hidden items-center bg-gradient-to-l from-canvas from-55% to-transparent pl-28 pr-5 text-[13px] font-medium text-emerald-d hover:underline sm:flex">All wards</Link>
  </section>);
}
