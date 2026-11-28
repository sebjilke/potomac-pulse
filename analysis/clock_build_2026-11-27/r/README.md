# R analyst folder

Run from `analysis/clock_build_2026-11-27/`:

    /opt/homebrew/bin/Rscript --vanilla r/run_all.R

Environment: R 4.5.2, base R only (`tools::sha256sum` for checksums), `LC_COLLATE` set to C on the first line. One driver, `r/run_all.R`; it also sets its own working directory. It deletes the 11 old output files first, writes all 11 `.csv` files named in section 13.2 of `ANALYSIS_SPEC.md` (v1.2) into this folder, and takes about 15 seconds. On a failing stopping check it writes only `checks.csv` and exits non-zero. Details: `REPORT.md`.
