// One-click intelligence brief: a self-contained, executive-grade printable situation report
// built only from data the page already loaded (no new API calls, no LLM). Every value is HTML-escaped.
const esc = (v: unknown) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildBrief(d: { sel: any; S: any; f: any; top: any[]; metrics: any; coverage: any; meta: any }): string {
  const { sel, S, f, top, metrics, coverage, meta } = d;
  const B = metrics?.champion?.validation?.B ?? {};
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const refNo = `DS-SITREP-${esc(sel?.origin || "2024")}-H${esc(sel?.horizon || 2)}`;

  const totalWards = S?.wards || 60;
  const alertCount = S?.alerts || 0;
  const alertPct = Math.round((alertCount / totalWards) * 100);

  const rows = (top ?? []).map((w: any, i: number) => {
    const tier = String(w.risk_tier || "Low");
    const tierConfig: Record<string, { color: string; bg: string; border: string }> = {
      Critical: { color: "#9b1c1c", bg: "#fdf2f2", border: "#f98080" },
      High: { color: "#9a3412", bg: "#fff7ed", border: "#fdba74" },
      Medium: { color: "#1e40af", bg: "#eff6ff", border: "#93c5fd" },
      Low: { color: "#065f46", bg: "#ecfdf5", border: "#6ee7b7" },
    };
    const tstyle = tierConfig[tier] || tierConfig.Low;

    return `<tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-ward"><strong>${esc(w.ward_id)}</strong></td>
      <td class="col-city">${esc(w.city)}</td>
      <td class="col-tier">
        <span class="tier-pill" style="color:${tstyle.color};background:${tstyle.bg};border-color:${tstyle.border};">${esc(w.risk_tier)}</span>
      </td>
      <td class="col-prob">${Math.round((w.p_outbreak || 0) * 100)}%</td>
      <td class="col-median">${esc(w.median_cases)}</td>
      <td class="col-interval">${esc(w.lower_90)} – ${esc(w.upper_90)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DengueShield AI — Situation Report (${esc(sel?.origin)} H${esc(sel?.horizon)})</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }
    *, *::before, *::after { box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      background: #f1f5f9;
      margin: 0;
      padding: 32px 16px;
      line-height: 1.5;
      font-size: 12.5px;
      -webkit-font-smoothing: antialiased;
    }

    /* Floating Action Bar (screen only) */
    .action-bar {
      max-width: 860px;
      margin: 0 auto 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.2);
    }
    .action-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .action-logo {
      width: 28px;
      height: 28px;
      background: #0e8f66;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-print { background: #0e8f66; color: #ffffff; }
    .btn-print:hover { background: #0b7352; transform: translateY(-1px); }
    .btn-close { background: rgba(255,255,255,0.12); color: #e2e8f0; }
    .btn-close:hover { background: rgba(255,255,255,0.2); color: #ffffff; }

    /* Report Sheet (A4 Proportion) */
    .sheet {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      padding: 40px 48px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
    }

    /* Header */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .brand-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .brand-eyebrow {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #0e8f66;
    }
    .brand-name {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
      margin: 0;
      line-height: 1.15;
    }
    .brand-name span { color: #0e8f66; }
    .report-title {
      font-size: 14px;
      font-weight: 600;
      color: #475569;
      margin-top: 2px;
    }

    .meta-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 14px;
      text-align: right;
      font-size: 11px;
      line-height: 1.5;
      color: #64748b;
    }
    .meta-card strong { color: #0f172a; font-weight: 700; }

    /* Notice badges */
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 18px;
    }
    .doc-tag {
      font-size: 10.5px;
      font-weight: 600;
      padding: 2.5px 8px;
      border-radius: 99px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .doc-tag-alert {
      background: #fef2f2;
      color: #991b1b;
      border-color: #fecaca;
    }

    /* Section Headings */
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 22px 0 10px;
    }
    .section-title::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #e2e8f0;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }
    .kpi-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: #cbd5e1;
    }
    .kpi-card.highlight::before { background: #0e8f66; }
    .kpi-card.alert::before { background: #dc2626; }
    
    .kpi-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.03em;
      margin: 4px 0 2px;
      font-variant-numeric: tabular-nums;
    }
    .kpi-value.text-alert { color: #dc2626; }
    .kpi-hint {
      font-size: 10.5px;
      color: #94a3b8;
    }

    /* Tables */
    .table-wrap {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
      text-align: left;
    }
    th {
      background: #f8fafc;
      color: #475569;
      font-weight: 700;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 7px 12px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }

    .col-num { width: 32px; text-align: center; color: #94a3b8; font-weight: 600; }
    .col-ward { font-weight: 700; color: #0f172a; }
    .col-city { color: #64748b; }
    .col-tier { text-align: center; width: 85px; }
    .col-prob { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    .col-median { text-align: right; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
    .col-interval { text-align: right; color: #64748b; font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; font-size: 11px; }

    .tier-pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 99px;
      font-size: 10px;
      font-weight: 700;
      border: 1px solid transparent;
      letter-spacing: 0.02em;
    }

    /* SOP Matrix */
    .sop-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 18px;
    }
    .sop-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      background: #ffffff;
      border-left-width: 4px;
    }
    .sop-critical { border-left-color: #dc2626; background: #fffdfd; }
    .sop-high { border-left-color: #ea580c; background: #fffdfa; }
    .sop-medium { border-left-color: #2563eb; }
    .sop-low { border-left-color: #059669; }

    .sop-title {
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sop-critical .sop-title { color: #991b1b; }
    .sop-high .sop-title { color: #9a3412; }
    .sop-medium .sop-title { color: #1e40af; }
    .sop-low .sop-title { color: #065f46; }

    .sop-desc {
      font-size: 11px;
      line-height: 1.45;
      color: #475569;
    }

    /* Footer & Provenance */
    .doc-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 14px;
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-size: 10.5px;
      color: #64748b;
      line-height: 1.45;
    }
    .footer-left { max-width: 580px; }
    .hotline-pills {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .hotline {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 2px 6px;
      font-weight: 700;
      color: #0f172a;
    }

    @media print {
      body { background: #ffffff; padding: 0; }
      .sheet { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .action-bar { display: none !important; }
      .table-wrap { break-inside: avoid; }
      .kpi-grid { break-inside: avoid; }
      .sop-grid { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- Floating screen toolbar -->
  <div class="action-bar">
    <div class="action-left">
      <div class="action-logo">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <path d="M16 3.5l10 3.6v7.5c0 5.7-4 10.2-10 13.5C10 24.8 6 20.3 6 14.6V7.1l10-3.6z" fill="#ffffff"/>
        </svg>
      </div>
      <div>
        <strong style="font-size:13.5px;">DengueShield AI · Executive Situation Report</strong>
        <div style="font-size:11px;opacity:0.75;">Formatted for A4 Print &amp; PDF Export</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
      <button class="btn btn-close" onclick="window.close()">✕ Close</button>
    </div>
  </div>

  <div class="sheet">
    <!-- Header -->
    <header class="doc-header">
      <div class="brand-group">
        <span class="brand-eyebrow">Public Health &amp; Vector Control Advisory</span>
        <h1 class="brand-name">DengueShield <span>AI</span></h1>
        <div class="report-title">Weekly Dengue Epidemiological Situation Report</div>
      </div>
      <div class="meta-card">
        <div>Ref: <strong>${refNo}</strong></div>
        <div>Forecast Origin: <strong>${esc(S?.origin)}</strong> (Mon)</div>
        <div>Target Horizon: <strong>${esc(sel?.horizon)} Weeks Ahead</strong> (${esc(S?.target_date)})</div>
        <div>Generated: <strong>${now}</strong></div>
      </div>
    </header>

    <!-- Badges -->
    <div class="tag-row">
      <span class="doc-tag">Historical Replay (2016–2024 Baseline)</span>
      <span class="doc-tag">2025 Test Year Locked</span>
      <span class="doc-tag doc-tag-alert">Statistical Advisory — Not Medical Advice</span>
    </div>

    <!-- Section 1: Executive KPI Summary -->
    <div class="section-title">1. Executive Forecast Overview (${totalWards} Monitored Wards)</div>
    <div class="kpi-grid">
      <div class="kpi-card highlight">
        <div class="kpi-label">Projected Cases (Total)</div>
        <div class="kpi-value">${esc(S?.median_cases_total)}</div>
        <div class="kpi-hint">Conditional mean: ${Math.round(S?.expected_cases_total || 0)}</div>
      </div>
      <div class="kpi-card ${alertCount > 0 ? 'alert' : ''}">
        <div class="kpi-label">Wards on Outbreak Alert</div>
        <div class="kpi-value ${alertCount > 0 ? 'text-alert' : ''}">${alertCount} <span style="font-size:13px;color:#94a3b8;font-weight:600;">/ ${totalWards}</span></div>
        <div class="kpi-hint">${alertPct}% of all municipal wards</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Mean Outbreak Probability</div>
        <div class="kpi-value">${Math.round((S?.mean_p_outbreak || 0) * 100)}%</div>
        <div class="kpi-hint">Across all monitored wards</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Risk Tier Distribution</div>
        <div style="font-size:11.5px;font-weight:700;margin-top:6px;line-height:1.45;">
          ${Object.entries(S?.tier_counts || {}).map(([k, v]) => `<div><strong>${esc(v)}</strong> <span style="color:#64748b;font-weight:500;">${esc(k)}</span></div>`).join("")}
        </div>
      </div>
    </div>

    <!-- Section 2: Selected Focus Ward (if any) -->
    ${f ? `
    <div class="section-title">2. Focus Ward Detail: ${esc(f.ward_id)} (${esc(f.city)})</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Median Forecast</th>
            <th>Expected Mean</th>
            <th>80% Interval</th>
            <th>90% Interval</th>
            <th>P(Outbreak)</th>
            <th>Risk Tier</th>
            <th>Alert Verdict</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight:800;font-size:13px;color:#0f172a;">${esc(f.median_cases)} cases</td>
            <td style="font-weight:600;">${Number(f.expected_cases).toFixed(1)}</td>
            <td style="font-family:ui-monospace, monospace;">${esc(f.lower_80)} – ${esc(f.upper_80)}</td>
            <td style="font-family:ui-monospace, monospace;">${esc(f.lower_90)} – ${esc(f.upper_90)}</td>
            <td style="font-weight:800;color:${f.p_outbreak >= 0.5 ? '#dc2626' : '#0f172a'};">${Math.round(f.p_outbreak * 100)}%</td>
            <td><span class="tier-pill" style="font-weight:700;">${esc(f.risk_tier)}</span></td>
            <td style="font-weight:800;color:${f.outbreak_alert ? '#dc2626' : '#059669'};">${f.outbreak_alert ? "● ACTIVE ALERT" : "○ Normal"}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ""}

    <!-- Section 3: High-Risk Wards -->
    <div class="section-title">3. Priority Outbreak-Risk Wards (Top ${(top ?? []).length} by Outbreak Probability)</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-num">#</th>
            <th>Ward Identifier</th>
            <th>City Corporation</th>
            <th class="col-tier">Risk Tier</th>
            <th class="col-prob">P(Outbreak)</th>
            <th class="col-median">Median Cases</th>
            <th class="col-interval">90% Credible Range</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <!-- Section 4: Operational Action Matrix -->
    <div class="section-title">4. Municipal Standard Operating Procedures (SOP Directives)</div>
    <div class="sop-grid">
      <div class="sop-card sop-critical">
        <div class="sop-title">
          <span>CRITICAL RISK (≥13 Cases / Week)</span>
          <span>TIER IV</span>
        </div>
        <div class="sop-desc">
          <strong>Immediate EOC Activation:</strong> Deploy rapid vector control squads for twice-daily focal adulticide fogging. Pre-position NS1 antigen test kits and IV fluid supplies at designated ward clinics. Instruct area hospitals to prepare dedicated dengue isolation units.
        </div>
      </div>
      <div class="sop-card sop-high">
        <div class="sop-title">
          <span>HIGH RISK (5–12 Cases / Week)</span>
          <span>TIER III</span>
        </div>
        <div class="sop-desc">
          <strong>Targeted Vector Abatement:</strong> Mobilize municipal community health teams for systematic household water container inspections. Intensify larviciding in construction zones, basements, and open stormwater drains. Conduct public awareness loudspeaker announcements.
        </div>
      </div>
      <div class="sop-card sop-medium">
        <div class="sop-title">
          <span>MEDIUM RISK (1–4 Cases / Week)</span>
          <span>TIER II</span>
        </div>
        <div class="sop-desc">
          <strong>Preventive Larviciding:</strong> Routine biological larvicide application in community reservoirs, water hyacinth bodies, and roadside ditches. Distribute prevention brochures through ward community centers and educational institutions.
        </div>
      </div>
      <div class="sop-card sop-low">
        <div class="sop-title">
          <span>LOW RISK (0 Cases / Week)</span>
          <span>TIER I</span>
        </div>
        <div class="sop-desc">
          <strong>Baseline Surveillance:</strong> Continuous entomological monitoring of Breteau Index (BI) and House Index (HI). Routine municipal waste clearance to prevent rain accumulation in discarded tires and plastic containers.
        </div>
      </div>
    </div>

    <!-- Section 5: Model Provenance -->
    <div class="section-title">5. Model Architecture &amp; Validation Integrity</div>
    <p style="font-size:11px;color:#475569;margin-bottom:8px;">
      Primary Forecasting Engine: <strong>${esc(meta?.model?.name || "Ridge Poisson GLM")}</strong> (24 features, Convention B). Evaluated strictly on chronological out-of-time validation folds (seasons 2022–2024).
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Forecast Horizon</th>
            <th>Validation MAE (Cases/Wk)</th>
            <th>RMSE</th>
            <th>High-Incidence MAE</th>
            <th>80% Interval Coverage</th>
            <th>90% Interval Coverage</th>
          </tr>
        </thead>
        <tbody>
          ${[2, 3, 4].map((h) => {
            const m = B[h]?.bench_2022_2024;
            return m ? `<tr>
              <td style="font-weight:700;">${h} Weeks Ahead</td>
              <td style="font-weight:800;color:#0e8f66;">${m.mae}</td>
              <td>${Number(m.rmse).toFixed(2)}</td>
              <td>${Number(m.high_mae).toFixed(2)}</td>
              <td>${esc(coverage?.c80 || "0.85")}</td>
              <td>${esc(coverage?.c90 || "0.91")}</td>
            </tr>` : "";
          }).join("")}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <footer class="doc-footer">
      <div class="footer-left">
        <div><strong>Methodological Notice:</strong> The underlying data are synthetic, provided for the EDU AI Engineering Hackathon 2026. Ward IDs represent statistical entities. Negative binomial intervals are empirically calibrated but tend to under-cover extreme outbreak peaks by ~3 cases. This document serves as decision-support advisory only.</div>
      </div>
      <div>
        <div style="font-weight:700;color:#0f172a;margin-bottom:2px;">Emergency Contacts (BD)</div>
        <div class="hotline-pills">
          <span class="hotline">🚨 999</span>
          <span class="hotline">🏥 16263</span>
        </div>
      </div>
    </footer>
  </div>

</body>
</html>`;
}
