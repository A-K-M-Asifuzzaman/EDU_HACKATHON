"use client";
// Problem 2 (Phase 2 onsite): hospital surge and cross-ward overflow. Projected bed demand (the same number Supply allocation uses)
// against an illustrative ward capacity; patients over capacity move only to wards with spare beds in the same city. Everything comes
// from GET /api/overflow/plan on the local API. No distances exist for the synthetic ward IDs, so the flow chart is abstract, not a map.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api, qs } from "@/lib/api";
import { srcParam, useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt, download, pct, toCsv } from "@/lib/format";
import { Icon } from "./icons";
import { CITIES, Live, PlanShared, Range, useDebounced, useDecisionGuard } from "./supply-allocation";
import { Btn, Card, DataTable, Kpi, ProvChip, RiskBadge, Segmented, Select, useAsync } from "./ui";
import SurgeNetwork from "./surge-network";

// the geographic view loads MapLibre only when it is opened; the ward network needs nothing beyond the overflow plan
const SurgeMap = dynamic(() => import("./surge-map"), { ssr: false, loading: () => <div role="status" className="ops-panel grid h-[420px] place-items-center text-[13px] text-ink-3">Loading the hospital map…</div> });

/** Two views of the same overflow plan: the abstract ward network (exact transfers) and the real hospital map (city aggregates). */
function SurgeViews({ d }: { d: any }) {
  const [view, setView] = useState<"network" | "map">("network");
  const [city, setCity] = useState<string | null>(null);              // shared, so a city chosen in one view stays chosen in the other
  return (<div className="mt-5">
    <div role="group" aria-label="Overflow view" className="flex flex-wrap gap-1.5">
      {([["network", "Ward transfer network"], ["map", "Hospital map"]] as const).map(([k, l]) => (
        <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className="ops-chip">{l}</button>))}
    </div>
    {view === "network" ? <SurgeNetwork d={d} cityPick={city} onCity={setCity} />
      : <div className="mt-3"><h3 className="text-[14px] font-semibold text-ink">Hospital map</h3>
        <p className="mb-3 mt-0.5 max-w-[72ch] text-[12.5px] text-ink-3">Real hospitals from OpenStreetMap with this scenario&apos;s city totals at each city centre. Ward-level transfers stay in the network view: the synthetic wards have no locations.</p>
        <SurgeMap d={d} city={city} onCity={setCity} /></div>}
  </div>);
}

const C_OCC = "#b4a6ff", C_MOVE = "#3fd3a5", C_SPARE = "#3a3e66", C_SHORT = "#ff6b72";   // Operations engine palette (dark panel)
const STRIPES = `repeating-linear-gradient(135deg, ${C_SHORT} 0 3px, rgba(255,107,114,.35) 3px 6px)`;
const STATUS: Record<string, [string, string]> = {
  unresolved: ["Unresolved overflow", "bg-[#ffe9ea] text-[#8f1d25]"], relieved: ["Overflow placed", "bg-[#e6f7ef] text-[#0b5d44]"],
  receiving: ["Receiving", "bg-[#efe7ff] text-[#3a1fa8]"], spare: ["Spare beds", "bg-[#eef3f1] text-[#2d4a3e]"], balanced: ["At capacity", "bg-[#f3f0ea] text-[#5e567f]"],
};
export const PRESETS = [{ value: 100, label: "Baseline" }, { value: 120, label: "+20% surge beds" }, { value: 130, label: "+30%" }, { value: 150, label: "+50%" }];

/** Occupied, transferred, spare and unresolved beds on one track; the tick marks configured capacity. */
function BedBar({ occupied, moved, spare, short, label }: { occupied: number; moved: number; spare: number; short: number; label: string }) {
  const total = Math.max(1, occupied + moved + spare + short), w = (n: number) => `${(100 * n) / total}%`;
  const seg = "h-full transition-[width] duration-700 ease-out motion-reduce:transition-none";
  return (<div role="img" aria-label={label} className="relative h-3.5 w-full overflow-hidden rounded-full bg-[#1c1f36]">
    <div className="flex h-full"><div className={seg} style={{ width: w(occupied), background: C_OCC }} /><div className={seg} style={{ width: w(moved), background: C_MOVE }} />
      <div className={seg} style={{ width: w(spare), background: C_SPARE }} /><div className={seg} style={{ width: w(short), background: STRIPES }} /></div>
    {short > 0 && <span aria-hidden className="absolute inset-y-0 w-[3px] bg-[#eef0ff]" style={{ left: `calc(${w(occupied + moved + spare)} - 1px)` }} />}</div>);
}

export default function HospitalSurge({ shared }: { shared: PlanShared }) {
  const { sel } = useSel();
  const { lang } = useI18n();
  const { city, setCity, service, setService, stock, capPct, setCapPct, overrides, setOverrides } = shared;
  const { blocked, notice } = useDecisionGuard();
  const p = useDebounced({ capPct, overrides, stock });
  const q = useAsync((s) => (blocked ? Promise.resolve(null) : api(`/api/overflow/plan?${qs({
    origin: sel.origin, horizon: sel.horizon, source: srcParam(sel), city: city === "All" ? undefined : city, service, capacity_pct: p.capPct,
    stock: p.stock / 100 })}${Object.entries(p.overrides).map(([k, v]) => `&override=${encodeURIComponent(`${k}:${v}`)}`).join("")}`, { signal: s })),
  [sel.origin, sel.horizon, sel.source, city, service, p, blocked]);
  const d: any = q.data;
  const { report } = shared;
  useEffect(() => { report("surge", d ? { totals: d.totals, capPct: d.settings.capacity_pct, stale: !!q.stale } : null); }, [d, q.stale, report]);
  const nOverrides = Object.keys(overrides).length;
  const setOverride = (w: string, v: string, base: number) => setOverrides((o) => {
    const n = Math.max(0, Math.min(500, Math.round(Number(v))));
    const next = { ...o };
    if (v === "" || !Number.isFinite(n) || n === base) delete next[w]; else next[w] = n;
    return next;
  });
  const exportCsv = () => d && download(`dengueshield_overflow_${d.origin}_h${d.horizon}_${d.city}_cap${d.settings.capacity_pct}.csv`, toCsv([
    ...d.transfers.map((t: any) => ({ kind: "transfer", city: t.city, from_ward: t.from_ward, to_ward: t.to_ward, patients: t.patients })),
    ...d.wards.map((w: any) => ({ kind: "ward", city: w.city, ward_id: w.ward_id, bed_demand: w.demand, capacity: w.capacity, capacity_baseline: w.capacity_baseline,
      overridden: w.overridden, deficit: w.deficit, headroom: w.headroom, sent: w.sent, received: w.received, unresolved: w.unresolved, status: w.status }))]));

  return (<Card id="surge" className="mt-5 scroll-mt-20" aria-labelledby="surge-title">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="surge-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Icon name="bed" size={18} className="text-coral-d" />Hospital surge and overflow</h2>
        <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-snug text-ink-3">Projected bed demand from the same forecast as Supply allocation, against an illustrative capacity for each ward. Patients over capacity move only to wards with spare beds in the same city.</p></div>
      <div className="flex flex-wrap items-center gap-2"><ProvChip tone="warn">Illustrative capacity</ProvChip><ProvChip tone="info">Same-city transfers only</ProvChip>{d && <Btn variant="ghost" onClick={exportCsv}>Export CSV</Btn>}</div>
    </div>

    {blocked ? notice : (<>
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-line p-4">
      <Select label="City" value={city} onChange={setCity} options={[{ value: "All", label: "All five cities" }, ...CITIES.map((c) => ({ value: c, label: c }))]} />
      <Segmented label="Plan for" value={service} onChange={(v) => setService(v as any)} options={[{ value: "median", label: "Median" }, { value: "p80", label: "Upper 80%" }, { value: "p90", label: "Upper 90%" }]} />
      <Segmented label="Capacity scenario" value={PRESETS.some((x) => x.value === capPct) ? capPct : -1} onChange={(v) => v >= 0 && setCapPct(v)} options={PRESETS} />
      <Range label="Ward capacity, % of baseline" value={capPct} min={0} max={300} step={5} onChange={setCapPct} fmt={(v) => `${v}%`} />
      {nOverrides > 0 && <Btn variant="ghost" onClick={() => setOverrides({})}>Clear {nOverrides} typed capacit{nOverrides === 1 ? "y" : "ies"}</Btn>}
    </div>

    <Live q={q} h={460} label="Hospital surge">{() => (<div>
      <p className="mt-4 text-[12.5px] text-ink-3">Forecast issued {dateFmt(d.origin, lang)} for the week of {dateFmt(d.target_date, lang)} at the {d.settings.service_label}. Baseline capacity: the 90th percentile of each ward's weekly bed need over the {d.capacity_rule.history_weeks} weeks before {dateFmt(d.origin, lang)}, at {d.settings.capacity_pct}%.</p>
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Projected bed demand" value={d.totals.demand} hint={`against ${d.totals.capacity} beds of illustrative capacity`} tone={d.totals.demand > d.totals.capacity ? "bad" : "ok"} />
        <Kpi label="Beds used after transfers" value={d.totals.utilization_after === null ? null : Math.round(d.totals.utilization_after * 100)} suffix="%" hint={`${d.totals.occupied_after} of ${d.totals.capacity} beds`} />
        <Kpi label="Patients transferred" value={d.totals.transferred} hint={`${d.totals.links} ward-to-ward assignment${d.totals.links === 1 ? "" : "s"}; ${d.totals.headroom} spare beds before`} tone="ok" />
        <Kpi label="No bed in own city" value={d.totals.unresolved} hint={d.totals.unresolved ? "unresolved overflow, needs action" : "every projected patient placed"} tone={d.totals.unresolved ? "bad" : "ok"} />
      </div>
      {d.totals.unresolved > 0 ? (<div role="alert" className="mt-4 flex gap-2 rounded-xl border-2 border-[#c2303a] bg-[#ffe9ea] p-3 text-[13px] text-[#8f1d25]"><Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        <div><b>{d.totals.unresolved} projected patient{d.totals.unresolved === 1 ? "" : "s"} without a bed in their own city</b>: {d.cities.filter((c: any) => c.unresolved > 0).map((c: any) => `${c.city} ${c.unresolved}`).join(", ")}.
          <span className="block text-[12px]">{d.totals.headroom === 0 ? "No ward in these cities has spare beds: the surge is city-wide, so moving patients between wards cannot help. Only more capacity can (try a surge scenario)." : "Spare beds in the same city were used first; transfers never cross cities."}</span></div></div>)
        : <div role="status" className="mt-4 flex gap-2 rounded-xl border border-line bg-[#e6f7ef] p-3 text-[13px] text-[#0b5d44]"><Icon name="check" size={16} className="mt-0.5 shrink-0" />Every projected patient has a bed in their own city{d.totals.transferred ? `, after ${d.totals.transferred} transfer${d.totals.transferred === 1 ? "" : "s"}` : ""}.</div>}

      <SurgeViews d={d} />

      <h3 className="mb-2 mt-5 text-[14px] font-semibold text-ink">Transfer assignments</h3>
      {d.transfers.length ? <DataTable dense maxH={280} rows={d.transfers} cols={[{ key: "city", label: "City" }, { key: "from_ward", label: "From ward (over capacity)" }, { key: "to_ward", label: "To ward (spare beds)" }, { key: "patients", label: "Patients", align: "right" }]} />
        : <p className="text-[13px] text-ink-3">No transfers in this scenario{d.totals.unresolved ? ": no ward in the over-capacity cities has a spare bed." : "."}</p>}

      <h3 className="mb-2 mt-5 text-[14px] font-semibold text-ink">Wards: capacity against demand</h3>
      <DataTable dense maxH={520} rows={d.wards} cols={[
        { key: "ward_id", label: "Ward", render: (w: any) => <span><b>{w.ward_id}</b><span className="block text-[11px] text-ink-3">{w.city}</span></span> },
        { key: "risk_tier", label: "Risk", render: (w: any) => <RiskBadge tier={w.risk_tier} size="sm" /> },
        { key: "demand", label: "Bed demand", align: "right", render: (w: any) => <span className="num"><b>{w.demand}</b><span className="block text-[11px] text-ink-3">median {w.bed_demand.median}, 90% {w.bed_demand.p90}</span></span> },
        { key: "capacity", label: "Capacity (editable)", align: "right", render: (w: any) => <span className="inline-flex flex-col items-end">
          <input type="number" inputMode="numeric" min={0} max={500} aria-label={`Capacity for ${w.ward_id}`} value={overrides[w.ward_id] ?? w.capacity}
            onChange={(e) => setOverride(w.ward_id, e.target.value, w.capacity)} className={"num h-9 w-16 rounded-lg border-2 px-2 text-right text-[13px] " + (w.ward_id in overrides ? "border-forest bg-mint-l" : "border-line bg-white")} />
          <span className="text-[11px] text-ink-3">{w.ward_id in overrides ? "typed" : `baseline ${w.capacity_baseline}`}</span></span> },
        { key: "bar", label: "Demand vs capacity", sort: (w: any) => w.deficit - w.headroom, render: (w: any) => <div className="w-32"><BedBar occupied={Math.min(w.demand, w.capacity)} moved={w.received} spare={w.headroom_after} short={w.unresolved}
          label={`${w.ward_id}: ${w.demand} needed, ${w.capacity} beds, ${w.sent} sent, ${w.received} received, ${w.unresolved} without a bed`} /></div> },
        { key: "deficit", label: "Over", align: "right", render: (w: any) => w.deficit ? <b className="text-coral-d">+{w.deficit}</b> : "0" },
        { key: "headroom", label: "Spare", align: "right" },
        { key: "sent", label: "Sent", align: "right" }, { key: "received", label: "Received", align: "right" },
        { key: "unresolved", label: "No bed", align: "right", render: (w: any) => w.unresolved ? <b className="text-coral-d">{w.unresolved}</b> : "0" },
        { key: "status", label: "Status", render: (w: any) => <span className={"inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold " + STATUS[w.status][1]}>{STATUS[w.status][0]}</span> }]} />

      <h3 className="mb-2 mt-5 text-[14px] font-semibold text-ink">Six bed numbers, kept apart</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        ["Projected bed demand", d.scenarios.projected_bed_demand, `From the forecast at the ${d.settings.service_label}; the same number Supply allocation uses.`],
        ["Illustrative ward capacity", d.scenarios.illustrative_capacity, `Past weekly bed need (90th percentile) at ${d.settings.capacity_pct}%${nOverrides ? ", with typed values" : ""}. Not a hospital inventory.`],
        ["Transferable headroom", d.scenarios.transferable_headroom, "Spare beds in wards below capacity, before any transfer."],
        ["Allocated transfers", d.scenarios.allocated_transfers, "Patients assigned to a ward with spare beds in the same city."],
        ["Unresolved shortage", d.scenarios.unresolved_shortage, "Patients still without a bed in their own city."],
        ["Regional bed supply scenario", d.scenarios.regional_supply_scenario, `Supply allocation's stock at ${Math.round(d.settings.stock * 100)}% of projected demand. Shown for comparison and never added to ward capacity: both describe the same beds.`],
      ].map(([t, v, s]) => (<div key={t as string} className="rounded-xl border border-line p-3"><div className="text-[12px] font-semibold text-ink-3">{t}</div><div className="num mt-1 text-[22px] font-extrabold text-ink">{v as number}</div><p className="mt-1 text-[12px] leading-snug text-ink-3">{s}</p></div>))}</div>

      <details className="mt-4 rounded-xl border border-line p-4 text-[13px] text-ink-2"><summary className="cursor-pointer font-semibold text-ink">How the overflow routing works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{d.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
        <p className="mt-2">Within each city the routing first places as many patients as possible (a maximum flow: the smaller of total overflow and total spare beds), then, among such plans, relieves the most overloaded ward first and fills the ward with the most spare beds first. The tests check it against brute force and an independent max-flow solver.</p></details>
    </div>)}</Live></>)}
  </Card>);
}
