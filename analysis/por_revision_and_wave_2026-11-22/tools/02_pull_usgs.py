#!/usr/bin/env python3
"""Step 2: keyless pulls from USGS's new service (api.waterdata.usgs.gov OGC API).
Python 3 stdlib only. Usage (from anywhere):
  python3 -I tools/02_pull_usgs.py --list              show the plan and what is already saved
  python3 -I tools/02_pull_usgs.py --probe             ONE small request (learns limit and paging)
  python3 -I tools/02_pull_usgs.py --run PULLNAME ...  pull the named pulls (in the order given)
  python3 -I tools/02_pull_usgs.py --run all           every pull in priority order
Rules: no key is read or sent; >= 15 s between requests (also across processes); HTTP 429 honours Retry-After
(max 3 waits, then the pull STOPS and is recorded as incomplete); never re-requests a saved page; a page that
is listed in the log as obtained but is missing on disk is an error, not a silent re-pull."""
import json, os, sys, time, gzip, hashlib, datetime as dt, urllib.request, urllib.error, urllib.parse

STUDY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(STUDY, 'data', 'raw', 'usgs')
PLAN = os.path.join(OUT, 'PULL_PLAN.json')
LOGF = os.path.join(OUT, 'PULL_LOG.json')       # one entry per HTTP attempt, append-only
BASE = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/'
UA = 'por-study-freeze/1.0 (python-urllib; keyless)'
GAP = 15.0
PROPS_CONT = 'monitoring_location_id,parameter_code,statistic_id,time,value,approval_status,qualifier,last_modified,time_series_id'
LIMIT = 50000

MODEL = {'por':'01638500','lf':'01646500','mono':'01643000','goose':'01644000','br':'01644280','sen':'01645000','ef':'01644148'}
UP = {'shepherdstown':'01618000','hancock':'01613000','pawpaw':'01610000','millville':'01636500','antietam':'01619500',
      'conococheague':'01614500','opequon':'01616500','catoctin':'01637500'}
ALL_SITES = list(MODEL.values()) + list(UP.values())

def iso(t): return t.strftime('%Y-%m-%dT%H:%M:%SZ')
def get_plan():
    if os.path.exists(PLAN): return json.load(open(PLAN))
    now = dt.datetime.now(dt.timezone.utc)
    cut = now.replace(minute=0, second=0, microsecond=0)
    y, m = cut.year - 2, cut.month
    plan = {'plan_created_utc': iso(now), 'cutoff_utc': iso(cut),
            'census_start_utc': iso(cut.replace(year=y)),
            'note': 'cutoff = last full hour before the first pull script run; every continuous window ends at the cutoff (inclusive)'}
    os.makedirs(OUT, exist_ok=True)
    json.dump(plan, open(PLAN,'w'), indent=1)
    return plan

def cont_url(sites, params, start, end, props=PROPS_CONT):
    q = [('f','json'), ('monitoring_location_id', ','.join('USGS-'+s for s in sites)),
         ('parameter_code', ','.join(params)), ('time', '%s/%s' % (start, end)),
         ('limit', str(LIMIT)), ('skipGeometry','true'), ('properties', props)]
    return BASE + 'continuous/items?' + '&'.join('%s=%s' % (k, urllib.parse.quote(v, safe=',:/')) for k,v in q)

def pulls(plan):
    cut, c0 = plan['cutoff_utc'], plan['census_start_utc']
    s0 = '2026-06-12T00:00:00Z'; s9 = '2026-09-01T00:00:00Z'
    pre = '2026-06-11T23:59:59Z'
    P = []
    def add(name, tier, url, desc): P.append({'name':name,'tier':tier,'url':url,'desc':desc})
    add('t1_por_00060', 1, cont_url([MODEL['por']],['00060'],s0,cut), 'Point of Rocks flow, 12 Jun to cutoff')
    add('t1_por_00065', 1, cont_url([MODEL['por']],['00065'],s0,cut), 'Point of Rocks level, 12 Jun to cutoff')
    add('t2_lf_00060', 2, cont_url([MODEL['lf']],['00060'],s0,cut), 'Little Falls flow')
    add('t2_lf_00065', 2, cont_url([MODEL['lf']],['00065'],s0,cut), 'Little Falls level')
    fm = BASE + 'field-measurements/items?f=json&monitoring_location_id=USGS-%s,USGS-%s&limit=%d&skipGeometry=true' % (MODEL['por'], MODEL['lf'], LIMIT)
    add('t3_fm_por_lf', 3, fm, 'Field measurements, Point of Rocks and Little Falls, everything offered')
    ids = ','.join('USGS-'+s for s in ALL_SITES)
    add('t3b_sites_all', 3, BASE + 'monitoring-locations/items?f=json&id=%s&limit=100&skipGeometry=true' % ids, 'Site information, all 15 gauges (id filter)')
    add('t4_mono_goose_00060', 4, cont_url([MODEL['mono'],MODEL['goose']],['00060'],s0,cut), 'Monocacy + Goose Creek flow')
    add('t4_br_sen_00060', 4, cont_url([MODEL['br'],MODEL['sen']],['00060'],s0,cut), 'Broad Run + Seneca flow')
    add('t4_ef_00065', 4, cont_url([MODEL['ef']],['00065'],s0,cut), 'Edwards Ferry level')
    add('t4_por_00010', 4, cont_url([MODEL['por']],['00010'],s0,cut), 'Point of Rocks water temperature')
    add('t5_upstream', 5, cont_url(list(UP.values()),['00060','00065'],s9,cut), 'Upstream gauges flow+level, 1 Sep to cutoff')
    add('t6_census_por_00060', 6, cont_url([MODEL['por']],['00060'],c0,pre), 'Census extension: Point of Rocks flow, 24 months back to 11 Jun 2026')
    add('t6_census_lf_00060', 6, cont_url([MODEL['lf']],['00060'],c0,pre), 'Census extension: Little Falls flow')
    fm2 = BASE + 'field-measurements/items?f=json&monitoring_location_id=%s&time=2025-01-01T00:00:00Z/%s&limit=%d&skipGeometry=true' % (
        ','.join('USGS-'+s for s in UP.values()), cut, LIMIT)
    add('t7_fm_upstream', 7, fm2, 'Field measurements, eight upstream gauges since 2025-01-01')
    return P

def load_log():
    return json.load(open(LOGF)) if os.path.exists(LOGF) else []
def save_log(L):
    tmp = LOGF + '.tmp'; json.dump(L, open(tmp,'w'), indent=1); os.replace(tmp, LOGF)

def wait_gap(L):
    if L:
        last = dt.datetime.strptime(L[-1]['request_time_utc'], '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=dt.timezone.utc)
        el = (dt.datetime.now(dt.timezone.utc) - last).total_seconds()
        # also count the duration of the last request
        if el < GAP: time.sleep(GAP - el)

def request(name, page, url, L):
    """one HTTP attempt; logged; returns (status, body_bytes_or_None, entry)"""
    wait_gap(L)
    t = dt.datetime.now(dt.timezone.utc)
    ent = {'pull': name, 'page': page, 'url': url, 'request_time_utc': t.strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
           'status': None, 'headers': None, 'bytes_transferred': None, 'bytes': None, 'sha256': None, 'file': None, 'error': None}
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    body = None
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read(); ent['status'] = r.status; hdr = dict(r.headers.items())
            enc = hdr.get('Content-Encoding', '')
    except urllib.error.HTTPError as e:
        raw = e.read(); ent['status'] = e.code; hdr = dict(e.headers.items()); enc = hdr.get('Content-Encoding','')
        ent['error'] = 'HTTPError %s' % e.code
    except Exception as e:
        ent['error'] = repr(e); L.append(ent); save_log(L); return None, None, ent
    ent['headers'] = hdr; ent['bytes_transferred'] = len(raw)
    body = gzip.decompress(raw) if 'gzip' in enc.lower() else raw
    ent['bytes'] = len(body); ent['sha256'] = hashlib.sha256(body).hexdigest()
    ent['duration_s'] = round((dt.datetime.now(dt.timezone.utc) - t).total_seconds(), 2)
    L.append(ent); save_log(L)
    return ent['status'], body, ent

def fetch_saved(name, page, url, L, say):
    """returns (parsed_json or None, status). Uses the saved file if present."""
    fn = '%s_p%03d.json.gz' % (name, page)
    path = os.path.join(OUT, fn)
    done = [e for e in L if e['pull']==name and e['page']==page and e['file']==fn]
    if os.path.exists(path):
        if not done: sys.exit('STOP: %s exists but is not in the log' % fn)
        return json.loads(gzip.decompress(open(path,'rb').read())), 'saved'
    if done: sys.exit('STOP: log says %s was obtained but the file is missing (not re-pulling silently; remove the log entry by hand to allow it)' % fn)
    waits = 0; srv = 0
    while True:
        st, body, ent = request(name, page, url, L)
        if st == 200:
            with open(path,'wb') as f:
                f.write(gzip.compress(body, 9, mtime=0))
            ent['file'] = fn; save_log(L)
            say('  saved %s (%d bytes, sha256 %s...)' % (fn, ent['bytes'], ent['sha256'][:12]))
            return json.loads(body), 200
        if st == 429:
            ra = (ent['headers'] or {}).get('Retry-After') or (ent['headers'] or {}).get('retry-after')
            waits += 1
            say('  HTTP 429 (Retry-After=%s), attempt %d' % (ra, waits))
            if waits > 3: return None, 429
            try: w = float(ra)
            except Exception: w = 60.0 * waits
            time.sleep(max(w, 30.0) + 5); continue
        if st is None or (st and st >= 500):
            srv += 1; say('  status %s error %s, attempt %d' % (st, ent['error'], srv))
            if srv > 2: return None, st
            time.sleep(60); continue
        say('  HTTP %s: not retried. body[:300]=%r' % (st, (body or b'')[:300]))
        return None, st

def next_link(j):
    for l in (j.get('links') or []):
        if l.get('rel') == 'next': return l.get('href')
    return None

def run_pull(p, say):
    L = load_log(); page = 1; url = p['url']; rows = 0
    say('PULL %s: %s' % (p['name'], p['desc']))
    while True:
        j, st = fetch_saved(p['name'], page, url, L, say)
        if j is None:
            say('  STOPPED: pull %s incomplete after %d page(s); last status %s' % (p['name'], page-1, st)); return False
        feats = j.get('features') or []; rows += len(feats)
        nx = next_link(j)
        if not nx: break
        if page > 40: say('  STOP: more than 40 pages'); return False
        page += 1; url = nx
    say('  complete: %d page(s), %d feature(s)' % (page, rows)); return True

def main():
    a = sys.argv[1:]
    plan = get_plan(); P = pulls(plan)
    say = lambda s: print(s, flush=True)
    if not a or a[0] == '--list':
        say(json.dumps(plan)); L = load_log()
        for p in P:
            n = len([e for e in L if e['pull']==p['name'] and e['file']])
            say('%-24s tier %d  pages saved: %d   %s' % (p['name'], p['tier'], n, p['desc']))
        say('attempts logged: %d' % len(L)); return
    if a[0] == '--probe':
        L = load_log()
        if L: sys.exit('probe already done or log not empty')
        s = dt.datetime.strptime(plan['cutoff_utc'],'%Y-%m-%dT%H:%M:%SZ')
        url = cont_url([MODEL['por']],['00060'], iso(s - dt.timedelta(hours=6)), plan['cutoff_utc'])
        run_pull({'name':'probe_por_00060_6h','desc':'PROBE: Point of Rocks flow, 6 hours, limit=%d' % LIMIT,'url':url}, say); return
    if a[0] == '--run':
        names = [p['name'] for p in P] if a[1:] == ['all'] else a[1:]
        byname = {p['name']:p for p in P}
        for n in names:
            if n not in byname: sys.exit('unknown pull %s' % n)
        for n in names:
            if not run_pull(byname[n], say): say('stopping run after incomplete pull'); return
        return
    sys.exit(__doc__)
main()
