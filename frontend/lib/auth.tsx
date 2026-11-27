"use client";
// Client side of V4 accounts on Firebase Authentication. Firebase signs people in; the API verifies the ID token on every protected
// request and decides every permission. This context only shapes the interface.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BASE } from "./api";
import { firebaseAuth, firebaseConfigured } from "./firebase";

export type Role = "user" | "officer" | "admin";
export type User = { uid: string; email: string; name: string | null; role: Role; active: boolean; email_verified?: boolean; mfa?: boolean; provider?: string; effective_role?: Role };
const RANK: Record<Role, number> = { user: 1, officer: 2, admin: 3 };
export const atLeast = (u: User | null, r: Role) => !!u && u.active && RANK[(u.effective_role ?? u.role) as Role] >= RANK[r];
const IDLE_MS = 60 * 60 * 1000;

async function token(): Promise<string | null> {
  if (!firebaseConfigured) return null;
  try { const { auth } = await firebaseAuth(); return auth.currentUser ? await auth.currentUser.getIdToken() : null; } catch { return null; }
}

/** JSON request carrying the Firebase ID token when signed in; never throws. */
export async function send<T = any>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | any }> {
  try {
    const t = await token();
    const headers: Record<string, string> = {};
    if (t) headers.Authorization = `Bearer ${t}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(BASE + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data: any = null; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: { detail: "The DengueShield service could not be reached." } }; }
}

const FB_ERR: Record<string, string> = {
  "auth/invalid-credential": "Email or password is incorrect.", "auth/wrong-password": "Email or password is incorrect.", "auth/user-not-found": "Email or password is incorrect.",
  "auth/invalid-email": "Enter a valid email address.", "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Use a password of at least 12 characters.", "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Could not reach the sign-in service. Check your connection.", "auth/popup-closed-by-user": "The Google window was closed before signing in.",
  "auth/invalid-verification-code": "The authenticator code is incorrect.", "auth/requires-recent-login": "For your security, sign out and sign in again first.",
  "auth/operation-not-allowed": "This sign-in method is not enabled for this project.",
  "auth/configuration-not-found": "Sign-in is not switched on for this Firebase project yet. The project owner needs to open Firebase Authentication and click Get started.",
  "auth/unauthorized-domain": "This web address is not on the Firebase project's authorized domains list.",
  "auth/popup-blocked": "The browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/user-disabled": "This account has been disabled.", "auth/admin-restricted-operation": "New accounts are turned off for this project.",
};
// The code is not secret and makes an unmapped failure diagnosable.
const fbMessage = (e: any) => FB_ERR[e?.code] ?? `Sign-in failed${e?.code ? ` (${e.code})` : ""}. Try again.`;

type Result = { ok: boolean; mfaRequired?: boolean; error?: string; user?: User | null };
type Enrol = { key: string; url: string; finish: (code: string) => Promise<Result> };
type Ctx = { user: User | null; ready: boolean; configured: boolean; signedIn: boolean; serverError: string | null;
  login: (email: string, password: string) => Promise<Result>; google: () => Promise<Result>; confirmMfa: (code: string) => Promise<Result>;
  register: (email: string, name: string, password: string) => Promise<Result>; logout: () => Promise<void>; reload: () => Promise<void>;
  resendVerification: () => Promise<Result>; enrolTotp: () => Promise<Enrol | Result> };
const AuthCtx = createContext<Ctx>({} as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(!firebaseConfigured), [signedIn, setSignedIn] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const resolver = useRef<any>(null);
  const pull = useCallback(async () => {
    const r = await send("/api/auth/me");
    setUser(r.ok ? r.data.user : null); setServerError(r.ok ? null : r.data?.detail ?? null); setReady(true);
  }, []);
  useEffect(() => {
    if (!firebaseConfigured) return;
    let off = () => {};
    const start = () => firebaseAuth().then(({ auth, mod }) => { off = mod.onIdTokenChanged(auth, (u) => { setSignedIn(!!u); if (u) pull(); else { setUser(null); setServerError(null); setReady(true); } }); }).catch(() => setReady(true));
    const id = setTimeout(start, 300);                                                    // let the page become interactive first
    return () => { clearTimeout(id); off(); };
  }, [pull]);
  useEffect(() => {                                                                       // officers and admins: sign out after 60 idle minutes
    if (!atLeast(user, "officer")) return;
    let t = setTimeout(() => logout(), IDLE_MS);
    const bump = () => { clearTimeout(t); t = setTimeout(() => logout(), IDLE_MS); };
    for (const ev of ["pointerdown", "keydown", "scroll"]) addEventListener(ev, bump, { passive: true });
    return () => { clearTimeout(t); for (const ev of ["pointerdown", "keydown", "scroll"]) removeEventListener(ev, bump); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const wrap = async (fn: (fb: Awaited<ReturnType<typeof firebaseAuth>>) => Promise<unknown>): Promise<Result> => {
    try { const fb = await firebaseAuth(); await fn(fb); await pull(); return { ok: true }; }
    catch (e: any) {
      if (e?.code === "auth/multi-factor-auth-required") { const { auth, mod } = await firebaseAuth(); resolver.current = mod.getMultiFactorResolver(auth, e); return { ok: false, mfaRequired: true }; }
      return { ok: false, error: e?.message && !e?.code ? e.message : fbMessage(e) };
    }
  };
  const login = (email: string, password: string) => wrap(({ auth, mod }) => mod.signInWithEmailAndPassword(auth, email.trim(), password));
  const google = () => wrap(({ auth, mod }) => mod.signInWithPopup(auth, new mod.GoogleAuthProvider()));
  const confirmMfa = (code: string) => wrap(async ({ mod }) => {
    const r = resolver.current; const hint = r?.hints.find((h: any) => h.factorId === mod.TotpMultiFactorGenerator.FACTOR_ID);
    if (!r || !hint) throw new Error("This account has no authenticator app enrolled.");
    await r.resolveSignIn(mod.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim()));
  });
  const register = (email: string, name: string, password: string) => wrap(async ({ auth, mod }) => {
    if (password.length < 12) throw { code: "auth/weak-password" };
    const cred = await mod.createUserWithEmailAndPassword(auth, email.trim(), password);
    await mod.updateProfile(cred.user, { displayName: name.trim().slice(0, 80) });
    await mod.sendEmailVerification(cred.user); await cred.user.getIdToken(true);
  });
  const logout = async () => { try { const { auth, mod } = await firebaseAuth(); await mod.signOut(auth); } catch {} setUser(null); };
  const reload = async () => { try { const { auth } = await firebaseAuth(); await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); } catch {} await pull(); };
  const resendVerification = () => wrap(async ({ auth, mod }) => { if (auth.currentUser) await mod.sendEmailVerification(auth.currentUser); });
  const enrolTotp = async (): Promise<Enrol | Result> => {
    try {
      const { auth, mod } = await firebaseAuth(); const u = auth.currentUser; if (!u) return { ok: false, error: "Sign in first." };
      const secret = await mod.TotpMultiFactorGenerator.generateSecret(await mod.multiFactor(u).getSession());
      return { key: secret.secretKey, url: secret.generateQrCodeUrl(u.email ?? "account", "DengueShield AI"),
        finish: (code: string) => wrap(async () => { await mod.multiFactor(u).enroll(mod.TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), "Authenticator app"); }) };
    } catch (e: any) { return { ok: false, error: fbMessage(e) }; }
  };
  return <AuthCtx.Provider value={{ user, ready, configured: firebaseConfigured, signedIn, serverError, login, google, confirmMfa, register, logout, reload, resendVerification, enrolTotp }}>{children}</AuthCtx.Provider>;
}
