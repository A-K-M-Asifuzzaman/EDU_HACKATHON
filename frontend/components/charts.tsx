"use client";
import { useMemo } from "react";
import { TIER_COLOR, TIERS, type Tier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Chart, axisStyle } from "./echart";

/** Forecast fan: nested 80/90% intervals, median, mean and observed cases for a replay series; a vertical marker shows the selected target week. */
export function FanChart({ series, markDate, height = 320, title }: { series: any[]; markDate?: string; height?: number; title?: string }) {
  const { t } = useI18n();
  const option = useMemo(() => {
    const x = series.map((r) => r.target_date);
    const band = (lo: string, hi: string, color: string, name: string) => [
      { name: name + " lo", type: "line", data: series.map((r) => r[lo]), stack: name, symbol: "none", lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name, type: "line", data: series.map((r) => r[hi] - r[lo]), stack: name, symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color }, areaStyle: { color, opacity: 0.6 }, silent: true, tooltip: { show: false } }];
    return {
      // one scrollable legend row above the plot: the wrapping legend used to sit on top of the "cases/week" axis name on phones
      grid: { left: 44, right: 18, top: 52, bottom: 62 },
      legend: { type: "scroll", top: 0, left: 0, right: 0, itemWidth: 14, pageIconSize: 10, selectedMode: false, textStyle: { fontSize: 11, color: "#44566a" }, data: [t("fc.median"), t("fc.mean"), t("fc.interval80"), t("fc.interval90"), t("fc.actual")] },
      tooltip: { trigger: "axis", formatter: (ps: any[]) => { const r = series[ps[0].dataIndex]; return `<b>${r.target_date}</b><br/>${t("fc.median")}: <b>${r.median}</b> · ${t("fc.mean")}: ${r.mean.toFixed(1)}<br/>80%: ${r.lo80}–${r.hi80} · 90%: ${r.lo90}–${r.hi90}<br/>${t("fc.prob")}: ${(r.p_outbreak * 100).toFixed(0)}% (${r.tier})<br/>${r.y_true === null ? "" : `${t("fc.actual")}: <b>${r.y_true}</b>`}`; } },
      xAxis: { type: "category", data: x, boundaryGap: false, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v: string) => v.slice(5), hideOverlap: true } },
      yAxis: { type: "value", name: t("fc.cases"), ...axisStyle, nameGap: 12, nameTextStyle: { ...axisStyle.nameTextStyle, align: "left" }, min: 0 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8, borderColor: "transparent", fillerColor: "rgba(75,69,209,.15)" }],
      series: [
        ...band("lo90", "hi90", "#dcdafc", t("fc.interval90")), ...band("lo80", "hi80", "#a9a5f2", t("fc.interval80")),
        { name: t("fc.median"), type: "line", step: "middle", data: series.map((r) => r.median), symbol: "none", lineStyle: { width: 2.4, color: "#2f2e72" }, itemStyle: { color: "#2f2e72" }, z: 5,
          markLine: markDate ? { symbol: "none", lineStyle: { color: "#ea575b", type: "dashed" }, label: { formatter: "▼", color: "#ea575b", position: "start" }, data: [{ xAxis: markDate }] } : undefined },
        { name: t("fc.mean"), type: "line", data: series.map((r) => +r.mean.toFixed(2)), symbol: "none", lineStyle: { width: 1.4, type: "dashed", color: "#3b82c4" }, itemStyle: { color: "#3b82c4" }, z: 4 },
        { name: t("fc.actual"), type: "scatter", data: series.map((r) => r.y_true), symbolSize: 6, itemStyle: { color: "#ea575b", borderColor: "#fff", borderWidth: 1 }, z: 6 }],
    };
  }, [series, markDate, t]);
  return <Chart option={option} height={height} ariaLabel={title ?? "Forecast with prediction intervals and observed cases"} />;
}

export function TierBar({ counts, height = 200 }: { counts: Record<string, number>; height?: number }) {
  const { t } = useI18n();
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const option = useMemo(() => ({
    grid: { left: 80, right: 40, top: 8, bottom: 8 }, tooltip: { trigger: "item", formatter: (p: any) => `${p.name}: ${p.value} (${((p.value / total) * 100).toFixed(0)}%)` },
    xAxis: { type: "value", show: false, max: Math.max(...Object.values(counts), 1) * 1.15 }, yAxis: { type: "category", data: TIERS.map((x) => t(`risk.${x.toLowerCase()}`)), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#0d1b2a", fontSize: 12 } },
    series: [{ type: "bar", barWidth: 22, data: TIERS.map((x) => ({ value: counts[x] ?? 0, name: t(`risk.${x.toLowerCase()}`), itemStyle: { color: TIER_COLOR[x], borderRadius: [0, 8, 8, 0] } })), label: { show: true, position: "right", color: "#0d1b2a", fontWeight: 600 } }],
  }), [counts, t, total]);
  return <Chart option={option} height={height} ariaLabel="Number of wards per risk tier" />;
}

export function Gauge({ value, tier, height = 170 }: { value: number; tier: Tier; height?: number }) {
  const option = useMemo(() => ({
    series: [{ type: "gauge", startAngle: 200, endAngle: -20, min: 0, max: 100, radius: "96%", center: ["50%", "68%"], progress: { show: true, width: 14, itemStyle: { color: TIER_COLOR[tier] } },
      axisLine: { lineStyle: { width: 14, color: [[1, "#e8eef3"]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      detail: { valueAnimation: true, formatter: "{value}%", fontSize: 28, fontWeight: 700, color: "#2f2e72", offsetCenter: [0, "-4%"] }, data: [{ value: Math.round(value * 100) }] }],
  }), [value, tier]);
  return <Chart option={option} height={height} ariaLabel={`Outbreak probability ${Math.round(value * 100)} percent`} />;
}

export function DriverBars({ contrib, height = 170 }: { contrib: Record<string, number>; height?: number }) {
  const { t } = useI18n();
  const rows = Object.entries(contrib).filter(([k]) => k !== "baseline_log_rate");
  const option = useMemo(() => ({
    grid: { left: 170, right: 40, top: 6, bottom: 22 }, tooltip: { trigger: "item", formatter: (p: any) => `${p.name}: ${p.value >= 0 ? "+" : ""}${p.value.toFixed(2)} (log-rate)` },
    xAxis: { type: "value", ...axisStyle }, yAxis: { type: "category", data: rows.map(([k]) => t("drv." + k)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#0d1b2a", fontSize: 12, width: 160, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 18, data: rows.map(([, v]) => ({ value: +v.toFixed(3), itemStyle: { color: v >= 0 ? "#3b3a8c" : "#3b82c4", borderRadius: 6 } })), label: { show: true, position: "right", formatter: (p: any) => (p.value >= 0 ? "+" : "") + p.value.toFixed(2), color: "#44566a", fontSize: 11 } }],
  }), [rows, t]);
  return <Chart option={option} height={height} ariaLabel="Driver contributions to the log case rate" />;
}
