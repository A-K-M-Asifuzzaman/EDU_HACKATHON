"use client";
// Sign in with Firebase Authentication (V4). Public forecasting never needs an account. Readers can create an account (email verified by
// Firebase); officers and administrators are given their role by an administrator, and administrators confirm with an authenticator app.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { Cloud, KeyArt } from "@/components/illustrations";
import { atLeast, useAuth } from "@/lib/auth";

const field = "min-h-11 w-full rounded-[12px] border-[2.5px] border-ink bg-ivory px-3 text-[15px] text-ink outline-none focus-visible:ring-4 focus-visible:ring-[#ffd36e]";

export default function SignIn() {
  const a = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState(""), [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);

  async function run(p: Promise<{ ok: boolean; mfaRequired?: boolean; error?: string }>, after?: string) {
    setBusy(true); setErr(null); setNote(null);
    const r = await p; setBusy(false);
    if (r.mfaRequired) { setMfa(true); return; }
    if (!r.ok) { setErr(r.error ?? "Something went wrong."); return; }
    if (after) setNote(after);
  }
  const submit = (e: React.FormEvent) => { e.preventDefault();
    if (mfa) return run(a.confirmMfa(code));
    return mode === "signin" ? run(a.login(email, password)) : run(a.register(email, name, password), "Account created. We sent a verification link to your email."); };

  const signedIn = a.ready && a.user;
  return (<>
    <PageHeader eyebrow="Accounts" title="Sign in" art={<KeyArt className="w-full" />}
      sub="Forecasts, evidence, the map and routing are open to everyone without an account. Sign in only if you are an officer or administrator, or if you want an optional reader account." />
    <div className="mx-auto grid max-w-[1000px] gap-8 lg:grid-cols-[1.1fr_1fr]">
      <section className="card p-6 sm:p-8" aria-labelledby="form-title">
        {!a.configured ? (<div className="flex flex-col items-start gap-4">
          <Cloud mood="thinking" rain={false} className="w-28" />
          <h2 id="form-title" className="font-display text-[26px] font-extrabold text-ink">Accounts are not set up here yet</h2>
          <p className="text-[15px] text-ink-2">This deployment has no Firebase project configured, so officer and administrator areas are closed. Every public page works as usual.</p>
          <Link href="/" className="btn-ghost inline-flex min-h-11 items-center px-5 text-[14.5px]">Back to the forecasts</Link></div>)
        : signedIn ? (<div>
          <h2 id="form-title" className="font-display text-[26px] font-extrabold text-ink">You are signed in</h2>
          <p className="mt-2 text-[15px] text-ink-2">{a.user!.name ?? a.user!.email} ({a.user!.email}), role: <b>{a.user!.effective_role ?? a.user!.role}</b>{a.user!.mfa ? ", authenticator confirmed" : ""}.</p>
          {a.user!.email_verified === false && <div role="status" className="mt-4 rounded-[12px] border-2 border-ink bg-[#fff1cc] p-3 text-[14px] text-[#4a3200]">
            Verify your email to use any officer or administrator role. <button className="font-bold underline" onClick={() => run(a.resendVerification(), "Verification email sent.")}>Send the link again</button>
            <button className="ml-3 font-bold underline" onClick={() => a.reload()}>I have verified it</button></div>}
          <div className="mt-5 flex flex-wrap gap-3">
            {atLeast(a.user, "officer") && <Link href="/officer/" className="inline-flex min-h-11 items-center bg-ink px-5 text-[14.5px] text-canvas">Open the officer workspace</Link>}
            {a.user!.role === "admin" && <Link href="/admin/" className="btn-ghost inline-flex min-h-11 items-center px-5 text-[14.5px]">Administration</Link>}
            <button onClick={a.logout} className="btn-ghost inline-flex min-h-11 items-center px-5 text-[14.5px]">Sign out</button>
          </div>
          {note && <p role="status" className="mt-4 text-[14px] text-ink-2">{note}</p>}</div>)
        : (<form onSubmit={submit} noValidate>
          <h2 id="form-title" className="font-display text-[26px] font-extrabold text-ink">{mfa ? "Authenticator code" : mode === "signin" ? "Welcome back" : "Create a reader account"}</h2>
          {a.serverError && a.signedIn && <p role="alert" className="mt-3 text-[14px] text-[#8f1d25]">{a.serverError}</p>}
          <div className="mt-5 space-y-4">
            {!mfa && mode === "register" && <label className="block"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">Name</span><input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} /></label>}
            {!mfa && <label className="block"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">Email</span><input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} /></label>}
            {!mfa && <label className="block"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">Password</span><input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} maxLength={256} />
              {mode === "register" && <span className="mt-1 block text-[12.5px] text-ink-3">At least 12 characters. A short sentence works well.</span>}</label>}
            {mfa && <label className="block"><span className="mb-1.5 block text-[13.5px] font-bold text-ink">6-digit code from your authenticator app</span><input className={field + " tracking-[0.4em]"} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>}
          </div>
          {err && <p role="alert" className="mt-4 rounded-[10px] border-2 border-[#c2303a] bg-[#ffe9ea] px-3 py-2 text-[14px] text-[#8f1d25]">{err}</p>}
          {note && <p role="status" className="mt-4 text-[14px] text-ink-2">{note}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center bg-ink px-6 text-[15px] text-canvas disabled:opacity-60">{busy ? "Checking…" : mfa ? "Confirm" : mode === "signin" ? "Sign in" : "Create account"}</button>
            {!mfa && <button type="button" disabled={busy} onClick={() => run(a.google())} className="btn-ghost inline-flex min-h-12 items-center gap-2 px-5 text-[15px]">Continue with Google</button>}
          </div>
          <div className="mt-4">{!mfa ? <button type="button" onClick={() => { setMode(mode === "signin" ? "register" : "signin"); setErr(null); }} className="text-[14px] font-bold text-emerald-d underline underline-offset-4">{mode === "signin" ? "Create a reader account" : "I already have an account"}</button>
            : <button type="button" onClick={() => { setMfa(false); setCode(""); }} className="text-[14px] font-bold text-emerald-d underline underline-offset-4">Back</button>}</div>
        </form>)}
      </section>
      <aside className="space-y-4 text-[14.5px] leading-relaxed text-ink-2">
        <div className="card p-5"><h3 className="font-display text-[19px] font-extrabold text-ink">Who needs an account</h3>
          <ul className="mt-2 space-y-1.5"><li><b className="text-ink">Most people:</b> nobody. Every public page works without signing in.</li>
            <li><b className="text-ink">Reader:</b> optional, for people who want an account.</li><li><b className="text-ink">Officer:</b> reviews model alerts and drafts response plans.</li>
            <li><b className="text-ink">Administrator:</b> grants roles, approves plans, reads the audit log; always confirms with an authenticator app.</li></ul></div>
        <div className="card p-5"><h3 className="font-display text-[19px] font-extrabold text-ink">How sign-in works</h3>
          <p className="mt-2">Google&apos;s Firebase Authentication handles your password; DengueShield never sees it. Our server checks your sign-in on every protected request. Sessions end when you close the tab, after 60 idle minutes, or after 8 hours.</p></div>
      </aside>
    </div>
  </>);
}
