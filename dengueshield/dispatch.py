"""Deterministic ward dispatch: one canonical brief per ward (and a city summary), rendered as SMS text, WhatsApp text, a printable HTML
brief and a PDF. Every number is copied from the Stage 1-3 engine outputs for one scenario; nothing is recomputed here. No timestamps
enter the content, so the same scenario always produces the same bytes. Nothing is sent: the outputs are text and documents for an
officer to review."""
from __future__ import annotations

import hashlib
import html
import json
import math

from . import pdfmini

SCHEMA = "dengueshield.dispatch/1"
GSM_BASIC = ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿"
             "abcdefghijklmnopqrstuvwxyzäöñüà")
GSM_EXT = "^{}\\[~]|€\f"
RES = (("saline_bags_needed", "saline", "Saline bags"), ("diagnostic_kits_needed", "kits", "Diagnostic kits"),
       ("hospital_beds_required", "beds", "Hospital beds (regional stock)"))
MODE_LABEL = {"optimized": "optimized deployment", "manual": "manual deployment", "stage1": "supply-plan rule"}
BN = {"Low": "নিম্ন", "Medium": "মাঝারি", "High": "উচ্চ", "Critical": "সংকটপূর্ণ"}


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(obj) -> str:
    return hashlib.sha256(canonical(obj)).hexdigest()


def scenario_id(settings: dict, artifacts: dict) -> str:
    return "S-" + digest({"settings": settings, "artifacts": artifacts})[:12]


def sms_stats(text: str) -> dict:
    """Characters as an SMS gateway counts them: GSM-7 (extension characters count twice) or UCS-2 for anything else, e.g. Bangla."""
    if all(c in GSM_BASIC or c in GSM_EXT for c in text):
        n = sum(2 if c in GSM_EXT else 1 for c in text)
        return {"encoding": "GSM-7", "chars": n, "segments": 1 if n <= 160 else math.ceil(n / 153), "per_segment": 160 if n <= 160 else 153}
    n = len(text.encode("utf-16-le")) // 2
    return {"encoding": "UCS-2", "chars": n, "segments": 1 if n <= 70 else math.ceil(n / 67), "per_segment": 70 if n <= 70 else 67}


def fmt_date(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{int(d)} {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][int(m) - 1]} {y}"


def n1(x) -> str:
    return f"{x:.1f}"


# ------------------------------------------------------------------ canonical objects
def ward_brief(ward_id: str, scenario: dict, alloc: dict, ovf: dict, iv: dict, model: dict) -> dict:
    a = next(w for w in alloc["wards"] if w["ward_id"] == ward_id)
    o = next(w for w in ovf["wards"] if w["ward_id"] == ward_id)
    v = next(w for w in iv["wards"] if w["ward_id"] == ward_id)
    h = str(alloc["horizon"])
    vh = v["by_horizon"][h]
    settings = scenario["settings"]
    out_t = [{"to_ward": t["to_ward"], "patients": t["patients"]} for t in ovf["transfers"] if t["from_ward"] == ward_id]
    in_t = [{"from_ward": t["from_ward"], "patients": t["patients"]} for t in ovf["transfers"] if t["to_ward"] == ward_id]
    resources = {short: {"required": a[k]["demand"], "allocated": a[k]["allocated"], "short": a[k]["unmet"]} for k, short, _ in RES}
    attention = []
    for k, short, label in RES:
        r = resources[short]
        if r["short"]:
            attention.append({"item": short, "text": f"{label}: {r['short']} short ({r['allocated']} of {r['required']} allocated)"})
    if o["unresolved"]:
        attention.append({"item": "hospital", "text": f"Hospital: {o['unresolved']} projected patient{'s' if o['unresolved'] != 1 else ''} "
                                                      f"without a bed in {a['city']} (illustrative capacity {o['capacity']})"})
    if v["crews"] < a["crews_needed"]:
        attention.append({"item": "crews", "text": f"Spraying crews: {v['crews']} deployed, the supply-plan rule asks for {a['crews_needed']}"})
    brief = {
        "schema": SCHEMA, "kind": "ward_brief", "scenario": scenario,
        "ward": {"ward_id": ward_id, "city": a["city"], "risk_tier": a["risk_tier"], "outbreak_probability": a["p_outbreak"],
                 "population_density_sqkm": a["population_density_sqkm"], "priority_rank": a["rank"], "priority": a["priority"],
                 "plan_status": a["status"]},
        "forecast": {"origin": alloc["origin"], "target_week": alloc["target_date"], "horizon_weeks": alloc["horizon"], "source": alloc["source"],
                     "source_label": "validated replay (models fitted on earlier seasons only)" if alloc["source"] == "replay"
                     else "deployed model, forecasting past its training data",
                     "service_level": settings["service"], "service_label": alloc["settings"]["service_label"],
                     "planned_cases": a["forecast_cases"], "expected_cases": vh["baseline"],
                     "median_cases": a["median_cases"], "upper_80": a["upper_80"], "upper_90": a["upper_90"]},
        "resources": resources,
        "hospital": {"bed_demand": o["demand"], "illustrative_capacity": o["capacity"], "capacity_baseline": o["capacity_baseline"],
                     "capacity_typed": o["overridden"], "over_capacity": o["deficit"], "spare_beds": o["headroom"], "sent": o["sent"],
                     "received": o["received"], "without_bed": o["unresolved"], "transfers_out": out_t, "transfers_in": in_t, "status": o["status"]},
        "crews": {"assigned": v["crews"], "deployment": iv["mode"], "deployment_label": MODE_LABEL[iv["mode"]], "supply_plan_need": a["crews_needed"],
                  "coverage_share": v["coverage"], "prevented_window": v["prevented_window"],
                  "prevented_window_low": round(sum(x["prevented_low"] for x in v["by_horizon"].values()), 3),
                  "prevented_window_high": round(sum(x["prevented_high"] for x in v["by_horizon"].values()), 3),
                  "expected_cases_at_target": vh["baseline"], "scenario_cases_at_target": vh["scenario"], "prevented_at_target": vh["prevented"],
                  "weeks": sorted(int(x) for x in v["by_horizon"])},
        "attention": attention,
        "assumptions": assumptions(settings),
        "provenance": provenance(alloc, iv),
        "model": model,
        "disclaimer": "Planning estimate on the organizer's synthetic dataset. Not an outbreak report, not an official order, and not sent to anyone.",
    }
    brief["content_sha256"] = digest(brief)
    return brief


def city_summary(city: str, scenario: dict, alloc: dict, ovf: dict, iv: dict, model: dict) -> dict:
    o = {w["ward_id"]: w for w in ovf["wards"]}
    v = {w["ward_id"]: w for w in iv["wards"]}
    ac = next(c for c in alloc["cities"] if c["city"] == city)
    oc = next(c for c in ovf["cities"] if c["city"] == city)
    rows = []
    for a in sorted((w for w in alloc["wards"] if w["city"] == city), key=lambda w: w["rank"]):
        ow, vw = o[a["ward_id"]], v[a["ward_id"]]
        rows.append({"rank": a["rank"], "ward_id": a["ward_id"], "risk_tier": a["risk_tier"], "planned_cases": a["forecast_cases"],
                     **{short: [a[k]["allocated"], a[k]["demand"]] for k, short, _ in RES},
                     "bed_demand": ow["demand"], "capacity": ow["capacity"], "sent": ow["sent"], "received": ow["received"],
                     "without_bed": ow["unresolved"], "crews": vw["crews"], "status": a["status"]})
    s = {"schema": SCHEMA, "kind": "city_summary", "scenario": scenario, "city": city,
         "forecast": {"origin": alloc["origin"], "target_week": alloc["target_date"], "horizon_weeks": alloc["horizon"], "source": alloc["source"],
                      "service_label": alloc["settings"]["service_label"]},
         "totals": {**{short: {"required": ac[k]["demand"], "supply": ac[k]["supply"], "allocated": ac[k]["allocated"], "short": ac[k]["unmet"]}
                       for k, short, _ in RES},
                    "hospital": {"bed_demand": oc["demand"], "illustrative_capacity": oc["capacity"], "transferred": oc["transferred"],
                                 "without_bed": oc["unresolved"]},
                    "crews_assigned": sum(r["crews"] for r in rows), "crews_total_in_view": iv["totals"]["crews"]["total"],
                    "wards": len(rows), "critical_wards": ac["critical_wards"]},
         "wards": rows, "transfers": [t for t in ovf["transfers"] if t["city"] == city],
         "assumptions": assumptions(scenario["settings"]), "provenance": provenance(alloc, iv), "model": model,
         "disclaimer": "Planning estimate on the organizer's synthetic dataset. Not an outbreak report, not an official order, and not sent to anyone."}
    s["content_sha256"] = digest(s)
    return s


def assumptions(st: dict) -> list[str]:
    v = st["vector"]
    return [f"Regional stock: {round(st['stock'] * 100)}% of each city's projected need, per resource (no inventory data exists).",
            f"Spraying crews: {st['crews']} in the shared budget, at most {st['max_crews_per_ward']} per ward; {MODE_LABEL[v['mode']]}.",
            f"Hospital capacity: illustrative, {st['capacity_pct']}% of each ward's 90th-percentile weekly bed need before the forecast date"
            f"{' with typed ward values' if st['overrides'] else ''}. Not a hospital inventory.",
            f"Vector-control effect (assumed, not measured): up to {round(v['effect'] * 100)}% fewer cases at full coverage, one crew treats "
            f"{round(v['coverage'] * 100)}% of a ward, {v['delay']}-week delay, {v['buildup']} weeks to full effect, one deployment at the forecast "
            f"date; sensitivity {round(v['sens_low'] * 100)}-{round(v['sens_high'] * 100)}% of the effect.",
            "Transfers stay inside each city; the regional bed stock is never added to ward capacity."]


def provenance(alloc: dict, iv: dict) -> dict:
    return {"measured": "Organizer dataset (synthetic): weekly cases, weather and resource requirements, 2016-2024. Used to train and replay "
                        "the forecasts and to set the illustrative capacity; target weeks are never read and 2025 is sealed.",
            "forecast": f"Origin-safe forecast issued {alloc['origin']} for the week of {alloc['target_date']} "
                        f"({'validated replay' if alloc['source'] == 'replay' else 'deployed model past its training window'}).",
            "assumptions": "Stock level, crew budget, capacity and intervention effect are user settings, listed above.",
            "simulated": "Allocations, transfers and cases prevented are computed by DengueShield's planning engines. They are not actions "
                         "taken and not observed outcomes."}


# ------------------------------------------------------------------ text formats
def _transfers(b: dict, bn: bool = False) -> str:
    hsp = b["hospital"]
    if hsp["transfers_out"]:
        t = ", ".join(f"{x['patients']} to {x['to_ward']}" for x in hsp["transfers_out"])
        return ("স্থানান্তর " if bn else "transfer ") + t
    if hsp["transfers_in"]:
        t = ", ".join(f"{x['patients']} from {x['from_ward']}" for x in hsp["transfers_in"])
        return ("গ্রহণ " if bn else "receive ") + t
    return "স্থানান্তর নেই" if bn else "no transfers"


def sms(b: dict, lang: str = "en") -> str:
    f, r, hsp, c, w = b["forecast"], b["resources"], b["hospital"], b["crews"], b["ward"]
    short = {"saline": "saline", "kits": "kits", "beds": "bed stock", "hospital": "hospital beds", "crews": "crews"}
    crit = ", ".join(short[x["item"]] for x in b["attention"])
    if lang == "bn":
        return "\n".join([
            "ডেঙ্গুশিল্ড পরিকল্পনা নোটিশ (পূর্বাভাস, প্রাদুর্ভাবের প্রতিবেদন নয়)",
            f"{w['ward_id']}, {w['city']}: সপ্তাহ {f['target_week']} ({f['horizon_weeks']} সপ্তাহের পূর্বাভাস, {f['origin']})",
            f"রোগী {f['planned_cases']}, ঝুঁকি {BN[w['risk_tier']]}",
            f"বরাদ্দ/প্রয়োজন: স্যালাইন {r['saline']['allocated']}/{r['saline']['required']}, কিট {r['kits']['allocated']}/{r['kits']['required']}, "
            f"শয্যা {r['beds']['allocated']}/{r['beds']['required']}",
            f"হাসপাতাল: {hsp['bed_demand']} শয্যা দরকার, ধারণক্ষমতা {hsp['illustrative_capacity']} (দৃষ্টান্তমূলক); {_transfers(b, True)}; "
            f"শয্যাহীন {hsp['without_bed']}",
            f"স্প্রে দল: {c['assigned']}; অনুমান: ২-৪ সপ্তাহে {n1(c['prevented_window'])} কম রোগী (ধরে নেওয়া প্রভাব)",
            f"মনোযোগ প্রয়োজন: {'হ্যাঁ' if crit else 'নেই'}",
            f"রেফ {b['scenario']['id']}। পরিকল্পনার অনুমান, আদেশ নয়।"])
    return "\n".join([
        "DengueShield plan (forecast, not an outbreak report)",
        f"{w['ward_id']}, {w['city']}: week of {fmt_date(f['target_week'])} ({f['horizon_weeks']}-wk forecast of {fmt_date(f['origin'])})",
        f"Cases {f['planned_cases']} planned, risk {w['risk_tier']}",
        f"Alloc/need: saline {r['saline']['allocated']}/{r['saline']['required']}, kits {r['kits']['allocated']}/{r['kits']['required']}, "
        f"beds {r['beds']['allocated']}/{r['beds']['required']}",
        f"Hospital: {hsp['bed_demand']} beds needed, {hsp['illustrative_capacity']} illustrative; {_transfers(b)}; {hsp['without_bed']} without bed",
        f"Crews {c['assigned']}; scenario -{n1(c['prevented_window'])} cases wks 2-4 (assumed effect)",
        f"Attention: {crit or 'none'}" + (f" (plan status {w['plan_status']})" if w["plan_status"] != "met" else ""),
        f"Ref {b['scenario']['id']}. Planning estimate, synthetic data, not an order."])


def whatsapp(b: dict, lang: str = "en") -> str:
    f, r, hsp, c, w = b["forecast"], b["resources"], b["hospital"], b["crews"], b["ward"]
    if lang == "bn":
        lines = ["*ডেঙ্গুশিল্ড পরিকল্পনা নোটিশ*", "_পূর্বাভাসভিত্তিক পরিকল্পনা। প্রাদুর্ভাবের প্রতিবেদন বা সরকারি আদেশ নয়।_", "",
                 f"*{w['ward_id']}, {w['city']}*", f"লক্ষ্য সপ্তাহ {f['target_week']}; {f['horizon_weeks']} সপ্তাহের পূর্বাভাস, প্রকাশ {f['origin']}",
                 f"ঝুঁকি: *{BN[w['risk_tier']]}*; প্রত্যাশিত রোগী {n1(f['expected_cases'])}, পরিকল্পনায় {f['planned_cases']}", "",
                 "*সরবরাহ* (বরাদ্দ / প্রয়োজন)", f"স্যালাইন: {r['saline']['allocated']} / {r['saline']['required']}",
                 f"পরীক্ষার কিট: {r['kits']['allocated']} / {r['kits']['required']}", f"শয্যা (আঞ্চলিক মজুত): {r['beds']['allocated']} / {r['beds']['required']}", "",
                 "*হাসপাতাল* (দৃষ্টান্তমূলক ধারণক্ষমতা)", f"শয্যার চাহিদা {hsp['bed_demand']}, ধারণক্ষমতা {hsp['illustrative_capacity']}",
                 f"{_transfers(b, True)}; শয্যাহীন {hsp['without_bed']}", "",
                 f"*স্প্রে দল*: {c['assigned']} নিয়োজিত", f"দৃশ্যকল্প অনুমান: ২-৪ সপ্তাহে প্রায় {n1(c['prevented_window'])} কম রোগী "
                 f"({n1(c['prevented_window_low'])}-{n1(c['prevented_window_high'])}), ধরে নেওয়া প্রভাবে", "",
                 "*মনোযোগ প্রয়োজন*", *([f"- {x['text']}" for x in b["attention"]] or ["- নেই"]), "",
                 f"রেফ {b['scenario']['id']}; মডেল {b['model']['name']}"]
        return "\n".join(lines)
    lines = ["*DengueShield planning notice*", "_Forecast-based plan for officers. Not an outbreak report and not an official order._", "",
             f"*{w['ward_id']}, {w['city']}*", f"Week of {fmt_date(f['target_week'])}; {f['horizon_weeks']}-week forecast issued {fmt_date(f['origin'])}",
             f"Risk: *{w['risk_tier']}* (outbreak chance {round(w['outbreak_probability'] * 100)}%)",
             f"Projected cases: {f['planned_cases']} at the {f['service_label']} (expected {n1(f['expected_cases'])})", "",
             "*Supplies* (allocated / needed)", f"Saline bags: {r['saline']['allocated']} / {r['saline']['required']}",
             f"Diagnostic kits: {r['kits']['allocated']} / {r['kits']['required']}",
             f"Beds, regional stock: {r['beds']['allocated']} / {r['beds']['required']}", "",
             "*Hospital* (illustrative capacity)", f"Bed demand {hsp['bed_demand']}, capacity {hsp['illustrative_capacity']}",
             f"{_transfers(b).capitalize()}; {hsp['without_bed']} without a bed in {w['city']}", "",
             f"*Spraying crews*: {c['assigned']} assigned ({c['deployment_label']})",
             f"Scenario estimate: about {n1(c['prevented_window'])} fewer cases over weeks 2-4 (range {n1(c['prevented_window_low'])} to "
             f"{n1(c['prevented_window_high'])}), under the assumed effect", "",
             "*Needs attention*", *([f"- {x['text']}" for x in b["attention"]] or ["- Nothing flagged"]), "",
             f"Ref {b['scenario']['id']}; model {b['model']['name']}; data through {fmt_date(b['model']['data_through'])}"]
    return "\n".join(lines)


# ------------------------------------------------------------------ HTML
_CSS = """
:root{--ink:#1a1438;--ink2:#3d3566;--ink3:#5e567f;--violet:#4a2bd0;--line:#e3d9c8;--bad:#8f1d25;--badbg:#ffe9ea;--ok:#0b5d44}
*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:var(--ink);font:14px/1.45 "Atkinson Hyperlegible","Segoe UI",system-ui,
-apple-system,"Noto Sans Bengali","Nirmala UI","Bangla Sangam MN",sans-serif}
.page{max-width:820px;margin:24px auto;background:#fff;border:2px solid var(--ink);border-radius:18px;overflow:hidden}
.band{background:var(--violet);color:#fff;padding:22px 28px}.band h1{margin:0;font-size:22px}.band p{margin:6px 0 0;opacity:.9}
.body{padding:18px 28px 24px}h2{font-size:15px;margin:20px 0 8px;padding-bottom:4px;border-bottom:1.5px solid var(--line)}
.notice{background:#fff7e0;border:1.5px solid #e0b84a;border-radius:10px;padding:8px 12px;font-size:13px}
.grid{display:grid;grid-template-columns:200px 1fr;gap:4px 14px;font-size:13.5px}.grid dt{color:var(--ink3);font-weight:600}.grid dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--ink3);font-weight:600;border-bottom:1.5px solid var(--line);padding:5px 6px}
td{padding:5px 6px;border-bottom:1px solid #efe9dc}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.bad{color:var(--bad);font-weight:700}.tag{display:inline-block;border-radius:99px;padding:1px 8px;font-size:12px;font-weight:700;background:#efe7ff;color:#3a1fa8}
.tag.Critical,.tag.critical{background:var(--badbg);color:var(--bad)}.tag.High{background:#fff0dc;color:#7a3f00}
ul{margin:4px 0;padding-left:20px}.attn li{color:var(--bad)}.foot{color:var(--ink3);font-size:11.5px;margin-top:18px;border-top:1px solid var(--line);padding-top:8px}
@media print{body{background:#fff}.page{margin:0;border:0;border-radius:0;max-width:none;break-after:page}@page{size:A4;margin:12mm}}
@media (max-width:560px){.grid{grid-template-columns:1fr}.band,.body{padding-left:16px;padding-right:16px}}
"""

_L = {"en": {"title": "Ward dispatch brief", "notice": "Planning estimate from a forecast. Not an outbreak report, not an official order, and not sent to anyone.",
             "forecast": "Forecast", "supplies": "Supplies under the stock scenario", "hospital": "Hospital (illustrative capacity)",
             "crews": "Spraying crews and vector-control scenario", "attention": "Needs attention", "assume": "Assumptions",
             "prov": "Where each number comes from", "nothing": "Nothing flagged"},
      "bn": {"title": "ওয়ার্ড ডিসপ্যাচ ব্রিফ", "notice": "পূর্বাভাসভিত্তিক পরিকল্পনার অনুমান। প্রাদুর্ভাবের প্রতিবেদন নয়, সরকারি আদেশ নয়, এবং কাউকে পাঠানো হয়নি।",
             "forecast": "পূর্বাভাস", "supplies": "মজুত দৃশ্যকল্পে সরবরাহ", "hospital": "হাসপাতাল (দৃষ্টান্তমূলক ধারণক্ষমতা)",
             "crews": "স্প্রে দল ও মশা নিয়ন্ত্রণ দৃশ্যকল্প", "attention": "মনোযোগ প্রয়োজন", "assume": "অনুমানসমূহ",
             "prov": "প্রতিটি সংখ্যার উৎস", "nothing": "কিছু চিহ্নিত নয়"}}


def _e(x) -> str:
    return html.escape(str(x))


def _ward_section(b: dict, lang: str) -> str:
    L, f, r, hsp, c, w = _L[lang], b["forecast"], b["resources"], b["hospital"], b["crews"], b["ward"]
    tr = "".join(f"<li>{_e(x['patients'])} patient(s) to {_e(x['to_ward'])}</li>" for x in hsp["transfers_out"]) + \
         "".join(f"<li>{_e(x['patients'])} patient(s) from {_e(x['from_ward'])}</li>" for x in hsp["transfers_in"])
    res_rows = "".join(f"<tr><td>{_e(label)}</td><td class=n>{r[short]['required']}</td><td class=n>{r[short]['allocated']}</td>"
                       f"<td class='n{' bad' if r[short]['short'] else ''}'>{r[short]['short']}</td></tr>" for _, short, label in RES)
    attn = "".join(f"<li>{_e(x['text'])}</li>" for x in b["attention"]) or f"<li style='color:#0b5d44'>{_e(L['nothing'])}</li>"
    return f"""<section class=page data-ward="{_e(w['ward_id'])}">
<div class=band><h1>{_e(L['title'])}: {_e(w['ward_id'])}, {_e(w['city'])}</h1>
<p>Week of {_e(fmt_date(f['target_week']))}, {f['horizon_weeks']}-week forecast issued {_e(fmt_date(f['origin']))}. Scenario {_e(b['scenario']['id'])}</p></div>
<div class=body><p class=notice>{_e(L['notice'])}</p>
<h2>{_e(L['forecast'])}</h2><dl class=grid>
<dt>Risk tier</dt><dd><span class="tag {_e(w['risk_tier'])}">{_e(w['risk_tier'])}</span> outbreak chance {round(w['outbreak_probability'] * 100)}%, priority rank {w['priority_rank']}</dd>
<dt>Projected cases</dt><dd>{f['planned_cases']} at the {_e(f['service_label'])} (expected {n1(f['expected_cases'])}; median {f['median_cases']}, 80% upper {f['upper_80']}, 90% upper {f['upper_90']})</dd>
<dt>Forecast source</dt><dd>{_e(f['source_label'])}</dd></dl>
<h2>{_e(L['supplies'])}</h2><table><tr><th>Resource</th><th class=n>Required</th><th class=n>Allocated</th><th class=n>Short</th></tr>{res_rows}</table>
<h2>{_e(L['hospital'])}</h2><dl class=grid>
<dt>Bed demand</dt><dd>{hsp['bed_demand']} beds at the target week</dd>
<dt>Illustrative capacity</dt><dd>{hsp['illustrative_capacity']} beds{' (typed value)' if hsp['capacity_typed'] else f" (baseline {hsp['capacity_baseline']})"}</dd>
<dt>Over capacity / spare</dt><dd>{hsp['over_capacity']} over, {hsp['spare_beds']} spare</dd>
<dt>Planned transfers</dt><dd>{f'<ul>{tr}</ul>' if tr else 'none'}</dd>
<dt>Without a bed in {_e(w['city'])}</dt><dd class="{'bad' if hsp['without_bed'] else ''}">{hsp['without_bed']}</dd></dl>
<h2>{_e(L['crews'])}</h2><dl class=grid>
<dt>Crews assigned</dt><dd>{c['assigned']} ({_e(c['deployment_label'])}); the supply-plan rule asks for {c['supply_plan_need']}</dd>
<dt>Scenario estimate</dt><dd>About {n1(c['prevented_window'])} fewer cases over weeks {c['weeks'][0]}-{c['weeks'][-1]} (range {n1(c['prevented_window_low'])} to {n1(c['prevented_window_high'])});
at the target week {n1(c['expected_cases_at_target'])} expected cases become {n1(c['scenario_cases_at_target'])}. Assumed effect, not a measured outcome.</dd></dl>
<h2>{_e(L['attention'])}</h2><ul class=attn>{attn}</ul>
<h2>{_e(L['assume'])}</h2><ul>{''.join(f'<li>{_e(x)}</li>' for x in b['assumptions'])}</ul>
<h2>{_e(L['prov'])}</h2><dl class=grid>
<dt>Measured data</dt><dd>{_e(b['provenance']['measured'])}</dd><dt>Forecast</dt><dd>{_e(b['provenance']['forecast'])}</dd>
<dt>Assumptions</dt><dd>{_e(b['provenance']['assumptions'])}</dd><dt>Simulated</dt><dd>{_e(b['provenance']['simulated'])}</dd></dl>
<p class=foot>Scenario {_e(b['scenario']['id'])}; content SHA-256 {_e(b['content_sha256'][:16])}; model {_e(b['model']['name'])}, bundle {_e(b['model']['bundle_sha256'])},
replay {_e(b['model']['replay_sha256'])}; data through {_e(fmt_date(b['model']['data_through']))}. {_e(b['disclaimer'])}</p></div></section>"""


def html_doc(briefs: list[dict], lang: str = "en", title: str | None = None) -> str:
    t = title or f"DengueShield dispatch brief {briefs[0]['ward']['ward_id']} {briefs[0]['scenario']['id']}"
    body = "\n".join(_ward_section(b, lang) for b in briefs)
    return f"<!doctype html>\n<html lang={lang}><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" \
           f"<title>{_e(t)}</title><style>{_CSS}</style></head><body>\n{body}\n</body></html>\n"


def city_html(s: dict) -> str:
    rows = "".join(
        f"<tr><td class=n>{w['rank']}</td><td>{_e(w['ward_id'])}</td><td><span class='tag {_e(w['risk_tier'])}'>{_e(w['risk_tier'])}</span></td>"
        f"<td class=n>{w['planned_cases']}</td><td class=n>{w['saline'][0]}/{w['saline'][1]}</td><td class=n>{w['kits'][0]}/{w['kits'][1]}</td>"
        f"<td class=n>{w['beds'][0]}/{w['beds'][1]}</td><td class=n>{w['bed_demand']}/{w['capacity']}</td><td class=n>{w['sent'] or ''}{'+' + str(w['received']) if w['received'] else ''}</td>"
        f"<td class='n{' bad' if w['without_bed'] else ''}'>{w['without_bed']}</td><td class=n>{w['crews']}</td><td><span class='tag {_e(w['status'])}'>{_e(w['status'])}</span></td></tr>"
        for w in s["wards"])
    t, f = s["totals"], s["forecast"]
    return f"""<!doctype html>
<html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>DengueShield city summary {_e(s['city'])} {_e(s['scenario']['id'])}</title><style>{_CSS}</style></head><body>
<section class=page><div class=band><h1>City summary: {_e(s['city'])}</h1><p>Week of {_e(fmt_date(f['target_week']))}, {f['horizon_weeks']}-week forecast issued {_e(fmt_date(f['origin']))} at the {_e(f['service_label'])}. Scenario {_e(s['scenario']['id'])}</p></div>
<div class=body><p class=notice>Planning estimate from a forecast. Not an outbreak report, not an official order, and not sent to anyone.</p>
<h2>City totals</h2><dl class=grid>
<dt>Saline bags</dt><dd>{t['saline']['allocated']} allocated of {t['saline']['required']} required ({t['saline']['short']} short)</dd>
<dt>Diagnostic kits</dt><dd>{t['kits']['allocated']} of {t['kits']['required']} ({t['kits']['short']} short)</dd>
<dt>Beds, regional stock</dt><dd>{t['beds']['allocated']} of {t['beds']['required']} ({t['beds']['short']} short)</dd>
<dt>Hospital</dt><dd>{t['hospital']['bed_demand']} beds needed, {t['hospital']['illustrative_capacity']} illustrative capacity, {t['hospital']['transferred']} transferred, <span class="{'bad' if t['hospital']['without_bed'] else ''}">{t['hospital']['without_bed']} without a bed</span></dd>
<dt>Spraying crews</dt><dd>{t['crews_assigned']} in {_e(s['city'])} (shared budget {t['crews_total_in_view']})</dd>
<dt>Critical wards</dt><dd>{t['critical_wards']} of {t['wards']}</dd></dl>
<h2>Wards by priority</h2><table><tr><th class=n>#</th><th>Ward</th><th>Risk</th><th class=n>Cases</th><th class=n>Saline</th><th class=n>Kits</th><th class=n>Beds</th><th class=n>Bed need/cap</th><th class=n>Sent/recv</th><th class=n>No bed</th><th class=n>Crews</th><th>Plan</th></tr>{rows}</table>
<p style='font-size:12px;color:#5e567f'>Supplies are allocated/required. Beds column is the regional stock; bed need/cap compares demand with illustrative ward capacity.</p>
<h2>Assumptions</h2><ul>{''.join(f'<li>{_e(x)}</li>' for x in s['assumptions'])}</ul>
<p class=foot>Scenario {_e(s['scenario']['id'])}; content SHA-256 {_e(s['content_sha256'][:16])}; model {_e(s['model']['name'])}; data through {_e(fmt_date(s['model']['data_through']))}. {_e(s['disclaimer'])}</p></div></section></body></html>
"""


# ------------------------------------------------------------------ PDF (English; the standard PDF fonts have no Bengali glyphs)
def _pdf_ward(flow: pdfmini.Flow, b: dict, first: bool):
    if not first:
        flow.new_page()
    f, r, hsp, c, w = b["forecast"], b["resources"], b["hospital"], b["crews"], b["ward"]
    flow.band(f"Ward dispatch brief: {w['ward_id']}, {w['city']}",
              f"Week of {fmt_date(f['target_week'])}, {f['horizon_weeks']}-week forecast issued {fmt_date(f['origin'])}. Scenario {b['scenario']['id']}")
    flow.para("Planning estimate from a forecast. Not an outbreak report, not an official order, and not sent to anyone.", 9, True, (0.48, 0.25, 0.0))
    flow.heading("Forecast")
    flow.kv([("Risk tier", f"{w['risk_tier']}, outbreak chance {round(w['outbreak_probability'] * 100)}%, priority rank {w['priority_rank']}"),
             ("Projected cases", f"{f['planned_cases']} at the {f['service_label']} (expected {n1(f['expected_cases'])}; median {f['median_cases']}, "
                                 f"80% upper {f['upper_80']}, 90% upper {f['upper_90']})"),
             ("Forecast source", f["source_label"])])
    flow.heading("Supplies under the stock scenario")
    flow.table(["Resource", "Required", "Allocated", "Short"], [[label, str(r[s]["required"]), str(r[s]["allocated"]), str(r[s]["short"])] for _, s, label in RES],
               [240, 90, 90, 87], right={1, 2, 3}, mark=lambda row: row[3] != "0")
    flow.heading("Hospital (illustrative capacity)")
    tr = [f"{x['patients']} to {x['to_ward']}" for x in hsp["transfers_out"]] + [f"{x['patients']} from {x['from_ward']}" for x in hsp["transfers_in"]]
    flow.kv([("Bed demand", f"{hsp['bed_demand']} beds at the target week"),
             ("Illustrative capacity", f"{hsp['illustrative_capacity']} beds" + (" (typed value)" if hsp["capacity_typed"] else f" (baseline {hsp['capacity_baseline']})")),
             ("Over capacity / spare", f"{hsp['over_capacity']} over, {hsp['spare_beds']} spare"),
             ("Planned transfers", ", ".join(tr) or "none"), (f"Without a bed in {w['city']}", str(hsp["without_bed"]))])
    flow.heading("Spraying crews and vector-control scenario")
    flow.kv([("Crews assigned", f"{c['assigned']} ({c['deployment_label']}); the supply-plan rule asks for {c['supply_plan_need']}"),
             ("Scenario estimate", f"About {n1(c['prevented_window'])} fewer cases over weeks {c['weeks'][0]}-{c['weeks'][-1]} (range {n1(c['prevented_window_low'])} "
                                   f"to {n1(c['prevented_window_high'])}); at the target week {n1(c['expected_cases_at_target'])} expected cases become "
                                   f"{n1(c['scenario_cases_at_target'])}. Assumed effect, not a measured outcome.")])
    flow.heading("Needs attention")
    for x in [a["text"] for a in b["attention"]] or ["Nothing flagged"]:
        flow.para("- " + x, 9, False, (0.56, 0.11, 0.15) if b["attention"] else (0.04, 0.36, 0.27))
    flow.heading("Assumptions")
    for x in b["assumptions"]:
        flow.para("- " + x, 8.5)
    flow.heading("Where each number comes from")
    flow.kv([("Measured data", b["provenance"]["measured"]), ("Forecast", b["provenance"]["forecast"]),
             ("Assumptions", b["provenance"]["assumptions"]), ("Simulated", b["provenance"]["simulated"])], 8.5, 110)
    flow.para(f"Content SHA-256 {b['content_sha256'][:16]}; model {b['model']['name']}, bundle {b['model']['bundle_sha256']}, replay "
              f"{b['model']['replay_sha256']}; data through {fmt_date(b['model']['data_through'])}.", 7.5, rgb=(0.37, 0.34, 0.50))


def pdf_briefs(briefs: list[dict]) -> bytes:
    sid = briefs[0]["scenario"]["id"]
    doc = pdfmini.Document(f"DengueShield dispatch briefs {sid}")
    flow = pdfmini.Flow(doc, f"DengueShield dispatch, scenario {sid}. Planning estimate on synthetic data; not an order; nothing sent.")
    for i, b in enumerate(briefs):
        _pdf_ward(flow, b, i == 0)
    return doc.render()


def pdf_city(s: dict) -> bytes:
    doc = pdfmini.Document(f"DengueShield city summary {s['city']} {s['scenario']['id']}")
    flow = pdfmini.Flow(doc, f"DengueShield city summary, scenario {s['scenario']['id']}. Planning estimate on synthetic data; not an order.")
    f, t = s["forecast"], s["totals"]
    flow.band(f"City summary: {s['city']}", f"Week of {fmt_date(f['target_week'])}, {f['horizon_weeks']}-week forecast issued {fmt_date(f['origin'])}. "
                                            f"Scenario {s['scenario']['id']}")
    flow.para("Planning estimate from a forecast. Not an outbreak report, not an official order, and not sent to anyone.", 9, True, (0.48, 0.25, 0.0))
    flow.heading("City totals")
    flow.kv([("Saline bags", f"{t['saline']['allocated']} allocated of {t['saline']['required']} ({t['saline']['short']} short)"),
             ("Diagnostic kits", f"{t['kits']['allocated']} of {t['kits']['required']} ({t['kits']['short']} short)"),
             ("Beds, regional stock", f"{t['beds']['allocated']} of {t['beds']['required']} ({t['beds']['short']} short)"),
             ("Hospital", f"{t['hospital']['bed_demand']} beds needed, {t['hospital']['illustrative_capacity']} illustrative, "
                          f"{t['hospital']['transferred']} transferred, {t['hospital']['without_bed']} without a bed"),
             ("Spraying crews", f"{t['crews_assigned']} in {s['city']} (shared budget {t['crews_total_in_view']})"),
             ("Critical wards", f"{t['critical_wards']} of {t['wards']}")])
    flow.heading("Wards by priority")
    flow.table(["#", "Ward", "Risk", "Cases", "Saline", "Kits", "Beds", "Need/cap", "No bed", "Crews", "Plan"],
               [[str(w["rank"]), w["ward_id"], w["risk_tier"], str(w["planned_cases"]), f"{w['saline'][0]}/{w['saline'][1]}", f"{w['kits'][0]}/{w['kits'][1]}",
                 f"{w['beds'][0]}/{w['beds'][1]}", f"{w['bed_demand']}/{w['capacity']}", str(w["without_bed"]), str(w["crews"]), w["status"]] for w in s["wards"]],
               [24, 84, 50, 36, 50, 44, 40, 50, 40, 36, 53], 8, right={0, 3, 4, 5, 6, 7, 8, 9}, mark=lambda row: row[10] == "critical")
    flow.heading("Assumptions")
    for x in s["assumptions"]:
        flow.para("- " + x, 8.5)
    return doc.render()
