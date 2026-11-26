"use client";
// Client-side guard for protected workspaces. It only shapes the interface: every protected API call is checked again on the server.
import Link from "next/link";
import { TableSkeleton } from "./ui";
import { Cloud } from "./illustrations";
import { atLeast, useAuth } from "@/lib/auth";

export function Gate({ need, children }: { need: "officer" | "admin"; children: React.ReactNode }) {
  const { user, ready, configured } = useAuth();
  if (!ready) return <div className="card p-6" aria-busy="true"><TableSkeleton rows={5} /></div>;
  if (!configured) return (<div className="card mx-auto flex max-w-[640px] flex-col items-center gap-4 p-8 text-center"><Cloud mood="thinking" rain={false} className="w-28" /><h2 className="font-display text-[24px] font-extrabold text-ink">Accounts are not set up here yet</h2><p className="text-[15px] text-ink-2">This deployment has no Firebase project configured. Every public page works as usual.</p></div>);
  if (!user || !atLeast(user, need)) return (<div className="card mx-auto flex max-w-[640px] flex-col items-center gap-4 p-8 text-center">
    <Cloud mood="thinking" rain={false} className="w-28" />
    <h2 className="font-display text-[24px] font-extrabold text-ink">{user ? "This workspace is for " + (need === "admin" ? "administrators" : "officers") : "Sign in to continue"}</h2>
    <p className="text-[15px] text-ink-2">{user ? user.email_verified === false ? "Verify your email first; elevated roles need a verified address." : `You are signed in as ${user.effective_role ?? user.role}. Ask an administrator if you need access.` : "Public forecasts and evidence stay open without an account."}</p>
    {!user && <Link href="/signin/" className="inline-flex min-h-11 items-center bg-ink px-5 text-[14.5px] text-canvas">Sign in</Link>}</div>);
  return <>{children}</>;
}
