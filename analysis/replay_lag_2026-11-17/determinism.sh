#!/bin/bash
# Determinism test: run every configuration twice into two scratch dirs and compare SHA-256 of every output file.
set -u
cd "$(dirname "$0")"
rc=0
H="node ci_backtest_harness_lag.mjs"
run() { # outdir, args...
  d=$1; shift; mkdir -p "$d"; $H "$@" --outdir="$d" > /dev/null || { echo "run failed: $*"; rc=1; }
}
CONFIGS=(
 "--arm=F --gate=new --mode=hybrid"
 "--arm=L --gate=new --mode=hybrid"
 "--arm=F0 --gate=new --mode=hybrid"
 "--arm=L0 --gate=new --mode=hybrid"
 "--arm=F --gate=old --mode=hybrid"
 "--arm=L --gate=old --mode=hybrid"
 "--arm=L --gate=new --mode=hybrid --switch=2015-01-01T00:00Z --until=2015-03-02T00:00Z"
 "--arm=L --gate=new --mode=hybrid --switch=2019-01-01T00:00Z --until=2019-03-02T00:00Z"
 "--arm=L --gate=new --mode=hybrid --switch=2023-01-01T00:00Z --until=2023-03-02T00:00Z"
)
rm -rf tmp_det1 tmp_det2
for c in "${CONFIGS[@]}"; do run tmp_det1 $c; run tmp_det2 $c; done
for m in multi single; do
  node ci_backtest_harness_lag.mjs --arm=orig --gate=old --mode=$m --out=tmp_det1/orig_$m.csv >/dev/null
  node ci_backtest_harness_lag.mjs --arm=orig --gate=old --mode=$m --out=tmp_det2/orig_$m.csv >/dev/null
done
n=0
for f in tmp_det1/*; do
  b=$(basename "$f"); n=$((n+1))
  # counts files embed the --outdir in the command line; compare with that line removed
  if [[ "$b" == counts_* ]]; then
    if diff <(grep -v '^command:' "$f") <(grep -v '^command:' "tmp_det2/$b") >/dev/null; then :; else echo "DIFF $b"; rc=1; fi
  else
    if [ "$(shasum -a 256 < "$f")" != "$(shasum -a 256 < "tmp_det2/$b")" ]; then echo "DIFF $b"; rc=1; fi
  fi
done
echo "compared $n files (two independent runs each)"
rm -rf tmp_det1 tmp_det2
[ $rc -eq 0 ] && echo "DETERMINISM: PASS" || echo "DETERMINISM: FAIL"
exit $rc
