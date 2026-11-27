"use client";
// Monsoon atmosphere for the landing hero. The density of the streaks is set by REAL data: the rainfall observed in the selected ward in
// the week the forecast was issued (the page says so next to it). Canvas, about 30 fps, pauses off-screen or in a hidden tab; under
// prefers-reduced-motion it draws one still frame. Decorative: aria-hidden.
import { useEffect, useRef } from "react";

export default function RainField({ mm, className = "" }: { mm: number | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(0);
  const still = useRef<(() => void) | null>(null);   // reduced motion: redraw the still frame when the data arrives
  target.current = mm == null ? 0 : Math.min(260, 24 + mm * 1.5);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext("2d"); if (!c || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    c.dataset.static = String(reduce);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const drops = Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), l: 0.04 + rnd() * 0.09, v: 0.35 + rnd() * 0.5, a: 0.18 + rnd() * 0.5, d: rnd() }));
    let raf = 0, last = 0, on = true, shown = 0;
    const size = () => { const r = Math.min(devicePixelRatio || 1, 1.5); c.width = Math.max(1, c.clientWidth * r); c.height = Math.max(1, c.clientHeight * r); };
    const draw = (dt: number) => {
      const W = c.width, H = c.height; ctx.clearRect(0, 0, W, H);
      shown += (target.current - shown) * Math.min(1, dt * 2);              // density eases toward the data value when the ward changes
      const n = Math.round(shown), slant = 0.22;
      for (let i = 0; i < n; i++) {
        const p = drops[i]; if (!reduce) { p.y += p.v * dt * (0.6 + p.d); if (p.y > 1.1) { p.y = -0.15; p.x = rnd(); } }
        const x = p.x * W, y = p.y * H, len = p.l * H * (0.6 + p.d * 0.6);
        const g = ctx.createLinearGradient(x, y, x - len * slant, y + len);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(${p.d > 0.7 ? "181,238,255" : "255,255,255"},${(p.a * (0.28 + p.d * 0.5)).toFixed(3)})`);
        ctx.strokeStyle = g; ctx.lineWidth = (0.6 + p.d * 1.1) * (W / c.clientWidth); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * slant, y + len); ctx.stroke();
      }
    };
    const frame = (t: number) => { raf = requestAnimationFrame(frame); if (!on || document.hidden || t - last < 33) return; const dt = last ? Math.min(0.1, (t - last) / 1000) : 0.016; last = t; draw(dt); };
    size(); const ro = new ResizeObserver(() => { size(); if (reduce) { shown = target.current; draw(0); } }); ro.observe(c);
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; }); io.observe(c);
    still.current = reduce ? () => { shown = target.current; draw(0); } : null;
    if (reduce) still.current!(); else raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  useEffect(() => { still.current?.(); }, [mm]);
  return <canvas ref={ref} data-rainfield aria-hidden className={"pointer-events-none absolute inset-0 h-full w-full " + className} />;
}
