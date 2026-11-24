# Python analyst (blind), Stage 1

Regenerate everything from the raw files (from the study folder, about 90 seconds):

    python3 -I py/run_all.py

Standard library only. Single script `run_all.py`: made-up-data test and unit assertions first, then the real files,
then all outputs (`metrics.csv, counts.csv, intervals.csv, verdicts.csv, q4.csv, checks.csv, forecasts_A.csv,
forecasts_B.csv, REPORT.md`). Exit status is non-zero if any check has a violation.
