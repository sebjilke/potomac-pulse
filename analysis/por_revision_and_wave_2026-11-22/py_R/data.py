"""Loads every input of Part R once (standard library only)."""
import os, collections, bisect
from lib import *

POR, LF = '01638500', '01646500'
MONO, GOOSE, BR, SEN, EF = '01643000', '01644000', '01644280', '01645000', '01644148'
SHEP, MILL, ANT, CAT = '01618000', '01636500', '01619500', '01637500'
UPSTREAM = ['01610000', '01613000', '01614500', '01616500', '01618000', '01619500', '01636500', '01637500']

W0_R4 = ts('2026-08-31T00:00:00Z')


class Ctx:
    pass


def load():
    c = Ctx()
    c.old = load_readings('readings_old_archive.csv')
    c.octp = load_readings('readings_old_octpull.csv')
    c.cen = load_readings('readings_current_census.csv')
    c.mod = load_readings('readings_current_model.csv')
    c.ups = load_readings('readings_current_upstream.csv')

    # current series by (gauge, parameter), following the rule of the common part
    cur = {}
    for k, v in c.mod.items():
        cur[k] = v
    for k, v in c.ups.items():
        cur[k] = v
    cur[(POR, '00060')] = c.cen[(POR, '00060')]
    cur[(LF, '00060')] = c.cen[(LF, '00060')]
    c.cur = cur
    c.cur_times = {k: sorted(v) for k, v in cur.items()}
    c.old_times = {k: sorted(v) for k, v in c.old.items()}

    # runs (used) / labels / truth / replay
    allruns = read_csv(os.path.join(TIDY, 'runs.csv'))
    c.allruns = allruns
    c.runs = [r for r in allruns if r['used'] == '1']
    c.run_by_seq = {int(r['seq']): r for r in c.runs}
    labels = read_csv(os.path.join(OUTD, 'labels.csv'))
    c.labels = {int(r['seq']): r for r in labels}
    c.truth = {}
    for r in read_csv(os.path.join(OUTD, 'truth.csv')):
        c.truth[(int(r['seq']), r['scenario'])] = r
    c.replay = {}
    for r in read_csv(os.path.join(OUTD, 'replay_runs.csv')):
        c.replay[(int(r['seq']), r['scenario'])] = r
    c.phase = {}
    for seq, l in c.labels.items():
        la = l['label_all_three']
        c.phase[seq] = 'OLD' if la == 'old' else ('NEW' if la == 'new' else 'TRANS')
    c.gate_miss = {seq: l['gate_miss'] for seq, l in c.labels.items()}
    c.seqs = sorted(int(r['seq']) for r in c.runs)

    # withdrawals
    wrows = read_csv(os.path.join(TIDY, 'withdrawals_coop.csv'))
    c.wd = {}
    for r in wrows:
        d = r['withdrawal_date']
        assert d not in c.wd, 'duplicate withdrawal_date ' + d
        c.wd[d] = r
    c.field = read_csv(os.path.join(TIDY, 'field_measurements.csv'))
    return c


def w_cfs(c, d):
    r = c.wd.get(d)
    if r is None or r['total_net_potomac_withdrawal_mgd'] == '':
        return None
    return float(r['total_net_potomac_withdrawal_mgd']) * 1.547229


def w_flagged(c, d):
    r = c.wd.get(d)
    return bool(r and r['total_net_potomac_withdrawal_flag'] != '')


def cur_at(c, gauge, param, t):
    d = c.cur.get((gauge, param))
    if d is None:
        return None
    x = d.get(t)
    return x[0] if x else None


def t1_s0_interp(c, t):
    """T1 by the rule truth.csv uses: linear interpolation between neighbouring non-blank LF readings (census)."""
    return interp_at(c.cur_times[(LF, '00060')], c.cur[(LF, '00060')], t)


def t1_values(c):
    """own T1 per (seq, scenario) as float or None; with the seq 212 exception for S0 logged."""
    out = {}
    for (seq, scn), r in c.truth.items():
        v = r['t1_lf_cfs_interpolated']
        out[(seq, scn)] = float(v) if v != '' else None
    return out
