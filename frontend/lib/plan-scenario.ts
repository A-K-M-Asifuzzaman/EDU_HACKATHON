import { isMonday, type Ward } from "./api";
import { DEFAULT, type Selection } from "./ctx";

export const CITIES = ["Dhaka North", "Dhaka South", "Chattogram", "Gazipur", "Narayanganj"];
export const SCENARIO_VERSION = 1;
export type Service = "median" | "p80" | "p90";
type CrewMode = "optimized" | "manual" | "stage1";

export type PlanSettings = {
  service: Service;
  stock: number;
  crews: number;
  maxCrews: number;
  risk: number;
  floor: number;
  perCrew: number;
  capPct: number;
  overrides: Record<string, number>;
  vecMode: CrewMode;
  manual: Record<string, number>;
  eff: { effect: number; coverage: number; delay: number; buildup: number; sensLow: number; sensHigh: number };
};

export const DEFAULT_PLAN: PlanSettings = {
  service: "p80", stock: 60, crews: 20, maxCrews: 3, risk: 70, floor: 25, perCrew: 10, capPct: 100,
  overrides: {}, vecMode: "optimized", manual: {}, eff: { effect: 30, coverage: 35, delay: 1, buildup: 2, sensLow: 50, sensHigh: 150 },
};

export function wardInScope(wards: Ward[], city: string, preferred: string): string {
  const scope = city === "All" ? wards : wards.filter(w => w.city === city);
  return scope.find(w => w.ward_id === preferred)?.ward_id ?? scope[0]?.ward_id ?? DEFAULT.ward;
}

export function planParams(sel: Selection, p: PlanSettings): URLSearchParams {
  const base = new URLSearchParams({
    origin: sel.origin, horizon: String(sel.horizon), service: p.service,
    stock: String(p.stock / 100), crews: String(p.crews), max_crews_per_ward: String(p.maxCrews),
    risk_weight: String(p.risk / 100), floor: String(p.floor / 100), cases_per_crew: String(p.perCrew),
    capacity_pct: String(p.capPct), mode: p.vecMode, effect: String(p.eff.effect / 100),
    coverage: String(p.eff.coverage / 100), delay: String(p.eff.delay), buildup: String(p.eff.buildup),
    sens_low: String(p.eff.sensLow / 100), sens_high: String(p.eff.sensHigh / 100),
  });
  if (sel.city !== "All") base.set("city", sel.city);
  if (sel.source !== "auto") base.set("source", sel.source);
  for (const k of Object.keys(p.overrides).sort()) base.append("override", `${k}:${p.overrides[k]}`);
  if (p.vecMode === "manual") {
    for (const k of Object.keys(p.manual).sort()) if (p.manual[k] > 0) base.append("assign", `${k}:${p.manual[k]}`);
  }
  return base;
}

const PARAMS = new Set([...planParams(DEFAULT, DEFAULT_PLAN).keys(), "ward", "scenario_v", "city", "source", "override", "assign"]);

export function scenarioSearch(sel: Selection, p: PlanSettings, current: URLSearchParams) {
  const merged = planParams(sel, p);
  merged.set("ward", sel.ward);
  merged.set("scenario_v", String(SCENARIO_VERSION));
  current.forEach((v, k) => { if (!PARAMS.has(k)) merged.append(k, v); });
  return merged.toString();
}

export function readScenario(q: URLSearchParams, wards: Ward[], fallback: Selection) {
  const cityValue = q.get("city");
  const city = cityValue && CITIES.includes(cityValue) ? cityValue : "All";
  const source = q.get("source");
  const origin = q.get("origin") ?? "";
  const horizon = Number(q.get("horizon"));
  const linked = ["scenario_v", "ward", "origin", "horizon", "city", "source"].some(k => q.has(k));
  const sel: Selection = linked ? {
    city, ward: wardInScope(wards, city, q.get("ward") ?? DEFAULT.ward),
    origin: /^\d{4}-\d{2}-\d{2}$/.test(origin) && isMonday(origin) ? origin : DEFAULT.origin,
    horizon: [2, 3, 4].includes(horizon) ? horizon : DEFAULT.horizon,
    source: source === "replay" || source === "bundle" ? source : "auto",
  } : fallback;
  const version = q.get("scenario_v");
  if (version !== null && version !== String(SCENARIO_VERSION)) return { sel, plan: DEFAULT_PLAN, unsupported: true };
  const integer = (key: string, min: number, max: number, defaultValue: number, scale = 1) => {
    const raw = q.get(key);
    if (!raw?.trim()) return defaultValue;
    const scaled = Number(raw) * scale;
    const value = Math.round(scaled);
    return Math.abs(scaled - value) < 0.00001 && value >= min && value <= max ? value : defaultValue;
  };
  const records = (key: string, min: number, max: number, scope = wards) => Object.fromEntries(q.getAll(key).flatMap(entry => {
    const [ward, raw, extra] = entry.split(":");
    const value = Number(raw);
    return extra === undefined && raw && /^(0|[1-9]\d*)$/.test(raw) && Number.isInteger(value) && value >= min && value <= max
      && scope.some(w => w.ward_id === ward) ? [[ward, value]] : [];
  }));
  const service = q.get("service"), mode = q.get("mode");
  const maxCrews = integer("max_crews_per_ward", 1, 6, DEFAULT_PLAN.maxCrews);
  const plan: PlanSettings = {
    service: service === "median" || service === "p90" ? service : "p80",
    stock: integer("stock", 30, 100, DEFAULT_PLAN.stock, 100),
    crews: integer("crews", 0, 120, DEFAULT_PLAN.crews),
    maxCrews,
    risk: integer("risk_weight", 0, 100, DEFAULT_PLAN.risk, 100),
    floor: integer("floor", 0, 50, DEFAULT_PLAN.floor, 100),
    perCrew: integer("cases_per_crew", 1, 100, DEFAULT_PLAN.perCrew),
    capPct: integer("capacity_pct", 0, 300, DEFAULT_PLAN.capPct),
    overrides: records("override", 0, 500),
    vecMode: mode === "manual" || mode === "stage1" ? mode : "optimized",
    manual: mode === "manual" ? records("assign", 1, maxCrews, sel.city === "All" ? wards : wards.filter(w => w.city === sel.city)) : {},
    eff: {
      effect: integer("effect", 0, 80, DEFAULT_PLAN.eff.effect, 100),
      coverage: integer("coverage", 5, 100, DEFAULT_PLAN.eff.coverage, 100),
      delay: integer("delay", 0, 3, DEFAULT_PLAN.eff.delay),
      buildup: integer("buildup", 1, 3, DEFAULT_PLAN.eff.buildup),
      sensLow: integer("sens_low", 0, 100, DEFAULT_PLAN.eff.sensLow, 100),
      sensHigh: integer("sens_high", 100, 200, DEFAULT_PLAN.eff.sensHigh, 100),
    },
  };
  return { sel, plan, unsupported: false };
}
