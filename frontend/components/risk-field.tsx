"use client";
// Risk skyline: the 60 synthetic wards as an abstract field (they cannot be placed on real boundaries), one bar per ward grouped by city,
// height proportional to the chance of an outbreak week, coloured by risk tier; alerts carry a coral cap. Hover or focus reads a ward;
// Enter or a click makes it the selected ward everywhere.
import { useState } from "react";
import { TIER_COLOR, TIERS, type Forecast } from "@/lib/api";
import { pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function RiskField({ wards, selected, onPick }: { wards: Forecast[]; selected: string; onPick: (w: string) => void }) {
  const { t, lang } = useI18n();
  const [hv, setHv] = useState<Forecast | null>(null);
  const cities = Array.from(new Set(wards.map((w) => w.city)));
  const read = hv ?? wards.find((w) => w.ward_id === selected) ?? null;
  return (<div>
    <div className="flex flex-wrap items-end gap-x-6 gap-y-6 border-b border-line pb-0">{cities.map((c) => { const ws = wards.filter((w) => w.city === c).sort((a, b) => b.p_outbreak - a.p_outbreak); return (
      <div key={c} className="min-w-0">
        <div className="flex h-[96px] items-end gap-[3px]">{ws.map((w, i) => (
          <button key={w.ward_id} onClick={() => onPick(w.ward_id)} onMouseEnter={() => setHv(w)} onMouseLeave={() => setHv(null)} onFocus={() => setHv(w)} onBlur={() => setHv(null)}
            aria-label={`${w.ward_id}, ${w.city}: ${t(`risk.${w.risk_tier.toLowerCase()}`)}, ${pct(w.p_outbreak, lang)} chance, median ${w.median_cases} cases`} aria-pressed={w.ward_id === selected}
            className="group relative flex h-full w-[13px] items-end outline-none sm:w-[15px]">
            <span className={"sf-rise block w-full rounded-t-[2px] transition-[filter] group-hover:brightness-125 group-focus-visible:brightness-125 " + (w.ward_id === selected ? "outline outline-2 outline-offset-2 outline-ink" : "")}
              style={{ height: `${8 + w.p_outbreak * 88}%`, background: TIER_COLOR[w.risk_tier], animationDelay: `${i * 0.035}s` }} />
            {w.outbreak_alert && <span className="absolute left-0 right-0 h-[2px] bg-coral" style={{ bottom: `calc(${8 + w.p_outbreak * 88}% + 3px)` }} aria-hidden />}
          </button>))}</div>
        <div className="mt-2 border-t border-line pt-2 text-[12.5px] text-ink-2">{c}<span className="ml-2 text-ink-3">{ws.filter((w) => w.outbreak_alert).length}/{ws.length}</span></div>
      </div>); })}</div>
    <p className="mt-5 min-h-[22px] text-[13.5px] text-ink-2" aria-live="polite">{read && <><b className="font-semibold text-ink">{read.ward_id}</b>, {read.city}: median {read.median_cases} cases, {pct(read.p_outbreak, lang)} chance of an outbreak week, {t(`risk.${read.risk_tier.toLowerCase()}`)}{read.outbreak_alert ? ", on alert" : ""}.</>}</p>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-3">{TIERS.map((x) => <span key={x} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: TIER_COLOR[x] }} />{t(`risk.${x.toLowerCase()}`)}</span>)}<span>Bar height: chance of an outbreak week. Coral cap: on alert.</span></div>
  </div>);
}
