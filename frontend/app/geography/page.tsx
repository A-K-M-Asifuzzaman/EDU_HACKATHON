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

const CommandMap = dynamic(() => import("@/components/commandmap"), { ssr: false, loading: () => <div className="h-[560px] animate-pulse rounded-xl bg-canvas" /> });
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const JUMP: Record<string, { c: LngLat; z: number }> = { Dhaka: { c: [90.405, 23.78], z: 12 }, Narayanganj: { c: [90.5, 23.62], z: 13 }, Gazipur: { c: [90.42, 24.0], z: 12.4 }, Chattogram: { c: [91.81, 22.34], z: 12 } };
const WX: Record<string, LngLat> = { Dhaka: [90.4125, 23.8103], Chattogram: [91.7832, 22.3569], Gazipur: [90.4203, 23.9999], Narayanganj: [90.5, 23.6238] };
const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

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
  const [busy, setBusy] = useState<string | null>(null);
  const [nearest, setNearest] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [kind, setKind] = useState<"all" | "hospital" | "clinic">("all");

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
  const facilities = useMemo(() => {
    if (!fac.data) return null;
    const feats = fac.data.features.filter((f: any) => kind === "all" || f.properties.kind === kind);
    return { type: "FeatureCollection", features: feats };
  }, [fac.data, kind]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2 || !fac.data) return [];
    return fac.data.features.filter((f: any) => [f.properties.name, f.properties.name_bn, f.properties.address, f.properties.operator].some((v) => v && String(v).toLowerCase().includes(s))).slice(0, 6);
  }, [q, fac.data]);

  // place search (MapTiler geocoding, Bangladesh only); facilities are searched locally
  useEffect(() => {
    if (!KEY || q.trim().length < 3) { setPlaces([]); return; }
    const ac = new AbortController();
    const id = setTimeout(() => fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q.trim())}.json?key=${KEY}&country=bd&limit=4&language=en`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { features: [] })).then((d) => setPlaces(d.features ?? [])).catch(() => {}), 350);
    return () => { clearTimeout(id); ac.abort(); };
  }, [q]);

  const selectFacility = useCallback((f: any, fly = true) => {
    const props = typeof f.properties?.phone === "string" ? { ...f.properties, phone: JSON.parse(f.properties.phone || "[]") } : f.properties;   // MapLibre stringifies arrays
    setPicked({ ...f, properties: props }); setTab("facility"); setRoute(null); setRouteErr(null);
    if (fly) mapRef.current?.flyTo(f.geometry.coordinates, 15);
  }, []);

  const getRoute = useCallback(async (f: any, from: LngLat | null = origin) => {
    if (!from) { toast("Set a starting point first: use your location, search a place, or click the map."); return; }
    setBusy("route"); setRouteErr(null); setTab("route");
    try {
      const r = await api(`/api/route?${qs({ from_lat: from[1], from_lon: from[0], to_facility: f.properties.id })}`, { ttl: 300_000 });
      setRoute(r); mapRef.current?.fit(r.routes.fastest.geometry.coordinates);
    } catch (e: any) { setRoute(null); setRouteErr(e instanceof ApiError ? e.message : "Routing failed."); }
    finally { setBusy(null); }
  }, [origin, toast]);

  const findNearest = useCallback(async (from: LngLat) => {
    setBusy("nearest"); setTab("nearest"); setNearest(null); setRoute(null);
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

  const onPick = useCallback((p: LngLat) => { setOrigin(p); setOriginLabel(`Map point ${p[1].toFixed(4)}, ${p[0].toFixed(4)}`); }, []);
  const routes = useMemo(() => (route ? { fastest: route.routes.fastest.geometry.coordinates, shortest: route.routes.shortest.geometry.coordinates } : nearest?.results?.[0] && tab === "nearest" ? { fastest: nearest.results[0].geometry.coordinates } : {}), [route, nearest, tab]);
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const m = rstat.data?.manifest;
  const P = picked?.properties;

  const dirCols = [
    { key: "name", label: "Name", render: (f: any) => <button className="text-left font-semibold text-forest hover:underline" onClick={() => selectFacility(f)}>{f.properties.name ?? <i className="font-normal text-ink-3">Unnamed in OSM</i>}{f.properties.name_bn && <span className="block text-[11px] font-normal text-ink-3" lang="bn">{f.properties.name_bn}</span>}</button>, sort: (f: any) => f.properties.name ?? "~" },
    { key: "kind", label: "Type", render: (f: any) => f.properties.kind, sort: (f: any) => f.properties.kind },
    { key: "city", label: "City", render: (f: any) => f.properties.city, sort: (f: any) => f.properties.city },
    { key: "phone", label: "Phone", render: (f: any) => f.properties.phone?.length ? <a className="text-emerald underline" href={tel(f.properties.phone[0])}>{f.properties.phone[0]}</a> : <span className="text-ink-3">not listed</span> },
    { key: "emergency", label: "Emergency (tagged)", render: (f: any) => f.properties.emergency ?? "unknown" },
  ];
  const dirRows = useMemo(() => (facilities?.features ?? []).filter((f: any) => !q.trim() || matches.includes(f) || [f.properties.name, f.properties.name_bn, f.properties.address].some((v: any) => v && String(v).toLowerCase().includes(q.trim().toLowerCase()))), [facilities, q, matches]);

  return (<>
    <PageHeader eyebrow="Geospatial command center" title={t("nav.geography")} sub="Hospitals and clinics from OpenStreetMap, A* routing on the real directed road network, city-level forecast and weather overlays, and DGHS boundaries for context. Forecasts stay at city level: the dataset's ward IDs cannot be placed on real wards." />
    <Notice tone="warn"><b>Not live hospital information.</b> {fac.data?.meta?.note ?? "Facility data are community-mapped."} In an emergency call <a className="font-bold underline" href="tel:999">999</a>.</Notice>

    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="relative min-w-[240px] flex-1">
          <label className="eyebrow mb-1 block" htmlFor="geo-search">Search hospitals, clinics or places</label>
          <input id="geo-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Dhaka Medical, Mirpur 10" autoComplete="off" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-sm" />
          {(matches.length > 0 || places.length > 0) && (<div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-xl" role="listbox" aria-label="Search results">
            {matches.map((f: any) => (<button key={f.properties.id} role="option" aria-selected={false} onClick={() => { selectFacility(f); setQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-mint-l"><b>{f.properties.name ?? "Unnamed"}</b> <span className="text-xs text-ink-3">{f.properties.kind} · {f.properties.city}</span></button>))}
            {places.map((pl: any) => (<button key={pl.id} role="option" aria-selected={false} onClick={() => { const c = pl.center as LngLat; setOrigin(c); setOriginLabel(pl.place_name); mapRef.current?.flyTo(c, 15); setQ(""); }} className="block w-full border-t border-line px-3 py-2 text-left text-sm hover:bg-mint-l">📍 {pl.place_name} <span className="text-xs text-ink-3">set as start · MapTiler</span></button>))}
          </div>)}
        </div>
        <Btn onClick={() => locate(false)} disabled={busy === "locate"}>{busy === "locate" ? "Locating…" : "Use my location"}</Btn>
        <Btn variant="danger" onClick={() => (origin ? findNearest(origin) : locate(true))}>Nearest hospitals by road</Btn>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Jump to" value="" onChange={(c: string) => mapRef.current?.flyTo(JUMP[c].c, JUMP[c].z)} options={Object.keys(JUMP).map((c) => ({ value: c, label: c }))} />
        <Segmented label="Facilities" value={kind} onChange={(v) => setKind(v as any)} options={[{ value: "all", label: t("ctl.all") }, { value: "hospital", label: "Hospitals" }, { value: "clinic", label: "Clinics" }]} />
        <div className="flex flex-col gap-1"><span className="eyebrow">Layers</span><div className="flex flex-wrap gap-1.5">
          {([["facilities", "Facilities"], ["forecast", "City forecast"], ["weather", "Weather now"], ["dghs", "DGHS boundaries"], ["buildings", "3D buildings"]] as [keyof Layers, string][]).map(([k, l]) => (
            <button key={k} role="switch" aria-checked={layers[k]} disabled={k === "buildings" && bldAvail === false} onClick={() => toggle(k)} className={cls("rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40", layers[k] ? "border-forest bg-forest text-white" : "border-line bg-white text-ink-2 hover:border-emerald")}>{l}</button>))}
        </div></div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div>
          <CommandMap ref={mapRef} facilities={facilities} dghs={dghs.data && !(dghs.data as any).status ? dghs.data : null} cityRisk={cityRisk} weather={weather} layers={layers} origin={origin} routes={routes} selectedId={P?.id}
            reduce={reduce} onPick={onPick} onFacility={(f) => selectFacility(f, false)} onBuildings={setBldAvail} />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">Click the map to set a starting point{originLabel && <> · <b>Start:</b> {originLabel}</>}. Blue circles are hospitals, teal are clinics (OpenStreetMap). Coloured city discs show the forecast aggregated over each city's synthetic wards for {dateFmt(sel.origin, lang)}, {sel.horizon} {t("ctl.weeks")} ahead. {layers.dghs && dghs.error && <>DGHS boundaries unavailable: {dghs.error.message}. </>}{bldAvail === false && "3D buildings are not available on this basemap."}</p>
        </div>
        <aside className="flex min-h-[300px] flex-col rounded-xl border border-line bg-white" aria-label="Facility, route and nearest-hospital details">
          <div className="flex border-b border-line text-sm" role="tablist">{(["facility", "route", "nearest"] as const).map((k) => (<button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cls("flex-1 px-3 py-2.5 font-medium capitalize", tab === k ? "border-b-2 border-forest text-forest" : "text-ink-3")}>{k}</button>))}</div>
          <div className="flex-1 overflow-y-auto p-4 text-sm">
            {tab === "facility" && (P ? (<div className="space-y-2">
              <div><div className="text-base font-bold">{P.name ?? "Unnamed facility"}</div>{P.name_bn && <div lang="bn" className="text-ink-3">{P.name_bn}</div>}<div className="mt-1 flex flex-wrap gap-1.5"><ProvChip>{P.kind}</ProvChip><ProvChip>{P.city}</ProvChip>{P.operator_type && <ProvChip>{P.operator_type}</ProvChip>}</div></div>
              {P.operator && <div><span className="text-ink-3">Operator:</span> {P.operator}</div>}
              {P.address && <div><span className="text-ink-3">Address:</span> {P.address}</div>}
              <div><span className="text-ink-3">Phone:</span> {P.phone?.length ? P.phone.map((ph: string) => <a key={ph} href={tel(ph)} className="mr-2 font-semibold text-emerald underline">📞 {ph}</a>) : "not listed in OSM"}</div>
              {P.website && <div><span className="text-ink-3">Website:</span> <a href={P.website} target="_blank" rel="noopener noreferrer" className="text-emerald underline">{P.website.replace(/^https?:\/\//, "").slice(0, 40)}</a></div>}
              <div><span className="text-ink-3">Emergency department (tagged):</span> {P.emergency ?? "unknown"}{P.beds_tagged && <> · <span className="text-ink-3">beds (as tagged, not live):</span> {P.beds_tagged}</>}</div>
              <div className="text-[11px] text-ink-3">{P.verification}. Last edited {P.last_edited?.slice(0, 10) ?? "unknown"} · <a href={P.osm_url} target="_blank" rel="noopener noreferrer" className="underline">view on OpenStreetMap</a></div>
              <div className="flex flex-wrap gap-2 pt-1"><Btn onClick={() => getRoute(picked)} disabled={busy === "route"}>{busy === "route" ? "Routing…" : origin ? "Route from start" : "Set start to route"}</Btn>{P.phone?.[0] && <a href={tel(P.phone[0])} className="inline-flex items-center rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-mint-l">Call</a>}</div>
            </div>) : <EmptyState text="Select a hospital or clinic on the map, in the search box or in the directory below." />)}
            {tab === "route" && (routeErr ? <Notice tone="warn">{routeErr}</Notice> : route ? (<div className="space-y-3">
              <div className="font-semibold">To {route.facility?.properties?.name ?? "destination"}</div>
              <table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase text-ink-3"><th></th><th>Fastest (est.)</th><th>Shortest</th></tr></thead><tbody>
                <tr><td className="text-ink-3">Distance</td><td className="num font-semibold">{km(route.routes.fastest.distance_m)}</td><td className="num">{km(route.routes.shortest.distance_m)}</td></tr>
                <tr><td className="text-ink-3">Est. time</td><td className="num font-semibold">{mins(route.routes.fastest.est_time_s)}</td><td className="num">{mins(route.routes.shortest.est_time_s)}</td></tr>
                <tr><td className="text-ink-3">A* nodes</td><td className="num">{route.routes.fastest.expanded.toLocaleString()}</td><td className="num">{route.routes.shortest.expanded.toLocaleString()}</td></tr>
                <tr><td className="text-ink-3">A* time</td><td className="num">{route.routes.fastest.ms} ms</td><td className="num">{route.routes.shortest.ms} ms</td></tr>
                <tr><td className="text-ink-3">Dijkstra check</td>{(["fastest", "shortest"] as const).map((k) => <td key={k} className="num">{route.verification[k]?.equal ? <span className="text-emerald">✓ equal</span> : <span className="text-coral-d">✗</span>} <span className="text-ink-3">({route.verification[k]?.dijkstra_expanded.toLocaleString()} nodes)</span></td>)}</tr>
              </tbody></table>
              <div className="flex gap-3 text-[11px]"><span className="flex items-center gap-1"><i className="h-1.5 w-5 rounded bg-emerald" />fastest (arrows)</span><span className="flex items-center gap-1"><i className="h-0 w-5 border-t-2 border-dashed border-[#2563eb]" />shortest</span></div>
              <p className="text-[11px] leading-relaxed text-ink-3">Times assume free-flow speeds by road class ({Object.entries(route.speeds_kmh).map(([k, v]) => `${k} ${v}`).join(", ")} km/h). No traffic data. Start snapped {route.origin.snap_m} m and destination {route.destination.snap_m} m to the nearest intersection. {route.attribution}.</p>
            </div>) : <EmptyState text="Pick a facility and press “Route from start”." />)}
            {tab === "nearest" && (busy === "nearest" ? <p className="text-ink-3">Searching the road network…</p> : nearest?.error ? <Notice tone="warn">{nearest.error}</Notice> : nearest?.results ? (<div className="space-y-2">
              <p className="text-[11px] text-ink-3">Closest hospitals by estimated road travel time ({nearest.method}, {nearest.search_ms} ms).</p>
              {nearest.results.map((r: any, i: number) => (<div key={r.facility.properties.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2"><button className="min-w-0 text-left font-semibold text-forest hover:underline" onClick={() => { selectFacility(r.facility); }}>{i + 1}. {r.facility.properties.name ?? "Unnamed hospital"}</button><span className="num shrink-0 whitespace-nowrap text-xs font-bold">{mins(r.est_time_s)} · {km(r.distance_m)}</span></div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">{r.facility.properties.phone?.[0] ? <a className="font-semibold text-emerald underline" href={tel(r.facility.properties.phone[0])}>📞 {r.facility.properties.phone[0]}</a> : <span className="text-ink-3">no phone in OSM</span>}<button className="underline" onClick={() => getRoute(r.facility)}>route</button></div></div>))}
              <p className="text-[11px] text-ink-3">{nearest.note}</p>
            </div>) : <EmptyState text="Press “Nearest hospitals by road” to search from your starting point." />)}
          </div>
        </aside>
      </div>
    </Card>

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
