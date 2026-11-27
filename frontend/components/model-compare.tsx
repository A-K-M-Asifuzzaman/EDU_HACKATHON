"use client";
// Model comparison explorer (Model Evidence). Read-only: every number comes from /api/model/comparison, which serves the file built by
// scripts/model_comparison/build_model_comparison.py from saved results (Stage 3 tournament cells, V3 classical benchmarks, baselines
// re-run on the same folds). Convention B only. Validation seasons only; the 2025 test year is sealed and never appears here.
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardTitle, DataTable, Loading, Notice, ProvChip, Segmented, useAsync } from "./ui";
import { Chart, axisStyle } from "./echart";

type Row = { model: string; variant_tag: string | null; feature_set: string; window: string; horizon: string; mae: number; rmse: number; r2: number | null; bias: number;
  peak_week_mae: number; peak_weeks_under_predicted: number; zero_week_mae: number; outbreak_recall: number; outbreak_precision: number | null; false_alert_rate: number;
  season_sd_mae: number; mae_diff_vs_champion: number; seasons_better_than_champion: string; model_size_bytes: number | null; fit_seconds: number; predict_ms_per_1k: number; limitations: string | null };

// one hue per model group, in the validated categorical order (blue, orange, aqua, yellow, magenta); identity is never colour alone
const GROUPS = ["Count GLMs", "Ensembles", "Boosted trees & hurdle", "Classical ML (new in V3)", "Baselines"] as const;
type Group = (typeof GROUPS)[number];
const GCOL: Record<Group, string> = { "Count GLMs": "#2a78d6", Ensembles: "#eb6834", "Boosted trees & hurdle": "#1baf7a", "Classical ML (new in V3)": "#eda100", Baselines: "#e87ba4" };
const groupOf = (family: string): Group => family === "Count GLM" ? "Count GLMs" : family === "Two-model ensemble" ? "Ensembles"
  : family === "Gradient-boosted trees" || family.startsWith("Two-part") ? "Boosted trees & hurdle" : family.endsWith("(V3)") ? "Classical ML (new in V3)" : "Baselines";
const NAMES: Record<string, string> = { glm_poisson: "Ridge Poisson GLM", glm_poisson_nbdisp: "Poisson GLM + NB dispersion", glm_spline: "Spline Poisson GLM", glm_nb: "Negative-binomial GLM",
  glm_tweedie: "Tweedie GLM", lgbm_poisson: "LightGBM (Poisson)", lgbm_tweedie: "LightGBM (Tweedie)", lgbm_l1: "LightGBM (L1)", xgb_poisson: "XGBoost (Poisson)", cat_poisson: "CatBoost (Poisson)",
  hurdle_lgbm: "Hurdle (LightGBM)", rf: "Random Forest", extra_trees: "Extra Trees", ridge_ls: "Linear regression (ridge)", knn: "k-nearest neighbours", mlp: "Neural network (MLP)",
  seasonal_avg: "Seasonal average", last_known: "Last week's cases", moving_avg_4: "4-week moving average", ward_mean: "Ward mean", global_mean: "Overall mean" };
const nameOf = (model: string, tag: string | null) => (NAMES[model] ?? model.replace("ens_glm+", "GLM + ").replace("_tuned", " (tuned)").replace("lgbm", "LightGBM").replace("xgb", "XGBoost").replace("cat", "CatBoost"))
  + (tag === "tuned" ? " (tuned)" : "");
const key = (r: Row) => `${r.model}|${r.variant_tag ?? ""}`;
const isChamp = (r: Row) => r.model === "glm_poisson" && r.feature_set === "F8" && !r.variant_tag;
const f = (v: number | null | undefined, d = 3) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));
const pct = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`);
const size = (b: number | null) => (b == null ? "–" : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);
const WINDOWS = [{ value: "2019-2024", label: "6 seasons (2019–24)" }, { value: "2022-2024", label: "Selection seasons (2022–24)" }];
const HZ = [{ value: "2-4 mean", label: "Average" }, { value: "2", label: "2 weeks" }, { value: "3", label: "3 weeks" }, { value: "4", label: "4 weeks" }];

export default function ModelCompare() {
  const q = useAsync((s) => api("/api/model/comparison", { signal: s, ttl: 3_600_000 }), []);
  const [win, setWin] = useState("2019-2024");
  const [hz, setHz] = useState("2-4 mean");
  return (<Loading q={q} h={420} kind="chart" label="Model comparison">{(d: any) => <Explorer d={d} win={win} setWin={setWin} hz={hz} setHz={setHz} />}</Loading>);
}

function Explorer({ d, win, setWin, hz, setHz }: { d: any; win: string; setWin: (v: string) => void; hz: string; setHz: (v: string) => void }) {
  const meta = (r: Row) => d.models[key(r)] ?? {};
  const grp = (r: Row): Group => groupOf(meta(r).family ?? "");
  const rows: Row[] = d.rows;
  // one row per model variant (best of the two feature sets, which the CSV keeps separately); the champion is always its F8 row
  const variants = useMemo(() => {
    const at = rows.filter((r) => r.window === win && r.horizon === hz);
    const best = new Map<string, Row>();
    for (const r of at) {
      const k = key(r);
      if (r.model === "glm_poisson" && !r.variant_tag) { if (isChamp(r)) best.set(k, r); continue; }
      const cur = best.get(k);
      if (!cur || r.mae < cur.mae) best.set(k, r);
    }
    return [...best.values()].sort((a, b) => a.mae - b.mae);
  }, [rows, win, hz]);
  const champ = variants.find(isChamp)!;
  const shown = variants.filter((r) => !["last_known", "moving_avg_4", "ward_mean", "global_mean"].includes(r.model));
  // representative per group for the horizon, season and alert views: champion + best of every other group
  const keyModels = useMemo(() => {
    const out: Row[] = [champ];
    for (const g of GROUPS.slice(1)) { const r = variants.find((x) => grp(x) === g); if (r) out.push(r); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, champ]);
  const label = (r: Row) => `${isChamp(r) ? "★ " : ""}${nameOf(r.model, r.variant_tag)}${r.feature_set && r.feature_set !== "none" ? ` · ${r.feature_set}` : ""}`
    + `${meta(r).point_forecast === "point forecast" ? " †" : ""}${(meta(r).status ?? "").startsWith("disqualified") ? " (disqualified)" : ""}`;

  const lo = Math.floor(Math.min(...shown.map((r) => r.mae)) * 10) / 10 - 0.05, hi = Math.ceil(Math.max(...shown.map((r) => r.mae)) * 10) / 10 + 0.05;
  const names = shown.map(label).reverse();
  const dotOpt = {
    grid: { left: 210, right: 24, top: 40, bottom: 40 }, legend: { top: 0, left: 0, textStyle: { fontSize: 11 } },
    tooltip: { trigger: "item", formatter: (p: any) => { const r: Row = p.data.row; const m = meta(r); return `<b>${label(r)}</b><br/>${m.family} · ${m.variant}<br/>MAE ${f(r.mae)} (Δ ${r.mae_diff_vs_champion >= 0 ? "+" : ""}${f(r.mae_diff_vs_champion)} vs champion, better in ${r.seasons_better_than_champion} seasons)<br/>${m.status}`; } },
    xAxis: { type: "value", min: lo, max: hi, name: "Typical error (MAE, cases per ward-week) — lower is better", nameLocation: "middle", nameGap: 26, ...axisStyle },
    yAxis: { type: "category", data: names, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, fontSize: 11 } },
    series: GROUPS.map((g) => ({ name: g, type: "scatter", symbolSize: 11, itemStyle: { color: GCOL[g], borderColor: "#fff", borderWidth: 1.5 },
      data: shown.filter((r) => grp(r) === g).map((r) => ({ value: [r.mae, label(r)], row: r, symbolSize: isChamp(r) ? 18 : 11 })),
      ...(g === "Count GLMs" ? { markLine: { symbol: "none", silent: true, lineStyle: { color: "#3f5064", type: "dashed" }, label: { formatter: "champion", fontSize: 10, color: "#3f5064" }, data: [{ xAxis: champ.mae }] },
        markArea: { silent: true, itemStyle: { color: "rgba(42,120,214,0.08)" }, data: [[{ xAxis: champ.mae - 0.05 }, { xAxis: champ.mae + 0.05 }]] } } : {}) })),
  };

  const groupTable = GROUPS.map((g) => {
    const inG = variants.filter((r) => grp(r) === g);
    const b = inG.find((r) => !(meta(r).status ?? "").startsWith("disqualified")) ?? inG[0];
    return b && { group: g, best: label(b), n: new Set(inG.map(key)).size, mae: b.mae, delta: b.mae_diff_vs_champion, peak: b.peak_week_mae, recall: b.outbreak_recall, fit: b.fit_seconds, size: b.model_size_bytes };
  }).filter(Boolean) as any[];

  const hRows = (k: Row) => ["2", "3", "4"].map((h) => rows.find((r) => r.window === win && r.horizon === h && key(r) === key(k) && r.feature_set === k.feature_set));
  const [metric, setMetric] = useState<"mae" | "rmse">("mae");
  const horizonOpt = { grid: { left: 48, right: 16, top: 78, bottom: 30 }, legend: { top: 0, left: 0, textStyle: { fontSize: 11 } }, tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: ["2 weeks", "3 weeks", "4 weeks"], ...axisStyle }, yAxis: { type: "value", name: metric === "mae" ? "MAE (cases)" : "RMSE (cases)", ...axisStyle },
    series: keyModels.map((k) => ({ name: label(k), type: "bar", barGap: "8%", itemStyle: { color: GCOL[grp(k)], borderRadius: [3, 3, 0, 0] },
      data: hRows(k).map((r) => (r ? +r[metric].toFixed(3) : null)) })) };

  const years = [2019, 2020, 2021, 2022, 2023, 2024].filter((y) => win === "2019-2024" || y >= 2022);
  const seasonOpt = { grid: { left: 48, right: 16, top: 78, bottom: 30 }, legend: { top: 0, left: 0, textStyle: { fontSize: 11 } }, tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: years.map(String), ...axisStyle }, yAxis: { type: "value", name: "MAE (cases)", scale: true, ...axisStyle },
    series: keyModels.map((k) => ({ name: label(k), type: "line", symbolSize: isChamp(k) ? 9 : 6, lineStyle: { width: isChamp(k) ? 3 : 2, color: GCOL[grp(k)] }, itemStyle: { color: GCOL[grp(k)] },
      data: years.map((y) => { const c = d.by_season.filter((s: any) => s.model === k.model && (s.tag ?? "") === (k.variant_tag ?? "") && (s.fs === k.feature_set || (s.fs === "none" && k.feature_set === "none")) && s.year === y && (hz === "2-4 mean" || String(s.horizon) === hz));
        return c.length ? +(c.reduce((a: number, s: any) => a + s.mae, 0) / c.length).toFixed(3) : null; }) })) };

  return (<div className="grid gap-5">
    <Card>
      <CardTitle title="How do the models compare?" sub={`${d.counts.stage3_base_model_variants + d.counts.stage3_tuned_variants + d.counts.stage3_ensembles + d.counts.v3_new_model_variants} model variants and ${d.counts.v3_baselines_rerun} baselines, each trained only on seasons before the one it forecasts and scored on the same ward-weeks with the same code.`}
        right={<a href="/api/model/comparison.csv" download className="inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-semibold text-forest hover:bg-mint-l sm:min-h-9">Download comparison CSV</a>} />
      <p className="text-[13.5px] leading-relaxed text-ink-2"><b>How to read this:</b> each dot is one model. Further left means a smaller typical error, in cases per ward per week. The shaded band marks the selection rule's tolerance of 0.05 MAE around the deployed champion (★): the rule treated models inside it as equivalent. It is a pre-set decision threshold, not a confidence interval. Models marked † were run here as point forecasts (one number, no uncertainty method built for them), so as run they cannot drive the app's intervals or outbreak probability. MAE is the mean of the season values; pooled values are in the CSV.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3"><Segmented label="Seasons" value={win} onChange={setWin} options={WINDOWS} /><Segmented label="Forecast horizon" value={hz} onChange={setHz} options={HZ} /></div>
      <div className="mt-2 flex flex-wrap gap-1.5"><ProvChip tone="warn">{win === "2022-2024" ? "Development validation used in model selection: not a blind test" : "Development validation: not a blind test"}</ProvChip><ProvChip tone="neutral">Convention B (production)</ProvChip><ProvChip tone="neutral">2025 sealed</ProvChip></div>
      <div className="mt-3"><Chart option={dotOpt} height={Math.max(360, shown.length * 21 + 90)} ariaLabel={`Mean absolute error of ${shown.length} models for ${win}, ${hz === "2-4 mean" ? "average of 2 to 4 weeks" : hz + " weeks"}: champion ${f(champ.mae)}; best ${label(variants[0])} ${f(variants[0].mae)}`} /></div>
      <p className="mt-1 text-[11.5px] text-ink-3">Best of the two feature sets per model (the CSV has both); the champion is shown on its deployed 24-feature set. Persistence and mean baselines (MAE {f(variants.find((r) => r.model === "last_known")?.mae, 2)}–{f(variants.find((r) => r.model === "global_mean")?.mae, 2)}) are off this scale and listed below.</p>
    </Card>

    <Card>
      <CardTitle title="Model families at a glance" sub="Best variant of each group for the selected seasons and horizon, with its cost" />
      <DataTable dense rows={groupTable} cols={[
        { key: "group", label: "Group", render: (r: any) => <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: GCOL[r.group as Group] }} />{r.group}</span> },
        { key: "best", label: "Best variant" }, { key: "n", label: "Variants", align: "right" },
        { key: "mae", label: "MAE", align: "right", render: (r: any) => f(r.mae) }, { key: "delta", label: "Δ vs champion", align: "right", render: (r: any) => `${r.delta >= 0 ? "+" : ""}${f(r.delta)}` },
        { key: "peak", label: "Peak-week MAE", align: "right", render: (r: any) => f(r.peak, 2) }, { key: "recall", label: "Outbreak recall", align: "right", render: (r: any) => pct(r.recall) },
        { key: "fit", label: "Fit time / season", align: "right", render: (r: any) => (r.fit == null ? "–" : `${r.fit.toFixed(2)} s`) }, { key: "size", label: "Model size", align: "right", render: (r: any) => size(r.size) }]} />
      <p className="mt-2 text-[11.5px] text-ink-3">Sizes: one fitted model per family (season 2024, 3 weeks ahead). Fit times on the development laptop. The deployed champion bundle covers all three horizons.</p>
    </Card>

    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardTitle title="Error by forecast horizon" sub="Champion and the best of every other group" right={<Segmented value={metric} onChange={(v) => setMetric(v as any)} options={[{ value: "mae", label: "MAE" }, { value: "rmse", label: "RMSE" }]} />} />
        <Chart option={horizonOpt} height={300} ariaLabel={`${metric.toUpperCase()} by horizon for ${keyModels.map(label).join(", ")}`} />
        <p className="mt-1 text-[11.5px] text-ink-3">Errors grow with the horizon for every model: rain beyond the forecast date is not yet observed.</p></Card>
      <Card><CardTitle title="Season by season" sub={`MAE per season, ${hz === "2-4 mean" ? "average of 2–4 weeks" : hz + " weeks"}`} />
        <Chart option={seasonOpt} height={300} ariaLabel={`MAE per season ${years.join(", ")} for ${keyModels.map(label).join(", ")}`} />
        <p className="mt-1 text-[11.5px] text-ink-3">Big outbreak seasons are hard for every model: the gaps between models are small next to the swings between seasons.</p></Card>
    </div>

    <Card>
      <CardTitle title="Outbreak alerts and peak weeks" sub="Alert = forecast at or above the ward's outbreak threshold (training 90th percentile). Peak weeks = actual cases at or above it." />
      <DataTable dense rows={keyModels} cols={[
        { key: "model", label: "Model", render: (r: Row) => <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: GCOL[grp(r)] }} />{label(r)}</span> },
        { key: "peak_week_mae", label: "Peak-week MAE", align: "right", render: (r: Row) => f(r.peak_week_mae, 2) },
        { key: "peak_weeks_under_predicted", label: "Peaks under-predicted", align: "right", render: (r: Row) => pct(r.peak_weeks_under_predicted) },
        { key: "zero_week_mae", label: "Zero-week MAE", align: "right", render: (r: Row) => f(r.zero_week_mae, 2) },
        { key: "outbreak_recall", label: "Recall", align: "right", render: (r: Row) => pct(r.outbreak_recall) },
        { key: "outbreak_precision", label: "Precision", align: "right", render: (r: Row) => pct(r.outbreak_precision) },
        { key: "false_alert_rate", label: "False alerts", align: "right", render: (r: Row) => `${(r.false_alert_rate * 100).toFixed(1)}%` },
        { key: "r2", label: "R²", align: "right", render: (r: Row) => f(r.r2, 2) }]} />
      <p className="mt-2 text-[11.5px] text-ink-3">Among the new models, Random Forest and Extra Trees (see the CSV) forecast higher values than the champion: on average over horizons they have slightly lower peak-week error but more false alerts and more error on the many zero-case weeks. R² is missing for ensembles (their predictions were never saved); every other R² is tied to its exact saved prediction file. † run as a point forecast in this benchmark.</p>
    </Card>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="border-emerald/30">
        <CardTitle title="Why the ridge Poisson GLM is deployed" />
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
          <li>The rule was written <b>before</b> tuned and ensemble results were seen: candidates must give a full predictive distribution (for intervals and outbreak probability) and fit without failures.</li>
          <li>Shortlist every candidate within 0.05 MAE of the best on 2022–2024 that also holds on 2019–2024; pick the simplest.</li>
          <li>The ridge Poisson GLM (24 features) is within the band on both windows ({f(champ.mae)} MAE here), varies least between seasons among the GLMs, has the best peak-week error among them, explains every forecast additively and fits in milliseconds.</li>
          <li>Tuned boosters beat it on their tuning seasons but not afterwards; no ensemble cleared the 0.05 margin; the new classical models trail it.</li>
        </ol>
      </Card>
      <Card>
        <CardTitle title="Not part of this leaderboard" sub="Kept separate so different experiments are never mixed" />
        <ul className="space-y-1.5 text-[13px] text-ink-2">
          <li><b>{d.counts.hyperparameter_trials} hyperparameter trials</b> (Optuna, {Object.entries(d.counts.hyperparameter_trials_by_model).map(([m, n]) => `${n} for ${NAMES[m] ?? m}`).join(", ")}): settings of three models, not models.</li>
          <li><b>{d.feature_configs.runs} feature-configuration runs</b> ({d.feature_configs.configurations} feature sets × GLM and LightGBM, convention A): they chose the features. Best: {d.feature_configs.best.config} ({f(d.feature_configs.best.mae_avg)} MAE, convention A).</li>
          <li><b>Conventions A and C</b> score every model differently and stay in the CSV only.</li>
          <li><b>SARIMA was not run</b>: a fair per-ward seasonal model for 60 wards and six seasons was not feasible; seasonal-average and persistence baselines fill that role.</li>
          {Object.entries(d.diagnostics).map(([m, t]) => <li key={m}><b>{NAMES[m] ?? m}:</b> {String(t)}.</li>)}
        </ul>
      </Card>
    </div>
    <Notice>Full report: <code>reports/MODEL_COMPARISON.md</code>; table: <code>reports/MODEL_COMPARISON.csv</code> ({d.counts.comparison_rows} rows, every convention, window and horizon). Generated by <code>{d.generated_by}</code> from saved results; nothing is estimated or filled in.</Notice>
  </div>);
}
