#!/usr/bin/env python3
"""Fix round 2026-11-23: show that every row of the existing scenarios/rules is unchanged.
  python3 -I compare_before_after.py hash  <dir> <baseline.json>   write file and row-group hashes of a delivered out/ (and f_old/) folder
  python3 -I compare_before_after.py check <dir> <baseline.json>   compare the current folder with the baseline: same rows (on the baseline's columns) in every group
"""
import csv, hashlib, json, os, sys
GROUPS = {'replay_runs.csv': 'scenario', 'truth.csv': 'scenario', 'iteration_limit_share.csv': 'scenario',
          'replay_2x2x2.csv': 'old_rule', 'cell_identity_test.csv': 'old_rule'}
def h(rows): return hashlib.sha256('\n'.join(','.join(r) for r in rows).encode()).hexdigest()
def load(path):
    with open(path, newline='') as f: r = list(csv.reader(f))
    return r[0], r[1:]
def digest(d):
    out = {'files': {}, 'groups': {}, 'columns': {}}
    for sub in ('out', 'f_old'):
        p = os.path.join(d, sub)
        for fn in sorted(os.listdir(p)):
            fp = os.path.join(p, fn)
            if not os.path.isfile(fp) or fn.startswith('.'): continue
            out['files'][sub + '/' + fn] = hashlib.sha256(open(fp, 'rb').read()).hexdigest()
            if fn.endswith('.csv'):
                head, rows = load(fp)
                out['columns'][sub + '/' + fn] = head
                key = GROUPS.get(fn)
                if key:
                    i = head.index(key); gs = {}
                    for r in rows: gs.setdefault(r[i], []).append(r)
                    for g, rs in gs.items(): out['groups'][sub + '/' + fn + '|' + key + '=' + g] = [len(rs), h(rs)]
                else:
                    out['groups'][sub + '/' + fn + '|all'] = [len(rows), h(rows)]
    return out
mode, d, base = sys.argv[1:4]
if mode == 'hash':
    json.dump(digest(d), open(base, 'w'), indent=1, sort_keys=True); print('written', base); sys.exit(0)
B = json.load(open(base)); bad = 0; same_bytes = 0; extended = 0; lines = []
for sub_fn, cols in B['columns'].items():
    sub, fn = sub_fn.split('/')
    head, rows = load(os.path.join(d, sub, fn))
    idx = [head.index(c) for c in cols]          # baseline columns, in baseline order (fails if one is missing)
    key = GROUPS.get(fn)
    gs = {}
    for r in rows:
        r2 = [r[i] for i in idx]
        g = (key + '=' + r[head.index(key)]) if key else 'all'
        gs.setdefault(g, []).append(r2)
    for g, rs in gs.items():
        k = sub_fn + '|' + (g if key else 'all')
        if k in B['groups']:
            ok = [len(rs), h(rs)] == B['groups'][k]
            lines.append(('IDENTICAL' if ok else 'DIFFERENT') + ' ' + k + ' rows=' + str(len(rs)))
            bad += 0 if ok else 1
        else:
            lines.append('NEW GROUP ' + k + ' rows=' + str(len(rs)))
    for k in B['groups']:
        if k.startswith(sub_fn + '|') and k.split('|')[1] != 'all' and k.split('|', 1)[1] not in gs and False: pass
    missing = [k for k in B['groups'] if k.startswith(sub_fn + '|') and (k.split('|', 1)[1] if key else 'all') not in gs]
    for m in missing: lines.append('MISSING ' + m); bad += 1
for fn, hh in B['files'].items():
    cur = hashlib.sha256(open(os.path.join(d, fn), 'rb').read()).hexdigest() if os.path.exists(os.path.join(d, fn)) else None
    if cur == hh: same_bytes += 1
print('\n'.join(lines)); print('files byte-identical to baseline:', same_bytes, 'of', len(B['files']), '| groups different or missing:', bad)
sys.exit(1 if bad else 0)
