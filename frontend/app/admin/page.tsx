"use client";
// Administration (V4, protected: administrator with an authenticator app). Role grants by email, account activation and the audit log.
// Firebase holds the credentials; this page never handles passwords. The server refuses self-changes and requires MFA on every call.
import { useCallback, useEffect, useState } from "react";
import { PageHeader, TableSkeleton, useToast } from "@/components/ui";
import { KeyArt } from "@/components/illustrations";
import { Gate } from "@/components/gate";
import { send, useAuth, type Role, type User } from "@/lib/auth";

const field = "min-h-11 w-full rounded-[12px] border-[2.5px] border-ink bg-ivory px-3 text-[14.5px] text-ink";
const ROLE_NAME: Record<Role, string> = { user: "Reader", officer: "Officer", admin: "Administrator" };

function Mfa() {
  const { enrolTotp, logout } = useAuth();
  const [step, setStep] = useState<{ key: string; url: string; finish: (c: string) => Promise<any> } | null>(null), [code, setCode] = useState(""), [msg, setMsg] = useState<string | null>(null), [done, setDone] = useState(false);
  return (<div className="card mx-auto max-w-[720px] p-6 sm:p-8">
    <h2 className="font-display text-[26px] font-extrabold text-ink">Confirm it is you with an authenticator app</h2>
    <p className="mt-2 text-[15px] text-ink-2">Administration always needs a second factor. Add DengueShield to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar), then sign in again with the 6-digit code.</p>
    {done ? <div className="mt-5"><p role="status" className="text-[15px] text-ink">Authenticator added. Sign out and sign in again to open administration.</p><button onClick={logout} className="mt-4 inline-flex min-h-11 items-center bg-ink px-5 text-[14.5px] text-canvas">Sign out</button></div>
      : !step ? <button onClick={async () => { const r: any = await enrolTotp(); if (r.key) setStep(r); else setMsg(r.error); }} className="mt-5 inline-flex min-h-12 items-center bg-ink px-6 text-[15px] text-canvas">Set up an authenticator app</button>
      : (<div className="mt-5 space-y-3 text-[14.5px] text-ink-2">
        <p>In your app, add an account with this setup key (or open the link on your phone):</p>
        <code className="block break-all rounded-[10px] border-2 border-ink bg-[#fff1cc] p-3 text-[14px] text-[#4a3200]">{step.key}</code>
        <a href={step.url} className="text-[13.5px] font-bold text-emerald-d underline">Open in an authenticator app</a>
        <label className="block pt-2"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">6-digit code shown by the app</span><input className={field + " max-w-[220px] tracking-[0.4em]"} inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <button onClick={async () => { const r = await step.finish(code); if (r.ok) setDone(true); else setMsg(r.error); }} className="inline-flex min-h-11 items-center bg-ink px-5 text-[14.5px] text-canvas">Confirm</button></div>)}
    {msg && <p role="alert" className="mt-4 text-[14px] text-[#8f1d25]">{msg}</p>}
  </div>);
}

function Console() {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<"loading" | "mfa" | "ok" | "error">("loading");
  const [users, setUsers] = useState<User[]>([]), [grants, setGrants] = useState<any[]>([]), [audit, setAudit] = useState<any[]>([]);
  const [g, setG] = useState({ email: "", role: "officer" as Role });
  const load = useCallback(async () => {
    const u = await send("/api/admin/users");
    if (u.status === 403 && u.data?.detail === "mfa_required") { setState("mfa"); return; }
    if (!u.ok) { setState("error"); toast(u.data?.detail ?? "Could not load accounts."); return; }
    const a = await send("/api/admin/audit?limit=200");
    setUsers(u.data.users); setGrants(u.data.grants); setAudit(a.ok ? a.data.entries : []); setState("ok");
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/admin/grants", g);
    if (!r.ok) { toast(typeof r.data?.detail === "string" ? r.data.detail : "Not saved."); return; }
    toast(`${ROLE_NAME[g.role]} role given to ${g.email}`); setG({ email: "", role: "officer" }); load();
  }
  async function patch(uid: string, body: { role?: Role; active?: boolean }) {
    const r = await send(`/api/admin/users/${encodeURIComponent(uid)}`, body);
    if (!r.ok) { toast(r.data?.detail ?? "Not changed."); return; }
    toast("Saved. It applies on that person's next request."); load();
  }
  if (state === "mfa") return <Mfa />;
  if (state === "loading") return <div className="card p-6" aria-busy="true"><TableSkeleton rows={6} /></div>;
  return (<div className="grid gap-8">
    <section aria-labelledby="adm-users" className="grid gap-8 xl:grid-cols-[1.5fr_1fr]">
      <div className="card scroll-thin overflow-x-auto p-0" tabIndex={0} aria-label="Accounts, scrollable">
        <h2 id="adm-users" className="px-6 pt-5 font-display text-[26px] font-extrabold tracking-[-0.02em] text-ink">Accounts</h2>
        <table className="mt-2 w-full min-w-[600px] text-left text-[14px]">
          <thead><tr className="border-b-2 border-ink text-[12.5px] text-ink-3"><th className="px-6 py-3 font-bold">Person</th><th className="py-3 font-bold">Role</th><th className="px-6 py-3 font-bold">Status</th></tr></thead>
          <tbody>{users.map((u) => { const self = u.uid === user?.uid; return (<tr key={u.uid} className="border-b border-line">
            <td className="px-6 py-3"><b className="text-ink">{u.name ?? u.email}</b><span className="block text-[12.5px] text-ink-3">{u.email}{self ? " (you)" : ""}</span></td>
            <td><select aria-label={`Role for ${u.email}`} disabled={self} value={u.role} onChange={(e) => patch(u.uid, { role: e.target.value as Role })} className="min-h-9 rounded-full border-2 border-ink bg-ivory px-3 text-[13px] font-bold text-ink disabled:opacity-60">
              {(["user", "officer", "admin"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}</select></td>
            <td className="px-6"><button disabled={self} onClick={() => patch(u.uid, { active: !u.active })} className={"min-h-9 rounded-full border-2 border-ink px-3.5 text-[12.5px] font-bold disabled:opacity-50 " + (u.active ? "bg-[#d9f7ea] text-[#0b5d44]" : "bg-[#ffe9ea] text-[#8f1d25]")}>{u.active ? "Active" : "Deactivated"}</button></td>
          </tr>); })}</tbody></table>
      </div>
      <form onSubmit={grant} className="card p-6">
        <h2 className="font-display text-[24px] font-extrabold tracking-[-0.02em] text-ink">Give someone a role</h2>
        <p className="mt-1 text-[13.5px] text-ink-3">Enter their email. The role applies now if they already have an account, otherwise when they first sign in. Elevated roles need a verified email.</p>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="mb-1 block text-[13px] font-bold text-ink">Email</span><input className={field} type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} required maxLength={254} /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-bold text-ink">Role</span><select className={field} value={g.role} onChange={(e) => setG({ ...g, role: e.target.value as Role })}>
            {(["officer", "admin", "user"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}</select></label>
        </div>
        <button type="submit" className="mt-5 inline-flex min-h-12 items-center bg-ink px-6 text-[15px] text-canvas">Save role</button>
        {grants.length > 0 && <ul className="mt-5 divide-y divide-line border-t border-line text-[13px]">{grants.slice(0, 8).map((x) => <li key={x.email} className="flex justify-between gap-3 py-2"><span className="truncate text-ink">{x.email}</span><b>{ROLE_NAME[x.role as Role]}</b></li>)}</ul>}
      </form>
    </section>
    <section aria-labelledby="adm-audit" className="card scroll-thin overflow-x-auto p-0" tabIndex={0}>
      <h2 id="adm-audit" className="px-6 pt-5 font-display text-[26px] font-extrabold tracking-[-0.02em] text-ink">Audit log</h2>
      <p className="px-6 text-[13px] text-ink-3">Sign-ins, role changes, alert reviews and plan decisions, newest first. Append-only.</p>
      <table className="num mt-3 w-full min-w-[720px] text-left text-[13.5px]">
        <thead><tr className="border-b-2 border-ink text-[12.5px] text-ink-3"><th className="px-6 py-2.5 font-bold">When</th><th className="font-bold">Who</th><th className="font-bold">Action</th><th className="px-6 font-bold">Target</th></tr></thead>
        <tbody>{audit.map((e, i) => (<tr key={i} className="border-b border-line"><td className="whitespace-nowrap px-6 py-2">{new Date(e.ts * 1000).toLocaleString()}</td><td>{e.actor ?? "-"}</td>
          <td><b className="text-ink">{e.action.replace(/_/g, " ")}</b>{e.detail ? <span className="ml-1.5 text-ink-3">{Object.entries(e.detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("; ")}</span> : null}</td><td className="px-6">{e.target ?? ""}</td></tr>))}</tbody></table>
    </section>
  </div>);
}

export default function Admin() {
  return (<>
    <PageHeader eyebrow="Administration, signed in" title="Roles and audit" art={<KeyArt className="w-full" />}
      sub="Give people the officer or administrator role, deactivate access and read the audit log. Administration always needs an authenticator app." />
    <Gate need="admin"><Console /></Gate>
  </>);
}
