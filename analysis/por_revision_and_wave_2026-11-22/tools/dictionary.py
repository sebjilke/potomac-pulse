"""Generates data/tidy/DICTIONARY.md (called by 03_build_tidy.py). Fails if a written column has no entry."""
import os, re
SU = 'netlify/functions/scheduled-update.js'
T = SU + ':2785-2850 (buildTickRecord)'
TR = SU + ':970-1091 (makeGFPrediction trace)'
V = SU + ':2860-2915 (buildValidationRecord)'
VX = SU + ':1968-1988 (extras of the validated fate)'

# path -> (unit, meaning, cite)       (path is the JSON path with dots; the column name replaces '.' by '_')
RUN = {
 'v': ('integer', 'Log schema number (LOG_SCHEMA, SU:2361). 1 on the two earliest rows (ver v39.2), 2 on v39.6 rows, 3 on v39.11 rows.', T),
 'ver': ('text', 'SERVER_VERSION of the job that wrote the row (SU:2786).', T),
 'commit': ('text', 'COMMIT_REF environment value (SU:2787, logCommit). Null in every row of this export.', T),
 'at': ('ISO ms', 'Run start time, the job clock (tickStartMs, SU:2788). Equals the row gauge_id.', T),
 'out': ('text', 'Outcome of the run: `predicted` or `error` (SU:2789).', T),
 'why': ('text', 'Short reason for a non-predicted outcome (SU:2790); null on predicted rows.', T),
 'err': ('text', 'Error message, URLs replaced, max 200 chars (SU:2791).', T),
 'ms': ('milliseconds', 'Duration of the run (SU:2792; logEpoch only rounds it). NOT a time.', T),
 'src': ('text', 'Where the main USGS request was read from: new | new_429 | old | old_nokey (schema 3 only, SU:2795).', T),
 'att': ('count', 'Number of attempts of the main USGS request (schema 3 only, SU:2796).', T),
 'aux.logFailTotal': ('count', 'Count of log-write failures of the run (aux, SU:2847-2851).', T),
 'aux.logFail': ('text list', 'List of log failures, `|` joined (SU:2847-2851).', T),
 'aux.snapshot': ('text', 'Status of the daily bin snapshot step: not_due | exists | written-type strings (runBinSnapshot, SU:2961-3000).', T),
 'in.lf.q': ('cfs', 'Little Falls discharge reading the run used (SU:2801).', T),
 'in.lf.qT': ('epoch ms', 'Time of that Little Falls flow reading (qTime).', T),
 'in.lf.h': ('ft', 'Little Falls stage reading used.', T),
 'in.lf.hT': ('epoch ms', 'Time of that Little Falls stage reading.', T),
 'in.por.q': ('cfs', 'Point of Rocks discharge reading the run used (SU:2802).', T),
 'in.por.qT': ('epoch ms', 'Time of that Point of Rocks flow reading.', T),
 'in.por.h': ('ft', 'Point of Rocks stage reading used.', T),
 'in.por.hT': ('epoch ms', 'Time of that Point of Rocks stage reading.', T),
 'in.ef.h': ('ft', 'Edwards Ferry stage reading used (SU:2807).', T),
 'in.ef.hT': ('epoch ms', 'Time of that Edwards Ferry stage reading.', T),
 'in.tC': ('deg C', 'Point of Rocks water temperature used (SU:2815).', T),
 'in.tT': ('epoch ms', 'Time of that temperature reading (SU:2816).', T),
 'in.ice.lf': ('0/1', 'Ice flag, Little Falls (SU:2817).', T),
 'in.ice.por': ('0/1', 'Ice flag, Point of Rocks.', T),
 'in.ice.efMiss': ('0/1', 'Edwards Ferry missing flag.', T),
 'in.porHist.n': ('count', 'Number of entries in the stored Point of Rocks history after the run\'s update (fullHistory.length, SU:2818-2822).', T),
 'in.porHist.firstT': ('epoch ms', 'Timestamp of the oldest entry of that history.', T),
 'in.porHist.lastT': ('epoch ms', 'Timestamp of the newest entry of that history.', T),
 'in.efx.tr1h': ('text', 'Edwards Ferry 1-hour stage trend from the tail (efTrendOfTail, SU:2812): rising/falling/steady.', T),
 'in.efx.tail.t0': ('epoch ms', 'Time of the first tail value, when the tail is regular (compactSeries, SU:2541-2551). The values are in runs_tails.csv.', T),
 'in.efx.tail.step': ('minutes', 'Step of a regular tail.', T),
 'in.efx.tail.n': ('count', 'Number of tail values (this column is added by the build; the values are in runs_tails.csv, tail = in_efx_tail).', 'tools/03_build_tidy.py'),
 'in.dr.q': ('cfs', 'Difficult Run (USGS 01646000) flow, logging only, never feeds the model (cleanDr SU:2624-2634; v39.6).', SU + ':2624-2634'),
 'in.dr.t': ('epoch ms', 'Reading time of the Difficult Run value.', SU + ':2624-2634'),
 'in.dr.at': ('epoch ms', 'Time the Difficult Run request was made.', SU + ':2624-2634'),
 'in.dr.ms': ('milliseconds', 'Duration of the Difficult Run request (not a time).', SU + ':2624-2634'),
 'in.dr.qual': ('text list', 'Qualifier codes of the Difficult Run reading, `|` joined.', SU + ':2624-2634'),
 'in.dr.why': ('text', 'Reason string when Difficult Run gave no value.', SU + ':2624-2634'),
 'in.dr.ageMin': ('minutes', 'Age of the Difficult Run reading at fetch time.', SU + ':2624-2634'),
 'in.dr.http': ('integer', 'HTTP status of the Difficult Run request when logged.', SU + ':2631'),
 'in.dr.tail.t0': ('epoch ms', 'Time of first Difficult Run tail value (values in runs_tails.csv, tail = in_dr_tail).', SU + ':2632'),
 'in.dr.tail.step': ('minutes', 'Step of that tail.', SU + ':2632'),
 'in.dr.tail.n': ('count', 'Number of tail values (added by the build).', 'tools/03_build_tidy.py'),
 'rise.r': ('percent per hour', 'Point of Rocks rise rate (porRiseRate.ratePerHour), blank when the rate function returned null.', TR + ' line 971'),
 'rise.rst': ('text', 'Flow state returned by the rise-rate function: rising | falling | steady.', TR + ' line 972'),
 'trv.t0': ('hours', 'First Point of Rocks to Great Falls travel time (before the iteration).', TR + ' line 973'),
 'trv.t': ('hours', 'Final Point of Rocks to Great Falls travel time.', TR + ' line 974'),
 'trv.it': ('count', 'Number of passes of the travel-time loop (1 to 3). NOT a time although the log writer is called logEpoch.', TR + ' lines 957-959, 975'),
 'trv.stop': ('text', 'How the loop ended: converged | max_iter | no_hist | hist_lost.', TR + ' lines 956-976'),
 'trv.mult': ('dimensionless', 'Flow multiplier (getFlowMultiplier) of the last flow used in the loop.', TR + ' line 977'),
 'trv.nohist': ('0/1', 'No historic Point of Rocks reading was found.', TR + ' line 978'),
 'trv.gf2lf': ('hours', 'Great Falls to Little Falls travel time (travelGFtoLF); sets the validation due time.', TR + ' line 979'),
 'hist.cfs': ('cfs', 'The time-shifted Point of Rocks reading picked from the stored history (historicPoR.cfs).', TR + ' line 983'),
 'hist.ago': ('hours', 'Age of that reading at the run (actualHoursAgo).', TR + ' line 984'),
 'hist.ts': ('epoch ms', 'Time of that reading, recovered by rounding to the minute (not read from the history).', TR + ' line 982'),
 'pre.cfs': ('cfs', 'Point of Rocks based estimate before the PoR-delta correction: time-shifted (or current) Point of Rocks flow plus the four tributary flows.', TR + ' lines 1003-1026'),
 'pre.shifted': ('0/1', 'The time-shifted reading was used (1) or the current reading (0).', TR + ' lines 1005, 1026'),
 'delta.pct': ('percent', 'Change of the current Point of Rocks flow against the time-shifted reading, (current/shifted - 1) x 100.', TR + ' lines 1010-1012'),
 'delta.decay': ('dimensionless', 'Decay factor min(DECAY_CAP, sqrt(fraction elapsed)); blank when the delta correction did not apply.', TR + ' lines 1015-1019'),
 'delta.ratio': ('dimensionless', 'Applied ratio 1 + (ratio - 1) x decay; blank when not applied.', TR + ' lines 1017-1019'),
 'delta.on': ('0/1', '|delta.pct| > 5 (correction applied).', TR + ' line 1012'),
 'por.est': ('cfs', 'Point of Rocks based estimate after the delta correction (porEstimateCFS).', TR + ' line 1028'),
 'ef.est': ('cfs', 'Edwards Ferry power-law estimate (efEstimateCFS); blank if no usable stage.', T + ' line 2834'),
 'ef.type': ('text', 'Edwards Ferry model type: default | cold | default-no-temp.', T + ' line 2834'),
 'ef.w': ('weight, 3 decimals', 'Edwards Ferry weight in the ensemble as logged (rounded to 3 decimals; 0 at these flows).', T + ' line 2834'),
 'ef.used': ('0/1', 'Edwards Ferry ensemble was used.', T + ' line 2835'),
 'ef.disc': ('fraction', 'abs(EF estimate - Point of Rocks estimate) / Point of Rocks estimate.', TR + ' line 1063'),
 'ef.skip': ('0/1', 'Discrepancy above 0.50, Edwards Ferry skipped.', TR + ' line 1063'),
 'raw.cfs': ('cfs', 'Raw estimate: rawFinalUnclipped, after the ensemble, BEFORE the learned correction and the cap (1 decimal).', TR + ' lines 1082, 1087'),
 'raw.stage': ('ft', 'Stage corresponding to the raw estimate (rawFinalStage).', T + ' line 2837'),
 'corr.bin': ('text', 'Flow bin of the raw estimate (0-3000, 3000-6000, ...).', T + ' line 2838'),
 'corr.st': ('text', 'Flow state used for the correction (rising/falling/steady).', T + ' line 2838'),
 'corr.c': ('cfs', 'Learned correction subtracted from raw (trace.corr; corrected = raw - c, see log line SU:1094).', TR + ' line 1088'),
 'corr.unc': ('cfs', 'Corrected estimate before the 120% cap (correctedFinalUnclipped).', TR + ' line 1089'),
 'ceil.lim': ('cfs', '120% of the Little Falls reading (CEILING_RATIO x lf.q).', TR + ' line 1090'),
 'ceil.bound': ('0/1', 'The cap bound.', TR + ' line 1091'),
 'final.cfs': ('cfs', 'The estimate shown in the app (predictedCFS, rounded).', T + ' line 2840'),
 'final.stage': ('ft', 'Stage of the shown estimate.', T + ' line 2840'),
 'final.ts': ('ISO ms', 'Prediction timestamp, new Date() inside makeGFPrediction (1 to 3 s after run start).', T + ' line 2840'),
 'due': ('ISO ms', 'Validation due time (validationDue): when the estimate is checked against Little Falls.', T + ' line 2841'),
 'conf.freshLoad': ('text', 'Confidence label a fresh page load would show (confidenceLabel with EF trend null).', SU + ':2605-2621'),
 'conf.freshLoadShown': ('text', 'The label after the advisory downgrades (shownLabel).', SU + ':2617'),
 'conf.tribs': ('0/1', 'Both Monocacy and Goose Creek readings present.', SU + ':2609'),
 'conf.shift': ('0/1', 'Time-shifted reading used (pred.useTimeShifted).', SU + ':2610'),
 'conf.ef': ('0/1', 'Edwards Ferry ensemble used.', SU + ':2611'),
 'conf.st': ('text', 'Flow state of the prediction.', SU + ':2618'),
 'conf.advEf': ('0/1', 'Edwards Ferry divergence advisory active.', SU + ':2613'),
 'conf.advLfr': ('0/1', 'Little Falls residual advisory active.', SU + ':2614'),
 'ci.lo': ('cfs', 'Lower end of the empirical 90% band around the shown estimate (bandFor).', 'netlify/functions/shared/ci-table.js:34-47'),
 'ci.hi': ('cfs', 'Upper end of that band.', 'netlify/functions/shared/ci-table.js:34-47'),
 'ci.q05': ('cfs', 'Table 5th percentile of the corrected residual for the bin and state.', 'netlify/functions/shared/ci-table.js:34-47'),
 'ci.q95': ('cfs', 'Table 95th percentile.', 'netlify/functions/shared/ci-table.js:34-47'),
 'ci.bin': ('text', 'Bin used for the band.', 'netlify/functions/shared/ci-table.js:34-47'),
 'ci.st': ('text', 'State used for the band.', 'netlify/functions/shared/ci-table.js:34-47'),
 'adv.dbar': ('ratio', 'Five-hour median Edwards Ferry divergence D-bar (EF divergence advisory state).', T + ' line 2844'),
 'adv.ef': ('0/1', 'Edwards Ferry divergence advisory active.', T + ' line 2844'),
 'adv.lfr': ('0/1', 'Little Falls residual advisory active.', T + ' line 2844'),
 'adv.lfe': ('percent (per CLAUDE.md, LF-Residual Advisory)', 'Latest validated Little Falls residual error the advisory uses.', T + ' line 2844'),
 'slot': ('text', 'Outcome of the pending-prediction store step: stored | skipped_in_window | replaced | insert_failed | none.', T + ' line 2845; SU:2007'),
 'val.n': ('count', 'Predictions validated in this run.', T + ' line 2846 (validate result {validated, cleaned}, SU:1999)'),
 'val.cleaned': ('count', 'Stale pending predictions cleaned in this run.', T + ' line 2846'),
}
RUN_AUX_PRUNE = ('count', 'Pruning counters (aux.prune.<type>.cand / .deleted) on the runs that pruned.', T + ' lines 2847-2851; SU:3053')
RUN_ID = {
 'seq': ('integer', 'Row number after sorting: runs.csv by `at` (run start); checks.csv by the Supabase `created_at` of the row (checks have no `at`). The build sorts checks by valAt then created_at; for these 20 rows both orders are identical (verified, tools/LOG.md).', 'build'),
 'row_id': ('uuid', 'Supabase row id.', 'export'),
 'created_at_utc': ('ISO UTC', 'Supabase created_at (row insert time), converted to UTC.', 'export'),
 'gauge_id': ('text', 'Supabase gauge_id field; for tick_log the run start ISO ms; for validation_log `<valAt ISO>_<pending row id>` (SU:2934).', 'export'),
 'clock_hour_utc': ('ISO UTC', 'The run\'s `at` floored to the hour (build).', 'tools/03_build_tidy.py'),
 'rows_in_hour': ('count', 'Number of tick_log rows with that clock hour (all outcomes).', 'tools/03_build_tidy.py'),
 'used': ('0/1', 'PLAN RULE (PLAN.md section 3): 1 for the first row of each clock hour whose `out` is `predicted`, else 0.', 'tools/03_build_tidy.py; PLAN.md s.3'),
}
CHK = {
 'v': ('integer', 'Log schema number.', V + ' line 2866'),
 'ver': ('text', 'SERVER_VERSION of the job.', V),
 'commit': ('text', 'COMMIT_REF; null.', V),
 'gateVersion': ('text', 'Gate version constant `v39.0`.', V),
 'outcome': ('text', 'Fate of the pending row; every exported row is `validated`.', V + ' line 2869'),
 'predId': ('uuid', 'Id of the pending (prediction) row.', V),
 'predTs': ('ISO ms', 'Prediction timestamp (the `final.ts` of the run that made it).', V),
 'predAt': ('ISO', 'created_at of the pending row (insert time).', V),
 'dueAt': ('ISO ms', 'validationDue of the prediction.', V),
 'valAt': ('ISO ms', 'Time the check was run (valAtMs).', V),
 'tickAt': ('ISO ms', 'Start of the run that did the check (SU:2736-2741).', SU + ':2736-2741'),
 'rawCFS': ('cfs', 'rawFinalCFS of the prediction (raw estimate, rounded).', V),
 'corrCFS': ('cfs', 'predictedCFS, the shown estimate.', V),
 'bin': ('text', 'Flow bin used.', V),
 'st': ('text', 'Flow state used.', V),
 'delayMin': ('minutes', 'Minutes between due time and the check.', SU + ':1225'),
 'ageH': ('hours', 'Age of the pending row (some fates only).', V),
 'corrApplied': ('cfs', 'correctionApplied stored on the prediction.', VX),
 'actualCFS': ('cfs', 'Little Falls flow used as the check (lf.q at the check run).', SU + ':1233; ' + VX),
 'lfAtPred': ('cfs', 'Little Falls flow at prediction time (lfCFS of the prediction).', VX),
 'errRawCFS': ('cfs', 'Raw estimate minus actual (errorCFS = rawCFS - actualCFS).', SU + ':1242'),
 'errPctRaw': ('percent', 'errorCFS / actual x 100.', SU + ':1243'),
 'errPctCorr': ('percent', '(shown estimate - actual) / actual x 100; the headline accuracy.', SU + ':1244'),
 'actualT': ('epoch ms', 'Time of the Little Falls flow reading used as truth (lf.qTime).', VX),
 'actualStageT': ('epoch ms', 'Time of the Little Falls stage reading.', VX),
 'rawStage': ('ft', 'Stage of the raw/predicted value (predictedStage as passed).', VX),
 'predStage': ('ft', 'predictedStage of the prediction.', VX),
 'actualStage': ('ft', 'Little Falls stage at the check.', VX),
 'errStage': ('ft', 'Stage error.', VX),
 'hard': ('0/1', 'Hard-flagged validation.', VX), 'soft': ('0/1', 'Soft-flagged validation.', VX),
 'hardScore': ('integer', 'Hard flag score.', VX), 'softScore': ('integer', 'Soft flag score.', VX),
 'flags': ('text list', 'Anomaly flag strings, `|` joined.', VX),
 'z': ('z-score', 'Outlier z-score when the validation was an outlier, else blank.', VX),
 'learned': ('0/1', 'The bin learned from this check.', VX),
 'binReadFailed': ('0/1', 'Bin read failed.', VX), 'binWriteFailed': ('0/1', 'Bin write failed.', VX),
 'stageBinWriteFailedKey': ('text', 'Key of a failed stage-bin write.', VX),
 'accuracyCounted': ('0/1', 'The check counted in the accuracy statistics.', VX),
 'binBefore.n': ('count', 'Bin count before the check (binStatsOf, SU:2381-2391).', VX),
 'binBefore.ema': ('cfs', 'Bin EMA of the signed raw error before the check (alpha 0.3).', VX),
 'binBefore.sd': ('cfs', 'Bin standard deviation before.', VX),
 'binAfter.count': ('count', 'Bin count after the check.', VX),
 'binAfter.sumError': ('cfs', 'Bin lifetime sum of the raw error after.', VX),
 'binAfter.meanError': ('cfs', 'Bin lifetime mean error after.', VX),
 'binAfter.sumErrorSq': ('cfs^2', 'Bin lifetime sum of squared error after.', VX),
 'binAfter.emaMeanError': ('cfs', 'Bin EMA after.', VX),
 'binAfter.stdDev': ('cfs', 'Bin stdDev field when stored.', VX),
 'stage.key': ('text', 'Stage-bin key (stage_<bin>_<state>).', VX),
 'stage.before.n': ('count', 'Stage bin count before.', VX), 'stage.before.ema': ('ft', 'Stage bin EMA before.', VX), 'stage.before.sd': ('ft', 'Stage bin sd before.', VX),
 'stage.after.count': ('count', 'Stage bin count after.', VX), 'stage.after.stdDev': ('ft', 'Stage bin stdDev after.', VX),
 'stage.after.sumError': ('ft', 'Stage bin sum error after.', VX), 'stage.after.meanError': ('ft', 'Stage bin mean error after.', VX),
 'stage.after.sumErrorSq': ('ft^2', 'Stage bin sum of squares after.', VX), 'stage.after.emaMeanError': ('ft', 'Stage bin EMA after.', VX),
 'ceilBound': ('0/1', 'The cap bound on the prediction (ceilingApplied).', VX),
 'efDiv': ('ratio', 'efDivergence stamped on the prediction.', VX), 'divActive': ('0/1', 'divergenceActive stamped on the prediction.', VX),
 'lfResActive': ('0/1', 'lfResidualActive stamped.', VX), 'lfResErr': ('percent', 'lfResidualLastErrPct stamped.', VX),
 'tC': ('deg C', 'Water temperature at the check.', VX),
 'pairStored': ('text', 'Whether the validated pair was stored (written/...).', VX),
 'lb.totalRounds': ('count', 'Shadow leaderboard rounds.', VX), 'lb.lastWinner': ('text', 'Shadow leaderboard last winner.', VX),
 'lb.lastValidationTime': ('ISO ms', 'Leaderboard last validation time.', VX),
 'dr.q': ('cfs', 'Difficult Run flow at the check (logging only).', SU + ':2624-2634'), 'dr.t': ('epoch ms', 'Reading time.', SU + ':2624-2634'),
 'dr.at': ('epoch ms', 'Request time.', SU + ':2624-2634'), 'dr.ms': ('milliseconds', 'Request duration (not a time).', SU + ':2624-2634'),
 'dr.why': ('text', 'Reason when no value.', SU + ':2624-2634'), 'dr.qual': ('text list', 'Qualifiers.', SU + ':2624-2634'),
 'dr.ageMin': ('minutes', 'Reading age.', SU + ':2624-2634'), 'dr.http': ('integer', 'HTTP status.', SU + ':2631'),
 'dr.tail.t0': ('epoch ms', 'Tail start (only with a tail).', SU + ':2632'), 'dr.tail.step': ('minutes', 'Tail step.', SU + ':2632'), 'dr.tail.n': ('count', 'Tail value count (added by build); values in checks_tails.csv.', 'build'),
}

def lookup(col, table, pats):
    base = col[:-4] if col.endswith('_utc') else col
    suffix = ' Converted to ISO UTC from the column without the `_utc` suffix.' if col.endswith('_utc') else ''
    for path, (u, m, c) in table.items():
        if path.replace('.', '_') == base:
            return (u + (' (as ISO UTC)' if suffix else ''), m + suffix, c)
    for rx, val in pats:
        mt = re.fullmatch(rx, base)
        if mt: return (val[0] + (' (as ISO UTC)' if suffix else ''), val[1].format(*mt.groups()) + suffix, val[2])
    return None

RUN_PATS = [
 (r'in_(mono|goose|br|sen)_q', ('cfs', 'Reading of the {0} gauge (Monocacy / Goose Creek / Broad Run / Seneca Creek) as the run saw it (trib(), SU:2803-2806).', T)),
 (r'in_(mono|goose|br|sen)_qT', ('epoch ms', 'Reading time of the {0} flow.', T)),
 (r'in_(mono|goose|br|sen)_eff', ('cfs', 'Effective {0} flow the model used (trace.monoFlow etc.; a drainage-area fallback times Little Falls when the reading is missing, TR lines 988-996).', TR)),
 (r'in_(mono|goose|br|sen)_fb', ('0/1', 'Fallback used for {0} (no reading), trace.fb*.', TR + ' lines 995-996')),
 (r'pub_(\d+)_lm', ('epoch ms', 'USGS last_modified of the newest reading of site {0} in the main request (pubOf, SU:2751-2760; schema 3 only).', SU + ':2797-2799')),
 (r'pub_(\d+)_t', ('epoch ms', 'Reading time of the newest reading of site {0} in the main request.', SU + ':2797-2799')),
 (r'aux_prune_(\w+)_(cand|deleted)', RUN_AUX_PRUNE),
 (r'aux_unkQ', ('text', 'Unknown qualifier codes seen on the main request (logging only).', T + ' lines 2848-2850')),
]
CHK_PATS = [
 (r'lb_models_(\w+)_(count|bestStreak|currentStreak|sumAbsErrorPercent|meanAbsErrorPercent)', ('number', 'Shadow-model leaderboard field {1} of model {0} at the check (lbCap; logging of the shadow leaderboard, never feeds the estimate).', VX)),
 (r'lb_models_(\w+)_lastValidation', ('ISO ms', 'Shadow model {0} last validation time.', VX)),
]
SIMPLE = {
 'readings': [
  ('gauge', 'text', 'USGS 8-digit site number.', 'file name / series (old); monitoring_location_id minus `USGS-` (new)'),
  ('parameter', 'text', 'USGS parameter code: 00060 flow (cfs), 00065 water level (ft), 00010 water temperature (deg C).', 'series / parameter_code'),
  ('time_utc', 'ISO UTC', 'Time of the reading. Old service: parsed from `dateTime` with its local offset (-04:00 / -05:00) into UTC. New service: `time` (already UTC).', 'old: value.timeSeries[].values[0].value[].dateTime; new: features[].properties.time'),
  ('value', 'cfs / ft / deg C', 'Reading as given by the source (string kept as is). BLANK when the source value was null or the sentinel -999999.', 'value'),
  ('record', 'text', '`old_archive` (archive of 2026-11-10), `old_octpull` (October pull), `current` (new service, pulled 2026-11-22).', 'build'),
  ('source_file', 'path', 'Raw file (relative to the study folder) the row came from.', 'build'),
  ('last_modified_utc', 'ISO UTC, microseconds', 'New service `last_modified` of the value. Blank for old-service rows (the old service has no such field).', 'features[].properties.last_modified'),
  ('approval', 'P / A', 'P = provisional, A = approved. Old: from the qualifiers list; new: from approval_status (Provisional/Approved).', 'qualifiers / approval_status'),
  ('qualifier', 'text', 'Other qualifier codes, `|` joined (old: qualifiers other than P/A; new: `qualifier`). Blank = none.', 'qualifiers / qualifier'),
 ],
 'tails': [
  ('row_id', 'uuid', 'Supabase row id of the run (or check).', 'export'), ('at_utc', 'ISO UTC', 'Run `at` (runs_tails) .', 'tick_log'),
  ('valAt_utc', 'ISO UTC', 'Check time (checks_tails).', 'validation_log'),
  ('tail', 'text', 'Which tail: in_dr_tail (Difficult Run flow, cfs) or in_efx_tail (Edwards Ferry stage, ft); dr_tail in checks_tails.', 'scheduled-update.js:2810-2814 (efx), 2632 (dr)'),
  ('idx', 'integer', 'Index within the tail (0 = oldest).', 'build'),
  ('time_utc', 'ISO UTC', 'Time of the tail value: t0 + idx x step minutes for a regular tail, ts[idx] for an irregular one (compactSeries, SU:2541-2551).', 'build'),
  ('value', 'cfs / ft', 'Tail value.', 'tail.v'),
 ],
 'bins': [
  ('source', 'text', '`bin_snapshot` (daily snapshot row) or `gf_correction_bin` (live state row as of the export).', 'export'),
  ('snapshot_time_utc', 'ISO UTC', 'bin_snapshot: the snapshot key (03:00 UTC of that day, buildBinSnapshot SU:2961-2978). gf_correction_bin: the EXPORT time 2026-11-22T10:51:00Z (approximate). It is not the time the bin last learned.', 'build'),
  ('row_created_utc', 'ISO UTC', 'Supabase created_at of the row. For gf_correction_bin rows this is the row\'s creation time, months old (e.g. 2026-05 to 2026-07), because the row is updated in place; it is NOT the time the bin last learned. For the bin state at any moment use the bin_snapshot rows and binBefore_* / binAfter_* in checks.csv.', 'export'),
  ('bin_key', 'text', '`<flow bin>_<flow state>` for the 18 flow bins, `stage_<flow bin>_<state>` for the stage bins.', 'export'),
  ('n', 'count', 'Number of checks in the bin (snapshot `n`; row `count`).', 'SU:2961-2978'),
  ('ema', 'cfs (stage bins: ft)', 'EMA of the signed raw error (alpha 0.3) (snapshot `ema`; row `emaMeanError`).', 'SU:2961-2978'),
  ('mean', 'cfs / ft', 'Lifetime mean error (`mean` / `meanError`).', 'SU:2961-2978'),
  ('sum', 'cfs / ft', 'Lifetime sum of the error (`sum` / `sumError`).', 'SU:2961-2978'),
  ('sum_sq', 'cfs^2 / ft^2', 'Lifetime sum of squared error (`sumSq` / `sumErrorSq`).', 'SU:2961-2978'),
  ('sd', 'cfs / ft', 'Standard deviation (snapshot `sd`; row `stdDev`, present on stage-bin rows only).', 'SU:2961-2978'),
 ],
}
FMDOC = {
 'gauge': 'USGS site number.', 'feature_id': 'Feature id of the row in the service.', 'source_file': 'Raw page the row came from.',
 'field_measurements_series_id': 'Series id.', 'field_visit_id': 'Visit id; rows of one visit share it.',
 'monitoring_location_id': 'USGS-<site>.', 'parameter_code': 'Parameter code (00060 flow, 00065 level, ...).', 'reading_type': 'Reading type (e.g. MeanGageHeight).',
 'value': 'Measured value as given.', 'unit_of_measure': 'Unit as given.', 'time': 'Date of the visit as given by the service (a date, no clock time).',
 'time_of_day': 'Clock time of the measurement with the offset the service gave (all seen are +00:00).', 'year': 'Year.', 'month': 'Month.', 'day': 'Day.',
 'qualifier': 'Qualifier.', 'approval_status': 'Approval status as given (Approved/Provisional).', 'last_modified': 'Service last_modified of the record (as given, UTC with offset).',
 'control_condition': 'Control condition noted at the visit (Clear, Debris - Moderate, ...).', 'measurement_rated': 'USGS rating of the measurement (Good, Fair, Poor, ...).',
 'measuring_agency': 'Measuring agency.', 'observing_procedure_code': 'Observing procedure code.', 'observing_procedure': 'Observing procedure.',
 'vertical_datum': 'Vertical datum.', 'sublocation_identifier': 'Sublocation.', 'visit_time_utc': 'Build: `time` + `time_of_day` combined, ISO UTC, blank if either is missing.',
}
def esc(s): return str(s).replace('|', '\\|')

def write(REPORT, STUDY):
    out = ['# Data dictionary', '', 'Generated by tools/03_build_tidy.py (tools/dictionary.py). All times are ISO 8601 UTC ending in Z unless a column says "epoch ms" (the raw log value, integer milliseconds since 1970-01-01 UTC), and every epoch column has a companion `_utc` column. Blank = missing. Booleans are 1/0. SU = `netlify/functions/scheduled-update.js` in the PotomacPulse repository (line numbers as of the checked-out copy of 2026-11-22). Job-log meanings are quoted from the code that writes the field; where the code only passes a value through, the meaning is that of the source variable.', '']
    def table(title, intro, rows):
        out.extend(['## ' + title, '', intro, '', '| column | unit | meaning | origin |', '|---|---|---|---|'])
        for c, u, m, o in rows: out.append('| `%s` | %s | %s | %s |' % (c, esc(u), esc(m), esc(o)))
        out.append('')
    for name in ['readings_old_archive', 'readings_old_octpull', 'readings_current_model', 'readings_current_upstream', 'readings_current_census']:
        r = REPORT[name]['rows']
        intro = {
         'readings_old_archive': 'Old USGS service archive pulled 2026-11-10 (54 files, SHA-256 verified): 5-minute (PoR, Broad Run, Seneca, Little Falls) or 15-minute (Monocacy, Goose Creek, Edwards Ferry) readings, first reading 2026-06-11T23:00:00Z, last 2026-11-09T23:55:00Z (the old service returned an hour before the requested start in daylight-time months, see tools/LOG.md). Long format.',
         'readings_old_octpull': 'Old-service October pull (about 2026-11-09), 5 to 22 Oct: seven gauges, flow, level and temperature as available.',
         'readings_current_model': 'New service (`continuous`), pulled 2026-11-22: model gauges, 12 Jun 2026 to the cutoff 2026-11-22T10:00:00Z. Only statistic 00011 kept.',
         'readings_current_upstream': 'New service: eight upstream gauges, flow and level, 1 Sep 2026 to the cutoff.',
         'readings_current_census': 'New service: Point of Rocks and Little Falls flow, 24 months back (2024-11-22T10:00Z) to the cutoff, with `last_modified`. Self-contained: it repeats the rows of the same two flow series that are also in readings_current_model (from 12 Jun on); count by `source_file` to avoid double counting.'}[name]
        table(name + '.csv (%d rows)' % r, intro, SIMPLE['readings'])
    # runs
    lead, cols, trail = REPORT['_runs_cols']
    rows = []
    for c in lead + cols + trail:
        if c in RUN_ID: u, m, o = RUN_ID[c]
        else:
            x = lookup(c, RUN, RUN_PATS)
            if not x: raise SystemExit('dictionary: no entry for runs column ' + c)
            u, m, o = x
        rows.append((c, u, m, o))
    table('runs.csv (%d rows)' % REPORT['runs']['rows_out'], 'One row per tick_log row (hourly job run), every logged field flattened (dotted path -> underscores). Rows ordered by `at`. Epoch-ms fields have a `_utc` twin. Origin column cites the writer of the field.', rows)
    table('runs_tails.csv (%d rows)' % REPORT['runs']['tail_rows'], 'Array fields of the run log in long form.', [r for r in SIMPLE['tails'] if r[0] != 'valAt_utc'])
    lead, cols = REPORT['_checks_cols']
    rows = []
    for c in lead + cols:
        if c in RUN_ID: u, m, o = RUN_ID[c]
        else:
            x = lookup(c, CHK, CHK_PATS)
            if not x: raise SystemExit('dictionary: no entry for checks column ' + c)
            u, m, o = x
        rows.append((c, u, m, o))
    table('checks.csv (%d rows)' % REPORT['checks']['rows_out'], 'One row per validation_log row (a logged check of a prediction against Little Falls), flattened the same way. Errors are estimate minus actual: positive = estimate too high.', rows)
    if REPORT.get('checks_tails_rows'):
        table('checks_tails.csv (%d rows)' % REPORT['checks_tails_rows'], 'Tail arrays of the validation log in long form.', [r for r in SIMPLE['tails'] if r[0] not in ('at_utc',)])
    table('bins.csv (%d rows)' % REPORT['bins']['bins_csv_rows'], 'Learned-correction bin statistics in long format: the 12 daily `bin_snapshot` rows (28 bins each) and the 28 live `gf_correction_bin` rows as of the export. Units of stage bins are feet.', SIMPLE['bins'])
    out.extend(['## state_other.json', '', 'The remaining state rows kept as exported (rows as `{id, created_at, observation_type, gauge_id, data}`): `gf_metadata` (1), `gf_prediction` (2), `validation_failure` (54), and `bin_snapshot_leaderboard` (the `lb` leaderboard object of each of the 12 snapshots with its snapshot time).', ''])
    rows = [(c, '', FMDOC.get(c, 'Property of the service record, as given.'), 'features[].properties' if c not in ('gauge', 'feature_id', 'source_file', 'visit_time_utc') else 'build') for c in REPORT['_fm_cols']]
    table('field_measurements.csv (%d rows)' % REPORT['field_measurements']['rows_out'], 'USGS field measurements (new service `field-measurements`): every property, one row per measurement. Values as given (not converted).', rows)
    rows = [(c, '', 'Site property as given by the service `monitoring-locations` (drainage_area is in square miles per USGS; altitude in feet).' if c not in ('gauge', 'source_file') else ('USGS site number (monitoring_location_number).' if c == 'gauge' else 'Raw page.'), 'features[].properties') for c in REPORT['_site_cols']]
    table('sites.csv (%d rows)' % REPORT['sites']['rows_out'], 'Site information for the 15 gauges used.', rows)
    import csv as _csv
    wp = os.path.join(STUDY, 'data', 'tidy', 'withdrawals_coop.csv')
    if os.path.exists(wp):
        wcols = next(_csv.reader(open(wp, encoding='utf-8'))); wn = sum(1 for _ in open(wp, encoding='utf-8')) - 1
        W = {
         'node': ('integer', 'Node number of the report page on icprbcoop.org (797 to 846).', 'page address'),
         'report_date': ('date', 'Date in the page title, e.g. "(Tuesday, 2026-08-04)": the day the report was issued.', 'page <title>'),
         'withdrawal_date': ('date', 'Date printed in "Yesterday\'s Washington metropolitan area Potomac River withdrawals and discharges (DATE)": the day the withdrawals and the previous-day gauge flows refer to (one day before the report date).', 'page text'),
         'source_url': ('url', 'Address of the page (research/data/README.md).', 'research/data/README.md'),
         'source_file': ('path', 'Saved HTML page, relative to the study folder; hash in data/MANIFEST.json.', 'build'),
         'lf_prev_day_cfs': ('cfs', 'Little Falls gage flow for the withdrawal date as printed in "Daily flows". This is the commission\'s snapshot of USGS PROVISIONAL values on the report day (a vintage), NOT USGS\'s current record. Blank when printed as "Not available due to ice".', 'page text'),
         'por_prev_day_cfs': ('cfs', 'Point of Rocks flow for the withdrawal date as printed, same vintage caveat as lf_prev_day_cfs.', 'page text'),
         'coop_flow_below_gf_intake_mgd': ('MGD', 'The commission\'s "Great Falls estimated flow" for the withdrawal date as printed: by the page\'s own note, "flow at Little Falls plus Little Falls water supply withdrawal". It is the commission\'s quantity, NOT the app\'s Great Falls estimate.', 'page text'),
         'coop_flow_below_gf_intake_cfs': ('cfs', 'The cfs value printed in parentheses on the same line. Same meaning and caveat.', 'page text'),
         'special_conditions_text': ('text', 'Text of the "Special Conditions" paragraph of the page (whitespace collapsed); the word "None" where the page says None.', 'page text'),
        }
        for stem, label in [('fairfax_corbalis', 'Fairfax Water Corbalis withdrawal - Potomac'), ('wssc_potomac', 'WSSC Water Potomac withdrawal'), ('wash_aqueduct_great_falls', 'Washington Aqueduct withdrawal - Great Falls'), ('wash_aqueduct_little_falls', 'Washington Aqueduct withdrawal - Little Falls'), ('loudoun_withdrawal', 'Loudoun Water withdrawal'), ('loudoun_broad_run_discharge', 'Loudoun Water Broad Run discharge'), ('total_potomac_withdrawal', 'Total Potomac withdrawal'), ('total_net_potomac_withdrawal', 'Total net Potomac withdrawal')]:
            W[stem + '_mgd'] = ('MGD', 'As printed on the line "%s: N MGD" for the withdrawal date. Blank when the page says "Not available" (counted in tools/LOG.md).' % label, 'page text')
            W[stem + '_flag'] = ('text', 'Anything printed after the value on that line (for example "(estimate)" or "*"), or the text "Not available" when the value is blank. Blank = nothing printed.', 'page text')
        W['lf_prev_day_flag'] = W['por_prev_day_flag'] = W['coop_flow_below_gf_intake_flag'] = ('text', 'Marker text on the previous-day line: an asterisk after the date or after the cfs value, or "Not available due to ice" when the value is blank. Blank = no marker. The page footnote that explains an asterisk is in special_conditions_text or not captured (see the page).', 'page text')
        rows = [(c,) + W[c] for c in wcols]
        table('withdrawals_coop.csv (%d rows)' % wn, 'One row per saved daily report page of the regional water-supply commission (ICPRB CO-OP daily drought report, 50 pages, nodes 797 to 846, report dates 2026-01-05 to 2026-11-20, not in node order; retrieved 2026-11-22 UTC). Values are exactly as printed: MGD for withdrawals and for the commission flow, cfs for the gauge columns; no conversion, no computation. Generated by tools/06_parse_coop_reports.py from research/data/coop/node*.html; it supersedes the hand-built research/data/coop/coop_daily_reports_parsed.csv (differences listed in tools/LOG.md). Companion files: withdrawals_coop_summary.json (blank and flag counts), withdrawals_coop_vs_researcher.json (cell comparison).', rows)
    out.extend(['## Other files', '', '- `BUILD_REPORT.json`: counts per step and per source file (also summarised in tools/LOG.md).', '- `../MANIFEST.json`: every raw file with bytes, SHA-256, origin and time obtained.', ''])
    open(os.path.join(STUDY, 'data', 'tidy', 'DICTIONARY.md'), 'w').write('\n'.join(out))
