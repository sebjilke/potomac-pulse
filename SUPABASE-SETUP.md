# Supabase Setup — Security & Performance

Run these in Supabase Dashboard → SQL Editor. Items from TODO.md Tier 1.

---

## 1. Enable Row Level Security (RLS)

**Why:** Without RLS, anyone who discovers the Supabase URL + anon key can INSERT/UPDATE/DELETE.

```sql
-- Enable RLS on the table
ALTER TABLE potomac_observations ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (anon key = public reads)
CREATE POLICY "Allow public reads"
  ON potomac_observations
  FOR SELECT
  USING (true);

-- Only service_role can insert
CREATE POLICY "Service role can insert"
  ON potomac_observations
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Only service_role can update
CREATE POLICY "Service role can update"
  ON potomac_observations
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- Only service_role can delete
CREATE POLICY "Service role can delete"
  ON potomac_observations
  FOR DELETE
  USING (auth.role() = 'service_role');
```

**Verify:** After applying, test with the anon key — SELECTs should work, INSERTs should fail.

---

## 2. Composite Index

**Why:** The 2h cron and sync-learning both query by `(observation_type, gauge_id)` constantly. Without an index, every query is a sequential scan.

```sql
CREATE INDEX idx_obs_type_gauge_created
  ON potomac_observations (observation_type, gauge_id, created_at DESC);
```

---

## 3. Database Constraints (Optional)

App-level validation already exists. These are defense-in-depth.

```sql
-- Require observation_type and gauge_id
ALTER TABLE potomac_observations
  ALTER COLUMN observation_type SET NOT NULL,
  ALTER COLUMN gauge_id SET NOT NULL;

-- Reject timestamps before 2020 (clearly bad data)
ALTER TABLE potomac_observations
  ADD CONSTRAINT chk_created_at_reasonable
  CHECK (created_at > '2020-01-01'::timestamptz);
```

---

## Verification

After running all SQL:

1. Check RLS is enabled: `SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'potomac_observations';` → `relrowsecurity = true`
2. Check index exists: `SELECT indexname FROM pg_indexes WHERE tablename = 'potomac_observations';`
3. Test from client: anon key SELECT should work, INSERT should fail with RLS error
