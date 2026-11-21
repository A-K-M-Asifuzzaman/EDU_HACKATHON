"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { api, qs, type Forecast } from "@/lib/api";
import { useSel, srcParam } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import ControlsBar from "@/components/controls";
import RiskMatrix from "@/components/riskmatrix";
import { Card, CardTitle, DataTable, EmptyState, Loading, Notice, PageHeader, ProvChip, Select, useAsync } from "@/components/ui";

const DghsMap = dynamic(() => import("@/components/dghsmap"), { ssr: false, loading: () => <div className="h-[460px] animate-pulse rounded-xl bg-canvas" /> });
const ALL = "";

export default function Geography() {
  const { t, lang } = useI18n();
  const { sel, ready } = useSel();
  const [f, setF] = useState({ district: ALL, city: ALL, ward: ALL });
  const status = useAsync((s) => api("/api/geo/dghs/status", { signal: s, ttl: 60_000 }), []);
  const opts = useAsync((s) => api(`/api/geo/dghs/filters?${qs({ district: f.district || undefined, city: f.city || undefined })}`, { signal: s, ttl: 60_000 }).catch(() => null), [f.district, f.city]);
  const geo = useAsync((s) => api(`/api/geo/dghs/wards?${qs({ district: f.district || undefined, city: f.city || undefined, ward: f.ward || undefined })}`, { signal: s, ttl: 60_000 }), [f.district, f.city, f.ward]);
  const risk = useAsync((s) => api(`/api/risk/wards?${qs({ origin: sel.origin, horizon: sel.horizon, source: srcParam(sel) })}`, { signal: s }), [sel.origin, sel.horizon, sel.source, ready]);
  const wards: Forecast[] = risk.data?.wards ?? [];
  const meta = geo.data?.dghs;
  const down = status.data?.status === "unavailable" || (!!geo.error && !geo.data);
  const detected = status.data?.detected_fields ?? meta?.detected_fields;
  const rows = useMemo(() => (geo.data?.features ?? []).slice(0, 300).map((x: any) => x.properties ?? {}), [geo.data]);
  const cols = useMemo(() => {
    const keys = Object.keys(rows[0] ?? {}).filter((k) => !/^(shape|st_|globalid|objectid)/i.test(k)).slice(0, 6);
    return keys.map((k) => ({ key: k, label: k }));
  }, [rows]);
  const sel2 = (role: "district" | "city" | "ward", label: string) => {
    const o: any[] | null | undefined = opts.data?.options?.[role];
    if (!o) return <div className="flex flex-col gap-1"><span className="eyebrow">{label}</span><span className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-ink-3">{opts.data ? "field not found in layer" : "unavailable"}</span></div>;
    return <Select label={label} value={f[role]} onChange={(v) => setF(role === "district" ? { district: v, city: ALL, ward: ALL } : role === "city" ? { ...f, city: v, ward: ALL } : { ...f, ward: v })} options={[{ value: ALL, label: t("ctl.all") }, ...o.map((v) => ({ value: String(v), label: String(v) }))]} />;
  };
  return (<>
    <PageHeader eyebrow="DGHS GIS · context only" title={t("nav.geography")} sub="Official ward boundaries from the Directorate General of Health Services, shown as geography only. Forecasts are for the competition's synthetic ward IDs, which cannot be matched to these polygons, so predictions appear in a separate matrix." />
    {down && <div className="mb-4"><Notice tone="warn"><b>{t("state.degraded")}</b> The DGHS GIS service could not be reached{status.data?.error ? ` (${status.data.error})` : ""}. Boundaries are hidden; forecasts and the risk matrix below are unaffected.</Notice></div>}
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Card>
        <CardTitle title="Official boundaries" sub={meta ? `${meta.count} features · ${meta.pages} request${meta.pages === 1 ? "" : "s"} upstream` : "DGHS ArcGIS FeatureServer"}
          right={<div className="flex flex-wrap gap-1.5">{meta && <ProvChip tone={meta.cache?.stale ? "warn" : "ok"}>{meta.cache?.stale ? "cached copy (service down)" : meta.cache?.cached ? "cached" : "live"}</ProvChip>}{meta?.truncated && <ProvChip tone="warn">truncated at {meta.max_features}</ProvChip>}<ProvChip tone="warn">not linked to forecasts</ProvChip></div>} />
        <div className="mb-3 grid gap-3 sm:grid-cols-3">{sel2("district", "District")}{sel2("city", "City / corporation")}{sel2("ward", "Ward")}</div>
        <DghsMap data={geo.data ?? null} label="Map of official DGHS ward boundaries" />
        {geo.loading && <p className="mt-2 text-xs text-ink-3">Loading boundaries…</p>}
        {geo.error && !geo.loading && <p className="mt-2 text-xs text-ink-3">{geo.error.message}</p>}
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">{meta?.attribution ?? status.data?.attribution} {meta?.license ?? status.data?.license}</p>
        {detected && <p className="mt-1 text-[11px] text-ink-3">Filter fields detected from the layer: district = <b>{detected.district?.name ?? "none"}</b>, city = <b>{detected.city?.name ?? "none"}</b>, ward = <b>{detected.ward?.name ?? "none"}</b>.</p>}
      </Card>
      <Card><CardTitle title="Predictions: abstract ward-risk matrix" sub={`${sel.horizon} ${t("ctl.weeks")} · ${dateFmt(sel.origin, lang)} · synthetic ward IDs, no map position`} />
        <ControlsBar show={["origin", "horizon"]} />
        <div className="mt-3"><Loading q={risk} h={260}>{() => <RiskMatrix wards={wards} />}</Loading></div>
        <div className="mt-3"><Notice>No verified crosswalk exists between these ward IDs and DGHS ward codes, so no forecast is drawn on any polygon. {status.data?.id_mapping?.reason}</Notice></div>
      </Card>
    </div>
    <Card className="mt-5"><CardTitle title={`Boundary attributes${rows.length ? ` (${rows.length}${meta && meta.count > rows.length ? ` of ${meta.count}` : ""})` : ""}`} sub="Attributes exactly as published by DGHS; nothing has been added or joined." />
      {rows.length ? <DataTable rows={rows} cols={cols} maxH={360} dense /> : <EmptyState text={down ? "Boundary data is unavailable." : geo.loading ? "Loading…" : "No boundaries match these filters."} />}</Card>
  </>);
}
