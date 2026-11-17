#!/bin/bash
# Produces every output file of the replay. Usage: ./run_all.sh   (about a minute)
set -eu
cd "$(dirname "$0")"
H="node ci_backtest_harness_lag.mjs"
for a in F L F0 L0; do $H --arm=$a --gate=new --mode=hybrid; done
for a in F L; do $H --arm=$a --gate=old --mode=hybrid; done
for s in 2015-01-01T00:00Z 2019-01-01T00:00Z 2023-01-01T00:00Z; do
  u=$(node -e "console.log(new Date(Date.parse('$s')+60*86400000).toISOString().slice(0,16)+'Z')")
  $H --arm=L --gate=new --mode=hybrid --switch=$s --until=$u
done
node make_bootstrap_indices.mjs shadow_F.csv .
