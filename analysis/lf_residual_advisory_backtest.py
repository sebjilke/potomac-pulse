"""LF-residual advisory backtest (v37.15 candidate — decision gate, 2026-07-22).

Question: would a display-only advisory driven by the model's own validated
LF residual (not EF) have (1) acceptable duty, (2) covered the below-PoR event
windows including the below-EF ones the EF detector is blind to, and (3) fired
on hours that are genuinely degraded rather than fine?

Production fidelity:
- Signal stream = v38_residuals_single.csv (single-pending cadence, disp_c0 =
  the displayed production-equivalent prediction). A pair becomes observable at
  its valTs — never earlier. err = (disp_c0 - actualLF) / actualLF.
- Advisory state is a server-side deadband machine over validated pairs, held
  between validations, dropped fail-closed after STALE_H hours without a pair.
- Duty denominator = hourly grid rows with LF present (site-live approximation).
- Conditional stats ask the forward-looking question: for each pair, what was
  the advisory state when its *prediction* was made (state the viewer saw), and
  how did that prediction then score.

Rules swept (ON when err <= on; OFF when err > off; R3 needs 2 consecutive):
  R1: on -10%, off -5%     R2: on -15%, off -7.5%
  R3: 2x on -8%, off -4%   R4: on -25%, off -10%

Windows = the 8 frozen v38 windows (v38_gate_metrics.py). Output:
lf_residual_advisory_backtest_results.csv + stdout report.
"""

import csv
import os
from collections import defaultdict
from datetime import datetime, timezone

DIR = os.path.dirname(os.path.abspath(__file__))
STALE_H = 12

WINDOWS = {
    "W1": ("2012-07-08", "2012-07-12"), "W2": ("2014-08-10", "2014-08-14"),
    "W3": ("2019-07-22", "2019-07-26"), "W4": ("2019-10-15", "2019-10-23"),
    "W5": ("2022-07-07", "2022-07-11"), "W6": ("2022-08-03", "2022-08-08"),
    "W7": ("2026-07-09", "2026-07-12"), "W8": ("2026-07-17", "2026-07-20"),
}
BIN_EDGES = [3000, 6000, 12000, 25000, 50000]
BIN_NAMES = ["0-3000", "3000-6000", "6000-12000", "12000-25000", "25000-50000", "50000+"]

RULES = {
    "R1_on10_off5": {"on": -0.10, "off": -0.05, "consec": 1},
    "R2_on15_off7.5": {"on": -0.15, "off": -0.075, "consec": 1},
    "R3_2x8_off4": {"on": -0.08, "off": -0.04, "consec": 2},
    "R4_on25_off10": {"on": -0.25, "off": -0.10, "consec": 1},
}


def to_epoch_h(s):
    s = s.replace("T", " ").replace(".000Z", "").replace("Z", "")
    dt = datetime.strptime(s[:16], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() // 3600)


def date_of_h(h):
    return datetime.fromtimestamp(h * 3600, tz=timezone.utc).strftime("%Y-%m-%d")


def month_of_h(h):
    return datetime.fromtimestamp(h * 3600, tz=timezone.utc).month


def window_of(h):
    d = date_of_h(h)
    for w, (a, b) in WINDOWS.items():
        if a <= d <= b:
            return w
    return None


def flow_bin(lf):
    for i, e in enumerate(BIN_EDGES):
        if lf < e:
            return BIN_NAMES[i]
    return BIN_NAMES[-1]


def med(xs):
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        return float("nan")
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


# --- load pairs (single mode = production cadence) ---
pairs = []  # (valH, predH, err)
with open(os.path.join(DIR, "v38_residuals_single.csv")) as f:
    for row in csv.DictReader(f):
        actual = float(row["actualLF"])
        disp = float(row["disp_c0"])
        if actual <= 0:
            continue
        pairs.append((to_epoch_h(row["valTs"]), to_epoch_h(row["predTs"]),
                      (disp - actual) / actual))
pairs.sort()

# --- load hourly grid (duty denominator + flow bin) ---
grid = []  # (h, lf)
with open(os.path.join(DIR, "hourly_backtest_data_v38.csv")) as f:
    for row in csv.DictReader(f):
        if row["lf_discharge"]:
            grid.append((to_epoch_h(row["timestamp"]), float(row["lf_discharge"])))
grid.sort()

print(f"pairs={len(pairs)}  grid hours={len(grid)}")

out_rows = []
for rname, rule in RULES.items():
    # state machine over merged (hour, pair) timeline
    state_by_h = {}
    on = False
    run = 0            # consecutive qualifying pairs
    last_pair_h = None
    pi = 0
    for h, lf in grid:
        while pi < len(pairs) and pairs[pi][0] <= h:
            err = pairs[pi][2]
            last_pair_h = pairs[pi][0]
            if err <= rule["on"]:
                run += 1
                if run >= rule["consec"]:
                    on = True
            elif err > rule["off"]:
                run = 0
                on = False
            # between off and on threshold: state and run persist
            pi += 1
        if last_pair_h is None or h - last_pair_h > STALE_H:
            eff = False  # fail-closed on stale signal
        else:
            eff = on
        state_by_h[h] = eff

    # duty
    n_on = sum(1 for h, _ in grid if state_by_h[h])
    duty = n_on / len(grid)

    # duty by JJA/other x flow bin
    cell = defaultdict(lambda: [0, 0])
    for h, lf in grid:
        season = "JJA" if month_of_h(h) in (6, 7, 8) else (
            "SON" if month_of_h(h) in (9, 10, 11) else "other")
        c = cell[(season, flow_bin(lf))]
        c[0] += 1
        c[1] += state_by_h[h]
    jja_03 = cell[("JJA", "0-3000")]
    jja03_duty = jja_03[1] / jja_03[0] if jja_03[0] else float("nan")

    # window coverage + first-ON lag
    win_stats = {}
    for w, (a, b) in WINDOWS.items():
        hs = [h for h, _ in grid if a <= date_of_h(h) <= b]
        on_hs = [h for h in hs if state_by_h[h]]
        cov = len(on_hs) / len(hs) if hs else float("nan")
        lag = (on_hs[0] - hs[0]) if on_hs else None
        win_stats[w] = (cov, lag, len(hs))

    # forward-looking conditional stats on non-window pairs:
    # state at predTs vs how the pair then scored
    cond = {True: [], False: []}
    for val_h, pred_h, err in pairs:
        if window_of(pred_h) or window_of(val_h):
            continue
        st = state_by_h.get(pred_h)
        if st is None:
            continue
        cond[st].append(err)

    # harm coverage (ALL pairs incl. windows, predTs on grid): share of badly-wrong
    # predictions made while the advisory was ON — the decision metric for the
    # audit's F1 (previously R-only). Plus truthfulness: of ON predictions, share
    # that then scored <= -10%.
    harm = {}
    for th in (-0.15, -0.25):
        bad = [(p, e) for v, p, e in pairs if e <= th and p in state_by_h]
        cov = sum(1 for p, e in bad if state_by_h[p])
        harm[th] = (cov, len(bad), cov / len(bad) * 100 if bad else float("nan"))
    on_preds = [e for v, p, e in pairs if state_by_h.get(p)]
    truthful = (sum(1 for e in on_preds if e <= -0.10) / len(on_preds) * 100
                if on_preds else float("nan"))

    def stats(errs):
        if not errs:
            return dict(n=0, med_abs=float("nan"), p_under25=float("nan"),
                        p_big=float("nan"), mean=float("nan"))
        return dict(
            n=len(errs),
            med_abs=med([abs(e) for e in errs]),
            p_under25=sum(1 for e in errs if e <= -0.25) / len(errs),
            p_big=sum(1 for e in errs if abs(e) > 0.25) / len(errs),
            mean=sum(errs) / len(errs),
        )

    s_on, s_off = stats(cond[True]), stats(cond[False])

    print(f"\n=== {rname} ===")
    print(f"duty {duty*100:.2f}%   JJA 0-3k duty {jja03_duty*100:.2f}%")
    for w in WINDOWS:
        cov, lag, nh = win_stats[w]
        print(f"  {w}: coverage {cov*100:5.1f}%  first-ON lag "
              f"{'—' if lag is None else str(lag)+'h'}  ({nh}h)")
    print(f"  normal pairs ON : n={s_on['n']:6d} med|err|={s_on['med_abs']*100:5.1f}% "
          f"P(err<=-25%)={s_on['p_under25']*100:5.2f}% mean={s_on['mean']*100:+5.1f}%")
    print(f"  normal pairs OFF: n={s_off['n']:6d} med|err|={s_off['med_abs']*100:5.1f}% "
          f"P(err<=-25%)={s_off['p_under25']*100:5.2f}% mean={s_off['mean']*100:+5.1f}%")
    for th in (-0.15, -0.25):
        c, n, pct = harm[th]
        print(f"  harm coverage err<={int(th*100)}%: {c}/{n} = {pct:.2f}%")
    print(f"  truthfulness (ON preds scoring <=-10%): {truthful:.2f}%")

    row = {"rule": rname, "duty_pct": round(duty * 100, 2),
           "jja_0_3k_duty_pct": round(jja03_duty * 100, 2),
           "harm_cov_le_m15_pct": round(harm[-0.15][2], 2),
           "harm_cov_le_m15_n": harm[-0.15][1],
           "harm_cov_le_m15_covered": harm[-0.15][0],
           "harm_cov_le_m25_pct": round(harm[-0.25][2], 2),
           "harm_cov_le_m25_n": harm[-0.25][1],
           "harm_cov_le_m25_covered": harm[-0.25][0],
           "truthfulness_pct": round(truthful, 2)}
    for w in WINDOWS:
        cov, lag, _ = win_stats[w]
        row[f"{w}_cov_pct"] = round(cov * 100, 1)
        row[f"{w}_lag_h"] = lag if lag is not None else ""
    for tag, s in (("on", s_on), ("off", s_off)):
        row[f"{tag}_n"] = s["n"]
        row[f"{tag}_med_abs_pct"] = round(s["med_abs"] * 100, 2)
        row[f"{tag}_p_under25_pct"] = round(s["p_under25"] * 100, 2)
        row[f"{tag}_mean_pct"] = round(s["mean"] * 100, 2)
    out_rows.append(row)

    # seasonal duty detail for the report
    print("  duty by season x bin (>=2% only):")
    for (season, b), (tot, non) in sorted(cell.items()):
        if tot >= 200 and non / tot >= 0.02:
            print(f"    {season:5s} {b:12s} {non/tot*100:5.1f}%  (n={tot})")

with open(os.path.join(DIR, "lf_residual_advisory_backtest_results.csv"), "w",
          newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
    wr.writeheader()
    wr.writerows(out_rows)
print("\nwrote lf_residual_advisory_backtest_results.csv")
