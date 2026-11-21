"""Fixed model configurations for feature comparison. Fit inside a training boundary only."""
from __future__ import annotations

import time

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.linear_model import PoissonRegressor

SEED = 2026
LGBM_PARAMS = dict(objective="poisson", n_estimators=400, learning_rate=0.03, num_leaves=7, min_child_samples=40,
                   subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, max_bin=63,
                   random_state=SEED, n_jobs=8, verbose=-1, deterministic=True, force_row_wise=True)


class GLMModel:
    """Median-impute, winsorise (0.5/99.5%), standardise, then ridge Poisson. All statistics come from the training rows.

    The ridge strength is chosen inside every fit by a chronological hold-out: fit on training years before the last
    one, score MAE of the Poisson median on the last training year, refit on everything. Needs `years` (origin year of each row).
    """
    ALPHAS = (1e-4, 1e-2, 0.3, 3.0, 30.0)

    def __init__(self, alpha=None):
        self.alpha = alpha

    def _prep_fit(self, X: pd.DataFrame):
        A = X.to_numpy(float)
        med = np.nanmedian(A, axis=0)
        med = np.where(np.isnan(med), 0.0, med)
        A = np.where(np.isnan(A), med, A)
        lo, hi = np.quantile(A, [0.005, 0.995], axis=0)
        A = np.clip(A, lo, hi)
        mu, sd = A.mean(0), A.std(0)
        keep = sd > 1e-12
        return (med, lo, hi, mu, sd, keep), (A[:, keep] - mu[keep]) / sd[keep]

    def _prep(self, st, X: pd.DataFrame):
        med, lo, hi, mu, sd, keep = st
        A = np.clip(np.where(np.isnan(A := X.to_numpy(float)), med, A), lo, hi)
        return (A[:, keep] - mu[keep]) / sd[keep]

    def fit(self, X: pd.DataFrame, y, years=None):
        y = np.asarray(y)
        if self.alpha is None:
            if years is None:
                raise ValueError("years required to choose alpha")
            years = np.asarray(years)
            last = years.max()
            tr, va = years < last, years == last
            st, Z = self._prep_fit(X[tr])
            Zv = self._prep(st, X[va])
            score = {}
            for a in self.ALPHAS:
                mu = PoissonRegressor(alpha=a, max_iter=3000, tol=1e-6).fit(Z, y[tr]).predict(Zv)
                score[a] = np.mean(np.abs(poisson.ppf(0.5, np.maximum(mu, 1e-9)) - y[va]))
            self.alpha_ = min(score, key=score.get)
            self.alpha_scores = score
        else:
            self.alpha_ = self.alpha
        self.st, Z = self._prep_fit(X)
        self.reg = PoissonRegressor(alpha=self.alpha_, max_iter=3000, tol=1e-6).fit(Z, y)
        return self

    def predict(self, X: pd.DataFrame):
        return self.reg.predict(self._prep(self.st, X))


class LGBMModel:
    def __init__(self, **kw):
        self.params = {**LGBM_PARAMS, **kw}

    def fit(self, X, y):
        self.m = lgb.LGBMRegressor(**self.params).fit(X, y)
        self.columns = list(X.columns)
        return self

    def predict(self, X):
        return self.m.predict(X)

    def gain_importance(self):
        g = self.m.booster_.feature_importance("gain")
        return pd.Series(g / max(g.sum(), 1e-12), index=self.columns)


MODELS = {"glm": GLMModel, "lgbm": LGBMModel}


def poisson_median(mu):
    """MAE-optimal integer point forecast under a Poisson predictive distribution with rate mu."""
    return poisson.ppf(0.5, np.maximum(mu, 1e-9))


def fit_predict(model: str, Xtr, ytr, Xev, years=None, **kw):
    t = time.perf_counter()
    m = MODELS[model](**kw)
    m = m.fit(Xtr, ytr, years=years) if model == "glm" else m.fit(Xtr, ytr)
    t_fit = time.perf_counter() - t
    t = time.perf_counter()
    mu = m.predict(Xev)
    return m, mu, {"fit_s": t_fit, "predict_s": time.perf_counter() - t}
