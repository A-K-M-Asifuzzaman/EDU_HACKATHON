"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

// Conceptual explainer. Stage timings follow the organizer brief (7–14 days for eggs to mature into adults, then viral incubation and symptom onset, a 2–4 week lag).
// It is NOT a simulation of the dataset-generating process or of real transmission.
const STAGES = [
  { w: 0, title: "Heavy rain", text: "Rain fills drains, containers and low ground.", icon: "rain" },
  { w: 1, title: "Standing water", text: "Poor drainage (high waterlogging) and weak waste collection leave water standing in a ward.", icon: "puddle" },
  { w: 1.8, title: "Larvae develop", text: "The brief describes 7–14 days for Aedes eggs to mature into adult mosquitoes.", icon: "larva" },
  { w: 3, title: "Infection & incubation", text: "Adult mosquitoes can spread the virus; viral incubation follows before symptoms appear.", icon: "mosq" },
  { w: 4, title: "Cases rise", text: "Symptom onset and hospital reports peak about 2–4 weeks after the rain.", icon: "case" },
];
export default function RainExplainer() {
  const [wk, setWk] = useState(2);
  const reduce = useReducedMotion();
  const active = STAGES.reduce((a, s, i) => (wk >= s.w ? i : a), 0);
  const x = (w: number) => 60 + (w / 5) * 740;
  return (<div>
    <svg viewBox="0 0 860 300" role="img" aria-label="Conceptual timeline from rainfall to dengue cases over about five weeks" className="w-full">
      <rect x={x(2)} y={26} width={x(4) - x(2)} height={190} rx={14} fill="#ecebfb" /><text x={(x(2) + x(4)) / 2} y={46} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0a6f4f">Model early-warning window: 2–4 weeks after rain</text>
      <line x1={60} x2={800} y1={236} y2={236} stroke="#cfd9e2" strokeWidth={2} />
      {[0, 1, 2, 3, 4, 5].map((w) => (<g key={w}><line x1={x(w)} x2={x(w)} y1={230} y2={242} stroke="#7a8a9a" /><text x={x(w)} y={260} textAnchor="middle" fontSize="11" fill="#5b6b7b">{w === 0 ? "rain" : `+${w} wk`}</text></g>))}
      {STAGES.map((s, i) => (<motion.g key={s.title} animate={{ opacity: i <= active ? 1 : 0.28, y: i === active ? -6 : 0 }} transition={{ type: "spring", stiffness: 200, damping: 20 }}>
        <circle cx={x(s.w)} cy={150} r={i === active ? 34 : 28} fill={i === active ? "#2f2e72" : "#fff"} stroke="#3b3a8c" strokeWidth={2.5} />
        <Icon k={s.icon} cx={x(s.w)} cy={150} light={i === active} reduce={!!reduce} />
        <text x={x(s.w)} y={202} textAnchor="middle" fontSize="11.5" fontWeight="650" fill="#2f2e72">{s.title}</text></motion.g>))}
      <motion.circle r={7} cy={236} fill="#ea575b" animate={{ cx: x(wk) }} transition={{ type: "spring", stiffness: 160, damping: 20 }} /></svg>
    <div className="mt-2 grid items-center gap-3 sm:grid-cols-[1fr_2fr]"><label className="flex flex-col gap-1 text-xs text-ink-3"><span className="eyebrow">Scrub time since the rain event</span><input type="range" min={0} max={5} step={0.1} value={wk} onChange={(e) => setWk(Number(e.target.value))} aria-label="Weeks since rainfall" className="accent-emerald" /><span className="num font-semibold text-forest">+{wk.toFixed(1)} weeks</span></label>
      <div className="rounded-xl border border-emerald/25 bg-mint-l p-3 text-[13px] text-ink-2"><b className="text-forest">{STAGES[active].title}.</b> {STAGES[active].text}</div></div>
    <p className="mt-2 text-xs text-ink-3">Conceptual illustration based on the organizer brief; it does not simulate the dataset or real transmission. DengueShield's strongest learned weather signal is rain three weeks before the target week.</p></div>);
}
function Icon({ k, cx, cy, light, reduce }: { k: string; cx: number; cy: number; light: boolean; reduce: boolean }) {
  const c = light ? "#fff" : "#0a6f4f";
  if (k === "rain") return (<g>{[-9, 0, 9].map((d, i) => (<motion.line key={d} x1={cx + d} x2={cx + d - 3} y1={cy - 10} y2={cy - 2} stroke={c} strokeWidth={2.4} strokeLinecap="round" animate={reduce ? {} : { y: [0, 9, 0], opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.25 }} />))}<path d={`M${cx - 13} ${cy - 12}a8 8 0 0 1 14-5a7 7 0 0 1 12 6z`} fill="none" stroke={c} strokeWidth={2} /></g>);
  if (k === "puddle") return (<g><ellipse cx={cx} cy={cy + 6} rx={15} ry={6} fill="none" stroke={c} strokeWidth={2.2} /><ellipse cx={cx} cy={cy + 6} rx={7} ry={2.6} fill={c} opacity={0.6} /><path d={`M${cx} ${cy - 14}c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z`} fill={c} opacity={0.9} /></g>);
  if (k === "larva") return (<g><path d={`M${cx - 12} ${cy + 4}q6-14 12-2t12-4`} fill="none" stroke={c} strokeWidth={3} strokeLinecap="round" /><circle cx={cx - 13} cy={cy + 4} r={3} fill={c} /></g>);
  if (k === "mosq") return (<g stroke={c} fill={c}><ellipse cx={cx} cy={cy + 1} rx={9} ry={3.4} /><circle cx={cx + 10} cy={cy} r={2.6} /><line x1={cx + 12} y1={cy} x2={cx + 20} y2={cy + 2} strokeWidth={1.4} /><ellipse cx={cx - 2} cy={cy - 7} rx={8} ry={3} fillOpacity={0.35} transform={`rotate(-20 ${cx - 2} ${cy - 7})`} /></g>);
  return (<g stroke={c} fill="none" strokeWidth={2.4} strokeLinecap="round"><path d={`M${cx - 12} ${cy + 8}l7-10 6 6 6-14 6 8`} /><line x1={cx - 13} y1={cy + 12} x2={cx + 13} y2={cy + 12} /></g>);
}
