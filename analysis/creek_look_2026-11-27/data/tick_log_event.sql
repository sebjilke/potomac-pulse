-- Extract of the hourly job's log (tick_log) for the event of 25 to 28 November 2026.
-- Read-only SELECT, run by the orchestrator through the database tool on 2026-11-28 about 03:20 UTC.
-- The result is one text (csv) with its row count, MD5 and length; the text is saved as tick_log_event.csv.
-- Expected: n = 64, md5 = 46c312dc79d5f436d03cbe0561cb6df8, length = 17320 characters.
-- Check of the saved file: `md5 -q tick_log_event.csv` must print the same MD5.
--
-- Columns: tick (start of the run, UTC); lf_q, lf_qT (Little Falls flow and its reading time, ms since 1970);
-- por_q, por_qT (Point of Rocks); ef_h, ef_hT (Edwards Ferry stage); dr_q, dr_t, dr_why (Difficult Run flow,
-- reading time, reason if not clean); sen_q, br_q, goose_q, mono_q (Seneca, Broad Run, Goose Creek, Monocacy);
-- raw_cfs (the model before the correction); corr_c (the correction); corr_unc (corrected, before the cap);
-- corr_bin, corr_st (the cell); ceil_lim (the cap, 120% of Little Falls), ceil_bound (cap holding);
-- final_cfs (the value shown by the server); trv_gf2lf (the app's clock, hours), trv_stop, trv_t (Point of Rocks
-- to Great Falls, hours); due (when the estimate is scored); slot; out; ver; adv_ef, adv_lfr, adv_lfe (the two notes).

with rows as (
  select gauge_id,
    concat_ws(',',
      gauge_id,
      coalesce(data->'in'->'lf'->>'q',''), coalesce(data->'in'->'lf'->>'qT',''),
      coalesce(data->'in'->'por'->>'q',''), coalesce(data->'in'->'por'->>'qT',''),
      coalesce(data->'in'->'ef'->>'h',''), coalesce(data->'in'->'ef'->>'hT',''),
      coalesce(data->'in'->'dr'->>'q',''), coalesce(data->'in'->'dr'->>'t',''), coalesce(data->'in'->'dr'->>'why',''),
      coalesce(data->'in'->'sen'->>'q',''), coalesce(data->'in'->'br'->>'q',''), coalesce(data->'in'->'goose'->>'q',''), coalesce(data->'in'->'mono'->>'q',''),
      coalesce(data->'raw'->>'cfs',''), coalesce(data->'corr'->>'c',''), coalesce(data->'corr'->>'unc',''),
      coalesce(data->'corr'->>'bin',''), coalesce(data->'corr'->>'st',''),
      coalesce(data->'ceil'->>'lim',''), coalesce(data->'ceil'->>'bound',''),
      coalesce(data->'final'->>'cfs',''),
      coalesce(data->'trv'->>'gf2lf',''), coalesce(data->'trv'->>'stop',''), coalesce(data->'trv'->>'t',''),
      coalesce(data->>'due',''), coalesce(data->>'slot',''), coalesce(data->>'out',''), coalesce(data->>'ver',''),
      coalesce(data->'adv'->>'ef',''), coalesce(data->'adv'->>'lfr',''), coalesce(data->'adv'->>'lfe','')
    ) as line
  from potomac_observations
  where observation_type = 'tick_log' and gauge_id >= '2026-11-25T12:00' and gauge_id < '2026-11-28T03:30'
), agg as (
  select 'tick,lf_q,lf_qT,por_q,por_qT,ef_h,ef_hT,dr_q,dr_t,dr_why,sen_q,br_q,goose_q,mono_q,raw_cfs,corr_c,corr_unc,corr_bin,corr_st,ceil_lim,ceil_bound,final_cfs,trv_gf2lf,trv_stop,trv_t,due,slot,out,ver,adv_ef,adv_lfr,adv_lfe' || E'\n' || string_agg(line, E'\n' order by gauge_id) || E'\n' as csv, count(*) as n
  from rows
)
select n, md5(csv) as md5, length(csv) as len, csv from agg;
