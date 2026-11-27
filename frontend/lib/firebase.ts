"use client";
// Firebase Authentication client (V4). Loaded lazily, and only when the deployment has a Firebase web config (NEXT_PUBLIC_FIREBASE_*).
// Sessions use tab-scoped persistence: closing the tab signs out. The web config is public by design; access rules live on the server.
import type { Auth } from "firebase/auth";

const cfg = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID };
export const firebaseConfigured = !!(cfg.apiKey && cfg.authDomain && cfg.projectId);

type FB = { auth: Auth; mod: typeof import("firebase/auth") };
let loading: Promise<FB> | null = null;
export function firebaseAuth(): Promise<FB> {
  if (!firebaseConfigured) return Promise.reject(new Error("Accounts are not configured on this deployment."));
  return (loading ??= (async () => {
    const [{ initializeApp, getApps }, mod] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const auth = mod.getAuth(getApps()[0] ?? initializeApp(cfg as Record<string, string>));
    await mod.setPersistence(auth, mod.browserSessionPersistence);
    return { auth, mod };
  })());
}
