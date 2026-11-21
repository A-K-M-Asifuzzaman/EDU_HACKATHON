"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { cls } from "@/lib/format";

const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const BLANK = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef3f1" } }] };
const ATTR = "Boundaries © DGHS Bangladesh";

function bbox(fc: any): [[number, number], [number, number]] | null {
  let x0 = 181, y0 = 91, x1 = -181, y1 = -91;
  const walk = (c: any) => { if (typeof c[0] === "number") { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
  for (const f of fc?.features ?? []) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  return x0 > x1 ? null : [[x0, y0], [x1, y1]];
}

/** Official DGHS polygons as neutral context: one colour, no risk shading, no join to dataset wards. Works without a map key (blank basemap). */
export default function DghsMap({ data, height = 460, label }: { data: any | null; height?: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const lib = useRef<any>(null);
  const popup = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    import("maplibre-gl").then((m) => {
      if (dead || !el.current) return;
      lib.current = (m as any).default ?? m;
      try { lib.current.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); } catch {}
      try {
        map.current = new lib.current.Map({ container: el.current, style: KEY ? `https://api.maptiler.com/maps/dataviz-light/style.json?key=${KEY}` : BLANK, center: [90.4, 23.7], zoom: 6, cooperativeGestures: true,
          attributionControl: { compact: true, customAttribution: ATTR } });
        map.current.on("load", () => !dead && setReady(true));
        map.current.on("error", (e: any) => { if (e?.error?.status === 401 || e?.error?.status === 403) map.current?.setStyle(BLANK); });
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { dead = true; popup.current?.remove(); map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    const fc = data ?? { type: "FeatureCollection", features: [] };
    const src = m.getSource("dghs");
    if (src) src.setData(fc);
    else {
      m.addSource("dghs", { type: "geojson", data: fc });
      m.addLayer({ id: "dghs-fill", type: "fill", source: "dghs", paint: { "fill-color": "#3a7ca5", "fill-opacity": 0.18 } });
      m.addLayer({ id: "dghs-line", type: "line", source: "dghs", paint: { "line-color": "#245a7d", "line-width": 1 } });
      m.on("click", "dghs-fill", (e: any) => {
        const p = e.features?.[0]?.properties ?? {}; popup.current?.remove();
        const box = document.createElement("div"); box.style.cssText = "font:12px Inter,sans-serif;max-width:240px";
        for (const [k, v] of Object.entries(p).slice(0, 8)) { const r = document.createElement("div"); const b = document.createElement("b"); b.textContent = `${k}: `; r.append(b, document.createTextNode(String(v))); box.append(r); }
        popup.current = new lib.current.Popup({ closeButton: true }).setLngLat(e.lngLat).setDOMContent(box).addTo(m);
      });
      m.on("mouseenter", "dghs-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "dghs-fill", () => (m.getCanvas().style.cursor = ""));
    }
    const b = bbox(fc); if (b) m.fitBounds(b, { padding: 32, duration: 400, maxZoom: 14 });
  }, [data, ready]);
  return (<div className="relative overflow-hidden rounded-xl border border-line" style={{ height }} role="img" aria-label={label}>
    <div ref={el} className={cls("h-full w-full", failed && "opacity-0")} />
    {failed && <div className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center text-sm text-ink-3">The map could not start (WebGL unavailable). The boundary list below still works.</div>}
    <div className="pointer-events-none absolute left-1 top-1 rounded bg-white/85 px-2 py-0.5 text-[10px] text-ink-3">Official boundaries · context only · not linked to forecast wards</div></div>);
}
