"use client";
// Rain → risk instrument (the landing's signature visual). One time axis, two tiers, all real data:
//   lower tier: weekly rainfall observed up to the issue date (organizer weather), the three weeks the model reads for the chosen horizon
//               (bracketed), and, for weeks that had not fallen yet, the typical rain for that week (dashed), which is what the model uses;
//   upper tier: reported cases up to the issue date, then the 2, 3 and 4-week forecasts from /api/forecast/compare as uncertainty candles
//               (90% thin, 80% thick, median tick) with the count observed later (diamond) and the ward's outbreak threshold.
// Sequence on first view: rain falls, the issue line draws, the forecasts rise. Static under reduced motion. Candles are buttons.
import { useWidth } from "./season-figure";

type Fc = { horizon: number; target_date: string; median_cases: number; lower_80: number; upper_80: number; lower_90: number; upper_90: number; actual_cases: number | null; outbreak_threshold: number | null; p_outbreak: number };
type Rain = { date: string; rainfall_mm: number | null };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ms = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const short = (d: string) => { const t = new Date(ms(d)); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
const isoWeek = (d: string) => { const t = new Date(ms(d)); const t0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return Math.min(52, Math.ceil(((+t - +t0) / 864e5 + t0.getUTCDay() + 1) / 7)); };
const WK = 7 * 864e5, BEFORE = 9;

export function RainRisk({ origin, horizon, fcs, rain, clim, cases, onHorizon }: {
  origin: string; horizon: number; fcs: Fc[]; rain: Rain[]; clim?: Record<string, number>; cases: { target_date: string; y_true: number | null }[]; onHorizon: (h: number) => void }) {
  const [box, W0] = useWidth<HTMLDivElement>();
  const W = Math.max(W0, 300), narrow = W < 520;
  const H = narrow ? 250 : 290, padL = 6, padR = 6, n = BEFORE + 5;
  const split = padL + (W - padL - padR) * 0.5, sp = (split - padL) / (BEFORE + 1), sf = (W - padR - split) / 4.4;   // past weeks compressed, forecast side wide
  const o = ms(origin), X = (i: number) => (i <= 0 ? padL + (i + BEFORE + 0.5) * sp : split + (i - 0.35) * sf);   // slot centre for week offset i (-9..+4)
  const sw = sp;
  const RB = H - 22, RH = narrow ? 54 : 66;                                                 // rain tier baseline and height
  const CT = 30, CB = RB - RH - 34;                                                        // cases tier top and bottom
  const sel = fcs.find((f) => f.horizon === horizon);
  const thr = fcs[0]?.outbreak_threshold ?? null;
  const pastCases = Array.from({ length: BEFORE + 1 }, (_, k) => { const d = iso(o - (BEFORE - k) * WK); return { i: k - BEFORE, y: cases.find((c) => c.target_date === d)?.y_true ?? null }; });
  const yMax = Math.max(thr ?? 0, ...fcs.map((f) => Math.max(f.upper_90, f.actual_cases ?? 0)), ...pastCases.map((c) => c.y ?? 0)) * 1.1 + 1;
  const Y = (v: number) => CB - (v / yMax) * (CB - CT);
  const weeks = Array.from({ length: n }, (_, k) => { const i = k - BEFORE, d = iso(o + i * WK); const r = rain.find((x) => Math.abs(ms(x.date) - (o + i * WK)) < 3.5 * 864e5);
    return { i, d, obs: i <= 0 && r?.rainfall_mm != null ? r.rainfall_mm : null, typ: clim?.[String(isoWeek(d))] ?? null }; });
  const rMax = Math.max(20, ...weeks.map((w) => Math.max(w.obs ?? 0, w.typ ?? 0)));
  const RY = (v: number) => RB - (v / rMax) * RH;
  const win = [horizon - 4, horizon - 3, horizon - 2];                                     // rain weeks read by the model, relative to the issue week
  const bw = Math.max(4, sp * 0.58), bwf = Math.max(6, sf * 0.3);
  const xi = split;                                                                         // issue line between week 0 and week +1

  return (<div ref={box} className="relative w-full">
    {W0 > 0 && <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" role="group" aria-label={`Rain and risk for the forecast issued ${short(origin)}: weekly rain observed before it, and the forecasts for 2, 3 and 4 weeks ahead with their 80 and 90 percent ranges.`}>
      {/* tier labels */}
      <text x={padL} y={14} fontSize="11.5" fill="var(--color-ink-3)">Reported cases</text>
      <text x={xi + 8} y={14} fontSize="11.5" fill="var(--color-ink-3)">Forecast, 2 to 4 weeks ahead</text>
      <text x={padL} y={RB - RH - 12} fontSize="11.5" fill="var(--color-ink-3)">Weekly rain, mm</text>
      {/* outbreak threshold across the forecast side */}
      {thr != null && <g className="sf-fade" style={{ animationDelay: "1.4s" }}><line x1={padL} x2={W - padR} y1={Y(thr)} y2={Y(thr)} stroke="var(--color-coral)" strokeDasharray="4 4" strokeWidth="1.2" opacity="0.85" />
        <text x={padL} y={Y(thr) - 5} fontSize="11" fill="var(--color-coral-d)">outbreak threshold, {thr} cases</text></g>}
      {/* past reported cases */}
      <g className="sf-fade" style={{ animationDelay: ".7s" }}>
        <polyline points={pastCases.filter((c) => c.y != null).map((c) => `${X(c.i)},${Y(c.y!)}`).join(" ")} fill="none" stroke="var(--color-ink-3)" strokeWidth="1.2" />
        {pastCases.map((c) => c.y == null ? null : <circle key={c.i} cx={X(c.i)} cy={Y(c.y)} r="2.8" fill="var(--color-ink)" />)}</g>
      {/* rain window bracket */}
      <g className="sf-fade" style={{ animationDelay: ".9s" }}>
        <path d={`M${X(win[0]) - (win[0] <= 0 ? bw : bwf) / 2 - 3},${RB - RH - 2} v-6 H${X(win[2]) + (win[2] <= 0 ? bw : bwf) / 2 + 3} v6`} fill="none" stroke="var(--color-sky)" strokeWidth="1.5" />
        {!narrow && <text x={(X(win[0]) + X(win[2])) / 2} y={RB - RH - 12} textAnchor="middle" fontSize="11" fill="var(--color-sky-d)">rain read for {horizon} weeks</text>}</g>
      {/* rain bars */}
      <line x1={padL} x2={W - padR} y1={RB} y2={RB} stroke="var(--color-line)" />
      {weeks.map((w, k) => { const inWin = win.includes(w.i), x = X(w.i) - bw / 2;
        if (w.obs != null) return <rect key={w.d} className="sf-rise" style={{ animationDelay: `${0.05 * k}s` }} x={x} y={RY(w.obs)} width={bw} height={Math.max(1, RB - RY(w.obs))} rx="1.5" fill="var(--color-sky)" opacity={inWin ? 1 : 0.42} />;
        if (w.i > 0 && inWin && w.typ != null) return <rect key={w.d} className="sf-fade" style={{ animationDelay: "1s" }} x={X(w.i) - bwf / 2} y={RY(w.typ)} width={bwf} height={Math.max(1, RB - RY(w.typ))} rx="1.5" fill="none" stroke="var(--color-sky)" strokeDasharray="3 2" />;
        return null; })}
      {/* week labels */}
      {weeks.map((w) => (w.i % 3 === 0 || w.i === horizon) && <text key={"l" + w.d} x={X(w.i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill={w.i === horizon ? "var(--color-ink)" : "var(--color-ink-3)"} fontWeight={w.i === horizon ? 600 : 400}>{short(w.d)}</text>)}
      {/* the issue line */}
      <g className="sf-fade" style={{ animationDelay: ".55s" }}>
        <line x1={xi} x2={xi} y1={20} y2={RB} stroke="var(--color-ink)" strokeWidth="1" />
        <text x={xi - 6} y={RB - RH - 26} textAnchor="end" fontSize="11.5" fontWeight="600" fill="var(--color-ink)">issued {short(origin)}</text></g>
      {/* forecast candles */}
      {fcs.map((f, k) => { const x = X(f.horizon), on = f.horizon === horizon;
        return (<g key={f.horizon} role="button" tabIndex={0} aria-pressed={on} aria-label={`${f.horizon} weeks ahead, week of ${short(f.target_date)}: median ${f.median_cases} cases, 80% range ${f.lower_80} to ${f.upper_80}`}
          onClick={() => onHorizon(f.horizon)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onHorizon(f.horizon); } }}
          className="sf-rise cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-[var(--color-emerald)]" style={{ animationDelay: `${1.05 + k * 0.14}s` }} opacity={on ? 1 : 0.5}>
          <rect x={x - sf * 0.42} y={CT - 6} width={sf * 0.84} height={CB - CT + 12} fill={on ? "var(--color-emerald)" : "transparent"} fillOpacity="0.07" stroke="transparent" strokeWidth="1.5" rx="3" />
          <line x1={x} x2={x} y1={Y(f.upper_90)} y2={Y(f.lower_90)} stroke="var(--color-emerald)" strokeWidth="5" strokeOpacity="0.4" strokeLinecap="round" />
          <line x1={x} x2={x} y1={Y(f.upper_80)} y2={Y(f.lower_80)} stroke="var(--color-emerald)" strokeWidth={on ? 15 : 10} strokeLinecap="round" />
          <line x1={x - 10} x2={x + 10} y1={Y(f.median_cases)} y2={Y(f.median_cases)} stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" />
          {f.actual_cases != null && <rect x={x - 4} y={Y(f.actual_cases) - 4} width="8" height="8" transform={`rotate(45 ${x} ${Y(f.actual_cases)})`} fill="var(--color-amber)" stroke="var(--color-canvas)" strokeWidth="1.2" />}
          <text x={x} y={Y(f.upper_90) - 8} textAnchor="middle" fontSize="12" fontWeight={on ? 700 : 500} fill="var(--color-ink)">{f.median_cases}</text>
          <text x={x} y={CB + 16} textAnchor="middle" fontSize="11" fill={on ? "var(--color-ink)" : "var(--color-ink-3)"} fontWeight={on ? 600 : 400}>{f.horizon} wk</text>
        </g>); })}
    </svg>}
    {sel && <p className="sr-only" aria-live="polite">{`Selected ${sel.horizon} weeks ahead: median ${sel.median_cases} cases.`}</p>}
  </div>);
}
