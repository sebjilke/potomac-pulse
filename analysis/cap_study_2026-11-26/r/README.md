# R analyst folder (cap study, specification v1.2)

Rebuild everything from the raw files, from the study folder:

    Rscript --vanilla r/run_all.R

Base R 4.5.2 only (`tools::sha256sum` for the input hashes). One script, `r/run_all.R`. It runs the unit tests,
the input checks (C00 to C17), then writes the 14 csv files of section 17 into this folder.
A failed unit test or stopping check writes `checks.csv` (unit rows and the C rows computed so far) and stops.
`REPORT.md` holds the run report.
