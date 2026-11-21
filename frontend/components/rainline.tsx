"use client";
import { motion } from "motion/react";
import { addWeeks } from "@/lib/api";
import { dateFmt, isoWeek, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** SVG timeline: weeks around the forecast origin. Observed rain (blue) exists up to week t-1; later weeks are NOT observed, shown as past-year climatology (hatched).
 *  The key rain week for horizon h is target - 3 weeks (the model's strongest weather signal). */
export default function RainTimeline({ origin, horizon, rain, clim }: { origin: string; horizon: number; rain: Record<string, number>; clim: Record<string, number> }) {
  const { t, lang } = useI18n();
  const weeks = Array.from({ length: 13 }, (_, i) => addWeeks(origin, i - 8));       // t-8 .. t+4
  const target = addWeeks(origin, horizon), key = addWeeks(target, -3);
  const W = 860, H = 250, pad = 36, bw = (W - pad * 2) / weeks.length;
  const vals = weeks.map((w) => (w < origin ? rain[w] ?? 0 : clim[String(isoWeek(w))] ?? 0));
  const max = Math.max(60, ...vals) * 1.1;
  const y = (v: number) => H - 60 - (v / max) * (H - 110);
  const xOf = (w: string) => pad + weeks.indexOf(w) * bw + bw / 2;
  const originX = pad + weeks.indexOf(origin) * bw;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rainfall timeline around ${origin}: observed before the origin, climatology after; key rain week ${key}`} className="w-full">
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff4dc" /><line x1="0" y1="0" x2="0" y2="6" stroke="#f5b544" strokeWidth="2" /></pattern></defs>
      <rect x={originX} y={14} width={W - pad - originX} height={H - 74} fill="#fff9ec" opacity={0.7} rx={10} />
      {weeks.map((w, i) => { const obs = w < origin, v = vals[i], isKey = w === key; return (
        <g key={w}><motion.rect x={pad + i * bw + 5} width={bw - 10} rx={5} initial={{ height: 0, y: H - 60 }} animate={{ height: Math.max(2, H - 60 - y(v)), y: y(v) }} transition={{ duration: 0.5, delay: i * 0.02 }}
          fill={obs ? "#3b82c4" : "url(#hatch)"} stroke={isKey ? "#d93a42" : obs ? "none" : "#f5b544"} strokeWidth={isKey ? 3 : 1} />
          <text x={xOf(w)} y={H - 42} textAnchor="middle" fontSize="10" fill="#5b6b7b">{dateFmt(w, lang, false)}</text>
          <text x={xOf(w)} y={y(v) - 5} textAnchor="middle" fontSize="10" fill="#44566a" className="num">{num(v, lang, 0)}</text></g>); })}
      <line x1={originX} x2={originX} y1={8} y2={H - 56} stroke="#073b2b" strokeWidth={2} strokeDasharray="5 4" />
      <text x={originX + 6} y={22} fontSize="11" fontWeight="700" fill="#073b2b">{t("fc.origin")} (t) — {t("avail.observed")} ←  |  → {lang === "bn" ? "অপর্যবেক্ষিত" : "not yet observed"}</text>
      <motion.g animate={{ x: xOf(target) }} initial={false} transition={{ type: "spring", stiffness: 140, damping: 18 }}>
        <path d={`M0 ${H - 30} l-7 -10 h14 z`} fill="#d93a42" /><text x={0} y={H - 12} textAnchor="middle" fontSize="11" fontWeight="700" fill="#b3262c">{t("fc.target")} (t+{horizon})</text></motion.g>
      <text x={xOf(key)} y={H - 26} textAnchor="middle" fontSize="10" fontWeight="700" fill="#b3262c">▲ key rain (target−3w)</text>
    </svg>);
}
