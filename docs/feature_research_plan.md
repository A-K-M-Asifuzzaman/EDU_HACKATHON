# Feature research plan (input to Stage 2)

Evidence comes from `reports/eda/README.md`, which uses 2016–2021 for every relationship analysis,
and from the baselines in `reports/baselines/`. Each family is rated on four things: how strong the
**evidence** is, **availability** at origin *t* for each horizon, **leakage risk**, and expected
**priority** for reducing MAE.

Notation: "rain lag *k*" means rain *k* weeks before the **target**. For a forecast made at origin
*t* for target *t + h*, target-lag *k* is observed only if *k ≥ h*.

| Target lag *k* | h=2 | h=3 | h=4 |
|---|---|---|---|
| 2 (rate ratio 1.026 per 10 mm) | observed (rain at *t*) | **unobserved** | **unobserved** |
| 3 (1.057, strongest) | observed | observed (rain at *t*) | **unobserved** |
| 4 (1.043) | observed | observed | observed (rain at *t*) |
| 5 (1.012) | observed | observed | observed |

## Five strongest justified hypotheses (priority order)

### H1. Horizon-aligned rain lags, plus climatological fill for unobserved weeks
- **Evidence:** lag 3 is strongest. It is the only lag that stays dominant after deseasonalising
  (anomaly correlation 0.43) and after joint adjustment (rate ratio 1.057 per 10 mm); lags 2 and 4
  follow (1.026, 1.043).
- **Feature:** for each horizon, build "effective rain at target lags 2–5":
  - use observed ward rain where *k ≥ h*;
  - otherwise use an **expectation formed at t**: the ward × week-of-year rain climatology
    (computed from training years only), conditioned on the current wet/dry regime
    (P(wet at t+2 | wet at t) = 0.81 against 0.10 when dry).
  - Add an indicator or weight for each lag saying whether it was observed or expected.
- **Why it should help:** a separate GLM per horizon currently cannot express "the rain that
  matters has not happened yet; use its expected value". The oracle gap at h=4 (1.578 vs 1.188
  MAE) is the size of this opportunity. Rain anomalies have no persistence beyond the regime state
  (anomaly autocorrelation ≈ 0 at lags 1, 2 and 4), so climatology plus regime is near the honest
  limit.
- **Leakage:** low, if climatology is fitted inside each fold on training years only. Never use
  observed rain after *t*.

### H2. Ward vulnerability as a multiplicative level (log-linear static terms)
- **Evidence:** static attributes explain 96% of between-ward variance in log peak-season cases.
  Waterlogging (ρ 0.81), density (0.54) and sanitation (−0.41) all have stable adjusted coefficients.
  Rain × static interactions are not significant (p ≥ 0.28).
- **Feature:** keep the three statics as main effects in a log-link model, or let a tree model
  learn them. Optionally test waterlogging × sanitation and waterlogging × density (significant
  in LR tests, but identified from only 60 levels).
- **Why it should help:** it turns one seasonal curve into ward-specific levels without needing
  ward IDs.
- **Leakage:** none (static). **Risk:** the statics effectively identify wards. That is fine for
  these 60 wards, but the model won't generalise to unseen wards.

### H3. Smooth seasonal calendar terms with a monsoon-regime clock
- **Evidence:** about 99.6% of cases fall in April–October. The monsoon ends in the last week of
  September every year; onset varies from 1 April to 4 June. Peaks fall in ISO weeks 26–40, and
  calendar curves alone (seasonal average, MAE 1.46–1.52) are already strong.
- **Feature:** target-week Fourier terms (as in the baseline); **weeks since monsoon onset**
  observed at *t* (onset = first week with ward/city rain above a threshold set on training data);
  and cumulative season rain to date.
- **Why it should help:** the onset clock captures early or late seasons, such as 2022 peaking
  only 4 weeks after onset, which fixed calendar terms mistime.
- **Leakage:** low, if the onset threshold is a training-only constant and the onset is detected
  from rain up to *t*.

### H4. Recent case history as a secondary state signal
- **Evidence:** the ward PACF is significant at lags 1–2 (0.74, 0.26). Deseasonalised persistence
  is short (anomaly autocorrelation 0.25 at lag 1, 0.07 at lag 4). The state transitions are strongly
  informative at 0 cases: P(outbreak at t+2 | 0 at t) = 0.003. But adding case lags to a weather
  GLM gained only about 0.015 MAE in exploration, and the baseline GLM is insensitive to a one-week
  reporting delay.
- **Feature:** log1p of last reported count, 4-week mean, and week-over-week growth, all at
  *t* − `report_lag`.
- **Why it should help:** it corrects ward-level residual deviations, such as early-season
  outbreaks, that weather and statics miss.
- **Leakage:** medium. It is the feature most sensitive to reporting-delay assumptions; evaluate it
  at `report_lag` 0 and 1.

### H5. Humidity at target lag 2, as a challenger only
- **Evidence:** mixed. The adjusted GLM gives a strong lag-2 effect (rate ratio 1.041 per pp), but
  anomaly correlations are near 0 (−0.07 to +0.07). The effect may encode regime timing rather
  than independent signal.
- **Feature:** observed humidity at *t* (target lag *h*) and a 2-week mean. For h ≥ 3, target lag
  2 is unobserved, so it needs the same climatological fill as H1.
- **Why it should help:** possibly finer within-season timing. Keep it only if it improves
  validation MAE across all three folds.
- **Leakage:** low.

## Lower-priority or rejected families

| Family | Verdict | Reason |
|---|---|---|
| max/min temperature, diurnal range | drop | built as avg ± ~5 °C; corr(avg, midrange) 0.98 |
| avg temperature lags | low | raw association is seasonal confounding; anomaly correlation −0.12 to −0.02 |
| city fixed effects | low | city anomalies are no more correlated within cities than across them (0.52 vs 0.52) |
| ward ID one-hot | optional | redundant with statics; risks overfitting ward noise |
| ward-level rain deviations | keep (cheap) | small but non-zero signal (corr 0.07 with lag-3 case deviation) |
| spatial lags of neighbouring wards' cases | low | no coordinates; anomalies are near-uniform nationally |
| year index or trend | reject | no trend in level or rain response; annual severity tracks rain (r 0.92) |
| observed future weather (t+1…t+h) | **forbidden** | not available at the origin; only in the labelled oracle diagnostic |
| target encoding over all years | **forbidden** | leaks future labels; only fold-internal encodings are allowed |

## Modelling implications

- The response is close to Poisson once adjusted (Pearson dispersion 1.13–1.19). A Poisson or
  Tweedie loss is appropriate; negative binomial is a low-priority check.
- MAE rewards the predictive median: using the Poisson median of the GLM rate cut MAE by about
  0.03–0.04 at every horizon. Apply it as an explicit, validated post-processing step.
- Expect diminishing returns. The Poisson noise floor (known true rate) is about 0.83 MAE. The
  oracle-weather GLM sits at 1.14–1.19 and the operational GLM at 1.09–1.54 (median variant).
  Most of the remaining headroom is at h=3 and h=4.
