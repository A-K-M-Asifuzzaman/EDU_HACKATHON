"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { api, qs, ApiError, isoMonday, type Forecast } from "@/lib/api";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { cls, dateFmt } from "@/lib/format";
import ControlsBar from "@/components/controls";
import RiskMatrix from "@/components/riskmatrix";
import { CITY_POS } from "@/components/citymap";
import { Btn, Card, CardTitle, DataTable, EmptyState, Loading, Notice, PageHeader, ProvChip, Segmented, useAsync, useToast } from "@/components/ui";
import type { CityOverlay, Layers, LngLat, MapHandle, WeatherPt } from "@/components/commandmap";

const CommandMap = dynamic(() => import("@/components/commandmap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-canvas" /> });
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const JUMP: Record<string, { c: LngLat; z: number }> = { Dhaka: { c: [90.405, 23.78], z: 12 }, Narayanganj: { c: [90.5, 23.62], z: 13 }, Gazipur: { c: [90.42, 24.0], z: 12.4 }, Chattogram: { c: [91.81, 22.34], z: 12 } };
const WX: Record<string, LngLat> = { Dhaka: [90.4125, 23.8103], Chattogram: [91.7832, 22.3569], Gazipur: [90.4203, 23.9999], Narayanganj: [90.5, 23.6238] };
const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
// External navigation hand-off (links only; no data is fetched from these services)
const gmaps = (o: LngLat | null, d: LngLat) => `https://www.google.com/maps/dir/?api=1${o ? `&origin=${o[1]},${o[0]}` : ""}&destination=${d[1]},${d[0]}&travelmode=driving`;
const osmDir = (o: LngLat | null, d: LngLat) => `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${o ? `${o[1]}%2C${o[0]}` : ""}%3B${d[1]}%2C${d[0]}`;

function NavLinks({ origin, dest }: { origin: LngLat | null; dest: LngLat }) {
  return (<div className="flex flex-wrap gap-2 text-[12px]">
    <a href={gmaps(origin, dest)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line bg-white px-2.5 py-1.5 font-medium hover:border-teal">Open in Google Maps ↗</a>
    <a href={osmDir(origin, dest)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line bg-white px-2.5 py-1.5 font-medium hover:border-teal">OpenStreetMap directions ↗</a></div>);
}

export default function GeoCommand() {
  const { t, lang } = useI18n();
  const { sel, set, ready } = useSel();
  const toast = useToast();
  const reduce = !!useReducedMotion();
  const mapRef = useRef<MapHandle>(null);
  const [layers, setLayers] = useState<Layers>({ facilities: true, dghs: false, forecast: true, weather: true, buildings: false });
  const [bldAvail, setBldAvail] = useState<boolean | null>(null);
  const [origin, setOrigin] = useState<LngLat | null>(null);
  const [originLabel, setOriginLabel] = useState("");
  const [picked, setPicked] = useState<any | null>(null);
  const [tab, setTab] = useState<"facility" | "route" | "nearest">("facility");
  const [route, setRoute] = useState<any | null>(null);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  const [routeMode, setRouteMode] = useState<"fastest" | "shortest" | "both">("both");
  const [insightOn, setInsightOn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nearest, setNearest] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [kind, setKind] = useState<"all" | "hospital" | "clinic">("all");
  const [sheet, setSheet] = useState(false);          // mobile bottom sheet expanded
  const [layersOpen, setLayersOpen] = useState(false); // mobile layer panel

  const fac = useAsync((s) => api("/api/facilities", { signal: s, ttl: 600_000 }), []);
  const rstat = useAsync((s) => api("/api/routing/status", { signal: s, ttl: 600_000 }), []);
  const dghs = useAsync((s) => (layers.dghs ? api("/api/geo/dghs/wards", { signal: s, ttl: 600_000 }) : Promise.resolve(null)), [layers.dghs]);
  const risk = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: sel.horizon, source: srcParam(sel) })}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const wx = useAsync((s) => (layers.weather ? Promise.all(Object.keys(WX).map((c) => api(`/api/climate/current?city=${c}`, { signal: s, ttl: 600_000 }).catch(() => null))) : Promise.resolve([])), [layers.weather]);

  const wards: Forecast[] = risk.data?.wards ?? [];
  const cityRisk: CityOverlay[] = useMemo(() => Object.values(wards.reduce((a: any, w) => { const c = (a[w.city] ??= { city: w.city, wards: 0, alerts: 0, p: 0, expected: 0 }); c.wards++; c.alerts += w.outbreak_alert ? 1 : 0; c.p += w.p_outbreak; c.expected += w.expected_cases; return a; }, {}))
    .filter((c: any) => CITY_POS[c.city]).map((c: any) => ({ city: c.city, lon: CITY_POS[c.city][0], lat: CITY_POS[c.city][1], meanP: c.p / c.wards, alerts: c.alerts, wards: c.wards, expected: c.expected })), [wards]);
  const weather: WeatherPt[] = useMemo(() => (wx.data ?? []).flatMap((d: any, i: number) => {
    const c = Object.keys(WX)[i]; const cur = d?.current; if (!cur) return [];
    return [{ city: c, lon: WX[c][0], lat: WX[c][1], label: `${c} ${Math.round(cur.temperature_c)}°C · ${cur.precipitation_mm} mm`, title: `Open-Meteo current conditions at ${c} city centre, observed ${cur.observed_at} (Asia/Dhaka). Real weather; not a model input.` }];
  }), [wx.data]);
  const facilities = useMemo(() => (fac.data ? { type: "FeatureCollection", features: fac.data.features.filter((f: any) => kind === "all" || f.properties.kind === kind) } : null), [fac.data, kind]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2 || !fac.data) return [];
    return fac.data.features.filter((f: any) => [f.properties.name, f.properties.name_bn, f.properties.address, f.properties.operator].some((v) => v && String(v).toLowerCase().includes(s))).slice(0, 6);
  }, [q, fac.data]);

  useEffect(() => {   // place search: MapTiler geocoding (Bangladesh only), debounced; facilities are searched locally
    if (!KEY || q.trim().length < 3) { setPlaces([]); return; }
    const ac = new AbortController();
    const id = setTimeout(() => fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q.trim())}.json?key=${KEY}&country=bd&limit=4&language=en`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { features: [] })).then((d) => setPlaces(d.features ?? [])).catch(() => {}), 350);
    return () => { clearTimeout(id); ac.abort(); };
  }, [q]);

  const selectFacility = useCallback((f: any, fly = true) => {
    const props = typeof f.properties?.phone === "string" ? { ...f.properties, phone: JSON.parse(f.properties.phone || "[]") } : f.properties;   // MapLibre stringifies arrays
    setPicked({ ...f, properties: props }); setTab("facility"); setRoute(null); setRouteErr(null); setSheet(true);
    if (fly) mapRef.current?.flyTo(f.geometry.coordinates, 15);
  }, []);

  const getRoute = useCallback(async (f: any, from: LngLat | null = origin, withInsight = insightOn) => {
    if (!from) { toast("Set a starting point first: use your location, search a place, or click the map."); return; }
    setBusy("route"); setRouteErr(null); setTab("route"); setSheet(true);
    try {
      const r = await api(`/api/route?${qs({ from_lat: from[1], from_lon: from[0], to_facility: f.properties.id, insight: withInsight || undefined })}`, { ttl: 300_000 });
      setRoute({ ...r, from }); mapRef.current?.fit(r.routes.fastest.geometry.coordinates);
    } catch (e: any) { setRoute(null); setRouteErr(e instanceof ApiError ? e.message : "Routing failed."); }
    finally { setBusy(null); }
  }, [origin, insightOn, toast]);

  const toggleInsight = () => { const on = !insightOn; setInsightOn(on); if (on && route?.facility && !route.insight) getRoute(route.facility, route.from, true); };

  const findNearest = useCallback(async (from: LngLat) => {
    setBusy("nearest"); setTab("nearest"); setNearest(null); setRoute(null); setSheet(true);
    try { const r = await api(`/api/emergency/nearest?${qs({ lat: from[1], lon: from[0], k: 5 })}`, { ttl: 60_000 }); setNearest(r); if (r.results?.[0]) mapRef.current?.fit(r.results[0].geometry.coordinates); }
    catch (e: any) { setNearest({ error: e instanceof ApiError ? e.message : "Search failed." }); }
    finally { setBusy(null); }
  }, []);

  const locate = useCallback((thenNearest = false) => {
    if (!navigator.geolocation) { toast("Location is not available in this browser. Click the map instead."); return; }
    setBusy("locate");
    navigator.geolocation.getCurrentPosition((pos) => {
      const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
      setOrigin(p); setOriginLabel(`Your location (±${Math.round(pos.coords.accuracy)} m)`); setBusy(null); mapRef.current?.flyTo(p, 14);
      if (thenNearest) findNearest(p);
    }, (err) => { setBusy(null); toast(err.code === 1 ? "Location permission was denied. Click the map to set a starting point." : "Could not get your location. Click the map instead."); }, { enableHighAccuracy: true, timeout: 10_000 });
  }, [findNearest, toast]);

  useEffect(() => { if (new URLSearchParams(window.location.search).get("emergency") === "1") locate(true); }, [locate]);
  useEffect(() => {   // deep link from the global search: /geography/?facility=osm:node/123
    const id = new URLSearchParams(window.location.search).get("facility");
    const f = id && fac.data?.features.find((x: any) => x.properties.id === id);
    if (f) selectFacility(f);
  }, [fac.data, selectFacility]);

  const onPick = useCallback((p: LngLat) => { setOrigin(p); setOriginLabel(`Map point ${p[1].toFixed(4)}, ${p[0].toFixed(4)}`); }, []);
  const routes = useMemo(() => (route ? { fastest: route.routes.fastest.geometry.coordinates, shortest: route.routes.shortest.geometry.coordinates } : nearest?.results?.[0] && tab === "nearest" ? { fastest: nearest.results[0].geometry.coordinates } : {}), [route, nearest, tab]);
  const explored = useMemo(() => (insightOn && route?.insight ? { astar: route.insight.astar.explored, dijkstra: route.insight.dijkstra.explored } : null), [insightOn, route]);
  const dest: LngLat | null = route?.facility?.geometry?.coordinates ?? (tab === "nearest" ? nearest?.results?.[0]?.facility?.geometry?.coordinates : null) ?? null;
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const m = rstat.data?.manifest;
  const P = picked?.properties;

  const dirCols = [
    { key: "name", label: "Name", render: (f: any) => <button className="text-left font-semibold text-forest hover:underline" onClick={() => { selectFacility(f); window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); }}>{f.properties.name ?? <i className="font-normal text-ink-3">Unnamed in OSM</i>}{f.properties.name_bn && <span className="block text-[11px] font-normal text-ink-3" lang="bn">{f.properties.name_bn}</span>}</button>, sort: (f: any) => f.properties.name ?? "~" },
    { key: "kind", label: "Type", render: (f: any) => f.properties.kind, sort: (f: any) => f.properties.kind },
    { key: "city", label: "City", render: (f: any) => f.properties.city, sort: (f: any) => f.properties.city },
    { key: "phone", label: "Phone", render: (f: any) => f.properties.phone?.length ? <a className="text-emerald underline" href={tel(f.properties.phone[0])}>{f.properties.phone[0]}</a> : <span className="text-ink-3">not listed</span> },
    { key: "emergency", label: "Emergency (tagged)", render: (f: any) => f.properties.emergency ?? "unknown" },
  ];
  const dirRows = useMemo(() => (facilities?.features ?? []).filter((f: any) => !q.trim() || [f.properties.name, f.properties.name_bn, f.properties.address].some((v: any) => v && String(v).toLowerCase().includes(q.trim().toLowerCase()))), [facilities, q]);

  const panel = (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      {tab === "facility" && (P ? (<div className="space-y-2.5">
        <div><div className="text-[17px] font-bold leading-snug text-navy">{P.name ?? "Unnamed facility"}</div>{P.name_bn && <div lang="bn" className="text-ink-3">{P.name_bn}</div>}<div className="mt-1.5 flex flex-wrap gap-1.5"><ProvChip>{P.kind}</ProvChip><ProvChip>{P.city}</ProvChip>{P.operator_type && <ProvChip>{P.operator_type}</ProvChip>}</div></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {P.operator && <><dt className="text-ink-3">Operator</dt><dd>{P.operator}</dd></>}
          {P.address && <><dt className="text-ink-3">Address</dt><dd>{P.address}</dd></>}
          <dt className="text-ink-3">Phone</dt><dd>{P.phone?.length ? P.phone.map((ph: string) => <a key={ph} href={tel(ph)} className="mr-2 font-semibold text-emerald underline">📞 {ph}</a>) : <span className="text-ink-3">not listed in OSM</span>}</dd>
          {P.website && <><dt className="text-ink-3">Website</dt><dd><a href={P.website} target="_blank" rel="noopener noreferrer" className="break-all text-emerald underline">{P.website.replace(/^https?:\/\//, "").slice(0, 40)}</a></dd></>}
          <dt className="text-ink-3">Emergency</dt><dd>{P.emergency ?? "unknown"} <span className="text-[11px] text-ink-3">(as tagged)</span></dd>
          {P.beds_tagged && <><dt className="text-ink-3">Beds</dt><dd>{P.beds_tagged} <span className="text-[11px] text-ink-3">(as tagged, not live)</span></dd></>}
        </dl>
        <div className="rounded-xl bg-amber/10 p-2.5 text-[11.5px] leading-snug text-ink-2"><b>Verification:</b> {P.verification}. Last edited {P.last_edited?.slice(0, 10) ?? "unknown"} · <a href={P.osm_url} target="_blank" rel="noopener noreferrer" className="underline">source record</a>. No live beds, admissions or doctors on duty: call ahead.</div>
        <div className="flex flex-wrap gap-2 pt-0.5"><Btn onClick={() => getRoute(picked)} disabled={busy === "route"}>{busy === "route" ? "Routing…" : origin ? "Route from start" : "Set start to route"}</Btn>{P.phone?.[0] && <a href={tel(P.phone[0])} className="inline-flex items-center rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-mint-l">Call</a>}</div>
        <NavLinks origin={origin} dest={picked.geometry.coordinates} />
      </div>) : <EmptyState text="Select a hospital or clinic on the map, in the search box or in the directory below." />)}
      {tab === "route" && (routeErr ? <Notice tone="warn">{routeErr}</Notice> : busy === "route" && !route ? <p className="text-ink-3">Searching the road graph…</p> : route ? (<div className="space-y-3">
        <div className="font-semibold text-navy">To {route.facility?.properties?.name ?? "destination"}</div>
        <Segmented label="Show route" value={routeMode} onChange={(v) => setRouteMode(v as any)} options={[{ value: "fastest", label: "Fastest (est.)" }, { value: "shortest", label: "Shortest" }, { value: "both", label: "Both" }]} />
        <table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase text-ink-3"><th></th><th>Fastest (est.)</th><th>Shortest</th></tr></thead><tbody>
          <tr><td className="text-ink-3">Distance</td><td className="num font-semibold">{km(route.routes.fastest.distance_m)}</td><td className="num">{km(route.routes.shortest.distance_m)}</td></tr>
          <tr><td className="text-ink-3">Est. time</td><td className="num font-semibold">{mins(route.routes.fastest.est_time_s)}</td><td className="num">{mins(route.routes.shortest.est_time_s)}</td></tr>
          <tr><td className="text-ink-3">A* nodes</td><td className="num">{route.routes.fastest.expanded.toLocaleString()}</td><td className="num">{route.routes.shortest.expanded.toLocaleString()}</td></tr>
          <tr><td className="text-ink-3">A* time</td><td className="num">{route.routes.fastest.ms} ms</td><td className="num">{route.routes.shortest.ms} ms</td></tr>
          <tr><td className="text-ink-3">Dijkstra check</td>{(["fastest", "shortest"] as const).map((k) => <td key={k} className="num">{route.verification[k]?.equal ? <span className="text-emerald">✓ equal</span> : <span className="text-coral-d">✗</span>} <span className="text-ink-3">({route.verification[k]?.dijkstra_expanded.toLocaleString()} nodes)</span></td>)}</tr>
        </tbody></table>
        <div className="flex gap-3 text-[11px]"><span className="flex items-center gap-1"><i className="h-1.5 w-5 rounded bg-emerald" />fastest (arrows)</span><span className="flex items-center gap-1"><i className="h-0 w-5 border-t-2 border-dashed border-[#2563eb]" />shortest</span></div>
        <button role="switch" aria-checked={insightOn} onClick={toggleInsight} className={cls("flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[13px] font-medium", insightOn ? "border-cyan bg-cyan/10" : "border-line hover:border-teal")}>
          <span>A* Algorithm Insight</span><span className={cls("rounded-full px-2 py-0.5 text-[11px]", insightOn ? "bg-cyan text-white" : "bg-canvas text-ink-3")}>{insightOn ? (busy === "route" ? "loading" : "on") : "off"}</span></button>
        {insightOn && route.insight && (<div className="space-y-1.5 rounded-xl bg-navy p-3 text-[12px] leading-relaxed text-white/80">
          <div className="flex gap-3"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#22b8d6]" />A*: <b className="num text-white">{route.insight.astar.expanded.toLocaleString()}</b> nodes, {route.insight.astar.ms} ms</span></div>
          <div className="flex gap-3"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#e0a526]" />Dijkstra: <b className="num text-white">{route.insight.dijkstra.expanded.toLocaleString()}</b> nodes, {route.insight.dijkstra.ms} ms</span></div>
          <p>Both find the same shortest-distance route ({route.insight.cost_equal ? "costs equal ✓" : "costs differ ✗"}). Dijkstra grows outward in every direction; A* adds the straight-line distance to the hospital as a lower bound, so it explores {(route.insight.dijkstra.expanded / Math.max(1, route.insight.astar.expanded)).toFixed(1)}× fewer nodes toward the goal. The map shows an even sample of up to {route.insight.sample_cap.toLocaleString()} explored nodes each.</p></div>)}
        <NavLinks origin={route.from} dest={route.facility.geometry.coordinates} />
        <p className="text-[11px] leading-relaxed text-ink-3"><b>Estimates:</b> times assume free-flow speeds by road class ({Object.entries(route.speeds_kmh).map(([k, v]) => `${k} ${v}`).join(", ")} km/h); no traffic data. <b>Facts:</b> road geometry and one-way rules from OSM. Start snapped {route.origin.snap_m} m and destination {route.destination.snap_m} m to the nearest intersection. {route.attribution}.</p>
      </div>) : <EmptyState text="Pick a facility and press “Route from start”." />)}
      {tab === "nearest" && (busy === "nearest" ? <p className="text-ink-3">Searching the road network…</p> : nearest?.error ? <Notice tone="warn">{nearest.error}</Notice> : nearest?.results ? (<div className="space-y-2">
        <p className="text-[11px] text-ink-3">Closest hospitals by estimated road travel time ({nearest.method}, {nearest.search_ms} ms).</p>
        {nearest.results.map((r: any, i: number) => (<div key={r.facility.properties.id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-2"><button className="min-w-0 text-left font-semibold text-forest hover:underline" onClick={() => selectFacility(r.facility)}>{i + 1}. {r.facility.properties.name ?? "Unnamed hospital"}</button><span className="num shrink-0 whitespace-nowrap text-xs font-bold">{mins(r.est_time_s)} · {km(r.distance_m)}</span></div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">{r.facility.properties.phone?.[0] ? <a className="font-semibold text-emerald underline" href={tel(r.facility.properties.phone[0])}>📞 {r.facility.properties.phone[0]}</a> : <span className="text-ink-3">no phone in OSM</span>}<button className="underline" onClick={() => getRoute(r.facility)}>route</button><a className="underline" href={gmaps(origin, r.facility.geometry.coordinates)} target="_blank" rel="noopener noreferrer">Google Maps ↗</a></div></div>))}
        <p className="text-[11px] text-ink-3">{nearest.note}</p>
      </div>) : <EmptyState text="Press “Nearest hospitals by road” to search from your starting point." />)}
    </div>);

  return (<>
    <PageHeader eyebrow="Geospatial command center" title={t("nav.geography")} sub="Real hospitals and clinics from OpenStreetMap, A* routing on the directed road network, city-level forecast and weather overlays. Forecasts stay at city level: the dataset's ward IDs cannot be placed on real wards." />
    <Notice tone="warn"><b>Not live hospital information.</b> {fac.data?.meta?.note ?? "Facility data are community-mapped."} In an emergency call <a className="font-bold underline" href="tel:999">999</a>.</Notice>

    <section className="ds-map-shell relative mt-4 h-[78vh] min-h-[560px] overflow-hidden rounded-[22px] border border-line shadow-[var(--shadow-pop)] lg:h-[min(860px,calc(100vh-150px))] lg:min-h-[640px]" aria-label="Map and emergency routing workspace">
      <CommandMap ref={mapRef} height="100%" facilities={facilities} dghs={dghs.data && !(dghs.data as any).status ? dghs.data : null} cityRisk={cityRisk} weather={weather} layers={layers} origin={origin} routes={routes} selectedId={P?.id}
        routeMode={routeMode} dest={dest} explored={explored} reduce={reduce} onPick={onPick} onFacility={(f) => selectFacility(f, false)} onBuildings={setBldAvail} />

      {/* floating search dock */}
      <div className="glass absolute left-3 top-3 z-10 w-[min(440px,calc(100%-24px))] rounded-2xl p-3 shadow-[var(--shadow-pop)]">
        <label className="sr-only" htmlFor="geo-search">Search hospitals, clinics or places</label>
        <input id="geo-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hospitals, clinics or places…" autoComplete="off" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-teal" />
        {(matches.length > 0 || places.length > 0) && (<div className="absolute inset-x-3 z-20 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-xl" role="listbox" aria-label="Search results">
          {matches.map((f: any) => (<button key={f.properties.id} role="option" aria-selected={false} onClick={() => { selectFacility(f); setQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-mint-l"><b>{f.properties.name ?? "Unnamed"}</b> <span className="text-xs text-ink-3">{f.properties.kind} · {f.properties.city}</span></button>))}
          {places.map((pl: any) => (<button key={pl.id} role="option" aria-selected={false} onClick={() => { const c = pl.center as LngLat; setOrigin(c); setOriginLabel(pl.place_name); mapRef.current?.flyTo(c, 15); setQ(""); }} className="block w-full border-t border-line px-3 py-2 text-left text-sm hover:bg-mint-l">📍 {pl.place_name} <span className="text-xs text-ink-3">set as start · MapTiler</span></button>))}
        </div>)}
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn onClick={() => locate(false)} disabled={busy === "locate"} className="flex-1">{busy === "locate" ? "Locating…" : "Use my location"}</Btn>
          <Btn variant="danger" onClick={() => (origin ? findNearest(origin) : locate(true))} className="flex-1">Nearest hospitals by road</Btn>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">{Object.keys(JUMP).map((c) => (<button key={c} onClick={() => mapRef.current?.flyTo(JUMP[c].c, JUMP[c].z)} className="rounded-lg px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-white">{c}</button>))}</div>
        <div className="mt-1 truncate text-[11px] text-ink-3">{originLabel ? <><b>Start:</b> {originLabel}</> : "Tip: click anywhere on the map to set a starting point."}</div>
      </div>

      {/* floating layers + legend */}
      <button onClick={() => setLayersOpen((o) => !o)} className="glass absolute bottom-10 left-3 z-10 rounded-xl px-3 py-2 text-[12px] font-semibold shadow-lg lg:hidden" aria-expanded={layersOpen}>Layers</button>
      <div className={cls("glass absolute bottom-10 left-3 z-10 w-[260px] rounded-2xl p-3 shadow-[var(--shadow-pop)] lg:block", layersOpen ? "block mb-11 lg:mb-0" : "hidden")}>
        <div className="eyebrow mb-1.5">Layers</div>
        <div className="flex flex-wrap gap-1.5">{([["facilities", "Facilities"], ["forecast", "City forecast"], ["weather", "Weather now"], ["dghs", "DGHS boundaries"], ["buildings", "3D buildings"]] as [keyof Layers, string][]).map(([k, l]) => (
          <button key={k} role="switch" aria-checked={layers[k]} disabled={k === "buildings" && bldAvail === false} onClick={() => toggle(k)} className={cls("rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40", layers[k] ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2 hover:border-teal")}>{l}</button>))}</div>
        <div className="mt-2 flex gap-1">{(["all", "hospital", "clinic"] as const).map((v) => (<button key={v} onClick={() => setKind(v)} aria-pressed={kind === v} className={cls("rounded-lg px-2 py-0.5 text-[11.5px]", kind === v ? "bg-teal text-white" : "text-ink-2 hover:bg-white")}>{v === "all" ? t("ctl.all") : v === "hospital" ? "Hospitals" : "Clinics"}</button>))}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-line pt-2 text-[10.5px] text-ink-2">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]" />Hospital (OSM)</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#0f766e]" />Clinic (OSM)</span>
          <span className="flex items-center gap-1.5"><i className="h-1 w-4 rounded bg-emerald" />Fastest (est.)</span><span className="flex items-center gap-1.5"><i className="w-4 border-t-2 border-dashed border-[#2563eb]" />Shortest</span>
          <span className="col-span-2 flex items-center gap-1.5"><i className="rounded-full border-2 border-amber px-1 text-[9px] font-bold">%</i>City forecast (synthetic wards, aggregated)</span></div>
        {layers.dghs && dghs.error && <p className="mt-2 text-[11px] text-coral-d">DGHS boundaries unavailable: {dghs.error.message}</p>}
        {bldAvail === false && <p className="mt-2 text-[11px] text-ink-3">3D buildings are not available on this basemap.</p>}
      </div>

      {/* details: right panel on desktop, bottom sheet on mobile */}
      <aside aria-label="Facility, route and nearest-hospital details" className={cls("glass absolute z-10 flex flex-col overflow-hidden shadow-[var(--shadow-pop)] transition-[height] duration-300",
        "inset-x-0 bottom-0 rounded-t-2xl lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-3 lg:w-[380px] lg:rounded-2xl", sheet ? "h-[62%] lg:h-auto" : "h-[52px] lg:h-auto")}>
        <button className="mx-auto mt-1.5 h-1.5 w-10 shrink-0 rounded-full bg-ink-3/40 lg:hidden" aria-label={sheet ? "Collapse details" : "Expand details"} onClick={() => setSheet((x) => !x)} />
        <div className="flex shrink-0 border-b border-line text-sm" role="tablist">{(["facility", "route", "nearest"] as const).map((k) => (<button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSheet(true); }} className={cls("flex-1 px-3 py-2.5 font-medium capitalize", tab === k ? "border-b-2 border-navy text-navy" : "text-ink-3")}>{k}</button>))}</div>
        {panel}
      </aside>
    </section>
    <p className="mt-2 text-[11px] leading-relaxed text-ink-3">City pills show the forecast aggregated over each city's synthetic wards for {dateFmt(sel.origin, lang)}, {sel.horizon} {t("ctl.weeks")} ahead. Blue = hospitals, teal = clinics (OpenStreetMap, community-mapped). Estimated times assume free-flow speeds; no traffic data.</p>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Card><CardTitle title={`Facility directory (${dirRows.length})`} sub="OpenStreetMap hospitals and clinics in the four covered cities. Click a name to show it on the map." />
        <Loading q={fac} h={200}>{() => dirRows.length ? <DataTable rows={dirRows} cols={dirCols} maxH={380} dense /> : <EmptyState />}</Loading>
        <p className="mt-2 text-[11px] text-ink-3">{fac.data?.meta?.attribution}. Data as of {Object.values(fac.data?.meta?.osm_timestamps ?? {})[0] as string ?? "unknown"}. No doctor rosters, bed availability or admission status exist in these sources.</p></Card>
      <Card><CardTitle title="Predictions: abstract ward-risk matrix" sub={`${sel.horizon} ${t("ctl.weeks")} · ${dateFmt(sel.origin, lang)} · synthetic ward IDs, no map position`} />
        <label className="mb-2 flex items-center gap-2 text-sm"><span className="eyebrow">Calendar</span><input type="date" aria-label="Forecast origin date" min="2019-01-07" max="2025-01-06" value={sel.origin} onChange={(e) => e.target.value && set({ origin: isoMonday(e.target.value) })} className="rounded-lg border border-line px-2 py-1" /><span className="text-[11px] text-ink-3">snaps to Monday</span></label>
        <ControlsBar show={["horizon"]} />
        <div className="mt-3"><Loading q={risk} h={240}>{() => <RiskMatrix wards={wards} />}</Loading></div></Card>
    </div>

    <Card className="mt-5"><CardTitle title="Routing engine diagnostics" sub="Directed, weighted OpenStreetMap road graphs; A* checked against Dijkstra" />
      {m ? (<div className="grid gap-4 lg:grid-cols-2">
        <DataTable dense rows={Object.entries(m.areas).map(([k, a]: any) => ({ k, ...a }))} cols={[{ key: "label", label: "Area" }, { key: "vertices", label: "Vertices", align: "right" as const }, { key: "directed_edges", label: "Directed edges", align: "right" as const }, { key: "total_road_km", label: "Road km", align: "right" as const }, { key: "oneway_segment_share", label: "One-way share", align: "right" as const }]} />
        <div className="text-[13px] leading-relaxed">{rstat.data?.benchmark ? (<p>Benchmark on {rstat.data.benchmark.pairs} random origin-destination pairs: A* matched Dijkstra's optimal cost in <b>{rstat.data.benchmark.equal_costs}/{rstat.data.benchmark.pairs}</b> cases; median A* {rstat.data.benchmark.astar_ms_median} ms vs Dijkstra {rstat.data.benchmark.dijkstra_ms_median} ms, expanding {rstat.data.benchmark.expanded_ratio_median}× fewer nodes (median).</p>) : <p className="text-ink-3">Benchmark not built.</p>}
          <ul className="mt-2 list-disc pl-5 text-[12px] text-ink-3">{m.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul></div>
      </div>) : <EmptyState text="Road graphs are not built (python scripts/build_geodata.py)." />}</Card>
  </>);
}
