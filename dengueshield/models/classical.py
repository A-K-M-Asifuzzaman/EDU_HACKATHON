"""Classical point-forecast regressors for the V3 benchmark (research only; never used by the deployed API).

All use the GLM's leak-safe preprocessing fitted on the training rows only (median imputation, 0.5/99.5% winsorising,
standardising) and a squared-error loss on raw weekly counts. They return a point forecast, scored like the tournament's other
point-only model (LightGBM L1): the forecast itself, not a distribution median.

Negative predictions: unrestricted regressors (ridge least squares, MLP) can predict below zero. A count cannot be negative, so the
point forecast is max(prediction, 0); the share of clipped predictions and the MAE before clipping are reported alongside.

Hyperparameters:
- `ridge_ls` and `knn` choose one setting inside every fit by the same chronological hold-out as the GLM champion: fit on training
  years before the last one, score MAE on the last training year, refit on all training years.
- `rf`, `extra_trees` and `mlp` use fixed, conventional settings chosen before any result was seen; nothing is tuned on validation seasons.
"""
from __future__ import annotations

import warnings

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import Ridge
from sklearn.neighbors import KNeighborsRegressor
from sklearn.neural_network import MLPRegressor

from dengueshield.evaluation.models import GLMModel
from dengueshield.models.distributions import CountDist

SEED = 2026
THREADS = 5

GRIDS = {"ridge_ls": (0.1, 1.0, 10.0, 100.0, 1000.0), "knn": (5, 10, 20, 40, 80)}


def _estimator(kind: str, hp=None):
    if kind == "rf":
        return RandomForestRegressor(n_estimators=300, min_samples_leaf=5, max_features=0.5, n_jobs=THREADS, random_state=SEED)
    if kind == "extra_trees":
        return ExtraTreesRegressor(n_estimators=300, min_samples_leaf=5, max_features=0.7, n_jobs=THREADS, random_state=SEED)
    if kind == "ridge_ls":
        return Ridge(alpha=hp)
    if kind == "knn":
        return KNeighborsRegressor(n_neighbors=hp, n_jobs=THREADS)
    if kind == "mlp":
        return MLPRegressor(hidden_layer_sizes=(32, 16), alpha=1e-3, learning_rate_init=1e-3, max_iter=200, n_iter_no_change=10,
                            tol=1e-4, random_state=SEED)
    raise KeyError(kind)


class ClassicalRegressor:
    """fit(X, y, years) -> self; predict_params(X) -> {"q50": clipped point, "raw": unclipped}; dist(params) -> point distribution."""

    def __init__(self, kind: str):
        self.kind = kind
        self.converged = True

    def _fit_one(self, Z, y, hp):
        est = _estimator(self.kind, hp)
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always", ConvergenceWarning)
            est.fit(Z, y)
        if any(issubclass(x.category, ConvergenceWarning) for x in w):
            self.converged = False
        return est

    def fit(self, X, y, years=None):
        y = np.asarray(y, float)
        self.hp_ = None
        if self.kind in GRIDS:
            if years is None:
                raise ValueError("years required to choose the hyperparameter")
            years = np.asarray(years)
            tr, va = years < years.max(), years == years.max()
            prep = GLMModel()
            st, Z = prep._prep_fit(X[tr])
            Zv = prep._prep(st, X[va])
            self.hp_scores = {hp: float(np.mean(np.abs(np.maximum(self._fit_one(Z, y[tr], hp).predict(Zv), 0) - y[va]))) for hp in GRIDS[self.kind]}
            self.hp_ = min(self.hp_scores, key=self.hp_scores.get)
        self._prep = GLMModel()
        self.st, Z = self._prep._prep_fit(X)
        self.est = self._fit_one(Z, y, self.hp_)
        return self

    def predict_params(self, X):
        raw = self.est.predict(self._prep._prep(self.st, X))
        return {"q50": np.maximum(raw, 0.0), "raw": raw}

    def dist(self, prm):
        return CountDist("point", q50=prm["q50"])


NEW_MODELS = ("rf", "extra_trees", "ridge_ls", "knn", "mlp")
