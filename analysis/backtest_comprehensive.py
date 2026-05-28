#!/usr/bin/env python3
"""
Comprehensive backtest: PoR-delta decay cap × soft LF ceiling grid search.

Runs on BOTH datasets:
  1. Daily (5,208 pairs, 2011-2026) — lag-1 proxy
  2. Hourly (~40,000+ pairs, 2021-2026) — actual travel-time-shifted PoR

Grid: 5 decay caps × 5 ceiling ratios = 25 configurations.
Uses v27.0 gradient EF weight function.

Output:
  - backtest_comprehensive_daily.csv
  - backtest_comprehensive_hourly.csv
  - backtest_comprehensive_combined.csv  (winner selection)
"""

import csv
import math
import os
from datetime import date as dt_date
from itertools import product

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DAILY_PATH = os.path.join(SCRIPT_DIR, "ef_lf_daily_longterm.csv")
HOURLY_PATH = os.path.join(SCRIPT_DIR, "hourly_backtest_data.csv")
OUT_DAILY = os.path.join(SCRIPT_DIR, "backtest_comprehensive_daily.csv")
OUT_HOURLY = os.path.join(SCRIPT_DIR, "backtest_comprehensive_hourly.csv")
OUT_COMBINED = os.path.join(SCRIPT_DIR, "backtest_comprehensive_combined.csv")

# ── constants ──────────────────────────────────────────────────────────────────
EF_COEFF = 126.0
EF_EXP = 2.46
EF_COEFF_COLD = 160.0
EF_EXP_COLD = 2.36
COLD_THRESHOLD_C = 10.0
STALENESS_HOURS = 20
TRAVEL_TIME_H = 20  # for daily proxy only

# ── grid search parameters ────────────────────────────────────────────────────
DECAY_CAPS = [0.30, 0.40, 0.50, 0.60, 0.75]
CEILING_RATIOS = [None, 1.05, 1.10, 1.15, 1.20]

# ── v27.0 gradient EF weight ─────────────────────────────────────────────────
ANCHORS = [(0, 0.0), (3000, 0.0), (6000, 0.1), (10000, 0.4),
           (15000, 0.4), (25000, 0.4), (50000, 0.4)]


def get_ef_weight(flow):
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


def ef_estimate(stage, temp_c=None):
    """EF power-law. Use cold-water coefficients if temp <= 10C."""
    if temp_c is not None and temp_c <= COLD_THRESHOLD_C:
        return EF_COEFF_COLD * (stage ** EF_EXP_COLD)
    return EF_COEFF * (stage ** EF_EXP)


def estimate_gf(por_old, por_new, ef_stage_val, lf_actual,
                decay_cap, ceiling_ratio, staleness_h, travel_h,
                temp_c=None):
    """
    Core GF estimation with configurable decay cap and ceiling.

    por_old:  time-shifted PoR (yesterday for daily, travel-time-lagged for hourly)
    por_new:  current PoR reading
    ef_stage_val: current EF stage
    lf_actual: current LF discharge (used for ceiling only)
    staleness_h: how old the PoR reading is (hours)
    travel_h: PoR→GF travel time (hours)
    """
    ef_est = ef_estimate(ef_stage_val, temp_c)
    base = por_old

    # PoR-delta correction
    if por_old > 0:
        ratio = por_new / por_old
        change_pct = (ratio - 1.0) * 100.0
        if abs(change_pct) > 5.0:
            frac = min(1.0, staleness_h / max(1, travel_h))
            decay = min(decay_cap, math.sqrt(frac))
            applied = 1.0 + (ratio - 1.0) * decay
            base = por_old * applied

    # EF blend
    w = get_ef_weight(base)
    est = (1.0 - w) * base + w * ef_est

    # Soft ceiling
    if ceiling_ratio is not None and lf_actual > 0 and est > lf_actual * ceiling_ratio:
        est = lf_actual * ceiling_ratio

    return est


def classify_regime(current, previous):
    if current > previous * 1.05:
        return "rising"
    elif current < previous * 0.95:
        return "falling"
    return "steady"


# ── metrics ───────────────────────────────────────────────────────────────────

def rmse(errors):
    return math.sqrt(sum(e ** 2 for e in errors) / len(errors)) if errors else float("nan")

def bias(errors):
    return sum(errors) / len(errors) if errors else float("nan")

def mape(errors, actuals):
    if not errors:
        return float("nan")
    pcts = [abs(e) / a * 100 for e, a in zip(errors, actuals) if a > 0]
    return sum(pcts) / len(pcts) if pcts else float("nan")


# ── load daily data ──────────────────────────────────────────────────────────

def load_daily():
    rows = []
    seen = set()
    with open(DAILY_PATH) as f:
        for r in csv.DictReader(f):
            d = r["date"]
            if d in seen:
                continue
            seen.add(d)
            try:
                s = float(r["ef_stage"])
                q = float(r["lf_discharge"])
            except (ValueError, KeyError):
                continue
            if s > 0 and q > 0:
                rows.append((d, s, q))
    rows.sort(key=lambda x: x[0])
    return rows


def build_daily_pairs(rows):
    pairs = []
    for i in range(1, len(rows)):
        d0, d1 = rows[i-1][0], rows[i][0]
        date0 = dt_date(int(d0[:4]), int(d0[5:7]), int(d0[8:10]))
        date1 = dt_date(int(d1[:4]), int(d1[5:7]), int(d1[8:10]))
        if (date1 - date0).days == 1:
            pairs.append((rows[i-1], rows[i]))
    return pairs


# ── load hourly data ─────────────────────────────────────────────────────────

def load_hourly():
    """Load hourly backtest data with travel-time-shifted PoR."""
    rows = []
    with open(HOURLY_PATH) as f:
        for r in csv.DictReader(f):
            try:
                por_now = float(r["por_now"])
                por_lagged = float(r["por_lagged"])
                ef_stg = float(r["ef_stage"])
                lf_q = float(r["lf_discharge"])
                travel_h = float(r["travel_time_h"])
                temp_str = r.get("water_temp_c", "")
                temp_c = float(temp_str) if temp_str else None
            except (ValueError, KeyError):
                continue
            if por_now > 0 and por_lagged > 0 and ef_stg > 0 and lf_q > 0:
                rows.append({
                    "ts": r["timestamp"],
                    "por_now": por_now,
                    "por_lagged": por_lagged,
                    "ef_stage": ef_stg,
                    "lf_discharge": lf_q,
                    "travel_h": travel_h,
                    "temp_c": temp_c,
                })
    return rows


def build_hourly_pairs(rows):
    """Build consecutive-hour pairs for regime classification."""
    pairs = []
    for i in range(1, len(rows)):
        pairs.append((rows[i-1], rows[i]))
    return pairs


# ── run backtest on one dataset ──────────────────────────────────────────────

def run_grid(dataset_name, pairs, get_inputs_fn):
    """
    Run 25-config grid search on a set of pairs.

    get_inputs_fn(yesterday, today) -> (por_old, por_new, ef_stage, lf_actual,
                                         lf_yesterday, staleness_h, travel_h, temp_c)
    """
    configs = list(product(DECAY_CAPS, CEILING_RATIOS))
    regime_names = ["rising", "falling", "steady", "overall"]

    # Accumulators per config
    errors_by_config = [{r: [] for r in regime_names} for _ in configs]
    actuals_by_config = [{r: [] for r in regime_names} for _ in configs]
    ceiling_triggers = [0 for _ in configs]

    for prev, curr in pairs:
        inputs = get_inputs_fn(prev, curr)
        por_old, por_new, ef_stg, lf_actual, lf_yesterday, stale_h, travel_h, temp_c = inputs

        regime = classify_regime(lf_actual, lf_yesterday)

        for c_idx, (dcap, cratio) in enumerate(configs):
            est = estimate_gf(por_old, por_new, ef_stg, lf_actual,
                              dcap, cratio, stale_h, travel_h, temp_c)
            err = est - lf_actual

            errors_by_config[c_idx]["overall"].append(err)
            errors_by_config[c_idx][regime].append(err)
            actuals_by_config[c_idx]["overall"].append(lf_actual)
            actuals_by_config[c_idx][regime].append(lf_actual)

            # Track ceiling triggers
            if cratio is not None and lf_actual > 0:
                est_no_ceil = estimate_gf(por_old, por_new, ef_stg, lf_actual,
                                          dcap, None, stale_h, travel_h, temp_c)
                if est_no_ceil > lf_actual * cratio:
                    ceiling_triggers[c_idx] += 1

    # Build results
    results = []
    print(f"\n{'=' * 140}")
    print(f"  {dataset_name} RESULTS")
    print(f"{'=' * 140}")
    print(f"{'Configuration':<32} {'Overall RMSE':>13} {'Rising RMSE':>13} {'Falling RMSE':>14} "
          f"{'Steady RMSE':>13} {'Overall Bias':>13} {'Rising Bias':>13} {'Ceil Trig':>10}")
    print("-" * 140)

    for c_idx, (dcap, cratio) in enumerate(configs):
        cr_str = f"{int(cratio*100)}%" if cratio else "none"
        name = f"decay={dcap:.2f}_ceil={cr_str}"

        o_rmse = rmse(errors_by_config[c_idx]["overall"])
        r_rmse = rmse(errors_by_config[c_idx]["rising"])
        f_rmse = rmse(errors_by_config[c_idx]["falling"])
        s_rmse = rmse(errors_by_config[c_idx]["steady"])
        o_bias = bias(errors_by_config[c_idx]["overall"])
        r_bias = bias(errors_by_config[c_idx]["rising"])
        o_mape = mape(errors_by_config[c_idx]["overall"],
                       actuals_by_config[c_idx]["overall"])
        ct = ceiling_triggers[c_idx]

        n_rise = len(errors_by_config[c_idx]["rising"])
        n_fall = len(errors_by_config[c_idx]["falling"])
        n_steady = len(errors_by_config[c_idx]["steady"])
        n_all = len(errors_by_config[c_idx]["overall"])

        print(f"{name:<32} {o_rmse:>13.1f} {r_rmse:>13.1f} {f_rmse:>14.1f} "
              f"{s_rmse:>13.1f} {o_bias:>+13.1f} {r_bias:>+13.1f} {ct:>10d}")

        results.append({
            "config": name,
            "decay_cap": dcap,
            "ceiling_ratio": cratio if cratio else "none",
            "overall_rmse": round(o_rmse, 1),
            "rising_rmse": round(r_rmse, 1),
            "falling_rmse": round(f_rmse, 1),
            "steady_rmse": round(s_rmse, 1),
            "overall_bias": round(o_bias, 1),
            "rising_bias": round(r_bias, 1),
            "overall_mape": round(o_mape, 2),
            "ceiling_triggers": ct,
            "n_rising": n_rise,
            "n_falling": n_fall,
            "n_steady": n_steady,
            "n_overall": n_all,
        })

    print("-" * 140)

    # Find winner
    best = min(results, key=lambda x: x["overall_rmse"])
    baseline = next((r for r in results if r["decay_cap"] == 0.75 and r["ceiling_ratio"] == "none"), None)

    print(f"\n  Best Overall RMSE: {best['config']} -> {best['overall_rmse']} cfs")
    print(f"    Rising RMSE: {best['rising_rmse']}, Rising Bias: {best['rising_bias']:+.1f}")
    if baseline and best["config"] != baseline["config"]:
        imp = (baseline["overall_rmse"] - best["overall_rmse"]) / baseline["overall_rmse"] * 100
        r_imp = (baseline["rising_rmse"] - best["rising_rmse"]) / baseline["rising_rmse"] * 100
        print(f"    vs baseline: Overall {imp:+.1f}%, Rising {r_imp:+.1f}%")

    return results


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("COMPREHENSIVE BACKTEST: PoR-delta decay cap × LF ceiling")
    print("=" * 70)

    # ── Daily backtest ────────────────────────────────────────────────────
    print("\n--- Loading daily data ---")
    daily_rows = load_daily()
    daily_pairs = build_daily_pairs(daily_rows)
    print(f"Daily: {len(daily_rows)} rows, {len(daily_pairs)} consecutive-day pairs")

    def daily_inputs(prev, curr):
        d0, s0, q0 = prev
        d1, s1, q1 = curr
        # por_old=yesterday's LF, por_new=today's LF, ef_stage=today's EF
        return (q0, q1, s1, q1, q0, STALENESS_HOURS, TRAVEL_TIME_H, None)

    daily_results = run_grid("DAILY (2011-2026, lag-1 proxy)", daily_pairs, daily_inputs)

    # Write daily CSV
    with open(OUT_DAILY, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(daily_results[0].keys()))
        writer.writeheader()
        writer.writerows(daily_results)
    print(f"\nDaily results written to {OUT_DAILY}")

    # ── Hourly backtest ───────────────────────────────────────────────────
    if not os.path.exists(HOURLY_PATH):
        print(f"\n*** Hourly data not found at {HOURLY_PATH}")
        print("*** Run fetch_hourly_backtest_data.py first!")
        print("*** Skipping hourly backtest.\n")
        hourly_results = None
    else:
        print("\n--- Loading hourly data ---")
        hourly_rows = load_hourly()
        hourly_pairs = build_hourly_pairs(hourly_rows)
        print(f"Hourly: {len(hourly_rows)} rows, {len(hourly_pairs)} consecutive-hour pairs")

        def hourly_inputs(prev, curr):
            # por_old = travel-time-shifted PoR
            # por_new = current PoR
            # staleness approximated from travel time
            return (curr["por_lagged"], curr["por_now"], curr["ef_stage"],
                    curr["lf_discharge"], prev["lf_discharge"],
                    curr["travel_h"], curr["travel_h"], curr.get("temp_c"))

        hourly_results = run_grid("HOURLY (2021-2026, travel-time-shifted PoR)",
                                  hourly_pairs, hourly_inputs)

        # Write hourly CSV
        with open(OUT_HOURLY, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(hourly_results[0].keys()))
            writer.writeheader()
            writer.writerows(hourly_results)
        print(f"\nHourly results written to {OUT_HOURLY}")

    # ── Combined winner selection ─────────────────────────────────────────
    if hourly_results:
        print("\n" + "=" * 70)
        print("COMBINED WINNER SELECTION (50% daily + 50% hourly)")
        print("=" * 70)

        combined = []
        for dr in daily_results:
            # Find matching hourly result
            hr = next((h for h in hourly_results
                        if h["decay_cap"] == dr["decay_cap"]
                        and h["ceiling_ratio"] == dr["ceiling_ratio"]), None)
            if hr:
                combined_rmse = 0.5 * dr["overall_rmse"] + 0.5 * hr["overall_rmse"]
                combined_rise = 0.5 * dr["rising_rmse"] + 0.5 * hr["rising_rmse"]
                combined.append({
                    "config": dr["config"],
                    "decay_cap": dr["decay_cap"],
                    "ceiling_ratio": dr["ceiling_ratio"],
                    "daily_overall_rmse": dr["overall_rmse"],
                    "daily_rising_rmse": dr["rising_rmse"],
                    "daily_rising_bias": dr["rising_bias"],
                    "hourly_overall_rmse": hr["overall_rmse"],
                    "hourly_rising_rmse": hr["rising_rmse"],
                    "hourly_rising_bias": hr["rising_bias"],
                    "combined_overall_rmse": round(combined_rmse, 1),
                    "combined_rising_rmse": round(combined_rise, 1),
                    "daily_n": dr["n_overall"],
                    "hourly_n": hr["n_overall"],
                    "daily_ceil_triggers": dr["ceiling_triggers"],
                    "hourly_ceil_triggers": hr["ceiling_triggers"],
                })

        # Sort by combined RMSE
        combined.sort(key=lambda x: x["combined_overall_rmse"])

        print(f"\n{'Config':<32} {'Daily RMSE':>11} {'Hourly RMSE':>12} {'Combined':>10} "
              f"{'D Rise Bias':>12} {'H Rise Bias':>12}")
        print("-" * 100)
        for c in combined:
            print(f"{c['config']:<32} {c['daily_overall_rmse']:>11.1f} "
                  f"{c['hourly_overall_rmse']:>12.1f} {c['combined_overall_rmse']:>10.1f} "
                  f"{c['daily_rising_bias']:>+12.1f} {c['hourly_rising_bias']:>+12.1f}")

        winner = combined[0]
        baseline = next((c for c in combined
                         if c["decay_cap"] == 0.75 and c["ceiling_ratio"] == "none"), None)

        print(f"\n  WINNER: {winner['config']}")
        print(f"    Combined RMSE: {winner['combined_overall_rmse']}")
        print(f"    Daily:  Overall={winner['daily_overall_rmse']}, "
              f"Rising Bias={winner['daily_rising_bias']:+.1f}")
        print(f"    Hourly: Overall={winner['hourly_overall_rmse']}, "
              f"Rising Bias={winner['hourly_rising_bias']:+.1f}")

        if baseline and winner["config"] != baseline["config"]:
            imp = (baseline["combined_overall_rmse"] - winner["combined_overall_rmse"]) / \
                  baseline["combined_overall_rmse"] * 100
            print(f"    vs baseline: {imp:+.1f}% Combined RMSE improvement")

        # Check if daily and hourly agree
        daily_best = min(daily_results, key=lambda x: x["overall_rmse"])
        hourly_best = min(hourly_results, key=lambda x: x["overall_rmse"])
        print(f"\n  Daily-only winner:  {daily_best['config']} (RMSE={daily_best['overall_rmse']})")
        print(f"  Hourly-only winner: {hourly_best['config']} (RMSE={hourly_best['overall_rmse']})")
        if daily_best["config"] == hourly_best["config"]:
            print("  *** Daily and hourly AGREE! High confidence. ***")
        else:
            print("  *** Daily and hourly DISAGREE — investigate. ***")

        # Write combined CSV
        with open(OUT_COMBINED, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(combined[0].keys()))
            writer.writeheader()
            writer.writerows(combined)
        print(f"\nCombined results written to {OUT_COMBINED}")

    print("\nDone!")


if __name__ == "__main__":
    main()
