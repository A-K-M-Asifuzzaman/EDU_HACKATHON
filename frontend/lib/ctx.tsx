"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, type Ward } from "./api";

export interface Selection { city: string; ward: string; origin: string; horizon: number; source: "auto" | "replay" | "bundle" }
interface Meta { [k: string]: any }
interface Ctx {
  sel: Selection; set: (p: Partial<Selection>) => void; reset: () => void; wards: Ward[]; meta: Meta | null; error: string | null; ready: boolean; reload: () => void;
}
export const DEFAULT: Selection = { city: "All", ward: "DNCC_Ward_19", origin: "2024-08-05", horizon: 3, source: "auto" };
const C = createContext<Ctx>({ sel: DEFAULT, set: () => {}, reset: () => {}, wards: [], meta: null, error: null, ready: false, reload: () => {} });

/** Selection from the URL (?ward&origin&horizon&source&city), validated; invalid values are ignored. */
function fromUrl(): Partial<Selection> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search), out: Partial<Selection> = {};
  const ward = q.get("ward"), origin = q.get("origin"), h = Number(q.get("horizon")), src = q.get("source"), city = q.get("city");
  if (ward && /^[A-Z]{2,5}_Ward_\d{1,3}$/.test(ward)) out.ward = ward;
  if (origin && /^\d{4}-\d{2}-\d{2}$/.test(origin) && new Date(origin + "T00:00:00Z").getUTCDay() === 1) out.origin = origin;
  if ([2, 3, 4].includes(h)) out.horizon = h;
  if (src === "auto" || src === "replay" || src === "bundle") out.source = src;
  if (city && city.length < 40) out.city = city;
  return out;
}

function toUrl(s: Selection) {
  // Response owns the complete, versioned planning history entry.
  if (typeof window === "undefined" || /^\/response\/?$/.test(window.location.pathname)) return;
  const q = new URLSearchParams(window.location.search);
  q.set("ward", s.ward); q.set("origin", s.origin); q.set("horizon", String(s.horizon));
  if (s.source !== "auto") q.set("source", s.source); else q.delete("source");
  if (s.city !== "All") q.set("city", s.city); else q.delete("city");
  const url = `${window.location.pathname}?${q.toString()}${window.location.hash}`;
  if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", url);
}
export const useSel = () => useContext(C);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState<Selection>(DEFAULT);
  const [wards, setWards] = useState<Ward[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(() => {
    setError(null);
    Promise.all([api<Meta>("/api/metadata", { ttl: 300_000 }), api<Ward[]>("/api/wards", { ttl: 300_000 })])
      .then(([m, w]) => { setMeta(m); setWards(w); setReady(true); })
      .catch((e) => setError(e.message));
  }, []);
  const inited = useRef(false);
  const path = usePathname();
  // stored selection first, then the URL wins (deep links); afterwards every change is mirrored into the URL (shareable, reload-safe)
  useEffect(() => {
    let stored: Partial<Selection> = {};
    try { stored = JSON.parse(localStorage.getItem("ds.sel") || "null") || {}; } catch {}
    setSel((p) => ({ ...p, ...stored, ...fromUrl() }));
    inited.current = true;
    const onPop = () => {
      if (!/^\/response\/?$/.test(window.location.pathname)) setSel(p => ({ ...p, ...fromUrl() }));
    };
    window.addEventListener("popstate", onPop);
    load();
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);
  useEffect(() => { if (inited.current) toUrl(sel); }, [sel, path]);
  useEffect(() => { if (ready && wards.length && !wards.some((w) => w.ward_id === sel.ward)) setSel((p) => ({ ...p, ward: DEFAULT.ward })); }, [ready, wards, sel.ward]);
  const set = useCallback((p: Partial<Selection>) => setSel((s) => { const n = { ...s, ...p }; try { localStorage.setItem("ds.sel", JSON.stringify(n)); } catch {} return n; }), []);
  const reset = useCallback(() => { try { localStorage.removeItem("ds.sel"); } catch {} setSel(DEFAULT); }, []);
  const v = useMemo(() => ({ sel, set, reset, wards, meta, error, ready, reload: load }), [sel, set, reset, wards, meta, error, ready, load]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

/** "?ward=…&origin=…&horizon=…" for links that carry the current selection to another page (deep-link compatible). */
export const selQuery = (s: Selection) => `?ward=${encodeURIComponent(s.ward)}&origin=${s.origin}&horizon=${s.horizon}${s.source !== "auto" ? `&source=${s.source}` : ""}`;

/** Source actually requested from the API ("auto" lets the server choose: validated replay inside 2019-2024, else the live bundle). */
export const srcParam = (s: Selection) => (s.source === "auto" ? undefined : s.source);
