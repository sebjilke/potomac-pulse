"""Step 2 agreement check (plan precondition P2): the Python and the blind R event lists must match
exactly on t0, tp, tend, class, every exclusion flag, kept, oct, holdout, scored rising-limb ticks and peak.
Gauge records only. No model, no arm, no error metric. Run: python3 compare_event_lists.py"""
import csv, hashlib, sys

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

def nt(s):
    return (s or '').strip().replace('T', ' ')[:16]

def ni(s):
    s = str(s).strip()
    if s in ('True', 'TRUE', 'true'):
        return '1'
    if s in ('False', 'FALSE', 'false', ''):
        return '0'
    try:
        return str(int(float(s)))
    except ValueError:
        return s

PY, RR = 'rising_limb_events_python_v39.csv', 'rising_limb_events_R_v39.csv'
P = [r for r in csv.DictReader(open(PY)) if r['event_row'] == '1']
R = list(csv.DictReader(open(RR)))
pk = {nt(r['event_t0']): r for r in P}
rk = {nt(r['t0']): r for r in R}
print('python sha256', sha(PY))
print('R      sha256', sha(RR))
print('events: python', len(pk), 'R', len(rk))
only_p, only_r = sorted(set(pk) - set(rk)), sorted(set(rk) - set(pk))
print('t0 only in python:', only_p, '| only in R:', only_r)
M = [('tp', 'event_tp', nt), ('tend', 'event_tend', nt), ('class', 'event_class', str),
     ('x0', 'x0_burnin', ni), ('x1', 'x1_ice_risk', ni), ('x2', 'x2_outage', ni),
     ('x3', 'x3_few_ticks', ni), ('x4', 'x4_tend_beyond_data', ni), ('kept', 'kept', ni),
     ('oct', 'oct', ni), ('holdout', 'holdout', ni),
     ('n_rl_ticks_scored', 'x3_scored_rl_ticks', ni), ('event_id', 'event_id', ni)]
nd = 0
for t0 in sorted(set(pk) & set(rk)):
    for rf, pf, f in M:
        if f(pk[t0][pf]) != f(rk[t0][rf]):
            nd += 1
            print('DIFF', t0, rf, 'python=', pk[t0][pf], 'R=', rk[t0][rf])
    if abs(float(pk[t0]['event_peak_lf']) - float(rk[t0]['peak_cfs'])) > 1e-6:
        nd += 1
        print('PEAK DIFF', t0, pk[t0]['event_peak_lf'], rk[t0]['peak_cfs'])
kp = [r for r in P if ni(r['kept']) == '1' and r['event_class'] == 'GATE']
ks = [r for r in P if ni(r['kept']) == '1' and r['event_class'] == 'STRATUM']
print('kept GATE', len(kp), '| kept GATE non-October', sum(ni(r['oct']) == '0' for r in kp),
      '| kept STRATUM', len(ks), '| holdout ids', sorted(int(r['event_id']) for r in P if ni(r['holdout']) == '1'))
print('TOTAL differences:', nd + len(only_p) + len(only_r))
sys.exit(1 if nd or only_p or only_r else 0)
