"""Automated feature-quality and redundancy analysis. Everything is computed inside training boundaries or
reported descriptively; nothing here removes a feature by itself (the report decides, per model)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from scipy.stats import ks_2samp


def profile(X: pd.DataFrame) -> pd.DataFrame:
    """Missingness, constants, near-constants, magnitude and skew per feature."""
    A = X.to_numpy(float)
    q = np.nanquantile(A, [0.01, 0.5, 0.99], axis=0)
    mad = np.nanmedian(np.abs(A - q[1]), axis=0) * 1.4826
    sd = np.nanstd(A, axis=0)
    top = np.array([X[c].round(6).value_counts(normalize=True, dropna=True).iloc[0] if X[c].notna().any() else np.nan for c in X])
    with np.errstate(all="ignore"):
        z = np.nanmax(np.abs(A - q[1]), axis=0) / np.where(mad > 0, mad, sd)
        skew = pd.DataFrame(A, columns=X.columns).skew().to_numpy()
    return pd.DataFrame({"feature": X.columns, "missing_frac": np.isnan(A).mean(0), "n_unique": X.nunique().to_numpy(),
                         "top_value_share": top, "constant": X.nunique().to_numpy() <= 1, "near_constant": top > 0.99,
                         "min": np.nanmin(A, 0), "max": np.nanmax(A, 0), "mean": np.nanmean(A, 0), "sd": sd,
                         "max_robust_z": z, "skew": skew})


def duplicates(X: pd.DataFrame, thr: float = 0.9999) -> pd.DataFrame:
    """Features that are (rescaled) copies of an earlier column, plus exact constants."""
    C = X.corr().abs().to_numpy()
    cols, rows = list(X.columns), []
    for j in range(len(cols)):
        if X[cols[j]].nunique() <= 1:
            rows.append((cols[j], "(constant)", 1.0))
            continue
        for i in range(j):
            if C[i, j] >= thr and X[cols[i]].nunique() > 1:
                rows.append((cols[j], cols[i], float(C[i, j])))
                break
    return pd.DataFrame(rows, columns=["duplicate", "duplicates_of", "abs_corr"])


def clusters(X: pd.DataFrame, thr: float = 0.95, sample: int = 8000, seed: int = 2026) -> pd.DataFrame:
    """Hierarchical clusters of features with |Pearson| >= thr (average linkage). Information only; no removal."""
    S = X.sample(min(sample, len(X)), random_state=seed)
    S = S.loc[:, S.nunique() > 1]
    C = S.corr().abs().fillna(0).to_numpy()
    D = 1 - C
    np.fill_diagonal(D, 0)
    lab = fcluster(linkage(squareform(D, checks=False), "average"), 1 - thr, "distance")
    return pd.DataFrame({"feature": S.columns, "cluster": lab}).assign(size=lambda d: d.groupby("cluster").feature.transform("size"))


def vif(X: pd.DataFrame, sample: int = 8000, seed: int = 2026, ridge: float = 1e-8) -> pd.Series:
    S = X.sample(min(sample, len(X)), random_state=seed)
    S = S.loc[:, S.nunique() > 1].fillna(S.median())
    Z = (S - S.mean()) / S.std()
    R = np.corrcoef(Z.to_numpy().T) + ridge * np.eye(Z.shape[1])
    return pd.Series(np.diag(np.linalg.inv(R)), index=S.columns, name="vif")


def condition_number(X: pd.DataFrame, sample: int = 8000, seed: int = 2026) -> float:
    S = X.sample(min(sample, len(X)), random_state=seed)
    S = S.loc[:, S.nunique() > 1].fillna(S.median())
    return float(np.linalg.cond(np.corrcoef(((S - S.mean()) / S.std()).to_numpy().T)))


def year_shift(Xtr: pd.DataFrame, Xev: pd.DataFrame, n: int = 3000, seed: int = 2026) -> pd.DataFrame:
    """Train-vs-evaluation shift: standardised mean difference (SMD) and KS statistic per feature."""
    rng = np.random.default_rng(seed)
    a, b = Xtr.sample(min(n, len(Xtr)), random_state=seed), Xev.sample(min(n, len(Xev)), random_state=seed)
    rows = []
    sd = Xtr.std().replace(0, np.nan)
    for c in Xtr.columns:
        x, y = a[c].dropna(), b[c].dropna()
        ks = ks_2samp(x, y).statistic if len(x) > 5 and len(y) > 5 else np.nan
        rows.append((c, float((Xev[c].mean() - Xtr[c].mean()) / sd[c]), float(ks)))
    return pd.DataFrame(rows, columns=["feature", "smd", "ks"])


def city_stability(X: pd.DataFrame, y: np.ndarray, city: np.ndarray) -> pd.DataFrame:
    """Spearman correlation of each feature with the target inside each city (training rows)."""
    R = X.rank()
    yr = pd.Series(y).rank().to_numpy()
    out = {}
    for c in np.unique(city):
        m = city == c
        out[c] = R[m].corrwith(pd.Series(yr[m], index=R[m].index))
    t = pd.DataFrame(out)
    return pd.DataFrame({"feature": t.index, "city_min": t.min(1).to_numpy(), "city_max": t.max(1).to_numpy(),
                         "city_range": (t.max(1) - t.min(1)).to_numpy(),
                         "sign_flip": ((t.min(1) < -0.02) & (t.max(1) > 0.02)).to_numpy()})


def target_correlation(X: pd.DataFrame, y: np.ndarray) -> pd.Series:
    return X.rank().corrwith(pd.Series(y).rank().set_axis(X.index))
