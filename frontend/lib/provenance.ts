// Which forecast a selection resolves to, and whether it is out-of-time. Mirrors the API (src_default and forecast_frame):
// replay = each 2019-2024 season forecast by models fitted on earlier seasons only; forward = the deployed model for a target after its
// training window; in_sample = the deployed model on a week it was trained on (decision tools refuse it); none = the replay has no
// forecast because the target falls in the next season.
import { addWeeks, isoMonday } from "./api";

export type Provenance = { kind: "replay" | "forward" | "in_sample" | "none"; target: string; fix?: { origin?: string; source?: "auto" } };

export function provenance(origin: string, horizon: number, source: string, meta: any): Provenance {
  const target = addWeeks(origin, horizon);
  const cutoff: string = meta?.model?.trained_through ?? "2024-12-31";
  const repMin: string = meta?.origins?.replay?.[horizon]?.min ?? "2019-01-07";
  if (target > cutoff) return { kind: source === "replay" ? "none" : "forward", target, fix: source === "replay" ? { source: "auto" } : undefined };
  if (source === "bundle") return { kind: "in_sample", target, fix: { source: "auto" } };
  if (origin < repMin) return { kind: source === "replay" ? "none" : "in_sample", target, fix: { origin: repMin, source: "auto" } };
  if (origin.slice(0, 4) !== target.slice(0, 4)) {
    const y = origin.slice(0, 4), last = isoMonday(addWeeks(`${y}-12-31`, -horizon));   // latest origin whose target stays in the season
    return { kind: "none", target, fix: { origin: last } };
  }
  return { kind: "replay", target };
}

export const PROV_TEXT: Record<Provenance["kind"], string> = {
  replay: "Validated replay: each season forecast by models fitted on earlier seasons only.",
  forward: "Deployed model, forecasting past the end of its training data (out-of-time).",
  in_sample: "In-sample: the deployed model was trained on 2016-2024, including this target week, so this is not an out-of-time forecast. Decision tools refuse it.",
  none: "No validated replay forecast for this origin: the target week falls in the next season, and each season was replayed by models fitted on earlier seasons only.",
};
