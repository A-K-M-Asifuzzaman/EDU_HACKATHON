"use client";
// Season figure (DESIGN.md §4 charts, §1 "the issue line"). One ward, one season of out-of-time replay forecasts at the chosen horizon:
// 90% and 80% bands, the median, what was observed, the outbreak threshold, and weekly rainfall on the same time axis. The vertical
// issue line marks when the selected forecast was made; rain to its right had not happened yet and was never used by the model.
// Hand-built SVG so every label is typeset deliberately; pointer and arrow keys read any week; Enter or a click selects it.
import { useEffect, useMemo, useRef, useState } from "react";

export type SeriesRow = { origin_date: string; target_date: string; y_true: number | null; median: number; lo80: number; hi80: number; lo90: number; hi90: number; p_outbreak: number; thr_q90?: number };
type Rain = { date: string; rainfall_mm: number | null };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ms = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
const short = (d: string) => { const t = new Date(ms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
const WEEK = 7 * 864e5;
const nice = (v: number) => { const s = v <= 12 ? 4 : v <= 30 ? 10 : v <= 60 ? 20 : 50; return { top: Math.ceil(v / s) * s, step: s }; };

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null); const [w, setW] = useState(0);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  return [ref, w] as const;
}

export function SeasonFigure({ rows, rain, origin, target, horizon, threshold, onPick, caption }: {
  rows: SeriesRow[]; rain?: Rain[]; origin: string; target: string; horizon: number; threshold?: number | null; onPick?: (origin: string) => void; caption?: React.ReactNode }) {
  const [box, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const year = target.slice(0, 4);
  const view = useMemo(() => {
    const start = Math.min(ms(`${year}-05-01`), ms(target) - 10 * WEEK);
    return rows.filter((r) => ms(r.target_date) >= start).sort((a, b) => ms(a.target_date) - ms(b.target_date));
  }, [rows, target, year]);
  const sel = view.findIndex((r) => r.target_date === target);
  const narrow = W < 560;
  const m = { l: 30, r: narrow ? 10 : 18, t: 30 }, HC = Math.round(Math.min(300, Math.max(190, W * 0.34))), GAP = 40, HR = narrow ? 46 : 62, AX = 22;
  const H = m.t + HC + GAP + HR + AX;
  if (!view.length) return <div ref={box} className="h-[300px]" />;
  const x0 = ms(view[0].target_date), x1 = ms(view[view.length - 1].target_date);
  const X = (d: string) => m.l + ((ms(d) - x0) / Math.max(1, x1 - x0)) * (Math.max(W, 320) - m.l - m.r);
  const { top, step } = nice(Math.max(threshold ?? 0, ...view.map((r) => Math.max(r.hi90, r.y_true ?? 0))) * 1.08 + 1);
  const Y = (v: number) => m.t + HC - (v / top) * HC;
  const rainRows = (rain ?? []).filter((r) => ms(r.date) >= x0 - WEEK && ms(r.date) <= x1);
  const rTop = Math.max(10, ...rainRows.map((r) => r.rainfall_mm ?? 0));
  const R0 = m.t + HC + GAP, RY = (v: number) => R0 + HR - (v / rTop) * HR;
  const path = (k: (r: SeriesRow) => number) => view.map((r, i) => `${i ? "L" : "M"}${X(r.target_date).toFixed(1)},${Y(k(r)).toFixed(1)}`).join("");
  const band = (lo: (r: SeriesRow) => number, hi: (r: SeriesRow) => number) => path(hi) + view.slice().reverse().map((r) => `L${X(r.target_date).toFixed(1)},${Y(lo(r)).toFixed(1)}`).join("") + "Z";
  const xi = X(origin), xs = sel >= 0 ? X(view[sel].target_date) : null, bw = Math.max(3, (X(view[Math.min(1, view.length - 1)].target_date) - X(view[0].target_date)) * 0.7);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`).filter((d) => ms(d) >= x0 && ms(d) <= x1);
  const S = sel >= 0 ? view[sel] : null, hv = hover != null ? view[hover] : null;
  const rainAt = (d: string) => rainRows.find((r) => Math.abs(ms(r.date) - ms(d)) < 4 * 864e5)?.rainfall_mm;
  const read = hv ?? S;
  const nearest = (px: number) => { let b = 0, bd = Infinity; view.forEach((r, i) => { const d = Math.abs(X(r.target_date) - px); if (d < bd) { bd = d; b = i; } }); return b; };
  const labelRight = xs != null && xs < (W || 320) - 190;

  return (<figure className="m-0">
    <p className="mb-1 min-h-[20px] text-[12.5px] text-ink-2" aria-live="polite">
      {read && <><b className="font-semibold text-ink">Week of {short(read.target_date)}</b>: forecast {read.median} cases (80% range {read.lo80}-{read.hi80})
        {read.y_true != null && <>, observed {read.y_true}</>}{rainAt(read.target_date) != null && <>, rain {Math.round(rainAt(read.target_date)!)} mm</>}
        {hv && hv !== S && onPick && <span className="text-ink-3">. Select to see this forecast.</span>}</>}</p>
    <div ref={box} className="relative w-full select-none">
      {W > 0 && <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" tabIndex={0} className="block cursor-crosshair outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-emerald)]"
        aria-label={`Season ${year}, ${horizon} weeks ahead: weekly forecasts with 80 and 90 percent ranges, observed cases and weekly rainfall. Use the arrow keys to read a week and Enter to select it.`}
        onPointerMove={(e) => setHover(nearest(e.clientX - (e.currentTarget.getBoundingClientRect().left)))} onPointerLeave={() => setHover(null)}
        onClick={(e) => { const i = nearest(e.clientX - e.currentTarget.getBoundingClientRect().left); onPick?.(view[i].origin_date); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, Math.min(view.length - 1, (h ?? Math.max(0, sel)) + (e.key === "ArrowRight" ? 1 : -1)))); }
          else if (e.key === "Enter" && hover != null) onPick?.(view[hover].origin_date);
          else if (e.key === "Escape") setHover(null);
        }}>
        {/* cases: grid and scale */}
        {Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step).map((v) => (<g key={v}>
          <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--color-line)" />
          <text x={m.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-3)" className="num">{v}</text></g>))}
        <text x={m.l} y={m.t - 14} fontSize="11.5" fill="var(--color-ink-3)">Weekly dengue cases</text>
        {/* selected week */}
        {xs != null && <rect x={xs - bw / 2} y={m.t} width={bw} height={HC} fill="var(--color-ink)" opacity="0.06" />}
        {/* uncertainty and median */}
        <path className="sf-rise" d={band((r) => r.lo90, (r) => r.hi90)} fill="var(--color-emerald)" opacity="0.14" />
        <path className="sf-rise" style={{ animationDelay: ".12s" }} d={band((r) => r.lo80, (r) => r.hi80)} fill="var(--color-emerald)" opacity="0.26" />
        <path className="sf-draw" pathLength={1} d={path((r) => r.median)} fill="none" stroke="var(--color-emerald)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {/* outbreak threshold */}
        {threshold != null && <g><line x1={m.l} x2={W - m.r} y1={Y(threshold)} y2={Y(threshold)} stroke="var(--color-coral-d)" strokeDasharray="5 4" />
          <text x={W - m.r} y={Y(threshold) - 5} textAnchor="end" fontSize="11.5" fill="var(--color-coral-d)">outbreak threshold, {threshold} cases</text></g>}
        {/* observed counts: filled up to the issue date, hollow after it (known only later) */}
        <g className="sf-fade" style={{ animationDelay: ".9s" }}>{view.map((r) => r.y_true == null ? null : (ms(r.target_date) <= ms(origin)
          ? <circle key={r.target_date} cx={X(r.target_date)} cy={Y(r.y_true)} r="2.4" fill="var(--color-ink)" />
          : <circle key={r.target_date} cx={X(r.target_date)} cy={Y(r.y_true)} r="2.4" fill="var(--color-canvas)" stroke="var(--color-ink)" strokeWidth="1.2" />))}</g>
        {/* selected forecast annotation */}
        {S && xs != null && <g className="sf-fade" style={{ animationDelay: "1.3s" }}>
          <line x1={xs} x2={xs} y1={Y(S.hi80)} y2={Y(S.lo80)} stroke="var(--color-emerald)" strokeWidth="3" />
          <circle cx={xs} cy={Y(S.median)} r="4" fill="var(--color-emerald)" stroke="var(--color-canvas)" strokeWidth="1.5" />
          {S.y_true != null && <rect x={xs - 4} y={Y(S.y_true) - 4} width="8" height="8" transform={`rotate(45 ${xs} ${Y(S.y_true)})`} fill="var(--color-amber)" stroke="var(--color-ink)" strokeWidth="1" />}
          {!narrow && <text x={labelRight ? xs + 10 : xs - 10} y={Y(S.hi90) - 8} textAnchor={labelRight ? "start" : "end"} fontSize="12" fill="var(--color-ink)" fontWeight="600">
            {short(S.target_date)}: {S.median} cases{S.y_true != null ? `, observed ${S.y_true}` : ""}</text>}
        </g>}
        {/* the issue line */}
        <g style={{ transform: `translateX(${xi}px)`, transition: "transform .35s cubic-bezier(.2,.7,.2,1)" }}>
          <line x1={0} x2={0} y1={m.t - 6} y2={R0 + HR} stroke="var(--color-ink)" strokeWidth="1" />
          <text x={-4} y={m.t - 14} textAnchor="end" fontSize="11.5" fill="var(--color-ink)" fontWeight="600">issued {short(origin)}</text>
        </g>
        {/* rainfall on the same time axis */}
        <text x={m.l} y={R0 - 8} fontSize="11.5" fill="var(--color-ink-3)">Weekly rainfall, mm</text>
        <line x1={m.l} x2={W - m.r} y1={R0 + HR} y2={R0 + HR} stroke="var(--color-line)" />
        {rainRows.map((r, i) => { const v = r.rainfall_mm ?? 0, x = m.l + ((ms(r.date) - x0) / Math.max(1, x1 - x0)) * (W - m.l - m.r); if (x < m.l - 1 || x > W - m.r + 1) return null;
          return <rect key={r.date} className="sf-rise" style={{ animationDelay: `${0.2 + i * 0.012}s` }} x={x - bw / 2} y={RY(v)} width={bw} height={R0 + HR - RY(v)} rx="1" fill="var(--color-sky)" opacity={ms(r.date) <= ms(origin) ? 0.92 : 0.26} />; })}
        {!narrow && <text x={W - m.r} y={R0 - 8} textAnchor="end" fontSize="11.5" fill="var(--color-ink-3)">after the issue date: not yet fallen, never used</text>}
        {/* month axis */}
        {months.map((d) => <text key={d} x={X(d)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-ink-3)">{MON[Number(d.slice(5, 7)) - 1]}</text>)}
        {/* hover */}
        {hv && <line x1={X(hv.target_date)} x2={X(hv.target_date)} y1={m.t} y2={R0 + HR} stroke="var(--color-ink-2)" strokeDasharray="2 3" />}
      </svg>}
    </div>
    {caption && <figcaption className="mt-3 max-w-[68ch] text-[12.5px] leading-relaxed text-ink-3">{caption}</figcaption>}
    <details className="mt-2 text-[12.5px] text-ink-2"><summary className="cursor-pointer text-ink-3 hover:text-ink">Show the figure's data as a table</summary>
      <div className="scroll-thin mt-2 max-h-[280px] overflow-auto border-t border-line"><table className="num w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-canvas text-ink-3"><tr><th className="py-1 pr-3 font-semibold">Week of</th><th className="pr-3 font-semibold">Issued</th><th className="pr-3 text-right font-semibold">Median</th><th className="pr-3 text-right font-semibold">80% range</th><th className="pr-3 text-right font-semibold">90% range</th><th className="text-right font-semibold">Observed</th></tr></thead>
        <tbody>{view.map((r) => <tr key={r.target_date} className={r.target_date === target ? "bg-paper-3 font-semibold" : ""}><td className="py-0.5 pr-3">{short(r.target_date)}</td><td className="pr-3">{short(r.origin_date)}</td><td className="pr-3 text-right">{r.median}</td><td className="pr-3 text-right">{r.lo80}-{r.hi80}</td><td className="pr-3 text-right">{r.lo90}-{r.hi90}</td><td className="text-right">{r.y_true ?? ""}</td></tr>)}</tbody></table></div></details>
  </figure>);
}
