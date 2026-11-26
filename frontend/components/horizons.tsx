"use client";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { api, qs } from "@/lib/api";
import { dateFmt, num, pct } from "@/lib/format";
import { Loading, ProvChip, RiskBadge, useAsync } from "./ui";
import { motion } from "motion/react";

/** One row per horizon (2/3/4 weeks): target week, median, mean, intervals, outbreak probability, tier, observed. */
export default function HorizonCompare({ ward, origin }: { ward?: string; origin?: string }) {
  const { sel, set, ready } = useSel();
  const { t, lang } = useI18n();
  const w = ward ?? sel.ward, o = origin ?? sel.origin;
  const q = useAsync((s) => api(`/api/forecast/compare?${qs({ ward_id: w, origin: o, source: srcParam(sel) })}`, { signal: s }), [w, o, sel.source, ready]);
  return (<Loading q={q} h={190} kind="block" label="Horizon forecasts">{(d: any) => (<div className="grid gap-2">{d.forecasts.map((f: any, i: number) => f.error ? (
    <div key={f.horizon} className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-xs text-ink-2"><b>{f.horizon}w</b>: {f.error}</div>) : (
    <motion.button key={f.horizon} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} onClick={() => set({ horizon: f.horizon })} aria-pressed={f.horizon === sel.horizon}
      className={"grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-mint-l/60 " + (f.horizon === sel.horizon ? "border-emerald bg-mint-l" : "border-line bg-white")}>
      <span className="num grid h-10 w-10 place-items-center rounded-xl bg-forest text-sm font-bold text-white">{f.horizon}w</span>
      <span className="min-w-0"><span className="block text-[11px] text-ink-3">{t("fc.target")} {dateFmt(f.target_date, lang)}</span>
        <span className="block text-[15px] font-bold text-forest"><span className="num">{f.median_cases}</span> <span className="text-xs font-medium text-ink-3">{t("fc.median").toLowerCase()} · 80% {f.lower_80}–{f.upper_80} · 90% {f.lower_90}–{f.upper_90}</span></span>
        <span className="block text-[11px] text-ink-3">{t("fc.mean")}: <span className="num">{num(f.expected_cases, lang, 1)}</span>{f.actual_cases !== null && <> · {t("fc.actual")}: <b className="num text-coral-d">{f.actual_cases}</b></>}</span></span>
      <span className="flex flex-col items-end gap-1"><span className="num text-sm font-bold">{pct(f.p_outbreak, lang)}</span><RiskBadge tier={f.risk_tier} size="sm" />{f.outbreak_alert && <ProvChip tone="warn">{t("fc.yes")}</ProvChip>}</span>
    </motion.button>))}</div>)}</Loading>);
}
