"use client";
// Optional signature cursor: an SVG Aedes mosquito (black body, white bands, striped legs, clear wings) that follows the pointer, and an
// optional flight buzz. Both are OFF by default (footer toggles, stored in localStorage). The real cursor stays visible, so clicks land
// exactly where they always do; the mosquito never receives pointer events. Off on touch devices and under reduced motion. The animation
// frame loop runs only while the mosquito is catching up with the pointer: at rest nothing runs.
import { useEffect, useRef, useState } from "react";

export const CURSOR_KEY = "ds.cursor", BUZZ_KEY = "ds.buzz";
const read = (k: string) => { try { return localStorage.getItem(k) === "on"; } catch { return false; } };

export function setPref(k: string, on: boolean) {
  try { localStorage.setItem(k, on ? "on" : "off"); } catch {}
  window.dispatchEvent(new Event("ds:cursor"));
}

export default function MosquitoCursor() {
  const [on, setOn] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setOn(read(CURSOR_KEY) && !matchMedia("(pointer: coarse)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches);
    sync(); window.addEventListener("ds:cursor", sync); return () => window.removeEventListener("ds:cursor", sync);
  }, []);

  useEffect(() => {
    if (!on || !el.current) return;
    const node = el.current;
    let x = -100, y = -100, tx = -100, ty = -100, angle = 0, raf = 0, idle: ReturnType<typeof setTimeout> | undefined;
    let ctx: AudioContext | null = null, osc: OscillatorNode | null = null, gain: GainNode | null = null;
    const buzz = () => {
      if (!read(BUZZ_KEY) || document.hidden) return null;
      if (!ctx) {                                   // created on the first pointer move after the user switched sound on
        ctx = new AudioContext(); osc = ctx.createOscillator(); gain = ctx.createGain(); const f = ctx.createBiquadFilter();
        osc.type = "sawtooth"; f.type = "bandpass"; f.frequency.value = 900; gain.gain.value = 0;
        osc.connect(f).connect(gain).connect(ctx.destination); osc.start();
      }
      return ctx;
    };
    const quiet = () => { if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08); node.dataset.moving = ""; };
    const step = () => {
      const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
      x += dx * 0.22; y += dy * 0.22;
      if (d > 0.5) angle = Math.atan2(dy, dx) * 57.3 + 90;
      node.style.transform = `translate(${x - 16}px, ${y - 16}px) rotate(${angle}deg)`;
      const c = buzz();
      if (c && osc && gain) { const v = Math.min(1, d / 120); osc.frequency.setTargetAtTime(480 + 260 * v, c.currentTime, 0.05); gain.gain.setTargetAtTime(0.035 * v, c.currentTime, 0.05); }
      raf = d > 0.5 ? requestAnimationFrame(step) : 0;          // stop when caught up: no idle loop
      if (!raf) quiet();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX + 18; ty = e.clientY + 18;                   // flies beside the real cursor, never under it
      node.dataset.moving = "1";
      if (!raf) raf = requestAnimationFrame(step);
      clearTimeout(idle); idle = setTimeout(quiet, 400);
    };
    const hide = () => { if (document.hidden) { quiet(); ctx?.suspend(); } else ctx?.resume(); };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("pointermove", move); document.removeEventListener("visibilitychange", hide); cancelAnimationFrame(raf); clearTimeout(idle); ctx?.close(); };
  }, [on]);

  if (!on) return null;
  return (<div ref={el} aria-hidden className="ds-mosquito pointer-events-none fixed left-0 top-0 z-[9999]" style={{ transform: "translate(-100px,-100px)" }}>
    <svg width="32" height="32" viewBox="0 0 32 32">
      <g className="ds-wings" fill="rgba(220,235,255,.55)" stroke="rgba(255,255,255,.7)" strokeWidth=".5">
        <ellipse cx="10" cy="13" rx="7" ry="3" transform="rotate(-30 10 13)" /><ellipse cx="22" cy="13" rx="7" ry="3" transform="rotate(30 22 13)" /></g>
      <g stroke="#111" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 1.2">
        <path d="M15 15 L6 10 M15 17 L5 18 M15 19 L7 26 M17 15 L26 10 M17 17 L27 18 M17 19 L25 26" /></g>
      <ellipse cx="16" cy="17" rx="2.6" ry="7.5" fill="#111" />
      <g stroke="#f5f5f5" strokeWidth=".8"><path d="M13.8 15h4.4M13.6 18h4.8M13.9 21h4.2" /></g>
      <circle cx="16" cy="9" r="2.2" fill="#111" /><path d="M16 7 L16 2" stroke="#111" strokeWidth=".9" />
    </svg>
  </div>);
}
