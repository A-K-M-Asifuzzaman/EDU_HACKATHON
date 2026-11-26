"use client";
import { useMemo , useEffect, useState} from "react";
import { useSel } from "@/lib/ctx";
import { useI18n } from "@/lib/i18n";
import { addWeeks, isMonday } from "@/lib/api";
import { dateFmt } from "@/lib/format";
import { Btn, Segmented, Select } from "./ui";

export function snapMonday(iso: string) { let d = new Date(iso + "T00:00:00Z"); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

/** City, ward, origin scrubber, horizon and source. All state is shared across pages (lib/ctx). */
export default function ControlsBar({ show = ["city", "ward", "origin", "horizon", "source"] }: { show?: string[] }) {
  const { sel, set, reset, wards, meta } = useSel();
  const { t, lang } = useI18n();
  const cities = useMemo(() => Array.from(new Set(wards.map((w) => w.city))).sort(), [wards]);
  const list = wards.filter((w) => sel.city === "All" || w.city === sel.city);
  const rep = meta?.origins?.replay?.[sel.horizon];
  const bun = meta?.origins?.bundle;
  const min = rep?.min ?? "2019-01-07", max = bun?.latest_forward_origin ?? rep?.max ?? "2024-12-30";
  const idx = Math.max(0, Math.round((new Date(sel.origin).getTime() - new Date(min).getTime()) / (7 * 86400000)));
  const total = Math.round((new Date(max).getTime() - new Date(min).getTime()) / (7 * 86400000));
  const setIdx = (i: number) => set({ origin: addWeeks(min, Math.min(total, Math.max(0, i))) });
  // Forecast time machine: step the origin forward one week at a time through real forecasts
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (idx >= total) { setPlaying(false); return; }
    const id = setTimeout(() => setIdx(idx + 1), 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, total]);
  return (
    <div className="card mb-6 flex flex-wrap items-end gap-4 p-4">
      {show.includes("city") && <Select label={t("ctl.city")} value={sel.city} onChange={(v) => { const first = wards.find((w) => v === "All" || w.city === v); set({ city: v, ward: v === "All" || list.some((w) => w.ward_id === sel.ward) && wards.find((w) => w.ward_id === sel.ward)?.city === v ? sel.ward : first?.ward_id ?? sel.ward }); }}
        options={[{ value: "All", label: t("ctl.all") }, ...cities.map((c) => ({ value: c, label: c }))]} />}
      {show.includes("ward") && <Select label={t("ctl.ward")} value={sel.ward} onChange={(v) => set({ ward: v })} options={list.map((w) => ({ value: w.ward_id, label: w.ward_id }))} />}
      {show.includes("horizon") && <Segmented label={t("ctl.horizon")} value={sel.horizon} onChange={(v) => set({ horizon: Number(v) })} options={[2, 3, 4].map((h) => ({ value: h, label: `${h} ${t("ctl.weeks")}` }))} />}
      {show.includes("origin") && (<div className="w-full flex-1 basis-full sm:basis-[260px]">
        <div className="mb-1 flex items-center justify-between"><span className="eyebrow">{t("ctl.origin")}</span><span className="text-sm font-semibold text-forest">{dateFmt(sel.origin, lang)}</span></div>
        <div className="flex items-center gap-2">
          <Btn variant={playing ? "dark" : "ghost"} aria-label={playing ? "Pause time machine" : "Play time machine: step forward week by week"} aria-pressed={playing} title="Time machine: replay forecasts week by week" onClick={() => setPlaying((p) => !p)} className="!px-2.5">{playing ? "❚❚" : "▶"}</Btn>
          <Btn variant="ghost" aria-label="Previous week" onClick={() => setIdx(idx - 1)} className="!px-2.5">‹</Btn>
          <input type="range" aria-label={t("ctl.origin")} min={0} max={total} value={Math.min(idx, total)} onChange={(e) => setIdx(Number(e.target.value))} className="h-2 w-full accent-emerald" />
          <Btn variant="ghost" aria-label="Next week" onClick={() => setIdx(idx + 1)} className="!px-2.5">›</Btn></div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-3"><span>{dateFmt(min, lang)}</span><span className="flex gap-3"><button className="underline decoration-dotted hover:text-emerald-d" onClick={() => set({ origin: "2024-08-05" })}>{t("ctl.peak")}</button>
          <button className="underline decoration-dotted hover:text-emerald-d" onClick={() => { navigator.clipboard?.writeText(window.location.href); }} title={t("ctl.copylink.tip")}>{t("ctl.copylink")}</button>
          <button className="underline decoration-dotted hover:text-emerald-d" onClick={reset}>{t("ctl.reset")}</button></span><span>{dateFmt(max, lang)}</span></div>
        {!isMonday(sel.origin) && <div className="mt-1 text-xs text-coral-d">Origin must be a Monday</div>}
      </div>)}
      {show.includes("source") && <Segmented label={t("ctl.source")} value={sel.source} onChange={(v) => set({ source: v as any })} options={[{ value: "auto", label: t("ctl.auto") }, { value: "replay", label: t("ctl.replay") }, { value: "bundle", label: t("ctl.deployed") }]} />}
    </div>);
}
