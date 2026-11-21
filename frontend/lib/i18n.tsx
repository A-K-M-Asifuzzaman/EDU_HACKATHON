"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "en" | "bn";
const EN = {
  "nav.command": "Command Center", "nav.profiling": "Data Profiling Studio", "nav.wards": "Ward Risk Explorer", "nav.lab": "AI Forecast Lab", "nav.copilot": "Research Copilot",
  "nav.evidence": "Model Evidence", "nav.response": "Response Intelligence", "nav.climate": "Climate Observatory", "nav.provenance": "System & Provenance", "nav.learn": "Learn: Aedes & rainfall",
  "brand.tagline": "Predict Earlier. Respond Smarter.", "mode.replay": "Historical Replay", "mode.replay.desc": "Retrospective demonstration on the synthetic organizer dataset (2016–2024). Not live surveillance.",
  "ctl.city": "City", "ctl.ward": "Ward", "ctl.origin": "Forecast origin", "ctl.horizon": "Horizon", "ctl.weeks": "weeks", "ctl.source": "Forecast source", "ctl.all": "All",
  "src.replay": "Validated replay (out-of-time)", "src.bundle": "Live bundle inference", "src.replay.desc": "Predictions made by models trained only on earlier seasons, with the actual outcome shown.",
  "src.bundle.desc": "The deployed model run on demand. For origins up to 2024 it has seen those labels (in-sample).",
  "kpi.expected": "Expected cases (all wards)", "kpi.median": "Median forecast (sum)", "kpi.alerts": "Outbreak alerts", "kpi.prob": "Mean outbreak probability", "kpi.actual": "Observed cases (validation)",
  "kpi.wards": "wards", "risk.low": "Low", "risk.medium": "Medium", "risk.high": "High", "risk.critical": "Critical",
  "risk.low.desc": "Cases at or below the training 60th percentile (about 1/week).", "risk.medium.desc": "Between the 60th and 80th percentile.",
  "risk.high.desc": "Between the 80th and 95th percentile.", "risk.critical.desc": "At or above the 95th percentile (about 13+/week).",
  "risk.note": "Statistical categories from training quantiles. Not official public-health warning levels.",
  "fc.median": "Median cases", "fc.mean": "Expected cases (mean)", "fc.interval80": "80% interval", "fc.interval90": "90% interval", "fc.prob": "Outbreak probability", "fc.alert": "Outbreak alert",
  "fc.tier": "Risk tier", "fc.target": "Target week", "fc.origin": "Forecast origin", "fc.actual": "Observed", "fc.yes": "Alert", "fc.no": "No alert", "fc.in_sample": "In-sample (model saw this week's label)",
  "fc.out_of_sample": "Out-of-time", "fc.threshold": "Outbreak threshold", "fc.cases": "cases/week",
  "sec.ranking": "Ranked ward risk", "sec.distribution": "Risk distribution", "sec.fan": "Forecast with uncertainty", "sec.drivers": "What drives this forecast", "sec.weather": "Weather context",
  "sec.compare": "Forecast horizons compared", "sec.provenance": "Model and data provenance", "sec.limits": "Known limitations",
  "lim.peaks": "Peaks are under-predicted by about 3 cases on average; about 74% of high-incidence weeks are under-predicted.",
  "lim.cover": "80% intervals cover only about 61% of high-incidence weeks (85% overall). Treat intervals as optimistic at peaks.",
  "lim.synthetic": "Synthetic competition dataset. Findings reflect its generator, not real dengue epidemiology.",
  "lim.noweather": "Rainfall after the forecast origin is never used. Where it matters, a past-year climatology projection stands in, so 3–4 week forecasts are more uncertain.",
  "state.loading": "Loading…", "state.error": "Something went wrong", "state.empty": "Nothing to show for this selection.", "state.retry": "Retry", "state.offline": "API unreachable",
  "state.degraded": "Optional service unavailable; the rest of the application is unaffected.",
  "act.export": "Export CSV", "act.copy": "Copy", "act.copied": "Copied", "act.close": "Close", "act.search": "Search wards", "act.compare": "Compare", "act.clear": "Clear", "act.replay": "Replay", "act.pause": "Pause",
  "fresh.data": "Data through", "fresh.model": "Model", "fresh.convention": "Convention B: start of week", "fresh.holdout": "2025 holdout locked",
  "drv.seasonality (calendar)": "Season (calendar)", "drv.rainfall (observed + climatology)": "Rainfall (observed + climatology)", "drv.ward vulnerability": "Ward vulnerability",
  "drv.note": "Additive contributions to the log case rate from the deployed model's coefficients. Associations in a synthetic dataset; not causal.",
  "avail.title": "Which rainfall does this forecast use?", "avail.observed": "observed", "avail.projected": "projected from past-year climatology",
  "avail.key": "The model's strongest weather signal is rainfall 3 weeks before the target week.",
  "lang.switch": "বাংলা", "disc.official": "Risk tiers are statistical categories for this dataset, not official public-health warning levels.",
  "copilot.title": "DengueShield Copilot", "copilot.placeholder": "Ask about a ward, the model, the data or its limits…", "copilot.send": "Send", "copilot.sources": "Sources", "copilot.tools": "Live data used",
  "copilot.disabled": "AI generation is off", "copilot.scope": "Answers are grounded in project documents and live model tools. Not medical advice.",
  "resp.title": "Response Intelligence", "resp.generic": "Generic options for officers to review", "resp.noofficial": "These are generic, evidence-informed options. They are not official government decisions and do not specify resource quantities.",
} as const;
type Key = keyof typeof EN;
const BN: Partial<Record<Key, string>> = {
  "nav.command": "কমান্ড সেন্টার", "nav.profiling": "ডেটা প্রোফাইলিং স্টুডিও", "nav.wards": "ওয়ার্ড ঝুঁকি এক্সপ্লোরার", "nav.lab": "এআই পূর্বাভাস ল্যাব", "nav.copilot": "গবেষণা কোপাইলট",
  "nav.evidence": "মডেল প্রমাণ", "nav.response": "প্রতিক্রিয়া বুদ্ধিমত্তা", "nav.climate": "জলবায়ু পর্যবেক্ষণকেন্দ্র", "nav.provenance": "সিস্টেম ও উৎস", "nav.learn": "শিখুন: এডিস ও বৃষ্টি",
  "brand.tagline": "আগে পূর্বাভাস। দ্রুত সাড়া।", "mode.replay": "ঐতিহাসিক রিপ্লে", "mode.replay.desc": "কৃত্রিম আয়োজক ডেটাসেটে (২০১৬–২০২৪) পূর্ববর্তী সময়ের প্রদর্শন। এটি সরাসরি নজরদারি নয়।",
  "ctl.city": "শহর", "ctl.ward": "ওয়ার্ড", "ctl.origin": "পূর্বাভাসের শুরু", "ctl.horizon": "সময়সীমা", "ctl.weeks": "সপ্তাহ", "ctl.source": "পূর্বাভাসের উৎস", "ctl.all": "সব",
  "src.replay": "যাচাইকৃত রিপ্লে (সময়ক্রমে বাইরে)", "src.bundle": "সরাসরি মডেল অনুমান", "src.replay.desc": "শুধু আগের মৌসুমে প্রশিক্ষিত মডেলের পূর্বাভাস, সঙ্গে প্রকৃত ফল।",
  "src.bundle.desc": "চালু মডেল সরাসরি চালানো হয়। ২০২৪ পর্যন্ত সময়ের জন্য এটি ওই লেবেল আগেই দেখেছে (ইন-স্যাম্পল)।",
  "kpi.expected": "প্রত্যাশিত কেস (সব ওয়ার্ড)", "kpi.median": "মধ্যমা পূর্বাভাস (যোগফল)", "kpi.alerts": "প্রাদুর্ভাব সতর্কতা", "kpi.prob": "গড় প্রাদুর্ভাবের সম্ভাবনা", "kpi.actual": "পর্যবেক্ষিত কেস (যাচাই)", "kpi.wards": "ওয়ার্ড",
  "risk.low": "নিম্ন", "risk.medium": "মাঝারি", "risk.high": "উচ্চ", "risk.critical": "সংকটজনক",
  "risk.low.desc": "প্রশিক্ষণের ৬০তম পার্সেন্টাইল বা তার নিচে (সপ্তাহে প্রায় ১টি)।", "risk.medium.desc": "৬০তম ও ৮০তম পার্সেন্টাইলের মধ্যে।", "risk.high.desc": "৮০তম ও ৯৫তম পার্সেন্টাইলের মধ্যে।", "risk.critical.desc": "৯৫তম পার্সেন্টাইল বা তার ওপরে (সপ্তাহে প্রায় ১৩+)।",
  "risk.note": "প্রশিক্ষণ-কোয়ান্টাইল থেকে নেওয়া পরিসংখ্যানগত শ্রেণি। সরকারি জনস্বাস্থ্য সতর্কতা স্তর নয়।",
  "fc.median": "মধ্যমা কেস", "fc.mean": "প্রত্যাশিত কেস (গড়)", "fc.interval80": "৮০% ব্যবধি", "fc.interval90": "৯০% ব্যবধি", "fc.prob": "প্রাদুর্ভাবের সম্ভাবনা", "fc.alert": "প্রাদুর্ভাব সতর্কতা",
  "fc.tier": "ঝুঁকির স্তর", "fc.target": "লক্ষ্য সপ্তাহ", "fc.origin": "পূর্বাভাসের শুরু", "fc.actual": "পর্যবেক্ষিত", "fc.yes": "সতর্কতা", "fc.no": "সতর্কতা নেই", "fc.in_sample": "ইন-স্যাম্পল (মডেল এই সপ্তাহের লেবেল দেখেছে)",
  "fc.out_of_sample": "সময়ক্রমে বাইরে", "fc.threshold": "প্রাদুর্ভাবের সীমা", "fc.cases": "কেস/সপ্তাহ",
  "sec.ranking": "ওয়ার্ড অনুযায়ী ঝুঁকির র‍্যাঙ্ক", "sec.distribution": "ঝুঁকির বণ্টন", "sec.fan": "অনিশ্চয়তাসহ পূর্বাভাস", "sec.drivers": "পূর্বাভাসের চালিকা শক্তি", "sec.weather": "আবহাওয়ার প্রেক্ষাপট",
  "sec.compare": "সময়সীমা অনুযায়ী তুলনা", "sec.provenance": "মডেল ও ডেটার উৎস", "sec.limits": "জানা সীমাবদ্ধতা",
  "lim.peaks": "সর্বোচ্চ সংখ্যা গড়ে প্রায় ৩ কেস কম অনুমান হয়; উচ্চ-প্রাদুর্ভাব সপ্তাহের প্রায় ৭৪% কম অনুমিত।",
  "lim.cover": "৮০% ব্যবধি উচ্চ-প্রাদুর্ভাব সপ্তাহের মাত্র প্রায় ৬১% ধরে (সামগ্রিক ৮৫%)। শীর্ষে ব্যবধিকে আশাবাদী ধরুন।",
  "lim.synthetic": "কৃত্রিম প্রতিযোগিতার ডেটাসেট। ফলাফল এর জেনারেটরকে প্রতিফলিত করে, বাস্তব ডেঙ্গু মহামারিবিদ্যাকে নয়।",
  "lim.noweather": "পূর্বাভাস শুরুর পরের বৃষ্টি কখনো ব্যবহৃত হয় না। প্রয়োজনে আগের বছরের জলবায়ু-গড় দিয়ে অনুমান করা হয়, তাই ৩–৪ সপ্তাহের পূর্বাভাসে অনিশ্চয়তা বেশি।",
  "state.loading": "লোড হচ্ছে…", "state.error": "কিছু একটা ভুল হয়েছে", "state.empty": "এই নির্বাচনের জন্য দেখানোর মতো কিছু নেই।", "state.retry": "আবার চেষ্টা করুন", "state.offline": "এপিআই পাওয়া যাচ্ছে না",
  "state.degraded": "ঐচ্ছিক সেবা বন্ধ; অ্যাপ্লিকেশনের বাকি অংশ ঠিকভাবে চলছে।",
  "act.export": "CSV এক্সপোর্ট", "act.copy": "কপি", "act.copied": "কপি হয়েছে", "act.close": "বন্ধ", "act.search": "ওয়ার্ড খুঁজুন", "act.compare": "তুলনা", "act.clear": "মুছুন", "act.replay": "রিপ্লে", "act.pause": "বিরতি",
  "fresh.data": "ডেটা পর্যন্ত", "fresh.model": "মডেল", "fresh.convention": "কনভেনশন বি: সপ্তাহের শুরু", "fresh.holdout": "২০২৫ হোল্ডআউট তালাবদ্ধ",
  "drv.seasonality (calendar)": "মৌসুম (ক্যালেন্ডার)", "drv.rainfall (observed + climatology)": "বৃষ্টি (পর্যবেক্ষিত + জলবায়ু-গড়)", "drv.ward vulnerability": "ওয়ার্ডের ঝুঁকিপ্রবণতা",
  "drv.note": "চালু মডেলের সহগ থেকে লগ কেস-হারে যোগাত্মক অবদান। কৃত্রিম ডেটাসেটের সম্পর্ক; কার্যকারণ নয়।",
  "avail.title": "এই পূর্বাভাস কোন বৃষ্টি ব্যবহার করে?", "avail.observed": "পর্যবেক্ষিত", "avail.projected": "আগের বছরের জলবায়ু-গড় থেকে অনুমিত",
  "avail.key": "মডেলের সবচেয়ে শক্ত আবহাওয়া-সংকেত হলো লক্ষ্য সপ্তাহের ৩ সপ্তাহ আগের বৃষ্টি।",
  "lang.switch": "English", "disc.official": "ঝুঁকির স্তর এই ডেটাসেটের পরিসংখ্যানগত শ্রেণি, সরকারি জনস্বাস্থ্য সতর্কতা স্তর নয়।",
  "copilot.title": "ডেঙ্গুশিল্ড কোপাইলট", "copilot.placeholder": "ওয়ার্ড, মডেল, ডেটা বা সীমাবদ্ধতা নিয়ে জিজ্ঞাসা করুন…", "copilot.send": "পাঠান", "copilot.sources": "উৎস", "copilot.tools": "ব্যবহৃত সরাসরি ডেটা",
  "copilot.disabled": "এআই উত্তর বন্ধ আছে", "copilot.scope": "উত্তর প্রকল্পের নথি ও সরাসরি মডেল টুলের ওপর ভিত্তি করে। চিকিৎসা পরামর্শ নয়।",
  "resp.title": "প্রতিক্রিয়া বুদ্ধিমত্তা", "resp.generic": "কর্মকর্তাদের পর্যালোচনার জন্য সাধারণ বিকল্প", "resp.noofficial": "এগুলো সাধারণ, প্রমাণ-ভিত্তিক বিকল্প। সরকারি সিদ্ধান্ত নয় এবং সম্পদের পরিমাণ নির্দিষ্ট করে না।",
};
export type TKey = Key;

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (k: Key | string) => string }
const C = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (k) => k });
export const useI18n = () => useContext(C);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { try { const s = localStorage.getItem("ds.lang"); if (s === "bn" || s === "en") setLangState(s); } catch {} }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem("ds.lang", l); } catch {} }, []);
  const t = useCallback((k: string) => (lang === "bn" ? (BN as Record<string, string>)[k] : undefined) ?? (EN as Record<string, string>)[k] ?? k, [lang]);
  const v = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
