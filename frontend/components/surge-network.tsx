"use client";
// Stage 02, abstract mode: the ward transfer network. One cluster per city (patients never cross cities); each ward is a bed ledger
// drawn bottom-up: own patients, patients received, empty beds, then the overflow above its capacity line (moved out, then no bed).
// Edges are exactly the transfers GET /api/overflow/plan returned, thickness by patients. Ward positions are abstract (ID order):
// the synthetic wards have no coordinates, so nothing here is a map, a route or a travel time.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RiskBadge } from "./ui";

const C = { own: "#b4a6ff", recv: "#3fd3a5", slot: "#262a48", sent: "rgba(255,107,114,.42)", short: "#ff6b72", cap: "#eef0ff", edge: "#3fd3a5" };
const BASE = 30, MAXP = 46, GW = 16, ARC = 30, LABEL = 18, PAD = 12, GAP = 12;
const STATE: Record<string, string> = { unresolved: "Unresolved shortage", relieved: "Deficit, overflow placed", receiving: "Receiving patients", spare: "Spare beds", balanced: "Fully used" };

type Pt = { x: number; y0: number; w: any };

export default function SurgeNetwork({ d, cityPick, onCity }: { d: any; cityPick: string | null; onCity: (c: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {                                   // re-layout only when the panel is resized (no timers, no polling)
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const [pick, setPick] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // the previous scenario's per-city outcome, kept as derived state so the comparison survives unrelated re-renders
  const [hist, setHist] = useState<{ cur: any; prev: any }>({ cur: null, prev: null });
  if (hist.cur !== d) setHist({ cur: d, prev: hist.cur });
  const prev = hist.prev;

  const maxStack = Math.max(1, ...d.wards.map((w: any) => Math.max(w.capacity, w.demand)));
  const unit = Math.max(2, Math.min(12, Math.floor(132 / maxStack)));
  const H = maxStack * unit, rowH = ARC + H + LABEL;
  const clusters = useMemo(() => d.cities.map((c: any) => ({ ...c, wards: d.wards.filter((w: any) => w.city === c.city).sort((a: any, b: any) => a.ward_id.localeCompare(b.ward_id)),
    transfers: d.transfers.filter((t: any) => t.city === c.city) })), [d]);
  // greedy rows: each cluster asks for BASE px per ward; a row's spare width is shared in proportion, so columns stay comparable
  const layout = useMemo(() => {
    const out = new Map<string, { w: number; cols: number; pitch: number }>();
    if (!width) return out;
    const base = width < 480 ? 26 : BASE;
    const need = (c: any) => c.wards.length * base + 2 * PAD;
    let row: any[] = [], used = 0;
    const flush = () => {
      const sum = row.reduce((a, c) => a + need(c), 0), extra = Math.max(0, width - sum - GAP * (row.length - 1));
      row.forEach((c) => {
        const w = Math.min(width, need(c) + (extra * need(c)) / sum), fit = Math.max(1, Math.floor((w - 2 * PAD) / base));
        const cols = Math.ceil(c.wards.length / Math.ceil(c.wards.length / fit));     // balanced rows: 20 wards in 19 slots become 2 rows of 10
        const pitch = Math.min(MAXP, (w - 2 * PAD) / cols);
        out.set(c.city, { w, cols, pitch });
      });
      row = []; used = 0;
    };
    clusters.forEach((c: any) => { if (row.length && used + GAP + need(c) > width) flush(); used += (row.length ? GAP : 0) + need(c); row.push(c); });
    if (row.length) flush();
    return out;
  }, [clusters, width]);
  const order: any[] = useMemo(() => clusters.flatMap((c: any) => c.wards), [clusters]);
  const byId = useMemo(() => new Map(order.map((w) => [w.ward_id, w])), [order]);
  const sel = byId.get(hover ?? "") ?? byId.get(pick ?? "") ?? order.find((w) => w.unresolved > 0 || w.sent > 0) ?? order[0];
  const city = cityPick ? clusters.find((c: any) => c.city === cityPick) : null;

  const onKey = (e: KeyboardEvent, w: any) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPick(w.ward_id); onCity(null); return; }
    const i = order.indexOf(w), n = order.length;
    const j = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const t = order[Math.max(0, Math.min(n - 1, j))];
    setPick(t.ward_id); onCity(null);
    document.getElementById(`sn-${t.ward_id}`)?.focus();
  };
  const dlt = (a: number, b: number | undefined) => (b === undefined || a === b ? null : <span className={"num ml-1 text-[11px] font-bold " + (a > b ? "text-ink" : "text-ink-3")}>{a > b ? "+" : "−"}{Math.abs(a - b)}</span>);

  return (<section className="mt-3" aria-labelledby="sn-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 id="sn-title" className="text-[14px] font-semibold text-ink">Ward transfer network</h3>
        <p className="mt-0.5 max-w-[72ch] text-[12.5px] text-ink-3">Each column is one ward&apos;s beds, one cell per bed. Arcs are the patients the plan moves to a ward with spare beds in the same city. Positions follow ward IDs only: these synthetic wards have no locations.</p></div>
      {prev && prev !== d && (<p className="num text-[12px] text-ink-3" data-testid="surge-delta">Against the previous setting: moved {d.totals.transferred}{dlt(d.totals.transferred, prev.totals.transferred)}, no bed {d.totals.unresolved}{dlt(d.totals.unresolved, prev.totals.unresolved)}</p>)}
    </div>

    <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div ref={box} className="min-w-0">
        <div className="flex flex-wrap gap-3">{width > 0 && clusters.map((c: any) => {
          const L = layout.get(c.city); if (!L) return null;
          const { cols, pitch } = L, rows = Math.ceil(c.wards.length / cols), W = Math.round(cols * pitch + 2 * PAD), Hh = rows * rowH + 6;
          const pts = new Map<string, Pt>(c.wards.map((w: any, i: number) => [w.ward_id, { x: PAD + (i % cols) * pitch + (pitch - GW) / 2, y0: Math.floor(i / cols) * rowH + ARC + H, w }]));
          const pc = prev?.cities.find((x: any) => x.city === c.city);
          const zero = c.transferred === 0 && c.unresolved > 0 ? (c.headroom === 0 ? `No ward in ${c.city} has a spare bed, so no patient can move.` : "Spare beds exist but none could take these patients.") : c.deficit === 0 ? "Every ward is within its beds." : null;
          return (<div key={c.city} className={"ops-panel min-w-0 p-0 " + (cityPick === c.city ? "ring-1 ring-[#9ea3c9]" : "")} style={{ width: Math.floor(L.w) }}>
            <button type="button" onClick={() => { onCity(c.city); setPick(null); }} aria-pressed={cityPick === c.city}
              className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-t-[14px] px-3 pb-1 pt-2.5 text-left hover:bg-[#1c1f36]">
              <b className="text-[13.5px] text-ink">{c.city}</b>
              <span className="num text-[12px] text-ink-2">{c.demand} need / {c.capacity} beds
                {c.transferred > 0 && <>, <b className="text-ink">{c.transferred} moved</b>{dlt(c.transferred, pc?.transferred)}</>}
                {c.unresolved > 0 ? <>, <b className="text-coral-d">{c.unresolved} no bed</b>{dlt(c.unresolved, pc?.unresolved)}</> : pc?.unresolved ? <>, <b className="text-ink">all placed</b></> : null}</span>
            </button>
            <svg width="100%" viewBox={`0 0 ${W} ${Hh}`} style={{ maxWidth: W, display: "block" }} role="group" aria-label={`${c.city} ward network, ${c.transfers.length} transfer link${c.transfers.length === 1 ? "" : "s"}`}>
              <defs><marker id={`sn-head-${c.city.replace(/\W/g, "")}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill={C.edge} /></marker></defs>
              {c.wards.map((w: any) => { const p = pts.get(w.ward_id)!; return <Ledger key={w.ward_id} p={p} unit={unit} on={w === sel && !city} onPick={() => { setPick(w.ward_id); onCity(null); }}
                onHover={setHover} onKey={onKey} focusable={w === sel} />; })}
              {c.transfers.map((t: any) => {
                const a = pts.get(t.from_ward), b = pts.get(t.to_ward);
                if (!a || !b) return null;
                const sx = a.x + GW / 2, sy = a.y0 - Math.max(a.w.capacity, a.w.demand) * unit - 3, ex = b.x + GW / 2, ey = b.y0 - b.w.capacity * unit - 4;
                const cy = Math.min(sy, ey) - 12 - Math.min(16, Math.abs(ex - sx) * 0.12), mx = (sx + ex) / 2;
                const live = sel && (t.from_ward === sel.ward_id || t.to_ward === sel.ward_id);
                return (<g key={`${t.from_ward}>${t.to_ward}:${t.patients}`} opacity={sel && !live && !city ? 0.35 : 1}>
                  <path className="ops-draw" pathLength={1} d={`M${sx} ${sy} Q${mx} ${cy} ${ex} ${ey}`} fill="none" stroke={C.edge} strokeWidth={Math.min(7, 1.25 + t.patients)} strokeLinecap="round"
                    markerEnd={`url(#sn-head-${c.city.replace(/\W/g, "")})`} />
                  <text x={mx} y={(sy + 2 * cy + ey) / 4 - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#eef0ff" stroke="#151729" strokeWidth="3" paintOrder="stroke">{t.patients}</text></g>);
              })}
            </svg>
            {zero && <p className="px-3 pb-2.5 text-[12px] text-ink-3">{zero}</p>}
          </div>);
        })}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">{[[C.own, "Own patients"], [C.recv, "Received from another ward"], [C.slot, "Empty bed"], [C.sent, "Over beds, moved out"], [C.short, "Over beds, no bed in city"]].map(([c, t]) => (
          <span key={t} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />{t}</span>))}
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-[2px] w-3 bg-[#eef0ff]" />Bed line</span></div>
        <p className="mt-1 text-[11.5px] text-ink-3">Arrow keys move between wards; Enter selects. The tables below list every link and ward.</p>
      </div>

      <aside aria-live="polite" aria-label="Network inspector" className="ops-panel h-fit p-4 lg:sticky lg:top-[calc(var(--ops-top,108px)+112px)]">
        {city ? <CityCard c={city} /> : sel ? <WardCard w={sel} d={d} /> : null}
      </aside>
    </div>
  </section>);
}

function Ledger({ p, unit, on, onPick, onHover, onKey, focusable }: { p: Pt; unit: number; on: boolean; onPick: () => void; onHover: (id: string | null) => void; onKey: (e: KeyboardEvent, w: any) => void; focusable: boolean }) {
  const { x, y0, w } = p;
  const own = Math.min(w.demand, w.capacity), over = Math.max(0, w.demand - w.capacity), stack = Math.max(w.capacity, w.demand);
  // one rect per segment, one bed tall, grown by transform: translate to its start, scale to its count (transitions are transform-only)
  const seg = (start: number, n: number, fill: string) => <rect className="ops-seg" x={x} y={y0 - unit} width={GW} height={unit} fill={fill}
    style={{ transform: `translateY(${-start * unit}px) scaleY(${n})` }} />;
  const num = w.ward_id.replace(/^.*_/, "");
  return (<g id={`sn-${w.ward_id}`} role="button" tabIndex={focusable ? 0 : -1} aria-pressed={on} onClick={onPick} onKeyDown={(e) => onKey(e, w)} onMouseEnter={() => onHover(w.ward_id)} onMouseLeave={() => onHover(null)}
    aria-label={`${w.ward_id}: ${w.demand} need, ${w.capacity} beds, ${w.sent} moved out, ${w.received} received, ${w.unresolved} with no bed`} className="cursor-pointer outline-none">
    <rect x={x - 6} y={y0 - stack * unit - 8} width={GW + 12} height={stack * unit + 8 + LABEL} rx={5} fill={on ? "#232745" : "transparent"} stroke={on ? "#9ea3c9" : "none"} />
    {seg(0, w.capacity, C.slot)}
    {seg(0, own, C.own)}
    {seg(own, w.received, C.recv)}
    {seg(w.capacity, w.sent, C.sent)}
    {seg(w.capacity + w.sent, w.unresolved, C.short)}
    {unit >= 5 && Array.from({ length: stack - 1 }, (_, k) => <line key={k} x1={x} x2={x + GW} y1={y0 - (k + 1) * unit} y2={y0 - (k + 1) * unit} stroke="#151729" strokeWidth={1.5} />)}
    <line className="ops-mark" x1={x - 3} x2={x + GW + 3} y1={y0} y2={y0} stroke={C.cap} strokeWidth={2} style={{ transform: `translateY(${-w.capacity * unit}px)` }} />
    {over === 0 && w.capacity === 0 && <text x={x + GW / 2} y={y0 - 3} textAnchor="middle" fontSize="9" fill="#9ea3c9">0</text>}
    <text x={x + GW / 2} y={y0 + 13} textAnchor="middle" fontSize="11" fontWeight={on ? 800 : 600} fill={w.unresolved > 0 ? "#ff9a9f" : on ? "#eef0ff" : "#9ea3c9"}>{num}</text>
  </g>);
}

function WardCard({ w, d }: { w: any; d: any }) {
  const out = d.transfers.filter((t: any) => t.from_ward === w.ward_id), inn = d.transfers.filter((t: any) => t.to_ward === w.ward_id);
  const rows: [string, React.ReactNode][] = [["Projected need", w.demand], ["Beds", <>{w.capacity}{w.overridden ? " (typed)" : w.capacity !== w.capacity_baseline ? ` (baseline ${w.capacity_baseline})` : ""}</>],
    ["Over beds", w.deficit], ["Moved out", w.sent], ["Received", w.received], ["Spare after moves", w.headroom_after], ["No bed in city", <b key="u" className={w.unresolved ? "text-coral-d" : ""}>{w.unresolved}</b>]];
  return (<div>
    <div className="flex items-start justify-between gap-2"><div><div className="text-[12px] text-ink-3">{w.city}</div>
      <div className="font-display text-[22px] font-extrabold leading-tight text-ink">{w.ward_id}</div></div><RiskBadge tier={w.risk_tier} size="sm" /></div>
    <p className="mt-1 text-[12.5px] font-semibold text-ink-2">{STATE[w.status]}</p>
    <dl className="num mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">{rows.flatMap(([k, v]) => [<dt key={`k${k}`} className="text-ink-3">{k}</dt>, <dd key={`v${k}`} className="text-right text-ink">{v}</dd>])}</dl>
    {(out.length > 0 || inn.length > 0) && (<ul className="mt-3 grid gap-1 border-t border-line pt-3 text-[12.5px] text-ink-2">
      {out.map((t: any) => <li key={`o${t.to_ward}`}><b className="text-ink">{t.patients}</b> to {t.to_ward}</li>)}
      {inn.map((t: any) => <li key={`i${t.from_ward}`}><b className="text-ink">{t.patients}</b> from {t.from_ward}</li>)}</ul>)}
    <p className="mt-3 text-[11.5px] leading-snug text-ink-3">Bed numbers are illustrative: past weekly bed need, not a hospital inventory.</p>
  </div>);
}

function CityCard({ c }: { c: any }) {
  const rows: [string, React.ReactNode][] = [["Projected need", c.demand], ["Beds", c.capacity], ["Spare before moves", c.headroom], ["Moved", c.transferred],
    ["Links", c.links], ["Beds used after", c.utilization_after === null ? "no beds" : `${Math.round(c.utilization_after * 100)}%`], ["No bed in city", <b key="u" className={c.unresolved ? "text-coral-d" : ""}>{c.unresolved}</b>]];
  return (<div><div className="text-[12px] text-ink-3">{c.wards.length} wards, {c.senders} over beds, {c.receivers} receiving</div>
    <div className="font-display text-[22px] font-extrabold leading-tight text-ink">{c.city}</div>
    <dl className="num mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">{rows.flatMap(([k, v]) => [<dt key={`k${k}`} className="text-ink-3">{k}</dt>, <dd key={`v${k}`} className="text-right text-ink">{v}</dd>])}</dl></div>);
}
