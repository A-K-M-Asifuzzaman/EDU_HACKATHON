# Decision support: reliability, alert policy, time machine, resource planning

[← Architecture overview](../../ARCHITECTURE.md) · Evidence and numbers: [`decision_support.md`](../decision_support.md)

## Inputs and outputs

```mermaid
flowchart LR
    replay[("Saved out-of-time replay<br/>2019-2024, 53,100 ward-weeks<br/>p_outbreak, alert, y_true, thr_q90")]
    panel[("Development panel<br/>cases before each origin")]
    diag[("Saved diagnostics and<br/>calibration tables")]
    replay --> curve["Alert curve<br/>τ grid 0.02-0.98"]
    replay --> nested["Nested re-selection<br/>τ from seasons Y-2, Y-1 only"]
    replay --> alloc["Allocation<br/>equal / historical / forecast"]
    panel --> alloc
    diag --> rel["Reliability center"]
    replay --> tm["Time-machine verdict<br/>error, interval hit, alert outcome"]
    curve & nested --> sim["Alert policy simulator UI"]
    alloc --> sand["Resource planning sandbox UI"]
    lock["No refitting · deployed rule unchanged · 2025 never read"]:::info
    classDef info fill:#fff4dc,stroke:#e0a526
```

## Why the simulator cannot leak

```mermaid
flowchart TB
    subgraph honest["Reported as honest estimates"]
        dep["Deployed rule<br/>τ per season from 2 prior seasons<br/>(Stage 3)"]
        nes["Nested F1 re-selection<br/>τ for 2021-2024 from 2 prior replay seasons"]
    end
    subgraph optimistic["Labelled optimistic"]
        sel["Any τ picked on the slider"]
        best["Best in-sample τ"]
    end
    eval["Scored on the same replay rows"]
    dep --> eval
    nes --> eval
    sel --> eval
    best --> eval
```

## Resource sandbox rules

| Rule | Ranking key (available at the origin) | Tie-break |
|---|---|---|
| Equal (risk-blind) | round-robin across cities | ward ID |
| Historical risk | mean weekly cases strictly before the origin | ward ID |
| Forecast | calibrated P(outbreak) at the origin | expected cases, then ward ID |

Outcome = retrospective coverage of actual outbreak wards and cases in the target week. It is a planning simulation, not a claim about prevented infections or real capacity.
