"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { cls } from "@/lib/format";
import { TIER_COLOR, TIER_TEXT, type Tier } from "@/lib/api";

export interface CityPoint { city: string; wards: number; alerts: number; meanP: number; expected: number }
// Approximate city-centre positions (NOT ward boundaries). Ward IDs in the organizer data cannot be matched to real boundaries.
export const CITY_POS: Record<string, [number, number]> = { "Dhaka North": [90.395, 23.84], "Dhaka South": [90.41, 23.72], Chattogram: [91.7832, 22.3569], Gazipur: [90.4203, 23.9999], Narayanganj: [90.5, 23.6238] };
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
// The four Dhaka-area cities are ~40 km apart, about 14 px at this zoom, so their markers covered each other. Fan them out in a 2×2
// (north kept above south) by a fixed pixel offset; the anchor stays at the city centre and the caption says so.
const OFFSET: Record<string, [number, number]> = { Gazipur: [-22, -22], "Dhaka North": [22, -22], "Dhaka South": [-22, 22], Narayanganj: [22, 22] };
// tier colours and their readable text colour (white on amber was 2.2:1)
const tierOf = (p: number): Tier => (p > 0.75 ? "Critical" : p > 0.5 ? "High" : p > 0.25 ? "Medium" : "Low");

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
      const pos = CITY_POS[p.city]; if (!pos) continue;
      const d = document.createElement("button");
      const size = 24 + Math.min(18, p.wards * 0.9);
      d.setAttribute("aria-label", `${p.city}: ${p.alerts} of ${p.wards} wards alerting, mean outbreak probability ${Math.round(p.meanP * 100)}%`);
      d.style.cssText = `width:${size}px;height:${size}px;border-radius:999px;border:${selected === p.city ? 3 : 2}px solid #fff;background:${TIER_COLOR[tierOf(p.meanP)]};color:${TIER_TEXT[tierOf(p.meanP)]};font:700 12px Inter,sans-serif;box-shadow:0 4px 14px rgba(10,13,20,.4);cursor:pointer;opacity:.92`;
      d.textContent = `${p.alerts}`;
      d.title = `${p.city}: ${p.alerts}/${p.wards} alerts · mean outbreak probability ${Math.round(p.meanP * 100)}% · expected ${p.expected.toFixed(0)} cases`;
      d.onclick = () => onSelect?.(p.city);
      markers.current.push(new lib.current.Marker({ element: d, offset: OFFSET[p.city] ?? [0, 0] }).setLngLat(pos).addTo(map.current));
    }
  }, [points, selected, state, onSelect]);
  return (<div className="relative overflow-hidden rounded-xl border border-line" style={{ height }}>
    <div ref={el} className={cls("h-full w-full", state !== "ok" && "opacity-0")} />
    {state !== "ok" && <div className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center text-sm text-ink-3">{state === "loading" ? "Loading map…" : "The map is unavailable (no key or WebGL). City risk is shown in the table; nothing else depends on the map."}</div>}
    <div className="pointer-events-none absolute left-1 top-1 rounded bg-white/90 px-2 py-0.5 text-[11px] text-ink-2">Approximate city-centre positions (Dhaka-area markers spread apart to stay readable) · number = alerting wards · no ward boundaries</div></div>);
}
