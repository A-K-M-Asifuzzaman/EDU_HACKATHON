// Institutional Weekly Epidemiological Situation Report (SITREP)
// Deterministic, zero-LLM template formatted for authentic public-health surveillance reporting.
// Supports both Bengali (বাংলা) and English with instant on-sheet language toggle and A4 print layout.

const esc = (v: unknown) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const toBn = (s: string | number) => String(s).replace(/\d/g, (d) => BN_DIGITS[+d]);

export function buildBrief(d: { sel: any; S: any; f: any; top: any[]; metrics: any; coverage: any; meta: any; lang?: "en" | "bn" }): string {
  const { sel, S, f, top, metrics, coverage, meta, lang = "en" } = d;
  const B = metrics?.champion?.validation?.B ?? {};
  
  const originStr = String(sel?.origin || "2024-08-05");
  const horizon = Number(sel?.horizon || 2);
  const targetStr = String(S?.target_date || originStr);
  const refNo = `DS/EPI/${originStr.replace(/-/g, "")}/W${horizon}`;
  const now = new Date().toISOString().slice(0, 10);
  
  const totalWards = S?.wards || 60;
  const alertCount = S?.alerts || 0;
  const alertPct = Math.round((alertCount / totalWards) * 100);
  const totalMedian = Math.round(S?.median_cases_total || 0);
  const totalMean = Math.round(S?.expected_cases_total || 0);
  const meanProb = Math.round((S?.mean_p_outbreak || 0) * 100);

  // High-risk rows (English)
  const rowsEn = (top ?? []).map((w: any, i: number) => {
    const tier = String(w.risk_tier || "Low");
    const tierClass = tier.toLowerCase();
    return `<tr>
      <td class="text-center font-mono">${i + 1}</td>
      <td class="font-bold">${esc(w.ward_id)}</td>
      <td>${esc(w.city)}</td>
      <td class="text-center"><span class="badge badge-${tierClass}">${esc(w.risk_tier)}</span></td>
      <td class="text-right font-bold">${Math.round((w.p_outbreak || 0) * 100)}%</td>
      <td class="text-right font-bold">${esc(w.median_cases)}</td>
      <td class="text-right font-mono text-muted">${esc(w.lower_90)} – ${esc(w.upper_90)}</td>
    </tr>`;
  }).join("");

  // High-risk rows (Bengali)
  const cityBn: Record<string, string> = {
    "Dhaka North": "ঢাকা উত্তর",
    "Dhaka South": "ঢাকা দক্ষিণ",
    "Chattogram": "চট্টগ্রাম",
    "Gazipur": "গাজীপুর",
    "Narayanganj": "নারায়ণগঞ্জ"
  };
  const tierBn: Record<string, string> = {
    "Critical": "সংকটজনক",
    "High": "উচ্চ ঝুঁকি",
    "Medium": "মাঝারি",
    "Low": "স্বাভাবিক"
  };

  const rowsBn = (top ?? []).map((w: any, i: number) => {
    const tier = String(w.risk_tier || "Low");
    const tierClass = tier.toLowerCase();
    const city = cityBn[w.city] || w.city;
    const tierLabel = tierBn[tier] || tier;
    return `<tr>
      <td class="text-center font-mono">${toBn(i + 1)}</td>
      <td class="font-bold">${esc(w.ward_id)}</td>
      <td>${esc(city)}</td>
      <td class="text-center"><span class="badge badge-${tierClass}">${esc(tierLabel)}</span></td>
      <td class="text-right font-bold">${toBn(Math.round((w.p_outbreak || 0) * 100))}%</td>
      <td class="text-right font-bold">${toBn(esc(w.median_cases))}</td>
      <td class="text-right font-mono text-muted">${toBn(esc(w.lower_90))} – ${toBn(esc(w.upper_90))}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DengueShield AI — Epidemiological Situation Report (${refNo})</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 15mm 14mm 15mm;
    }
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hind Siliguri", "Noto Sans Bengali", Arial, sans-serif;
      color: #1e293b;
      background: #f8fafc;
      margin: 0;
      padding: 24px 12px;
      font-size: 11.5px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }

    /* Screen Action Bar */
    .screen-toolbar {
      max-width: 820px;
      margin: 0 auto 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
    }
    .toolbar-title {
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .toolbar-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .btn-tb {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-tb-primary { background: #4b45d1; color: #ffffff; }
    .btn-tb-primary:hover { background: #0b7352; }
    .btn-tb-lang { background: #334155; color: #ffffff; }
    .btn-tb-lang:hover { background: #475569; }
    .btn-tb-close { background: rgba(255,255,255,0.15); color: #e2e8f0; }

    /* Report Sheet (Official Bulletin Styling) */
    .sheet {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      padding: 36px 44px;
      border: 1px solid #cbd5e1;
      border-radius: 2px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    /* Official Government/Municipal Letterhead Header */
    .gov-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .gov-seal-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .sub-authority {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #475569;
    }
    .main-bulletin-title {
      font-size: 19px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.01em;
      margin: 1px 0 0;
      line-height: 1.2;
    }
    .bulletin-subtitle {
      font-size: 11px;
      color: #4b45d1;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .ref-meta-table {
      font-size: 10.5px;
      color: #475569;
      text-align: right;
      line-height: 1.5;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      padding: 6px 10px;
      border-radius: 4px;
    }
    .ref-meta-table strong { color: #0f172a; }

    /* Classification Banner */
    .security-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      padding: 4px 10px;
      font-size: 10px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 14px;
    }

    /* Section Headings */
    .sec-header {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 3px;
      margin: 18px 0 8px;
    }

    /* Summary Grid */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .kpi-cell {
      border: 1px solid #cbd5e1;
      background: #fafafa;
      padding: 8px 10px;
      border-radius: 4px;
    }
    .kpi-cell-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.02em;
    }
    .kpi-cell-value {
      font-size: 19px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .kpi-cell-sub {
      font-size: 9.5px;
      color: #64748b;
      margin-top: 1px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      margin-bottom: 12px;
    }
    th {
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 700;
      border: 1px solid #cbd5e1;
      padding: 5px 8px;
      text-align: left;
    }
    td {
      border: 1px solid #e2e8f0;
      padding: 4.5px 8px;
      color: #334155;
    }
    tr:nth-child(even) td { background: #fafafa; }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
    .text-muted { color: #64748b; }

    /* Tier Badges */
    .badge {
      display: inline-block;
      padding: 1.5px 6px;
      border-radius: 3px;
      font-size: 9.5px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .badge-critical { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
    .badge-high { background: #ffedd5; color: #9a3412; border-color: #fdba74; }
    .badge-medium { background: #e0f2fe; color: #075985; border-color: #7dd3fc; }
    .badge-low { background: #ecfdf5; color: #065f46; border-color: #6ee7b7; }

    /* Operational Directives / SOP */
    .sop-table {
      border: 1px solid #cbd5e1;
      margin-bottom: 14px;
    }
    .sop-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      border-bottom: 1px solid #e2e8f0;
      font-size: 10px;
    }
    .sop-row:last-child { border-bottom: none; }
    .sop-col-level {
      padding: 6px 8px;
      font-weight: 700;
      border-right: 1px solid #e2e8f0;
      background: #f8fafc;
      display: flex;
      align-items: center;
    }
    .sop-col-action {
      padding: 6px 10px;
      line-height: 1.4;
      color: #334155;
    }

    /* Verification & Provenance Note */
    .model-note {
      font-size: 9.5px;
      color: #64748b;
      line-height: 1.4;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 6px 10px;
      margin-bottom: 16px;
    }

    /* Formal Sign-off Box */
    .signoff-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px dashed #cbd5e1;
    }
    .signoff-box {
      font-size: 10px;
      color: #475569;
      line-height: 1.4;
    }
    .signoff-line {
      width: 140px;
      border-bottom: 1px solid #94a3b8;
      margin-bottom: 4px;
      padding-top: 20px;
    }

    /* Print Formatting */
    @media print {
      body { background: #ffffff; padding: 0; }
      .sheet { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .screen-toolbar { display: none !important; }
      .no-print { display: none !important; }
      tr { break-inside: avoid; }
      .kpi-row { break-inside: avoid; }
      .sop-table { break-inside: avoid; }
    }
  </style>
  <script>
    function toggleReportLang(target) {
      document.getElementById('doc-en').style.display = target === 'en' ? 'block' : 'none';
      document.getElementById('doc-bn').style.display = target === 'bn' ? 'block' : 'none';
    }
  </script>
</head>
<body>

  <!-- Screen Toolbar -->
  <div class="screen-toolbar no-print">
    <div class="toolbar-title">
      Epidemiological Surveillance Situation Report (SITREP)
    </div>
    <div class="toolbar-actions">
      <button class="btn-tb btn-tb-lang" onclick="toggleReportLang('en')">English</button>
      <button class="btn-tb btn-tb-lang" onclick="toggleReportLang('bn')">বাংলা সংস্করণ</button>
      <button class="btn-tb btn-tb-primary" onclick="window.print()">Print / Save as PDF</button>
      <button class="btn-tb btn-tb-close" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="sheet">

    <!-- ==================== ENGLISH VERSION ==================== -->
    <div id="doc-en" style="display: ${lang === 'bn' ? 'none' : 'block'};">
      <header class="gov-header">
        <div class="gov-seal-title">
          <span class="sub-authority">DengueShield AI · research prototype, not an official publication</span>
          <h1 class="main-bulletin-title">Dengue Early Warning &amp; Situation Report</h1>
          <span class="bulletin-subtitle">Weekly Epidemiological Forecast &amp; Vector Control Advisory</span>
        </div>
        <div class="ref-meta-table">
          <div>Ref: <strong>${refNo}</strong></div>
          <div>Forecast Origin: <strong>${esc(originStr)}</strong> (Monday grid)</div>
          <div>Forecast Horizon: <strong>${horizon} Weeks Ahead</strong> (${esc(targetStr)})</div>
          <div>Issue Date: <strong>${esc(now)}</strong></div>
        </div>
      </header>

      <div class="security-bar">
        <span>STATUS: STATISTICAL SURVEILLANCE ADVISORY</span>
        <span>HISTORICAL REPLAY (2016–2024 SYNTHETIC COMPETITION DATA)</span>
        <span>2025 HOLDOUT LOCKED</span>
      </div>

      <div class="sec-header">1. Executive Surveillance Summary (${totalWards} Monitored Municipal Wards)</div>
      <div class="kpi-row">
        <div class="kpi-cell">
          <div class="kpi-cell-label">Projected Dengue Cases</div>
          <div class="kpi-cell-value">${totalMedian}</div>
          <div class="kpi-cell-sub">Conditional mean: ${totalMean} cases</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-label">Wards on Outbreak Alert</div>
          <div class="kpi-cell-value" style="color:${alertCount > 0 ? '#b91c1c' : '#0f172a'};">${alertCount} / ${totalWards}</div>
          <div class="kpi-cell-sub">${alertPct}% of municipal wards</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-label">Mean Outbreak Probability</div>
          <div class="kpi-cell-value">${meanProb}%</div>
          <div class="kpi-cell-sub">P(cases ≥ training 90th percentile)</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-label">Risk Tier Stratification</div>
          <div style="font-size:10px;font-weight:700;margin-top:3px;line-height:1.4;">
            ${Object.entries(S?.tier_counts || {}).map(([k, v]) => `<div><strong>${esc(v)}</strong> <span style="color:#64748b;">${esc(k)}</span></div>`).join("")}
          </div>
        </div>
      </div>

      ${f ? `
      <div class="sec-header">2. Designated Ward Detail: ${esc(f.ward_id)} (${esc(f.city)})</div>
      <table>
        <thead>
          <tr>
            <th>Median Forecast</th>
            <th>Expected Mean</th>
            <th>80% Interval</th>
            <th>90% Interval</th>
            <th>P(Outbreak)</th>
            <th>Risk Tier</th>
            <th>Outbreak Alert Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="font-bold">${esc(f.median_cases)} cases</td>
            <td>${Number(f.expected_cases).toFixed(1)}</td>
            <td class="font-mono">${esc(f.lower_80)} – ${esc(f.upper_80)}</td>
            <td class="font-mono">${esc(f.lower_90)} – ${esc(f.upper_90)}</td>
            <td class="font-bold" style="color:${f.p_outbreak >= 0.5 ? '#b91c1c' : '#0f172a'};">${Math.round(f.p_outbreak * 100)}%</td>
            <td><span class="badge badge-${String(f.risk_tier).toLowerCase()}">${esc(f.risk_tier)}</span></td>
            <td class="font-bold" style="color:${f.outbreak_alert ? '#b91c1c' : '#047857'};">${f.outbreak_alert ? "ACTIVE OUTBREAK ALERT" : "Routine Surveillance"}</td>
          </tr>
        </tbody>
      </table>
      ` : ""}

      <div class="sec-header">3. Priority Outbreak-Risk Wards (Ranked by Outbreak Probability)</div>
      <table>
        <thead>
          <tr>
            <th style="width:30px;" class="text-center">#</th>
            <th>Ward Identifier</th>
            <th>City Corporation</th>
            <th class="text-center">Risk Tier</th>
            <th class="text-right">P(Outbreak)</th>
            <th class="text-right">Median Cases</th>
            <th class="text-right">90% Credible Interval</th>
          </tr>
        </thead>
        <tbody>
          ${rowsEn}
        </tbody>
      </table>

      <div class="sec-header">4. Illustrative response options (generic examples, not official guidance)</div>
      <div class="sop-table">
        <div class="sop-row">
          <div class="sop-col-level" style="color:#991b1b;border-left:3px solid #b91c1c;">CRITICAL TIER (≥13)</div>
          <div class="sop-col-action"><strong>Emergency Vector Abatement &amp; Surge Preparedness:</strong> Mobilize municipal emergency operations. Conduct twice-daily targeted focal adulticiding (thermal fogging). Pre-position NS1 antigen test kits and intravenous fluid stocks at ward health centers. Alert designated tertiary hospitals for dengue triage.</div>
        </div>
        <div class="sop-row">
          <div class="sop-col-level" style="color:#9a3412;border-left:3px solid #ea580c;">HIGH RISK (5–12)</div>
          <div class="sop-col-action"><strong>Targeted Larviciding &amp; Source Reduction:</strong> Deploy ward health squads for door-to-door larval inspections (targeting overhead tanks, basement sumps, and construction sites). Intensify public awareness announcements across market areas.</div>
        </div>
        <div class="sop-row">
          <div class="sop-col-level" style="color:#0369a1;border-left:3px solid #0284c7;">MEDIUM RISK (1–4)</div>
          <div class="sop-col-action"><strong>Routine Environmental Vector Control:</strong> Apply biological larvicide (Bti) in roadside stormwater drains and stagnant water bodies. Clean roadside trash and discarded plastic receptacles.</div>
        </div>
        <div class="sop-row">
          <div class="sop-col-level" style="color:#065f46;border-left:3px solid #059669;">LOW RISK (0)</div>
          <div class="sop-col-action"><strong>Baseline Epidemiological Surveillance:</strong> Maintain regular entomological monitoring (Breteau Index &amp; House Index). Routine waste disposal and civic cleanliness.</div>
        </div>
      </div>

      <div class="sec-header">5. Scientific Provenance &amp; Statistical Limitations</div>
      <div class="model-note">
        <strong>Forecasting Architecture:</strong> Ridge Poisson Generalized Linear Model (24 features, Convention B: data available strictly prior to forecast origin). Evaluated on out-of-time validation folds (seasons 2022–2024: MAE 1.11 / 1.39 / 1.51 cases/week for h=2/3/4).<br>
        <strong>Known Limitation:</strong> The underlying dataset is synthetic competition data (2016–2024). Calibrated prediction intervals maintain ~85–91% empirical coverage on average but under-cover extreme outbreak peaks by ~3 cases. This report is a statistical decision-support advisory, not an official ministerial decree.
      </div>

      <div class="signoff-grid">
        <div class="signoff-box">
          <div>Report Compiled by:</div>
          <div class="signoff-line"></div>
          <strong>DengueShield AI (automatically generated)</strong><br>
          Emergency Hotlines: <strong>999</strong> (National) · <strong>16263</strong> (DGHS Healthline)
        </div>
        <div class="signoff-box" style="text-align:right;">
          <div>Reviewed by (to be completed by a responsible officer):</div>
          <div class="signoff-line" style="margin-left:auto;"></div>
          <strong>Name and role</strong><br>
          This prototype does not issue or approve official releases
        </div>
      </div>
    </div>

    <!-- ==================== BENGALI VERSION ==================== -->
    <div id="doc-bn" style="display: ${lang === 'bn' ? 'block' : 'none'};">
      <header class="gov-header">
        <div class="gov-seal-title">
          <span class="sub-authority">ডেঙ্গুশিল্ড এআই · গবেষণা প্রোটোটাইপ, সরকারি প্রকাশনা নয়</span>
          <h1 class="main-bulletin-title">ডেঙ্গু আগাম সতর্কতা ও পরিস্থিতি বুলেটিন</h1>
          <span class="bulletin-subtitle">সাপ্তাহিক রোগতত্ত্বীয় পূর্বাভাস ও ভেক্টর নিয়ন্ত্রণ পরামর্শ</span>
        </div>
        <div class="ref-meta-table">
          <div>স্মারক নং: <strong>${toBn(refNo)}</strong></div>
          <div>পূর্বাভাসের ভিত্তি: <strong>${toBn(esc(originStr))}</strong> (সোমবার)</div>
          <div>পূর্বাভাস হরাইজন: <strong>${toBn(horizon)} সপ্তাহ অগ্রবর্তী</strong> (${toBn(esc(targetStr))})</div>
          <div>ইস্যুর তারিখ: <strong>${toBn(esc(now))}</strong></div>
        </div>
      </header>

      <div class="security-bar">
        <span>স্ট্যাটাস: জনস্বাস্থ্য সংক্রান্ত পরিসংখ্যানগত পূর্বাভাস</span>
        <span>ঐতিহাসিক রিপ্লে (২০১৬–২০২৪ সিন্থেটিক প্রতিযোগিতার ডেটা)</span>
        <span>২০২৫ টেস্ট ইয়ার সংরক্ষিত</span>
      </div>

      <div class="sec-header">১. সামগ্রিক নজরদারি সারসংক্ষেপ (${toBn(totalWards)}টি ওয়ার্ডের বিশ্লেষণ)</div>
      <div class="kpi-row">
        <div class="kpi-cell">
          <div class="kpi-cell-label">মোট প্রজেক্টেড কেস</div>
          <div class="kpi-cell-value">${toBn(totalMedian)}</div>
          <div class="kpi-cell-sub">প্রত্যাশিত গড়: ${toBn(totalMean)} টি কেস</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-label">আউটব্রেক সতর্কতায় থাকা ওয়ার্ড</div>
          <div class="kpi-cell-value" style="color:${alertCount > 0 ? '#b91c1c' : '#0f172a'};">${toBn(alertCount)} / ${toBn(totalWards)}</div>
          <div class="kpi-cell-sub">মোট ওয়ার্ডের ${toBn(alertPct)}% সতর্কতামূলক স্তরে</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-label">গড় প্রাদুর্ভাব সম্ভাবনা</div>
          <div class="kpi-cell-value">${toBn(meanProb)}%</div>
          <div class="kpi-cell-sub">৯০তম পার্সেন্টাইল অতিক্রমের সম্ভাবনা</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-label">ঝুঁকির স্তর অনুযায়ী ওয়ার্ড সংখ্যা</div>
          <div style="font-size:10px;font-weight:700;margin-top:3px;line-height:1.4;">
            ${Object.entries(S?.tier_counts || {}).map(([k, v]) => `<div><strong>${toBn(esc(v))}</strong> <span style="color:#64748b;">${esc(tierBn[k] || k)}</span></div>`).join("")}
          </div>
        </div>
      </div>

      ${f ? `
      <div class="sec-header">২. নির্দিষ্ট ওয়ার্ড পর্যবেক্ষণ: ${esc(f.ward_id)} (${esc(cityBn[f.city] || f.city)})</div>
      <table>
        <thead>
          <tr>
            <th>মিডিয়ান পূর্বাভাস</th>
            <th>প্রত্যাশিত গড়</th>
            <th>৮০% সম্ভাব্য ব্যবধি</th>
            <th>৯০% সম্ভাব্য ব্যবধি</th>
            <th>প্রাদুর্ভাব সম্ভাবনা</th>
            <th>ঝুঁকির স্তর</th>
            <th>সতর্কতা স্ট্যাটাস</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="font-bold">${toBn(esc(f.median_cases))} টি</td>
            <td>${toBn(Number(f.expected_cases).toFixed(1))}</td>
            <td class="font-mono">${toBn(esc(f.lower_80))} – ${toBn(esc(f.upper_80))}</td>
            <td class="font-mono">${toBn(esc(f.lower_90))} – ${toBn(esc(f.upper_90))}</td>
            <td class="font-bold" style="color:${f.p_outbreak >= 0.5 ? '#b91c1c' : '#0f172a'};">${toBn(Math.round(f.p_outbreak * 100))}%</td>
            <td><span class="badge badge-${String(f.risk_tier).toLowerCase()}">${esc(tierBn[f.risk_tier] || f.risk_tier)}</span></td>
            <td class="font-bold" style="color:${f.outbreak_alert ? '#b91c1c' : '#047857'};">${f.outbreak_alert ? "সক্রিয় আউটব্রেক সতর্কতা" : "স্বাভাবিক নজরদারি"}</td>
          </tr>
        </tbody>
      </table>
      ` : ""}

      <div class="sec-header">৩. শীর্ষ ঝুঁকিপূর্ণ ওয়ার্ডসমূহ (প্রাদুর্ভাব সম্ভাবনার ক্রমানুসারে)</div>
      <table>
        <thead>
          <tr>
            <th style="width:30px;" class="text-center">ক্র.</th>
            <th>ওয়ার্ড নম্বর</th>
            <th>সিটি কর্পোরেশন</th>
            <th class="text-center">ঝুঁকির স্তর</th>
            <th class="text-right">প্রাদুর্ভাব সম্ভাবনা</th>
            <th class="text-right">মিডিয়ান কেস</th>
            <th class="text-right">৯০% সম্ভাব্য ব্যবধি</th>
          </tr>
        </thead>
        <tbody>
          ${rowsBn}
        </tbody>
      </table>

      <div class="sec-header">৪. উদাহরণমূলক প্রতিক্রিয়া বিকল্প (সাধারণ উদাহরণ, সরকারি নির্দেশনা নয়)</div>
      <div class="sop-table">
        <div class="sop-row">
          <div class="sop-col-level" style="color:#991b1b;border-left:3px solid #b91c1c;">সংকটজনক স্তর (≥১৩)</div>
          <div class="sop-col-action"><strong>জরুরি সাড়াদান ও চিকিৎসা প্রস্তুতি:</strong> ইমার্জেন্সি অপারেশন সেন্টার চালু করা। দিনে দুইবার নিবিড় ফোকাল ফগিং ও স্প্রে পরিচালনা। ওয়ার্ড ফিভার ক্লিনিকে এনএস১ কিট এবং আইভি স্যালাইন পর্যাপ্ত মজুত নিশ্চিতকরণ। নিকটস্থ হাসপাতালে ডেঙ্গু ট্রায়াজ প্রস্তুত রাখা।</div>
        </div>
        <div class="sop-row">
          <div class="sop-col-level" style="color:#9a3412;border-left:3px solid #ea580c;">উচ্চ ঝুঁকি (৫–১২)</div>
          <div class="sop-col-action"><strong>উৎস নির্মূল ও লার্ভিসাইড প্রয়োগ:</strong> স্বাস্থ্যকর্মীদের দ্বারা বাড়ি বাড়ি পানির ট্যাংক ও জমা পানি পরিদর্শন। নির্মাণাধীন ভবন ও আন্ডারগ্রাউন্ড পার্কিংয়ে লার্ভিসাইড প্রয়োগ। বাজার এলাকায় মাইকিং।</div>
        </div>
        <div class="sop-row">
          <div class="sop-col-level" style="color:#0369a1;border-left:3px solid #0284c7;">মাঝারি ঝুঁকি (১–৪)</div>
          <div class="sop-col-action"><strong>পরিবেশগত পরিচ্ছন্নতা ও নালা পরিষ্কার:</strong> ড্রেন ও খালের জমা পানিতে বায়ো-লার্ভিসাইড ছিটানো। শিক্ষাপ্রতিষ্ঠান ও ধর্মীয় প্রতিষ্ঠানে সচেতনতা লিফলেট বিতরণ।</div>
        </div>
        <div class="sop-row">
          <div class="sop-col-level" style="color:#065f46;border-left:3px solid #059669;">স্বাভাবিক স্তর (০)</div>
          <div class="sop-col-action"><strong>রুটিন কীটতাত্ত্বিক নজরদারি:</strong> ব্রেটো ইনডেক্স ও হাউস ইনডেক্স নিয়মিত পর্যবেক্ষণ। স্বাভাবিক আবর্জনা পরিষ্কার বজায় রাখা।</div>
        </div>
      </div>

      <div class="sec-header">৫. বৈজ্ঞানিক ভিত্তি ও সীমাবদ্ধতার নোটিশ</div>
      <div class="model-note">
        <strong>মডেল আর্কিটেকচার:</strong> রিজ পয়সোঁ জেনারালাইজড লিনিয়ার মডেল (২৪টি ফিচার, কনভেনশন বি: পূর্বাভাসের আগের ডেটা ব্যবহৃত)। ২০২২–২০২৪ মৌসুমে আউট-অব-টাইম মূল্যায়িত (গড় ত্রুটি ১.১১ / ১.৩৯ / ১.৫১ কেস/সপ্তাহ)।<br>
        <strong>সীমাবদ্ধতা:</strong> এটি হ্যাকাথনের সিন্থেটিক ডেটাসেটের ভিত্তিতে তৈরি একটি পরিসংখ্যানগত সিদ্ধান্ত-সহায়ক বিশ্লেষণ, কোনো সরকারি গেজেটেড আদেশ নয়। ডেঙ্গু পিক টাইমে ইন্টারভালগুলো প্রায় ৩টি কেস কম অনুমান করতে পারে।
      </div>

      <div class="signoff-grid">
        <div class="signoff-box">
          <div>ডেঙ্গুশিল্ড এআই দ্বারা স্বয়ংক্রিয়ভাবে প্রস্তুত:</div>
          <div class="signoff-line"></div>
          <strong>ডেঙ্গুশিল্ড এআই</strong><br>
          জরুরি যোগাযোগ: <strong>৯৯৯</strong> (জাতীয় সেবা) · <strong>১৬২৬৩</strong> (স্বাস্থ্য বাতায়ন)
        </div>
        <div class="signoff-box" style="text-align:right;">
          <div>পর্যালোচনায় (দায়িত্বপ্রাপ্ত কর্মকর্তা পূরণ করবেন):</div>
          <div class="signoff-line" style="margin-left:auto;"></div>
          <strong>নাম ও পদবি</strong><br>
          এই প্রোটোটাইপ কোনো সরকারি প্রকাশ বা অনুমোদন দেয় না
        </div>
      </div>
    </div>

  </div>
</body>
</html>`;
}
