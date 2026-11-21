"use client";
import { useMemo, useState } from "react";
import { api, qs, TIERS, TIER_COLOR, type Forecast, type Tier } from "@/lib/api";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { cls, dateFmt, download, num, pct, toCsv } from "@/lib/format";
import ControlsBar from "@/components/controls";
import CityMap from "@/components/citymap";
import RiskMatrix from "@/components/riskmatrix";
import { Btn, Card, CardTitle, DataTable, EmptyState, Loading, Modal, PageHeader, ProvChip, RiskBadge, Segmented, useAsync, useToast } from "@/components/ui";
import { FanChart } from "@/components/charts";
import { Chart, axisStyle } from "@/components/echart";

export default function Wards() {
  const { sel, set, ready } = useSel();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "All">("All");
  const [picked, setPicked] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const src = srcParam(sel);
  const all = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: sel.horizon, source: src })}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const h2 = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: 2, source: src })}`, { signal: s }), [sel.origin, sel.source, ready]);
  const h3 = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: 3, source: src })}`, { signal: s }), [sel.origin, sel.source, ready]);
  const h4 = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: 4, source: src })}`, { signal: s }), [sel.origin, sel.source, ready]);
  const wards: Forecast[] = all.data?.wards ?? [];
  const filtered = wards.filter((w) => (sel.city === "All" || w.city === sel.city) && (tier === "All" || w.risk_tier === tier) && (!q || w.ward_id.toLowerCase().includes(q.toLowerCase())));
  const cityPts = useMemo(() => Object.values(wards.reduce((a: any, w) => { const c = (a[w.city] ??= { city: w.city, wards: 0, alerts: 0, p: 0, expected: 0 }); c.wards++; c.alerts += w.outbreak_alert ? 1 : 0; c.p += w.p_outbreak; c.expected += w.expected_cases; return a; }, {})).map((c: any) => ({ city: c.city, wards: c.wards, alerts: c.alerts, meanP: c.p / c.wards, expected: c.expected })), [wards]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? [...p.slice(1), id] : [...p, id]));
  const cmpOpt = useMemo(() => {
    if (!picked.length || !h2.data || !h3.data || !h4.data) return null;
    const get = (r: any, id: string) => r.wards.find((w: Forecast) => w.ward_id === id);
    return { grid: { left: 44, right: 14, top: 36, bottom: 30 }, legend: { top: 0, textStyle: { fontSize: 11 } }, tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: ["2w", "3w", "4w"], ...axisStyle }, yAxis: { type: "value", name: t("fc.median"), min: 0, ...axisStyle },
      series: picked.map((id) => ({ name: id, type: "bar", data: [get(h2.data, id)?.median_cases, get(h3.data, id)?.median_cases, get(h4.data, id)?.median_cases], barMaxWidth: 26, itemStyle: { borderRadius: [5, 5, 0, 0] } })) };
  }, [picked, h2.data, h3.data, h4.data, t]);
  const series = useAsync((s) => (detail ? api(`/api/forecast/series?${qs({ ward_id: detail, horizon: sel.horizon, year: Number(sel.origin.slice(0, 4)) })}`, { signal: s }).catch(() => null) : Promise.resolve(null)), [detail, sel.horizon, sel.origin]);
  const cols = [
    { key: "pick", label: "", render: (w: Forecast) => <input type="checkbox" aria-label={`Compare ${w.ward_id}`} checked={picked.includes(w.ward_id)} onChange={() => toggle(w.ward_id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-emerald" /> },
    { key: "ward_id", label: t("ctl.ward"), render: (w: Forecast) => <b>{w.ward_id}</b> }, { key: "city", label: t("ctl.city") },
    { key: "risk_tier", label: t("fc.tier"), render: (w: Forecast) => <RiskBadge tier={w.risk_tier} size="sm" />, sort: (w: Forecast) => TIERS.indexOf(w.risk_tier) },
    { key: "p_outbreak", label: t("fc.prob"), align: "right" as const, render: (w: Forecast) => pct(w.p_outbreak, lang) }, { key: "median_cases", label: t("fc.median"), align: "right" as const },
    { key: "expected_cases", label: t("fc.mean"), align: "right" as const, render: (w: Forecast) => num(w.expected_cases, lang, 1) },
    { key: "i90", label: "90%", align: "right" as const, render: (w: Forecast) => `${w.lower_90}–${w.upper_90}`, sort: (w: Forecast) => w.upper_90 },
    { key: "wl", label: "Waterlogging", align: "right" as const, render: (w: Forecast) => num(w.vulnerability?.water_logging_risk_index, lang, 2), sort: (w: Forecast) => w.vulnerability?.water_logging_risk_index ?? 0 },
    { key: "san", label: "Sanitation", align: "right" as const, render: (w: Forecast) => num(w.vulnerability?.sanitation_score, lang, 2), sort: (w: Forecast) => w.vulnerability?.sanitation_score ?? 0 },
    { key: "dens", label: "Density/km²", align: "right" as const, render: (w: Forecast) => num(w.vulnerability?.population_density_sqkm, lang, 0), sort: (w: Forecast) => w.vulnerability?.population_density_sqkm ?? 0 },
  ];
  return (<>
    <PageHeader eyebrow={t("mode.replay")} title={t("nav.wards")} sub="All 60 wards at the selected origin and horizon: risk ranking, an interactive risk matrix, filters, comparison and drill-down. The wards are synthetic dataset identifiers; official DGHS boundaries are on the Geography page as context only, because no verified mapping to these IDs exists." />
    <ControlsBar show={["city", "origin", "horizon", "source"]} />
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card><CardTitle title="Risk matrix" sub={`${sel.horizon} ${t("ctl.weeks")} · ${dateFmt(sel.origin, lang)} · click a tile for details; tick rows below to compare`} right={<div className="flex gap-1.5">{TIERS.map((x) => <span key={x} className="flex items-center gap-1 text-[11px] text-ink-3"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: TIER_COLOR[x] }} />{t(`risk.${x.toLowerCase()}`)}</span>)}</div>} />
        <Loading q={all} h={300}>{() => <RiskMatrix wards={wards} city={sel.city} picked={picked} onOpen={setDetail} />}</Loading></Card>
      <Card><CardTitle title="City overview" sub="Alerting wards per city" />
        <CityMap points={cityPts} selected={sel.city !== "All" ? sel.city : undefined} onSelect={(c) => set({ city: c })} height={300} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">{cityPts.map((c: any) => (<button key={c.city} onClick={() => set({ city: sel.city === c.city ? "All" : c.city })} className={cls("rounded-xl border px-3 py-2 text-left hover:bg-mint-l/60", sel.city === c.city ? "border-emerald bg-mint-l" : "border-line")}><b>{c.city}</b><br /><span className="text-ink-3">{c.alerts}/{c.wards} alerts · {pct(c.meanP, lang)}</span></button>))}</div></Card>
    </div>

    <Card className="mt-5"><CardTitle title={`${t("sec.ranking")} (${filtered.length})`} right={<div className="flex flex-wrap items-center gap-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("act.search")} aria-label={t("act.search")} className="w-40 rounded-xl border border-line bg-white px-3 py-1.5 text-sm" />
      <Segmented value={tier} onChange={(v) => setTier(v as any)} options={[{ value: "All", label: t("ctl.all") }, ...TIERS.map((x) => ({ value: x, label: t(`risk.${x.toLowerCase()}`) }))]} />
      <Btn variant="ghost" onClick={() => { download(`dengueshield_wards_${sel.origin}_h${sel.horizon}.csv`, toCsv(filtered.map((w) => ({ ward_id: w.ward_id, city: w.city, origin: w.origin_date, target: w.target_date, horizon: w.horizon, tier: w.risk_tier, p_outbreak: w.p_outbreak, median: w.median_cases, mean: w.expected_cases, lo90: w.lower_90, hi90: w.upper_90, source: w.source })))); toast(t("act.export")); }}>{t("act.export")}</Btn></div>} />
      {filtered.length ? <DataTable rows={filtered} cols={cols} onRow={(w) => setDetail(w.ward_id)} maxH={460} dense /> : <EmptyState />}</Card>

    <Card className="mt-5"><CardTitle title="Ward comparison" sub="Tick up to 4 wards in the table. Median forecast by horizon at this origin." right={picked.length > 0 && <Btn variant="ghost" onClick={() => setPicked([])}>{t("act.clear")}</Btn>} />
      {cmpOpt ? <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]"><Chart option={cmpOpt} height={260} ariaLabel="Median forecast by horizon for the selected wards" />
        <div className="grid gap-2">{picked.map((id) => { const w = wards.find((x) => x.ward_id === id); return w ? (<div key={id} className="flex items-center justify-between rounded-xl border border-line p-3 text-sm"><div><b>{id}</b><div className="text-xs text-ink-3">{w.city} · waterlogging {w.vulnerability?.water_logging_risk_index} · sanitation {w.vulnerability?.sanitation_score} · density {num(w.vulnerability?.population_density_sqkm, lang, 0)}</div></div><RiskBadge tier={w.risk_tier} size="sm" /></div>) : null; })}</div></div> : <EmptyState text="No wards selected." />}</Card>

    <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ?? ""} wide>
      {detail && (() => { const w = wards.find((x) => x.ward_id === detail); return w ? (<div className="grid gap-4"><div className="flex flex-wrap items-center gap-3"><RiskBadge tier={w.risk_tier} size="lg" /><ProvChip tone={w.outbreak_alert ? "warn" : "ok"}>{w.outbreak_alert ? t("fc.yes") : t("fc.no")}</ProvChip>
        <span className="text-sm">{t("fc.median")} <b className="num">{w.median_cases}</b> · {t("fc.mean")} <b className="num">{num(w.expected_cases, lang, 1)}</b> · 80% {w.lower_80}–{w.upper_80} · 90% {w.lower_90}–{w.upper_90} · P {pct(w.p_outbreak, lang)}</span></div>
        {series.data ? <FanChart series={series.data.series} markDate={w.target_date} height={280} /> : <EmptyState text="No validated replay series for this origin year." />}
        <div className="flex gap-2"><Btn onClick={() => { set({ ward: w.ward_id }); setDetail(null); }}>Use in Command Center</Btn></div></div>) : null; })()}
    </Modal>
  </>);
}
