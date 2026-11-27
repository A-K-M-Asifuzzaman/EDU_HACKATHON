"use client";
// Interactive boot sequence: swat the mosquito to enter. Overlays the already-loading app (never blocks it), plays once per browser
// session, is skipped under prefers-reduced-motion or ?nointro, uses an SVG fallback without WebGL or on low-end devices, and keeps
// emergency help one tap away.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { openEmergency } from "./emergency";
import { Skyline } from "./illustrations";
import type { FlightState } from "./introscene";

const IntroScene = dynamic(() => import("./introscene"), { ssr: false });
const RainField = dynamic(() => import("./rain-field"), { ssr: false });
const SEEN = "ds.intro.seen";

function SvgMosquito({ state }: { state: React.MutableRefObject<FlightState> }) {
  const el = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0, x = -100, y = innerHeight * 0.4, vx = 3, vy = 0, fall = 0;
    const tick = (t: number) => {
      const s = state.current, n = el.current; if (!n) return;
      if (s.swatted) { fall += 1; y += fall * 1.4; n.style.transform = `translate(${x}px,${y}px) rotate(${fall * 14}deg) scale(1,.35)`; if (y < innerHeight + 200) raf = requestAnimationFrame(tick); return; }
      let tx = innerWidth / 2 + Math.sin(t / 1900) * innerWidth * 0.33, ty = innerHeight / 2 + Math.sin(t / 1200 + 1) * innerHeight * 0.25;
      if (s.pointer) { const px = (s.px + 1) / 2 * innerWidth, py = (1 - s.py) / 2 * innerHeight, d = Math.hypot(px - x, py - y); tx += (px - tx) * (d < 90 ? -1 : 0.4); ty += (py - ty) * (d < 90 ? -1 : 0.4); }
      vx += ((tx - x) * 0.02 - vx) * 0.08; vy += ((ty - y) * 0.02 - vy) * 0.08; x += vx; y += vy;
      n.style.transform = `translate(${x - 60}px,${y - 40}px) rotate(${Math.atan2(vy, vx) * 57.3}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);
  return (<svg ref={el} width="120" height="80" viewBox="-60 -40 120 80" className="absolute left-0 top-0" aria-hidden>
    <g className="ds-wing"><ellipse cx="-4" cy="-16" rx="26" ry="8" fill="#d8efff" opacity=".55" /><ellipse cx="-4" cy="16" rx="26" ry="8" fill="#d8efff" opacity=".55" /></g>
    <ellipse cx="-14" cy="0" rx="22" ry="7" fill="#2a2e33" /><g stroke="#f3efe3" strokeWidth="2">{[-26, -18, -10].map((cx) => <line key={cx} x1={cx} y1="-6" x2={cx} y2="6" />)}</g>
    <ellipse cx="12" cy="0" rx="10" ry="8" fill="#3a3f45" /><circle cx="24" cy="0" r="5" fill="#2a2e33" /><line x1="28" y1="0" x2="52" y2="0" stroke="#1c1f22" strokeWidth="2" />
    <g stroke="#2a2e33" strokeWidth="1.6" fill="none">{[-1, 1].flatMap((d) => [4, 10, 16].map((lx) => <path key={`${d}${lx}`} d={`M${lx} ${d * 6} q-6 ${d * 14} -18 ${d * 24}`} />))}</g>
  </svg>);
}

export default function Intro() {
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<"fly" | "swat" | "reveal">("fly");
  const [webgl, setWebgl] = useState(false);
  const [hit, setHit] = useState<{ x: number; y: number } | null>(null);
  const [r, setR] = useState(0);
  const state = useRef<FlightState>({ px: 0, py: 0, pointer: false, swatted: false });
  const root = useRef<HTMLDivElement>(null);
  const reticle = useRef<HTMLDivElement>(null);                   // pointer reticle, moved via ref (no re-render per move)
  // optional sound, muted by default; synthesised with Web Audio (no audio files) and started only by a user click
  const [sound, setSound] = useState(false);
  const audio = useRef<{ ctx: AudioContext; stop: () => void } | null>(null);
  const stopSound = useCallback(() => { audio.current?.stop(); audio.current = null; setSound(false); }, []);
  const startSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain(), bp = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = "sawtooth"; osc.frequency.value = 540; lfo.frequency.value = 34; lfoGain.gain.value = 22;   // wing-beat vibrato
      bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 5; gain.gain.value = 0.03;
      lfo.connect(lfoGain).connect(osc.frequency); osc.connect(bp).connect(gain).connect(ctx.destination); osc.start(); lfo.start();
      let done = false;
      audio.current = { ctx, stop: () => { if (done) return; done = true; try { osc.stop(); lfo.stop(); } catch {} ctx.close().catch(() => {}); } };   // idempotent
      setSound(true);
    } catch { setSound(false); }
  }, []);
  const thwack = useCallback(() => {
    const a = audio.current; if (!a) return;
    const { ctx } = a, n = Math.floor(ctx.sampleRate * 0.16), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; lp.type = "lowpass"; lp.frequency.value = 700; g.gain.value = 0.5;
    src.connect(lp).connect(g).connect(ctx.destination); src.start();
    setTimeout(() => a.stop(), 220);
  }, []);
  useEffect(() => () => audio.current?.stop(), []);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN) === "1"; } catch {}
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduce || new URLSearchParams(location.search).has("nointro")) return;
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      const weak = (navigator.hardwareConcurrency ?? 8) < 4 || ((navigator as any).deviceMemory ?? 8) < 4;
      setWebgl(!!gl && !weak);
    } catch { setWebgl(false); }
    setShow(true);
  }, []);
  useEffect(() => { if (show) root.current?.focus(); }, [show]);

  const finish = useCallback(() => {
    audio.current?.stop(); audio.current = null;
    try { sessionStorage.setItem(SEEN, "1"); } catch {}
    setShow(false);
    document.getElementById("main")?.animate([{ opacity: 0.4, transform: "scale(.985)" }, { opacity: 1, transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)" });
  }, []);

  const swat = useCallback((x: number, y: number) => {
    if (phase !== "fly") return;
    state.current.swatted = true; setHit({ x, y }); setPhase("swat"); thwack();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) root.current?.animate([{ transform: "translate(0,0)" }, { transform: "translate(-5px,3px)" }, { transform: "translate(4px,-3px)" }, { transform: "translate(-2px,1px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    setTimeout(() => {
      setPhase("reveal");
      const max = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40, t0 = performance.now();
      const step = (t: number) => { const k = Math.min(1, (t - t0) / 850); setR(max * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); else finish(); };
      requestAnimationFrame(step);
    }, 480);
  }, [phase, finish, thwack]);

  if (!show) return null;
  const mask = phase === "reveal" && hit ? `radial-gradient(circle at ${hit.x}px ${hit.y}px, transparent ${r}px, #000 ${r + 2}px)` : undefined;
  return (<div ref={root} role="dialog" aria-modal="true" aria-label="DengueShield AI introduction. Press Enter to swat the mosquito, or Escape to skip." tabIndex={-1}
    className="fixed inset-0 z-[80] cursor-crosshair select-none overflow-hidden outline-none"
    style={{ background: "radial-gradient(120% 90% at 70% 10%, #6a45f0, #4a2bd0 45%, #2a157f)", WebkitMaskImage: mask, maskImage: mask }}
    onPointerMove={(e) => { state.current.px = (e.clientX / innerWidth) * 2 - 1; state.current.py = -((e.clientY / innerHeight) * 2 - 1); state.current.pointer = true;
      const r = reticle.current; if (r) { r.style.opacity = "1"; r.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; } }}
    onPointerLeave={() => { state.current.pointer = false; if (reticle.current) reticle.current.style.opacity = "0"; }}
    onClick={(e) => swat(e.clientX, e.clientY)}
    onKeyDown={(e) => { if (e.key === "Escape") finish(); else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); swat(innerWidth / 2, innerHeight / 2); } }}>
    <RainField mm={150} className="opacity-80" />
    <Skyline className="pointer-events-none absolute inset-x-0 bottom-0 h-[110px] w-full sm:h-[170px]" />
    <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 46%, transparent 50%, rgba(26,15,82,.55) 100%)" }} />
    <div className="pointer-events-none absolute left-4 top-4 sm:left-7 sm:top-6">
      <div className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-white">DengueShield <span className="align-[3px] font-sans text-[11px] font-bold tracking-[0.06em] text-[#ffd36e]">AI</span></div>
      <div className="mt-1 hidden text-[12.5px] leading-relaxed text-white/80 sm:block">Historical replay of synthetic organizer data.<br />The forecasts are already loading behind this screen.</div></div>
    {webgl ? <IntroScene state={state} /> : <SvgMosquito state={state} />}
    {phase === "fly" && (<div ref={reticle} className="ds-reticle pointer-events-none absolute left-0 top-0 opacity-0" aria-hidden>
      <span className="absolute -left-7 -top-7 h-14 w-14 rounded-full border border-white/40" /><span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-white/80" /></div>)}
    {hit && (<div className="pointer-events-none absolute" style={{ left: hit.x, top: hit.y }}>
      {/* raindrop-on-water ripples: the swat lands like a drop, and the page opens from that point */}
      {[0, 110, 220].map((d, i) => <span key={d} className={"ds-ripple absolute -left-20 -top-20 h-40 w-40 rounded-full border " + (i === 1 ? "border-[#ffd36e]" : "border-white")} style={{ animationDelay: `${d}ms` }} />)}
      <span className="ds-flash absolute -left-16 -top-16 h-32 w-32 rounded-full bg-white/50 blur-2xl" /></div>)}
    <div className="pointer-events-none absolute inset-x-0 bottom-[12%] px-4 text-center text-white">
      <div className="font-display text-[38px] font-extrabold leading-[0.98] tracking-[-0.03em] text-white sm:text-[64px]">{phase === "fly" ? <>Swat the mosquito <span className="text-[#ffd36e]">to enter.</span></> : <>Dengue forecasts, <span className="text-[#ffd36e]">two to four weeks ahead.</span></>}</div>
      <div className="mt-4 text-[14px] text-white/85">Click or tap anywhere. Enter or Space also works; Esc skips.</div>
      <div className="mt-1 text-[12.5px] text-white/75 sm:hidden">The forecasts are already loading behind this screen.</div>
    </div>
    <div className="absolute right-4 top-11 flex flex-wrap justify-end gap-2 sm:right-6 sm:top-6">
      <button onClick={(e) => { e.stopPropagation(); finish(); openEmergency(); }} className="min-h-11 rounded-full border-[3px] border-[#1a1438] bg-[#c2303a] px-4 font-display text-[13.5px] font-extrabold text-white shadow-[3px_3px_0_#1a1438] hover:brightness-110">✚ Emergency help</button>
      <button onClick={(e) => { e.stopPropagation(); if (sound) stopSound(); else startSound(); }} aria-pressed={sound} aria-label={sound ? "Mute sound" : "Turn sound on"} className="btn-ghost min-h-11 px-4 text-[13.5px]">{sound ? "🔊 Sound on" : "🔈 Sound off"}</button>
      <button onClick={(e) => { e.stopPropagation(); finish(); }} className="btn-ghost min-h-11 px-4 text-[13.5px]">Skip intro</button>
    </div>
  </div>);
}
