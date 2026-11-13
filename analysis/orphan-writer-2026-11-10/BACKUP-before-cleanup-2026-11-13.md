# Copies taken before the A10 cleanup

Read on 2026-11-13 at 17:00 to 17:02 UTC, read-only, from Supabase project `sabbonifrduiunuebxzf`.
Nothing here contains a key. Everything the cleanup deletes can be rebuilt from this file, except
the stored command of the scheduled job (see section 1).

State at the time of the copy:
- pg_cron job 2 inactive; 28,792 runs in total, last start 2026-11-10 18:00:00 UTC, 0 runs since
  the pause at 18:01:04.
- `net._http_response`: 0 rows since the pause.
- API and function logs, previous 24 h: no call to any edge function, no `/rpc/` call, no request
  filtering on `rise_event`, `snapshot` or `metadata`.
- Nothing in `pg_depend` depends on `public.run_potomac_learning()`. It is the only function in
  schema `public`.
- App code (HEAD 355dda4) reads and writes `gf_metadata`, never `metadata`, `snapshot` or
  `rise_event`.

## 1. Scheduled job (pg_cron)

| jobid | jobname | schedule | active | database | username |
|---|---|---|---|---|---|
| 2 | potomac-learning-job | `*/15 * * * *` | false | postgres | postgres |

The `command` column was deliberately NOT read, because it embeds the anon key. Its shape, from the
2026-11-10 investigation: a `net.http_post` to `/functions/v1/potomac-learner` on this project with
an `Authorization: Bearer <anon key>` header. To rebuild it, use `cron.schedule` with that call and
the current anon key from the dashboard.

## 2. Edge function `potomac-learner`

id `e7f5898a-7f68-45fb-ab61-08b588d8ed4f`, version 1, status ACTIVE, `verify_jwt` true, created
and last updated 2026-01-14 (epoch ms 1768421055050), sha256
`9282697a55c82a83af8d8a2db628868ba4dd36222ba96557699fa1b906bed9a2`. One file,
`potomac-learner/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GAUGES: Record<string, { name: string; baseHrs: number }> = {
  "01646500": { name: "Little Falls", baseHrs: 0 },
  "01638500": { name: "Point of Rocks", baseHrs: 32 },
  "01636500": { name: "Millville", baseHrs: 48 },
  "01636000": { name: "Harpers Ferry", baseHrs: 45 },
  "01618000": { name: "Shepherdstown", baseHrs: 63 },
  "01613000": { name: "Hancock", baseHrs: 150 },
  "01611500": { name: "Cacapon River", baseHrs: 160 },
  "01610000": { name: "Paw Paw", baseHrs: 176 },
  "01620000": { name: "Cumberland", baseHrs: 226 },
  "01643000": { name: "Monocacy River", baseHrs: 18 },
  "01644000": { name: "Goose Creek", baseHrs: 12 },
  "01645000": { name: "Seneca Creek", baseHrs: 6 },
}

const LITTLE_FALLS_ID = "01646500"
const RISE_THRESHOLD = 0.02

async function fetchUSGSData() {
  const siteIds = Object.keys(GAUGES).join(",")
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteIds}&parameterCd=00060,00065&siteStatus=active`
  const response = await fetch(url)
  const json = await response.json()
  const data: Record<string, { q: number; h: number; timestamp: string }> = {}
  
  const timeSeries = json.value?.timeSeries || []
  for (const series of timeSeries) {
    const siteCode = series.sourceInfo?.siteCode?.[0]?.value
    if (!siteCode || !GAUGES[siteCode]) continue
    const paramCode = series.variable?.variableCode?.[0]?.value
    const values = series.values?.[0]?.value || []
    const latest = values[values.length - 1]
    if (!latest) continue
    if (!data[siteCode]) data[siteCode] = { q: 0, h: 0, timestamp: latest.dateTime }
    const val = parseFloat(latest.value)
    if (paramCode === "00060") data[siteCode].q = val
    else if (paramCode === "00065") data[siteCode].h = val
  }
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const currentData = await fetchUSGSData()
    const { data: prevSnapshot } = await supabase
      .from('potomac_observations')
      .select('data')
      .eq('observation_type', 'snapshot')
      .eq('gauge_id', 'current')
      .single()
    
    const previousData = prevSnapshot?.data || {}
    const rises: string[] = []
    const now = new Date().toISOString()
    
    for (const [gaugeId, current] of Object.entries(currentData)) {
      if (gaugeId === LITTLE_FALLS_ID || !current.q) continue
      const prev = previousData[gaugeId]
      if (!prev?.q) continue
      const pctChange = (current.q - prev.q) / prev.q
      if (pctChange >= RISE_THRESHOLD) {
        rises.push(gaugeId)
        await supabase.from('potomac_observations').insert({
          observation_type: 'rise_event',
          gauge_id: gaugeId,
          data: { timestamp: now, gauge_q: current.q, lf_q: currentData[LITTLE_FALLS_ID]?.q, pct_change: pctChange }
        })
      }
    }
    
    await supabase.from('potomac_observations').upsert({
      observation_type: 'snapshot',
      gauge_id: 'current',
      data: currentData
    })
    
    await supabase.from('potomac_observations').upsert({
      observation_type: 'metadata',
      gauge_id: 'system',
      data: { lastRun: now, risesDetected: rises.length, lfFlow: currentData[LITTLE_FALLS_ID]?.q }
    })

    return new Response(JSON.stringify({ success: true, rises: rises.length, timestamp: now }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
```

## 3. Database function `public.run_potomac_learning()`

Owner `postgres`, SECURITY INVOKER. From `pg_get_functiondef`:

```sql
CREATE OR REPLACE FUNCTION public.run_potomac_learning()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    usgs_response jsonb;
    current_data jsonb;
    previous_data jsonb;
    gauge_id text;
    current_q numeric;
    prev_q numeric;
    pct_change numeric;
    rises_detected text[] := '{}';
    lf_flow numeric;
    lf_stage numeric;
    result jsonb;
BEGIN
    -- Fetch current data from USGS API using pg_net
    SELECT net.http_get(
        'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01646500,01638500,01636500,01636000,01618000,01613000,01611500,01610000,01608500,01607500,01604500,01603000,01620000,01614500,01619500,01643000,01644000,01645000&parameterCd=00060,00065&siteStatus=active'
    ) INTO usgs_response;
    
    -- For now, just log that we ran and update metadata
    -- (pg_net is async, so we'll use a simpler approach)
    
    -- Update the last run time
    INSERT INTO potomac_observations (observation_type, gauge_id, data)
    VALUES (
        'metadata', 
        'system', 
        jsonb_build_object(
            'lastRun', now(),
            'status', 'executed'
        )
    )
    ON CONFLICT (observation_type, gauge_id) 
    DO UPDATE SET 
        data = potomac_observations.data || jsonb_build_object('lastRun', now()),
        created_at = now();
    
    RETURN jsonb_build_object('success', true, 'timestamp', now());
END;
$function$
```

## 4. The eleven rows in `public.potomac_observations`

Row counts by type at the time of the copy: `rise_event` 9, `metadata` 1, `snapshot` 1 (the app's
own rows are `gf_metadata` and `bin_snapshot`, different types, not touched). Columns: id,
created_at, observation_type, gauge_id, data.

```json
[
{"id":"fb4375dd-35dc-4b45-8a6c-dfccdf8b0ced","created_at":"2026-06-18T20:30:00.964325+00:00","observation_type":"metadata","gauge_id":"system","data":{"lfFlow":2650,"lastRun":"2026-06-18T20:30:00.857Z","risesDetected":2}},
{"id":"54a2677b-f0e6-4816-8021-3c5ff6418fc9","created_at":"2026-07-06T16:00:02.705825+00:00","observation_type":"rise_event","gauge_id":"01610000","data":{"lf_q":1980,"gauge_q":1740,"timestamp":"2026-07-06T16:00:02.644Z","pct_change":0.029585798816568046}},
{"id":"b69d9ff1-575c-42e2-9514-a35b720660b8","created_at":"2026-07-02T04:00:02.049459+00:00","observation_type":"rise_event","gauge_id":"01611500","data":{"lf_q":2400,"gauge_q":168,"timestamp":"2026-07-02T04:00:01.949Z","pct_change":0.05660377358490566}},
{"id":"065be7f4-6b6e-4f26-9db6-82947b61c15d","created_at":"2026-07-08T21:45:01.47035+00:00","observation_type":"rise_event","gauge_id":"01613000","data":{"lf_q":3010,"gauge_q":2270,"timestamp":"2026-07-08T21:45:01.335Z","pct_change":0.11274509803921569}},
{"id":"4afc765c-6e55-46a4-8ffa-83ff80ac0f1b","created_at":"2026-07-10T00:45:00.930752+00:00","observation_type":"rise_event","gauge_id":"01618000","data":{"lf_q":5290,"gauge_q":3030,"timestamp":"2026-07-10T00:45:00.792Z","pct_change":0.030612244897959183}},
{"id":"ab3d1c4f-5ce1-4d17-b08d-c9c8f4e7bc68","created_at":"2026-07-08T11:45:00.933756+00:00","observation_type":"rise_event","gauge_id":"01636500","data":{"lf_q":3510,"gauge_q":1260,"timestamp":"2026-07-08T11:45:00.857Z","pct_change":0.024390243902439025}},
{"id":"e1cd82bc-5120-465b-88d2-d5d27b673e89","created_at":"2026-07-06T14:15:02.011226+00:00","observation_type":"rise_event","gauge_id":"01638500","data":{"lf_q":1940,"gauge_q":2590,"timestamp":"2026-07-06T14:15:01.961Z","pct_change":0.027777777777777776}},
{"id":"678d821a-c44f-43cb-b1d4-18436b40f12f","created_at":"2026-06-18T20:30:00.898594+00:00","observation_type":"rise_event","gauge_id":"01643000","data":{"lf_q":2650,"gauge_q":253,"timestamp":"2026-06-18T20:30:00.857Z","pct_change":0.07203389830508475}},
{"id":"b4754156-cb44-4641-89f3-54dbaf2bdf29","created_at":"2026-06-18T20:30:00.920343+00:00","observation_type":"rise_event","gauge_id":"01644000","data":{"lf_q":2650,"gauge_q":49.9,"timestamp":"2026-06-18T20:30:00.857Z","pct_change":1.0705394190871367}},
{"id":"d883cab6-05a3-4444-bc8c-9f297c35e0b5","created_at":"2026-06-23T20:00:00.943973+00:00","observation_type":"rise_event","gauge_id":"01645000","data":{"lf_q":3280,"gauge_q":71.9,"timestamp":"2026-06-23T20:00:00.754Z","pct_change":0.15409309791332276}},
{"id":"d40c7fbe-1a2d-4a96-93ca-3894a5c442b3","created_at":"2026-01-14T20:05:17.458666+00:00","observation_type":"snapshot","gauge_id":"current","data":{"01610000":{"h":5.23,"q":1690,"timestamp":"2026-01-14T14:15:00.000-05:00"},"01611500":{"h":1.81,"q":159,"timestamp":"2026-01-14T14:30:00.000-05:00"},"01613000":{"h":4.18,"q":2040,"timestamp":"2026-01-14T14:15:00.000-05:00"},"01618000":{"h":2.85,"q":2940,"timestamp":"2026-01-14T14:30:00.000-05:00"},"01620000":{"h":1.51,"q":0,"timestamp":"2026-01-14T14:45:00.000-05:00"},"01636500":{"h":2.27,"q":1230,"timestamp":"2026-01-14T14:30:00.000-05:00"},"01638500":{"h":1.45,"q":2520,"timestamp":"2026-01-14T14:45:00.000-05:00"},"01643000":{"h":1.85,"q":236,"timestamp":"2026-01-14T14:30:00.000-05:00"},"01644000":{"h":1.38,"q":24.1,"timestamp":"2026-01-14T14:45:00.000-05:00"},"01645000":{"h":2.07,"q":62.3,"timestamp":"2026-01-14T14:50:00.000-05:00"},"01646500":{"h":2.99,"q":2800,"timestamp":"2026-01-14T14:50:00.000-05:00"}}}
]
```

To restore the rows: insert each object's `id`, `created_at`, `observation_type`, `gauge_id` and
`data` back into `public.potomac_observations` with the service key or in the SQL editor.
