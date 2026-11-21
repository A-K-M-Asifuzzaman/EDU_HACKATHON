"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { cls } from "@/lib/format";

export interface CityPoint { city: string; wards: number; alerts: number; meanP: number; expected: number }
// Approximate city-centre positions (NOT ward boundaries). Ward IDs in the organizer data cannot be matched to real boundaries.
const POS: Record<string, [number, number]> = { "Dhaka North": [90.395, 23.84], "Dhaka South": [90.41, 23.72], Chattogram: [91.7832, 22.3569], Gazipur: [90.4203, 23.9999], Narayanganj: [90.5, 23.6238] };
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const colour = (p: number) => (p > 0.75 ? "#d93a42" : p > 0.5 ? "#e8782f" : p > 0.25 ? "#e0a526" : "#0e8f66");

export default function CityMap({ points, selected, onSelect, height = 380 }: { points: CityPoint[]; selected?: string; onSelect?: (c: string) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const lib = useRef<any>(null);
  const [state, setState] = useState<"loading" | "ok" | "unavailable">("loading");
  useEffect(() => {
    let dead = false;
    if (!KEY) { setState("unavailable"); return; }
    import("maplibre-gl").then(async (m) => {
      if (dead || !el.current) return;
      lib.current = (m as any).default ?? m;
      try { lib.current.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); } catch {}
      try {
        map.current = new lib.current.Map({ container: el.current, style: `https://api.maptiler.com/maps/dataviz-light/style.json?key=${KEY}`, center: [91.0, 23.2], zoom: 5.4, bounds: [[89.7, 22.0], [92.1, 24.4]], fitBoundsOptions: { padding: 24 }, attributionControl: { compact: true }, cooperativeGestures: true });
        map.current.on("load", () => !dead && setState("ok"));
        map.current.on("error", (e: any) => { if (e?.error?.status === 401 || e?.error?.status === 403) setState("unavailable"); });
      } catch { setState("unavailable"); }
    }).catch(() => setState("unavailable"));
    return () => { dead = true; markers.current.forEach((x) => x.remove()); map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !lib.current) return;
    markers.current.forEach((x) => x.remove()); markers.current = [];
    for (const p of points) {
      const pos = POS[p.city]; if (!pos) continue;
      const d = document.createElement("button");
      const size = 24 + Math.min(18, p.wards * 0.9);
      d.setAttribute("aria-label", `${p.city}: ${p.alerts} of ${p.wards} wards alerting, mean outbreak probability ${Math.round(p.meanP * 100)}%`);
      d.style.cssText = `width:${size}px;height:${size}px;border-radius:999px;border:${selected === p.city ? 3 : 2}px solid #fff;background:${colour(p.meanP)};color:#fff;font:700 12px Inter,sans-serif;box-shadow:0 4px 14px rgba(7,59,43,.4);cursor:pointer;opacity:.92`;
      d.textContent = `${p.alerts}`;
      d.title = `${p.city}: ${p.alerts}/${p.wards} alerts · mean outbreak probability ${Math.round(p.meanP * 100)}% · expected ${p.expected.toFixed(0)} cases`;
      d.onclick = () => onSelect?.(p.city);
      markers.current.push(new lib.current.Marker({ element: d }).setLngLat(pos).addTo(map.current));
    }
  }, [points, selected, state, onSelect]);
  return (<div className="relative overflow-hidden rounded-xl border border-line" style={{ height }}>
    <div ref={el} className={cls("h-full w-full", state !== "ok" && "opacity-0")} />
    {state !== "ok" && <div className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center text-sm text-ink-3">{state === "loading" ? "Loading map…" : "The map is unavailable (no key or WebGL). City risk is shown in the table; nothing else depends on the map."}</div>}
    <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-white/85 px-2 py-0.5 text-[10px] text-ink-3">Approximate city-centre positions · circle = number of alerting wards · no ward boundaries</div></div>);
}
