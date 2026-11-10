# A10 sweep: hosting and repo history (read-only, 2026-11-10 ~17:55 UTC)

## Answer
(a) Writer = Supabase edge function `potomac-learner` (v1, created 2026-01-14, never updated), triggered by Supabase pg_cron job id 2 `potomac-learning-job`, schedule `*/15 * * * *`, active=true, via net.http_post. NOT in the repo (no supabase/ dir; git grep and git log -S for potomac-learner / RISE_THRESHOLD / potomac-learning-job all empty). NOT Netlify, NOT GitHub.
(b) STILL RUNNING today: cron.job_run_details jobid 2: 28,791 runs, all 'succeeded', first 2026-01-14 20:15 UTC, last 2026-11-10 17:45 UTC. net._http_response: 24 x HTTP 200 since 2026-11-10 12:00 UTC.
(c) To stop: unschedule/deactivate cron job 2 (cron.unschedule(2) or UPDATE cron.job SET active=false) and/or delete the edge function. NOT done (read-only). Needs owner decision, see "Effects of stopping".

## Evidence
- Edge function source (get_edge_function): fetches USGS iv for 12 gauges, reads potomac_observations (snapshot, current), for each gauge except Little Falls with pct rise >= 2% (RISE_THRESHOLD 0.02) does `insert` of observation_type 'rise_event' with data {timestamp, gauge_q, lf_q, pct_change}; then upserts snapshot/current and metadata/system. Uses service-role key from env.
- Row data matches: keys lf_q, gauge_q, timestamp, pct_change. Row timestamp equals created_at to ~0.1 s.
- Timing: v37.1 commit 8062113 is 2026-06-18 16:12:32 EDT = 20:12:32 UTC. v37.1 deleted the 43 System-1 rows (plan: 9 rise_event + metadata/system among them). First new rows: 01643000 and 01644000 at 2026-06-18 20:30:00 UTC (first quarter-hour after the delete), plus metadata/system recreated 20:30:00.96 with risesDetected=2 (matches the two rise rows). So the rows were not "orphan leftovers"; they are fresh inserts after the delete.
- 9 rows now (created_at UTC): 01643000 06-18 20:30; 01644000 06-18 20:30; 01645000 06-23 20:00; 01611500 07-02 04:00; 01638500 07-06 14:15; 01610000 07-06 16:00; 01636500 07-08 11:45; 01613000 07-08 21:45; 01618000 07-10 00:45. Latest 07-10 matches audit range. Not present: 01636000 (Harpers Ferry), 01620000 (Cumberland); not seen in rows (never inserted, or insert failed; not determined).
- Why no rows after 07-10 and why one per gauge: unique key (observation_type, gauge_id) makes any later insert fail; the function ignores the error. By the same mechanism snapshot/current is never updated (row created_at 2026-01-14 20:05, still there; upsert without onConflict fails on the unique key) and metadata/system stays at the 06-18 value. INFERRED: snapshot is therefore a stale Jan-14 baseline, so "rise" is measured vs Jan 14 flows, and rows only appear when a gauge is currently >=2% above that. The 9 rows are the first-time inserts; the function is still attempting and failing silently every 15 min (not directly observed; Supabase logs not read, query_logs call failed on schema, not retried).
- Plan doc analysis/system1-retirement-plan-2026-06-18.md line 154: "rise_event has zero source refs (legacy artifact)" and plan deleted 9 rise_event rows. True for repo; the writer lived only in Supabase. The v37.1 retirement missed it.
- Other DB state: cron.job has only job 2. No user triggers on public tables. Extensions pg_cron, pg_net present. Only one edge function on the project.
- Side effect: metadata/system (gauge 'system') row exists again (created 06-18 20:30); README/plan said System-1 metadata was deleted. snapshot/current row also exists (plan said investigate/leave it). Not checked whether current app code reads metadata/system (grep not done for that).
- Cron command embeds an anon-role JWT bearer in the job text (not printed here).

## 1. Repo
- git log -S rise_event --all: only 8062113 (v37.1), d97a6be, cc3440c (docs). No commit ever added code containing the string rise_event. Branches: main, v36.1-corrected-ci, worktree-wf_ad2bf50d-90c-4, origin/main; tags: none printed besides none. git grep rise_event at 8062113^ : no hits. Old client (gauge-learning.js) had a local variable riseEvents only; old sync-learning wrote observation_type 'observation'/'correction'/'metadata', never rise_event.
- netlify.toml history: only one scheduled function, scheduled-update, hourly "0 */1 * * *" (2h before 2026-05-26). No */15 anywhere in repo.
- Working tree grep for rise_event: only docs (README, TODO A10, analysis). No src/ or scripts/ writer. Old browser client posted metadata/corrections/observations on a 30s debounce, never rise_event; current sync-learning has no such action (only storePrediction etc.; legacy default POST removed in v37.1). A cached old bundle cannot write rise_event. (Current POST rejection of old-shaped body: read from grep only, not tested.)

## 3. Netlify (GET only)
- Account sites: potomac-pulse, gf-logger-app, jen-seb-recipes-app (latter two: no functions, no repo). 
- potomac-pulse: published deploy 6af3467510dd8e996584c22a, main, commit d97a6be, 2026-11-10. 42 deploys listed, all production/main/ready; no branch deploys, no previews, none locked. Published functions: analyze-stage-errors, build-ef-correlation-advanced, scheduled-update, sync-learning (scheduled-update is the only one with a schedule seen; I truncated output, so schedule fields of the last two not individually confirmed). No function named potomac-learner on Netlify.
- Other sites pointing at the Supabase project: NOT determined from env vars (env not read); the other two sites have no functions.

## 4. GitHub
- gh authenticated (sebjilke). Workflows: only test.yml (on push; no cron seen). Repos of owner: 11; code search for the project ref and rise_event under sebjilke returned nothing. Repo MCP github server failed to connect (not needed).

## Effects of stopping (for decision, not done)
- Disabling job 2 stops: USGS fetch, rise_event inserts (already blocked by unique key), and the failing snapshot/metadata upserts. Nothing in this codebase is known to depend on it. Not verified that no app code reads snapshot/current or metadata/system.
- Clean-up beyond that: delete the 9 rise_event rows, metadata/system, snapshot/current as a separate decision.

## Unverified
- Edge function invocation logs (not read); whether insert errors occur (inferred from unique key).
- Whether anything else (other than job 2) calls potomac-learner (e.g. external cron); only the pg_cron job observed.
