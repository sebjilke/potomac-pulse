#!/bin/sh
# Auditor check 6: rerun the third implementation from a copy whose output folder is audit_work/mc_rerun (originals untouched),
# then compare every output file byte for byte with model_check/.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); BT=$(dirname "$HERE")
mkdir -p "$HERE/mc_rerun"
sed "s|^BT = os.path.dirname(HERE)|BT = '$BT'|" "$BT/model_check/rising_limb_model_check_python.py" > "$HERE/mc_rerun/rising_limb_model_check_python.py"
diff "$BT/model_check/rising_limb_model_check_python.py" "$HERE/mc_rerun/rising_limb_model_check_python.py" || true
cd "$HERE/mc_rerun" && /usr/bin/python3 rising_limb_model_check_python.py > run_stdout.txt 2>&1
for f in rising_limb_model_check.csv rising_limb_model_check_rebuild.csv _replay_event11.csv _replay_event30.csv _replay_event51.csv _replay_event53.csv _run_summary.json; do
  if cmp -s "$BT/model_check/$f" "$HERE/mc_rerun/$f"; then echo "IDENTICAL $f"; else echo "DIFFERS $f"; fi
done
