# Changes made after the A10 investigation

All times UTC, 2026-11-10. Approved by the owner ("do what you recommend").

## 1. Scheduled job paused (done 18:01:04)

`select cron.alter_job(job_id := 2, active := false);`

Job 2 is `potomac-learning-job`, schedule `*/15 * * * *`, which called the edge function
`potomac-learner`. Last run before the pause: 18:00:00 (runid 28793 in cron.job_run_details; 28,792
runs were recorded for the job in total). The job definition is untouched, only its `active` flag
changed.

Verified independently at 18:16:55: job inactive, no run at 18:15, no pg_net response after
18:00:00, no call to the function and no Deno request in the API log since the pause; the function,
the five RLS policies and the eleven rows the function owns are unchanged; the app's own hourly job
ran normally at 18:01 (missedRuns still 656).

Also found, not changed: a database function `public.run_potomac_learning()` (calls USGS through
pg_net, no recorded calls, nothing depends on it). It belongs with the cleanup below. The anon key
remains embedded in the paused job's stored command until the job is unscheduled.

Undo: `select cron.alter_job(job_id := 2, active := true);`

Not done, planned for on or after 2026-11-17 if nothing misses the job:
- delete the edge function `potomac-learner`;
- delete the rows it owns: nine `rise_event` rows, `metadata/system`, `snapshot/current`.
  Only after the function is gone, otherwise they refill (this is what happened after v37.1).

## 2. Public-write access rule: NOT changed

The table has a permissive policy, "Allow public access" (ALL, role public, USING true, WITH CHECK
true). Postgres ORs permissive policies, so it overrides the three "Service role can ..." policies:
any holder of the anon key can insert, update or delete any row.

Evidence gathered (read-only, plus one rolled-back probe):
- Probe at 18:02:19, inside a transaction that was rolled back: acting as `anon`, one insert and one
  no-op update both succeeded. No probe row remains (checked 18:02:33).
- API gateway log, last 24 h: every request from the app (user agent `node`, 1,641 requests: GET,
  POST, DELETE) carried role `service_role`. No request carried role `anon`.
- `service_role` has BYPASSRLS, so the app does not depend on this policy.
- The anon key is not in `src/`, `dist/`, tracked files or git history. It is embedded in the
  command of the paused cron job.
- Lifetime statement statistics show 194 inserts ever made as `anon` (first seen 2026-01-14, the
  setup period). No timestamps are available for the most recent one.

The statement to remove it was prepared but declined at the permission prompt, so nothing was run:

`drop policy "Allow public access" on public.potomac_observations;`

Undo, if it is ever dropped and something breaks:
`create policy "Allow public access" on public.potomac_observations for all to public using (true) with check (true);`

Check after dropping: the next hourly app tick still writes (lastPrediction advances), and the
same anon probe now fails on insert and affects zero rows on update.
