"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cls } from "@/lib/format";

/** The DengueShield map: real OSM facilities (clustered), optional DGHS boundaries (context only), city-level forecast and weather markers,
 *  3D buildings when the basemap has building data, and animated A* routes. Forecasts are never drawn on ward polygons. */
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const BLANK: any = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef3f1" } }] };
const EMPTY = { type: "FeatureCollection", features: [] };
export type LngLat = [number, number];
export interface CityOverlay { city: string; lon: number; lat: number; meanP: number; alerts: number; wards: number; expected: number }
export interface WeatherPt { city: string; lon: number; lat: number; label: string; title: string }
export interface Layers { facilities: boolean; dghs: boolean; forecast: boolean; weather: boolean; buildings: boolean }
export interface MapHandle { flyTo: (c: LngLat, zoom?: number) => void; fit: (coords: LngLat[]) => void }
const riskColour = (p: number) => (p > 0.75 ? "#d93a42" : p > 0.5 ? "#e8782f" : p > 0.25 ? "#e0a526" : "#0e8f66");

function arrowImage(): ImageData {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const x = c.getContext("2d")!; x.lineCap = x.lineJoin = "round";
  x.strokeStyle = "#ffffff"; x.lineWidth = 5; x.beginPath(); x.moveTo(10, 8); x.lineTo(21, 16); x.lineTo(10, 24); x.stroke();
  return x.getImageData(0, 0, 32, 32);
}

interface Props {
  facilities: any | null; dghs: any | null; cityRisk: CityOverlay[]; weather: WeatherPt[]; layers: Layers; origin: LngLat | null;
  routes: { fastest?: LngLat[]; shortest?: LngLat[] }; selectedId?: string | null; reduce: boolean; height?: number | string;
  routeMode?: "fastest" | "shortest" | "both"; dest?: LngLat | null; explored?: { astar?: LngLat[]; dijkstra?: LngLat[] } | null;
  onPick: (p: LngLat) => void; onFacility: (f: any) => void; onBuildings?: (available: boolean) => void;
}

const CommandMap = forwardRef<MapHandle, Props>(function CommandMap(p, ref) {
  const el = useRef<HTMLDivElement>(null), map = useRef<any>(null), lib = useRef<any>(null);
  const markers = useRef<any[]>([]), originMarker = useRef<any>(null), destMarker = useRef<any>(null), anim = useRef<number>(0), anim2 = useRef<number>(0);
  const cb = useRef(p); cb.current = p;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const was3d = useRef(false);

  useImperativeHandle(ref, () => ({
    flyTo: (c, zoom = 13) => map.current?.flyTo({ center: c, zoom, pitch: cb.current.layers.buildings ? 55 : 0, duration: cb.current.reduce ? 0 : 1600, essential: true }),
    fit: (coords) => {
      if (!map.current || coords.length < 2) return;
      const b = coords.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
      map.current.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 60, bottom: 60, left: 60, right: 60 }, duration: cb.current.reduce ? 0 : 1400, pitch: cb.current.layers.buildings ? 50 : 0 });
    },
  }), []);

  useEffect(() => {
    let dead = false;
    import("maplibre-gl").then((m) => {
      if (dead || !el.current) return;
      const L = (lib.current = (m as any).default ?? m);
      try { L.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); } catch {}
      try {
        const mp = (map.current = new L.Map({ container: el.current, style: KEY ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${KEY}` : BLANK,
          center: [90.4, 23.78], zoom: 11.2, maxPitch: 70, cooperativeGestures: true,
          attributionControl: { compact: true, customAttribution: "Facilities & routing © OpenStreetMap contributors (ODbL) · Boundaries © DGHS" } }));
        mp.addControl(new L.NavigationControl({ visualizePitch: true }), "top-right");
        mp.addControl(new L.FullscreenControl(), "top-right");
        mp.addControl(new L.ScaleControl({ unit: "metric" }), "bottom-left");
        mp.on("error", (e: any) => { if (e?.error?.status === 401 || e?.error?.status === 403) mp.setStyle(BLANK); });
        mp.on("load", () => {
          if (dead) return;
          mp.addImage("route-arrow", arrowImage(), { pixelRatio: 2 });
          mp.addSource("dghs", { type: "geojson", data: EMPTY });
          mp.addLayer({ id: "dghs-fill", type: "fill", source: "dghs", paint: { "fill-color": "#3a7ca5", "fill-opacity": 0.12 } });
          mp.addLayer({ id: "dghs-line", type: "line", source: "dghs", paint: { "line-color": "#245a7d", "line-width": 1 } });
          // 3D buildings: only if the basemap's vector source carries a building layer (OpenMapTiles schema)
          const vec = Object.entries(mp.getStyle().sources ?? {}).find(([, s]: any) => s.type === "vector")?.[0];
          let bld = false;
          if (vec) {
            try {
              mp.addLayer({ id: "bld3d", type: "fill-extrusion", source: vec, "source-layer": "building", minzoom: 14, layout: { visibility: "none" },
                paint: { "fill-extrusion-color": "#d5ddd8", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.8 } });
              bld = true;
            } catch { bld = false; }
          }
          cb.current.onBuildings?.(bld);
          // A* insight: sampled exploration fronts (Dijkstra faint amber, A* cyan), drawn beneath the routes
          for (const [k, col, op] of [["expl-d", "#e0a526", 0.35], ["expl-a", "#22b8d6", 0.75]] as const) {
            mp.addSource(k, { type: "geojson", data: EMPTY });
            mp.addLayer({ id: k, type: "circle", source: k, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 15, 3.2], "circle-color": col, "circle-opacity": op } });
          }
          for (const k of ["shortest", "fastest"]) mp.addSource(`route-${k}`, { type: "geojson", data: EMPTY });
          mp.addLayer({ id: "route-shortest", type: "line", source: "route-shortest", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 4, "line-dasharray": [1.4, 1.1], "line-opacity": 0.9 } });
          mp.addLayer({ id: "route-fastest-casing", type: "line", source: "route-fastest", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9 } });
          mp.addLayer({ id: "route-fastest", type: "line", source: "route-fastest", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0e8f66", "line-width": 5.5 } });
          mp.addLayer({ id: "route-arrows", type: "symbol", source: "route-fastest", layout: { "symbol-placement": "line", "symbol-spacing": 70, "icon-image": "route-arrow", "icon-size": 0.55, "icon-allow-overlap": true, "icon-rotation-alignment": "map" } });
          mp.addLayer({ id: "route-arrows-s", type: "symbol", source: "route-shortest", layout: { "symbol-placement": "line", "symbol-spacing": 70, "icon-image": "route-arrow", "icon-size": 0.5, "icon-allow-overlap": true, "icon-rotation-alignment": "map", visibility: "none" } });
          mp.addSource("fac", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 });
          mp.addLayer({ id: "fac-cluster", type: "circle", source: "fac", filter: ["has", "point_count"],
            paint: { "circle-color": "#1d4ed8", "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24, 200, 30] } });
          const font = (mp.getStyle().layers ?? []).find((l: any) => l.type === "symbol" && l.layout?.["text-font"])?.layout["text-font"];
          if (font) mp.addLayer({ id: "fac-count", type: "symbol", source: "fac", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": font, "text-size": 12 }, paint: { "text-color": "#fff" } });
          mp.addLayer({ id: "fac-point", type: "circle", source: "fac", filter: ["!", ["has", "point_count"]],
            paint: { "circle-color": ["match", ["get", "kind"], "hospital", "#1d4ed8", "#0f766e"], "circle-radius": ["case", ["==", ["get", "id"], ""], 9, 6.5], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
          mp.on("click", "fac-cluster", async (e: any) => {
            const f = e.features?.[0]; if (!f) return;
            try { const z = await mp.getSource("fac").getClusterExpansionZoom(f.properties.cluster_id); mp.easeTo({ center: f.geometry.coordinates, zoom: z, duration: cb.current.reduce ? 0 : 600 }); } catch {}
          });
          mp.on("click", "fac-point", (e: any) => { const f = e.features?.[0]; if (f) cb.current.onFacility(f); });
          mp.on("click", (e: any) => { if (!mp.queryRenderedFeatures(e.point, { layers: ["fac-point", "fac-cluster"].filter((l) => mp.getLayer(l)) }).length) cb.current.onPick([e.lngLat.lng, e.lngLat.lat]); });
          for (const l of ["fac-point", "fac-cluster"]) { mp.on("mouseenter", l, () => (mp.getCanvas().style.cursor = "pointer")); mp.on("mouseleave", l, () => (mp.getCanvas().style.cursor = "")); }
          setReady(true);
        });
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { dead = true; cancelAnimationFrame(anim.current); cancelAnimationFrame(anim2.current); markers.current.forEach((x) => x.remove()); originMarker.current?.remove(); destMarker.current?.remove(); map.current?.remove(); map.current = null; };
  }, []);

  // data layers
  useEffect(() => { if (ready) map.current.getSource("fac")?.setData(p.facilities ?? EMPTY); }, [ready, p.facilities]);
  useEffect(() => { if (ready) map.current.getSource("dghs")?.setData(p.dghs ?? EMPTY); }, [ready, p.dghs]);
  useEffect(() => {
    if (!ready) return;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.current.getLayer(id) && map.current.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
    vis(["fac-cluster", "fac-count", "fac-point"], p.layers.facilities);
    vis(["dghs-fill", "dghs-line"], p.layers.dghs);
    vis(["bld3d"], p.layers.buildings);
    // only move the camera when 3D itself is switched, not when another layer changes;
    // buildings exist from zoom 14, so switching 3D on at city zoom used to tilt the map with nothing visible
    if (was3d.current !== p.layers.buildings) {
      was3d.current = p.layers.buildings;
      const z = map.current.getZoom();
      map.current.easeTo({ pitch: p.layers.buildings ? 55 : 0, bearing: p.layers.buildings ? -17 : 0, ...(p.layers.buildings && z < 14.5 ? { zoom: 15.2 } : {}), duration: p.reduce ? 0 : 900 });
    }
  }, [ready, p.layers, p.reduce]);
  useEffect(() => { if (ready && map.current.getLayer("fac-point")) map.current.setPaintProperty("fac-point", "circle-radius", ["case", ["==", ["get", "id"], p.selectedId ?? ""], 10, 6.5]); }, [ready, p.selectedId]);

  // HTML markers: city-level forecast (aggregate of synthetic wards; no ward geometry exists) and current weather at city centres
  useEffect(() => {
    if (!ready || !lib.current) return;
    markers.current.forEach((x) => x.remove()); markers.current = [];
    const add = (lngLat: LngLat, node: HTMLElement) => markers.current.push(new lib.current.Marker({ element: node }).setLngLat(lngLat).addTo(map.current));
    if (p.layers.forecast) for (const c of p.cityRisk) {
      // a labelled pill (not a disc) so it cannot be mistaken for a facility cluster
      const d = document.createElement("div"); const col = riskColour(c.meanP);
      d.setAttribute("role", "img"); d.setAttribute("aria-label", `${c.city} forecast: ${c.alerts} of ${c.wards} synthetic wards alerting, mean outbreak probability ${Math.round(c.meanP * 100)}%`);
      d.title = `${c.city} (city-level aggregate of synthetic wards): ${c.alerts}/${c.wards} alerts · mean P(outbreak) ${Math.round(c.meanP * 100)}% · expected ${c.expected.toFixed(0)} cases`;
      d.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 9px 4px 5px;border-radius:999px;background:#fff;border:2px solid ${col};font:600 11px Inter,sans-serif;color:#0d1b2a;box-shadow:0 0 0 5px ${col}26,0 6px 16px rgba(7,59,43,.25);white-space:nowrap;transition:border-color .6s,box-shadow .6s`;
      const dot = document.createElement("span");
      dot.style.cssText = `display:grid;place-items:center;min-width:20px;height:20px;border-radius:999px;background:${col};color:#fff;font:700 11px Inter,sans-serif;transition:background .6s`;
      dot.textContent = `${Math.round(c.meanP * 100)}%`; dot.style.padding = "0 4px";
      d.append(dot, document.createTextNode(`${c.city} · ${c.alerts}/${c.wards} alerts`));
      add([c.lon, c.lat], d);
    }
    if (p.layers.weather) for (const w of p.weather) {
      const d = document.createElement("div"); d.title = w.title;
      d.style.cssText = "transform:translateY(-34px);padding:3px 8px;border-radius:10px;background:rgba(255,255,255,.92);border:1px solid #cfe0d8;font:600 11px Inter,sans-serif;color:#073b2b;box-shadow:0 4px 12px rgba(0,0,0,.12);white-space:nowrap";
      d.textContent = w.label;
      add([w.lon, w.lat], d);
    }
  }, [ready, p.cityRisk, p.weather, p.layers.forecast, p.layers.weather]);

  useEffect(() => {
    if (!ready || !lib.current) return;
    originMarker.current?.remove(); originMarker.current = null;
    if (!p.origin) return;
    const d = document.createElement("div"); d.className = "ds-origin"; d.setAttribute("aria-label", "Starting point");
    originMarker.current = new lib.current.Marker({ element: d }).setLngLat(p.origin).addTo(map.current);
  }, [ready, p.origin]);

  useEffect(() => {
    if (!ready || !lib.current) return;
    destMarker.current?.remove(); destMarker.current = null;
    if (!p.dest) return;
    const d = document.createElement("div"); d.className = "ds-dest"; d.setAttribute("aria-label", "Destination");
    destMarker.current = new lib.current.Marker({ element: d, anchor: "bottom" }).setLngLat(p.dest).addTo(map.current);
  }, [ready, p.dest]);

  // which route(s) are visible
  useEffect(() => {
    if (!ready) return;
    const m = p.routeMode ?? "both", vis = (id: string, on: boolean) => map.current.getLayer(id) && map.current.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("route-shortest", m !== "fastest"); vis("route-fastest", m !== "shortest"); vis("route-fastest-casing", m !== "shortest"); vis("route-arrows", m !== "shortest"); vis("route-arrows-s", m === "shortest");
  }, [ready, p.routeMode]);

  // A* insight: reveal the exploration fronts in expansion order (instant under reduced motion)
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(anim2.current);
    const pts = (c?: LngLat[]) => ({ type: "FeatureCollection", features: (c ?? []).map((x) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: x } })) });
    const a = p.explored?.astar ?? [], d = p.explored?.dijkstra ?? [];
    const set = (k: number) => { map.current.getSource("expl-a")?.setData(pts(a.slice(0, Math.ceil(a.length * k)))); map.current.getSource("expl-d")?.setData(pts(d.slice(0, Math.ceil(d.length * k)))); };
    if (p.reduce || !p.explored) { set(1); return; }
    const t0 = performance.now(), dur = 1800;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / dur); set(k); if (k < 1) anim2.current = requestAnimationFrame(step); };
    anim2.current = requestAnimationFrame(step);
  }, [ready, p.explored, p.reduce]);

  // animated route drawing (instant under reduced motion)
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(anim.current);
    const set = (k: string, c: LngLat[] | undefined) => map.current.getSource(`route-${k}`)?.setData(c && c.length > 1 ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } } : EMPTY);
    const { fastest, shortest } = p.routes;
    if (p.reduce || (!fastest && !shortest)) { set("fastest", fastest); set("shortest", shortest); return; }
    const t0 = performance.now(), dur = 1300;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const cut = (c?: LngLat[]) => (c ? c.slice(0, Math.max(2, Math.ceil(c.length * e))) : undefined);
      set("shortest", cut(shortest)); set("fastest", cut(fastest));
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [ready, p.routes, p.reduce]);

  return (<div className="relative overflow-hidden rounded-xl border border-line" style={{ height: p.height ?? 560 }} role="region" aria-label="Interactive map of hospitals, clinics and routes">
    <div ref={el} className={cls("h-full w-full", failed && "opacity-0")} />
    {failed && <div className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center text-sm text-ink-3">The map could not start (WebGL unavailable). The facility directory and route details below still work.</div>}
    {!ready && !failed && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas/60 text-sm text-ink-3">Loading map…</div>}
  </div>);
});
export default CommandMap;
