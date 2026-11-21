"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type Ward } from "./api";

export interface Selection { city: string; ward: string; origin: string; horizon: number; source: "auto" | "replay" | "bundle" }
interface Meta { [k: string]: any }
interface Ctx {
  sel: Selection; set: (p: Partial<Selection>) => void; wards: Ward[]; meta: Meta | null; error: string | null; ready: boolean; reload: () => void;
}
const DEFAULT: Selection = { city: "All", ward: "DNCC_Ward_19", origin: "2024-08-05", horizon: 3, source: "auto" };
const C = createContext<Ctx>({ sel: DEFAULT, set: () => {}, wards: [], meta: null, error: null, ready: false, reload: () => {} });
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
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem("ds.sel") || "null"); if (s) setSel((p) => ({ ...p, ...s })); } catch {} load(); }, [load]);
  const set = useCallback((p: Partial<Selection>) => setSel((s) => { const n = { ...s, ...p }; try { localStorage.setItem("ds.sel", JSON.stringify(n)); } catch {} return n; }), []);
  const v = useMemo(() => ({ sel, set, wards, meta, error, ready, reload: load }), [sel, set, wards, meta, error, ready, load]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

/** Source actually requested from the API ("auto" lets the server choose: validated replay inside 2019-2024, else the live bundle). */
export const srcParam = (s: Selection) => (s.source === "auto" ? undefined : s.source);
