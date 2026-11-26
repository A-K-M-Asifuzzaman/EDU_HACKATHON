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
export type ApiErrorKind = "network" | "timeout" | "server" | "client" | "parse";
export class ApiError extends Error {
  status: number; kind: ApiErrorKind;
  constructor(msg: string, status: number, kind?: ApiErrorKind) {
    super(msg); this.status = status;
    this.kind = kind ?? (status === 0 ? "network" : status >= 500 ? "server" : status >= 400 ? "client" : "parse");
  }
}
/** Errors worth retrying automatically: the network, a timeout or a 5xx. A 4xx (bad request) never is. */
export const retryable = (e: unknown) => e instanceof ApiError && (e.kind === "network" || e.kind === "timeout" || e.kind === "server");

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
const mem = new Map<string, { t: number; v: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
/** Default per-request time budget. Measured: local and warm hosted responses take well under 1 s; a cold hosted start can take tens of seconds. */
export const DEFAULT_TIMEOUT_MS = 20_000;

// Service-health signal for the shell: every request reports its real outcome and duration (no polling).
export type ApiEvent = { path: string; ok: boolean; ms: number; kind?: ApiErrorKind; phase: "start" | "end" };
const emit = (e: ApiEvent) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ApiEvent>("ds:api", { detail: e })); };
const abortError = () => (typeof DOMException !== "undefined" ? new DOMException("Aborted", "AbortError") : Object.assign(new Error("Aborted"), { name: "AbortError" }));

async function fetchJson(path: string, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  const t0 = Date.now();
  emit({ path, ok: true, ms: 0, phase: "start" });
  try {
    let r: Response;
    try { r = await fetch(BASE + path, { signal: ac.signal }); }
    catch { throw timedOut ? new ApiError(`No response within ${Math.round(timeoutMs / 1000)} s.`, 0, "timeout") : new ApiError("Cannot reach the DengueShield service.", 0, "network"); }
    let body: any = null;
    try { body = await r.json(); }
    catch { if (timedOut) throw new ApiError(`No response within ${Math.round(timeoutMs / 1000)} s.`, 0, "timeout"); body = null; }   // a cut-off read is never a valid (empty) response
    if (!r.ok) {
      const d = body?.detail ?? body?.error;
      throw new ApiError(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join("; ") : `Request failed (${r.status})`, r.status);
    }
    if (body === null || typeof body !== "object") throw new ApiError("The server returned an unreadable response.", r.status, "parse");
    mem.set(path, { t: Date.now(), v: body });
    emit({ path, ok: true, ms: Date.now() - t0, phase: "end" });
    return body;
  } catch (e: any) {
    emit({ path, ok: false, ms: Date.now() - t0, kind: e?.kind, phase: "end" });
    throw e;
  } finally { clearTimeout(timer); }
}

/** GET JSON. Identical requests in flight share one network call; each caller can still cancel its own wait with `signal`. */
export async function api<T = any>(path: string, opts: { ttl?: number; signal?: AbortSignal; timeout?: number } = {}): Promise<T> {
  const ttl = opts.ttl ?? 30_000;
  const hit = mem.get(path);
  if (hit && Date.now() - hit.t < ttl) return hit.v as T;
  let p = inflight.get(path);
  if (!p) {
    p = fetchJson(path, opts.timeout ?? DEFAULT_TIMEOUT_MS).finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  const sig = opts.signal;
  if (!sig) return p as Promise<T>;
  if (sig.aborted) throw abortError();
  return new Promise<T>((res, rej) => {
    const on = () => rej(abortError());
    sig.addEventListener("abort", on, { once: true });
    (p as Promise<T>).then(res, rej).finally(() => sig.removeEventListener("abort", on));
  });
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

// ISO helpers (weekly Monday grid)
export const addWeeks = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };
export const isoMonday = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
export const isMonday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay() === 1;

export const TIER_COLOR: Record<Tier, string> = { Low: "#3ccb91", Medium: "#ffd34d", High: "#ff8a3d", Critical: "#f2475e" };   // DESIGN.md §2 risk tiers (MicroFire v2)
export const TIERS: Tier[] = ["Low", "Medium", "High", "Critical"];
/** Text colour that keeps WCAG AA contrast on each tier colour (white on the Medium amber was 2.2:1). */
export const TIER_TEXT: Record<Tier, string> = { Low: "#15153d", Medium: "#15153d", High: "#15153d", Critical: "#15153d" };
