# E2 and E3: execution plans (prepared, NOT run)

Status, 25 Nov 2026: preparation only. The owner asked that these experiments wait until the final-round development rules **and the
evaluation protocol** are confirmed. Nothing below has been executed, and no result exists. The pre-registered objectives and success rules
in `PREREGISTRATION.md` are reproduced unchanged; anything that would differ is listed as a proposed amendment that needs the owner's approval
**before** any run.

## Shared design (identical to the Stage 3 tournament and the V3 benchmarks)

- Folds: season-level out-of-time. For season *Y*, fit on labels reported by 31 Dec *Y − 1*, evaluate rows whose origin and target are in *Y*
  (`dengueshield/models/seasons.py`). Convention B (production). Features F8 (the champion's 24) unless stated.
- Outer seasons for the decision: 2019–2024 (six). 2022–2024 were also used to select the champion, so they are not independent evidence.
  The sealed 2025 holdout is not touched; `season_fold()` refuses years after 2024.
- Anything tuned for outer season *Y* uses only seasons before *Y* (nested). With seasons starting in 2018, season 2019 has one inner season
  (2018) instead of two; this is reported, not hidden.
- Metrics from the same `seasons.score()` used for every leaderboard row, plus 80% interval coverage at peak weeks (`y ≥ training q90`).
- Champion reference: ridge Poisson GLM, F8, convention B (`glm_poisson`), from the same cells.

## E2: peak-aware training (pre-registered, unchanged)

**Pre-registered specification:** ridge-penalised NB2 GLM with peak weighting: observation weight 1 + λ for training rows with
y ≥ training q80; λ ∈ {0, 0.5, 1, 2} chosen on seasons *Y − 2*, *Y − 1*.

**Pre-registered success rule (from the audit):** a gain of ≥ 0.05 MAE **or** ≥ 5 points of peak 80% coverage in ≥ 5 of 6 outer seasons
(2019–2024), with MAE not worse by more than 0.02. Otherwise the champion stays.

**Proposed amendment (needs approval; would run as a separately labelled E2b, never replacing E2):** test the same peak weighting on the
deployed ridge **Poisson** GLM as well. Reason, recorded in `RESULTS.md` before any run: under a ridge, NB2 mean estimates down-weight high
counts (IRLS weights μ / (1 + αμ)), which works against the peak goal. E2 as registered is still run and reported first.

**Procedure:**
1. For every season *Y* in 2018–2024 and horizon 2–4: fit the weighted model for each λ on the season's training rows and predict *Y*.
   Save every prediction block (as the tournament cache does).
2. For each outer *Y* in 2019–2024: choose λ by mean MAE over *Y − 2*, *Y − 1* (2019: 2018 only) and take that λ's predictions for *Y*.
3. Score with `seasons.score()`; intervals from the model's own NB predictive distribution; compare with the champion's cells.
4. Apply the rule per outer season; report all six seasons, all λ, and the chosen λ per season.

**Leakage checks:** q80 computed on each fit's training labels only (assert the threshold changes by fold); λ selection reads no outcome
from *Y* or later (unit test that perturbs *Y*+ outcomes and checks the chosen λ, as in `tests/test_e1_intervals.py`);
`season_fold()` blocks 2025.

**Compute:** 7 seasons × 3 horizons × 4 λ = 84 GLM fits (about 0.4–2 s each; NB IRLS slower), so under 5 minutes on this laptop.

## E3: projected rainfall for 3–4 week forecasts (pre-registered, unchanged)

**Pre-registered specification:** conditional projection of the unobserved rainfall weeks for h = 3–4 (AR(2) on weekly rain anomalies
fitted on training years) instead of past-year climatology; first an oracle-rain bound.

**Success rule:** as E2 (≥ 0.05 MAE or ≥ 5 points of peak coverage in ≥ 5 of 6 outer seasons; MAE not worse by more than 0.02).

**Procedure:**
1. **Oracle bound (diagnostic only, never a candidate):** replace the projected rain weeks with the rain that actually fell, refit
   the champion specification per season and score. This states the largest gain any rain projection could give; if it is below the 0.05
   bar, E3 stops there.
2. **AR(2) projection:** per season, fit AR(2) on weekly city rain anomalies (rain minus the past-year climatology of that week) using
   training years only. At origin *t* (convention B: rain observed to *t − 1*), iterate the AR forward to fill the unobserved aligned weeks
   (target lags 2–4) and add back climatology. Implement as a new `rain_est` mode beside `clim` and `regime`, so nothing else changes.
3. Refit the champion specification (ridge Poisson, F8) per season with the new mode; score; apply the rule.

**Leakage checks:** the existing temporal-invariance checker (`assert_origin_invariant`, `tests/test_feature_pipeline.py`) must pass with
the new mode, and the planted-leak test must still fail it. The AR coefficients must be identical whether or not rain after the origin is
altered (new test). The oracle run is tagged `oracle` and can never enter a leaderboard.

**Compute:** AR fits are trivial; 6 seasons × 3 horizons GLM refits for each of oracle and AR(2), under 2 minutes, plus feature rebuilds.

## What will not be done

- No repeated tuning on 2022–2024 or on 2019–2024 presented as independent evidence; each experiment runs once as specified.
- No promotion of any E2/E3 result to production without the owner's decision and, if wanted, a single frozen evaluation on 2025 under
  `docs/holdout_protocol.md`.
