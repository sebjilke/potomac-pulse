# Supabase exports (read-only SELECTs)

Exported by the orchestrator on 2026-11-22 at about 10:51 UTC. Project database table `potomac_observations`.

Frozen by tools/01_freeze_local.py from the session tool-result files named below (copy made 2026-11-22).

## tick_log.json (305 rows)

Source file: `/Users/sebjilke/.claude/projects/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/tool-results/mcp-claude_ai_Supabase-execute_sql-1795344705680-efw1x0.txt`

```sql
select id, created_at, observation_type, gauge_id, data from potomac_observations where observation_type = 'tick_log' and created_at < '2026-11-22 10:30:00+00' order by created_at, id;
```

## validation_log.json (20 rows)

Source file: `/Users/sebjilke/.claude/projects/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/tool-results/mcp-claude_ai_Supabase-execute_sql-1795344710164-jg0vdu.txt`

```sql
select id, created_at, observation_type, gauge_id, data from potomac_observations where observation_type = 'validation_log' and created_at < '2026-11-22 10:30:00+00' order by created_at, id;
```

## state_rows.json (97 rows)

Source file: `/Users/sebjilke/.claude/projects/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/tool-results/mcp-claude_ai_Supabase-execute_sql-1795344714793-arl5qf.txt`

```sql
select id, created_at, observation_type, gauge_id, data from potomac_observations where observation_type in ('bin_snapshot','gf_correction_bin','gf_metadata','gf_prediction','validation_failure') and created_at < '2026-11-22 10:30:00+00' order by observation_type, created_at, id;
```
