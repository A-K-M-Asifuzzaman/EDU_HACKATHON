"use client";
import { useMemo } from "react";
import { TIER_COLOR, type Forecast } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cls, pct } from "@/lib/format";

/** Abstract (non-geographic) ward-risk matrix: one tile per synthetic dataset ward, grouped by city. Position carries no spatial meaning. */
export default function RiskMatrix({ wards, city = "All", picked = [], onOpen }: { wards: Forecast[]; city?: string; picked?: string[]; onOpen?: (id: string) => void }) {
  const { t, lang } = useI18n();
  const byCity = useMemo(() => { const m: Record<string, Forecast[]> = {}; for (const w of wards) (m[w.city] ??= []).push(w); for (const c in m) m[c].sort((a, b) => a.ward_id.localeCompare(b.ward_id, undefined, { numeric: true })); return m; }, [wards]);
  return (<div className="space-y-3">{Object.entries(byCity).filter(([c]) => city === "All" || c === city).map(([c, ws]) => (<div key={c}><div className="eyebrow mb-1.5">{c}</div>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">{ws.map((w) => (<button key={w.ward_id} onClick={() => onOpen?.(w.ward_id)} title={`${w.ward_id}: ${w.risk_tier}, P(outbreak) ${pct(w.p_outbreak, lang)}, median ${w.median_cases} [${w.lower_90}–${w.upper_90}]`}
      aria-label={`${w.ward_id} ${w.risk_tier} ${pct(w.p_outbreak, lang)}`} className={cls("relative rounded-lg px-1 py-2 text-center text-white transition hover:scale-105 hover:shadow-lg focus-visible:scale-105", picked.includes(w.ward_id) && "ring-2 ring-forest ring-offset-2", w.outbreak_alert && "outline outline-1 outline-white/60")} style={{ background: TIER_COLOR[w.risk_tier], opacity: 0.55 + 0.45 * w.p_outbreak }}>
      <span className="block text-[10px] font-medium opacity-90">{w.ward_id.split("_Ward_")[1]}</span><span className="num block text-sm font-bold leading-tight">{Math.round(w.p_outbreak * 100)}</span></button>))}</div></div>))}
    <p className="text-[11px] text-ink-3">Tile number = outbreak probability (%). Tier colour = statistical category of the median forecast. {t("risk.note")}</p></div>);
}
