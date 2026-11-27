"use client";
// Officer workspace (V4, protected). Internal review of this week's model alerts and generic response plans. The server enforces every
// permission (officer or admin; only an admin approves, never their own plan) and writes every change to the audit log. Synthetic data;
// nothing is sent to anyone.
import { useCallback, useEffect, useState } from "react";
import ControlsBar from "@/components/controls";
import { Kpi, PageHeader, RiskBadge, TableSkeleton, useToast } from "@/components/ui";
import { Badge } from "@/components/illustrations";
import { Gate } from "@/components/gate";
import { atLeast, send, useAuth } from "@/lib/auth";
import { useSel } from "@/lib/ctx";
import { dateFmt, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const STATUS = [["acknowledged", "Acknowledge"], ["escalated", "Escalate"], ["dismissed", "Dismiss"], ["resolved", "Resolve"]] as const;
const TONE: Record<string, string> = { acknowledged: "bg-[#dbe9ff] text-[#1c3f8f]", escalated: "bg-[#ffe9ea] text-[#8f1d25]", dismissed: "bg-[#efe7ff] text-[#3d3566]", resolved: "bg-[#d9f7ea] text-[#0b5d44]" };


function Workspace() {
  const { sel } = useSel();
  const { user } = useAuth();
  const { lang } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<any>(null), [plans, setPlans] = useState<any>(null), [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<{ ward: string; options: string[]; note: string }>({ ward: "", options: [], note: "" });
  const load = useCallback(async () => {
    setErr(null);
    const [a, p] = await Promise.all([send(`/api/ops/alerts?origin=${sel.origin}&horizon=${sel.horizon}`), send(`/api/ops/plans?origin=${sel.origin}`)]);
    if (!a.ok) { setErr(a.data?.detail ?? "Could not load alerts."); setData(null); } else setData(a.data);
    if (p.ok) setPlans(p.data);
  }, [sel.origin, sel.horizon]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function review(ward: string, status: string) {
    const r = await send("/api/ops/alerts/review", { ward_id: ward, origin: sel.origin, horizon: sel.horizon, status, note: notes[ward] || undefined });
    if (r.ok) { toast(`${ward}: ${status}`); load(); } else toast(r.data?.detail ?? "Not saved.");
  }
  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/ops/plans", { ward_id: draft.ward, origin: sel.origin, horizon: sel.horizon, options: draft.options, note: draft.note || undefined });
    if (r.ok) { toast("Plan saved as a draft."); setDraft({ ward: "", options: [], note: "" }); load(); } else toast(r.data?.detail ?? "Not saved.");
  }
  async function approve(id: number) {
    const r = await send(`/api/ops/plans/${id}/approve`, {});
    if (r.ok) { toast("Plan approved."); load(); } else toast(r.data?.detail ?? "Not approved.");
  }

  return (<>
    <ControlsBar />
    {err && <p role="alert" className="card mb-6 p-4 text-[14px] text-[#8f1d25]">{err}</p>}
    <section aria-labelledby="ops-counts" className="mb-10"><h2 id="ops-counts" className="sr-only">Review status</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Unreviewed alerts" value={data?.counts.unreviewed} tone="bad" /><Kpi label="Acknowledged" value={data?.counts.acknowledged} />
        <Kpi label="Escalated" value={data?.counts.escalated} tone="warn" /><Kpi label="Dismissed" value={data?.counts.dismissed} /><Kpi label="Resolved" value={data?.counts.resolved} />
      </div></section>

    <section aria-labelledby="ops-alerts" className="mb-12">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><h2 id="ops-alerts" className="font-display text-[30px] font-extrabold tracking-[-0.02em] text-ink">Alerts to review</h2>
        <p className="text-[13.5px] text-ink-3">Forecast issued {dateFmt(sel.origin, lang)}, {sel.horizon} weeks ahead. {data?.note}</p></div>
      {!data ? <div className="card p-5" aria-busy="true"><TableSkeleton rows={6} /></div> : data.alerts.length === 0 ? <div className="card p-6 text-[15px] text-ink-2">No ward is on alert for this week and horizon.</div> : (
        <div className="card scroll-thin overflow-x-auto p-0" tabIndex={0} aria-label="Alerts to review, scrollable">
          <table className="num w-full min-w-[860px] text-left text-[14px]">
            <thead><tr className="border-b-2 border-ink text-[12.5px] text-ink-3"><th className="px-4 py-3 font-bold">Ward</th><th className="py-3 font-bold">Tier</th><th className="py-3 text-right font-bold">Chance</th><th className="py-3 text-right font-bold">Median [80%]</th><th className="px-4 py-3 font-bold">Status</th><th className="py-3 font-bold">Note</th><th className="px-4 py-3 font-bold">Action</th></tr></thead>
            <tbody>{data.alerts.map((a: any) => (<tr key={a.ward_id} className="border-b border-line align-middle">
              <td className="px-4 py-3"><b className="text-ink">{a.ward_id}</b><span className="block text-[12.5px] text-ink-3">{a.city}</span></td>
              <td><RiskBadge tier={a.risk_tier} size="sm" /></td><td className="text-right font-bold text-coral-d">{pct(a.p_outbreak, lang)}</td><td className="text-right">{a.median_cases} [{a.lower_80}-{a.upper_80}]</td>
              <td className="px-4">{a.review ? <span className={"inline-flex rounded-full border-[1.5px] border-ink px-2.5 py-0.5 text-[12px] font-bold " + TONE[a.review.status]}>{a.review.status}</span> : <span className="text-[12.5px] text-ink-3">not reviewed</span>}
                {a.review && <span className="mt-0.5 block text-[11.5px] text-ink-3">{a.review.updated_by}</span>}</td>
              <td><input aria-label={`Note for ${a.ward_id}`} defaultValue={a.review?.note ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [a.ward_id]: e.target.value }))} maxLength={500} placeholder="Optional note"
                className="min-h-10 w-full min-w-[160px] rounded-[10px] border-2 border-line bg-ivory px-2.5 text-[13.5px] text-ink placeholder:text-ink-3" /></td>
              <td className="px-4"><div className="flex flex-wrap gap-1.5">{STATUS.map(([s, label]) => <button key={s} onClick={() => review(a.ward_id, s)} aria-pressed={a.review?.status === s}
                className={"min-h-9 rounded-full border-2 border-ink px-3 text-[12.5px] font-bold transition-colors " + (a.review?.status === s ? "bg-[#4a2bd0] text-white" : "bg-ivory text-ink hover:bg-mint-l")}>{label}</button>)}</div></td>
            </tr>))}</tbody></table></div>)}
    </section>

    <section aria-labelledby="ops-plans" className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <form onSubmit={savePlan} className="card p-6">
        <h2 id="ops-plans" className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-ink">Draft a response plan</h2>
        <p className="mt-1 text-[13.5px] text-ink-3">Generic options only: no quantities, orders or messages. An administrator other than you approves it.</p>
        <label className="mt-4 block"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">Ward</span>
          <select required value={draft.ward} onChange={(e) => setDraft({ ...draft, ward: e.target.value })} className="min-h-11 w-full rounded-[12px] border-[2.5px] border-ink bg-ivory px-2 text-[14.5px] text-ink">
            <option value="">Choose a ward on alert</option>{(data?.alerts ?? []).map((a: any) => <option key={a.ward_id} value={a.ward_id}>{a.ward_id}, {a.city}</option>)}</select></label>
        <fieldset className="mt-4"><legend className="mb-1.5 text-[13.5px] font-bold text-ink">Options</legend>
          <div className="space-y-2">{Object.entries(plans?.options ?? {}).map(([id, label]: any) => (<label key={id} className="flex min-h-10 items-center gap-3 rounded-[10px] border-2 border-line bg-ivory px-3 text-[14px] text-ink">
            <input type="checkbox" className="h-4 w-4 accent-[#4a2bd0]" checked={draft.options.includes(id)} onChange={(e) => setDraft({ ...draft, options: e.target.checked ? [...draft.options, id] : draft.options.filter((o) => o !== id) })} />{label}</label>))}</div></fieldset>
        <label className="mt-4 block"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">Note</span><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={800} rows={3} className="w-full rounded-[12px] border-[2.5px] border-ink bg-ivory p-2.5 text-[14px] text-ink" /></label>
        <button type="submit" disabled={!draft.ward || !draft.options.length} className="mt-5 inline-flex min-h-12 items-center bg-ink px-6 text-[15px] text-canvas disabled:opacity-50">Save draft</button>
      </form>
      <div className="card p-6"><h3 className="font-display text-[22px] font-extrabold text-ink">Plans for this week</h3>
        {!plans ? <TableSkeleton rows={3} /> : plans.plans.length === 0 ? <p className="mt-3 text-[14.5px] text-ink-2">No plans yet for this forecast week.</p> : (
          <ul className="mt-3 divide-y divide-line">{plans.plans.map((p: any) => (<li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3.5">
            <div className="min-w-0"><b className="text-ink">{p.ward_id}</b> <span className={"ml-1 inline-flex rounded-full border-[1.5px] border-ink px-2 py-px text-[11.5px] font-bold " + (p.status === "approved" ? "bg-[#d9f7ea] text-[#0b5d44]" : "bg-[#fff1cc] text-[#6b4a00]")}>{p.status}</span>
              <span className="block text-[13px] text-ink-2">{p.options.map((o: string) => plans.options[o] ?? o).join("; ")}</span>
              <span className="block text-[12px] text-ink-3">by {p.created_by}{p.approved_by ? `, approved by ${p.approved_by}` : ""}</span></div>
            {user?.role === "admin" && p.status !== "approved" && p.created_by !== user.email && <button onClick={() => approve(p.id)} className="btn-ghost min-h-9 px-4 text-[13px]">Approve</button>}
          </li>))}</ul>)}</div>
    </section>
  </>);
}

export default function Officer() {
  return (<>
    <PageHeader eyebrow="Response operations, signed in" title="Officer workspace" art={<Badge className="w-full" />}
      sub="Review this week's model alerts and draft generic response plans. Internal planning aid on synthetic data: not an official warning, and nothing is sent to anyone." />
    <Gate need="officer"><Workspace /></Gate>
  </>);
}
