"use client";
// Account control (V4): "Sign in" when signed out; otherwise a menu with the role and the protected workspaces. Hidden entirely when the
// deployment has no Firebase project, so the public site shows nothing it cannot do.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { atLeast, useAuth } from "@/lib/auth";

const ROLE = { user: "Reader", officer: "Officer", admin: "Administrator" } as const;

export function AccountButton() {
  const { user, ready, configured, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; addEventListener("mousedown", off); return () => removeEventListener("mousedown", off); }, [open]);
  if (!configured) return null;
  if (!ready) return <span className="hidden h-9 w-[84px] sm:block" aria-hidden />;
  if (!user) return <Link href="/signin/" className="hidden min-h-10 items-center whitespace-nowrap rounded-full border-2 border-[#1a1438] bg-[#ffc23d] px-4 text-[13.5px] font-bold text-[#1a1438] shadow-[2px_2px_0_#1a1438] hover:brightness-105 sm:inline-flex">Sign in</Link>;
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();
  return (<div ref={box} className="relative hidden sm:block">
    <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${user.email}`}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-white/40 py-0.5 pl-0.5 pr-3 text-[13px] font-bold text-white hover:bg-white/15">
      <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#1a1438] bg-[#ffc23d] text-[13px] font-extrabold text-[#1a1438]">{initial}</span>{ROLE[(user.effective_role ?? user.role) as keyof typeof ROLE]}</button>
    {open && (<div role="menu" className="card absolute right-0 top-full z-40 mt-2 w-60 p-2 text-[14px]">
      <div className="px-3 py-2 text-[12.5px] text-ink-3">{user.email}</div>
      {atLeast(user, "officer") && <Link role="menuitem" href="/officer/" onClick={() => setOpen(false)} className="block rounded-[10px] px-3 py-2 font-bold text-ink hover:bg-mint-l">Officer workspace</Link>}
      {user.role === "admin" && <Link role="menuitem" href="/admin/" onClick={() => setOpen(false)} className="block rounded-[10px] px-3 py-2 font-bold text-ink hover:bg-mint-l">Administration</Link>}
      <Link role="menuitem" href="/signin/" onClick={() => setOpen(false)} className="block rounded-[10px] px-3 py-2 font-bold text-ink hover:bg-mint-l">Account</Link>
      <button role="menuitem" onClick={() => { setOpen(false); logout(); }} className="block w-full rounded-[10px] px-3 py-2 text-left font-bold text-ink hover:bg-mint-l">Sign out</button></div>)}
  </div>);
}

/** The same choices inside the mobile navigation drawer. */
export function AccountLinks({ onNavigate }: { onNavigate: () => void }) {
  const { user, configured, logout } = useAuth();
  if (!configured) return null;
  const cls = "flex min-h-11 items-center rounded-[12px] px-3 text-[15px] font-bold text-white hover:bg-white/15";
  return (<div className="mt-5 border-t border-white/25 pt-4">
    <div className="mb-1 px-3 text-[12.5px] font-bold text-white/70">{user ? `Signed in: ${user.email}` : "Account"}</div>
    {!user && <Link href="/signin/" onClick={onNavigate} className={cls}>Sign in</Link>}
    {atLeast(user, "officer") && <Link href="/officer/" onClick={onNavigate} className={cls}>Officer workspace</Link>}
    {user?.role === "admin" && <Link href="/admin/" onClick={onNavigate} className={cls}>Administration</Link>}
    {user && <button onClick={() => { onNavigate(); logout(); }} className={cls + " w-full text-left"}>Sign out</button>}
  </div>);
}
