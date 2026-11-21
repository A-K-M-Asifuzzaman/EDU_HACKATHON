"""Bounded Optuna search on the inner tuning seasons 2019-2021 (all before the 2022-2024 benchmark), convention B.

Objective: mean Poisson-median MAE over seasons x horizons. Each fit uses early stopping on its own last training year,
so the number of boosting rounds never sees the season being scored. Studies persist in .cache/optuna/*.db (SQLite)."""
from __future__ import annotations

import time

import numpy as np
import optuna

from dengueshield.data import ROOT
from dengueshield.models import seasons as S

STORE = ROOT / ".cache" / "optuna"


def space(model: str, t: optuna.Trial) -> dict:
    if model.startswith("lgbm"):
        p = {"learning_rate": t.suggest_float("learning_rate", 0.01, 0.15, log=True),
             "num_leaves": t.suggest_int("num_leaves", 4, 63, log=True),
             "max_depth": t.suggest_categorical("max_depth", [-1, 3, 4, 6, 8]),
             "min_child_samples": t.suggest_int("min_child_samples", 10, 300, log=True),
             "reg_alpha": t.suggest_float("reg_alpha", 1e-3, 10, log=True),
             "reg_lambda": t.suggest_float("reg_lambda", 1e-3, 30, log=True),
             "colsample_bytree": t.suggest_float("colsample_bytree", 0.4, 1.0),
             "subsample": t.suggest_float("subsample", 0.5, 1.0), "early_stopping": True}
        if model == "lgbm_tweedie":
            p["tweedie_variance_power"] = t.suggest_float("tweedie_variance_power", 1.05, 1.8)
        return p
    if model == "xgb_poisson":
        return {"learning_rate": t.suggest_float("learning_rate", 0.01, 0.2, log=True),
                "max_depth": t.suggest_int("max_depth", 2, 8),
                "min_child_weight": t.suggest_float("min_child_weight", 1, 100, log=True),
                "subsample": t.suggest_float("subsample", 0.5, 1.0),
                "colsample_bytree": t.suggest_float("colsample_bytree", 0.4, 1.0),
                "reg_lambda": t.suggest_float("reg_lambda", 1e-3, 30, log=True),
                "reg_alpha": t.suggest_float("reg_alpha", 1e-3, 10, log=True),
                "max_delta_step": t.suggest_float("max_delta_step", 0.2, 2.0), "early_stopping": True}
    if model == "cat_poisson":
        return {"learning_rate": t.suggest_float("learning_rate", 0.02, 0.2, log=True),
                "depth": t.suggest_int("depth", 3, 8),
                "l2_leaf_reg": t.suggest_float("l2_leaf_reg", 1, 30, log=True),
                "random_strength": t.suggest_float("random_strength", 0.1, 5, log=True),
                "bagging_temperature": t.suggest_float("bagging_temperature", 0.0, 1.0), "early_stopping": True}
    raise KeyError(model)


def run_study(panel, model: str, cols: list[str], fs_name: str, n_trials: int, conv: str = "B", seasons=S.TUNE,
              horizons=(2, 3, 4), seed: int = 2026) -> optuna.Study:
    STORE.mkdir(parents=True, exist_ok=True)
    assert max(seasons) < min(S.BENCH), "tuning seasons must precede the benchmark years"
    name = f"{model}_{fs_name}_{conv}_tune{min(seasons)}-{max(seasons)}"
    study = optuna.create_study(study_name=name, storage=f"sqlite:///{STORE / name}.db", direction="minimize",
                                load_if_exists=True, sampler=optuna.samplers.TPESampler(seed=seed, n_startup_trials=8),
                                pruner=optuna.pruners.MedianPruner(n_startup_trials=6, n_warmup_steps=3))

    def objective(trial):
        prm = space(model, trial)
        maes, t0 = [], time.perf_counter()
        for i, (yr, h) in enumerate([(y, h) for y in seasons for h in horizons]):
            df = S.predict_season(panel, conv, fs_name, cols, model, prm, h, yr, tag="optuna")
            maes.append(S.score(df)["mae"])
            trial.report(float(np.mean(maes)), i)
            if trial.should_prune():
                raise optuna.TrialPruned()
        trial.set_user_attr("seconds", time.perf_counter() - t0)
        return float(np.mean(maes))

    done = len([t for t in study.trials if t.state.is_finished()])
    if done < n_trials:
        study.optimize(objective, n_trials=n_trials - done)
    return study


def baseline_objective(panel, model: str, cols, fs_name: str, params=None, conv="B", seasons=S.TUNE, horizons=(2, 3, 4)) -> float:
    """Same objective for an untuned reference (e.g. the GLM) so trials can be compared like for like."""
    return float(np.mean([S.score(S.predict_season(panel, conv, fs_name, cols, model, params or {}, h, y))["mae"]
                          for y in seasons for h in horizons]))
