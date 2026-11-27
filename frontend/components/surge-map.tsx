"use client";
// Stage 02, geographic mode: real OpenStreetMap hospitals (bundled, verified-source records) with the bundled road graph for nearest-
// hospital and A* routes, plus one planning gauge per forecast city at its city centre. The gauges are city aggregates of synthetic
// wards; no ward is placed on the map and no hospital is given a bed count (OSM bed tags are shown only as tags, never as capacity).
import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, qs, ApiError } from "@/lib/api";
import CommandMap, { type LngLat, type MapHandle } from "./commandmap";
import { CITY_POS } from "./citymap";
import { useAsync } from "./ui";

const FAC_CITY: Record<string, string> = { "Dhaka North": "Dhaka", "Dhaka South": "Dhaka", Chattogram: "Chattogram", Gazipur: "Gazipur", Narayanganj: "Narayanganj" };
const LAYERS = { facilities: true, dghs: false, forecast: false, weather: false, buildings: false };
const mins = (s: number) => (s < 60 ? "under 1 min" : `${Math.round(s / 60)} min`);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function SurgeMap({ d, city, onCity }: { d: any; city: string | null; onCity: (c: string) => void }) {
  const mapRef = useRef<MapHandle>(null);
  const fac = useAsync((s) => api<any>("/api/facilities?kind=hospital", { signal: s, ttl: 600_000 }), []);
  const [els, setEls] = useState<Record<string, HTMLElement | null>>({});
  const onOverlay = useCallback((k: string, el: HTMLElement | null) => setEls((o) => ({ ...o, [k]: el })), []);
  const overlays = useMemo(() => d.cities.filter((c: any) => CITY_POS[c.city]).map((c: any) => ({ key: c.city, lngLat: CITY_POS[c.city] as LngLat })), [d.cities]);
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<any>(null);
  const [origin, setOrigin] = useState<LngLat | null>(null);
  const [near, setNear] = useState<any>(null);
  const [route, setRoute] = useState<{ fastest?: LngLat[]; shortest?: LngLat[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const reduce = reduceMotion();

  const feats: any[] = fac.data?.features ?? [];
  const counts = useMemo(() => { const n: Record<string, number> = {}; feats.forEach((f) => { n[f.properties.city] = (n[f.properties.city] ?? 0) + 1; }); return n; }, [feats]);
  const hits = useMemo(() => { const q = find.trim().toLowerCase(); return q.length < 2 ? [] : feats.filter((f) => f.properties.name?.toLowerCase().includes(q)).slice(0, 6); }, [find, feats]);
  const sel = city ? d.cities.find((c: any) => c.city === city) : null;

  const pickFacility = (f: any) => {
    const props = typeof f.properties?.phone === "string" ? { ...f.properties, phone: JSON.parse(f.properties.phone || "[]") } : f.properties;   // MapLibre stringifies arrays
    setPicked({ ...f, properties: props }); setFind(""); mapRef.current?.flyTo(f.geometry.coordinates, 14);
  };
  const nearest = async (p: LngLat) => {
    setOrigin(p); setBusy(true); setErr(null); setRoute(null);
    try {
      const r = await api<any>(`/api/emergency/nearest?${qs({ lat: p[1], lon: p[0], k: 3 })}`, { ttl: 60_000 });
      setNear(r);
      const top = r.results?.[0];
      if (top) { setRoute({ fastest: top.geometry.coordinates, label: `Fastest road route to ${top.facility.properties.name}` }); mapRef.current?.fit([p, top.facility.geometry.coordinates]); }
    } catch (e: any) { setNear(null); setErr(e instanceof ApiError ? e.message : "The road search failed."); }
    finally { setBusy(false); }
  };
  const routeTo = async (f: any) => {
    if (!origin) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<any>(`/api/route?${qs({ from_lat: origin[1], from_lon: origin[0], to_facility: f.properties.id })}`, { ttl: 300_000 });
      setRoute({ fastest: r.routes.fastest.geometry.coordinates, shortest: r.routes.shortest?.geometry.coordinates, label: `A* routes to ${f.properties.name}: fastest ${mins(r.routes.fastest.est_time_s)}` });
      mapRef.current?.fit(r.routes.fastest.geometry.coordinates);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Routing failed."); }
    finally { setBusy(false); }
  };

  return (<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div className="min-w-0">
      <CommandMap ref={mapRef} facilities={fac.data ?? null} dghs={null} cityRisk={[]} weather={[]} layers={LAYERS} origin={origin} routes={route ?? {}} routeMode="both"
        dest={route && picked ? picked.geometry.coordinates : null} selectedId={picked?.properties.id ?? null} reduce={reduce} height="min(560px, 70vh)"
        onPick={nearest} onFacility={pickFacility} overlays={overlays} onOverlay={onOverlay} />
      {Object.entries(els).map(([k, el]) => { const c = d.cities.find((x: any) => x.city === k); return el && c ? createPortal(<Gauge c={c} on={city === k} onClick={() => { onCity(k); mapRef.current?.flyTo(CITY_POS[k] as LngLat, 11.5); }} />, el, k) : null; })}
      <p className="mt-2 text-[12px] leading-relaxed text-ink-3">Blue points are {fac.data ? fac.data.meta.count : "the"} OpenStreetMap hospitals bundled with the app; roads and routing are bundled too, so both work offline (the street basemap needs the internet).
        Gauges sit at city centres and sum that city&apos;s synthetic wards: illustrative beds, not any hospital&apos;s beds. Tap the map to find the nearest hospitals by road.</p>
    </div>

    <aside aria-label="Map inspector" className="ops-panel h-fit p-4 lg:sticky lg:top-[calc(var(--ops-top,108px)+112px)]">
      <label className="block text-[12px] font-semibold text-ink-3" htmlFor="sm-find">Find a hospital</label>
      <input id="sm-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, e.g. Medical College" autoComplete="off"
        className="mt-1 h-10 w-full rounded-lg border border-[#3a3e66] bg-[#0e0f1a] px-3 text-[13px] text-ink placeholder:text-ink-3" />
      {hits.length > 0 && <ul className="mt-1 grid gap-0.5">{hits.map((f) => (<li key={f.properties.id}><button type="button" onClick={() => pickFacility(f)} className="w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-[#232745]">{f.properties.name}<span className="block text-[11px] text-ink-3">{f.properties.city}</span></button></li>))}</ul>}

      {sel && (<div className="mt-4 border-t border-line pt-3">
        <div className="text-[12px] text-ink-3">Planning view, city aggregate</div>
        <div className="font-display text-[19px] font-extrabold text-ink">{sel.city}</div>
        <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">{([["Projected bed need", sel.demand], ["Illustrative beds", sel.capacity], ["Moved within city", sel.transferred], ["No bed in city", sel.unresolved],
          ["Stage 1 bed stock", sel.regional_supply_scenario], [`OSM hospitals (${FAC_CITY[sel.city]})`, counts[FAC_CITY[sel.city]] ?? "…"]] as [string, any][]).flatMap(([k, v]) => [<dt key={`k${k}`} className="text-ink-3">{k}</dt>, <dd key={`v${k}`} className="text-right text-ink">{v}</dd>])}</dl>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-3">Stage 1 stock is the same beds seen as supply; it is shown for comparison and never added to the illustrative beds.{FAC_CITY[sel.city] === "Dhaka" ? " Both Dhaka corporations share one OSM hospital list." : ""}</p>
      </div>)}

      {picked && (<div className="mt-4 border-t border-line pt-3">
        <div className="text-[12px] text-ink-3">OpenStreetMap hospital</div>
        <div className="text-[15px] font-bold leading-snug text-ink">{picked.properties.name}</div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-3">Emergency tag</dt><dd className="text-ink">{picked.properties.emergency_status === "yes" ? "tagged emergency=yes (community-mapped)" : picked.properties.emergency_status === "no" ? "tagged emergency=no" : "not tagged, unknown"}</dd>
          <dt className="text-ink-3">Source</dt><dd className="text-ink">{picked.properties.verification}</dd>
          {picked.properties.beds_tagged && <><dt className="text-ink-3">Beds tag</dt><dd className="text-ink">{picked.properties.beds_tagged} (OSM tag, unverified; not used in planning)</dd></>}
        </dl>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!origin || busy} onClick={() => routeTo(picked)} className="ops-chip disabled:opacity-50">{origin ? "Route from the start point" : "Tap the map to set a start"}</button>
          <a href={picked.properties.osm_url} target="_blank" rel="noreferrer" className="ops-chip">Open in OSM</a></div>
      </div>)}

      {(near || busy || err) && (<div className="mt-4 border-t border-line pt-3" aria-live="polite">
        <div className="text-[12px] font-semibold text-ink-3">Nearest hospitals by road from the start point</div>
        {busy && <p className="mt-1 text-[12.5px] text-ink-2">Searching the bundled road graph…</p>}
        {err && <p className="mt-1 text-[12.5px] text-coral-d">{err}</p>}
        {near?.results?.length > 0 && <ol className="mt-1 grid gap-1">{near.results.map((r: any) => (<li key={r.facility.properties.id}>
          <button type="button" onClick={() => { setPicked(r.facility); setRoute({ fastest: r.geometry.coordinates, label: `Fastest road route to ${r.facility.properties.name}` }); mapRef.current?.fit(r.geometry.coordinates); }}
            className="w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-[#232745]">{r.facility.properties.name}<span className="num block text-[11px] text-ink-3">{mins(r.est_time_s)}, {km(r.distance_m)} (estimated)</span></button></li>))}</ol>}
        {route && <p className="mt-2 text-[11.5px] text-ink-3">{route.label}. Travel times use assumed road speeds, not live traffic.</p>}
      </div>)}
    </aside>
  </div>);
}

/** A city-centre planning gauge: illustrative beds against projected need, the overflow beyond them, and what moved within the city. */
function Gauge({ c, on, onClick }: { c: any; on: boolean; onClick: () => void }) {
  const top = Math.max(c.demand, c.capacity, 1);
  return (<button type="button" onClick={onClick} aria-pressed={on}
    aria-label={`${c.city}, synthetic-ward aggregate: ${c.demand} projected bed need, ${c.capacity} illustrative beds, ${c.transferred} moved, ${c.unresolved} without a bed`}
    className={"block w-[156px] rounded-xl border px-2.5 py-2 text-left font-sans shadow-[0_8px_24px_-10px_rgba(0,0,0,.7)] " + (on ? "border-[#ffd36e] bg-[#1c1f36]" : "border-[#3a3e66] bg-[#151729]")}>
    <span className="flex items-baseline justify-between gap-2"><b className="text-[12.5px] text-[#eef0ff]">{c.city}</b>{c.unresolved > 0 && <b className="num text-[11.5px] text-[#ff9a9f]">{c.unresolved} short</b>}</span>
    <span className="relative mt-1.5 block h-2 overflow-hidden rounded-full bg-[#262a48]">
      <span className="ops-growx absolute inset-0 rounded-full" style={{ background: "#ff6b72", transform: `scaleX(${c.demand / top})` }} />
      <span className="ops-growx absolute inset-0 rounded-full" style={{ background: "#b4a6ff", transform: `scaleX(${Math.min(c.demand, c.capacity) / top})` }} />
    </span>
    <span className="num mt-1 block text-[11px] text-[#c6c9e8]">{c.demand} need, {c.capacity} beds{c.transferred > 0 ? `, ${c.transferred} moved` : ""}</span>
  </button>);
}
