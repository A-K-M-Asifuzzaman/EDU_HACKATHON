"use client";
import { useEffect, useRef } from "react";

let loader: Promise<any> | null = null;
function loadEcharts() {
  if (!loader) loader = import("echarts/core").then(async (core) => {
    const [charts, comps, rend] = await Promise.all([import("echarts/charts"), import("echarts/components"), import("echarts/renderers")]);
    core.use([charts.LineChart, charts.BarChart, charts.ScatterChart, charts.HeatmapChart, charts.BoxplotChart, charts.PieChart, charts.GaugeChart, charts.CustomChart,
      comps.GridComponent, comps.TooltipComponent, comps.LegendComponent, comps.DataZoomComponent, comps.VisualMapComponent, comps.MarkLineComponent, comps.MarkAreaComponent,
      comps.MarkPointComponent, comps.ToolboxComponent, comps.TitleComponent, comps.AxisPointerComponent, comps.DatasetComponent, rend.CanvasRenderer]);
    return core;
  });
  return loader;
}

export const PALETTE = ["#0e8f66", "#3b82c4", "#f5b544", "#ea575b", "#7a5cc7", "#2a9d8f", "#8d99ae", "#c26a2a"];
const reduce = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Chart({ option, height = 300, onClick, ariaLabel, className = "" }: { option: any; height?: number; onClick?: (p: any) => void; ariaLabel?: string; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<any>(null);
  const opt = useRef(option);
  opt.current = option;
  useEffect(() => {
    let dead = false, ro: ResizeObserver | null = null;
    loadEcharts().then((core) => {
      if (dead || !el.current) return;
      inst.current = core.init(el.current, undefined, { renderer: "canvas" });
      let narrow = isNarrow(el.current);
      inst.current.setOption(withDefaults(opt.current, el.current.clientWidth), true);
      if (onClick) inst.current.on("click", onClick);
      ro = new ResizeObserver(() => {
        if (!inst.current || !el.current) return;
        if (isNarrow(el.current) !== narrow) { narrow = !narrow; inst.current.setOption(withDefaults(opt.current, el.current.clientWidth), true); } // phone rotated or panel resized
        inst.current.resize();
      });
      ro.observe(el.current);
    });
    return () => { dead = true; ro?.disconnect(); inst.current?.dispose(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { inst.current?.setOption(withDefaults(option, el.current?.clientWidth ?? 0), true); }, [option]);
  return <div ref={el} role="img" aria-label={ariaLabel} className={className} style={{ height, width: "100%" }} />;
}

const TOOLTIP = { trigger: "axis", confine: true, backgroundColor: "rgba(255,255,255,0.97)", borderColor: "#e3e9ef", textStyle: { color: "#0d1b2a", fontSize: 12 },
  extraCssText: "box-shadow:0 8px 24px -8px rgba(7,59,43,.25);border-radius:10px;max-width:min(320px,calc(100vw - 32px));white-space:normal;overflow-wrap:anywhere" };

const NARROW = 560;
const isNarrow = (el: HTMLElement) => el.clientWidth > 0 && el.clientWidth < NARROW;

// Phones: every chart passes through here, so text that fits on a desktop does not pile up on a 390 px screen.
// Overlapping axis labels are hidden, long category names are truncated, the plot area makes room for its labels,
// legends scroll, and heatmap cell numbers give way to the tap tooltip.
function compact(o: any, w: number) {
  const axis = (a: any, isY: boolean) => {
    const one = (x: any) => {
      if (!x) return x;
      const label = { ...(x.axisLabel || {}), hideOverlap: true, fontSize: Math.min(x.axisLabel?.fontSize ?? 11, 10) };
      if (x.type === "category") Object.assign(label, { width: Math.round(w * (isY ? 0.28 : 0.22)), overflow: "truncate" });
      return { ...x, axisLabel: label, ...(x.type === "value" && x.splitNumber === undefined ? { splitNumber: 4 } : {}), nameTextStyle: { ...(x.nameTextStyle || {}), fontSize: 10 } };
    };
    return Array.isArray(a) ? a.map(one) : one(a);
  };
  const top = (t: any) => (o.legend && typeof t === "number" ? Math.max(t, 48) : t); // keep the axis title clear of a top legend
  const grid = (g: any) => ({ ...g, top: top(g?.top), left: typeof g?.left === "number" ? Math.min(g.left, 10) : g?.left, right: typeof g?.right === "number" ? Math.min(g.right, 16) : g?.right, containLabel: true });
  const series = Array.isArray(o.series) ? o.series.map((s: any) => (s?.type === "heatmap" ? { ...s, label: { ...(s.label || {}), show: false } } : s)) : o.series;
  const legend = o.legend && !Array.isArray(o.legend) ? { type: "scroll", ...o.legend, textStyle: { fontSize: 10, ...(o.legend.textStyle || {}) } } : o.legend;
  return { ...o, xAxis: o.xAxis && axis(o.xAxis, false), yAxis: o.yAxis && axis(o.yAxis, true), grid: Array.isArray(o.grid) ? o.grid.map(grid) : grid(o.grid), series, legend };
}

function withDefaults(o: any, width = 0) {
  // Merge (not replace) the page's tooltip with the defaults: a chart that passed its own `tooltip: { trigger: "axis" }`
  // used to lose `confine`, so on phones a tapped tooltip opened half outside the screen.
  const tooltip = o.tooltip === undefined ? TOOLTIP : Array.isArray(o.tooltip) ? o.tooltip.map((x: any) => ({ ...TOOLTIP, ...x })) : { ...TOOLTIP, ...o.tooltip };
  const merged = {
    animation: !reduce(), animationDuration: 600, animationEasing: "cubicOut", animationDurationUpdate: 450,
    textStyle: { fontFamily: "Inter Variable, Noto Sans Bengali, system-ui, sans-serif" }, color: PALETTE,
    grid: { left: 44, right: 16, top: 28, bottom: 36, containLabel: false },
    ...o,
    tooltip,
  };
  return width > 0 && width < NARROW ? compact(merged, width) : merged;
}
export const axisStyle = { axisLine: { lineStyle: { color: "#cfd9e2" } }, axisLabel: { color: "#5b6b7b", fontSize: 11 }, splitLine: { lineStyle: { color: "#eef2f6" } }, nameTextStyle: { color: "#7a8a9a", fontSize: 11 } };
