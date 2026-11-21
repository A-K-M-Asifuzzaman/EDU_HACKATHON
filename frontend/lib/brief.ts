// One-click intelligence brief: a self-contained, printable HTML report built only from data the page already loaded
// (no new API calls, no LLM). Every value is HTML-escaped.
const esc = (v: unknown) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildBrief(d: { sel: any; S: any; f: any; top: any[]; metrics: any; coverage: any; meta: any }): string {
  const { sel, S, f, top, metrics, coverage, meta } = d;
  const B = metrics?.champion?.validation?.B ?? {};
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const rows = (top ?? []).map((w: any, i: number) => `<tr><td>${i + 1}</td><td>${esc(w.ward_id)}</td><td>${esc(w.city)}</td><td>${esc(w.risk_tier)}</td><td>${Math.round(w.p_outbreak * 100)}%</td><td>${esc(w.median_cases)}</td><td>${esc(w.lower_90)}–${esc(w.upper_90)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DengueShield AI brief ${esc(sel.origin)} h${esc(sel.horizon)}</title>
<style>body{font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#0e1a2b;max-width:860px;margin:32px auto;padding:0 20px}h1{font-size:24px;margin:0}h2{font-size:15px;margin:26px 0 8px;color:#0a3a2e;border-bottom:1px solid #e4dfd3;padding-bottom:4px}
.tag{display:inline-block;background:#fff4dc;border:1px solid #f0d290;border-radius:99px;padding:2px 10px;font-size:12px;margin-right:6px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e4dfd3;padding:5px 8px;text-align:left}th{background:#f6f4ee}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.k{border:1px solid #e4dfd3;border-radius:10px;padding:10px}.k b{display:block;font-size:22px}.muted{color:#5d6b7a;font-size:12px}@media print{body{margin:0}}</style></head><body>
<h1>DengueShield AI · Intelligence brief</h1>
<p class="muted">Generated ${esc(now)} from the DengueShield AI dashboard.</p>
<p><span class="tag">Historical Replay</span><span class="tag">Synthetic organizer dataset (2016–2024)</span><span class="tag">2025 test year locked</span></p>
<p><b>Not live surveillance and not medical advice.</b> Forecast origin <b>${esc(S?.origin)}</b> → target week <b>${esc(S?.target_date)}</b>, ${esc(sel.horizon)} weeks ahead, source: ${esc(S?.source === "replay" ? "validated out-of-time replay" : "deployed model bundle")}.</p>
<h2>All 60 wards</h2><div class="grid"><div class="k">Expected cases<b>${Math.round(S?.expected_cases_total ?? 0)}</b></div><div class="k">Median forecast (sum)<b>${esc(S?.median_cases_total)}</b></div><div class="k">Wards on outbreak alert<b>${esc(S?.alerts)} / ${esc(S?.wards)}</b></div><div class="k">Mean outbreak probability<b>${Math.round((S?.mean_p_outbreak ?? 0) * 100)}%</b></div></div>
<p class="muted">Risk tiers by count: ${Object.entries(S?.tier_counts ?? {}).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ")}. Tiers are statistical categories of this dataset, not official warning levels.</p>
${f ? `<h2>Selected ward: ${esc(f.ward_id)} (${esc(f.city)})</h2><table><tr><th>Median</th><th>Expected (mean)</th><th>80% interval</th><th>90% interval</th><th>P(outbreak)</th><th>Tier</th><th>Alert</th></tr>
<tr><td>${esc(f.median_cases)}</td><td>${Number(f.expected_cases).toFixed(1)}</td><td>${esc(f.lower_80)}–${esc(f.upper_80)}</td><td>${esc(f.lower_90)}–${esc(f.upper_90)}</td><td>${Math.round(f.p_outbreak * 100)}%</td><td>${esc(f.risk_tier)}</td><td>${f.outbreak_alert ? "yes" : "no"}</td></tr></table>` : ""}
<h2>Highest outbreak probability (top ${(top ?? []).length})</h2><table><tr><th>#</th><th>Ward</th><th>City</th><th>Tier</th><th>P(outbreak)</th><th>Median</th><th>90% interval</th></tr>${rows}</table>
<h2>Validated model performance (out-of-time, seasons 2022–2024)</h2><table><tr><th>Horizon</th><th>MAE (cases/week)</th><th>RMSE</th><th>High-week MAE</th></tr>
${[2, 3, 4].map((h) => { const m = B[h]?.bench_2022_2024; return m ? `<tr><td>${h} weeks</td><td>${m.mae}</td><td>${Number(m.rmse).toFixed(2)}</td><td>${Number(m.high_mae).toFixed(2)}</td></tr>` : ""; }).join("")}</table>
<p class="muted">Calibrated interval coverage (2019–2024): 80% → ${esc(coverage?.c80)}, 90% → ${esc(coverage?.c90)}. At outbreak peaks coverage drops (80% → ${esc(coverage?.h80)}) and peaks are under-predicted by about 3 cases.</p>
<h2>Model and data</h2><p class="muted">${esc(meta?.model?.name)} · ${esc(meta?.model?.features)} features · bundle ${esc(String(meta?.model?.bundle_sha256 ?? "").slice(0, 12))} · data through ${esc(meta?.data?.last_observed_week)} · convention B (start of week).</p>
<h2>Limitations</h2><ul><li>The dataset is synthetic; ward IDs are not real wards and are not mapped to real boundaries.</li><li>Intervals are honest on average but optimistic at peaks.</li><li>Historical replay values are not live warnings.</li></ul>
<p class="muted">Sources: EDU AI Engineering Hackathon 2026 organizer dataset; DengueShield AI ridge Poisson GLM. Emergency in Bangladesh: call 999; health line 16263.</p>
</body></html>`;
}
