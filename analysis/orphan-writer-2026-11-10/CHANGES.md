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

## 3. Public-write access rule: REMOVED (2026-11-13)

All times UTC, 2026-11-13. The owner said "drop the rule" at about 15:19.

What happened:
- 15:20:02: the five policies were recorded (the same five as on 2026-11-10: "Allow public access",
  "Allow public reads", "Service role can delete", "Service role can insert", "Service role can
  update").
- API gateway log, previous 24 h: 1,081 requests, all with role `service_role` (user agent `node`:
  812 GET, 226 POST, 43 DELETE). No request with role `anon`.
- Two attempts by the assistant to run the statement (about 15:20 and 15:27) were declined at the
  confirmation step. Nothing changed (checked at 15:20:27 and 15:27:42, five policies each time).
- The owner then ran it in the Supabase SQL editor, between 15:27:42 (policy present) and 15:30:54
  (policy absent), and reported "done. success":

  `drop policy "Allow public access" on public.potomac_observations;`

State after (15:30:54 and 15:31:39): four policies remain ("Allow public reads" SELECT true; three
"Service role can ..." policies tied to `auth.role() = 'service_role'`); row-level security
enabled, not forced; `anon` and `authenticated` do not bypass RLS, `service_role` does; no write
policy that is not tied to `service_role`; 303 rows; no probe rows.

Independent verification (fresh verifier, 16:04, read-only): PASS WITH GAPS.
- Policy state as above. For `anon`, an INSERT fails the WITH CHECK and UPDATE or DELETE see no
  rows.
- The 16:00 run (first after the change) wrote as before: `tick_log` row at 16:01:02.254
  (gauge_id 2026-11-13T16:00:59.322Z; `err` null, `out` "predicted", `aux.logFail` empty), the same
  as the 14:00 and 15:00 runs.
- Gateway log after the change: one run's worth of writes (POST 200 x8, DELETE 204 x2, POST 201
  x1), no 401, 403, other 4xx or 5xx, no `anon` request.
- Site endpoint at 16:04:16: lastPrediction 2026-11-13T16:01:01.691Z, consecutiveRuns 544 (was
  543), missedRuns 656 and binWriteFailures 0 unchanged.

Gaps (not verified):
- No live write attempt as `anon` was made. The planned probe inside a rolled-back transaction was
  declined at the confirmation step, like the drop itself. "anon cannot write" rests on the policy
  list and Postgres RLS semantics, not on an observed rejection.
- Only one hourly run has been observed since the change. The daily `bin_snapshot` (03:00) and the
  next `validation_log` write have not run yet.

Reviewer findings, recorded and NOT acted on:
- `anon` and `authenticated` still hold table-level INSERT, UPDATE, DELETE and TRUNCATE grants
  (Supabase defaults), so RLS is the only barrier. TRUNCATE is not subject to RLS; it has no route
  through the REST API today and no function in `public` runs it.
- `public.run_potomac_learning()` is SECURITY INVOKER and callable by `anon` through the API. As
  `anon` its insert is now blocked by RLS. It also calls `net.http_get`; `anon` has USAGE on schema
  `net` and EXECUTE on `net.http_get`. Whether `net.http_get` is directly callable by `anon`
  through the API was not checked. The function is already on the cleanup list in section 1.
- "Allow public reads" stays: a holder of the anon key can still read every row.

Undo, if something breaks:
`create policy "Allow public access" on public.potomac_observations for all to public using (true) with check (true);`

## 4. Cleanup of the old job (started 2026-11-13)

All times UTC, 2026-11-13. The owner gave the go-ahead at about 16:55 ("old-job clean up it is"),
four days before the date planned in section 1 (2026-11-17). Reason it was judged safe to go early:
0 runs and 0 pg_net responses since the pause on 2026-11-10 18:01, no call to any edge function and
no read of the eleven rows in the previous 24 h of logs, nothing depends on the database function,
and the app code never reads these row types. Copies of everything to be deleted were saved first:
`BACKUP-before-cleanup-2026-11-13.md` in this folder.

Step 1, scheduled job removed (done 17:02:27, by the assistant):

`select cron.unschedule('potomac-learning-job');` returned true.

Checked at 17:02:32: `cron.job` has 0 rows; the 28,792 history rows in `cron.job_run_details` are
kept. This also removes the anon key that was stored in the job's command.

Undo: re-create the job with `cron.schedule` (shape of the command is described in the backup
file; it needs the anon key from the dashboard).
