#!/usr/bin/env python3
"""
Backtest: PoR-delta decay cap × soft LF ceiling grid search.

Tests 16 configurations (4 decay caps × 4 ceiling thresholds) against
5,220 historical observations to find the optimal combination.

Uses v27.0 gradient EF weight function (piecewise-linear interpolation).

Data: ef_lf_daily_longterm.csv  (date, ef_stage, lf_discharge)
"""

import csv
import math
import os
from itertools import product

# ── paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(SCRIPT_DIR, "ef_lf_daily_longterm.csv")
OUT_PATH = os.path.join(SCRIPT_DIR, "backtest_delta_cap_results.csv")

# ── constants ──────────────────────────────────────────────────────────────────
EF_COEFF = 126.0
EF_EXP = 2.46
LAG_DAYS = 1  # simulates ~20h stale PoR reading
STALENESS_HOURS = 20
TRAVEL_TIME_H = 20  # PoR → LF travel time (hours)

# ── grid search parameters ─────────────────────────────────────────────────────
DECAY_CAPS = [0.40, 0.50, 0.60, 0.75]
# Ceiling: max ratio of GF estimate to LF actual. None = no ceiling.
CEILING_RATIOS = [None, 1.10, 1.15, 1.20]

# ── v27.0 gradient EF weight ──────────────────────────────────────────────────
ANCHORS = [(0, 0.0), (3000, 0.0), (6000, 0.1), (10000, 0.4),
           (15000, 0.4), (25000, 0.4), (50000, 0.4)]

def get_ef_weight(flow):
    """v27.0 piecewise-linear gradient EF weight."""
    if flow <= 0:
        return 0.0
    if flow >= 50000:
        return 0.4
    for i in range(1, len(ANCHORS)):
        if flow <= ANCHORS[i][0]:
            f0, w0 = ANCHORS[i - 1]
            f1, w1 = ANCHORS[i]
            return w0 + (w1 - w0) * (flow - f0) / (f1 - f0)
    return 0.4


def ef_estimate(stage):
    """EF power-law estimate (default coefficients)."""
    return EF_COEFF * (stage ** EF_EXP)


def classify_regime(lf_today, lf_yesterday):
    """Classify flow regime based on day-over-day change."""
    if lf_today > lf_yesterday * 1.05:
        return "rising"
    elif lf_today < lf_yesterday * 0.95:
        return "falling"
    return "steady"


# ── estimation function ───────────────────────────────────────────────────────

def estimate_gf(por_time_shifted, por_current, ef_stage_val, lf_actual,
                decay_cap, ceiling_ratio):
    """
    Estimate GF discharge with a given decay cap and optional soft ceiling.

    Uses lag-1 LF as PoR proxy (same methodology as gradient weight optimization).
    """
    # EF estimate from power-law
    ef_est = ef_estimate(ef_stage_val)

    # Base estimate = time-shifted PoR (no tributaries in daily backtest —
    # they're already included in LF actual which is our PoR proxy)
    base_estimate = por_time_shifted

    # PoR-delta correction
    if por_time_shifted > 0:
        por_change_ratio = por_current / por_time_shifted
        por_change_pct = (por_change_ratio - 1.0) * 100.0

        if abs(por_change_pct) > 5.0:
            fraction_elapsed = min(1.0, STALENESS_HOURS / TRAVEL_TIME_H)
            decay_factor = min(decay_cap, math.sqrt(fraction_elapsed))
            applied_ratio = 1.0 + (por_change_ratio - 1.0) * decay_factor
            base_estimate = por_time_shifted * applied_ratio

    # EF ensemble blend (v27.0 gradient weights)
    w = get_ef_weight(base_estimate)
    blended = (1 - w) * base_estimate + w * ef_est

    # Soft LF ceiling
    if ceiling_ratio is not None and lf_actual > 0:
        max_estimate = lf_actual * ceiling_ratio
        if blended > max_estimate:
            blended = max_estimate

    return blended


# ── load data ──────────────────────────────────────────────────────────────────

def load_data(path):
    rows = []
    seen = set()
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                date = r["date"]
                if date in seen:
                    continue
                seen.add(date)
                stage = float(r["ef_stage"])
                discharge = float(r["lf_discharge"])
                if stage > 0 and discharge > 0:
                    rows.append({"date": date, "ef_stage": stage, "lf_discharge": discharge})
            except (ValueError, KeyError):
                continue
    rows.sort(key=lambda x: x["date"])
    return rows


# ── metrics ────────────────────────────────────────────────────────────────────

def rmse(errors):
    if not errors:
        return float("nan")
    return math.sqrt(sum(e ** 2 for e in errors) / len(errors))

def mean_bias(errors):
    if not errors:
        return float("nan")
    return sum(errors) / len(errors)

def mape(pct_errors):
    if not pct_errors:
        return float("nan")
    return sum(pct_errors) / len(pct_errors)


# ── run backtest ───────────────────────────────────────────────────────────────

def run_backtest():
    data = load_data(DATA_PATH)
    n = len(data)
    print(f"Loaded {n} rows from {DATA_PATH}")

    # Build consecutive-day pairs (same as gradient optimization)
    pairs = []
    for i in range(1, n):
        d0, d1 = data[i-1]["date"], data[i]["date"]
        # Check consecutive dates
        y0, m0, dd0 = int(d0[:4]), int(d0[5:7]), int(d0[8:10])
        y1, m1, dd1 = int(d1[:4]), int(d1[5:7]), int(d1[8:10])
        from datetime import date as dt
        if (dt(y1, m1, dd1) - dt(y0, m0, dd0)).days == 1:
            pairs.append((data[i-1], data[i]))

    print(f"Built {len(pairs)} consecutive-day pairs\n")

    # Configuration grid
    configs = list(product(DECAY_CAPS, CEILING_RATIOS))
    config_names = []
    for dc, cr in configs:
        cr_str = f"{int(cr*100)}%" if cr else "none"
        config_names.append(f"decay={dc:.2f}_ceil={cr_str}")

    # Accumulators: [config_idx] -> { regime -> [errors] }
    regime_names = ["rising", "falling", "steady", "overall"]
    errors_by_config = [{r: [] for r in regime_names} for _ in configs]
    pct_errors_by_config = [{r: [] for r in regime_names} for _ in configs]
    ceiling_triggers = [0 for _ in configs]

    for yesterday, today in pairs:
        lf_actual = today["lf_discharge"]
        lf_yesterday = yesterday["lf_discharge"]
        ef_stage_val = today["ef_stage"]

        # Proxies (same as gradient optimization)
        por_current = lf_actual  # PoR ≈ LF
        por_time_shifted = lf_yesterday  # yesterday's LF as lag-1 proxy

        regime = classify_regime(lf_actual, lf_yesterday)

        for c_idx, (decay_cap, ceiling_ratio) in enumerate(configs):
            est = estimate_gf(por_time_shifted, por_current, ef_stage_val,
                              lf_actual, decay_cap, ceiling_ratio)

            err = est - lf_actual
            pct_err = abs(err) / lf_actual * 100.0 if lf_actual > 0 else 0

            errors_by_config[c_idx]["overall"].append(err)
            errors_by_config[c_idx][regime].append(err)
            pct_errors_by_config[c_idx]["overall"].append(pct_err)
            pct_errors_by_config[c_idx][regime].append(pct_err)

            # Track ceiling triggers
            if ceiling_ratio is not None and lf_actual > 0:
                base_est = estimate_gf(por_time_shifted, por_current, ef_stage_val,
                                       lf_actual, decay_cap, None)
                if base_est > lf_actual * ceiling_ratio:
                    ceiling_triggers[c_idx] += 1

    # ── results table ──────────────────────────────────────────────────────────
    print("=" * 140)
    print(f"{'Configuration':<30} {'Overall RMSE':>14} {'Rising RMSE':>14} {'Falling RMSE':>14} "
          f"{'Steady RMSE':>14} {'Overall Bias':>14} {'Rising Bias':>14} {'Ceil Triggers':>14}")
    print("=" * 140)

    results = []
    for c_idx, name in enumerate(config_names):
        dc, cr = configs[c_idx]
        o_rmse = rmse(errors_by_config[c_idx]["overall"])
        r_rmse = rmse(errors_by_config[c_idx]["rising"])
        f_rmse = rmse(errors_by_config[c_idx]["falling"])
        s_rmse = rmse(errors_by_config[c_idx]["steady"])
        o_bias = mean_bias(errors_by_config[c_idx]["overall"])
        r_bias = mean_bias(errors_by_config[c_idx]["rising"])
        o_mape = mape(pct_errors_by_config[c_idx]["overall"])
        ct = ceiling_triggers[c_idx]

        print(f"{name:<30} {o_rmse:>14.1f} {r_rmse:>14.1f} {f_rmse:>14.1f} "
              f"{s_rmse:>14.1f} {o_bias:>+14.1f} {r_bias:>+14.1f} {ct:>14d}")

        results.append({
            "config": name,
            "decay_cap": dc,
            "ceiling_ratio": cr if cr else "none",
            "overall_rmse": round(o_rmse, 1),
            "rising_rmse": round(r_rmse, 1),
            "falling_rmse": round(f_rmse, 1),
            "steady_rmse": round(s_rmse, 1),
            "overall_bias": round(o_bias, 1),
            "rising_bias": round(r_bias, 1),
            "overall_mape": round(o_mape, 2),
            "ceiling_triggers": ct,
            "n_rising": len(errors_by_config[c_idx]["rising"]),
            "n_falling": len(errors_by_config[c_idx]["falling"]),
            "n_steady": len(errors_by_config[c_idx]["steady"]),
            "n_overall": len(errors_by_config[c_idx]["overall"]),
        })

    print("=" * 140)

    # ── find winner ────────────────────────────────────────────────────────────
    best_overall = min(results, key=lambda x: x["overall_rmse"])
    best_rising = min(results, key=lambda x: x["rising_rmse"])

    print(f"\n🏆 Best Overall RMSE: {best_overall['config']} → {best_overall['overall_rmse']} cfs")
    print(f"   Rising RMSE: {best_overall['rising_rmse']}, Bias: {best_overall['rising_bias']:+.1f}")
    print(f"   Ceiling triggers: {best_overall['ceiling_triggers']}/{best_overall['n_overall']}")

    print(f"\n🏆 Best Rising RMSE: {best_rising['config']} → {best_rising['rising_rmse']} cfs")
    print(f"   Overall RMSE: {best_rising['overall_rmse']}, Bias: {best_rising['overall_bias']:+.1f}")

    # ── current baseline comparison ────────────────────────────────────────────
    baseline = next(r for r in results if r["decay_cap"] == 0.75 and r["ceiling_ratio"] == "none")
    print(f"\n📊 Current v27.0 baseline (decay=0.75, no ceiling):")
    print(f"   Overall RMSE: {baseline['overall_rmse']}, Rising RMSE: {baseline['rising_rmse']}")
    print(f"   Overall Bias: {baseline['overall_bias']:+.1f}, Rising Bias: {baseline['rising_bias']:+.1f}")

    if best_overall['config'] != baseline['config']:
        imp = (baseline['overall_rmse'] - best_overall['overall_rmse']) / baseline['overall_rmse'] * 100
        print(f"\n   → Winner improves Overall RMSE by {imp:.1f}%")
        r_imp = (baseline['rising_rmse'] - best_overall['rising_rmse']) / baseline['rising_rmse'] * 100
        print(f"   → Winner changes Rising RMSE by {r_imp:+.1f}%")
    else:
        print(f"\n   → Current baseline IS the winner!")

    # ── write CSV ──────────────────────────────────────────────────────────────
    fieldnames = list(results[0].keys())
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)
    print(f"\nResults written to {OUT_PATH}")


if __name__ == "__main__":
    run_backtest()
