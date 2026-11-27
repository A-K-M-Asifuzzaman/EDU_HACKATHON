"use client";
import { useEffect, useRef } from "react";

let loader: Promise<any> | null = null;
function loadEcharts() {
  if (!loader) loader = import("./echarts-setup").then((m) => m.default);
  return loader;
}

export const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];   // validated categorical order (dataviz reference palette)
const reduce = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// a chart is dim when the page is in Dim mode or when it sits inside a dark section (the Operations engine)
const isDim = (el?: Element | null) => typeof document !== "undefined" && (document.documentElement.dataset.theme === "dim" || !!el?.closest('[data-theme="dim"]'));
// Dim mode: chart options name light-theme ink and grid colours directly; swap each for its dim counterpart (series colours stay).
const DIM: Record<string, string> = { "#5b6b7b": "#a9b6c2", "#44566a": "#c3ced8", "#3f5064": "#c3ced8", "#0e1a2b": "#e7edf2", "#0d1b2a": "#e7edf2", "#0a0d14": "#e7edf2",
  "#7a8a9a": "#9eacb8", "#5f6f7f": "#9eacb8", "#2f2a8f": "#c9c6ff", "#eef2f6": "#2a3846", "#cfd9e2": "#3a4a5a", "#e4dfd3": "#33414f", "#e3e9ef": "#33414f",
  "#e4ebf0": "#33414f", "#f1f5f9": "#243241", "rgba(255,255,255,0.97)": "rgba(27,39,51,0.97)",
  // validated categorical slots: light -> dark-surface variants (same hue order)
  "#2a78d6": "#3987e5", "#eb6834": "#d95926", "#1baf7a": "#199e70", "#eda100": "#c98500", "#e87ba4": "#d55181", "#4a2bd0": "#b4a6ff" };
const dimify = (v: any): any => typeof v === "string" ? (DIM[v.toLowerCase()] ?? v) : Array.isArray(v) ? v.map(dimify)
  : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "function" ? x : dimify(x)])) : v;

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
      inst.current.setOption(withDefaults(opt.current, el.current.clientWidth, el.current), true);
      if (onClick) inst.current.on("click", onClick);
      ro = new ResizeObserver(() => {
        if (!inst.current || !el.current) return;
        if (isNarrow(el.current) !== narrow) { narrow = !narrow; inst.current.setOption(withDefaults(opt.current, el.current.clientWidth, el.current), true); } // phone rotated or panel resized
        inst.current.resize();
      });
      ro.observe(el.current);
    });
    return () => { dead = true; ro?.disconnect(); inst.current?.dispose(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { inst.current?.setOption(withDefaults(option, el.current?.clientWidth ?? 0, el.current), true); }, [option]);
  useEffect(() => {                                                    // colour mode switched: redraw with the matching ink and grid colours
    const on = () => inst.current?.setOption(withDefaults(opt.current, el.current?.clientWidth ?? 0, el.current), true);
    window.addEventListener("ds:theme", on); return () => window.removeEventListener("ds:theme", on);
  }, []);
  return <div ref={el} role="img" aria-label={ariaLabel} className={className} style={{ height, width: "100%" }} />;
}

const TOOLTIP = { trigger: "axis", confine: true, backgroundColor: "rgba(255,255,255,0.97)", borderColor: "#e3e9ef", textStyle: { color: "#0d1b2a", fontSize: 12 },
  extraCssText: "box-shadow:0 8px 24px -8px rgba(10,13,20,.25);border-radius:10px;max-width:min(320px,calc(100vw - 32px));white-space:normal;overflow-wrap:anywhere" };

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
  const nLegend = Array.isArray(o.series) ? o.series.filter((x: any) => x?.name && !/^p\d+$/.test(String(x.name))).length : 0;
  const rows = o.legend ? Math.max(1, Math.ceil((nLegend * 96) / Math.max(200, w - 24))) : 0;     // ≈96 px per legend item at 10 px text
  const top = (t: any) => (o.legend && typeof t === "number" ? Math.max(t, 30 + rows * 18) : t);  // legend rows + axis title clear of the plot
  const grid = (g: any) => ({ ...g, top: top(g?.top), left: typeof g?.left === "number" ? Math.min(g.left, 10) : g?.left, right: typeof g?.right === "number" ? Math.min(g.right, 16) : g?.right, containLabel: true });
  const series = Array.isArray(o.series) ? o.series.map((s: any) => (s?.type === "heatmap" ? { ...s, label: { ...(s.label || {}), show: false } } : s)) : o.series;
  // Wrap legends (type "plain") instead of paging them: a paged legend ("1/3") hid series on phones.
  const legend = o.legend && !Array.isArray(o.legend) ? { ...o.legend, type: "plain", itemGap: 8, itemWidth: 14, textStyle: { fontSize: 10, ...(o.legend.textStyle || {}) } } : o.legend;
  return { ...o, xAxis: o.xAxis && axis(o.xAxis, false), yAxis: o.yAxis && axis(o.yAxis, true), grid: Array.isArray(o.grid) ? o.grid.map(grid) : grid(o.grid), series, legend };
}

function withDefaults(o: any, width = 0, el?: Element | null) {
  // Merge (not replace) the page's tooltip with the defaults: a chart that passed its own `tooltip: { trigger: "axis" }`
  // used to lose `confine`, so on phones a tapped tooltip opened half outside the screen.
  const tooltip = o.tooltip === undefined ? TOOLTIP : Array.isArray(o.tooltip) ? o.tooltip.map((x: any) => ({ ...TOOLTIP, ...x })) : { ...TOOLTIP, ...o.tooltip };
  const merged = {
    animation: !reduce(), animationDuration: 600, animationEasing: "cubicOut", animationDurationUpdate: 450,
    textStyle: { fontFamily: "Atkinson Hyperlegible Next Variable, Noto Sans Bengali, system-ui, sans-serif" }, color: PALETTE,
    grid: { left: 44, right: 16, top: 28, bottom: 36, containLabel: false },
    ...o,
    tooltip,
  };
  const out = width > 0 && width < NARROW ? compact(merged, width) : merged;
  return isDim(el) ? { ...dimify(out), textStyle: { ...out.textStyle, color: "#c3ced8" }, legend: out.legend && !Array.isArray(out.legend) ? { ...dimify(out.legend), textStyle: { color: "#c3ced8", ...dimify(out.legend.textStyle || {}) } } : dimify(out.legend) } : out;
}
export const axisStyle = { axisLine: { lineStyle: { color: "#cfd9e2" } }, axisLabel: { color: "#5b6b7b", fontSize: 11 }, splitLine: { lineStyle: { color: "#eef2f6" } }, nameTextStyle: { color: "#7a8a9a", fontSize: 11 } };
