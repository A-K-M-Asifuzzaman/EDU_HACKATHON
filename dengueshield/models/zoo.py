"""Count-aware model zoo with one interface: fit(X, y, years) -> self; predict(X) -> dict of distribution parameters;
dist(params) -> CountDist. `years` (origin year of each training row) lets a model hold out its last training year for
regularisation or early stopping - always inside the training boundary."""
from __future__ import annotations

import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.linear_model import PoissonRegressor, TweedieRegressor
from sklearn.preprocessing import SplineTransformer

from dengueshield.evaluation.models import GLMModel
from dengueshield.models.distributions import CountDist, _hurdle_lambda, moment_alpha

SEED = 2026
THREADS = 5  # M3 Pro: 5 performance cores; avoids oversubscription


def _split_last_year(years):
    years = np.asarray(years)
    last = years.max()
    return years < last, years == last


# ---------------------------------------------------------------- GLM family
class PoissonGLM(GLMModel):
    """Stage 2 champion: ridge Poisson, alpha chosen on the last training year."""
    family = "poisson"

    def fit(self, X, y, years=None):
        super().fit(X, y, years=years)
        return self

    def _design(self, X):
        return X

    def predict_params(self, X):
        return {"mu": GLMModel.predict(self, self._design(X))}

    def dist(self, prm):
        return CountDist("poisson", mu=prm["mu"])


class PoissonGLM_NBDisp(PoissonGLM):
    """Same mean model; NB2 dispersion estimated by moments on the training rows gives the predictive distribution."""

    def fit(self, X, y, years=None):
        super().fit(X, y, years=years)
        self.alpha_nb = moment_alpha(y, GLMModel.predict(self, X))
        return self

    def dist(self, prm):
        return CountDist("nb", mu=prm["mu"], alpha=self.alpha_nb)


def _cyclic_basis(X: pd.DataFrame, n_knots: int = 9) -> pd.DataFrame:
    """Periodic cubic B-splines of the target (and origin) week position, recovered from the Fourier columns."""
    out = {}
    st = SplineTransformer(n_knots=n_knots, degree=3, extrapolation="periodic").fit(np.linspace(0, 1, 53)[:, None])
    for tag, (s, c) in {"tgt": ("cal_tgt_sin1", "cal_tgt_cos1"), "org": ("cal_org_sin1", "cal_org_cos1")}.items():
        if s in X and c in X:
            t = (np.arctan2(X[s].to_numpy(), X[c].to_numpy()) / (2 * np.pi)) % 1.0
            B = st.transform(t[:, None])
            for j in range(B.shape[1]):
                out[f"spl_{tag}_{j}"] = B[:, j]
    return pd.concat([X.reset_index(drop=True), pd.DataFrame(out)], axis=1)


class SplineGLM(PoissonGLM):
    """Poisson ridge GLM plus cyclic seasonal splines (fixed knots; no data-dependent basis)."""

    def _design(self, X):
        return _cyclic_basis(X)

    def fit(self, X, y, years=None):
        return super().fit(self._design(X), y, years)


class NBGLM(PoissonGLM):
    """Negative-binomial (NB2) regression: alpha from the Poisson fit by moments, then NB IRLS on the same design.
    Falls back to the Poisson coefficients if IRLS fails to converge."""

    def fit(self, X, y, years=None):
        super().fit(X, y, years=years)
        Z = self._prep(self.st, X)
        mu0 = self.reg.predict(Z)
        self.alpha_nb = moment_alpha(y, mu0)
        start = np.r_[self.reg.intercept_, self.reg.coef_]
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                res = sm.GLM(np.asarray(y, float), sm.add_constant(Z, has_constant="add"),
                             family=sm.families.NegativeBinomial(alpha=self.alpha_nb)).fit(start_params=start, maxiter=100)
            ok = np.isfinite(res.params).all() and res.converged
        except Exception:
            ok = False
        self.nb_params = res.params if ok else start
        self.nb_converged = bool(ok)
        return self

    def predict_params(self, X):
        Z = sm.add_constant(self._prep(self.st, X), has_constant="add")
        return {"mu": np.exp(np.clip(Z @ self.nb_params, -20, 10))}

    def dist(self, prm):
        return CountDist("nb", mu=prm["mu"], alpha=self.alpha_nb)


class TweedieGLM(GLMModel):
    """Ridge Tweedie (power 1.5, log link); alpha chosen on the last training year; NB predictive distribution by moments."""
    POWER = 1.5

    def fit(self, X, y, years):
        y = np.asarray(y)
        tr, va = _split_last_year(years)
        st, Z = self._prep_fit(X[tr])
        Zv = self._prep(st, X[va])
        score = {}
        for a in self.ALPHAS:
            mu = TweedieRegressor(power=self.POWER, link="log", alpha=a, max_iter=3000, tol=1e-6).fit(Z, y[tr]).predict(Zv)
            score[a] = np.mean(np.abs(CountDist("poisson", mu=mu).median() - y[va]))
        self.alpha_ = min(score, key=score.get)
        self.st, Z = self._prep_fit(X)
        self.reg = TweedieRegressor(power=self.POWER, link="log", alpha=self.alpha_, max_iter=3000, tol=1e-6).fit(Z, y)
        self.alpha_nb = moment_alpha(y, self.reg.predict(Z))
        return self

    def predict_params(self, X):
        return {"mu": self.reg.predict(self._prep(self.st, X))}

    def dist(self, prm):
        return CountDist("nb", mu=prm["mu"], alpha=self.alpha_nb)


# ---------------------------------------------------------------- gradient boosting
LGBM_BASE = dict(n_estimators=400, learning_rate=0.03, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1,
                 colsample_bytree=0.7, reg_lambda=5.0, max_bin=63, random_state=SEED, n_jobs=THREADS, verbose=-1,
                 deterministic=True, force_row_wise=True)


class LGBMCount:
    """objective: poisson | tweedie | l1 | quantile. Optional early stopping on the last training year, then refit."""

    def __init__(self, objective="poisson", early_stopping=False, **params):
        self.objective, self.es = objective, early_stopping
        self.params = {**LGBM_BASE, "objective": objective, **params}

    def fit(self, X, y, years=None):
        y = np.asarray(y, float)
        p = dict(self.params)
        if self.es and years is not None:
            tr, va = _split_last_year(years)
            m = lgb.LGBMRegressor(**{**p, "n_estimators": max(p["n_estimators"], 2000)})
            m.fit(X[tr], y[tr], eval_set=[(X[va], y[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
            p["n_estimators"] = max(int(m.best_iteration_ or p["n_estimators"]), 20)
        self.n_estimators_ = p["n_estimators"]
        self.m = lgb.LGBMRegressor(**p).fit(X, y)
        self.columns = list(X.columns)
        return self

    def predict_params(self, X):
        v = self.m.predict(X)
        if self.objective in ("l1", "quantile"):
            return {"q50": v}
        return {"mu": np.maximum(v, 1e-9)}

    def dist(self, prm):
        if "q50" in prm:
            return CountDist("point", q50=prm["q50"])
        return CountDist("poisson", mu=prm["mu"])


class XGBPoisson:
    def __init__(self, early_stopping=False, **params):
        import xgboost as xgb
        self.xgb, self.es = xgb, early_stopping
        self.params = dict(objective="count:poisson", n_estimators=400, learning_rate=0.05, max_depth=3, min_child_weight=5,
                           subsample=0.8, colsample_bytree=0.7, reg_lambda=5.0, tree_method="hist", max_bin=64,
                           n_jobs=THREADS, random_state=SEED)
        self.params.update(params)

    def fit(self, X, y, years=None):
        p = dict(self.params)
        if self.es and years is not None:
            tr, va = _split_last_year(years)
            m = self.xgb.XGBRegressor(**{**p, "n_estimators": max(p["n_estimators"], 2000), "early_stopping_rounds": 100})
            m.fit(X[tr], np.asarray(y)[tr], eval_set=[(X[va], np.asarray(y)[va])], verbose=False)
            p["n_estimators"] = max(int(m.best_iteration) + 1, 20)
        self.n_estimators_ = p["n_estimators"]
        self.m = self.xgb.XGBRegressor(**p).fit(X, np.asarray(y))
        return self

    def predict_params(self, X):
        return {"mu": np.maximum(self.m.predict(X), 1e-9)}

    def dist(self, prm):
        return CountDist("poisson", mu=prm["mu"])


class CatPoisson:
    def __init__(self, early_stopping=False, **params):
        self.es = early_stopping
        self.params = dict(loss_function="Poisson", iterations=600, learning_rate=0.05, depth=4, l2_leaf_reg=5.0,
                           random_seed=SEED, thread_count=THREADS, verbose=0, allow_writing_files=False)
        self.params.update(params)

    def fit(self, X, y, years=None):
        from catboost import CatBoostRegressor
        p = dict(self.params)
        if self.es and years is not None:
            tr, va = _split_last_year(years)
            m = CatBoostRegressor(**{**p, "iterations": max(p["iterations"], 2000), "od_type": "Iter", "od_wait": 100})
            m.fit(X[tr], np.asarray(y)[tr], eval_set=(X[va], np.asarray(y)[va]), use_best_model=True)
            p["iterations"] = max(int(m.get_best_iteration()) + 1, 20)
        self.n_estimators_ = p["iterations"]
        self.m = CatBoostRegressor(**p).fit(X, np.asarray(y))
        return self

    def predict_params(self, X):
        return {"mu": np.maximum(self.m.predict(X, prediction_type="Exponent"), 1e-9)}

    def dist(self, prm):
        return CountDist("poisson", mu=prm["mu"])


class Hurdle:
    """P(Y>0) by a LightGBM classifier; E(Y | Y>0) by a LightGBM Poisson fit on positive rows, mapped to a zero-truncated
    Poisson rate. Predictive distribution: mixture of a point mass at 0 and a zero-truncated Poisson."""

    def __init__(self, **params):
        self.params = {**LGBM_BASE, **params}

    def fit(self, X, y, years=None):
        y = np.asarray(y, float)
        clf_p = {k: v for k, v in self.params.items()}
        self.clf = lgb.LGBMClassifier(**{**clf_p, "objective": "binary"}).fit(X, (y > 0).astype(int))
        pos = y > 0
        self.reg = lgb.LGBMRegressor(**{**clf_p, "objective": "poisson"}).fit(X[pos], y[pos])
        return self

    def predict_params(self, X):
        p = np.clip(self.clf.predict_proba(X)[:, 1], 1e-6, 1 - 1e-6)
        m = np.maximum(self.reg.predict(X), 1.0 + 1e-6)
        lam = _hurdle_lambda(m)
        return {"p": p, "lam": lam, "mu": p * m}

    def dist(self, prm):
        return CountDist("hurdle", p=prm["p"], lam=prm["lam"])


class SeverityClassifier:
    """Direct outbreak-risk model: P(Y >= training q90 | X) by a LightGBM classifier. Threshold set on training targets."""
    is_classifier = True

    def __init__(self, **params):
        self.params = {**LGBM_BASE, "objective": "binary", **params}

    def fit(self, X, y, years=None):
        y = np.asarray(y, float)
        self.thr = float(np.quantile(y, 0.9))
        self.m = lgb.LGBMClassifier(**self.params).fit(X, (y >= self.thr).astype(int))
        return self

    def predict_params(self, X):
        return {"p": self.m.predict_proba(X)[:, 1]}

    def dist(self, prm):
        return CountDist("point", q50=np.full(len(prm["p"]), np.nan), p=prm["p"])


REGISTRY = {
    "glm_poisson": lambda **k: PoissonGLM(**k),
    "glm_poisson_nbdisp": lambda **k: PoissonGLM_NBDisp(**k),
    "glm_spline": lambda **k: SplineGLM(**k),
    "glm_nb": lambda **k: NBGLM(**k),
    "glm_tweedie": lambda **k: TweedieGLM(**k),
    "lgbm_poisson": lambda **k: LGBMCount("poisson", **k),
    "lgbm_tweedie": lambda **k: LGBMCount("tweedie", **{"tweedie_variance_power": 1.3, **k}),
    "lgbm_l1": lambda **k: LGBMCount("l1", **k),
    "xgb_poisson": lambda **k: XGBPoisson(**k),
    "cat_poisson": lambda **k: CatPoisson(**k),
    "hurdle_lgbm": lambda **k: Hurdle(**k),
    "lgbm_quantile": lambda **k: LGBMCount("quantile", **{"alpha": 0.5, **k}),
    "severity_clf": lambda **k: SeverityClassifier(**k),
}
# V3 classical benchmarks (research only): Random Forest, Extra Trees, ridge least squares, k-NN, small MLP
from dengueshield.models.classical import NEW_MODELS, ClassicalRegressor  # noqa: E402

REGISTRY.update({k: (lambda kind: (lambda **_: ClassicalRegressor(kind)))(k) for k in NEW_MODELS})


def make(name: str, **params):
    return REGISTRY[name](**params)
