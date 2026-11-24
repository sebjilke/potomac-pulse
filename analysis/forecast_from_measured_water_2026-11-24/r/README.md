# R analysis (blind), Stage 1

Regenerate everything from the raw files, from the study folder:

    Rscript r/run_all.R

Base R 4.5.2 only. Runs the made-up-data and unit tests first, then the real data; writes metrics.csv, counts.csv, intervals.csv, verdicts.csv, q4.csv, checks.csv, forecasts_A.csv, forecasts_B.csv and REPORT.md into r/. Exit status is non-zero if any check has a violation. Takes about 40 seconds.
