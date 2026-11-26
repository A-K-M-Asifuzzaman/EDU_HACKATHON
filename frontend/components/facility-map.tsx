"use client";
// Real-data dot map (DESIGN.md §1: the data is the imagery). Every hospital and clinic DengueShield routes to, from the OpenStreetMap
// extract served by /api/facilities, drawn in two panels (Greater Dhaka, Chattogram) with an equirectangular projection corrected for
// latitude. Loaded only when the section scrolls into view.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { RequestStatus, ServiceUnavailable, useAsync } from "./ui";

type Pt = { lon: number; lat: number; hospital: boolean };

function Panel({ pts, title }: { pts: Pt[]; title: string }) {
  const b = pts.reduce((a, p) => [Math.min(a[0], p.lon), Math.min(a[1], p.lat), Math.max(a[2], p.lon), Math.max(a[3], p.lat)], [180, 90, -180, -90]);
  const k = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), pad = 0.012;
  const w = (b[2] - b[0] + 2 * pad) * k, h = b[3] - b[1] + 2 * pad;
  const hosp = pts.filter((p) => p.hospital).length;
  const U = w * 1000, rc = U * 0.0105, rh = U * 0.017;                        // dot sizes scale with the panel, not the page
  return (<figure className="m-0 min-w-0">
    <svg viewBox={`0 0 ${U} ${h * 1000}`} preserveAspectRatio="xMidYMid meet" className="block h-[300px] w-full sm:h-[380px]" role="img" aria-label={`${title}: ${hosp} hospitals and ${pts.length - hosp} clinics from OpenStreetMap`}>
      {pts.filter((p) => !p.hospital).map((p, i) => <circle key={"c" + i} className="sf-fade" style={{ animationDelay: `${(i % 50) * 0.02}s` }} cx={((p.lon - b[0] + pad) * k) * 1000} cy={(b[3] - p.lat + pad) * 1000} r={rc} fill="var(--color-ink-3)" opacity="0.7" />)}
      {pts.filter((p) => p.hospital).map((p, i) => <g key={"h" + i} className="sf-fade" style={{ animationDelay: `${0.4 + (i % 40) * 0.025}s` }}>
        <circle cx={((p.lon - b[0] + pad) * k) * 1000} cy={(b[3] - p.lat + pad) * 1000} r={rh * 3.2} fill="var(--color-emerald)" opacity="0.1" />
        <circle cx={((p.lon - b[0] + pad) * k) * 1000} cy={(b[3] - p.lat + pad) * 1000} r={rh} fill="var(--color-emerald)" /></g>)}
    </svg>
    <figcaption className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[12.5px] text-ink-3"><b className="font-semibold text-ink">{title}</b><span className="num"><span className="text-emerald-d">{hosp} hospitals</span>, {pts.length - hosp} clinics</span></figcaption>
  </figure>);
}

export default function FacilityMap() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  const q = useAsync((s) => (seen ? api("/api/facilities", { signal: s, ttl: 3_600_000 }) : Promise.resolve(null)), [seen]);
  const groups = useMemo(() => {
    const f: any[] = (q.data as any)?.features ?? [];
    const pts = f.map((x) => ({ lon: x.geometry.coordinates[0], lat: x.geometry.coordinates[1], hospital: x.properties.kind === "hospital" }));
    return { dhaka: pts.filter((p) => p.lon < 91.2), ctg: pts.filter((p) => p.lon >= 91.2) };
  }, [q.data]);
  return (<div ref={ref} className="min-h-[320px]">
    {q.status === "failed" && q.error ? <ServiceUnavailable error={q.error} onRetry={q.reload} label="The facility map" />
      : !q.data ? <div aria-busy="true"><div className="grid grid-cols-[1.4fr_1fr] gap-6"><div className="skeleton h-[300px]" /><div className="skeleton h-[220px]" /></div>{seen && <RequestStatus q={q} label="Facility map" />}</div>
      : <div className="grid items-end gap-6 sm:grid-cols-[1.4fr_1fr]"><Panel pts={groups.dhaka} title="Greater Dhaka" /><Panel pts={groups.ctg} title="Chattogram" /></div>}
  </div>);
}
