#!/usr/bin/env python3
"""
Backtest comparing three GF estimation approaches against historical LF discharge.

Approaches:
  0 (baseline v24.16) : Fixed EF weight schedule, no corrections
  1 (v24.17)          : Staleness-aware EF weight boost only
  2 (PoR-delta only)  : Scale PoR estimate by PoR change ratio, no weight boost
  3 (v24.17.1)        : PoR-delta correction THEN EF weight boost (combined)

Data: ef_lf_daily_longterm.csv  (date, ef_stage, lf_discharge)
"""

import csv
import math
import os
from collections import defaultdict

# ── paths ──────────────────────────────────────────────────────────────────────
DATA_PATH = "/Users/sebjilke/Desktop/PotomacPulse/analysis/ef_lf_daily_longterm.csv"
OUT_PATH  = "/Users/sebjilke/Desktop/PotomacPulse/analysis/approach_backtest_results.csv"

# ── constants ──────────────────────────────────────────────────────────────────
EF_COEFF        = 126.0
EF_EXP          = 2.46
LAG_DAYS        = 1          # simulates ~20 h stale PoR reading
STALENESS_HOURS = 20
EF_LAG_HOURS    = 4
TRAVEL_TIME_H   = 20         # PoR -> LF travel time (hours)

# ── helpers ────────────────────────────────────────────────────────────────────

def get_ef_weight(flow):
    """Base EF weight schedule (v24.16)."""
    if flow < 3000:
        return 0.10
    elif flow < 6000:
        return 0.10
    elif flow < 15000:
        return 0.20
    else:
        return 0.50


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


# ── approach implementations ───────────────────────────────────────────────────

def approach_0_baseline(por_estimate, ef_est):
    """v24.16 baseline: fixed weight schedule, no corrections."""
    w = get_ef_weight(por_estimate)
    return (1 - w) * por_estimate + w * ef_est


def approach_1_weight_boost(por_estimate, ef_est, por_current, por_time_shifted):
    """v24.17: staleness-aware EF weight boost, no PoR correction."""
    staleness_excess = max(0, STALENESS_HOURS - EF_LAG_HOURS)
    staleness_factor = min(1.0, staleness_excess / 16.0)

    if por_time_shifted > 0:
        rate = abs(por_current - por_time_shifted) / por_time_shifted * 100.0 / STALENESS_HOURS
    else:
        rate = 0.0
    rate_factor = min(1.0, rate / 10.0)

    if por_current > por_time_shifted * 1.02:
        flow_state = "rising"
    elif por_current < por_time_shifted * 0.98:
        flow_state = "falling"
    else:
        flow_state = "steady"

    if flow_state == "rising":
        max_boost = 0.50
    elif flow_state == "falling":
        max_boost = 0.35
    else:
        max_boost = 0.0

    boost = staleness_factor * rate_factor * max_boost
    base_weight = get_ef_weight(por_estimate)
    cap = 0.70 if por_estimate >= 15000 else 0.60
    weight = min(cap, base_weight + boost)

    return (1 - weight) * por_estimate + weight * ef_est


def apply_por_delta_correction(por_estimate, por_current, por_time_shifted):
    """PoR-delta correction (shared by approaches 2 and 3)."""
    if por_time_shifted <= 0:
        return por_estimate

    por_change_ratio = por_current / por_time_shifted
    por_change_pct = (por_change_ratio - 1.0) * 100.0

    if abs(por_change_pct) > 5.0:
        fraction_elapsed = min(1.0, STALENESS_HOURS / TRAVEL_TIME_H)
        decay_factor = min(0.75, math.sqrt(fraction_elapsed))
        applied_ratio = 1.0 + (por_change_ratio - 1.0) * decay_factor
        return por_estimate * applied_ratio
    return por_estimate


def approach_2_por_delta(por_estimate, ef_est, por_current, por_time_shifted):
    """PoR-delta correction only, fixed weight schedule."""
    por_corrected = apply_por_delta_correction(por_estimate, por_current, por_time_shifted)
    w = get_ef_weight(por_corrected)
    return (1 - w) * por_corrected + w * ef_est


def approach_3_combined(por_estimate, ef_est, por_current, por_time_shifted):
    """v24.17.1: PoR-delta correction THEN EF weight boost."""
    por_corrected = apply_por_delta_correction(por_estimate, por_current, por_time_shifted)

    # Weight boost calculation uses corrected estimate
    staleness_excess = max(0, STALENESS_HOURS - EF_LAG_HOURS)
    staleness_factor = min(1.0, staleness_excess / 16.0)

    if por_time_shifted > 0:
        rate = abs(por_current - por_time_shifted) / por_time_shifted * 100.0 / STALENESS_HOURS
    else:
        rate = 0.0
    rate_factor = min(1.0, rate / 10.0)

    if por_current > por_time_shifted * 1.02:
        flow_state = "rising"
    elif por_current < por_time_shifted * 0.98:
        flow_state = "falling"
    else:
        flow_state = "steady"

    if flow_state == "rising":
        max_boost = 0.50
    elif flow_state == "falling":
        max_boost = 0.35
    else:
        max_boost = 0.0

    boost = staleness_factor * rate_factor * max_boost
    base_weight = get_ef_weight(por_corrected)
    cap = 0.70 if por_corrected >= 15000 else 0.60
    weight = min(cap, base_weight + boost)

    return (1 - weight) * por_corrected + weight * ef_est


# ── load data ──────────────────────────────────────────────────────────────────

def load_data(path):
    rows = []
    with open(path, "r") as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                stage = float(r["ef_stage"])
                discharge = float(r["lf_discharge"])
                rows.append({"date": r["date"], "ef_stage": stage, "lf_discharge": discharge})
            except (ValueError, KeyError):
                continue
    return rows


# ── run backtest ───────────────────────────────────────────────────────────────

def run_backtest():
    data = load_data(DATA_PATH)
    n = len(data)
    print(f"Loaded {n} rows from {DATA_PATH}\n")

    # We need at least LAG_DAYS+1 rows for time-shifted values and regime classification
    start_idx = max(LAG_DAYS, 1)

    # Accumulators per approach
    approach_names = [
        "0: Baseline (v24.16)",
        "1: EF weight boost only (v24.17)",
        "2: PoR-delta correction only",
        "3: Both combined (v24.17.1)",
    ]
    n_approaches = len(approach_names)

    # Per-approach, per-regime accumulators
    errors      = [[[] for _ in range(4)] for _ in range(n_approaches)]  # [approach][regime_idx] -> list of (pred-actual)
    abs_pct_err = [[[] for _ in range(4)] for _ in range(n_approaches)]
    undercount  = [0] * n_approaches  # GF < LF on rising days

    regime_map = {"rising": 0, "falling": 1, "steady": 2}  # 3 = overall

    detail_rows = []

    for i in range(start_idx, n):
        lf_actual       = data[i]["lf_discharge"]
        lf_yesterday    = data[i - 1]["lf_discharge"]
        ef_stage        = data[i]["ef_stage"]
        ef_est          = ef_estimate(ef_stage)

        por_current      = lf_actual                       # PoR ~ LF
        por_time_shifted = data[i - LAG_DAYS]["lf_discharge"]  # yesterday's LF
        por_estimate     = por_time_shifted                 # simplified: no tribs

        regime = classify_regime(lf_actual, lf_yesterday)
        regime_idx = regime_map[regime]

        estimates = [
            approach_0_baseline(por_estimate, ef_est),
            approach_1_weight_boost(por_estimate, ef_est, por_current, por_time_shifted),
            approach_2_por_delta(por_estimate, ef_est, por_current, por_time_shifted),
            approach_3_combined(por_estimate, ef_est, por_current, por_time_shifted),
        ]

        row_detail = {
            "date": data[i]["date"],
            "lf_actual": lf_actual,
            "ef_stage": ef_stage,
            "ef_est": round(ef_est, 1),
            "por_time_shifted": por_time_shifted,
            "regime": regime,
        }

        for a_idx, est in enumerate(estimates):
            err = est - lf_actual
            pct_err = abs(err) / lf_actual * 100.0 if lf_actual > 0 else 0.0

            # Overall
            errors[a_idx][3].append(err)
            abs_pct_err[a_idx][3].append(pct_err)

            # Per-regime
            errors[a_idx][regime_idx].append(err)
            abs_pct_err[a_idx][regime_idx].append(pct_err)

            # Undercount on rising days
            if regime == "rising" and est < lf_actual:
                undercount[a_idx] += 1

            row_detail[f"est_{a_idx}"] = round(est, 1)
            row_detail[f"err_{a_idx}"] = round(err, 1)

        detail_rows.append(row_detail)

    # ── compute metrics ────────────────────────────────────────────────────────
    regime_labels = ["Rising", "Falling", "Steady", "Overall"]

    def rmse(vals):
        if not vals:
            return float("nan")
        return math.sqrt(sum(v ** 2 for v in vals) / len(vals))

    def mean_val(vals):
        if not vals:
            return float("nan")
        return sum(vals) / len(vals)

    # Print header
    print("=" * 110)
    print(f"{'Metric':<30}", end="")
    for name in approach_names:
        print(f"{name:>20}", end="")
    print()
    print("=" * 110)

    result_rows = []

    for r_idx, r_label in enumerate(regime_labels):
        count = len(errors[0][r_idx]) if errors[0][r_idx] else 0

        # RMSE
        metric_name = f"RMSE ({r_label}, n={count})"
        vals = [rmse(errors[a][r_idx]) for a in range(n_approaches)]
        print(f"{metric_name:<30}", end="")
        for v in vals:
            print(f"{v:>20.1f}", end="")
        print()
        result_rows.append({"metric": metric_name, **{approach_names[a]: round(vals[a], 1) for a in range(n_approaches)}})

        # Mean bias
        metric_name = f"Mean Bias ({r_label})"
        vals = [mean_val(errors[a][r_idx]) for a in range(n_approaches)]
        print(f"{metric_name:<30}", end="")
        for v in vals:
            print(f"{v:>20.1f}", end="")
        print()
        result_rows.append({"metric": metric_name, **{approach_names[a]: round(vals[a], 1) for a in range(n_approaches)}})

        # MAPE
        metric_name = f"MAPE % ({r_label})"
        vals = [mean_val(abs_pct_err[a][r_idx]) for a in range(n_approaches)]
        print(f"{metric_name:<30}", end="")
        for v in vals:
            print(f"{v:>20.2f}", end="")
        print()
        result_rows.append({"metric": metric_name, **{approach_names[a]: round(vals[a], 2) for a in range(n_approaches)}})

        print("-" * 110)

    # Undercount on rising days
    metric_name = "Under-est on rising days"
    print(f"{metric_name:<30}", end="")
    for a in range(n_approaches):
        print(f"{undercount[a]:>20d}", end="")
    print()
    result_rows.append({"metric": metric_name, **{approach_names[a]: undercount[a] for a in range(n_approaches)}})

    # Rising day count
    rising_n = len(errors[0][0])
    metric_name = f"Rising under-est rate %"
    print(f"{metric_name:<30}", end="")
    for a in range(n_approaches):
        rate = undercount[a] / rising_n * 100 if rising_n > 0 else 0
        print(f"{rate:>20.1f}", end="")
    print()
    result_rows.append({"metric": metric_name, **{approach_names[a]: round(undercount[a] / rising_n * 100, 1) if rising_n > 0 else 0 for a in range(n_approaches)}})

    print("=" * 110)

    # ── improvement summary ────────────────────────────────────────────────────
    print("\n--- Improvement vs Baseline ---")
    baseline_rising_rmse = rmse(errors[0][0])
    baseline_overall_rmse = rmse(errors[0][3])
    baseline_steady_rmse = rmse(errors[0][2])
    for a in range(1, n_approaches):
        a_rising_rmse = rmse(errors[a][0])
        a_overall_rmse = rmse(errors[a][3])
        a_steady_rmse = rmse(errors[a][2])
        r_imp = (baseline_rising_rmse - a_rising_rmse) / baseline_rising_rmse * 100
        o_imp = (baseline_overall_rmse - a_overall_rmse) / baseline_overall_rmse * 100
        s_imp = (baseline_steady_rmse - a_steady_rmse) / baseline_steady_rmse * 100
        print(f"  {approach_names[a]}:")
        print(f"    Rising RMSE:  {a_rising_rmse:>8.1f}  ({r_imp:+.1f}% vs baseline)")
        print(f"    Steady RMSE:  {a_steady_rmse:>8.1f}  ({s_imp:+.1f}% vs baseline)")
        print(f"    Overall RMSE: {a_overall_rmse:>8.1f}  ({o_imp:+.1f}% vs baseline)")

    # ── write CSV ──────────────────────────────────────────────────────────────
    fieldnames = ["metric"] + approach_names
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(result_rows)
    print(f"\nResults written to {OUT_PATH}")


if __name__ == "__main__":
    run_backtest()
