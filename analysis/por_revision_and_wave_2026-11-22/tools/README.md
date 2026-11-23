# How to rerun

All scripts are Python 3 standard library only (checked with Python 3.14.7, no package imported). Run from anywhere with `python3 -I tools/<script>` (the `-I` isolates the interpreter from the current directory). Paths are resolved from the script's own location.

| step | command | needs | what it does | time |
|---|---|---|---|---|
| 1 | `python3 -I tools/01_freeze_local.py` | the three Supabase result files in the session `tool-results` directory named inside the script, `../rising-limb-travel-backtest/raw/`, `../pulse-audit-2026-10/audit_inputs.tar.gz` | writes data/raw/supabase/*, verifies the archive against FETCH_MANIFEST.json, builds `data/raw/archive_old_2026-11-10.tar.gz`, extracts `archive_old/` and `oct_pull/` | seconds. The session directory may be cleaned: the frozen copies in data/raw/supabase are the durable ones; a rerun after cleaning needs only the copies, and will stop rather than overwrite a file whose content differs |
| 2 | `python3 -I tools/02_pull_usgs.py --list` then `--probe` then `--run all` (or `--run <pull names>`) | network, no key | keyless pulls from api.waterdata.usgs.gov, one gzip file per page in data/raw/usgs, one log entry per HTTP attempt in PULL_LOG.json | this run: 21 requests, about 6 minutes (15 s minimum between requests) |
| 3 | `python3 -I tools/03_build_tidy.py` | the frozen raw files | writes data/tidy/*.csv, state_other.json, BUILD_REPORT.json, DICTIONARY.md (via tools/dictionary.py), data/MANIFEST.json | about 1 minute |
| 5 | `python3 -I tools/05_reconcile.py` | tidy tables and raw files | independent recount and 54 seeded random cell traces; writes data/tidy/RECONCILE.json; exit status 1 on any mismatch | seconds |

| 6 | `python3 -I tools/06_parse_coop_reports.py` | the saved pages in research/data/coop (no network) | writes data/tidy/withdrawals_coop.csv (+ summary json) and merges the pages into data/MANIFEST.json | seconds |
| 7 | `python3 -I tools/07_compare_coop_csv.py` | step 6 output and the researcher's CSV | cell-by-cell comparison, data/tidy/withdrawals_coop_vs_researcher.json | seconds |

(There is no step 4 by this builder (a different `04_time_alignment_check.py` was added later by another hand): a planned time-alignment check of the old-service timestamps was not built because it compares old with current values, which the brief forbids; see LOG.md, anomaly 1.)

## Details that matter

- **Pull plan is frozen.** The first run of step 2 writes `data/raw/usgs/PULL_PLAN.json` (pull time and window cutoff, here 2026-11-22T10:00:00Z; 24-month start 2024-11-22T10:00:00Z). Reruns reuse it, so windows never move.
- **Resumable, never silent.** A page already saved (file and log entry present) is never requested again. If the log says a page was obtained but the file is missing, the script stops instead of re-pulling; a deliberate re-pull means removing that log entry by hand. HTTP 429 honours Retry-After (at most 3 waits, then the pull stops and is reported); 5xx/network errors get 2 retries after 60 s.
- **Keyless.** No key, token or header other than Accept, Accept-Encoding and a generic User-Agent is sent. Nothing is sent to hc-ping.com.
- **Requests made in this run: 21** (1 probe, 20 pulls), all HTTP 200, no refusals.
- **Files over 5 MB** (the five big readings tables) are in the study `.gitignore`; git has no size rule, so a rerun that produces another file over 5 MB needs its path added by hand. Their SHA-256 values are in data/MANIFEST.json.
- **Determinism.** Steps 1 and 3 give the same bytes on a rerun (gzip with mtime 0, sorted members). Step 2 does not (USGS rewrites provisional data; a new pull gets a new PULL_PLAN): never rerun step 2 over the frozen files; a new pull belongs in a new study folder or after moving this one.
- **Packages.** None. The tables are written with the standard `csv` module (`QUOTE_MINIMAL`: a field is quoted only if it contains a comma, quote or newline, which happens only for the anomaly-flag strings in runs/checks and one field-measurement procedure text).
