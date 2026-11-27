"""Problem 3 (onsite): vector-control scenario simulator. Arrays built in these tests are TEST FIXTURES, not data or measured effects."""
import itertools

import numpy as np
import pytest

from dengueshield import intervention as I

EFF = I.Effect()


# ---------------------------------------------------------------- response model
def test_zero_crews_or_zero_effect_reproduce_the_forecast_exactly():
    mu = {2: np.array([3.2, 0.0, 11.7]), 3: np.array([4.1, 0.4, 13.9]), 4: np.array([5.5, 0.9, 15.2])}
    for k, eff in ((np.zeros(3), EFF), (np.array([3, 2, 1]), I.Effect(max_reduction=0.0))):
        out = I.simulate(mu, k, eff)
        for h in mu:
            assert np.array_equal(out[h]["scenario"], mu[h]) and not out[h]["prevented"].any()


def test_reduction_is_bounded_and_cases_stay_non_negative():
    rng = np.random.default_rng(1)
    for _ in range(300):
        eff = I.Effect(float(rng.uniform(0, 0.8)), float(rng.uniform(0.05, 1)), int(rng.integers(0, 4)), int(rng.integers(1, 4)))
        k, h = int(rng.integers(0, 11)), int(rng.choice(I.HORIZONS))
        r = float(I.reduction(k, h, eff))
        assert 0.0 <= r <= eff.max_reduction <= I.MAX_EFFECT
        assert (1 - r) * 7.3 >= 0


def test_diminishing_returns_and_monotone_crews():
    a = 0.35
    c = I.coverage(np.arange(0, 11), a)
    assert (np.diff(c) > 0).all() and (np.diff(np.diff(c)) < 0).all() and c[-1] < 1        # rising, concave, never full coverage
    g = I.marginal(10.0, np.arange(1, 11), EFF)
    assert (np.diff(g) < 0).all()
    mu = {h: np.array([6.0, 2.5]) for h in I.HORIZONS}
    prev = [sum(I.simulate(mu, [k, k], EFF)[h]["prevented"].sum() for h in I.HORIZONS) for k in range(8)]
    assert all(b >= a_ for a_, b in zip(prev, prev[1:]))                                    # more crews never worsen the reduction


def test_delay_and_build_up_shape_the_effect_across_horizons():
    assert [I.timing(h, 1, 2) for h in I.HORIZONS] == [0.5, 1.0, 1.0]
    assert [I.timing(h, 3, 1) for h in I.HORIZONS] == [0.0, 0.0, 1.0]
    assert [I.timing(h, 0, 1) for h in I.HORIZONS] == [1.0, 1.0, 1.0]
    out = I.simulate({h: np.array([10.0]) for h in I.HORIZONS}, [2], I.Effect(delay=3, buildup=1))
    assert out[2]["prevented"][0] == out[3]["prevented"][0] == 0 and out[4]["prevented"][0] > 0


def test_effect_caps_and_parameter_validation():
    assert I.Effect(max_reduction=0.7).scaled(1.5).max_reduction == I.MAX_EFFECT
    for bad in (dict(max_reduction=0.81), dict(coverage=0.0), dict(delay=4), dict(buildup=0), dict(sens_low=1.2), dict(sens_high=0.5)):
        with pytest.raises(ValueError):
            I.Effect(**bad).validate()


# ---------------------------------------------------------------- optimiser
def brute(weight, crews, kmax, eff):
    best = 0.0
    for ks in itertools.product(range(kmax + 1), repeat=len(weight)):
        if sum(ks) <= crews:
            best = max(best, float(sum(eff.max_reduction * w * I.coverage(k, eff.coverage) for w, k in zip(weight, ks))))
    return best


def dp(weight, crews, kmax, eff):
    """Independent exact reference: knapsack over wards with integer budget."""
    f = np.zeros(crews + 1)
    for w in weight:
        g = np.full(crews + 1, -np.inf)
        for b in range(crews + 1):
            for k in range(min(kmax, b) + 1):
                g[b] = max(g[b], f[b - k] + eff.max_reduction * w * float(I.coverage(k, eff.coverage)))
        f = g
    return float(f.max())


def value(weight, k, eff):
    return float(sum(eff.max_reduction * w * I.coverage(x, eff.coverage) for w, x in zip(weight, k)))


def test_greedy_optimum_matches_brute_force_and_dynamic_programming():
    rng = np.random.default_rng(5)
    for _ in range(120):
        n, kmax = int(rng.integers(1, 5)), int(rng.integers(1, 4))
        crews = int(rng.integers(0, n * kmax + 2))
        eff = I.Effect(float(rng.uniform(0.05, 0.8)), float(rng.choice([0.2, 0.35, 0.6, 1.0])))
        w = np.round(rng.uniform(0, 30, n), 2) * (rng.random(n) > 0.15)                        # some wards with no projected cases
        k = I.optimise(w, crews, kmax, eff, [(0, f"W{i}") for i in range(n)])
        assert k.sum() <= crews and (k >= 0).all() and (k <= kmax).all()                         # budget conservation
        assert abs(value(w, k, eff) - brute(w, crews, kmax, eff)) < 1e-9
        assert abs(value(w, k, eff) - dp(w, crews, kmax, eff)) < 1e-9


def test_optimiser_ties_crews_left_unassigned_and_maximum_budget():
    k = I.optimise(np.array([5.0, 5.0, 5.0]), 2, 3, EFF, [(-0.2, "A"), (-0.9, "B"), (-0.5, "C")])
    assert list(k) == [0, 1, 1]                                                                   # equal value: higher outbreak probability first
    k = I.optimise(np.array([4.0, 0.0]), 10, 3, EFF, [(0, "A"), (0, "B")])
    assert list(k) == [3, 0]                                                                      # no value in B, cap of 3 in A: 7 crews unassigned
    k = I.optimise(np.array([4.0, 2.0]), 5, 2, I.Effect(coverage=1.0), [(0, "A"), (0, "B")])
    assert list(k) == [1, 1]                                                                      # full coverage: a second crew adds nothing
