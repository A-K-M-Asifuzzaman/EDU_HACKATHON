"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Btn, Card, CardTitle, DataTable, Kpi, Loading, Markdown, Modal, Notice, PageHeader, ProvChip, Skeleton, useAsync } from "@/components/ui";

const ARCH = [["Organizer CSV (2016–2024; 2025 dropped on load)", "Feature pipeline: ward-grouped lags, climatology, calendar (fit on training years)"], ["Feature pipeline", "Serialized ridge Poisson GLM bundle (per horizon, 24 features)"], ["Bundle + calibration + tiers", "FastAPI: /api/forecast, /api/risk/wards, /api/model/*"], ["FastAPI (+ precomputed artifacts)", "Next.js dashboard (static export, served by the same process)"], ["FastAPI read-only tools + docs", "DengueShield Copilot (OpenAI Responses API, backend-only)"]];

export default function Provenance() {
  const { t } = useI18n();
  const health = useAsync((s) => api("/api/health", { ttl: 5_000, signal: s }), []);
  const meta = useAsync((s) => api("/api/metadata", { ttl: 60_000, signal: s }), []);
  const integ = useAsync((s) => api("/api/integrations/status", { ttl: 5_000, signal: s }), []);
  const docs = useAsync((s) => api("/api/docs", { ttl: 300_000, signal: s }), []);
  const [open, setOpen] = useState<string | null>(null);
  const doc = useAsync((s) => (open ? api(`/api/docs/read?path=${encodeURIComponent(open)}`, { signal: s }) : Promise.resolve(null)), [open]);
  return (<>
    <PageHeader eyebrow="Auditability" title={t("nav.provenance")} sub="What the application is built from, what is live, what each external service is used for, and whether it feeds the forecasting model." right={<Btn variant="ghost" onClick={() => { health.reload(); integ.reload(); }}>Re-check</Btn>} />
    <Loading q={health} h={90}>{(h: any) => (<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><Kpi label="Status" value={h.status === "ok" ? 1 : 0} digits={0} suffix={h.status === "ok" ? " · OK" : " · " + h.status} tone={h.status === "ok" ? "ok" : "bad"} />
      <Kpi label="Inference probe (ms)" value={h.inference_probe_ms} digits={0} hint="one ward, live bundle" /><Kpi label="Cached predictions" value={h.cache_entries} /><Kpi label="Uptime (s)" value={h.uptime_s} /><Kpi label="OpenAI configured" value={h.openai_configured ? 1 : 0} suffix={h.openai_configured ? " · yes" : " · no"} tone={h.openai_configured ? "ok" : "warn"} /></div>)}</Loading>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardTitle title="Model & data" /><Loading q={meta} h={260}>{(m: any) => (<dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2 text-[13px]">
        {[["Product", `${m.product} — ${m.tagline}`], ["Mode", m.mode], ["Model", m.model.name], ["Bundle version", m.model.bundle_version], ["Bundle SHA-256", m.model.bundle_sha256], ["Trained through", m.model.trained_through], ["Convention", `${m.model.convention?.name} (wlag ${m.model.convention?.wlag}, clag ${m.model.convention?.clag})`], ["Convention note", m.convention_note], ["Dataset SHA-256", m.data.dataset_sha256], ["Date coverage", `2016-01-04 → ${m.data.last_observed_week}`], ["Wards / cities", `${m.data.wards} / ${m.data.cities.join(", ")}`], ["Licensing", m.data.license], ["Holdout", m.data.holdout], ["Environment", m.model.environment && Object.entries(m.model.environment).map(([k, v]) => `${k} ${v}`).join(", ")]].map(([k, v]: any) => (<div key={k} className="contents"><dt className="eyebrow pt-0.5">{k}</dt><dd className="break-all text-ink-2">{v ?? "—"}</dd></div>))}</dl>)}</Loading></Card>
      <Card><CardTitle title="Architecture (data flow)" sub="Everything heavy is precomputed; the UI never retrains a model" /><div className="space-y-2">{ARCH.map(([a, b], i) => (<div key={i} className="grid grid-cols-[1fr_28px_1fr] items-center gap-2 text-[12.5px]"><div className="rounded-xl border border-line bg-canvas p-2.5">{a}</div><span className="text-center text-emerald">→</span><div className="rounded-xl border border-emerald/30 bg-mint-l p-2.5">{b}</div></div>))}</div>
        <p className="mt-3 text-xs text-ink-3">Optional: NASA POWER, Open-Meteo and OpenAI sit beside this flow. They are never inputs to the forecasting model, and the app works without them.</p></Card></div>
    <Card className="mt-5"><CardTitle title="External integrations" sub="Provider, purpose, status, licence/attribution, caching and failure fallback" />
      <Loading q={integ} h={300}>{(d: any) => <DataTable dense maxH={560} rows={d.integrations} cols={[{ key: "id", label: "Source", render: (r: any) => <b>{r.provider}</b> }, { key: "purpose", label: "Purpose" }, { key: "feeds_inference", label: "Feeds model", render: (r: any) => (r.feeds_inference ? <ProvChip tone="warn">yes</ProvChip> : <ProvChip tone="ok">no</ProvChip>) }, { key: "status", label: "Status" }, { key: "last_success", label: "Last success", render: (r: any) => r.last_success ?? "—" }, { key: "update_frequency", label: "Updates" }, { key: "license", label: "Licence / terms" }, { key: "cache", label: "Caching" }, { key: "fallback", label: "If unavailable" }]} />}</Loading></Card>
    <Card className="mt-5"><CardTitle title="Methodology documents" sub="Committed, read-only. The same documents ground the Copilot." />
      <Loading q={docs} h={120}>{(d: any[]) => (<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{d.map((x) => (<button key={x.path} onClick={() => setOpen(x.path)} className="rounded-xl border border-line p-3 text-left text-[13px] transition hover:border-emerald/40 hover:bg-mint-l/60"><b className="block text-forest">{x.title}</b><span className="text-xs text-ink-3">{x.path} · {(x.bytes / 1024).toFixed(0)} KB</span></button>))}</div>)}</Loading></Card>
    <Modal open={!!open} onClose={() => setOpen(null)} title={open ?? ""} wide>{doc.data ? <Markdown>{doc.data.text}</Markdown> : <Skeleton h={200} />}</Modal>
    <Notice tone="info">{"Source code, tests and all research notebooks are in the repository; every figure on these pages is read from a committed report or computed by the API from the dataset."}</Notice>
  </>);
}
