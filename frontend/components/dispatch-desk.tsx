"use client";
// Stage 4: dispatch desk. One immutable snapshot per ward from GET /api/dispatch/brief (the scenario set in the sections above), shown as
// SMS, WhatsApp and a printable brief. Every copy and download uses that same snapshot: downloads are requested with the snapshot's own
// query string and refused if the server returns a different scenario id or content hash. Generated on this computer; nothing is sent.
import { useEffect, useMemo, useRef, useState } from "react";
import { BASE } from "@/lib/api";
import { useSel } from "@/lib/ctx";
import { dateFmt } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./icons";
import { CITIES, planParams, SCENARIO_VERSION, wardInScope } from "@/lib/plan-scenario";
import { Live, PlanShared, useDecisionGuard, useScenarioRequest } from "./supply-allocation";
import { Btn, Card, Notice, ProvChip, Segmented, Select, Tabs, useToast } from "./ui";

type DispatchSnapshot = {
  scenario: { id: string; version?: typeof SCENARIO_VERSION; settings: { stock: number; crews: number; capacity_pct: number; vector: { effect: number; coverage: number } } };
  content_sha256: string;
  brief: any;
  formats: { sms: Record<"en" | "bn", any>; whatsapp: Record<"en" | "bn", string>; html: Record<"en" | "bn", string> };
};
const STATUS: Record<string, string> = { critical: "critical supply gap", deficit: "supply gap", met: "supplies met" };

/** WhatsApp markup (*bold*, _italic_) as React nodes, escaped by React. */
function waLine(line: string, i: number) {
  const parts = line.split(/(\*[^*]+\*|_[^_]+_)/g).filter(Boolean);
  return <div key={i} className="min-h-[1.2em]">{parts.map((p, j) => p.startsWith("*") && p.endsWith("*") ? <b key={j}>{p.slice(1, -1)}</b>
    : p.startsWith("_") && p.endsWith("_") ? <i key={j}>{p.slice(1, -1)}</i> : <span key={j}>{p}</span>)}</div>;
}

export default function DispatchDesk({ shared }: { shared: PlanShared }) {
  const { sel, set, wards } = useSel();
  const { lang: uiLang, t } = useI18n();
  const toast = useToast();
  const { blocked, notice } = useDecisionGuard();
  const ward = sel.ward;
  const briefCity = shared.city === "All" ? wards.find(w => w.ward_id === ward)?.city : shared.city;
  const [lang, setLang] = useState<"en" | "bn">("en");
  const [tab, setTab] = useState("sms");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ready = shared.readyScenario && !blocked;
  const query = planParams(sel, shared);
  const rankedQuery = new URLSearchParams(query);
  for (const key of ["capacity_pct", "override", "mode", "assign", "effect", "coverage", "delay", "buildup", "sens_low", "sens_high"]) rankedQuery.delete(key);
  const ranking = useScenarioRequest(ready ? `/api/allocation/plan?${rankedQuery}` : null);
  const options = useMemo(() => {
    const ranked = ranking.stale ? [] : (ranking.data?.wards ?? []).filter((w: any) => w.city === briefCity);
    return ranked.length ? ranked.map((w: any) => ({ value: w.ward_id, label: `${w.ward_id} (#${w.rank}, ${STATUS[w.status]})` }))
      : wards.filter(w => w.city === briefCity).map(w => ({ value: w.ward_id, label: w.ward_id }));
  }, [ranking.data, ranking.stale, wards, briefCity]);
  query.set("scenario_v", String(SCENARIO_VERSION));
  const scen = query.toString();
  const briefUrl = ready && briefCity ? `/api/dispatch/brief?${scen}&ward=${encodeURIComponent(ward)}` : null;
  const q = useScenarioRequest<DispatchSnapshot>(briefUrl);
  const { report } = shared;
  const brief = q.data;
  const canExport = !!brief && !q.stale && brief.brief.ward.ward_id === ward;
  useEffect(() => {
    report("dispatch", q.status === "failed" ? { failed: true } : brief ? {
      id: brief.scenario.id, ward: brief.brief.ward.ward_id, city: brief.brief.ward.city,
      planned: brief.brief.forecast.planned_cases, saline: brief.brief.resources.saline,
      withoutBed: brief.brief.hospital.without_bed, stale: !canExport,
    } : null);
  }, [brief, canExport, q.status, report]);

  const exporting = useRef<AbortController | null>(null);
  useEffect(() => () => { exporting.current?.abort(); }, [briefUrl]);

  const copy = async (what: "sms" | "whatsapp", snap: DispatchSnapshot) => {
    if (!canExport) return;
    const text = what === "sms" ? snap.formats.sms[lang].text : snap.formats.whatsapp[lang];
    try {
      await navigator.clipboard.writeText(text);
      toast(what === "sms" ? `SMS copied: ${snap.formats.sms[lang].chars} characters, ${snap.formats.sms[lang].segments} segment(s)` : "WhatsApp notice copied");
    } catch { setErr("This browser blocked clipboard access. Select the text in the preview and copy it by hand."); }
  };

  /** Download from the snapshot's own settings; refuse the file if the server answers for a different scenario. */
  const download = async (snap: DispatchSnapshot, kind: "ward" | "city" | "wards", format: "html" | "pdf") => {
    if (!canExport || exporting.current) return;
    const request = new AbortController();
    exporting.current = request;
    setErr(null); setBusy(`${kind}-${format}`);
    try {
      const extra = kind === "ward" ? `&ward=${encodeURIComponent(snap.brief.ward.ward_id)}` : `&brief_city=${encodeURIComponent(snap.brief.ward.city)}`;
      const r = await fetch(`${BASE}/api/dispatch/document?${scen}&kind=${kind}&format=${format}&lang=${format === "pdf" || kind === "city" ? "en" : lang}${extra}`, { signal: request.signal });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.detail ?? `HTTP ${r.status}`); }
      const sid = r.headers.get("x-scenario-id"), sha = r.headers.get("x-content-sha256");
      if (sid !== snap.scenario.id || (kind === "ward" && sha !== snap.content_sha256)) throw new Error("the scenario changed during the download, so nothing was saved; try again");
      const blob = await r.blob();
      if (request.signal.aborted) return;
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `dengueshield_${kind}.${format}`;
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Saved ${name}`);
    } catch (e: any) {
      if (!request.signal.aborted) setErr(`Export failed: ${e?.message ?? e}`);
    } finally {
      exporting.current = null;
      setBusy(null);
    }
  };

  return (<Card id="dispatch" className="mt-5 scroll-mt-20" aria-labelledby="dispatch-title">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="dispatch-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Icon name="send" size={18} className="text-forest" />Dispatch briefs</h2>
        <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-snug text-ink-3">Ward notices and printable briefs for the scenario set above: forecast, supplies, hospital beds, crews and the vector-control estimate. Made on this computer; nothing is sent to anyone.</p></div>
      <div className="flex flex-wrap gap-2"><ProvChip tone="info">Text and documents only</ProvChip><ProvChip tone="ok">Works offline</ProvChip></div>
    </div>
    {blocked ? notice : (<div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside aria-label="Brief settings" className="self-start space-y-4 rounded-2xl border-2 border-ink/80 bg-ivory p-4">
        {shared.city === "All" ? <Select label={t("scenario.briefCity")} value={briefCity ?? ""} onChange={city => set({ ward: wardInScope(wards, city, ward) })} options={CITIES.map((c) => ({ value: c, label: c }))} />
          : <div className="text-[13px]"><span className="block text-[12px] font-semibold text-ink-3">City</span><b>{shared.city}</b> <span className="text-ink-3">(set in Supply allocation)</span></div>}
        <Select label="Ward (priority order)" value={ward} onChange={ward => set({ ward })} options={options} />
        <Segmented label="Message language" value={lang} onChange={(v) => setLang(v as any)} options={[{ value: "en", label: "English" }, { value: "bn", label: "বাংলা" }]} />
        {q.data && (() => { const s = q.data.scenario.settings; const b = q.data.brief; return (
          <div data-testid="snapshot" className="rounded-xl border border-line bg-white p-3 text-[12px] leading-relaxed text-ink-2">
            <div className="flex items-center justify-between gap-2"><b className="text-ink">Snapshot</b><code data-testid="scenario-id" className="rounded bg-mint-l px-1.5 py-0.5 text-[12px] font-bold text-ink">{q.data.scenario.id}</code></div>
            {!canExport && <p role="status" className="mt-1 font-semibold text-ink">{t("scenario.previousBrief")}</p>}
            <p className="mt-1">Forecast issued {dateFmt(b.forecast.origin, uiLang)} for the week of {dateFmt(b.forecast.target_week, uiLang)} ({b.forecast.horizon_weeks} weeks, {b.forecast.source === "replay" ? "validated replay" : "deployed model, out-of-time"}).</p>
            <p>Stock {Math.round(s.stock * 100)}%, {s.crews} crews ({b.crews.deployment_label}), capacity {s.capacity_pct}%, effect {Math.round(s.vector.effect * 100)}% at {Math.round(s.vector.coverage * 100)}% per crew.</p>
            <p className="mt-1 text-ink-3">Every copy and download below uses this snapshot. Content hash {q.data.content_sha256.slice(0, 12)}.</p></div>); })()}
        {q.data && (<div className="divide-y divide-line rounded-xl border border-line bg-white text-[13px]">
          {([["This ward", q.data.brief.ward.ward_id, "ward"], ["City summary", q.data.brief.ward.city, "city"],
             ["Wards needing attention", q.data.brief.ward.city, "wards"]] as const).map(([label, sub, kind]) => (
            <div key={kind} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
              <div className="min-w-0"><b className="block text-ink">{label}</b><span className="text-[11.5px] text-ink-3">{sub}</span></div>
              <div className="flex gap-1.5">{(["html", "pdf"] as const).map((f) => (
                <Btn key={f} variant="ghost" className="!min-h-10 !px-3 sm:!min-h-8" aria-label={`Download ${label.toLowerCase()} as ${f.toUpperCase()}`} disabled={!canExport || !!busy}
                  onClick={() => download(q.data!, kind, f)}>{busy === `${kind}-${f}` ? "…" : f.toUpperCase()}</Btn>))}</div></div>))}
          <div className="flex flex-wrap gap-1.5 p-2.5"><Btn variant="ghost" className="!min-h-10 sm:!min-h-8" disabled={!canExport} onClick={() => copy("sms", q.data!)}>Copy SMS</Btn>
            <Btn variant="ghost" className="!min-h-10 sm:!min-h-8" disabled={!canExport} onClick={() => copy("whatsapp", q.data!)}>Copy WhatsApp</Btn></div></div>)}
        {q.data && <p className="text-[11.5px] text-ink-3">PDFs are in English (standard PDF fonts have no Bengali letters); Bangla is in the HTML brief and the messages.</p>}
      </aside>

      <div className="min-w-0">
        {err && <div className="mb-3"><Notice tone="warn">{err}</Notice></div>}
        <Live q={q} h={460} label="Dispatch brief">{d => { const sms = d.formats.sms[lang]; const b = d.brief; return (<div>
          <Tabs group="dispatch" value={tab} onChange={setTab} tabs={[{ id: "sms", label: "SMS" }, { id: "whatsapp", label: "WhatsApp" }, { id: "brief", label: "Printable brief" }, { id: "sources", label: "Assumptions and sources" }]} />
          {tab === "sms" && (<div role="tabpanel" aria-label="SMS" className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"><div>
            <div className="mx-auto max-w-[420px] rounded-[26px] border-2 border-ink bg-mint-l p-4">
              <div data-testid="sms-text" lang={lang} className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-white p-3 text-[13.5px] leading-snug text-ink shadow-[2px_2px_0_#1a1438]">{sms.text}</div>
              <p data-testid="sms-stats" className="mt-2 text-center text-[12px] text-ink-3">{sms.chars} characters, {sms.encoding}, {sms.segments} SMS segment{sms.segments === 1 ? "" : "s"} ({sms.per_segment} per segment)</p></div>
            {sms.encoding === "UCS-2" && <p className="mt-2 text-center text-[12px] text-ink-3">Bangla is sent as UCS-2: 70 characters fit one SMS (67 per segment when split), so this notice costs more segments than the English one.</p>}</div>
            <dl data-testid="key-numbers" className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 self-start rounded-xl border border-line p-4 text-[13px]">
              {([["Ward", `${b.ward.ward_id}, ${b.ward.city}`], ["Risk", `${b.ward.risk_tier}, outbreak chance ${Math.round(b.ward.outbreak_probability * 100)}%`],
                 ["Projected cases", `${b.forecast.planned_cases} at the ${b.forecast.service_label}`],
                 ["Saline bags", `${b.resources.saline.allocated} of ${b.resources.saline.required}`], ["Diagnostic kits", `${b.resources.kits.allocated} of ${b.resources.kits.required}`],
                 ["Beds, regional stock", `${b.resources.beds.allocated} of ${b.resources.beds.required}`],
                 ["Hospital", `${b.hospital.bed_demand} needed, ${b.hospital.illustrative_capacity} illustrative capacity`],
                 ["Transfers", [...b.hospital.transfers_out.map((t: any) => `${t.patients} to ${t.to_ward}`), ...b.hospital.transfers_in.map((t: any) => `${t.patients} from ${t.from_ward}`)].join(", ") || "none"],
                 ["Without a bed", String(b.hospital.without_bed)], ["Crews", `${b.crews.assigned} (${b.crews.deployment_label})`],
                 ["Scenario estimate", `about ${b.crews.prevented_window.toFixed(1)} fewer cases over weeks 2-4 (assumed effect)`]] as [string, string][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="font-semibold text-ink-3">{k}</dt><dd className="text-ink">{v}</dd></div>))}
              {b.attention.length > 0 && <><dt className="font-semibold text-coral-d">Needs attention</dt><dd><ul className="list-disc pl-4 text-ink">{b.attention.map((a: any) => <li key={a.text}>{a.text}</li>)}</ul></dd></>}
            </dl>
          </div>)}
          {tab === "whatsapp" && (<div role="tabpanel" aria-label="WhatsApp">
            <div className="mx-auto max-w-[460px] rounded-[26px] border-2 border-ink bg-[#e9e3d6] p-4">
              <div data-testid="whatsapp-text" lang={lang} className="rounded-2xl rounded-tr-sm bg-[#dcf8c6] p-3 text-[13.5px] leading-snug text-[#1a1438] shadow-[2px_2px_0_#1a1438]">{d.formats.whatsapp[lang].split("\n").map(waLine)}</div></div>
          </div>)}
          {tab === "brief" && (<div role="tabpanel" aria-label="Printable brief">
            <iframe title={`Printable brief for ${b.ward.ward_id}`} sandbox="" srcDoc={d.formats.html[lang]} className="h-[720px] w-full rounded-xl border-2 border-ink bg-white" />
          </div>)}
          {tab === "sources" && (<div role="tabpanel" aria-label="Assumptions and sources" className="grid gap-3 md:grid-cols-2">
            {[["Measured data", b.provenance.measured], ["Forecast", b.provenance.forecast], ["Assumptions", b.provenance.assumptions], ["Simulated", b.provenance.simulated]].map(([t, x]) => (
              <div key={t} className="rounded-xl border border-line p-3"><div className="text-[13px] font-semibold text-ink">{t}</div><p className="mt-1 text-[12.5px] leading-snug text-ink-2">{x}</p></div>))}
            <div className="rounded-xl border border-line p-3 md:col-span-2"><div className="text-[13px] font-semibold text-ink">Scenario assumptions</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-2">{b.assumptions.map((x: string) => <li key={x}>{x}</li>)}</ul>
              <p className="mt-2 text-[12px] text-ink-3">Model: {b.model.name}, bundle {b.model.bundle_sha256}, replay {b.model.replay_sha256}; data through {dateFmt(b.model.data_through, uiLang)}. {b.disclaimer}</p></div>
          </div>)}
        </div>); }}</Live>
      </div>
    </div>)}
  </Card>);
}
