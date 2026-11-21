# ML pipeline: from raw data to a calibrated forecast bundle

[← Architecture overview](../../ARCHITECTURE.md) · Details: [`model_selection.md`](../model_selection.md), [`calibration_and_uncertainty.md`](../calibration_and_uncertainty.md), [`validation_protocol.md`](../validation_protocol.md)

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
