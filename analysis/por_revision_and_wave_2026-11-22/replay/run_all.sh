#!/bin/sh
# One command: rebuilds everything from the frozen tables in ../data/tidy. No network, no database, no clock.
# Usage: ./run_all.sh                          (gate and fidelity outputs; scenarios only if the gate verdict is PASS)
#        ./run_all.sh --gate-ruling="<text>"   (all outputs, after the orchestrator has ruled on a Gate A that is not PASS)
set -e
cd "$(dirname "$0")"
python3 -I verify_copy.py
python3 -I f_old/build_f_old.py
node replay.cjs "$@"
