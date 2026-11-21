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
      inst.current.setOption(withDefaults(opt.current), true);
      if (onClick) inst.current.on("click", onClick);
      ro = new ResizeObserver(() => inst.current?.resize());
      ro.observe(el.current);
    });
    return () => { dead = true; ro?.disconnect(); inst.current?.dispose(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { inst.current?.setOption(withDefaults(option), true); }, [option]);
  return <div ref={el} role="img" aria-label={ariaLabel} className={className} style={{ height, width: "100%" }} />;
}

function withDefaults(o: any) {
  return {
    animation: !reduce(), animationDuration: 600, animationEasing: "cubicOut", animationDurationUpdate: 450,
    textStyle: { fontFamily: "Inter Variable, Noto Sans Bengali, system-ui, sans-serif" }, color: PALETTE,
    grid: { left: 44, right: 16, top: 28, bottom: 36, containLabel: false },
    tooltip: { trigger: "axis", confine: true, backgroundColor: "rgba(255,255,255,0.97)", borderColor: "#e3e9ef", textStyle: { color: "#0d1b2a", fontSize: 12 }, extraCssText: "box-shadow:0 8px 24px -8px rgba(7,59,43,.25);border-radius:10px" },
    ...o,
  };
}
export const axisStyle = { axisLine: { lineStyle: { color: "#cfd9e2" } }, axisLabel: { color: "#5b6b7b", fontSize: 11 }, splitLine: { lineStyle: { color: "#eef2f6" } }, nameTextStyle: { color: "#7a8a9a", fontSize: 11 } };
