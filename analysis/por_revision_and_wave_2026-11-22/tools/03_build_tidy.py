#!/usr/bin/env python3
"""Step 3: build the tidy tables from the frozen raw files. Python 3 stdlib only.
Run: python3 -I tools/03_build_tidy.py        (writes data/tidy/*, data/tidy/BUILD_REPORT.json, data/MANIFEST.json)
No analysis, no interpolation, no resampling. Deduplication: exact duplicate rows only (counted)."""
import json, os, sys, csv, gzip, glob, hashlib, re, datetime as dt, collections

STUDY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(STUDY, 'data', 'raw'); TIDY = os.path.join(STUDY, 'data', 'tidy')
os.makedirs(TIDY, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
UTC = dt.timezone.utc
EPOCH = dt.datetime(1970, 1, 1, tzinfo=UTC)
REPORT = {}

def fmt_dt(d, force_frac=False):
    d = d.astimezone(UTC)
    if d.microsecond == 0 and not force_frac: return d.strftime('%Y-%m-%dT%H:%M:%SZ')
    if d.microsecond % 1000 == 0 and not force_frac: return d.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (d.microsecond // 1000)
    return d.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
def parse_iso(s):
    d = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    if d.tzinfo is None: raise ValueError('naive time ' + s)
    return d
def iso_utc(s): return fmt_dt(parse_iso(s))
def ms_utc(ms): return fmt_dt(EPOCH + dt.timedelta(milliseconds=int(ms)))
def cell(v):
    if v is None: return ''
    if isinstance(v, bool): return '1' if v else '0'
    if isinstance(v, float): return repr(v)
    return str(v)
def writer(path, cols):
    f = open(path, 'w', newline='', encoding='utf-8')
    w = csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator='\n')   # quotes only a field that contains a comma, quote or newline
    w.writerow(cols)
    class W:
        def row(self, vals):
            out = [cell(v) for v in vals]
            w.writerow(out)
        def close(self): f.close()
    return W()
def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

# ---------------------------------------------------------------- readings
RCOLS = ['gauge', 'parameter', 'time_utc', 'value', 'record', 'source_file', 'last_modified_utc', 'approval', 'qualifier']
APPR = {'Provisional': 'P', 'Approved': 'A', 'P': 'P', 'A': 'A'}
SENT = -999999.0

class ReadingsTable:
    def __init__(self, name, record):
        self.name, self.record = name, record
        self.w = writer(os.path.join(TIDY, name + '.csv'), RCOLS)
        self.seen = set(); self.stats = collections.OrderedDict()
        self.rows = 0
    def st(self, src):
        return self.stats.setdefault(src, collections.OrderedDict(
            [('features_in', 0), ('dropped_not_00011', collections.Counter()), ('blank_value_null', 0),
             ('blank_value_sentinel', 0), ('nonnumeric_value_kept', 0), ('exact_duplicate_rows_dropped', 0),
             ('same_key_different_content', 0), ('rows_written', 0), ('time_min_utc', None), ('time_max_utc', None)]))
    def add(self, src, gauge, param, time_utc, value, lm, appr, qual):
        s = self.st(src)
        # value handling
        if value is None: v = ''; s['blank_value_null'] += 1
        else:
            try: fv = float(value)
            except Exception: fv = None
            if fv is None: v = str(value); s['nonnumeric_value_kept'] += 1
            elif fv == SENT: v = ''; s['blank_value_sentinel'] += 1
            else: v = str(value)
        key = (gauge, param, time_utc, v, lm, appr, qual)
        if key in self.seen: s['exact_duplicate_rows_dropped'] += 1; return
        k2 = (gauge, param, time_utc)
        self.seen.add(key)
        self.keys2 = getattr(self, 'keys2', {})
        if k2 in self.keys2: s['same_key_different_content'] += 1
        self.keys2[k2] = 1
        self.w.row([gauge, param, time_utc, v, self.record, src, lm, appr, qual])
        s['rows_written'] += 1; self.rows += 1
        if s['time_min_utc'] is None or time_utc < s['time_min_utc']: s['time_min_utc'] = time_utc
        if s['time_max_utc'] is None or time_utc > s['time_max_utc']: s['time_max_utc'] = time_utc
    def close(self):
        self.w.close()
        for s in self.stats.values(): s['dropped_not_00011'] = dict(s['dropped_not_00011'])
        # inventory per series (read back from the csv just written): rows, first, last, blank values, step histogram in minutes
        ser = collections.defaultdict(list); blank = collections.Counter()
        with open(os.path.join(TIDY, self.name + '.csv'), newline='') as f:
            rd = csv.DictReader(f)
            for r in rd:
                k = r['gauge'] + '/' + r['parameter']; ser[k].append(r['time_utc'])
                if r['value'] == '': blank[k] += 1
        inv = {}
        for k, ts in sorted(ser.items()):
            ts.sort(); steps = collections.Counter()
            prev = None
            for t in ts:
                d = parse_iso(t)
                if prev is not None: steps[int((d - prev).total_seconds() // 60)] += 1
                prev = d
            inv[k] = {'rows': len(ts), 'first_utc': ts[0], 'last_utc': ts[-1], 'blank_values': blank[k], 'step_minutes_top5': steps.most_common(5)}
        REPORT[self.name] = {'rows': self.rows, 'series_inventory': inv, 'by_source_file': self.stats}

def old_rows(path, table, expect_gauge_param=None):
    d = json.load(open(path))
    src = os.path.relpath(path, STUDY)
    series = d['value']['timeSeries']
    s = table.st(src); anomalies = []
    for t in series:
        g = t['sourceInfo']['siteCode'][0]['value']; p = t['variable']['variableCode'][0]['value']
        if expect_gauge_param and (g, p) != expect_gauge_param: raise SystemExit('file/series mismatch %s %s %s' % (path, g, p))
        nonempty = [b for b in t['values'] if b['value']]
        if len(nonempty) > 1: raise SystemExit('more than one non-empty value block in %s %s %s' % (path, g, p))
        s['empty_value_blocks_ignored'] = s.get('empty_value_blocks_ignored', 0) + len(t['values']) - len(nonempty)
        for x in (nonempty[0]['value'] if nonempty else []):
            s['features_in'] += 1
            q = list(x.get('qualifiers') or [])
            appr = ''.join(sorted(set(a for a in q if a in ('P', 'A')))) 
            other = '|'.join(a for a in q if a not in ('P', 'A'))
            d_ = parse_iso(x['dateTime'])
            if d_.microsecond: raise SystemExit('sub-second old time')
            table.add(src, g, p, fmt_dt(d_), x['value'], '', appr, other)
    return len(series)

def load_page(path):
    return json.loads(gzip.decompress(open(path, 'rb').read()))

def new_rows(pull, table, pulls_seen):
    files = sorted(glob.glob(os.path.join(RAW, 'usgs', pull + '_p*.json.gz')))
    if not files: raise SystemExit('no pages for ' + pull)
    last_next = None
    for fpath in files:
        j = load_page(fpath); src = os.path.relpath(fpath, STUDY)
        s = table.st(src)
        nxt = [l for l in j.get('links', []) if l.get('rel') == 'next']
        last_next = bool(nxt)
        if j.get('numberReturned') != len(j['features']): raise SystemExit('numberReturned mismatch ' + fpath)
        if fpath == files[0]: pulls_seen[pull] = {'pages': 0, 'features': 0}
        pulls_seen[pull]['pages'] += 1; pulls_seen[pull]['features'] += len(j['features'])
        for f in j['features']:
            p = f['properties']; s['features_in'] += 1
            if p.get('statistic_id') != '00011':
                s['dropped_not_00011'][str(p.get('statistic_id'))] += 1; continue
            g = p['monitoring_location_id'].replace('USGS-', '')
            d_ = parse_iso(p['time'])
            q = p.get('qualifier')
            qs = '' if q is None else ('|'.join(q) if isinstance(q, list) else str(q))
            lm = fmt_dt(parse_iso(p['last_modified']), force_frac=True) if p.get('last_modified') else ''
            ap = p.get('approval_status')
            table.add(src, g, str(p['parameter_code']), fmt_dt(d_), p.get('value'), lm, APPR.get(ap, ap or ''), qs)
    pulls_seen[pull]['complete'] = not last_next

def build_readings():
    pulls_seen = {}
    # old archive
    t = ReadingsTable('readings_old_archive', 'old_archive')
    n = 0
    for fpath in sorted(glob.glob(os.path.join(RAW, 'archive_old', '*.json'))):
        b = os.path.basename(fpath)
        if b == 'FETCH_MANIFEST.json': continue
        m = re.match(r'(\d{8})_(\d{5})_', b)
        old_rows(fpath, t, (m.group(1), m.group(2))); n += 1
    REPORT['old_archive_files_read'] = n; t.close()
    t = ReadingsTable('readings_old_octpull', 'old_octpull')
    fp = os.path.join(RAW, 'oct_pull', 'usgs_iv_2026-10-05_2026-10-22.json')
    nser = old_rows(fp, t); REPORT['oct_pull_series'] = nser; t.close()
    # new service
    model_pulls = ['t1_por_00060', 't1_por_00065', 't2_lf_00060', 't2_lf_00065', 't4_mono_goose_00060', 't4_br_sen_00060', 't4_ef_00065', 't4_por_00010']
    t = ReadingsTable('readings_current_model', 'current')
    for p in model_pulls: new_rows(p, t, pulls_seen)
    t.close()
    t = ReadingsTable('readings_current_upstream', 'current')
    if glob.glob(os.path.join(RAW, 'usgs', 't5_upstream_p*.json.gz')): new_rows('t5_upstream', t, pulls_seen)
    t.close()
    t = ReadingsTable('readings_current_census', 'current')
    for p in ['t6_census_por_00060', 't6_census_lf_00060', 't1_por_00060', 't2_lf_00060']:
        if glob.glob(os.path.join(RAW, 'usgs', p + '_p*.json.gz')): new_rows(p, t, pulls_seen)
    t.close()
    REPORT['usgs_pulls_read'] = pulls_seen

# ---------------------------------------------------------------- flatten helpers (tick_log, validation_log)
EPOCH_LEAF = {'qT', 'hT', 'tT', 'firstT', 'lastT'}
EPOCH_PATHS_RUN = {'hist.ts', 'in.dr.t', 'in.dr.at', 'in.dr.tail.t0', 'in.efx.tail.t0'}
ISO_PATHS_RUN = {'at', 'final.ts', 'due'}
EPOCH_PATHS_CHK = {'actualT', 'actualStageT', 'dr.t', 'dr.at', 'dr.tail.t0'}
ISO_PATHS_CHK = {'predTs', 'predAt', 'dueAt', 'valAt', 'tickAt', 'lb.lastValidationTime'}
def is_epoch(path, epath):
    leaf = path.split('.')[-1]
    if path in epath: return True
    if path.startswith('in.') and leaf in EPOCH_LEAF: return True
    if path.startswith('pub.') and leaf in ('lm', 't'): return True
    return False
def is_iso(path, ipath):
    return path in ipath or path.endswith('.lastValidation')

def flatten(data, epath, ipath, tails):
    """returns ordered dict colname -> value; tails collects (path, valuelist, t0, step, ts)"""
    out = collections.OrderedDict()
    def put(path, v):
        col = path.replace('.', '_')
        out[col] = v
        if v is not None and is_epoch(path, epath): out[col + '_utc'] = ms_utc(v)
        elif v is not None and is_iso(path, ipath): out[col + '_utc'] = iso_utc(v)
    def rec(o, path):
        for k, v in o.items():
            p = path + '.' + k if path else k
            if isinstance(v, dict): rec(v, p)
            elif isinstance(v, list):
                if p.endswith('.tail.v') or p.endswith('.tail.ts'): continue   # to the tails table
                if any(isinstance(x, (dict, list)) for x in v): raise SystemExit('unexpected nested list at ' + p)
                put(p, '|'.join(cell(x) for x in v))
            else: put(p, v)
    rec(data, '')
    # tails
    def find(o, path):
        for k, v in o.items():
            p = path + '.' + k if path else k
            if isinstance(v, dict):
                if k == 'tail' and 'v' in v:
                    tails.append((p, v)); out[p.replace('.', '_') + '_n'] = len(v['v'])
                else: find(v, p)
    find(data, '')
    return out

def union_rows(dicts):
    cols = []; seen = set()
    for d in dicts:
        for k in d:
            if k not in seen: seen.add(k); cols.append(k)
    # a JSON object that is null in a row is written by flatten() as one column named after the object (e.g. `ci`, `corr`).
    # When the object has real leaf columns elsewhere and the column is blank in EVERY row, it carries no information: drop it.
    drop = [c for c in cols if all(d.get(c) is None for d in dicts) and any(o.startswith(c + '_') for o in cols)]
    UNION_DROPPED.extend(drop)
    return [c for c in cols if c not in drop]
UNION_DROPPED = []

def build_runs():
    rows = json.load(open(os.path.join(RAW, 'supabase', 'tick_log.json')))
    flat = []; tailrows = []; meta = []
    for i, r in enumerate(rows):
        tails = []
        fd = flatten(r['data'], EPOCH_PATHS_RUN, ISO_PATHS_RUN, tails)
        flat.append(fd); meta.append(r)
        for path, tv in tails:
            col = path.replace('.', '_')
            vals = tv['v']
            for idx, val in enumerate(vals):
                if 'ts' in tv: tms = tv['ts'][idx]
                else: tms = tv['t0'] + idx * tv['step'] * 60000
                tailrows.append((r['id'], fd['at_utc'], col, idx, ms_utc(tms), val))
    # clock hour bookkeeping
    order = sorted(range(len(rows)), key=lambda i: (flat[i]['at_utc'], rows[i]['created_at']))
    hour_of = {}
    for i in range(len(rows)):
        d = parse_iso(flat[i]['at_utc']); hour_of[i] = fmt_dt(d.replace(minute=0, second=0, microsecond=0))
    cnt = collections.Counter(hour_of.values())
    used = {}; first_pred = {}
    for i in order:
        if flat[i]['out'] == 'predicted' and hour_of[i] not in first_pred: first_pred[hour_of[i]] = i
    for i in range(len(rows)): used[i] = 1 if first_pred.get(hour_of[i]) == i else 0
    cols = union_rows(flat)
    # the leading id columns must not collide with data columns
    lead = ['seq', 'row_id', 'created_at_utc', 'gauge_id']
    assert not set(lead) & set(cols)
    trail = ['clock_hour_utc', 'rows_in_hour', 'used']
    w = writer(os.path.join(TIDY, 'runs.csv'), lead + cols + trail)
    for seq, i in enumerate(order, 1):
        r = rows[i]; fd = flat[i]
        w.row([seq, r['id'], iso_utc(r['created_at']), r['gauge_id']] + [fd.get(c) for c in cols] + [hour_of[i], cnt[hour_of[i]], used[i]])
    w.close()
    tw = writer(os.path.join(TIDY, 'runs_tails.csv'), ['row_id', 'at_utc', 'tail', 'idx', 'time_utc', 'value'])
    for t in sorted(tailrows, key=lambda x: (x[1], x[2], x[3])): tw.row(list(t))
    tw.close()
    # lists for the log
    multi = sorted((h, n) for h, n in cnt.items() if n > 1)
    errs = [(flat[i]['at_utc'], flat[i]['out'], flat[i].get('why'), flat[i].get('err')) for i in order if flat[i]['out'] != 'predicted']
    allh = sorted(cnt); h0 = parse_iso(allh[0]); h1 = parse_iso(allh[-1]); empty = []
    h = h0
    while h <= h1:
        k = fmt_dt(h)
        if k not in first_pred: empty.append(k)
        h += dt.timedelta(hours=1)
    gid_mismatch = sum(1 for i in range(len(rows)) if rows[i]['gauge_id'] != rows[i]['data']['at'])
    REPORT['runs'] = {'rows_in': len(rows), 'rows_out': len(rows), 'columns': len(lead + cols + trail),
        'tail_rows': len(tailrows), 'used_rows': sum(used.values()), 'out_counts': dict(collections.Counter(f['out'] for f in flat)),
        'ver_counts': dict(collections.Counter(f['ver'] for f in flat)), 'v_counts': dict(collections.Counter(str(f['v']) for f in flat)),
        'src_counts': dict(collections.Counter(str(f.get('src')) for f in flat)),
        'first_at_utc': flat[order[0]]['at_utc'], 'last_at_utc': flat[order[-1]]['at_utc'],
        'clock_hours_first_to_last': int((h1 - h0).total_seconds() // 3600) + 1,
        'hours_with_more_than_one_row': multi, 'error_rows': errs, 'hours_without_predicted_row': empty,
        'gauge_id_ne_at': gid_mismatch,
        'clock_hours_with_a_used_row': len(first_pred)}
    REPORT['_runs_cols'] = (lead, cols, trail)
    REPORT['runs']['null_object_columns_dropped'] = list(UNION_DROPPED)

def build_checks():
    rows = json.load(open(os.path.join(RAW, 'supabase', 'validation_log.json')))
    flat = []; ctails = []
    for r in rows:
        tails = []
        fd = flatten(r['data'], EPOCH_PATHS_CHK, ISO_PATHS_CHK, tails)
        flat.append(fd)
        for path, tv in tails:
            for idx, val in enumerate(tv['v']):
                tms = tv['ts'][idx] if 'ts' in tv else tv['t0'] + idx * tv['step'] * 60000
                ctails.append((r['id'], fd['valAt_utc'], path.replace('.', '_'), idx, ms_utc(tms), val))
    cols = union_rows(flat)
    lead = ['seq', 'row_id', 'created_at_utc', 'gauge_id']
    assert not set(lead) & set(cols)
    order = sorted(range(len(rows)), key=lambda i: (flat[i]['valAt_utc'], rows[i]['created_at']))
    w = writer(os.path.join(TIDY, 'checks.csv'), lead + cols)
    for seq, i in enumerate(order, 1):
        r = rows[i]
        w.row([seq, r['id'], iso_utc(r['created_at']), r['gauge_id']] + [flat[i].get(c) for c in cols])
    w.close()
    if ctails:
        tw = writer(os.path.join(TIDY, 'checks_tails.csv'), ['row_id', 'valAt_utc', 'tail', 'idx', 'time_utc', 'value'])
        for t in sorted(ctails, key=lambda x: (x[1], x[2], x[3])): tw.row(list(t))
        tw.close()
    REPORT['checks_tails_rows'] = len(ctails)
    REPORT['checks'] = {'rows_in': len(rows), 'rows_out': len(rows), 'columns': len(lead + cols),
        'outcomes': dict(collections.Counter(f['outcome'] for f in flat)), 'v_counts': dict(collections.Counter(str(f['v']) for f in flat)),
        'first_valAt_utc': flat[order[0]]['valAt_utc'], 'last_valAt_utc': flat[order[-1]]['valAt_utc']}
    REPORT['_checks_cols'] = (lead, cols)

def build_bins_and_state():
    rows = json.load(open(os.path.join(RAW, 'supabase', 'state_rows.json')))
    BC = ['source', 'snapshot_time_utc', 'row_created_utc', 'bin_key', 'n', 'ema', 'mean', 'sum', 'sum_sq', 'sd']
    w = writer(os.path.join(TIDY, 'bins.csv'), BC)
    nsnap = 0; nbin = 0; other = {'gf_metadata': [], 'gf_prediction': [], 'validation_failure': [], 'bin_snapshot_leaderboard': []}
    EXPORT_T = '2026-11-22T10:51:00Z'
    for r in rows:
        t = r['observation_type']; d = r['data']
        if t == 'bin_snapshot':
            snap = iso_utc(d['key']); nsnap += 1
            for k, b in d['bins'].items():
                if set(b) - {'n', 'sd', 'ema', 'sum', 'mean', 'sumSq'}: raise SystemExit('unknown bin keys ' + str(b))
                w.row(['bin_snapshot', snap, iso_utc(r['created_at']), k, b.get('n'), b.get('ema'), b.get('mean'), b.get('sum'), b.get('sumSq'), b.get('sd')]); nbin += 1
            other['bin_snapshot_leaderboard'].append({'snapshot_time_utc': snap, 'row_id': r['id'], 'v': d.get('v'), 'ver': d.get('ver'), 'lb': d.get('lb')})
    ncb = 0
    for r in sorted((x for x in rows if x['observation_type'] == 'gf_correction_bin'), key=lambda x: x['gauge_id']):
        d = r['data']
        if set(d) - {'count', 'sumError', 'meanError', 'sumErrorSq', 'emaMeanError', 'stdDev'}: raise SystemExit('unknown cb keys')
        w.row(['gf_correction_bin', EXPORT_T, iso_utc(r['created_at']), r['gauge_id'], d.get('count'), d.get('emaMeanError'), d.get('meanError'), d.get('sumError'), d.get('sumErrorSq'), d.get('stdDev')]); ncb += 1
    w.close()
    for r in rows:
        if r['observation_type'] in ('gf_metadata', 'gf_prediction', 'validation_failure'):
            other[r['observation_type']].append(r)
    json.dump(other, open(os.path.join(TIDY, 'state_other.json'), 'w'), indent=1)
    REPORT['bins'] = {'state_rows_in': len(rows), 'bin_snapshot_rows_in': nsnap, 'bin_snapshot_bin_rows_out': nbin,
        'gf_correction_bin_rows_in': ncb, 'gf_correction_bin_rows_out': ncb, 'bins_csv_rows': nbin + ncb,
        'state_other_json': {k: len(v) for k, v in other.items()}, 'export_time_used_for_gf_correction_bin_utc': EXPORT_T}
    assert nsnap + ncb + sum(len(other[k]) for k in ('gf_metadata', 'gf_prediction', 'validation_failure')) == len(rows)

def build_fm_sites():
    FMP = ['field_measurements_series_id', 'field_visit_id', 'monitoring_location_id', 'parameter_code', 'reading_type', 'value', 'unit_of_measure',
           'time', 'time_of_day', 'year', 'month', 'day', 'qualifier', 'approval_status', 'last_modified', 'control_condition', 'measurement_rated',
           'measuring_agency', 'observing_procedure_code', 'observing_procedure', 'vertical_datum', 'sublocation_identifier']
    feats = []; srcs = collections.OrderedDict()
    for pull in ['t3_fm_por_lf', 't7_fm_upstream']:
        for fpath in sorted(glob.glob(os.path.join(RAW, 'usgs', pull + '_p*.json.gz'))):
            j = load_page(fpath); src = os.path.relpath(fpath, STUDY)
            srcs[src] = len(j['features'])
            for f in j['features']: feats.append((src, f))
    allprops = set(); 
    for _, f in feats: allprops |= set(f['properties'])
    extra = sorted(allprops - set(FMP)); 
    cols = ['gauge', 'feature_id', 'source_file'] + FMP + [c for c in extra if c not in FMP] + ['visit_time_utc']
    w = writer(os.path.join(TIDY, 'field_measurements.csv'), cols)
    seen = set(); dups = 0; cdups = 0; nout = 0; blanks = collections.Counter(); sentinel = 0
    for src, f in sorted(feats, key=lambda x: (x[1]['properties']['monitoring_location_id'], x[1]['properties'].get('time') or '', x[1]['properties'].get('time_of_day') or '', x[1]['properties'].get('parameter_code') or '', x[1]['id'])):
        p = f['properties']
        vt = ''
        try:
            if p.get('time') and p.get('time_of_day'): vt = fmt_dt(parse_iso(p['time'] + 'T' + p['time_of_day']))
        except Exception: vt = ''
        if p.get('value') is not None:
            try:
                if float(p['value']) == SENT: sentinel += 1
            except Exception: pass
        vals = []
        for c in FMP + extra:
            v = p.get(c)
            if isinstance(v, list): v = '|'.join(str(x) for x in v)
            vals.append(v)
        key = tuple(vals) + (vt,)
        if key in seen: cdups += 1        # same content, different feature_id: kept (the rows are not identical), counted
        seen.add(key); nout += 1
        w.row([p['monitoring_location_id'].replace('USGS-', ''), f['id'], src] + vals + [vt])
    w.close()
    REPORT['field_measurements'] = {'features_in': len(feats), 'rows_out': nout, 'exact_duplicates_dropped': dups, 'rows_with_same_content_different_feature_id_kept': cdups, 'sentinel_values_kept_as_given': sentinel,
        'by_source_file': dict(srcs), 'extra_properties_beyond_fixed_list': extra, 'by_gauge': dict(collections.Counter(f['properties']['monitoring_location_id'] for _, f in feats))}
    REPORT['_fm_cols'] = cols
    # sites
    sp = os.path.join(RAW, 'usgs', 't3b_sites_all_p001.json.gz')
    j = load_page(sp); feats = j['features']
    props = []; seenp = set()
    for f in feats:
        for k in f['properties']:
            if k not in seenp: seenp.add(k); props.append(k)
    cols = ['gauge', 'source_file'] + props
    w = writer(os.path.join(TIDY, 'sites.csv'), cols)
    for f in sorted(feats, key=lambda f: f['properties']['monitoring_location_number']):
        p = f['properties']
        w.row([p['monitoring_location_number'], os.path.relpath(sp, STUDY)] + [p.get(k) for k in props])
    w.close()
    REPORT['sites'] = {'features_in': len(feats), 'rows_out': len(feats), 'columns': len(cols)}
    REPORT['_site_cols'] = cols

# ---------------------------------------------------------------- hand check of time zones (old service)
def hand_check():
    out = []
    f = os.path.join(RAW, 'archive_old', '01638500_00060_20261010_20261109.json')
    v = json.load(open(f))['value']['timeSeries'][0]['values'][0]['value']
    def pick(prefix):
        for x in v:
            if x['dateTime'].startswith(prefix): return x
    for pre in ['2026-10-31T20:00:00', '2026-11-01T01:00:00.000-04:00', '2026-11-01T01:00:00.000-05:00', '2026-11-01T20:00:00']:
        x = pick(pre)
        out.append({'file': os.path.relpath(f, STUDY), 'raw_dateTime': x['dateTime'], 'raw_value': x['value'], 'utc': fmt_dt(parse_iso(x['dateTime']))})
    REPORT['hand_check_tz'] = out

def manifest():
    entries = []
    pl = {}
    lp = os.path.join(RAW, 'usgs', 'PULL_LOG.json')
    if os.path.exists(lp):
        for e in json.load(open(lp)):
            if e.get('file'): pl[e['file']] = e
    for dp, dn, fn in os.walk(RAW):
        for n in sorted(fn):
            p = os.path.join(dp, n)
            rel = os.path.relpath(p, STUDY)
            if n == 'PULL_LOG.json' or n.endswith('.tmp'): pass
            ent = {'path': rel, 'bytes': os.path.getsize(p), 'sha256': sha(p)}
            if rel.startswith('data/raw/usgs/') and n in pl:
                e = pl[n]; ent['origin'] = e['url']; ent['obtained_utc'] = e['request_time_utc']; ent['uncompressed_bytes'] = e['bytes']; ent['uncompressed_sha256'] = e['sha256']; ent['http_status'] = e['status']
            elif rel.startswith('data/raw/supabase/') and n.endswith('.json'):
                ent['origin'] = 'Supabase SQL, see data/raw/supabase/QUERIES.md'; ent['obtained_utc'] = '2026-11-22T10:51:00Z (approx.)'
            elif rel.startswith('data/raw/supabase/'):
                ent['origin'] = 'written by tools/01_freeze_local.py'; ent['obtained_utc'] = ''
            elif rel.startswith('data/raw/archive_old/'):
                ent['origin'] = '/Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/raw/' + n + ' (old USGS service, per FETCH_MANIFEST.json)'; ent['obtained_utc'] = '2026-11-10 (pull date per FETCH_MANIFEST.json)'
            elif rel.startswith('data/raw/archive_old_2026-11-10'):
                ent['origin'] = 'built by tools/01_freeze_local.py from the 54 verified archive files + FETCH_MANIFEST.json'; ent['obtained_utc'] = ''
            elif rel.startswith('data/raw/oct_pull/'):
                ent['origin'] = '/Users/sebjilke/Desktop/PotomacPulse/analysis/pulse-audit-2026-10/audit_inputs.tar.gz member data/usgs_iv_2026-10-05_2026-10-22.json' if n.endswith('.json') else 'written by tools/01_freeze_local.py'
                ent['obtained_utc'] = '2026-11-09 (approx., per tar member date)' if n.endswith('.json') else ''
            elif n in ('PULL_PLAN.json', 'PULL_LOG.json'):
                ent['origin'] = 'written by tools/02_pull_usgs.py'; ent['obtained_utc'] = ''
            entries.append(ent)
    entries.sort(key=lambda e: e['path'])
    json.dump({'built_by': 'tools/03_build_tidy.py', 'files': entries}, open(os.path.join(STUDY, 'data', 'MANIFEST.json'), 'w'), indent=1)
    REPORT['manifest_files'] = len(entries)
    import coop_common
    if os.path.exists(os.path.join(TIDY, 'withdrawals_coop.csv')): REPORT['manifest_files'] += coop_common.add_manifest()   # saved commission pages, see tools/06

def main():
    build_readings(); build_runs(); build_checks(); build_bins_and_state(); build_fm_sites(); hand_check()
    manifest()
    import dictionary
    dictionary.write(REPORT, STUDY)
    rep = {k: v for k, v in REPORT.items() if not k.startswith('_')}
    json.dump(rep, open(os.path.join(TIDY, 'BUILD_REPORT.json'), 'w'), indent=1)
    print(json.dumps({k: (v if not isinstance(v, dict) or 'rows' not in v else {'rows': v['rows']}) for k, v in rep.items() if k.startswith('readings') or k in ('runs', 'checks', 'bins', 'sites', 'field_measurements')}, indent=1, default=str)[:6000])
main()
