# Climate Futures 2026–2030: feasibility, backtest and model card

**Status: exploratory research feature (branch `research/climate-futures`).** It is separate from the validated 2–4-week champion
forecast. It has its own model, its own metrics and its own label: "Exploratory multi-year climate scenario". None of the champion's
reported metrics change. Every number below was produced by `dengueshield/scenarios.py` at code revision `da52604` plus this branch,
on the synthetic organizer data for **2016–2024 only**. The 2025 holdout is never parsed: data comes from `load_development_panel`.

## 1. Feasibility audit

- The champion bundle supports only 2–4 weeks ahead, and the API refuses origins after the data. That protection stays. The champion is
  not reused for multi-year output.
- Annual totals 2016–2024: 9,151 · 8,481 · 6,621 · 9,967 · 7,669 · 6,530 · 10,013 · 9,955 · 6,759. A linear trend is −29.9 cases/year with
  p = 0.889, so there is **no evidence of a trend**. 2026–2030 are therefore treated as exchangeable years: same distribution, no drift.
  No trend scenario is offered, because the data do not support one.
- Interannual variation is large: the year-level log standard deviation is 0.183.
- **Estimable:** the seasonal shape, city and ward shares, the spread of annual burden, and the burden conditional on an assumed weather year.
- **Not estimable:** the actual weather of any future year, real climate change, trends, and anything about 2025.

## 2. Approaches compared (rolling origin, 2019–2024)

Each target year Y was simulated by a model fitted only on 2016 to Y−1, with 300 seeded draws.

| Model | Inputs for the target year |
|---|---|
| **M0 seasonal climatology** | Ward × week-of-year mean of the training years, 3-week circular smoothing |
| **M1 weather-conditioned seasonal GLM, weather resampled** | Poisson GLM: ward effects + 3 seasonal harmonics + 2–4-week lagged rainfall (log), temperature and humidity. The target year's weather is unknown, so a whole training year's weather is drawn per simulation |
| M1 oracle weather (diagnostic only) | Same GLM, given the real target-year weather. This is a ceiling that is never available for the future |

Monte Carlo uncertainty per draw has three parts:
- a bootstrap of the training years, for model uncertainty;
- a log-normal year shock, for interannual variation;
- negative-binomial counts. The estimated dispersion is close to zero, so counts are near-Poisson.

## 3. Backtest results (mean over 2019–2024)

| Model | Ward-week MAE | RMSE | Annual total error | City annual error | Peak timing error (weeks) | 50% / 80% / 90% coverage (ward-week) | 80% width | 80% / 90% coverage (city-year, n=30) |
|---|---|---|---|---|---|---|---|---|
| M0 climatology | 1.431 | 2.818 | 19.5% | 19.4% | 4.2 | 75.6% / 87.0% / 91.3% | 3.18 | 90% / 100% |
| M1 weather-resampled | 1.421 | 2.803 | 20.6% | 20.1% | 4.2 | 78.4% / 89.4% / 93.4% | 3.65 | 100% / 100% |
| M1 oracle weather (diagnostic) | 1.098 | 2.150 | 8.2% | 8.4% | 1.8 | 79.7% / 90.7% / 94.7% | 2.91 | 100% / 100% |

By year:

| Year | M0 MAE | M1 MAE | Oracle MAE | M0 annual error | M1 annual error | Oracle annual error |
|---|---|---|---|---|---|---|
| 2019 | 1.775 | 1.780 | 1.171 | 19.9% | 21.9% | 7.5% |
| 2020 | 1.283 | 1.232 | 1.175 | 9.5% | 6.4% | 11.2% |
| 2021 | 1.272 | 1.275 | 0.945 | 24.0% | 27.7% | 5.2% |
| 2022 | 1.545 | 1.526 | 1.240 | 20.7% | 20.8% | 13.7% |
| 2023 | 1.514 | 1.471 | 1.100 | 18.6% | 19.7% | 11.2% |
| 2024 | 1.199 | 1.240 | 0.961 | 24.1% | 26.9% | 0.7% |

**Verdict.**
- Without knowing the weather, the weather-conditioned model is **no better than seasonal climatology**. Its ward-week MAE is 0.7% lower,
  but its annual-total error is higher.
- Knowing the real weather would cut the annual error from about 20% to about 8%. Rainfall clearly matters in this dataset, but future
  weather is unknown.
- So the engine has **no multi-year predictive skill beyond climatology**, and it is presented as an **educational scenario explorer**.
  M1 is kept only because it is the only model that can express a weather assumption, and climatology is shown next to it as the reference.

## 4. Uncertainty calibration

- At ward-week level, the 50/80/90% ranges cover 78/89/93% of outcomes. That is conservative, wider than nominal.
- At city-year level, coverage is 100% on only 30 city-seasons, which is too few to calibrate.
- The bands are therefore labelled **"simulation ranges"**, not calibrated prediction intervals.
- Uncertainty does not widen from 2026 to 2030, because no trend or drift is estimable. That is an assumption, stated on the page.

## 5. Scenario generator

| Scenario | Assumption |
|---|---|
| Typical | Historical weather years resampled as observed |
| Wetter | Lagged rainfall × 1.2 |
| Drier | Lagged rainfall × 0.8 |
| Warmer | Temperature + 1 °C |
| Custom | Rainfall × 0.7–1.3, temperature −1 to +2 °C (bounded to stay near the observed range) |

- Whole weather years are resampled, so rainfall, temperature and humidity stay **internally coherent**. There is no independent generation
  of impossible combinations.
- These are hypothetical assumptions, not forecasts from NASA POWER, Open-Meteo or any climate agency.
- Fitted GLM coefficients per standard deviation: rainfall +1.943, humidity +0.396, temperature −0.051. Temperature has essentially no effect
  in this synthetic data, so the "warmer" scenario barely moves.

2026 results, all 60 wards, 1,000 draws. The threshold is the historical median annual total, 8,481 cases.

| Scenario | Median | 80% range | 90% range | P(above 8,481) | Paired difference vs typical (80% range) |
|---|---|---|---|---|---|
| Typical | 8,066 | 5,951–10,960 | 5,458–11,830 | 43% | — |
| Wetter | 9,914 | 7,251–13,490 | 6,710–14,514 | 72% | +1,898 (+1,330 to +2,557), +22.8% |
| Drier | 6,258 | 4,632–8,499 | 4,242–9,187 | 10% | −1,853 (−2,495 to −1,320), −22.3% |
| Warmer | 7,972 | 5,886–10,848 | 5,406–11,631 | 41% | −106 (−239 to +24), −1.3% |

The comparisons are paired: both scenarios share the structural random draws, so the difference isolates the weather assumption. Scenario
differences are **conditional model outputs, not causal effects or real climate projections**. Nothing here implies that an intervention would succeed.

## 6. The 2025 gap

- No 2025 observation is read, inserted or approximated.
- Because future years are exchangeable draws from the 2016–2024 distribution, the method needs no intermediate years.
- The multi-year chart shows 2025 as an explicit "sealed" gap.
- Values published by other websites are not used.

## 7. Configuration and reproducibility

| Setting | Value |
|---|---|
| Training data | Synthetic organizer data, development rows 2016–2024 (`load_development_panel`, SHA-256 verified) |
| Week bins | 52 per year. In 53-Monday years the last two weeks share bin 52 (averaged) |
| GLM | scikit-learn `PoissonRegressor`, alpha = 1e-4 |
| Seeds | Simulation seed = 1000 + scenario year; count noise on a second stream (seed + 7,919); backtest seed 2026 |
| Bounds | Draws 50–2,000 (UI offers 200/500/1,000), years 2026–2030, rainfall × 0.7–1.3, temperature −1 to +2 °C |
| Caching | 256 cached runs; the backtest is computed once per process (about 2.5 s) |
| Cost | No paid APIs; one run takes about 0.2 s on CPU |

Reproduce with:

```bash
python -m pytest tests/test_scenarios.py
python -c "from dengueshield.data import load_development_panel as L; from dengueshield import scenarios as S; print(S.backtest(S.prepare(L())))"
```

## 8. Known limitations

- The data are synthetic. Any relationship learned here reflects the organizers' generator, not real dengue epidemiology.
- There is no skill beyond climatology without future weather, and peak timing is off by about 4 weeks on average.
- The ranges are conservative at ward-week level and uncalibrated at city-year level.
- Six backtest seasons and 30 city-seasons are a small sample.
- Exchangeable years assume no trend, no immunity dynamics, no serotype shifts and no reporting changes.
- Hospital capacity and clinical outcomes are out of scope.
- Forecasts are never placed on real ward boundaries.

## 9. Deployment recommendation

The feature is fit to show as an **exploratory, educational scenario explorer**, clearly separated from the validated forecast. It is **not**
fit to present as a 2030 prediction. Promotion to the production site requires the team's explicit approval.
