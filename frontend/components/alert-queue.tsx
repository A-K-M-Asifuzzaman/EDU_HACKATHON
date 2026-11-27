"use client";
// Alert review queue (V3): a traceable, LOCAL draft workflow over the model's outbreak alerts for the selected week and horizon.
// Review status and notes are stored only in this browser (localStorage); nothing is sent to anyone, and no real intervention is implied.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { qs, type Forecast } from "@/lib/api";
import { srcParam, useSel } from "@/lib/ctx";
import { dateFmt, download, num, pct, toCsv } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Btn, Card, CardTitle, Notice, RiskBadge } from "./ui";

import { Live, useScenarioRequest, type PlanShared } from "./supply-allocation";

type Review = { status: "unreviewed" | "reviewed" | "follow_up"; note: string; at?: string };
const STATUS: Record<Review["status"], string> = { unreviewed: "Not reviewed", reviewed: "Reviewed", follow_up: "Needs follow-up" };
const KEY = "ds.alertReview.v1";

function load(): Record<string, Review> { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }

export default function AlertQueue({ shared }: { shared: PlanShared }) {
  const { sel } = useSel();
  const { lang } = useI18n();
  const base = { origin: sel.origin, horizon: sel.horizon, source: srcParam(sel), city: shared.city === "All" ? undefined : shared.city };
  const q = useScenarioRequest<{ wards: Forecast[] }>(shared.readyScenario ? `/api/risk/wards?${qs(base)}` : null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  useEffect(() => setReviews(load()), []);
  const id = (w: string) => `${sel.origin}|${sel.horizon}|${w}`;
  const save = (w: string, patch: Partial<Review>) => setReviews((r) => {
    if (q.stale) return r;
    const prev: Partial<Review> = r[id(w)] ?? {};
    const n = { ...r, [id(w)]: { status: prev.status ?? "unreviewed", note: prev.note ?? "", ...patch, at: new Date().toISOString() } as Review };
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {}
    return n;
  });
  const alerts = useMemo(() => (q.data?.wards ?? []).filter((w) => w.outbreak_alert).sort((a, b) => b.p_outbreak - a.p_outbreak), [q.data]);
  const done = alerts.filter((w) => reviews[id(w.ward_id)]?.status && reviews[id(w.ward_id)].status !== "unreviewed").length;
  const { report } = shared;
  useEffect(() => {
    report("review", q.status === "failed" ? { failed: true } : q.data ? { reviewed: done, total: alerts.length, stale: q.stale } : null);
  }, [report, q.status, q.data, q.stale, done, alerts.length]);
  const exportLog = () => !q.stale && download(`dengueshield_alert_review_${sel.origin}_h${sel.horizon}.csv`, toCsv(alerts.map((w) => ({
    ward_id: w.ward_id, city: w.city, origin: sel.origin, target: w.target_date, horizon: sel.horizon, p_outbreak: w.p_outbreak, median: w.median_cases,
    lower_80: w.lower_80, upper_80: w.upper_80, tier: w.risk_tier, source: w.source, review_status: STATUS[reviews[id(w.ward_id)]?.status ?? "unreviewed"],
    note: reviews[id(w.ward_id)]?.note ?? "", reviewed_at: reviews[id(w.ward_id)]?.at ?? "",
    disclaimer: "Local draft on synthetic data; not sent; not an official alert" }))));
  return (<Card id="alert-queue" className="mt-5 scroll-mt-20" aria-labelledby="aq-title">
    <CardTitle title="Alert review queue (local draft)" sub={`Wards on outbreak alert for the week of ${dateFmt(alerts[0]?.target_date ?? sel.origin, lang)} · ${sel.horizon} weeks ahead · ranked by P(outbreak)`}
      right={<Btn variant="ghost" onClick={exportLog} disabled={!alerts.length || q.stale}>Export review log (CSV)</Btn>} />
    <Notice tone="warn">Draft workflow for planning practice on synthetic wards. Statuses and notes stay in this browser; nothing is sent to field teams or authorities, and alerts are statistical categories, not official warnings.</Notice>
    <Live q={q} h={160} label="Alert queue">{() => alerts.length === 0 ? <p className="mt-3 text-sm text-ink-3">No ward is on alert for this week and horizon.</p> : (<>
      <p className="mt-3 text-[12px] text-ink-2"><b>{done}</b> of <b>{alerts.length}</b> alerts reviewed.</p>
      <ul className="mt-2 grid gap-2">{alerts.map((w) => { const r = reviews[id(w.ward_id)]; return (
        <li key={id(w.ward_id)} className="rounded-xl border border-line bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><b className="text-forest">{w.ward_id}</b><span className="text-[12px] text-ink-3">synthetic · {w.city}</span><RiskBadge tier={w.risk_tier} size="sm" /></div>
            <span className="num text-[13px]">P(outbreak) <b>{pct(w.p_outbreak, lang)}</b> · median {w.median_cases} (80%: {w.lower_80}–{w.upper_80})</span></div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
            <label className="flex items-center gap-1.5">Status
              <select aria-label={`Review status for ${w.ward_id}`} disabled={q.stale} value={r?.status ?? "unreviewed"} onChange={(e) => save(w.ward_id, { status: e.target.value as Review["status"] })} className="min-h-10 rounded-lg border border-line bg-white px-2">
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <input aria-label={`Draft action note for ${w.ward_id}`} placeholder="Draft action note (local)" maxLength={240} disabled={q.stale} defaultValue={r?.note ?? ""} onBlur={(e) => save(w.ward_id, { note: e.target.value })} className="min-h-10 min-w-0 flex-1 rounded-lg border border-line px-2" />
            <Link className="underline" href={`/lab/?ward=${w.ward_id}&origin=${sel.origin}&horizon=${sel.horizon}`}>Evidence: forecast detail →</Link>
            <Link className="underline" href={`/evidence/?ward=${w.ward_id}&origin=${sel.origin}&horizon=${sel.horizon}`}>Model reliability →</Link></div>
          {r?.at && <p className="mt-1 text-[11px] text-ink-3">Last updated {new Date(r.at).toLocaleString()} (this browser)</p>}
        </li>); })}</ul></>)}</Live>
  </Card>);
}
