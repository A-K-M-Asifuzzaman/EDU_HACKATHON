# ML pipeline: from raw data to a calibrated forecast bundle

[Architecture overview](../../ARCHITECTURE.md)

Details: [`model_selection.md`](../model_selection.md), [`calibration_and_uncertainty.md`](../calibration_and_uncertainty.md), [`validation_protocol.md`](../validation_protocol.md)

## Stages

```mermaid
flowchart LR
    s1["Stage 1<br/>audit, EDA,<br/>leak-safe validation,<br/>baselines"] --> s2["Stage 2<br/>204 candidate features,<br/>ablation tournament,<br/>F3 (38) and F8 (24)"]
    s2 --> s3["Stage 3<br/>11 model families x 2 feature sets,<br/>tuned boosters, 9 ensembles,<br/>calibration, alerts, tiers"]
    s3 --> s4["Stage 4<br/>inference bundle,<br/>replay table,<br/>web platform"]
```

## Forecast for one ward, origin and horizon

```mermaid
flowchart TD
    panel[("Development panel<br/>2016-2024, 60 wards, weekly")] --> avail{"Convention B:<br/>data through week t-1"}
    avail --> f["24 F8 features<br/>seasonality, rainfall lags<br/>(observed + climatology projection),<br/>ward vulnerability"]
    f --> glm["Ridge Poisson GLM<br/>one model per horizon h = 2, 3, 4"]
    glm --> mu["Expected cases (mean)"]
    mu --> nb["Negative binomial with dispersion<br/>learned on the 2 prior seasons"]
    nb --> med["Median (headline forecast)"]
    nb --> pi["80% and 90% intervals"]
    nb --> p["P(cases ≥ training q90)"]
    p --> alert{"≥ threshold tuned<br/>on 2 prior seasons?"}
    alert -->|yes| a1["Outbreak alert"]
    med --> tier["Risk tier from training quantiles<br/>q60 / q80 / q95 = 1 / 5 / 13 cases"]
    glm --> expl["Explain: additive log-rate contributions<br/>season, rainfall, vulnerability"]
```

## Validation that every reported number comes from

```mermaid
sequenceDiagram
    autonumber
    participant D as Data ≤ 31 Dec (Y-1)
    participant M as Model for season Y
    participant I as Inner seasons Y-2, Y-1
    participant S as Season Y (outer)
    D->>M: fit features + GLM
    M->>I: out-of-time predictions on Y-2, Y-1
    I-->>M: dispersion α, alert threshold τ, ensemble weights
    M->>S: forecast every origin in Y (h = 2, 3, 4)
    S-->>S: score MAE, RMSE, coverage, recall, precision
    Note over D,S: Repeated for Y = 2019 ... 2024. 2025 is never loaded.
```

## Artifacts

| Artifact | Produced by | Used by |
|---|---|---|
| `models/dengueshield_B.joblib` (primary), `_A.joblib` | Stage 3 notebooks | `/api/forecast*` live inference, `explain` |
| `app_data/replay.csv.gz` (53,100 rows) | `python -m dengueshield.appdata` from Stage 3 out-of-time predictions | Historical Replay, reliability center, alert simulator, resource sandbox |
| `reports/model_tournament/*.csv`, `app_data/validation.json` | notebooks 07-08 | Model Evidence |
| `app_data/{profile,distributions,correlations,seasonality,lag_analysis}.json` | `dengueshield.appdata` | Data Profiling Studio, Forecast Lab |

## Results (unchanged since Stage 3)

| Horizon | MAE 2022-24 | Coverage 80 / 90 (all weeks) | Coverage 80 / 90 (peaks) | Alert recall / precision (pooled replay) |
|---|---|---|---|---|
| 2 weeks | 1.107 | season means: 0.854 / 0.911 | season means: 0.607 / 0.740 | per horizon in the Reliability center |
| 3 weeks | 1.393 | | | 0.758 / 0.508 |
| 4 weeks | 1.512 | | | |

## Data flow


```mermaid
flowchart TD
    raw["Organizer CSV (31,320 rows, synthetic)"] -->|"scripts/fetch_data.py<br/>SHA-256 verified"| panel["load_development_panel()<br/>drops 2025 on load"]
    panel --> feat["Feature pipeline<br/>F8: 24 features, convention B"]
    feat --> cv["Season-level out-of-time CV<br/>outer seasons 2019-2024"]
    cv --> champ["Champion selection rule<br/>(fixed before results)"]
    champ --> cal["Calibration on 2 prior seasons<br/>NB intervals + alert threshold"]
    cal --> bundle[("models/dengueshield_B.joblib")]
    cv --> replay[("app_data/replay.csv.gz<br/>53,100 out-of-time predictions")]
    panel --> appdata["python -m dengueshield.appdata<br/>profiles, correlations, lags"]
    bundle --> api["FastAPI"]
    replay --> api
    appdata --> api
    osm["OpenStreetMap (Overpass)<br/>build-time only"] --> geo[("app_data/geo<br/>914 facilities + road graphs")]
    geo --> api
    api --> ui["Dashboard"]
    holdout["2025 rows excluded from feature building and scoring"]:::locked
    classDef locked fill:#fde2e1,stroke:#b3262c,color:#7a1418
```

### Integrity boundaries

| Boundary | Rule |
|---|---|
| Organizer data vs real weather | NASA POWER / Open-Meteo are shown **beside** the synthetic data in the Climate Observatory; never a model input. |
| Live bundle vs Historical Replay | Replay = out-of-time predictions (2019-2024, nested calibration), used for every accuracy claim. Bundle values for origins ≤ 2024 are in-sample and labelled. |
| LLM vs numbers | The Copilot quotes only numbers returned by its read-only tools; it never computes forecasts. |
| Real facilities vs synthetic wards | Hospitals and roads are real OSM records; forecasts appear on the map only as city-level aggregates. No facility, route or polygon is linked to a synthetic ward ID. |
| Official boundaries vs dataset wards | DGHS polygons are context only; with no verified crosswalk, predictions use an abstract matrix. |
| Decision tools vs model | Reliability, alert-policy and allocation tools read saved replay rows only; nothing is refitted and the deployed alert rule is unchanged. |
| Frontend vs secrets | `OPENAI_API_KEY` stays in the backend `.env`; only public map keys are in `frontend/.env.local`. |

## Chronological validation


```mermaid
flowchart LR
    subgraph fold["Outer fold for season Y (repeated for Y = 2019 ... 2024)"]
        direction LR
        train["Train on labels known<br/>by 31 Dec of Y-1"] --> inner["Tune on seasons Y-2, Y-1 only<br/>(dispersion, alert threshold,<br/>ensemble weights)"] --> pred["Predict every origin<br/>in season Y"]
    end
    pred --> score["Score season Y<br/>MAE, RMSE, coverage, alerts"]
    lock["2025 test year"]:::locked
    classDef locked fill:#fde2e1,stroke:#b3262c,color:#7a1418
```

- **Origin convention B (primary):** a forecast issued at the start of week *t* uses weather and cases through week *t-1*; convention A is labelled "assumes week *t* is complete".
- **Hyperparameter search** ran on 2019-2021 only; 2022-2024 is the benchmark window.
- **Locked holdout:** 2025 is dropped on load, never displayed or scored (`docs/holdout_protocol.md`). The API refuses origins later than the last data week + 1.

## Why this model


Rule fixed before the tuned and ensemble results were seen (`docs/model_selection.md` §7): shortlist everything within 0.05 MAE of the best,
then take the simplest. Winner: **ridge Poisson GLM, 24 features, one model per horizon.**

| | |
|---|---|
| MAE 2022-24 (h = 2/3/4) | 1.107 / 1.393 / 1.512 |
| Cost | ~0.4 s to fit, sub-millisecond to predict, 11 KB bundle |
| Why not boosting/ensembles | Gaps to the best candidate were 0.002-0.037 MAE, inside the noise of 3-6 seasons; the GLM has the best high-incidence behaviour of the shortlist, the lowest variability and additive per-driver explanations |
| Intervals | Negative binomial, dispersion calibrated on the two prior seasons. 80% / 90% coverage 0.854 / 0.911 on average |
| Alert | P(cases ≥ training q90) ≥ tuned cut. Recall ≈ 0.78, precision ≈ 0.53 (season means; pooled 3-week replay 0.758 / 0.508) |
| Known weakness | Intervals under-cover outbreak peaks (0.607 at 80%, 0.740 at 90%) and peaks are under-predicted by ≈ 3 cases; shown in the UI |

Risk tiers (Low/Medium/High/Critical) are quantiles of the training data (1 / 5 / 13 weekly cases): **statistical categories, not official warning levels.**
