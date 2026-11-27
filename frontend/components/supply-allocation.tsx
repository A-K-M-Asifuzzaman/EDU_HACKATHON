"use client";
// Problem 1 (Phase 2 onsite): constrained supply allocation. Forecast demand for saline, diagnostic kits and beds is placed under a
// configurable regional stock level, with a fairness floor and a risk-and-density priority; spraying crews are assigned by priority.
// Every number comes from GET /api/allocation/plan, which runs locally (no external service). Stock, crews and capacity are planning
// assumptions: the dataset contains none of them.
import { useEffect, useMemo, useState } from "react";
import { api, qs } from "@/lib/api";
import { srcParam, useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, download, pct, toCsv } from "@/lib/format";
import { Btn, Card, CardTitle, DataTable, Kpi, Loading, Notice, ProvChip, RiskBadge, Segmented, Select, useAsync } from "./ui";
import { provenance, PROV_TEXT } from "@/lib/provenance";

export const LAST_ORIGIN = "2024-12-30";
export const CITIES = ["Dhaka North", "Dhaka South", "Chattogram", "Gazipur", "Narayanganj"];
export type Service = "median" | "p80" | "p90";
/** One plan state for Supply allocation, Hospital surge and Vector control: the same city, service level, stock, crew budget and
 *  illustrative capacity, so every section reads the same projected demand and the same resources. */
export function usePlanState() {
  const [city, setCity] = useState("All");
  const [service, setService] = useState<Service>("p80");
  const [stock, setStock] = useState(60);
  const [crews, setCrews] = useState(20);
  const [maxCrews, setMaxCrews] = useState(3);
  const [risk, setRisk] = useState(70);
  const [floor, setFloor] = useState(25);
  const [perCrew, setPerCrew] = useState(10);
  const [capPct, setCapPct] = useState(100);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  return { city, setCity, service, setService, stock, setStock, crews, setCrews, maxCrews, setMaxCrews, risk, setRisk, floor, setFloor,
    perCrew, setPerCrew, capPct, setCapPct, overrides, setOverrides };
}
export type PlanShared = ReturnType<typeof usePlanState>;

/** Decision tools accept only out-of-time forecasts issued in 2024 or earlier; otherwise explain why and offer the fix. */
export function useDecisionGuard() {
  const { sel, set, meta } = useSel();
  const { lang } = useI18n();
  const pv = provenance(sel.origin, sel.horizon, sel.source, meta);
  const sealed = sel.origin > LAST_ORIGIN;
  const blocked = sealed || pv.kind === "in_sample" || pv.kind === "none";
  const notice = sealed ? (<Notice tone="warn"><b>Decision tools use forecasts issued in 2024 or earlier.</b> 2025 is the sealed test year. The forecast issued {dateFmt(LAST_ORIGIN, lang)} already covers January 2025.
      <div className="mt-2"><Btn variant="ghost" onClick={() => set({ origin: LAST_ORIGIN, source: "auto" })}>Use the forecast issued {dateFmt(LAST_ORIGIN, lang)}</Btn></div></Notice>)
    : blocked ? (<Notice tone="warn"><b>This plan needs an out-of-time forecast.</b> {PROV_TEXT[pv.kind]}
      {pv.fix && <div className="mt-2"><Btn variant="ghost" onClick={() => set(pv.fix!)}>{pv.fix.origin ? `Use origin ${dateFmt(pv.fix.origin, lang)}` : "Use the validated replay"}</Btn></div>}</Notice>) : null;
  return { blocked, notice, pv };
}
const RES = [["saline_bags_needed", "Saline bags"], ["diagnostic_kits_needed", "Diagnostic kits"], ["hospital_beds_required", "Hospital beds"]] as const;
const STATUS: Record<string, [string, string]> = { met: ["Fully supplied", "bg-[#d9f7ea] text-[#0b5d44]"], deficit: ["Deficit", "bg-[#fff1cc] text-[#6b4a00]"], critical: ["Critical deficit", "bg-[#ffe9ea] text-[#8f1d25]"] };

export function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

export function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (<label className="flex min-w-[200px] flex-1 flex-col gap-1">
    <span className="flex items-baseline justify-between text-[12px] font-semibold text-ink-3"><span>{label}</span><b className="num text-[15px] text-ink">{fmt(value)}</b></span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-2 w-full accent-emerald" />
    <span className="flex justify-between text-[11px] text-ink-3"><span>{fmt(min)}</span><span>{fmt(max)}</span></span></label>);
}

export default function SupplyAllocation({ shared }: { shared: PlanShared }) {
  const { sel } = useSel();
  const { lang } = useI18n();
  const { city, setCity, service, setService, stock, setStock, crews, setCrews, risk, setRisk, floor, setFloor, perCrew, setPerCrew, maxCrews, setMaxCrews } = shared;
  const { blocked, notice } = useDecisionGuard();
  const params = useDebounced({ stock, crews, risk, floor, perCrew, maxCrews });
  const q = useAsync((s) => (blocked ? Promise.resolve(null) : api(`/api/allocation/plan?${qs({
    origin: sel.origin, horizon: sel.horizon, source: srcParam(sel), city: city === "All" ? undefined : city, service,
    stock: params.stock / 100, crews: params.crews, risk_weight: params.risk / 100, floor: params.floor / 100,
    cases_per_crew: params.perCrew, max_crews_per_ward: params.maxCrews })}`, { signal: s })),
  [sel.origin, sel.horizon, sel.source, city, service, params, blocked]);
  const d: any = q.data;
  const critical = useMemo(() => (d?.wards ?? []).filter((w: any) => w.status === "critical"), [d]);

  const exportCsv = () => d && download(`dengueshield_allocation_${d.origin}_h${d.horizon}_${d.city}_stock${Math.round(d.settings.stock * 100)}.csv`, toCsv(d.wards.map((w: any) => ({
    rank: w.rank, ward_id: w.ward_id, city: w.city, risk_tier: w.risk_tier, p_outbreak: w.p_outbreak, population_density_sqkm: w.population_density_sqkm,
    priority: w.priority, forecast_cases: w.forecast_cases, ...Object.fromEntries(RES.flatMap(([k]) => [[`${k}_demand`, w[k].demand], [`${k}_allocated`, w[k].allocated], [`${k}_unmet`, w[k].unmet]])),
    crews_needed: w.crews_needed, crews_assigned: w.crews_assigned, status: w.status }))));

  return (<Card id="supply" className="mt-5 scroll-mt-20" aria-labelledby="supply-title">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="supply-title" className="text-[15px] font-semibold text-ink">Supply allocation</h2>
        <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-snug text-ink-3">Saline, diagnostic kits and beds from the forecast, placed under a stock limit; spraying crews by priority. Runs on this computer, no internet needed.</p></div>
      <div className="flex flex-wrap items-center gap-2"><ProvChip tone="info">Planning estimate</ProvChip>{d && <Btn variant="ghost" onClick={exportCsv}>Export CSV</Btn>}</div>
    </div>

    {blocked ? notice : (<>
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-line p-4">
      <Select label="City" value={city} onChange={setCity} options={[{ value: "All", label: "All five cities" }, ...CITIES.map((c) => ({ value: c, label: c }))]} />
      <Segmented label="Plan for" value={service} onChange={(v) => setService(v as any)} options={[{ value: "median", label: "Median" }, { value: "p80", label: "Upper 80%" }, { value: "p90", label: "Upper 90%" }]} />
      <Range label="Regional stock" value={stock} min={30} max={100} step={5} onChange={setStock} fmt={(v) => `${v}%`} />
      <Range label="Spraying crews" value={crews} min={0} max={120} step={1} onChange={setCrews} fmt={(v) => String(v)} />
    </div>
    <details className="mt-3 rounded-xl border border-line p-4 text-[13px]"><summary className="cursor-pointer font-semibold text-ink">Priority and fairness settings</summary>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-4">
        <Range label="Weight on outbreak risk (rest on density)" value={risk} min={0} max={100} step={5} onChange={setRisk} fmt={(v) => `${v}%`} />
        <Range label="Fairness floor (share of demand every ward gets first)" value={floor} min={0} max={50} step={5} onChange={setFloor} fmt={(v) => `${v}%`} />
        <Range label="Forecast cases per extra crew" value={perCrew} min={2} max={40} step={1} onChange={setPerCrew} fmt={(v) => String(v)} />
        <Range label="Most crews per ward" value={maxCrews} min={1} max={6} step={1} onChange={setMaxCrews} fmt={(v) => String(v)} />
      </div></details>

    <Loading q={q} h={420} kind="table" label="Supply allocation">{() => (<div aria-live="polite">
      <p className="mt-4 text-[12.5px] text-ink-3">Forecast issued {dateFmt(d.origin, lang)} for the week of {dateFmt(d.target_date, lang)}, planned at the {d.settings.service_label}; {d.city === "All" ? "all 60 wards, each city its own stock pool" : `${d.city} only`}.</p>
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {RES.map(([k, label]) => { const t = d.totals[k]; return <Kpi key={k} label={`${label}: allocated of needed`} value={t.allocated} hint={`of ${t.demand} needed; supply ${t.supply}; short ${t.unmet}`} tone={t.unmet > 0 ? "bad" : "ok"} />; })}
        <Kpi label="Crews assigned" value={d.totals.crews.assigned} hint={`of ${d.totals.crews.total} available; ${d.totals.crews.needed} needed`} tone={d.totals.crews.unmet_need > 0 ? "warn" : "ok"} />
      </div>
      {critical.length > 0 ? (<div role="alert" className="mt-4 rounded-xl border-2 border-[#c2303a] bg-[#ffe9ea] p-3 text-[13px] text-[#8f1d25]">
        <b>Critical supply deficit in {critical.length} ward{critical.length === 1 ? "" : "s"}</b> (High or Critical risk with any shortfall, or under half of demand covered): {critical.slice(0, 8).map((w: any) => w.ward_id).join(", ")}{critical.length > 8 ? ` and ${critical.length - 8} more` : ""}.
        <span className="block text-[12px]">{d.counts.deficit > 0 ? `${d.counts.deficit} more ward${d.counts.deficit === 1 ? "" : "s"} short (not critical); ` : ""}{d.counts.met} fully supplied.</span></div>)
        : <div role="status" className="mt-4 rounded-xl border border-line bg-[#d9f7ea] p-3 text-[13px] text-[#0b5d44]">{d.counts.deficit === 0 ? `Every ward in view is fully supplied at ${Math.round(d.settings.stock * 100)}% stock.` : `${d.counts.deficit} ward(s) short, none critical.`}</div>}

      <h3 className="mb-2 mt-5 text-[14px] font-semibold text-ink">By city</h3>
      <DataTable dense maxH={260} rows={d.cities.map((c: any) => ({ ...c, ...Object.fromEntries(RES.map(([k]) => [k, `${c[k].allocated} / ${c[k].demand}${c[k].unmet ? ` (short ${c[k].unmet})` : ""}`])), crews: `${c.crews.assigned} / ${c.crews.needed}` }))}
        cols={[{ key: "city", label: "City" }, { key: "wards", label: "Wards", align: "right" }, ...RES.map(([k, l]) => ({ key: k, label: l })), { key: "crews", label: "Crews" }, { key: "critical_wards", label: "Critical", align: "right" as const }]} />

      <h3 className="mb-2 mt-5 text-[14px] font-semibold text-ink">Wards by priority</h3>
      <DataTable dense maxH={520} rows={d.wards} cols={[
        { key: "rank", label: "#", align: "right" }, { key: "ward_id", label: "Ward", render: (w: any) => <span><b>{w.ward_id}</b><span className="block text-[11px] text-ink-3">{w.city}</span></span> },
        { key: "risk_tier", label: "Risk", render: (w: any) => <RiskBadge tier={w.risk_tier} size="sm" /> },
        { key: "p_outbreak", label: "Outbreak chance", align: "right", render: (w: any) => pct(w.p_outbreak, lang) },
        { key: "population_density_sqkm", label: "Density /km²", align: "right", render: (w: any) => w.population_density_sqkm.toLocaleString("en") },
        { key: "priority", label: "Priority", align: "right", render: (w: any) => w.priority.toFixed(3) },
        { key: "forecast_cases", label: "Cases", align: "right" },
        ...RES.map(([k, l]) => ({ key: k, label: l, align: "right" as const, sort: (w: any) => w[k].unmet, render: (w: any) => <span className="num">{w[k].allocated}/{w[k].demand}{w[k].unmet > 0 && <b className="ml-1 text-coral-d">−{w[k].unmet}</b>}</span> })),
        { key: "crews_assigned", label: "Crews", align: "right", render: (w: any) => `${w.crews_assigned}/${w.crews_needed}` },
        { key: "status", label: "Status", render: (w: any) => <span className={"inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold " + STATUS[w.status][1]}>{STATUS[w.status][0]}</span> }]} />
      <p className="mt-2 text-[12px] text-ink-3">Cells show allocated / needed, with the shortfall in red. Ties in priority are broken by ward ID, so the same settings always give the same plan.</p>

      <details className="mt-4 rounded-xl border border-line p-4 text-[13px] text-ink-2"><summary className="cursor-pointer font-semibold text-ink">How the allocation works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{d.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
        <p className="mt-2">Demand multipliers: saline {d.multipliers.saline_bags_needed.toFixed(4)}, kits {d.multipliers.diagnostic_kits_needed.toFixed(4)}, beds {d.multipliers.hospital_beds_required.toFixed(4)} per forecast case. Within each city the remaining stock fills wards in priority order, which maximises the priority-weighted supply for the given floor (checked against an exact solver in the tests).</p></details>
    </div>)}</Loading></>)}
  </Card>);
}
