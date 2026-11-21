"use client";
// Global search (Ctrl/⌘ K): jump to a page, a synthetic forecast ward, or a real OSM hospital/clinic on the map.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { cls } from "@/lib/format";
import { Icon } from "./icons";

interface Item { kind: "Page" | "Ward" | "Facility"; label: string; sub: string; go: () => void }

export default function Palette({ pages }: { pages: readonly (readonly [string, string, string])[] }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [i, setI] = useState(0);
  const [wards, setWards] = useState<any[]>([]), [fac, setFac] = useState<any[]>([]), [mounted, setMounted] = useState(false);
  const router = useRouter(); const { set } = useSel(); const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setMounted(true);
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {                         // reset only when the palette opens (not when data arrives: that would wipe what the user typed)
    if (!open) return;
    setQ(""); setI(0); setTimeout(() => input.current?.focus(), 30);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (!wards.length) api("/api/wards", { ttl: 600_000 }).then((d: any) => setWards(d.wards ?? d)).catch(() => {});
    if (!fac.length) api("/api/facilities", { ttl: 600_000 }).then((d: any) => setFac(d.features ?? [])).catch(() => {});
  }, [open, wards.length, fac.length]);
  const items: Item[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    const close = () => setOpen(false);
    const pg = pages.map(([href, key]) => ({ kind: "Page" as const, label: t(key), sub: href, go: () => { close(); router.push(href); } }));
    const wd = wards.map((w: any) => ({ kind: "Ward" as const, label: w.ward_id, sub: `${w.city} · synthetic forecast ward`, go: () => { close(); set({ ward: w.ward_id }); router.push("/"); } }));
    const fc = fac.map((f: any) => ({ kind: "Facility" as const, label: f.properties.name ?? "Unnamed facility", sub: `${f.properties.kind} · ${f.properties.city} · OpenStreetMap`, go: () => { close(); router.push(`/geography/?facility=${encodeURIComponent(f.properties.id)}`); } }));
    if (!s) return [...pg, ...wd.slice(0, 4)];
    const hit = (x: Item) => x.label.toLowerCase().includes(s) || x.sub.toLowerCase().includes(s);
    return [...pg.filter(hit), ...wd.filter(hit).slice(0, 6), ...fc.filter(hit).slice(0, 8)];
  }, [q, pages, wards, fac, router, set, t]);
  useEffect(() => setI(0), [q]);
  return (<>
    <button onClick={() => setOpen(true)} className="hidden items-center gap-2 rounded-xl border border-line bg-white/80 px-3 py-1.5 text-[13px] text-ink-3 shadow-sm hover:border-teal/50 md:inline-flex" aria-label="Search pages, wards and hospitals">
      <Icon name="search" size={15} />Search<kbd className="ml-3 rounded border border-line bg-canvas px-1.5 text-[10px] font-semibold">⌘K</kbd></button>
    {mounted && open && createPortal(
      <div className="fixed inset-0 z-[90] grid place-items-start justify-center bg-navy/45 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
        <div role="dialog" aria-modal="true" aria-label="Search" className="card w-full max-w-xl overflow-hidden p-0 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 border-b border-line px-4"><Icon name="search" size={18} className="text-ink-3" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, wards (e.g. DNCC_Ward_19) or hospitals…" aria-label="Search query"
              onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } else if (e.key === "Enter") items[i]?.go(); else if (e.key === "Escape") setOpen(false); }}
              className="w-full bg-transparent py-3.5 text-[15px] outline-none" /></div>
          <ul role="listbox" aria-label="Results" className="scroll-thin max-h-[52vh] overflow-y-auto p-2">
            {items.length ? items.map((x, k) => (<li key={`${x.kind}${x.label}${k}`} role="option" aria-selected={k === i}>
              <button onMouseEnter={() => setI(k)} onClick={x.go} className={cls("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", k === i ? "bg-mint-l" : "hover:bg-canvas")}>
                <span className={cls("w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase", x.kind === "Page" ? "bg-navy/8 text-navy" : x.kind === "Ward" ? "bg-amber/20 text-amber-d" : "bg-sky/15 text-sky")}>{x.kind}</span>
                <span className="min-w-0"><span className="block truncate text-[14px] font-medium">{x.label}</span><span className="block truncate text-[11.5px] text-ink-3">{x.sub}</span></span></button></li>))
              : <li className="p-6 text-center text-sm text-ink-3">No matches.</li>}
          </ul>
          <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">↑↓ to move · Enter to open · Esc to close · wards are synthetic forecast IDs; facilities are OpenStreetMap records</div>
        </div></div>, document.body)}
  </>);
}
