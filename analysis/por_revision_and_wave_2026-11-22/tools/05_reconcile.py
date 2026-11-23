#!/usr/bin/env python3
"""Step 5: independent recount raw -> tidy (counts and 30 seeded random cell traces). Python 3 stdlib only.
Writes data/tidy/RECONCILE.json and exits non-zero on any mismatch. Does not compare old with current values."""
import csv, json, os, sys, gzip, glob, random, collections, datetime as dt
STUDY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(STUDY, 'data', 'raw'); T = os.path.join(STUDY, 'data', 'tidy')
out = {}; bad = []
def nrows(fn):
    with open(os.path.join(T, fn), newline='') as f: return sum(1 for _ in csv.reader(f)) - 1
def utc(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def check(name, a, b):
    out[name] = {'raw_side': a, 'tidy_side': b, 'ok': a == b}
    if a != b: bad.append(name)
# old archive / oct pull
def old_count(paths):
    n = 0; blanks = 0
    for p in paths:
        for t in json.load(open(p))['value']['timeSeries']:
            for b in t['values']:
                n += len(b['value']); blanks += sum(1 for x in b['value'] if float(x['value']) == -999999.0)
    return n, blanks
arch = [p for p in sorted(glob.glob(os.path.join(RAW, 'archive_old', '*.json'))) if not p.endswith('FETCH_MANIFEST.json')]
n, b = old_count(arch)
rep = json.load(open(os.path.join(T, 'BUILD_REPORT.json')))
check('readings_old_archive rows (raw values count)', n, nrows('readings_old_archive.csv'))
out['readings_old_archive sentinel blanks (raw)'] = b
n, b = old_count([os.path.join(RAW, 'oct_pull', 'usgs_iv_2026-10-05_2026-10-22.json')])
check('readings_old_octpull rows', n, nrows('readings_old_octpull.csv'))
# new service
def new_count(pulls):
    n = 0; dropped = 0; nulls = 0
    for pull in pulls:
        for f in sorted(glob.glob(os.path.join(RAW, 'usgs', pull + '_p*.json.gz'))):
            j = json.loads(gzip.decompress(open(f, 'rb').read()))
            for x in j['features']:
                p = x['properties']
                if p['statistic_id'] != '00011': dropped += 1
                else: n += 1
    return n, dropped
M = ['t1_por_00060', 't1_por_00065', 't2_lf_00060', 't2_lf_00065', 't4_mono_goose_00060', 't4_br_sen_00060', 't4_ef_00065', 't4_por_00010']
n, d = new_count(M); check('readings_current_model rows (+dups 0)', n - sum(s['exact_duplicate_rows_dropped'] for s in rep['readings_current_model']['by_source_file'].values()), nrows('readings_current_model.csv'))
n, d = new_count(['t5_upstream']); check('readings_current_upstream rows', n, nrows('readings_current_upstream.csv'))
n, d = new_count(['t6_census_por_00060', 't6_census_lf_00060', 't1_por_00060', 't2_lf_00060']); check('readings_current_census rows', n, nrows('readings_current_census.csv'))
out['dropped_not_00011_total'] = d
# runs / checks / bins / fm / sites
tl = json.load(open(os.path.join(RAW, 'supabase', 'tick_log.json')))
check('runs rows', len(tl), nrows('runs.csv'))
def tailn(rows):
    n = 0
    for r in rows:
        def f(o):
            nonlocal n
            for k, v in o.items():
                if isinstance(v, dict):
                    if k == 'tail' and 'v' in v: n += len(v['v'])
                    else: f(v)
        f(r['data'])
    return n
check('runs_tails rows', tailn(tl), nrows('runs_tails.csv'))
vl = json.load(open(os.path.join(RAW, 'supabase', 'validation_log.json')))
check('checks rows', len(vl), nrows('checks.csv'))
st = json.load(open(os.path.join(RAW, 'supabase', 'state_rows.json')))
exp = sum(len(r['data']['bins']) for r in st if r['observation_type'] == 'bin_snapshot') + sum(1 for r in st if r['observation_type'] == 'gf_correction_bin')
check('bins rows', exp, nrows('bins.csv'))
so = json.load(open(os.path.join(T, 'state_other.json')))
check('state_other rows (gf_metadata+gf_prediction+validation_failure)', sum(1 for r in st if r['observation_type'] in ('gf_metadata', 'gf_prediction', 'validation_failure')), sum(len(so[k]) for k in ('gf_metadata', 'gf_prediction', 'validation_failure')))
fm = 0
for pull in ('t3_fm_por_lf', 't7_fm_upstream'):
    for f in glob.glob(os.path.join(RAW, 'usgs', pull + '_p*.json.gz')): fm += len(json.loads(gzip.decompress(open(f, 'rb').read()))['features'])
check('field_measurements rows (+exact dups)', fm, nrows('field_measurements.csv') + rep['field_measurements']['exact_duplicates_dropped'])
j = json.loads(gzip.decompress(open(os.path.join(RAW, 'usgs', 't3b_sites_all_p001.json.gz'), 'rb').read()))
check('sites rows', len(j['features']), nrows('sites.csv'))
# 30 seeded random cell traces in readings tables
rnd = random.Random(20261122); traced = []
def trace_old(fn, rootdir):
    rows = list(csv.DictReader(open(os.path.join(T, fn), newline='')))
    for r in rnd.sample(rows, 6):
        d = json.load(open(os.path.join(STUDY, r['source_file'])))
        found = None
        for t in d['value']['timeSeries']:
            g = t['sourceInfo']['siteCode'][0]['value']; p = t['variable']['variableCode'][0]['value']
            if (g, p) != (r['gauge'], r['parameter']): continue
            for b in t['values']:
                for x in b['value']:
                    if utc(x['dateTime']) == r['time_utc']: found = x
        ok = found is not None and ((r['value'] == '' and float(found['value']) == -999999.0) or r['value'] == found['value'])
        traced.append({'table': fn, 'gauge': r['gauge'], 'param': r['parameter'], 'time_utc': r['time_utc'], 'tidy_value': r['value'], 'raw_dateTime': found and found['dateTime'], 'raw_value': found and found['value'], 'ok': ok})
        if not ok: bad.append('trace ' + str(traced[-1]))
def trace_new(fn):
    rows = list(csv.DictReader(open(os.path.join(T, fn), newline='')))
    for r in rnd.sample(rows, 6):
        j = json.loads(gzip.decompress(open(os.path.join(STUDY, r['source_file']), 'rb').read()))
        found = None
        for x in j['features']:
            p = x['properties']
            if p['monitoring_location_id'] == 'USGS-' + r['gauge'] and str(p['parameter_code']) == r['parameter'] and utc(p['time']) == r['time_utc']: found = p
        ok = found is not None and (found['value'] or '') == r['value'] and (utc(found['last_modified']) == utc(r['last_modified_utc']))
        traced.append({'table': fn, 'gauge': r['gauge'], 'param': r['parameter'], 'time_utc': r['time_utc'], 'tidy_value': r['value'], 'raw_time': found and found['time'], 'raw_value': found and found['value'], 'ok': ok})
        if not ok: bad.append('trace ' + str(traced[-1]))
trace_old('readings_old_archive.csv', 'archive_old'); trace_old('readings_old_octpull.csv', 'oct_pull')
for fn in ('readings_current_model.csv', 'readings_current_upstream.csv', 'readings_current_census.csv'): trace_new(fn)
# 6 runs cells
runs = list(csv.DictReader(open(os.path.join(T, 'runs.csv'), newline='')))
byid = {r['id']: r for r in tl}
for r in rnd.sample(runs, 6):
    d = byid[r['row_id']]['data']
    for col, path in (('in_por_q', ('in', 'por', 'q')), ('raw_cfs', ('raw', 'cfs')), ('trv_t', ('trv', 't')), ('final_cfs', ('final', 'cfs'))):
        v = d
        for k in path: v = v.get(k) if isinstance(v, dict) else None
        ok = (r[col] == '' and v is None) or (v is not None and float(r[col]) == float(v))
        traced.append({'table': 'runs.csv', 'row_id': r['row_id'], 'col': col, 'tidy': r[col], 'raw': v, 'ok': ok})
        if not ok: bad.append('trace runs ' + col)
out['traced_cells'] = traced; out['traced_all_ok'] = all(t['ok'] for t in traced); out['n_traced'] = len(traced)
json.dump(out, open(os.path.join(T, 'RECONCILE.json'), 'w'), indent=1)
for k, v in out.items():
    if isinstance(v, dict) and 'ok' in v: print(k, v)
print('traced', len(traced), 'all ok', out['traced_all_ok']); print('MISMATCHES:' if bad else 'ALL RECONCILE', bad)
sys.exit(1 if bad else 0)
