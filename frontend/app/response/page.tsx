"use client";
import { useMemo, useState } from "react";
import { api, qs, addWeeks, type Forecast } from "@/lib/api";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, download, isoWeek, num, pct, toCsv } from "@/lib/format";
import ControlsBar from "@/components/controls";
import ResourceSandbox from "@/components/sandbox";
import AlertQueue from "@/components/alert-queue";
import { Btn, Card, CardTitle, DataTable, Loading, Modal, Notice, PageHeader, ProvChip, RiskBadge, Segmented, useAsync, useToast } from "@/components/ui";
import Link from "next/link";
import { selQuery } from "@/lib/ctx";
import { TIERS } from "@/lib/api";

const OPTIONS = [
  { title: "Source reduction in high-risk wards", body: "Community clean-up drives for containers and drains where waterlogging risk is high; review drainage maintenance schedules.", when: "Rising rainfall signal and High/Critical tier" },
  { title: "Targeted larval surveillance", body: "Prioritise larval/pupal surveys in wards with elevated outbreak probability to confirm breeding before cases rise.", when: "Elevated probability with moderate confidence" },
  { title: "Public communication", body: "Share timely guidance on removing standing water and early care-seeking through established channels.", when: "City-level alerts across several wards" },
  { title: "Health-facility readiness review", body: "Ask facilities serving high-ranked wards to review bed, test-kit and saline stock levels against their own thresholds.", when: "Sustained Critical tier at 2–3 weeks" },
  { title: "Targeted vector control review", body: "Review spraying/fogging and larviciding plans against national guidance; prioritise by risk rank, not by this model alone.", when: "High probability with narrow interval" },
];

function confidence(f: Forecast) {                                   // narrow interval relative to the median, and a short horizon, mean higher confidence
  const w = f.upper_90 - f.lower_90, rel = w / Math.max(f.median_cases, 1);
  const score = (rel < 1 ? 2 : rel < 1.6 ? 1 : 0) + (f.horizon === 2 ? 1 : 0);
  return { label: score >= 3 ? "Higher" : score >= 2 ? "Moderate" : "Lower", w };
}

export default function Response() {
  const { sel, ready } = useSel();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [by, setBy] = useState<"p_outbreak" | "expected_cases">("p_outbreak");
  const src = srcParam(sel);
  const rank = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: sel.horizon, source: src, sort: by, limit: 15 })}`, { signal: s }), [sel.origin, sel.horizon, sel.source, by, ready]);
  const sum = useAsync((s) => api(`/api/reports/summary?${qs({ origin: sel.origin, horizon: sel.horizon, source: src })}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const cities = ["Dhaka North", "Dhaka South", "Chattogram", "Gazipur", "Narayanganj"];
  const sig = useAsync(async (s) => Promise.all(cities.map((c) => api(`/api/weather/historical?${qs({ city: c, start: addWeeks(sel.origin, -4), end: addWeeks(sel.origin, -1), metric: "rainfall_mm" })}`, { signal: s }).catch(() => null))), [sel.origin, ready]);
  const signals = useMemo(() => (sig.data ?? []).map((r: any, i: number) => {
    if (!r || !Array.isArray(r.rows) || !r.climatology_by_iso_week) return null;          // a failed or partial response must never break the page
    const recent = r.rows.reduce((a: number, x: any) => a + (x.rainfall_mm ?? 0), 0);
    const typ = r.rows.reduce((a: number, x: any) => a + (r.climatology_by_iso_week[String(isoWeek(x.date))] ?? 0), 0);
    return { city: cities[i], recent, typ, ratio: typ > 0 ? recent / typ : 1 };
  }).filter(Boolean), [sig.data]);
  const [tierF, setTierF] = useState<string>("All");
  const [detail, setDetail] = useState<Forecast | null>(null);
  const allWards: Forecast[] = rank.data?.wards ?? [];
  const wards = tierF === "All" ? allWards : allWards.filter((w) => w.risk_tier === tierF);
  const wq = (w: Forecast) => selQuery({ ...sel, ward: w.ward_id });
  return (<>
    <PageHeader eyebrow="Decision support · not official guidance" title={t("resp.title")} sub="Prioritise wards, check how confident each forecast is, and review generic options. Quantities, budgets and operational decisions are deliberately not computed here." />
    <ControlsBar show={["origin", "horizon", "source"]} />
    <Notice tone="warn">{t("resp.noofficial")} {t("disc.official")}</Notice>
    {/* long page on phones: jump straight to each part of the workflow */}
    <nav aria-label="On this page" className="mt-4 flex gap-2 overflow-x-auto pb-1 text-[13px]">{[["#priority", "Priority wards"], ["#alert-queue", "Review queue"], ["#options", "Generic options"], ["#sandbox", "Resource sandbox"]].map(([h, l]) => (
      <a key={h} href={h} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line bg-white px-3.5 font-medium text-forest hover:bg-mint-l">{l}</a>))}</nav>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card id="priority" className="scroll-mt-20"><CardTitle title="Priority wards" sub={`${sel.horizon} ${t("ctl.weeks")} · origin ${dateFmt(sel.origin, lang)} · ranked by ${by === "p_outbreak" ? "outbreak probability" : "expected cases"}`} right={<div className="flex flex-wrap gap-2"><Segmented value={by} onChange={setBy} options={[{ value: "p_outbreak", label: "Probability" }, { value: "expected_cases", label: "Expected cases" }]} />
        <Btn variant="ghost" onClick={() => { download(`dengueshield_priority_${sel.origin}_h${sel.horizon}.csv`, toCsv(wards.map((w, i) => ({ rank: i + 1, ward_id: w.ward_id, city: w.city, tier: w.risk_tier, p_outbreak: w.p_outbreak, median: w.median_cases, mean: w.expected_cases, lo90: w.lower_90, hi90: w.upper_90, confidence: confidence(w).label, origin: w.origin_date, target: w.target_date, source: w.source, note: "statistical categories; not official; synthetic dataset" })))); toast(t("act.export")); }}>{t("act.export")}</Btn></div>} />
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by risk tier"><span className="eyebrow mr-1">Severity</span>{["All", ...[...TIERS].reverse()].map((x) => (
          <button key={x} onClick={() => setTierF(x)} aria-pressed={tierF === x} className={"min-h-11 rounded-full border px-3 text-[12.5px] font-medium sm:min-h-9 " + (tierF === x ? "border-forest bg-forest text-white" : "border-line bg-white text-ink-2 hover:bg-mint-l")}>{x}{x !== "All" && allWards.length ? ` (${allWards.filter((w) => w.risk_tier === x).length})` : ""}</button>))}
          <span className="text-[11.5px] text-ink-3">Tap a row for details and evidence links.</span></div>
        <Loading q={rank} h={420} kind="table" label="Ward ranking">{() => <DataTable dense maxH={520} onRow={(r: any) => setDetail(r)} rows={wards.map((w, i) => ({ ...w, rank: i + 1, conf: confidence(w).label }))} cols={[{ key: "rank", label: "#", align: "right" }, { key: "ward_id", label: t("ctl.ward"), render: (w: any) => <b>{w.ward_id}</b> }, { key: "city", label: t("ctl.city") }, { key: "risk_tier", label: t("fc.tier"), render: (w: any) => <RiskBadge tier={w.risk_tier} size="sm" /> }, { key: "p_outbreak", label: t("fc.prob"), align: "right", render: (w: any) => pct(w.p_outbreak, lang) }, { key: "median_cases", label: t("fc.median"), align: "right" }, { key: "i", label: "90% interval", align: "right", render: (w: any) => `${w.lower_90}–${w.upper_90}` }, { key: "conf", label: "Confidence", render: (w: any) => <ProvChip tone={w.conf === "Higher" ? "ok" : w.conf === "Moderate" ? "info" : "warn"}>{w.conf}</ProvChip> }]} />}</Loading>
        <p className="mt-2 text-xs text-ink-3">Confidence compares the 90% interval width with the median and favours the shorter horizon. It is a rough guide: intervals under-cover outbreak peaks, so even "Higher" is not a guarantee.</p></Card>
      <div className="grid content-start gap-5">
        <Card><CardTitle title="City summary" /><Loading q={sum} h={160} kind="table" label="City summary">{(s: any) => <DataTable dense rows={s.by_city} maxH={240} cols={[{ key: "city", label: t("ctl.city") }, { key: "wards", label: t("kpi.wards"), align: "right" }, { key: "alerts", label: "Alerts", align: "right" }, { key: "expected", label: "Expected cases", align: "right", render: (r: any) => num(r.expected, lang, 0) }]} />}</Loading></Card>
        <Card><CardTitle title="Concerning climate signals" sub="Last 4 observed weeks of rain vs typical for those weeks (organizer weather, synthetic)" />
          {sig.loading ? <p className="text-sm text-ink-3">{t("state.loading")}</p> : (<div className="space-y-2">{signals.map((s: any) => (<div key={s.city} className="flex items-center gap-3 text-[13px]"><span className="w-28 font-medium">{s.city}</span><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (s.ratio / 2) * 100)}%`, background: s.ratio > 1.3 ? "#d93a42" : s.ratio < 0.7 ? "#3b82c4" : "#3b3a8c" }} /></div><span className="num w-24 text-right text-xs">{num(s.recent, lang, 0)} / {num(s.typ, lang, 0)} mm</span></div>))}<p className="text-[11px] text-ink-3">Above typical rain 2–4 weeks before the target week is the pattern the model associates with higher counts.</p></div>)}</Card></div></div>
    <Card id="options" className="mt-5 scroll-mt-20"><CardTitle title={t("resp.generic")} sub="Generic, evidence-informed options for officers to review against national guidance" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{OPTIONS.map((o) => (<div key={o.title} className="rounded-xl border border-line p-4"><h3 className="text-sm font-semibold text-forest">{o.title}</h3><p className="mt-1 text-[13px] text-ink-2">{o.body}</p><p className="mt-2 text-[11px] text-ink-3"><b>Consider when:</b> {o.when}</p></div>))}</div>
      <p className="mt-3 text-xs text-ink-3">These are not official government decisions or recommendations, and no resource quantities are suggested. They were written for this prototype as generic examples.</p></Card>
  <AlertQueue />
    <div id="sandbox" className="scroll-mt-20"><ResourceSandbox /></div>
    <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.ward_id} · ${detail.city}` : ""}>
      {detail && (<div className="space-y-3 text-[13.5px]">
        <div className="flex flex-wrap items-center gap-2"><RiskBadge tier={detail.risk_tier} /><ProvChip tone={detail.outbreak_alert ? "warn" : "ok"}>{detail.outbreak_alert ? "Outbreak alert" : "No alert"}</ProvChip><ProvChip>synthetic ward</ProvChip></div>
        <p>Week of <b>{dateFmt(detail.target_date, lang)}</b>, {sel.horizon} weeks ahead: median <b className="num">{detail.median_cases}</b> cases (90%: {detail.lower_90}–{detail.upper_90}), outbreak probability <b>{pct(detail.p_outbreak, lang)}</b>.</p>
        <p className="text-ink-2">Forecast confidence: <b>{confidence(detail).label}</b>. Intervals under-cover outbreak peaks, so treat the upper end as plausible.</p>
        <div className="flex flex-wrap gap-2">{[["Open in Command Center", `/command/${wq(detail)}`], ["Explain in the Forecast Lab", `/lab/${wq(detail)}`], ["Compare in Ward Explorer", `/wards/${wq(detail)}`], ["Find hospitals on the map", "/geography/"]].map(([l, h]) => (
          <Link key={h} href={h} className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 font-medium text-forest hover:bg-mint-l">{l} →</Link>))}</div>
        <p className="rounded-xl bg-amber/10 p-2.5 text-[12px] text-ink-2">Local planning view on synthetic data. Nothing here is sent to anyone and no authority has been notified; record a decision in the review queue below if needed.</p>
      </div>)}
    </Modal>
  </>);
}
