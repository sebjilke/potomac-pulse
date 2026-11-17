#!/bin/bash
# Regression test: ci_backtest_harness_lag.mjs --arm=orig --gate=old must reproduce the baseline
# (unmodified analysis/ci_backtest_harness.mjs) byte for byte, in both original modes.
# Also compares the harness stdout from line 2 on (counts and final bin summary). Exit non-zero on any difference.
set -u
cd "$(dirname "$0")"
T=tmp_regress; rm -rf "$T"; mkdir -p "$T"
rc=0
for m in multi single; do
  node ci_backtest_harness_lag.mjs --arm=orig --gate=old --mode=$m --out="$T/ci_residuals_v361_$m.csv" > "$T/stdout_$m.txt" 2>&1 || { echo "FAIL: run $m exited non-zero"; rc=1; continue; }
  if cmp -s "$T/ci_residuals_v361_$m.csv" "baseline/ci_residuals_v361_$m.csv"; then
    echo "PASS residual file identical ($m): $(shasum -a 256 "$T/ci_residuals_v361_$m.csv" | cut -c1-16)"
  else echo "FAIL residual file differs ($m)"; rc=1; fi
  if diff <(tail -n +2 "$T/stdout_$m.txt") <(tail -n +2 "baseline/stdout_$m.txt") > /dev/null; then
    echo "PASS stdout (from line 2) identical ($m)"
  else echo "FAIL stdout differs ($m)"; rc=1; fi
done
rm -rf "$T"
[ $rc -eq 0 ] && echo "REGRESSION: PASS" || echo "REGRESSION: FAIL"
exit $rc
