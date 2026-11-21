// Typed client for the DengueShield API. In production the API serves this app (same origin); in `next dev` /api is proxied.
export type Tier = "Low" | "Medium" | "High" | "Critical";
export interface Forecast {
  ward_id: string; city: string; origin_date: string; target_date: string; horizon: number;
  expected_cases: number; median_cases: number; lower_80: number; upper_80: number; lower_90: number; upper_90: number;
  p_outbreak: number; outbreak_alert: boolean; risk_tier: Tier; source: "replay" | "bundle"; in_sample: boolean;
  actual_cases: number | null; outbreak_threshold: number | null;
  vulnerability?: { population_density_sqkm: number; water_logging_risk_index: number; sanitation_score: number };
}
export interface Availability { horizon: number; key_rain_week: string; observed_at_origin: boolean; treatment: string; latest_observed_week: string }
export interface Ward { ward_id: string; city: string; population_density_sqkm: number; water_logging_risk_index: number; sanitation_score: number }
export class ApiError extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status; } }

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
const mem = new Map<string, { t: number; v: unknown }>();

export async function api<T = any>(path: string, opts: { ttl?: number; signal?: AbortSignal } = {}): Promise<T> {
  const ttl = opts.ttl ?? 30_000;
  const hit = mem.get(path);
  if (hit && Date.now() - hit.t < ttl) return hit.v as T;
  let r: Response;
  try { r = await fetch(BASE + path, { signal: opts.signal }); }
  catch (e: any) { if (e?.name === "AbortError") throw e; throw new ApiError("Cannot reach the DengueShield API. Is the backend running on port 8000?", 0); }
  let body: any = null;
  try { body = await r.json(); }
  catch (e: any) { if (e?.name === "AbortError") throw e; body = null; }              // an aborted read must never look like a valid (empty) response
  if (!r.ok) {
    const d = body?.detail ?? body?.error;
    throw new ApiError(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join("; ") : `Request failed (${r.status})`, r.status);
  }
  if (body === null || typeof body !== "object") throw new ApiError("The server returned an unreadable response.", r.status);
  mem.set(path, { t: Date.now(), v: body });
  return body as T;
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

// ISO helpers (weekly Monday grid)
export const addWeeks = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };
export const isoMonday = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
export const isMonday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay() === 1;

export const TIER_COLOR: Record<Tier, string> = { Low: "#0e8f66", Medium: "#e0a526", High: "#e8782f", Critical: "#d93a42" };
export const TIERS: Tier[] = ["Low", "Medium", "High", "Critical"];
