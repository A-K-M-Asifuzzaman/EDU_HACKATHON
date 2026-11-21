# EDA findings (Stage 1)

Source: `notebooks/02_eda.ipynb`. Every number below is in `eda_summary.json` or `tables/`.

**Holdout discipline.** Descriptive views use 2016–2024. Relationship analyses (lag correlations,
adjusted models, interaction tests, transitions, extremes, weather predictability) use **2016–2021
only**, the first fold's training years. 2025 is never loaded. All statements are associations
in a synthetic dataset, not causal claims.

## Ten headline findings

1. **The season is the dominant signal, and it is rigid.** About 99.6% of cases fall between
   April and October (`share_cases_in_jan_mar_nov_dec` = 0.0035). The national mean exceeds
   1 case per ward between ISO weeks 17–24 and weeks 41–43 every year. The yearly peak
   moves between ISO weeks 26 and 40 (fig 04).
2. **Rainfall leads cases by about 3 weeks, and the lag survives adjustment.** The raw pooled
   correlation is highest at lag 3 (0.74). After removing each ward's week-of-year climatology
   it drops to 0.43 but **still peaks at lag 3**, with lag 4 at 0.31 and lags 0–1 near 0.1.
   In a joint Poisson GLM with month fixed effects (2016–2021), each extra 10 mm of rain
   multiplies the expected count by 1.026 at lag 2, **1.057 at lag 3** and 1.043 at lag 4.
   Effects at lags 0–1 and 5–8 are under 1.012 per 10 mm (figs 07, 08). This matches the brief's
   2–4 week "vector breeding clock".
3. **Temperature's raw association is mostly seasonal confounding.** Raw correlation rises to
   0.61 at lag 8, but the seasonal-anomaly correlation is about 0 or slightly negative at every
   lag (−0.12 to −0.02). The adjusted GLM gives mixed-sign lag effects. Temperature should be
   treated as a weak, collinear feature, not a driver.
4. **Humidity is ambiguous.** Its raw and in-season correlations peak at lag 2, and the adjusted
   GLM gives a strong lag-2 effect (rate ratio 1.041 per percentage point). But anomaly
   correlations are near 0 (−0.07 to +0.07), so much of the lag-2 effect may track the timing of the
   seasonal regime switch rather than genuine humidity anomalies. Validate it, don't assume it.
5. **Annual severity is explained by rainfall, not by a year effect.** Annual rainfall vs annual
   total cases gives r = 0.92 (2016–2024) and r = 0.92 (2016–2021 only); n = 9 years, so treat
   this with caution. The in-season lag-3 rain coefficient is stable across years (0.054–0.108
   log-rate per 10 mm, no trend, fig 16). There is no evidence of a structural break or a
   reporting change.
6. **Ward vulnerability is a level multiplier, not a rain amplifier.** The three static
   attributes explain **96% of between-ward variance** in log peak-season cases. Waterlogging is
   the strongest (Spearman ρ 0.81), then density (0.54) and sanitation (−0.41). Rain × static
   interactions add nothing (LR p = 0.28, 0.50, 0.50). The waterlogging × sanitation and
   waterlogging × density interactions are statistically significant, but they are identified
   from only 60 ward levels.
7. **Zero inflation is structural seasonality, and transitions are predictable from the current
   state.** P(outbreak ≥ 9 cases at t+2 | 0 cases at t) = 0.003, rising to 0.009 at t+4. Only
   1.8% of outbreak weeks had zero cases 2 weeks earlier (4.4% at 4 weeks). Outbreak persistence
   P(≥9 at t+h | ≥9 at t) decays from 0.55 (h=1) to 0.50 (h=2) to 0.39 (h=4) (fig 12).
8. **Geography changes the level, not the timing.** City seasonal profile shapes correlate
   ≥ 0.995, and city peak weeks differ by at most 6 weeks in any year. Case anomalies correlate
   as strongly across cities (0.52) as within cities (0.52), so the city label carries no
   dynamics of its own beyond the shared weather.
9. **Case persistence beyond the season is short.** The ward ACF is 0.74 at lag 1 and 0.50 at
   lag 4. The PACF is 0.74, 0.26, 0.10 and −0.02 at lags 1–4. Deseasonalised, the ACF is only
   0.25 at lag 1 and 0.07 at lag 4. Most short-term autocorrelation is the smeared footprint of
   rain lags 2–5, which is why recent cases help only modestly once weather lags are present.
10. **The weeks a 3–4 week forecast cannot see are unpredictable beyond climatology.**
    National rain anomalies have autocorrelation ≈ 0 at lags 1, 2 and 4 (0.04, −0.00, −0.01).
    Ward × week climatology explains 73% of weekly rain variance. The wet/dry regime is
    persistent: P(wet at t+2 | wet at t) = 0.81 against 0.10 when dry. For h=3 the decisive
    lag-3 rain falls one week after the origin; for h=4, lags 2–3 do. That missing information
    is irreducible, so climatology plus regime state is the best available stand-in.

## Further observations

- **Monsoon timing:** onset (first week national mean rain > 30 mm) varies from 1 April to 4 June,
  but the regime ends in the last week of September every year. Cases rise 0–3 weeks after onset
  and fall below 1 per ward 3–5 weeks after the end (`tables/monsoon_season_by_year.csv`). 2022
  peaked only 4 weeks after onset, the earliest of the nine years, while the other years took
  13–23 weeks.
- **Extreme-weather windows:** the top 5% of rain anomalies fall on only 24 distinct dates, because
  weather is shared nationally. They are followed by a +3.2 case anomaly at +3 weeks (fig 14).
  Heat and humidity extremes show no consistent positive response.
- **Ward-level weather noise is not pure noise:** a ward's rain deviation from its city mean
  correlates 0.07 with its case deviation 3 weeks later. That is small but non-zero, so ward-level
  rain is worth keeping alongside smoothed city or national rain.
- **Dispersion:** with month effects and weather lags, Pearson dispersion is 1.19, close to Poisson.
  The marginal over-dispersion (8.05) comes mostly from seasonality.
- **Artifacts:** case counts show no heaping at multiples of 5 (value counts decline smoothly), no
  year-boundary discontinuity, and identical seasonal shapes across cities. Weather artifacts are
  listed in `docs/data_audit.md`.

## Nonstationarity and seasonality risks

- Annual case totals swing about ±20% around the 2016–2024 mean (6,530 to 10,013) with rainfall. A model that memorises year-level means
  (for example through a ward mean fitted on a few years) will be biased in wet or dry years.
- Peak timing moves by up to 14 weeks (ISO weeks 26–40). Calendar-only seasonal models will
  mistime early or late seasons such as 2022.
- Only nine development seasons exist, and the three validation folds include one early season
  (2022) and one dry year (2024). Fold-to-fold variance is therefore large relative to small model
  differences; see the `mae_fold_sd` column in the baseline results.

## Figures

| # | File | Shows |
|---|---|---|
| 01 | `figures/01_cases_by_year_city.png` | annual totals; per-ward-week mean by city |
| 02 | `figures/02_monthly_profiles.png` | monthly means of cases, rain, temp, humidity |
| 03 | `figures/03_ward_year_heatmap.png` | ward × year mean cases |
| 04 | `figures/04_seasonal_curves.png` | week-of-year curves per year |
| 05 | `figures/05_rain_and_cases_timeseries.png` | national weekly rain and cases |
| 06 | `figures/06_monsoon_onset_event_study.png` | cases aligned on monsoon onset |
| 07 | `figures/07_cross_correlation_lags.png` | lag 0–8 correlations: raw, anomaly, in-season |
| 08 | `figures/08_adjusted_lag_effects.png` | jointly adjusted GLM rate ratios by lag |
| 09 | `figures/09_weather_dependence_deciles.png` | mean cases by decile of lag-3 temp, humidity, rain |
| 10 | `figures/10_static_vulnerability.png` | ward peak-season cases vs static attributes |
| 11 | `figures/11_acf_pacf.png` | ACF and PACF, raw and deseasonalised |
| 12 | `figures/12_state_transitions.png` | state transition matrices at h = 1, 2, 4 |
| 13 | `figures/13_city_seasonal_profiles.png` | seasonal profile by city |
| 14 | `figures/14_extreme_weather_response.png` | case anomaly after extreme-weather weeks |
| 15 | `figures/15_severity_vs_rain.png` | annual rainfall vs annual cases |
| 16 | `figures/16_nonstationarity.png` | per-year rain coefficient, level and zero share |
