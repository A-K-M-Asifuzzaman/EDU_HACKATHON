"use client";
// Stage 01 instrument: where the regional stock goes. Each lane is one stock pool (stock never crosses pools); its wards stand in
// priority order, each column as tall as its need, filled by what it was allocated, with the unfilled part hatched. Every number is a
// field of GET /api/allocation/plan; nothing here is computed beyond ratios for drawing.
import { useMemo, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { pct } from "@/lib/format";
import { RiskBadge } from "./ui";

const RES = [
  { k: "saline_bags_needed", label: "Saline", unit: "bags", color: "var(--res-saline)" },
  { k: "diagnostic_kits_needed", label: "Kits", unit: "kits", color: "var(--res-kits)" },
  { k: "hospital_beds_required", label: "Beds", unit: "beds", color: "var(--res-beds)" },
] as const;
type ResKey = (typeof RES)[number]["k"];
const STATUS: Record<string, string> = { met: "Fully supplied", deficit: "Short", critical: "Critical deficit" };

export default function AllocationFlow({ d }: { d: any }) {
  const { lang } = useI18n();
  const [res, setRes] = useState<ResKey>("saline_bags_needed");
  const [pick, setPick] = useState<string | null>(null);
  const r = RES.find((x) => x.k === res)!;
  const lanes = useMemo(() => d.cities.map((c: any) => ({ ...c, wards: d.wards.filter((w: any) => w.city === c.city).sort((a: any, b: any) => a.rank - b.rank) })), [d]);
  const order: any[] = useMemo(() => lanes.flatMap((l: any) => l.wards), [lanes]);
  const max = Math.max(1, ...d.wards.map((w: any) => w[res].demand));
  const floor = d.settings.floor, maxCrews = d.settings.max_crews_per_ward;
  const sel = order.find((w) => w.ward_id === pick) ?? order.find((w) => w.status === "critical") ?? order[0];

  const onKey = (e: KeyboardEvent) => {
    const i = order.indexOf(sel), n = order.length;
    const j = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const w = order[Math.max(0, Math.min(n - 1, j))];
    setPick(w.ward_id);
    document.getElementById(`af-${w.ward_id}`)?.focus();
  };

  return (<section className="mt-5" aria-labelledby="af-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 id="af-title" className="text-[14px] font-semibold text-ink">Where the stock goes</h3>
        <p className="mt-0.5 max-w-[70ch] text-[12.5px] text-ink-3">One lane per stock pool, wards in priority order. Column height is the ward&apos;s need, the solid part what it received; stock fills the highest priority first.</p></div>
      <div role="group" aria-label="Resource shown" className="flex flex-wrap gap-1.5">{RES.map((x) => (
        <button key={x.k} type="button" aria-pressed={res === x.k} onClick={() => setRes(x.k)} className="ops-chip gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />{x.label}</button>))}</div>
    </div>

    <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid content-start gap-3"><div className="flex flex-wrap gap-3">{lanes.map((c: any) => {
        const t = c[res], fill = t.demand ? t.allocated / t.demand : 1;
        // lane width follows ward count, so every ward column has the same width in every pool
        return (<div key={c.city} className="ops-panel min-w-0 p-3" style={{ flex: `${c.wards.length} 1 ${c.wards.length * 32}px` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <b className="text-[13.5px] text-ink">{c.city}</b>
            <span className="num text-[12.5px] text-ink-2"><b className="text-ink">{t.allocated}</b> of {t.demand} {r.unit} placed{t.unmet > 0 && <b className="ml-1.5 text-coral-d">{t.unmet} short</b>}</span>
          </div>
          {/* the pool: supply against the pool's need; the conservation line restates the API's own arithmetic */}
          <div className="relative mt-2 h-2 overflow-hidden rounded-full ops-hatch" role="img" aria-label={`${c.city} pool: ${t.supply} ${r.unit} supplied for ${t.demand} needed`}>
            <span className="ops-growx absolute inset-0 rounded-full" style={{ background: r.color, transform: `scaleX(${Math.min(1, fill)})` }} /></div>
          <p className="num mt-1 text-[11.5px] text-ink-3">Pool {t.supply} = {t.allocated} placed + {t.surplus} left over{t.supply === t.allocated + t.surplus ? "" : " (does not add up)"}</p>

          <div role="group" aria-label={`${c.city} wards by priority`} className="mt-2 flex items-end gap-[3px]">{c.wards.map((w: any, i: number) => {
            const x = w[res], on = w === sel;
            return (<button key={w.ward_id} id={`af-${w.ward_id}`} type="button" tabIndex={on ? 0 : -1} aria-pressed={on} onClick={() => setPick(w.ward_id)} onKeyDown={onKey}
              aria-label={`${w.ward_id}, priority ${w.rank}: ${x.allocated} of ${x.demand} ${r.unit}${x.unmet ? `, ${x.unmet} short` : ""}; crews ${w.crews_assigned} of ${w.crews_needed}`}
              className={"group flex min-w-0 max-w-[40px] flex-1 flex-col items-center gap-1 rounded-md px-px pb-1 pt-1 " + (on ? "bg-[#232745] ring-1 ring-[#9ea3c9]" : "hover:bg-[#1c1f36]")}>
              <span className="relative block h-14 w-full overflow-hidden rounded-[3px] bg-[#1c1f36] sm:h-[72px]">
                <span className="ops-grow ops-hatch absolute inset-0 rounded-[3px]" style={{ transform: `scaleY(${x.demand / max})`, ["--i" as any]: w.rank }} />
                <span className="ops-grow absolute inset-0 rounded-[3px]" style={{ background: r.color, transform: `scaleY(${x.allocated / max})`, ["--i" as any]: w.rank }} />
                {floor > 0 && x.demand > 0 && <span aria-hidden className="ops-grow absolute inset-0" style={{ transform: `translateY(${-100 * (floor * x.demand) / max}%)` }}><span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#eef0ff]" /></span>}
              </span>
              <span aria-hidden className="flex min-h-[5px] flex-wrap justify-center gap-[2px]">{Array.from({ length: Math.min(maxCrews, Math.max(w.crews_needed, w.crews_assigned)) }, (_, k) => (
                <span key={k} className="h-[5px] w-[5px] rounded-full" style={k < w.crews_assigned ? { background: "var(--res-crews)" } : { boxShadow: "inset 0 0 0 1px var(--res-crews)" }} />))}</span>
            </button>);
          })}</div>
        </div>);
      })}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm" style={{ background: r.color }} />Allocated</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="ops-hatch h-2.5 w-4 rounded-sm" />Still needed</span>
          {floor > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-[2px] w-4 bg-[#eef0ff]" />Fairness floor ({Math.round(floor * 100)}% of need)</span>}
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-[6px] w-[6px] rounded-full" style={{ background: "var(--res-crews)" }} />Crew assigned</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-[6px] w-[6px] rounded-full" style={{ boxShadow: "inset 0 0 0 1px var(--res-crews)" }} />Crew still needed</span>
        </div>
        <p className="text-[11.5px] text-ink-3">Arrow keys move between wards. The tables below list the same numbers.</p>
      </div>

      {sel && (<aside aria-live="polite" aria-label="Selected ward" className="ops-panel h-fit p-4 lg:sticky lg:top-[calc(var(--ops-top,108px)+112px)]">
        <div className="flex items-start justify-between gap-2"><div><div className="text-[12px] text-ink-3">{sel.city}, priority {sel.rank} of {order.length}</div>
          <div className="font-display text-[22px] font-extrabold leading-tight text-ink">{sel.ward_id}</div></div><RiskBadge tier={sel.risk_tier} size="sm" /></div>
        <dl className="num mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-ink-3">Forecast cases</dt><dd className="text-right text-ink">{sel.forecast_cases}</dd>
          <dt className="text-ink-3">Outbreak chance</dt><dd className="text-right text-ink">{pct(sel.p_outbreak, lang)}</dd>
          <dt className="text-ink-3">Priority score</dt><dd className="text-right text-ink">{sel.priority.toFixed(3)}</dd>
          <dt className="text-ink-3">Density /km²</dt><dd className="text-right text-ink">{sel.population_density_sqkm.toLocaleString("en")}</dd></dl>
        <div className="mt-3 grid gap-2.5">{RES.map((x) => { const v = sel[x.k]; return (<div key={x.k}>
          <div className="num flex justify-between text-[12.5px]"><span className="text-ink-2">{x.label}</span><span className="text-ink"><b>{v.allocated}</b> / {v.demand}{v.unmet > 0 && <b className="ml-1 text-coral-d">−{v.unmet}</b>}</span></div>
          <div className="ops-hatch relative mt-1 h-1.5 overflow-hidden rounded-full"><span className="ops-growx absolute inset-0" style={{ background: x.color, transform: `scaleX(${v.demand ? v.allocated / v.demand : 1})` }} /></div></div>); })}
          <div className="num flex justify-between text-[12.5px]"><span className="text-ink-2">Spraying crews</span><span className="text-ink"><b>{sel.crews_assigned}</b> / {sel.crews_needed}</span></div></div>
        <p className={"mt-3 inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold " + (sel.status === "critical" ? "bg-[#ffe9ea] text-[#8f1d25]" : sel.status === "deficit" ? "bg-[#fff1cc] text-[#6b4a00]" : "bg-[#d9f7ea] text-[#0b5d44]")}>{STATUS[sel.status]}</p>
      </aside>)}
    </div>
  </section>);
}
