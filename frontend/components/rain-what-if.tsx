"use client";
// Rainfall what-if (V3). Layout adapted from the 2026-11-24 uncommitted prototype (author not recorded; see EDU_HACKATHON_V3_prep/preserved/),
// extended with two scenario modes, the list of model inputs that actually changed, and training-clip warnings.
import { useState } from "react";
import { addWeeks, api, qs, type Forecast } from "@/lib/api";
import { useSel } from "@/lib/ctx";
import { dateFmt, num, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Btn, Card, CardTitle, Loading, Notice, RiskBadge, Segmented, useAsync } from "./ui";

type Res = { mode: string; change_pct: number; weeks_changed: string[]; baseline: Forecast; scenario: Forecast; note: string;
  changed_inputs: { feature: string; baseline: number; scenario: number; clipped_by_model: boolean }[]; any_clipped: boolean; no_effect: boolean };

export default function RainfallWhatIf() {
  const { sel, ready } = useSel();
  const { lang } = useI18n();
  const [mode, setMode] = useState<"upcoming" | "observed">("upcoming");
  const [draft, setDraft] = useState(20);
  const [applied, setApplied] = useState<{ pct: number; mode: string } | null>(null);
  const res = useAsync((signal) => ready && applied ? api<Res>("/api/forecast/rainfall-what-if?" + qs({ ward_id: sel.ward, origin: sel.origin, horizon: sel.horizon, change_pct: applied.pct, mode: applied.mode }), { signal }) : Promise.resolve(null),
    [applied, ready, sel.ward, sel.origin, sel.horizon]);
  return (<Card className="mt-5 scroll-mt-20" id="rain-what-if" aria-labelledby="whatif-title">
    <CardTitle title="Rainfall what-if (hypothetical)" sub="Re-runs the saved model with changed rainfall inputs for this ward, week and horizon. Case counts are never edited directly." />
    <div className="flex flex-wrap items-end gap-4">
      <Segmented label="Which rainfall changes" value={mode} onChange={(v) => setMode(v as any)} options={[{ value: "upcoming", label: "Coming weeks vs typical" }, { value: "observed", label: "Last 2 observed weeks" }]} />
      <label className="flex min-w-0 flex-1 basis-52 flex-col gap-1"><span className="flex justify-between text-sm font-medium">Change <b className="num">{draft > 0 ? "+" : ""}{draft}%</b></span>
        <input type="range" min={-30} max={30} step={5} value={draft} onChange={(e) => setDraft(Number(e.target.value))} className="h-10 w-full accent-emerald" aria-label="Rainfall change in percent" /></label>
      <Btn disabled={!ready} onClick={() => setApplied({ pct: draft, mode })}>Run scenario</Btn>
    </div>
    <p className="mt-2 text-[12px] text-ink-3">{mode === "upcoming" ? "Scales the climatology projection used for rainfall weeks not yet observed at the forecast date: the forward-looking question, and the one that matters at 3–4 weeks." : "Scales the two latest observed weeks, the only observed weeks the model reads. At a 4-week horizon this barely changes anything, by design."}</p>
    {applied && <Loading q={res} kind="block" label="Rain scenario">{(d: Res | null) => d && (<div aria-live="polite" className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">{([["Baseline (deployed model)", d.baseline], [`Scenario: ${d.change_pct > 0 ? "+" : ""}${d.change_pct}% rain (${d.mode === "upcoming" ? "coming weeks" : "observed weeks"})`, d.scenario]] as const).map(([label, f]) => (
        <section key={label} className="rounded-xl border border-line p-3"><h3 className="text-sm font-semibold">{label}</h3>
          <div className="mt-2 grid gap-1 text-sm"><div>Median <b className="num">{f.median_cases}</b> · mean <b className="num">{num(f.expected_cases, lang, 1)}</b></div>
            <div>80% interval <b className="num">{f.lower_80}–{f.upper_80}</b> · 90% <b className="num">{f.lower_90}–{f.upper_90}</b></div>
            <div>P(outbreak) <b className="num">{pct(f.p_outbreak, lang)}</b></div>
            <div className="flex items-center gap-2"><RiskBadge tier={f.risk_tier} />{f.outbreak_alert ? "Alert" : "No alert"}</div></div></section>))}</div>
      {!d.no_effect && <p className="rounded-xl bg-mint-l/60 px-3 py-2 text-[13px]" data-testid="whatif-delta"><b>Model-implied difference:</b> median {d.scenario.median_cases - d.baseline.median_cases >= 0 ? "+" : ""}{d.scenario.median_cases - d.baseline.median_cases} cases ({d.baseline.median_cases} → {d.scenario.median_cases}), outbreak probability {d.scenario.p_outbreak - d.baseline.p_outbreak >= 0 ? "+" : ""}{Math.round((d.scenario.p_outbreak - d.baseline.p_outbreak) * 100)} points. A model response, not a measured or causal effect.</p>}
      <p className="text-[12px] text-ink-2">Weeks changed: {d.weeks_changed.map((w) => dateFmt(w, lang)).join(", ")}. {d.no_effect ? `No model input changed: none of the edited weeks is a rainfall week the model reads at this horizon (the weeks 2–4 before the target, here ${dateFmt(addWeeks(d.baseline.target_date, -4), lang)}–${dateFmt(addWeeks(d.baseline.target_date, -2), lang)}, and the latest observed weeks).` : `Model inputs changed: ${d.changed_inputs.map((x) => `${x.feature} ${num(x.baseline, lang, 2)} → ${num(x.scenario, lang, 2)}${x.clipped_by_model ? " (capped at the training range)" : ""}`).join("; ")}.`}</p>
      {d.any_clipped && <Notice tone="warn">Part of this change lies beyond the range the model was trained on, so its response is capped there. Read the scenario as a lower bound of the model response, not as a measured effect.</Notice>}
      <Notice>{d.note}</Notice></div>)}</Loading>}
  </Card>);
}
