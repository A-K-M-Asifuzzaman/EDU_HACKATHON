"use client";
// Landing forecast readout (DESIGN.md §4): the real /api/forecast answer for the shared selection, typeset as three figures (median,
// 80% range, chance of an outbreak) with the controls that change it. Its own skeleton, status line and honest failure state.
import Link from "next/link";
import { type Forecast } from "@/lib/api";
import { selQuery, useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, pct } from "@/lib/format";
import { ProvChip, RequestStatus, Segmented, type AsyncState } from "./ui";

export function ForecastPreview({ fc, canon, visual }: { fc: AsyncState<any>; canon?: any; visual?: React.ReactNode }) {
  const { sel, set, wards } = useSel();
  const { t, lang } = useI18n();
  const f: Forecast | undefined = fc.data?.forecast;
  const h = canon?.regimes?.out_of_time_2019_2024?.by_horizon?.[String(sel.horizon)];
  const q = selQuery(sel);
  return (<div className="card flex flex-col p-4 sm:p-5" data-testid="forecast-preview" aria-live="polite" aria-busy={fc.loading}>
    <div className="order-4 mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4 sm:order-1 sm:mt-0 sm:border-0 sm:pt-0">
      <label className="flex min-w-[200px] flex-1 flex-col gap-1 sm:max-w-[280px]"><span className="text-[12px] font-semibold text-ink-3">{t("ctl.ward")}</span>
        <select value={sel.ward} onChange={(e) => set({ ward: e.target.value, city: "All" })} className="min-h-11 w-full rounded-control border border-line bg-canvas px-2 text-[13.5px] text-ink sm:min-h-10">
          {(wards.length ? wards : [{ ward_id: sel.ward, city: "" } as any]).map((w) => <option key={w.ward_id} value={w.ward_id}>{w.ward_id}{w.city ? `, ${w.city}` : ""}</option>)}</select></label>
      <Segmented label={t("ctl.horizon")} value={sel.horizon} onChange={(v) => set({ horizon: Number(v) })} options={[2, 3, 4].map((x) => ({ value: x, label: `${x} ${t("ctl.weeks")}` }))} />
    </div>

    {fc.status === "failed" && fc.error ? (<div className="order-1 text-[13.5px] text-ink-2 sm:order-2 sm:mt-5 sm:border-t sm:border-line sm:pt-4" role="alert"><p>{t("prev.unavailable")}</p>
      <button onClick={fc.reload} className="mt-3 inline-flex min-h-11 items-center rounded-control border border-line px-3 font-medium text-ink hover:border-ink-3">{t("prev.retry")}</button></div>)
      : !f ? (<div className="order-1 space-y-3 sm:order-2 sm:mt-5 sm:border-t sm:border-line sm:pt-4" aria-hidden><div className="skeleton h-5 w-2/3" /><div className="grid grid-cols-3 gap-4"><div className="skeleton h-16" /><div className="skeleton h-16" /><div className="skeleton h-16" /></div></div>)
      : (<div className={"order-1 transition-opacity sm:order-2 sm:mt-5 sm:border-t sm:border-line sm:pt-4 " + (fc.stale ? "opacity-45" : "")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-[16px] font-semibold text-ink">{f.ward_id} <span className="text-[13px] font-normal text-ink-3">({t("prev.synthetic")}, {f.city})</span></h2>
          {f && <ProvChip tone={f.source === "replay" ? "ok" : "warn"}>{f.source === "replay" ? t("src.replay") : t("src.bundle")}</ProvChip>}
        </div>
        <p className="mt-0.5 text-[13px] text-ink-2">{t("prev.issued")} {dateFmt(f.origin_date, lang)}, {t("prev.week")} {dateFmt(f.target_date, lang)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-y-4 sm:grid-cols-[1fr_1.15fr_1.25fr] sm:gap-y-0">
          <div className="col-span-2 flex flex-col-reverse justify-end sm:col-span-1 sm:pr-4"><dt className="mt-1.5 text-[12px] text-ink-3">{t("prev.median")}</dt><dd className="num font-display text-[60px] leading-[0.9] text-ink sm:flex sm:h-[64px] sm:items-end sm:text-[68px]" data-testid="preview-median">{f.median_cases}</dd></div>
          <div className="flex flex-col-reverse justify-end pr-3 sm:border-l sm:border-line sm:px-4"><dt className="mt-1.5 text-[12px] text-ink-3">{t("prev.interval")}; 90%: {f.lower_90}-{f.upper_90}</dt><dd className="num font-display text-[32px] leading-none text-ink sm:flex sm:h-[64px] sm:items-end sm:pb-1.5 sm:text-[38px]">{f.lower_80}-{f.upper_80}</dd></div>
          <div className="flex flex-col-reverse justify-end border-l border-line pl-3 sm:pl-4"><dt className="mt-1.5 text-[12px] leading-snug text-ink-3">{t("prev.chance")} ({f.outbreak_threshold ?? "-"} cases){f.outbreak_alert && <b className="mt-0.5 block font-semibold text-coral-d">Outbreak alert</b>}</dt>
            <dd className={"num font-display text-[32px] leading-none sm:flex sm:h-[64px] sm:items-end sm:pb-1.5 sm:text-[38px] " + (f.outbreak_alert ? "text-coral-d" : "text-ink")}>{pct(f.p_outbreak, lang)}</dd></div>
        </dl>
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
          {f.actual_cases != null && <>Observed that week: <b className="num text-ink">{f.actual_cases}</b> cases. </>}
          {h && <>At {sel.horizon} weeks the model is typically off by {h.mae.toFixed(2)} cases, and its 80% range held in {Math.round(h.coverage.all["80"] * 100)}% of weeks but only {Math.round(h.coverage.peaks["80"] * 100)}% of outbreak peaks.</>}</p>
      </div>)}
    {fc.loading && !fc.data && <div className="order-2 sm:order-3"><RequestStatus q={fc} label="Forecast" /></div>}
    {visual && <div className="order-3 mt-5 sm:order-4">{visual}</div>}
    <div className="order-5 mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3.5 sm:order-5">
      <Link href={`/command/${q}`} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-[13.5px] font-medium text-canvas hover:bg-ink-2">{t("prev.open")}</Link>
      <Link href={`/lab/${q}`} className="inline-flex min-h-11 items-center text-[13.5px] font-medium text-emerald-d underline-offset-4 hover:underline">{t("land.cta.engine")}</Link>
    </div>
  </div>);
}
