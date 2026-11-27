"use client";
// Every model configuration evaluated on the 2019-2024 out-of-time replay (mean of horizons 2-4), on one error axis, grouped by family.
// The champion is marked; the shaded band is the selection rule's 0.05 MAE tolerance (a decision threshold, not a confidence interval).
// Data: /api/model/comparison (the same saved file the Model Comparison Explorer uses). Loaded when scrolled into view.
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { RequestStatus, ServiceUnavailable, useAsync } from "./ui";
import { useWidth } from "./season-figure";

export default function ModelStrip() {
  const [box, W0] = useWidth<HTMLDivElement>(); const [seen, setSeen] = useState(false);
  useEffect(() => { const el = box.current; if (!el) return; const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "300px" }); io.observe(el); return () => io.disconnect(); }, []);
  const q = useAsync((s) => (seen ? api("/api/model/comparison", { signal: s, ttl: 3_600_000 }) : Promise.resolve(null)), [seen]);
  const data = useMemo(() => {
    const d: any = q.data; if (!d) return null;
    const rows = d.rows.filter((r: any) => r.window === "2019-2024" && r.horizon === "2-4 mean");
    const fam = (r: any) => d.models[`${r.model}|${r.variant_tag ?? ""}`]?.family ?? (r.feature_set === "none" ? "Naive baseline" : "Other");
    const champ = rows.find((r: any) => r.model === "glm_poisson" && r.feature_set === "F8" && !r.variant_tag) ?? rows.find((r: any) => r.model === "glm_poisson");
    const best = Math.min(...rows.map((r: any) => r.mae));
    const groups = Array.from(new Set(rows.map(fam))) as string[];
    groups.sort((a, b) => Math.min(...rows.filter((r: any) => fam(r) === a).map((r: any) => r.mae)) - Math.min(...rows.filter((r: any) => fam(r) === b).map((r: any) => r.mae)));
    return { rows, fam, champ, best, groups };
  }, [q.data]);
  const W = Math.max(W0, 320), L = W < 560 ? 104 : 168, R = 16, rowH = 30;
  const lo = Math.log(1.2), hi = Math.log(4), X = (v: number) => L + ((Math.log(v) - lo) / (hi - lo)) * (W - L - R);
  return (<div ref={box}>
    {q.status === "failed" && q.error ? <ServiceUnavailable error={q.error} onRetry={q.reload} label="The model comparison" />
      : !data ? <div aria-busy="true"><div className="skeleton h-[240px]" />{seen && <RequestStatus q={q} label="Model comparison" />}</div>
      : (<div>{W0 > 0 && (() => { const H = 30 + data.groups.length * rowH + 30; return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data.rows.length} model configurations by mean absolute error, 2019 to 2024. Champion ridge Poisson GLM ${data.champ?.mae.toFixed(3)}; best ${data.best.toFixed(3)}; naive baselines up to ${Math.max(...data.rows.map((r: any) => r.mae)).toFixed(2)}.`}>
          <rect className="sf-fade" x={X(data.best)} y={18} width={X(data.best + 0.05) - X(data.best)} height={H - 44} fill="var(--color-emerald)" opacity="0.14" />
          {[1.25, 1.5, 2, 3, 4].map((v) => <g key={v}><line x1={X(v)} x2={X(v)} y1={18} y2={H - 26} stroke="var(--color-line)" /><text x={X(v)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--color-ink-3)" className="num">{v}</text></g>)}
          <text x={W - R} y={12} textAnchor="end" fontSize="11" fill="var(--color-ink-3)">MAE, cases per ward-week (log scale)</text>
          {data.groups.map((g, gi) => { const y = 30 + gi * rowH + rowH / 2; return (<g key={g}>
            <text x={0} y={y + 4} fontSize="12" fill="var(--color-ink-2)">{g.length > (W < 560 ? 15 : 26) ? g.slice(0, W < 560 ? 14 : 25) + "…" : g}</text>
            {data.rows.filter((r: any) => data.fam(r) === g).map((r: any, i: number) => <circle key={i} className="sf-fade" style={{ animationDelay: `${0.2 + gi * 0.12 + i * 0.03}s` }} cx={X(r.mae)} cy={y} r="4.5"
              fill={r === data.champ ? "var(--color-emerald)" : "none"} stroke={r === data.champ ? "var(--color-canvas)" : "var(--color-ink-2)"} strokeWidth="1.3"><title>{`${r.model}${r.variant_tag ? " " + r.variant_tag : ""} ${r.feature_set}: MAE ${r.mae.toFixed(3)}`}</title></circle>)}
          </g>); })}
          {data.champ && (() => { const gi = data.groups.indexOf(data.fam(data.champ)), y = 30 + gi * rowH + rowH / 2; return <g className="sf-fade" style={{ animationDelay: "1.2s" }}>
            <circle cx={X(data.champ.mae)} cy={y} r="8" fill="none" stroke="var(--color-emerald)" strokeWidth="1.5" />
            <text x={X(data.champ.mae) + 12} y={y - 9} fontSize="12" fontWeight="600" fill="var(--color-ink)">champion {data.champ.mae.toFixed(3)}</text></g>; })()}
        </svg>); })()}
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{data.rows.length} configurations, out-of-time replay 2019 to 2024, mean of 2, 3 and 4 weeks ahead. Shaded: within 0.05 MAE of the best, the selection rule's tolerance (a decision threshold, not a confidence interval). The simplest model inside it on both validation windows was kept.</p>
      </div>)}
  </div>);
}
