# Python analyst (cap study, ANALYSIS_SPEC.md version 1.2)

Rebuild everything from the raw files, from the study folder:

    python3 -I py/run_all.py

Standard library only. One single-file script (`run_all.py`). It runs the unit tests, the input hashes (C00), the checks C01 to C17, then writes the 14 CSV files into this folder. If any check fails it writes `checks.csv` only and exits with status 1. Progress goes to stderr. Run time is about 31 seconds.
