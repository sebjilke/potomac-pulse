#!/usr/bin/env python3
# Cap study, Python analyst. Implements ANALYSIS_SPEC.md version 1.2.
# Run from the study folder:  python3 -I py/run_all.py
import sys, os, hashlib, csv, re, math, time

START = time.time()
PYDIR = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.dirname(PYDIR)
ONSET = os.path.normpath(os.path.join(STUDY, '..', 'onset_correction_2026-11-25'))
RTB = os.path.normpath(os.path.join(STUDY, '..', 'rising-limb-travel-backtest'))
P_L = os.path.join(ONSET, 'replay_L', 'shadow_L.csv')
P_F = os.path.join(ONSET, 'replay_F', 'shadow_F.csv')
P_BOOT = os.path.join(ONSET, 'tools', 'boot_uniforms.csv')
P_HOUR = os.path.join(RTB, 'hourly_backtest_data_v39.csv')
P_EVT = os.path.join(RTB, 'rising_limb_events_python_v39.csv')

SHA = {
    P_L: ('dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba', 109952178),
    P_F: ('7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3', 110149295),
    P_BOOT: ('71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515', 13000392),
    P_HOUR: ('d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f', 10133893),
    P_EVT: ('978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44', 24205),
}

OUTFILES = ['checks.csv', 'row_accounting.csv', 'populations.csv', 'rule_tables.csv',
            'cap_description.csv', 'cap_classes.csv', 'intervals.csv', 'pick_design.csv',
            'decision_inputs.csv', 'decision.csv', 'rises_test.csv', 'timing_gate.csv',
            'timing_candidates.csv', 'timing_pick.csv']

NUMCOLS = ['truthFlow', 'predictedCFS', 'rawUnc', 'corrUsed', 'd6', 'span_h', 'lfCap', 'lfQ',
           'age_lf_h', 'travelGFtoLF', 'porQ', 'tempC', 'errPctCorr']
TEXTCOLS = ['predTs', 'status', 'flowBin', 'flowState', 'truthInProdRange', 'truthDependentHard',
            'lfSrcTs', 'tauTs', 'errPctRaw']
COLS22 = ['predTs', 'status', 'flowBin', 'flowState', 'truthFlow', 'truthInProdRange',
          'truthDependentHard', 'errPctRaw', 'errPctCorr', 'predictedCFS', 'rawUnc', 'corrUsed',
          'd6', 'span_h', 'lfCap', 'lfQ', 'lfSrcTs', 'age_lf_h', 'travelGFtoLF', 'porQ', 'tempC',
          'tauTs']

CANDS = ['F135', 'F150', 'F200', 'LF3', 'LF6', 'MR', 'UP', 'RIS', 'ICE', 'N']
DESC = ['T110', 'F125', 'F130', 'F140', 'F175', 'ICE-T']
RULES17 = ['P'] + CANDS + DESC
RULES18 = RULES17 + ['P_icet_hours']
LIST15 = CANDS + ['F125', 'F130', 'F140', 'F175', 'ICE-T']
TIE_ORDER = ['F135', 'F150', 'LF6', 'LF3', 'MR', 'UP', 'RIS', 'F200', 'ICE', 'N']
ICET_START = '2021-05-07T00:00:00.000Z'
BINS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+']
POPS = ['all', 'rising', 'lf_rising', 'capped', 'capped_rising', 'capped_notrising', 'rl_large',
        'rl_large_upstream', 'rl_large_lfled', 'rl_large_notclassed'] + \
       ['bin_' + b for b in BINS] + ['high_water', 'low_water']
PERIODS = ['design', 'test', 'test_half1', 'test_half2']
HOUR = 3600000
CENTER = 1350000
NUM_RE = re.compile(r'^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$')
TS_RE = re.compile(r'^(\d{4})-(\d\d)-(\d\d)T(\d\d):00:00\.000Z$')
TS_FULL_RE = re.compile(r'^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.000Z$')
HR_RE = re.compile(r'^\d{4}-\d\d-\d\d \d\d:00$')

NONE = None
UNDEF = object()


# ---------------------------------------------------------------- time
def days_from_civil(y, m, d):
    y = y - (1 if m <= 2 else 0)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def K(ts):
    return days_from_civil(int(ts[0:4]), int(ts[5:7]), int(ts[8:10])) * 24 + int(ts[11:13])


def S(ts):
    days = days_from_civil(int(ts[0:4]), int(ts[5:7]), int(ts[8:10]))
    return days * 86400 + int(ts[11:13]) * 3600 + int(ts[14:16]) * 60 + int(ts[17:19])


def EMS(ts):
    days = days_from_civil(int(ts[0:4]), int(ts[5:7]), int(ts[8:10]))
    ss = int(ts[17:19]) if len(ts) >= 19 else 0
    mmm = int(ts[20:23]) if len(ts) >= 23 else 0
    return (days * 86400 + int(ts[11:13]) * 3600 + int(ts[14:16]) * 60 + ss) * 1000 + mmm


def ev_to_ts(s):
    return s.replace(' ', 'T') + ':00.000Z'


def period_of(ts):
    if '2012-12-01T00:00:00.000Z' <= ts < '2020-01-01T00:00:00.000Z':
        return 'design'
    if ts >= '2020-01-01T00:00:00.000Z':
        return 'test'
    return None


def design_month_idx(ts):
    return (int(ts[0:4]) * 12 + int(ts[5:7])) - (2012 * 12 + 12)


def test_month_idx(ts):
    return (int(ts[0:4]) * 12 + int(ts[5:7])) - (2020 * 12 + 1)


def f6(x):
    if x is None:
        return ''
    if x != x or x in (float('inf'), float('-inf')):
        raise ValueError('non-finite number')
    s = "%.6f" % x
    if s == '-0.000000':
        s = '0.000000'
    return s


def mic(s):
    if s == '-0.000000':
        s = '0.000000'
    return int(s.replace('.', ''))


def fl(x):
    return float(math.floor(x + 0.5))


# ---------------------------------------------------------------- truth
def truth(tau, mp):
    lo0 = ((tau - CENTER) // HOUR) * HOUR
    cLo = lo0 + CENTER
    cHi = lo0 + HOUR + CENTER
    lo = mp.get(lo0)
    hi = mp.get(lo0 + HOUR)
    if lo is not None and hi is not None:
        return lo + (hi - lo) * ((tau - cLo) / HOUR)
    if lo is not None and (tau - cLo) <= HOUR:
        return lo
    if hi is not None and (cHi - tau) <= HOUR:
        return hi
    return None


def in_range(v):
    return v >= 500.0 and v <= 500000.0


# ---------------------------------------------------------------- tables, rules
class Tab(object):
    def __init__(self, cols, keys=None):
        self.c = cols
        self.n = len(cols['predTs'])
        self.key = keys if keys is not None else [K(t) for t in cols['predTs']]
        self.idx = {}
        for i, k in enumerate(self.key):
            self.idx[k] = i


def rule_lim(rule, T, i):
    """returns (lim, fb): lim float, None (NONE) or UNDEF; fb = a fall-back step ended the rule"""
    c = T.c
    L = c['lfCap'][i]
    PROD = 1.2 * L
    if rule == 'P':
        return PROD, False
    if rule == 'F135':
        return 1.35 * L, False
    if rule == 'F150':
        return 1.5 * L, False
    if rule == 'F200':
        return 2.0 * L, False
    if rule == 'T110':
        return 1.1 * L, False
    if rule == 'F125':
        return 1.25 * L, False
    if rule == 'F130':
        return 1.3 * L, False
    if rule == 'F140':
        return 1.4 * L, False
    if rule == 'F175':
        return 1.75 * L, False
    if rule == 'RIS':
        return (None if c['flowState'][i] == 'rising' else PROD), False
    if rule == 'N':
        return None, False
    if rule == 'ICE':
        M = int(c['predTs'][i][5:7])
        return (PROD if M in (11, 12, 1, 2, 3) else None), False
    if rule == 'ICE-T':
        ts = c['predTs'][i]
        if ts < ICET_START:
            return UNDEF, False
        tmp = c['tempC'][i]
        if tmp is not None:
            return (PROD if tmp <= 5.0 else None), False
        M = int(ts[5:7])
        return (PROD if M in (11, 12, 1, 2, 3) else None), False
    Tt = c['travelGFtoLF'][i]
    a = c['age_lf_h'][i]
    if rule in ('LF3', 'LF6'):
        k = 3 if rule == 'LF3' else 6
        if Tt is None or a is None:
            return PROD, True
        j = T.idx.get(T.key[i] - k)
        if j is None:
            return PROD, True
        Lk = c['lfCap'][j]
        if Lk is None:
            return PROD, True
        s_k = c['lfSrcTs'][j]
        s_t = c['lfSrcTs'][i]
        if s_k == '' or s_t == '':
            return PROD, True
        e = (S(s_t) - S(s_k)) / 3600.0
        if e <= 0:
            return PROD, True
        g = L + (((L - Lk) * (Tt + a)) / e)
        m = max(L, g)
        return min(2.0 * L, 1.2 * m), False
    if rule == 'MR':
        if Tt is None or a is None:
            return PROD, True
        h = int(math.floor((Tt + a) + 0.5))
        if h <= 0:
            return PROD, True
        j = T.idx.get(T.key[i] - h)
        if j is None:
            return PROD, True
        ru = c['rawUnc'][j]
        cu = c['corrUsed'][j]
        if ru is None or cu is None:
            return PROD, True
        uh = ru - cu
        if uh <= 0:
            return PROD, True
        u = c['rawUnc'][i] - c['corrUsed'][i]
        ratio = u / uh
        return min(2.0, 1.2 * max(1.0, ratio)) * L, False
    if rule == 'UP':
        if Tt is None or a is None:
            return PROD, True
        d6 = c['d6'][i]
        if d6 is None or d6 <= 0:
            return PROD, True
        sp = c['span_h'][i]
        if sp is None or sp <= 0:
            return PROD, True
        pq = c['porQ'][i]
        if pq is None:
            return PROD, True
        if pq - d6 <= 0:
            return PROD, True
        p = ((d6 / (pq - d6)) * (Tt + a)) / sp
        return min(2.0, 1.2 * (1.0 + p)) * L, False
    raise ValueError('unknown rule ' + rule)


def eval_rule(rule, T, i):
    """returns (lim, shown, fb, v) ; v = min(u,lim) or u"""
    lim, fb = rule_lim(rule, T, i)
    if lim is UNDEF:
        return UNDEF, None, False, None
    u = T.c['rawUnc'][i] - T.c['corrUsed'][i]
    if lim is None:
        v = u
    else:
        v = min(u, lim)
    return lim, fl(v), fb, v


# ---------------------------------------------------------------- measures
def measures(H, eX, eP, shX, shP):
    n = len(H)
    if n == 0:
        return None
    sa = sb = sd = sap = sbp = 0.0
    coff = clow = chigh = poff = plow = phigh = nd = 0
    for j in H:
        e = eX[j]
        ep = eP[j]
        ae = abs(e)
        aep = abs(ep)
        sa = sa + ae
        sb = sb + e
        sd = sd + (ae - aep)
        sap = sap + aep
        sbp = sbp + ep
        if ae >= 15:
            coff += 1
        if e <= -15:
            clow += 1
        if e >= 15:
            chigh += 1
        if aep >= 15:
            poff += 1
        if ep <= -15:
            plow += 1
        if ep >= 15:
            phigh += 1
        if shX[j] != shP[j]:
            nd += 1
    mae = sa / n
    maeP = sap / n
    return dict(n=n, mae=mae, bias=sb / n, off=(100.0 * coff) / n, low=(100.0 * clow) / n,
                high=(100.0 * chigh) / n, mean_d=sd / n,
                off_diff=(100.0 * (coff - poff)) / n, low_diff=(100.0 * (clow - plow)) / n,
                high_diff=(100.0 * (chigh - phigh)) / n,
                mae_rel=(None if maeP == 0 else (mae - maeP) / maeP), n_differ=nd,
                c_off=coff, c_low=clow, c_high=chigh, cP_off=poff, cP_low=plow, cP_high=phigh,
                mae_P=maeP, bias_P=sbp / n, off_P=(100.0 * poff) / n, low_P=(100.0 * plow) / n,
                high_P=(100.0 * phigh) / n)


EMPTY_STATS = dict(n=0, mae=None, bias=None, off=None, low=None, high=None, mean_d=None,
                   off_diff=None, low_diff=None, high_diff=None, mae_rel=None, n_differ=0,
                   c_off=0, c_low=0, c_high=0, cP_off=0, cP_low=0, cP_high=0)


def err_of(shown, truth_v):
    return ((shown - truth_v) / truth_v) * 100.0


# ---------------------------------------------------------------- pick, decision
def do_pick(cands, n_r, cP):
    """cands: name -> (mean_d_all, c_off). returns dict"""
    qual = [x for x in CANDS if cands[x][0] <= 0]
    res = dict(qual=qual, leader=None, tied=[], first=None, pick=None)
    if not qual:
        return res
    leader = qual[0]
    for x in qual:
        if cands[x][1] < cands[leader][1]:
            leader = x
    res['leader'] = leader
    cl = cands[leader][1]
    tied = [x for x in qual if 1000 * (cands[x][1] - cl) <= n_r]
    res['tied'] = tied
    first = None
    for x in TIE_ORDER:
        if x in tied:
            first = x
            break
    res['first'] = first
    if first is not None and cands[first][1] < cP:
        res['pick'] = first
    return res


def decide(v, has_pick):
    """v: name -> written string. returns (list of 9 results, verdict)"""
    if not has_pick:
        return ['not_applicable'] * 9, 'KEEP'

    def m(name):
        s = v.get(name, '')
        return None if s == '' else mic(s)
    c1 = m('c1_off_diff_rising')
    hi = m('c1_ci_hi')
    c2 = m('c2_mean_d_all')
    c3 = m('c3_high_diff_all')
    c4 = m('c4_high_diff_rising')
    c5a = m('c5_off_diff_rl')
    c5b = m('c5_rel_mae_rl')
    c6a = m('c6_off_diff_half1')
    c6b = m('c6_off_diff_half2')
    c7 = m('c7_off_diff_rising_F')
    c8 = m('c8_rel_mae_high')
    c9 = m('c9_rel_mae_low')
    r = []
    r.append(c1 is not None and hi is not None and c1 <= -1000000 and hi < 0)
    r.append(c2 is not None and c2 <= 50000)
    r.append(c3 is not None and c3 <= 500000)
    r.append(c4 is not None and c4 <= 1500000)
    r.append(c5a is not None and c5b is not None and c5a <= 0 and c5b <= 50000)
    r.append(c6a is not None and c6b is not None and c6a < 0 and c6b < 0)
    r.append(c7 is not None and c7 < 0)
    r.append(c8 is not None and c8 <= 50000)
    r.append(c9 is not None and c9 <= 50000)
    res = ['pass' if x else 'fail' for x in r]
    if all(r):
        return res, 'BETTER_RULE_FOUND'
    if hi is None or hi >= 0:
        return res, 'KEEP'
    return res, 'UNCLEAR'


def label_of(lo, hi):
    if lo == '' or hi == '':
        return 'unclear'
    if mic(lo) > 0:
        return 'good_job'
    if mic(hi) < 0:
        return 'harm'
    return 'unclear'


def percentile_pair(vals_sorted):
    m = len(vals_sorted)
    out = []
    for p in (0.025, 0.975):
        pos = (m - 1) * p
        i = int(math.floor(pos))
        frac = pos - i
        if i + 1 > m - 1:
            out.append(vals_sorted[i])
        else:
            out.append(vals_sorted[i] + frac * (vals_sorted[i + 1] - vals_sorted[i]))
    return out[0], out[1]


# ---------------------------------------------------------------- unit tests
def build_U(edits=(), delete=()):
    caps = [1000, 1000, 1000, 1000, 1050, 1100, 1200, 1250, 1300, 1350, 1400, 1450, 1500]
    rows = []
    for k in range(13):
        r = dict(predTs='2020-12-01T%02d:00:00.000Z' % k, status='predicted', flowState='steady',
                 travelGFtoLF=4.5, age_lf_h=1.0, tempC=None, d6=None, span_h=None, porQ=None,
                 rawUnc=2100.0, corrUsed=100.0, lfCap=float(caps[k]))
        if k == 0:
            r['lfSrcTs'] = '2020-11-30T23:00:00.000Z'
        else:
            r['lfSrcTs'] = '2020-12-01T%02d:00:00.000Z' % (k - 1)
        if k == 6:
            r['lfSrcTs'] = '2020-12-01T04:30:00.000Z'
        if k == 12:
            r['flowState'] = 'rising'
            r['rawUnc'] = 2600.0
            r['corrUsed'] = 100.0
            r['d6'] = 400.0
            r['porQ'] = 2000.0
            r['span_h'] = 4.0
        rows.append(r)
    for (k, col, val) in edits:
        rows[k][col] = val
    keep = [k for k in range(13) if k not in delete]
    names = ['predTs', 'status', 'flowState', 'travelGFtoLF', 'age_lf_h', 'tempC', 'd6', 'span_h',
             'porQ', 'rawUnc', 'corrUsed', 'lfCap', 'lfSrcTs']
    cols = dict((nm, [rows[k][nm] for k in keep]) for nm in names)
    T = Tab(cols)
    base = keep.index(12) if 12 in keep else None
    return T, base


def unit_round():
    cases = [(0.5, 1), (2.4, 2), (2.5, 3), (-0.5, 0), (-1.5, -1), (8.49, 8), (8.5, 9)]
    return int(not all(fl(x) == y for x, y in cases))


def unit_key():
    cases = [('2020-01-01T00:00:00.000Z', 438288), ('2012-12-01T00:00:00.000Z', 376200),
             ('2019-12-31T23:00:00.000Z', 438287), ('2026-11-09T23:00:00.000Z', 498407),
             ('1970-01-01T00:00:00.000Z', 0)]
    return int(not all(K(t) == v for t, v in cases))


def unit_time():
    ok = S('2020-12-01T11:00:36.000Z') - S('2020-12-01T08:00:00.000Z') == 10836
    ok = ok and EMS('2012-01-01 00:00') == 1325376000000
    ok = ok and EMS('1970-01-01 00:30') == 1800000
    ok = ok and EMS('2013-06-01T05:49:00.000Z') == 1370065740000
    ok = ok and EMS('2013-06-01T05:49:00.000Z') == EMS('2013-06-01 05:49')
    ok = ok and ev_to_ts('2015-06-20 12:00') == '2015-06-20T12:00:00.000Z'
    ok = ok and K(ev_to_ts('2015-06-20 12:00')) == 398556
    return int(not ok)


def unit_rules():
    ok = [True]

    def chk(cond):
        if not cond:
            ok[0] = False

    def near(a, b):
        return a is not None and b is not None and abs(a - b) <= 1e-9

    def case(edits, rule, lim, tol, shown, delete=()):
        T, b = build_U(edits, delete)
        l, sh, fb, v = eval_rule(rule, T, b)
        if lim == 'NONE':
            chk(l is None)
        elif tol:
            chk(l is not None and l is not UNDEF and near(l, lim))
        else:
            chk(l == lim)
        chk(sh == shown)
    base = [('P', 1800, 0, 1800), ('F135', 2025, 1, 2025), ('F150', 2250, 0, 2250),
            ('F200', 3000, 0, 2500), ('T110', 1650, 1, 1650), ('F125', 1875, 0, 1875),
            ('F130', 1950, 0, 1950), ('F140', 2100, 0, 2100), ('F175', 2625, 0, 2500),
            ('LF3', 2130, 0, 2130), ('LF6', 2104.6153846153843, 1, 2105), ('MR', 2250, 0, 2250),
            ('UP', 2418.75, 0, 2419), ('RIS', 'NONE', 0, 2500), ('ICE', 1800, 0, 1800),
            ('N', 'NONE', 0, 2500)]
    for (r, lim, tol, sh) in base:
        case((), r, lim, tol, sh)
    case([(9, 'lfCap', 1600.0)], 'LF3', 1800, 0, 1800)
    case([(12, 'lfSrcTs', '2020-12-01T11:00:36.000Z')], 'LF3', 2128.9036544850496, 1, 2129)
    c36 = [(12, 'rawUnc', 3600.0)]
    case(c36, 'F200', 3000, 0, 3000)
    case(c36, 'N', 'NONE', 0, 3500)
    case(c36, 'P', 1800, 0, 1800)
    case(c36 + [(9, 'lfCap', 100.0)], 'LF3', 3000, 0, 3000)
    case(c36 + [(6, 'lfCap', 100.0)], 'LF6', 3000, 0, 3000)
    case(c36 + [(6, 'rawUnc', 130.0)], 'MR', 3000, 0, 3000)
    case(c36 + [(12, 'd6', 1200.0)], 'UP', 3000, 0, 3000)
    case([(12, 'travelGFtoLF', 5.5), (5, 'rawUnc', 2300.0)], 'MR', 2045.4545454545457, 1, 2045)
    case([(12, 'travelGFtoLF', 4.0), (12, 'age_lf_h', 0.5), (7, 'rawUnc', 2300.0)], 'MR',
         2045.4545454545457, 1, 2045)
    case([(6, 'status', 'no_truth')], 'MR', 2250, 0, 2250)
    case([(6, 'status', 'no_por')], 'MR', 2250, 0, 2250)
    rh = [(12, 'lfCap', 1501.0), (12, 'rawUnc', 3100.0), (12, 'corrUsed', 100.0)]
    case(rh, 'P', 1801.2, 1, 1801)
    case(rh, 'F150', 2251.5, 0, 2252)
    case(rh, 'N', 'NONE', 0, 3000)
    case([(12, 'lfCap', 1500.0), (12, 'rawUnc', 1700.5), (12, 'corrUsed', 0.0)], 'N', 'NONE', 0, 1701)
    for ts, lim, sh in [('2021-03-31T23:00:00.000Z', 1800, 1800), ('2021-04-01T00:00:00.000Z', 'NONE', 2500),
                        ('2021-10-31T23:00:00.000Z', 'NONE', 2500), ('2021-11-01T00:00:00.000Z', 1800, 1800),
                        ('2022-01-15T05:00:00.000Z', 1800, 1800)]:
        case([(12, 'predTs', ts)], 'ICE', lim, 0, sh)
    for ts, tmp, lim, sh in [('2021-05-07T00:00:00.000Z', 5.0, 1800, 1800),
                             ('2021-07-07T00:00:00.000Z', 5.0000001, 'NONE', 2500),
                             ('2021-12-07T00:00:00.000Z', None, 1800, 1800),
                             ('2021-07-07T00:00:00.000Z', None, 'NONE', 2500),
                             ('2021-07-07T00:00:00.000Z', -1.0, 1800, 1800),
                             ('2021-12-07T00:00:00.000Z', 20.0, 'NONE', 2500),
                             ('2021-12-07T00:00:00.000Z', 4.9, 1800, 1800)]:
        case([(12, 'predTs', ts), (12, 'tempC', tmp)], 'ICE-T', lim, 0, sh)
    T, b = build_U([(12, 'predTs', '2021-05-06T23:00:00.000Z')])
    l, sh, fb, v = eval_rule('ICE-T', T, b)
    chk(l is UNDEF)
    return int(not ok[0])


def unit_fallbacks():
    ok = [True]

    def chk(c):
        if not c:
            ok[0] = False

    def fbcase(edits, rules, delete=()):
        for r in rules:
            T, b = build_U(edits, delete)
            l, sh, fb, v = eval_rule(r, T, b)
            chk(l == 1800 and sh == 1800 and fb is True)
    fbcase((), ['LF3'], delete=(9,))
    fbcase((), ['LF6', 'MR'], delete=(6,))
    fbcase([(9, 'lfCap', None)], ['LF3'])
    fbcase([(9, 'lfSrcTs', '2020-12-01T11:00:00.000Z')], ['LF3'])
    fbcase([(9, 'lfSrcTs', '2020-12-01T12:00:00.000Z')], ['LF3'])
    fbcase([(9, 'lfSrcTs', '')], ['LF3'])
    fbcase([(12, 'lfSrcTs', '')], ['LF3', 'LF6'])
    fbcase([(12, 'age_lf_h', None)], ['LF3', 'LF6', 'MR', 'UP'])
    fbcase([(12, 'travelGFtoLF', None)], ['LF3', 'LF6', 'MR', 'UP'])
    fbcase([(6, 'rawUnc', None)], ['MR'])
    fbcase([(6, 'corrUsed', None)], ['MR'])
    fbcase([(6, 'rawUnc', 100.0), (6, 'corrUsed', 100.0)], ['MR'])
    fbcase([(6, 'rawUnc', 100.0), (6, 'corrUsed', 105.0)], ['MR'])
    T, b = build_U([(6, 'rawUnc', 5100.0)])
    l, sh, fb, v = eval_rule('MR', T, b)
    chk(l == 1800 and sh == 1800 and fb is False)
    for ed in [(12, 'd6', None), (12, 'd6', 0.0), (12, 'd6', -50.0), (12, 'span_h', None),
               (12, 'span_h', 0.0), (12, 'span_h', -1.0), (12, 'porQ', None), (12, 'porQ', 400.0),
               (12, 'porQ', 300.0)]:
        fbcase([ed], ['UP'])
    T, b = build_U([(12, 'flowState', 'steady')])
    l, sh, fb, v = eval_rule('RIS', T, b)
    chk(l == 1800 and sh == 1800)
    return int(not ok[0])


def unit_error():
    ok = ((850 - 1000) / 1000) * 100.0 == -15
    ok = ok and ((1150 - 1000) / 1000) * 100.0 == 15
    ok = ok and ((17 - 20) / 20) * 100.0 == -15
    ok = ok and abs(((1149 - 1000) / 1000) * 100.0 - 14.9) <= 1e-9
    eP = err_of(850.0, 1000.0)
    eR = err_of(1100.0, 1000.0)
    ok = ok and abs((abs(eR) - abs(eP)) - (-5)) <= 1e-9
    ok = ok and eP <= -15 and abs(eP) >= 15
    return int(not ok)


def unit_measures():
    truth_v = 1000.0
    shP = [850.0, 1000.0, 1160.0, 1000.0]
    shX = [1000.0, 1000.0, 1000.0, 1200.0]
    eP = [err_of(s, truth_v) for s in shP]
    eX = [err_of(s, truth_v) for s in shX]
    m = measures(range(4), eX, eP, shX, shP)
    exp = dict(n=4, mae_P=7.75, mae=5, bias_P=0.25, bias=5, off_P=50, off=25, low_P=25, low=0,
               high_P=25, high=25, mean_d=-2.75, off_diff=-25, low_diff=-25, high_diff=0,
               mae_rel=-0.3548387096774194, n_differ=3)
    ok = all(abs(m[k] - v) <= 1e-9 for k, v in exp.items())
    return int(not ok)


def unit_pick():
    ok = [True]

    def chk(c):
        if not c:
            ok[0] = False
    t1 = dict(F135=(-0.1, 1900), F150=(-0.2, 1893), F200=(-0.3, 1950), LF3=(0.5, 1000),
              LF6=(0.0, 1890), MR=(0.0000001, 500), UP=(-1.0, 1885), RIS=(0.3, 500),
              ICE=(0.0, 1894), N=(1.0, 100))
    r = do_pick(t1, 10000, 2000)
    chk(sorted(r['qual']) == sorted(['F135', 'F150', 'F200', 'LF6', 'UP', 'ICE']))
    chk(len(r['qual']) == 6 and r['leader'] == 'UP')
    chk(sorted(r['tied']) == sorted(['F150', 'LF6', 'UP', 'ICE']))
    chk(r['first'] == 'F150' and r['pick'] == 'F150')
    chk(do_pick(t1, 10000, 1893)['pick'] is None)
    chk(do_pick(t1, 10000, 1890)['pick'] is None)
    chk(do_pick(t1, 10000, 1800)['pick'] is None)
    t2 = dict((x, (1.0, 1000)) for x in CANDS)
    r = do_pick(t2, 10000, 5000)
    chk(len(r['qual']) == 0 and r['pick'] is None)
    t3 = dict((x, (1.0, 5000)) for x in CANDS)
    t3['LF3'] = (-0.1, 1500)
    t3['MR'] = (-0.1, 1505)
    t3['UP'] = (-0.1, 1496)
    r = do_pick(t3, 10000, 3000)
    chk(r['leader'] == 'UP' and sorted(r['tied']) == sorted(['LF3', 'MR', 'UP']) and r['pick'] == 'LF3')
    t4 = dict((x, (1.0, 5000)) for x in CANDS)
    t4['UP'] = (-0.1, 1000)
    t4['F135'] = (-0.1, 1010)
    t4['F150'] = (-0.1, 1011)
    r = do_pick(t4, 10000, 2000)
    chk(r['leader'] == 'UP' and 'F135' in r['tied'] and 'F150' not in r['tied'] and r['pick'] == 'F135')
    return int(not ok[0])


def unit_verdict():
    A = {'c1_off_diff_rising': '-1.500000', 'c1_ci_lo': '-2.000000', 'c1_ci_hi': '-0.500000',
         'c2_mean_d_all': '0.010000', 'c3_high_diff_all': '0.100000',
         'c4_high_diff_rising': '0.200000', 'c5_off_diff_rl': '0.000000',
         'c5_rel_mae_rl': '0.040000', 'c6_off_diff_half1': '-1.000000',
         'c6_off_diff_half2': '-2.000000', 'c7_off_diff_rising_F': '-0.500000',
         'c8_rel_mae_high': '0.000000', 'c9_rel_mae_low': '0.050000'}
    ok = [True]

    def chk(c):
        if not c:
            ok[0] = False

    def run(mods):
        v = dict(A)
        v.update(mods)
        return decide(v, True)
    r, vd = run({})
    chk(all(x == 'pass' for x in r) and vd == 'BETTER_RULE_FOUND')
    r, vd = run({'c1_ci_hi': '0.000000'})
    chk(r[0] == 'fail' and vd == 'KEEP')
    r, vd = run({'c1_ci_lo': '0.100000', 'c1_ci_hi': '0.900000'})
    chk(r[0] == 'fail' and vd == 'KEEP')
    r, vd = run({'c1_ci_hi': ''})
    chk(r[0] == 'fail' and vd == 'KEEP')
    r, vd = run({'c1_off_diff_rising': '-1.000000'})
    chk(r[0] == 'pass')
    r, vd = run({'c1_off_diff_rising': '-0.999999'})
    chk(r[0] == 'fail' and vd == 'UNCLEAR')
    r, vd = run({'c2_mean_d_all': '0.050000'})
    chk(r[1] == 'pass')
    r, vd = run({'c2_mean_d_all': '0.050001'})
    chk(r[1] == 'fail' and vd == 'UNCLEAR')
    r, vd = run({'c3_high_diff_all': '0.500000'})
    chk(r[2] == 'pass')
    r, vd = run({'c3_high_diff_all': '0.500001'})
    chk(r[2] == 'fail')
    r, vd = run({'c4_high_diff_rising': '1.500000'})
    chk(r[3] == 'pass')
    r, vd = run({'c4_high_diff_rising': '1.500001'})
    chk(r[3] == 'fail')
    r, vd = run({'c5_off_diff_rl': '0.000001'})
    chk(r[4] == 'fail')
    r, vd = run({'c5_rel_mae_rl': '0.050000'})
    chk(r[4] == 'pass')
    r, vd = run({'c5_rel_mae_rl': '0.050001'})
    chk(r[4] == 'fail')
    r, vd = run({'c6_off_diff_half1': '-0.000001'})
    chk(r[5] == 'pass')
    r, vd = run({'c6_off_diff_half1': '0.000000'})
    chk(r[5] == 'fail' and vd == 'UNCLEAR')
    r, vd = run({'c7_off_diff_rising_F': '0.000000'})
    chk(r[6] == 'fail')
    r, vd = run({'c8_rel_mae_high': '0.050001'})
    chk(r[7] == 'fail')
    r, vd = run({'c9_rel_mae_low': ''})
    chk(r[8] == 'fail')
    r, vd = decide(A, False)
    chk(all(x == 'not_applicable' for x in r) and vd == 'KEEP')
    return int(not ok[0])


def unit_labels():
    cases = [('0.100000', '0.300000', 'good_job'), ('-0.300000', '-0.100000', 'harm'),
             ('-0.100000', '0.200000', 'unclear'), ('0.000000', '0.200000', 'unclear'),
             ('-0.200000', '0.000000', 'unclear'), ('', '0.200000', 'unclear'),
             ('0.000001', '0.200000', 'good_job')]
    return int(not all(label_of(a, b) == c for a, b, c in cases))


def unit_percentile():
    lo, hi = percentile_pair([float(x) for x in range(1, 10001)])
    return int(not (abs(lo - 250.975) <= 1e-9 and abs(hi - 9750.025) <= 1e-9))


def unit_periods():
    ok = period_of('2019-12-31T23:00:00.000Z') == 'design'
    ok = ok and period_of('2020-01-01T00:00:00.000Z') == 'test'
    ok = ok and '2012-11-30T23:00:00.000Z' < '2012-12-01T00:00:00.000Z'
    ok = ok and period_of('2012-11-30T23:00:00.000Z') is None
    ok = ok and period_of('2012-12-01T00:00:00.000Z') == 'design'
    ok = ok and ('2023-05-31T23:00:00.000Z' < '2023-06-01T00:00:00.000Z')
    ok = ok and not ('2023-06-01T00:00:00.000Z' < '2023-06-01T00:00:00.000Z')
    ok = ok and design_month_idx('2012-12') == 0 and design_month_idx('2019-12') == 84
    ok = ok and test_month_idx('2020-01') == 0 and test_month_idx('2026-11') == 82
    return int(not ok)


def unit_boot_index():
    ok = True
    for B, n, e in [(85, 0, 0), (85, 999999999999, 84), (83, 0, 0), (83, 999999999999, 82),
                    (7, 500000000000, 3)]:
        ok = ok and (n * B) // 10 ** 12 == e
    with open(P_BOOT, newline='') as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        hdr = next(rd)
        first = next(rd)
    n = int(first[0])
    ok = ok and n == 343638232196 and (n * 85) // 10 ** 12 == 29 and (n * 83) // 10 ** 12 == 28
    return int(not ok)


def unit_truth():
    mp = {0: 1000.0, 3600000: 2000.0, 10800000: 4000.0}
    ok = truth(2250000, mp) == 1250
    ok = ok and truth(1350000, mp) == 1000
    ok = ok and truth(3150000, mp) == 1500
    ok = ok and truth(1349999, mp) == 1000
    ok = ok and truth(5400000, mp) == 2000
    ok = ok and truth(8551000, mp) == 4000
    ok = ok and truth(18000000 + 1350000 + 5, mp) is None
    ok = ok and in_range(500.0) and not in_range(499.9) and in_range(500000.0) and not in_range(500000.1)
    return int(not ok)


def unit_mic():
    ok = mic('0.500000') == 500000 and mic('-0.020000') == -20000
    ok = ok and mic('10.000000') == 10000000 and mic('-1.000000') == -1000000
    ok = ok and f6(-0.0000001) == '0.000000' and mic(f6(-0.0000001)) == 0
    return int(not ok)


UNITS = [('unit_round', unit_round), ('unit_key', unit_key), ('unit_time', unit_time),
         ('unit_rules', unit_rules), ('unit_fallbacks', unit_fallbacks), ('unit_error', unit_error),
         ('unit_measures', unit_measures), ('unit_pick', unit_pick), ('unit_verdict', unit_verdict),
         ('unit_labels', unit_labels), ('unit_percentile', unit_percentile),
         ('unit_periods', unit_periods), ('unit_boot_index', unit_boot_index),
         ('unit_truth', unit_truth), ('unit_mic', unit_mic)]


# ---------------------------------------------------------------- output helpers
def write_csv(name, header, rows):
    with open(os.path.join(PYDIR, name), 'w', newline='', encoding='utf-8') as f:
        f.write(','.join(header) + '\n')
        for r in rows:
            f.write(','.join(r) + '\n')


def write_checks(rows):
    write_csv('checks.csv', ['check', 'arm', 'n_checked', 'n_violations'],
              [[a, b, str(c), str(d)] for (a, b, c, d) in rows])


def log(msg):
    sys.stderr.write('[%6.1fs] %s\n' % (time.time() - START, msg))
    sys.stderr.flush()


# ---------------------------------------------------------------- loading
def load_shadow(path):
    cols = dict((nm, []) for nm in COLS22)
    c02 = 0
    nrows = 0
    badfields = 0
    c05 = 0
    c05n = 0
    c03 = 0
    c04 = 0
    c11_lf = 0
    c11_lfn = 0
    keys = []
    with open(path, newline='') as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        header = next(rd)
        ix = {}
        for nm in COLS22:
            cnt = header.count(nm)
            if cnt != 1:
                c02 += 1
            ix[nm] = header.index(nm) if cnt >= 1 else None
        textix = [(nm, ix[nm]) for nm in TEXTCOLS]
        numix = [(nm, ix[nm]) for nm in NUMCOLS]
        prevk = None
        for row in rd:
            nrows += 1
            if len(row) != 87:
                badfields += 1
            ln = len(row)
            for nm, i in textix:
                cols[nm].append(row[i] if (i is not None and i < ln) else '')
            for nm, i in numix:
                s = row[i] if (i is not None and i < ln) else ''
                if s == '':
                    cols[nm].append(None)
                else:
                    c05n += 1
                    if NUM_RE.match(s):
                        cols[nm].append(float(s))
                    else:
                        c05 += 1
                        cols[nm].append(None)
    n = nrows
    ts = cols['predTs']
    for i in range(n):
        m = TS_RE.match(ts[i])
        good = False
        if m:
            mo = int(m.group(2))
            da = int(m.group(3))
            hh = int(m.group(4))
            good = 1 <= mo <= 12 and 1 <= da <= 31 and 0 <= hh <= 23
        if not good:
            c03 += 1
            keys.append(-10 ** 9 - i)
        else:
            keys.append(K(ts[i]))
    c04n = max(n - 1, 0)
    for i in range(1, n):
        if keys[i] != keys[i - 1] + 1:
            c04 += 1

    def time_ok(s):
        m = TS_FULL_RE.match(s)
        if not m:
            return False
        mo, da, hh, mi, se = [int(m.group(g)) for g in (2, 3, 4, 5, 6)]
        return 1 <= mo <= 12 and 1 <= da <= 31 and 0 <= hh <= 23 and 0 <= mi <= 59 and 0 <= se <= 59
    for s in cols['lfSrcTs']:
        if s != '':
            c11_lfn += 1
            if not time_ok(s):
                c11_lf += 1
    T = Tab(cols, keys)
    info = dict(nrows=nrows, badfields=badfields, c02=c02, c03=c03, c04=c04, c04n=c04n, c05=c05,
                c05n=c05n, c11_lf=c11_lf, c11_lfn=c11_lfn, time_ok=time_ok)
    return T, info


def score_rows(T):
    c = T.c
    n = T.n
    counts = [n, 0, 0, 0, 0, 0]
    sc = []
    status = c['status']
    ts = c['predTs']
    hard = c['truthDependentHard']
    rng = c['truthInProdRange']
    ec = c['errPctCorr']
    er = c['errPctRaw']
    for i in range(n):
        if status[i] != 'predicted':
            counts[1] += 1
            continue
        if ts[i] < '2012-12-01T00:00:00.000Z':
            counts[2] += 1
            continue
        if hard[i] == '1':
            counts[3] += 1
            continue
        if rng[i] == '0':
            counts[4] += 1
            continue
        if ec[i] is None or er[i] == '':
            counts[5] += 1
            continue
        sc.append(i)
    return sc, counts


COND_NAMES = ['read', 'status_not_predicted', 'burn_in', 'truth_dependent_hard',
              'truth_out_of_range', 'blank_error']


def load_hourly():
    with open(P_HOUR, 'rb') as f:
        txt = f.read().decode('utf-8')
    lines = txt.strip().split('\n')
    header = lines[0].split(',')
    mp = {}
    c13 = 0
    nlines = 0
    prev = None
    for ln in lines[1:]:
        nlines += 1
        fl_ = ln.split(',')
        if len(fl_) != 12:
            c13 += 1
            continue
        t = fl_[0]
        if not HR_RE.match(t):
            c13 += 1
            continue
        e = EMS(t)
        if prev is not None and not (e > prev):
            c13 += 1
        prev = e
        s = fl_[4]
        if s != '':
            if not NUM_RE.match(s):
                c13 += 1
            else:
                v = float(s)
                if not v > 0:
                    c13 += 1
                mp[e] = v
    if nlines != 130416:
        c13 += 1
    if len(header) < 5 or header[0] != 'timestamp' or header[4] != 'lf_discharge':
        c13 += 1
    return mp, nlines, c13


def load_events():
    with open(P_EVT, 'rb') as f:
        txt = f.read().decode('utf-8')
    lines = txt.strip().split('\n')
    header = lines[0].split(',')
    c14 = 0
    need = ['event_id', 'event_t0', 'event_class', 'rl_start', 'rl_end', 'kept']
    for nm in need:
        if nm not in header:
            c14 += 1
    ix = dict((nm, header.index(nm)) for nm in need if nm in header)
    rises = []
    nlines = 0
    for ln in lines[1:]:
        nlines += 1
        fl_ = ln.split(',')
        if len(fl_) != 47:
            c14 += 1
            continue
        if len(ix) < 6:
            continue
        if fl_[ix['event_class']] == 'GATE' and fl_[ix['kept']] == '1':
            t0 = fl_[ix['event_t0']]
            rs = fl_[ix['rl_start']]
            re_ = fl_[ix['rl_end']]
            if not (HR_RE.match(t0) and HR_RE.match(rs) and HR_RE.match(re_)):
                c14 += 1
                continue
            rises.append(dict(id=fl_[ix['event_id']], t0=t0, t0ts=ev_to_ts(t0), s=ev_to_ts(rs),
                              e=ev_to_ts(re_),
                              period='design' if t0 < '2020-01-01 00:00' else 'test'))
    return rises, nlines, c14, header


# ---------------------------------------------------------------- arm
class Arm(object):
    pass


def build_arm(T, sc, rises, mp):
    """arm-level per-scored-hour arrays that do not depend on the truth"""
    A = Arm()
    c = T.c
    A.T = T
    A.sc = sc
    A.nsc = len(sc)
    ts = c['predTs']
    A.pts = [ts[i] for i in sc]
    A.per = [period_of(t) for t in A.pts]
    A.half = []
    A.mon = []
    for j, t in enumerate(A.pts):
        p = A.per[j]
        if p == 'test':
            A.half.append(1 if t < '2023-06-01T00:00:00.000Z' else 2)
            A.mon.append(test_month_idx(t))
        else:
            A.half.append(0)
            A.mon.append(design_month_idx(t))
    A.tau = [EMS(c['tauTs'][i]) for i in sc]
    A.icet = [t >= ICET_START for t in A.pts]
    A.u = [c['rawUnc'][i] - c['corrUsed'][i] for i in sc]
    A.L = [c['lfCap'][i] for i in sc]
    A.capped = [A.u[j] > 1.2 * A.L[j] for j in range(A.nsc)]
    A.rising = [c['flowState'][i] == 'rising' for i in sc]
    A.bin = [c['flowBin'][i] for i in sc]
    # Little Falls rising
    A.lfr = []
    m3_n = 0
    m3_v = 0
    for j, i in enumerate(sc):
        r3 = T.idx.get(T.key[i] - 3)
        if r3 is not None and c['lfCap'][r3] is not None:
            L3 = c['lfCap'][r3]
            L = A.L[j]
            A.lfr.append(L >= 1.02 * L3)
            m3_n += 1
            dd = abs(L - 1.02 * L3)
            if 0 < dd < 1e-9 * max(1.0, abs(L)):
                m3_v += 1
        else:
            A.lfr.append(False)
    A.m3 = (m3_n, m3_v)
    m2 = 0
    for j in range(A.nsc):
        dd = abs(A.u[j] - 1.2 * A.L[j])
        if 0 < dd < 1e-9 * max(1.0, abs(A.u[j])):
            m2 += 1
    A.m2 = (A.nsc, m2)
    # rises
    A.rises = rises
    A.rise_of = [-1] * A.nsc
    A.multi = 0
    for j, t in enumerate(A.pts):
        cnt = 0
        for r, rs in enumerate(rises):
            if rs['s'] <= t <= rs['e']:
                cnt += 1
                if A.rise_of[j] < 0:
                    A.rise_of[j] = r
        if cnt > 1:
            A.multi += 1
    A.rise_cls = []
    for rs in rises:
        i = T.idx.get(K(rs['t0ts']))
        if i is None or c['porQ'][i] is None or c['lfCap'][i] is None:
            A.rise_cls.append('notclassed')
        elif c['porQ'][i] < 0.5 * c['lfCap'][i]:
            A.rise_cls.append('lfled')
        else:
            A.rise_cls.append('upstream')
    A.rl_per_mismatch = 0
    for j in range(A.nsc):
        r = A.rise_of[j]
        if r >= 0 and rises[r]['period'] != A.per[j]:
            A.rl_per_mismatch += 1
    # rule shown values
    A.shown = dict((r, [None] * A.nsc) for r in RULES17)
    A.fb = dict((r, [False] * A.nsc) for r in ('LF3', 'LF6', 'MR', 'UP'))
    m1pairs = 0
    m4n = 0
    m4x = 0
    for j, i in enumerate(sc):
        for r in RULES17:
            lim, sh, fb, v = eval_rule(r, T, i)
            if lim is UNDEF:
                continue
            A.shown[r][j] = sh
            if r in A.fb:
                A.fb[r][j] = fb
            m1pairs += 1
            z = v + 0.5
            dz = abs(z - math.floor(z + 0.5))
            if 0 < dz < 1e-9:
                m4n += 1
            if z == math.floor(z + 0.5):
                m4x += 1
    A.m1pairs = m1pairs
    A.m4 = (m1pairs, m4n)
    A.m4x = (m1pairs, m4x)
    A.shown['P_icet_hours'] = A.shown['P']
    # populations
    n = A.nsc
    fl_ = {}
    fl_['all'] = [True] * n
    fl_['rising'] = A.rising
    fl_['lf_rising'] = A.lfr
    fl_['capped'] = A.capped
    fl_['capped_rising'] = [A.capped[j] and A.rising[j] for j in range(n)]
    fl_['capped_notrising'] = [A.capped[j] and not A.rising[j] for j in range(n)]
    fl_['rl_large'] = [A.rise_of[j] >= 0 for j in range(n)]
    for cls in ('upstream', 'lfled', 'notclassed'):
        fl_['rl_large_' + cls] = [A.rise_of[j] >= 0 and A.rise_cls[A.rise_of[j]] == cls for j in range(n)]
    for b in BINS:
        fl_['bin_' + b] = [A.bin[j] == b for j in range(n)]
    fl_['high_water'] = [A.bin[j] in ('25000-50000', '50000+') for j in range(n)]
    fl_['low_water'] = [A.bin[j] == '0-3000' for j in range(n)]
    A.popflags = fl_
    pflag = {'design': [A.per[j] == 'design' for j in range(n)],
             'test': [A.per[j] == 'test' for j in range(n)],
             'test_half1': [A.half[j] == 1 for j in range(n)],
             'test_half2': [A.half[j] == 2 for j in range(n)]}
    A.hs = {}
    for p in PERIODS:
        pf = pflag[p]
        for pop in POPS:
            f = fl_[pop]
            A.hs[(p, pop)] = [j for j in range(n) if pf[j] and f[j]]
    return A


class Run(object):
    def __init__(self, A, tv, keep):
        self.A = A
        self.tv = tv
        self.keep = keep
        self.allkeep = all(keep)
        self.errs = {}
        self.cache = {}

    def err(self, rule):
        if rule == 'P_icet_hours':
            rule = 'P'
        e = self.errs.get(rule)
        if e is None:
            A = self.A
            sh = A.shown[rule]
            tv = self.tv
            keep = self.keep
            e = [None] * A.nsc
            for j in range(A.nsc):
                s = sh[j]
                if s is not None and keep[j] and tv[j] is not None:
                    e[j] = ((s - tv[j]) / tv[j]) * 100.0
            self.errs[rule] = e
        return e

    def hours(self, period, pop):
        H = self.A.hs[(period, pop)]
        if self.allkeep:
            return H
        keep = self.keep
        return [j for j in H if keep[j]]

    def table(self, period, pop, rule):
        key = (period, pop, rule)
        r = self.cache.get(key)
        if r is not None:
            return r
        A = self.A
        H = self.hours(period, pop)
        if rule in ('ICE-T', 'P_icet_hours'):
            H = [j for j in H if A.icet[j]]
        base = 'P' if rule == 'P_icet_hours' else rule
        if not H:
            r = dict(EMPTY_STATS)
        else:
            r = measures(H, self.err(base), self.err('P'), A.shown[base], A.shown['P'])
        self.cache[key] = r
        return r


# ---------------------------------------------------------------- bootstrap
def load_boot():
    c85 = []
    c83 = []
    with open(P_BOOT, newline='') as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        hdr = next(rd)
        for row in rd:
            a = [0] * 85
            b = [0] * 83
            for k in range(85):
                a[(int(row[k]) * 85) // 10 ** 12] += 1
            for k in range(83):
                b[(int(row[k]) * 83) // 10 ** 12] += 1
            c85.append(a)
            c83.append(b)
    return c85, c83


def interval(H, xs, mon, counts, B):
    n = len(H)
    out = dict(n=n, est=None, lo=None, hi=None, nvalid=0, nskip=0)
    if n == 0:
        out['nskip'] = len(counts)
        return out
    Sj = [0.0] * B
    Nj = [0] * B
    tot = 0.0
    for j, x in zip(H, xs):
        Sj[mon[j]] = Sj[mon[j]] + x
        Nj[mon[j]] += 1
        tot = tot + x
    out['est'] = tot / n
    vals = []
    nskip = 0
    for c in counts:
        num = 0.0
        den = 0
        for cj, sj, nj in zip(c, Sj, Nj):
            num = num + cj * sj
            den = den + cj * nj
        if den == 0:
            nskip += 1
        else:
            vals.append(num / den)
    out['nskip'] = nskip
    out['nvalid'] = len(vals)
    if nskip <= 500:
        vals.sort()
        out['lo'], out['hi'] = percentile_pair(vals)
    return out


def x_d(run, rule):
    eX = run.err(rule)
    eP = run.err('P')

    def f(j):
        return abs(eX[j]) - abs(eP[j])
    return f


def x_off(run, rule):
    eX = run.err(rule)
    eP = run.err('P')

    def f(j):
        a = 1 if abs(eX[j]) >= 15 else 0
        b = 1 if abs(eP[j]) >= 15 else 0
        return 100.0 * (a - b)
    return f


def class_of(e):
    if e <= -15:
        return 'low'
    if e >= 15:
        return 'high'
    return 'within'


def pop_counts(A, p):
    T = A.T
    c = T.c
    sc = A.sc
    H = A.hs[(p, 'all')]
    d = {}
    d['scored'] = len(H)
    d['capped'] = len(A.hs[(p, 'capped')])
    d['rising'] = len(A.hs[(p, 'rising')])
    d['capped_rising'] = len(A.hs[(p, 'capped_rising')])
    d['lf_rising'] = len(A.hs[(p, 'lf_rising')])
    d['lf_rising_capped'] = len([j for j in A.hs[(p, 'lf_rising')] if A.capped[j]])
    d['rl_hours'] = len(A.hs[(p, 'rl_large')])
    d['rl_rises'] = len([r for r in A.rises if r['period'] == p])
    d['rl_capped'] = len([j for j in A.hs[(p, 'rl_large')] if A.capped[j]])
    d['d6_blank'] = len([j for j in H if c['d6'][sc[j]] is None])
    d['span_zero'] = len([j for j in H if c['span_h'][sc[j]] is not None and c['span_h'][sc[j]] == 0])
    d['mr_fallback'] = len([j for j in H if A.fb['MR'][j]])
    d['mr_differs'] = len([j for j in H if A.shown['MR'][j] != A.shown['P'][j]])
    d['up_fallback'] = len([j for j in H if A.fb['UP'][j]])
    d['lf3_fallback'] = len([j for j in H if A.fb['LF3'][j]])
    d['lf6_fallback'] = len([j for j in H if A.fb['LF6'][j]])
    d['icet_hours'] = len([j for j in H if A.icet[j]])
    d['icet_temp_blank'] = len([j for j in H if A.icet[j] and c['tempC'][sc[j]] is None])
    d['blocks'] = 85 if p == 'design' else 83
    return d


ITEMS19 = ['scored', 'capped', 'rising', 'capped_rising', 'lf_rising', 'lf_rising_capped',
           'rl_hours', 'rl_rises', 'rl_capped', 'd6_blank', 'span_zero', 'mr_fallback', 'mr_differs',
           'up_fallback', 'lf3_fallback', 'lf6_fallback', 'icet_hours', 'icet_temp_blank', 'blocks']

C15_EXP = [('scored', 59999, 59448), ('capped', 2137, 2511), ('rising', 9272, 9059),
           ('capped_rising', 1238, 1302), ('lf_rising', 9885, 10302),
           ('lf_rising_capped', 1296, 1257), ('rl_hours', 275, 452), ('rl_rises', 8, 13),
           ('rl_capped', 140, 240), ('d6_blank', 498, 0), ('span_zero', 593, 81),
           ('mr_fallback', 120, 0), ('mr_differs', 1903, 2122)]


def named_values(run, X, ci_lo, ci_hi, c7):
    def t(p, pop):
        return run.table(p, pop, X)
    v = {}
    v['c1_off_diff_rising'] = f6(t('test', 'rising')['off_diff'])
    v['c1_ci_lo'] = ci_lo
    v['c1_ci_hi'] = ci_hi
    v['c2_mean_d_all'] = f6(t('test', 'all')['mean_d'])
    v['c3_high_diff_all'] = f6(t('test', 'all')['high_diff'])
    v['c4_high_diff_rising'] = f6(t('test', 'rising')['high_diff'])
    v['c5_n_rl'] = str(t('test', 'rl_large')['n'])
    v['c5_off_diff_rl'] = f6(t('test', 'rl_large')['off_diff'])
    v['c5_rel_mae_rl'] = f6(t('test', 'rl_large')['mae_rel'])
    v['c6_off_diff_half1'] = f6(t('test_half1', 'rising')['off_diff'])
    v['c6_off_diff_half2'] = f6(t('test_half2', 'rising')['off_diff'])
    v['c7_off_diff_rising_F'] = c7
    v['c8_rel_mae_high'] = f6(t('test', 'high_water')['mae_rel'])
    v['c9_rel_mae_low'] = f6(t('test', 'low_water')['mae_rel'])
    return v


NAMED_ORDER = ['c1_off_diff_rising', 'c1_ci_lo', 'c1_ci_hi', 'c2_mean_d_all', 'c3_high_diff_all',
               'c4_high_diff_rising', 'c5_n_rl', 'c5_off_diff_rl', 'c5_rel_mae_rl',
               'c6_off_diff_half1', 'c6_off_diff_half2', 'c7_off_diff_rising_F', 'c8_rel_mae_high',
               'c9_rel_mae_low']
COND_ORDER = ['cond1_rising_off', 'cond2_overall', 'cond3_high_all', 'cond4_high_rising',
              'cond5_large_rises', 'cond6_halves', 'cond7_timing_arm_F', 'cond8_high_water',
              'cond9_low_water']


def make_shift_run(A, s, mp):
    n = A.nsc
    tv = [None] * n
    keep = [False] * n
    nm = nr = nl = 0
    for j in range(n):
        if A.per[j] != 'test':
            continue
        v = truth(A.tau[j] + s * 3600000, mp)
        if v is None:
            nm += 1
            continue
        if not in_range(v):
            nr += 1
            continue
        tv[j] = v
        keep[j] = True
        nl += 1
    return Run(A, tv, keep), nm, nr, nl


# ---------------------------------------------------------------- main
def main():
    for fn in OUTFILES:
        p = os.path.join(PYDIR, fn)
        if os.path.exists(p):
            os.remove(p)
    log('unit tests')
    unit_rows = []
    for name, fn in UNITS:
        try:
            v = fn()
        except Exception as ex:
            log('unit %s raised %r' % (name, ex))
            v = 1
        unit_rows.append((name, '-', 1, v))
    if any(r[3] for r in unit_rows):
        write_checks(unit_rows)
        log('UNIT TEST FAILURE: ' + ','.join(r[0] for r in unit_rows if r[3]))
        sys.exit(1)

    log('C00 sha')
    c00 = 0
    for p, (sha, size) in SHA.items():
        with open(p, 'rb') as f:
            data = f.read()
        if len(data) != size or hashlib.sha256(data).hexdigest() != sha:
            c00 += 1
    ck = {}
    ck[('C00_inputs_sha', '-')] = (5, c00)
    if c00:
        write_checks(unit_rows + [('C00_inputs_sha', '-', 5, c00)])
        log('C00 FAILURE')
        sys.exit(1)

    log('load shadow L')
    TL, iL = load_shadow(P_L)
    log('load shadow F')
    TF, iF = load_shadow(P_F)
    arms = {'L': (TL, iL), 'F': (TF, iF)}
    mp, nh, c13 = load_hourly()
    rises, nev, c14base, evh = load_events()
    ck[('C13_hourly_file', '-')] = (nh, c13)
    sel_viol = 0
    if len(rises) != 21:
        sel_viol += 1
    if len([r for r in rises if r['period'] == 'design']) != 8:
        sel_viol += 1
    if len([r for r in rises if r['period'] == 'test']) != 13:
        sel_viol += 1

    sc = {}
    acct = {}
    for a in ('L', 'F'):
        T, info = arms[a]
        s_, cnt = score_rows(T)
        sc[a] = s_
        acct[a] = cnt
        c = T.c
        ck[('C01_rows_fields', a)] = (info['nrows'], info['badfields'] + (1 if info['nrows'] != 130987 else 0))
        ck[('C02_header', a)] = (22, info['c02'])
        ck[('C03_predTs_form', a)] = (info['nrows'], info['c03'])
        ck[('C04_hour_grid', a)] = (info['c04n'], info['c04'])
        ck[('C05_numbers_parse', a)] = (info['c05n'], info['c05'])
        c06 = 0
        numreq = ['predictedCFS', 'truthFlow', 'rawUnc', 'corrUsed', 'lfCap', 'lfQ', 'age_lf_h',
                  'travelGFtoLF', 'errPctRaw', 'errPctCorr']
        for i in s_:
            bad = False
            for nm in ['flowBin', 'flowState', 'truthInProdRange', 'truthDependentHard', 'lfSrcTs',
                       'tauTs', 'errPctRaw']:
                if c[nm][i] == '':
                    bad = True
            for nm in ['predictedCFS', 'truthFlow', 'rawUnc', 'corrUsed', 'lfCap', 'lfQ',
                       'age_lf_h', 'travelGFtoLF', 'errPctCorr']:
                if c[nm][i] is None:
                    bad = True
            if c['flowState'][i] not in ('rising', 'steady', 'falling'):
                bad = True
            if c['flowBin'][i] not in BINS:
                bad = True
            if bad:
                c06 += 1
        ck[('C06_needed_nonblank', a)] = (len(s_), c06)
        tau_bad = 0
        for i in s_:
            if not info['time_ok'](c['tauTs'][i]):
                tau_bad += 1
        ck[('C11_time_forms', a)] = (info['c11_lfn'] + len(s_), info['c11_lf'] + tau_bad)
        c12 = 0
        dm = set()
        for y in range(2012, 2020):
            for m in range(1, 13):
                if (y, m) >= (2012, 12):
                    dm.add('%04d-%02d' % (y, m))
        tm = set()
        for y in range(2020, 2027):
            for m in range(1, 13):
                if (y, m) <= (2026, 11):
                    tm.add('%04d-%02d' % (y, m))
        for i in s_:
            t = c['predTs'][i]
            p = period_of(t)
            if p == 'design' and t[0:7] not in dm:
                c12 += 1
            elif p == 'test' and t[0:7] not in tm:
                c12 += 1
            elif p is None:
                c12 += 1
        ck[('C12_blocks_cover', a)] = (len(s_), c12)
    # phase-1 stop
    phase1 = [k for k in ck if k[0] in ('C01_rows_fields', 'C02_header', 'C03_predTs_form',
                                         'C04_hour_grid', 'C05_numbers_parse',
                                         'C06_needed_nonblank', 'C11_time_forms', 'C12_blocks_cover')]
    if any(ck[k][1] for k in phase1) or c13:
        log('PHASE-1 CHECK FAILURE')
        rows = list(unit_rows) + [(k[0], k[1], ck[k][0], ck[k][1]) for k in ck]
        write_checks(rows)
        sys.exit(1)

    # truth
    log('truth')
    tr = {}
    for a in ('L', 'F'):
        T = arms[a][0]
        c = T.c
        tr[a] = [truth(EMS(c['tauTs'][i]), mp) for i in sc[a]]
        c16 = 0
        c07 = 0
        c08 = 0
        for j, i in enumerate(sc[a]):
            v = tr[a][j]
            tf = c['truthFlow'][i]
            if v is None or abs(v - tf) > 1e-6 * max(1.0, abs(tf)):
                c16 += 1
            if v is not None and v <= 0:
                c07 += 1
            if c['lfCap'][i] != c['lfQ'][i] or c['lfCap'][i] <= 0:
                c08 += 1
        ck[('C16_truth_rebuilt', a)] = (len(sc[a]), c16)
        ck[('C07_truth_positive', a)] = (len(sc[a]), c07)
        ck[('C08_lfcap_lfq', a)] = (len(sc[a]), c08)
    if any(ck[('C16_truth_rebuilt', a)][1] or ck[('C07_truth_positive', a)][1] or
           ck[('C08_lfcap_lfq', a)][1] for a in ('L', 'F')):
        log('TRUTH CHECK FAILURE')
        rows = list(unit_rows) + [(k[0], k[1], ck[k][0], ck[k][1]) for k in ck]
        write_checks(rows)
        sys.exit(1)

    log('build arms')
    AA = {}
    runs = {}
    for a in ('L', 'F'):
        AA[a] = build_arm(arms[a][0], sc[a], rises, mp)
        runs[a] = Run(AA[a], tr[a], [True] * AA[a].nsc)
        log('arm %s built' % a)
    for a in ('L', 'F'):
        A = AA[a]
        T = A.T
        c = T.c
        c09 = c10 = 0
        eP = runs[a].err('P')
        for j, i in enumerate(sc[a]):
            if A.shown['P'][j] != c['predictedCFS'][i]:
                c09 += 1
            if abs(eP[j] - c['errPctCorr'][i]) > 1e-9:
                c10 += 1
        ck[('C09_shown_recomputed', a)] = (len(sc[a]), c09)
        ck[('C10_err_corr', a)] = (len(sc[a]), c10)
    ck[('C14_events_file', '-')] = (nev, c14base + sel_viol + AA['L'].multi + AA['F'].multi +
                                    AA['L'].rl_per_mismatch + AA['F'].rl_per_mismatch)
    # C15
    pc = {}
    for p in ('design', 'test'):
        pc[p] = pop_counts(AA['L'], p)
    c15 = 0
    for nm, ed, et in C15_EXP:
        if pc['design'][nm] != ed:
            c15 += 1
        if pc['test'][nm] != et:
            c15 += 1
    ck[('C15_expected_counts', 'L')] = (26, c15)

    # rule tables
    log('rule tables')
    tables = {}
    for a in ('L', 'F'):
        for p in PERIODS:
            for pop in POPS:
                for r in RULES18:
                    tables[(a, p, pop, r)] = runs[a].table(p, pop, r)

    # cap_classes (arm L)
    RL = runs['L']
    AL = AA['L']
    cap_class_rows = []
    cell_viol = 0
    eN = RL.err('N')
    ePL = RL.err('P')
    for p in ('design', 'test'):
        Hc = AL.hs[(p, 'capped')]
        cnt = {}
        for j in Hc:
            k = (class_of(eN[j]), class_of(ePL[j]))
            cnt[k] = cnt.get(k, 0) + 1
        for cn in ('low', 'within', 'high'):
            for cp in ('low', 'within', 'high'):
                nn = cnt.get((cn, cp), 0)
                sh = None if len(Hc) == 0 else (100.0 * nn) / len(Hc)
                cap_class_rows.append([p, 'no_%s__cap_%s' % (cn, cp), str(nn), f6(sh)])
                if (cn, cp) in (('low', 'within'), ('low', 'high'), ('within', 'high')) and nn > 0:
                    cell_viol += 1
        Hr = AL.hs[(p, 'rising')]
        lowr = [j for j in Hr if ePL[j] <= -15]
        lowc = [j for j in lowr if AL.capped[j]]
        cap_class_rows.append([p, 'reach_rising_low_P', str(len(lowr)), ''])
        cap_class_rows.append([p, 'reach_rising_low_P_capped', str(len(lowc)),
                               f6(None if len(lowr) == 0 else (100.0 * len(lowc)) / len(lowr))])

    # C17
    for a in ('L', 'F'):
        A = AA[a]
        pairs = 0
        va = vb = 0
        for j in range(A.nsc):
            shP = A.shown['P'][j]
            for X in LIST15:
                sx = A.shown[X][j]
                if sx is None:
                    continue
                pairs += 1
                if sx < shP:
                    va += 1
                if sx != shP and not A.capped[j]:
                    vb += 1
        vc = 0
        nrows_ = 0
        for p in PERIODS:
            for pop in POPS:
                for X in LIST15:
                    t = tables[(a, p, pop, X)]
                    if t['n'] > 0:
                        nrows_ += 1
                        if t['c_low'] > t['cP_low'] or t['c_high'] < t['cP_high']:
                            vc += 1
        extra = 6 if a == 'L' else 0
        vd = cell_viol if a == 'L' else 0
        ck[('C17_monotone', a)] = (pairs + nrows_ + extra, va + vb + vc + vd)

    # M rows
    for a in ('L', 'F'):
        A = AA[a]
        run = runs[a]
        m1 = m1x = 0
        for r in RULES17:
            e = run.err(r)
            for j in range(A.nsc):
                if e[j] is None:
                    continue
                dd = abs(abs(e[j]) - 15.0)
                if 0 < dd < 1e-9:
                    m1 += 1
                if abs(e[j]) == 15.0:
                    m1x += 1
        ck[('M1_err15_margin', a)] = (A.m1pairs, m1)
        ck[('M1x_err15_exact', a)] = (A.m1pairs, m1x)
        ck[('M2_cap_margin', a)] = A.m2
        ck[('M3_lfrise_margin', a)] = A.m3
        ck[('M4_floor_margin', a)] = A.m4
        ck[('M4x_floor_exact', a)] = A.m4x

    # pick
    log('pick')
    nr_ = len(AL.hs[('design', 'rising')])
    cands = {}
    for X in CANDS:
        md = tables[('L', 'design', 'all', X)]['mean_d']
        co = tables[('L', 'design', 'rising', X)]['c_off']
        cands[X] = (md, co)
    cP = tables[('L', 'design', 'rising', 'P')]['c_off']
    pk = do_pick(cands, nr_, cP)
    pick = pk['pick']
    m5 = len([X for X in CANDS if 0 < abs(cands[X][0]) < 1e-9])
    ck[('M5_pick_margin', 'L')] = (10, m5)
    pick_rows = []
    for X in CANDS:
        md, co = cands[X]
        q = md <= 0
        sign = -1 if md < 0 else (1 if md > 0 else 0)
        pick_rows.append([X, str(TIE_ORDER.index(X) + 1), f6(md), f6((100.0 * co) / nr_), str(co),
                          str(nr_), str(sign), str(int(q)),
                          str(int(q and X == pk['leader'])), str(int(q and X in pk['tied'])),
                          str(int(q and X == pk['first']))])

    # intervals (arm L)
    log('bootstrap')
    c85, c83 = load_boot()
    iv_rows = []
    iv = {}

    def add_iv(id_, period, rule, pop, xname, run, A, xfun, counts, B):
        H = run.hours(period, pop)
        xs = [xfun(j) for j in H]
        r = interval(H, xs, A.mon, counts, B)
        iv[id_] = r
        iv_rows.append([id_, period, rule, pop, xname, str(r['n']), f6(r['est']), f6(r['lo']),
                        f6(r['hi']), str(r['nvalid']), str(r['nskip'])])
        return r
    k = 1
    for period, counts, B in (('design', c85, 85), ('test', c83, 83)):
        for pop in ('all', 'capped', 'capped_rising', 'capped_notrising', 'lf_rising', 'rl_large'):
            add_iv('I%02d' % k, period, 'N', pop, 'd', RL, AL, x_d(RL, 'N'), counts, B)
            k += 1
    for X in CANDS:
        add_iv('I%02d' % k, 'test', X, 'rising', 'off_diff', RL, AL, x_off(RL, X), c83, 83)
        k += 1
        add_iv('I%02d' % k, 'test', X, 'all', 'd', RL, AL, x_d(RL, X), c83, 83)
        k += 1
    # shifted runs
    log('shifted runs')
    shifts = [(-1, 'm1'), (1, 'p1'), (2, 'p2')]
    SR = {}
    for a in ('L', 'F'):
        for s, tag in shifts:
            SR[(a, s)] = make_shift_run(AA[a], s, mp)
    for idx, (s, tag) in enumerate(shifts):
        id_ = 'S%02d' % (idx + 1)
        xname = 'off_diff_shift_' + tag
        if pick is None:
            iv_rows.append([id_, 'test', '', 'rising', xname, '', '', '', '', '', '', ''][:11])
            iv[id_] = None
        else:
            run = SR[('L', s)][0]
            add_iv(id_, 'test', pick, 'rising', xname, run, AL, x_off(run, pick), c83, 83)

    # decision inputs
    di = []
    leader = pk['leader']
    di.append(['pick', pick if pick else 'none'])
    di.append(['n_qualifiers', str(len(pk['qual']))])
    di.append(['leader', leader if leader else 'none'])
    di.append(['leader_off_rising_design', f6(None if leader is None else (100.0 * cands[leader][1]) / nr_)])
    di.append(['P_off_rising_design', f6((100.0 * cP) / nr_)])
    di.append(['P_c_off_rising', str(cP)])
    main_vals = {}
    if pick is None:
        for nm in ['pick_off_rising_design', 'pick_mean_d_all_design'] + NAMED_ORDER:
            di.append([nm, ''])
        conds, verdict = decide({}, False)
    else:
        di.append(['pick_off_rising_design', f6((100.0 * cands[pick][1]) / nr_)])
        di.append(['pick_mean_d_all_design', f6(cands[pick][0])])
        rid = 'I%02d' % (13 + 2 * CANDS.index(pick))
        c7 = f6(runs['F'].table('test', 'rising', pick)['off_diff'])
        main_vals = named_values(RL, pick, f6(iv[rid]['lo']), f6(iv[rid]['hi']), c7)
        for nm in NAMED_ORDER:
            di.append([nm, main_vals[nm]])
        conds, verdict = decide(main_vals, True)
    dec = [[COND_ORDER[i], conds[i]] for i in range(9)] + [['verdict', verdict]]

    # cap_description
    capd = []
    for p, base in (('design', 1), ('test', 7)):
        for gi, g in enumerate(('all', 'capped', 'capped_rising', 'capped_notrising', 'lf_rising', 'rl_large')):
            r = iv['I%02d' % (base + gi)]
            t = tables[('L', p, g, 'N')]
            lo, hi = f6(r['lo']), f6(r['hi'])
            capd.append([p, g, str(t['n']), f6(t['mean_d']), lo, hi, label_of(lo, hi)])

    # rises_test
    log('rises')
    rt = []
    cnt_lower = dict((X, 0) for X in CANDS)
    for ri, rs in enumerate(rises):
        if rs['period'] != 'test':
            continue
        H = [j for j in range(AL.nsc) if rs['s'] <= AL.pts[j] <= rs['e']]
        maes = {}
        for X in ['P'] + CANDS:
            if not H:
                maes[X] = None
            else:
                e = RL.err(X)
                s_ = 0.0
                for j in H:
                    s_ = s_ + abs(e[j])
                maes[X] = s_ / len(H)
        for X in ['P'] + CANDS:
            if X == 'P' or not H:
                low = ''
            else:
                lw = 1 if maes[X] < maes['P'] else 0
                low = str(lw)
                cnt_lower[X] += lw
            rt.append([rs['id'], rs['t0'], X, str(len(H)), f6(maes[X]), low])
    for X in CANDS:
        rt.append(['COUNT', '', X, str(cnt_lower[X]), '', ''])

    # timing
    log('timing outputs')
    gate_fail = []
    gn = 0
    cL = AL.T.c
    for j, i in enumerate(sc['L']):
        v = tr['L'][j]
        tf = cL['truthFlow'][i]
        if v is None or abs(v - tf) > 1e-6 * max(1.0, abs(tf)):
            gn += 1
            if len(gate_fail) < 10:
                gate_fail.append(cL['predTs'][i])
    tg = [['gate_n_checked', str(len(sc['L']))], ['gate_n_failing', str(gn)],
          ['gate_passed', str(1 if gn == 0 else 0)]]
    for q in range(10):
        tg.append(['gate_fail_%d' % (q + 1), gate_fail[q] if q < len(gate_fail) else ''])
    for a, pre in (('L', 'shift_'), ('F', 'shiftF_')):
        for s, tag in shifts:
            _, nm, nr, nl = SR[(a, s)]
            tg.append(['%s%s_n_missing' % (pre, tag), str(nm)])
            tg.append(['%s%s_n_range' % (pre, tag), str(nr)])
            tg.append(['%s%s_n_left' % (pre, tag), str(nl)])
    tc = []
    tp = []
    shift_c1 = {}
    for idx, (s, tag) in enumerate(shifts):
        run = SR[('L', s)][0]
        for X in CANDS:
            ta = run.table('test', 'all', X)
            tri = run.table('test', 'rising', X)
            trl = run.table('test', 'rl_large', X)
            tc.append([str(s), X, str(ta['n']), f6(ta['mean_d']), str(tri['n']), f6(tri['off_diff']),
                       str(trl['n']), f6(trl['off_diff']), f6(trl['mae_rel'])])
        if pick is None:
            for nm in NAMED_ORDER:
                tp.append([str(s), nm, ''])
            for cn in COND_ORDER:
                tp.append([str(s), cn, 'not_applicable'])
            tp.append([str(s), 'verdict', 'KEEP'])
            shift_c1[s] = ''
        else:
            r = iv['S%02d' % (idx + 1)]
            c7 = f6(SR[('F', s)][0].table('test', 'rising', pick)['off_diff'])
            vals = named_values(run, pick, f6(r['lo']), f6(r['hi']), c7)
            cs, vd = decide(vals, True)
            for nm in NAMED_ORDER:
                tp.append([str(s), nm, vals[nm]])
            for i2, cn in enumerate(COND_ORDER):
                tp.append([str(s), cn, cs[i2]])
            tp.append([str(s), 'verdict', vd])
            shift_c1[s] = vals['c1_off_diff_rising']
    if pick is None or shift_c1[-1] == '':
        flag = ''
    else:
        mainc1 = main_vals['c1_off_diff_rising']
        flag = str(1 if (mainc1 != '' and mic(mainc1) < 0 and mic(shift_c1[-1]) >= 0) else 0)
    tg.append(['timing_flag', flag])

    # final checks table, order
    order = [('C00_inputs_sha', '-')]
    for nm in ['C01_rows_fields', 'C02_header', 'C03_predTs_form', 'C04_hour_grid', 'C05_numbers_parse',
               'C06_needed_nonblank', 'C07_truth_positive', 'C08_lfcap_lfq', 'C09_shown_recomputed',
               'C10_err_corr', 'C11_time_forms', 'C12_blocks_cover']:
        order += [(nm, 'L'), (nm, 'F')]
    order += [('C13_hourly_file', '-'), ('C14_events_file', '-'), ('C15_expected_counts', 'L')]
    order += [('C16_truth_rebuilt', 'L'), ('C16_truth_rebuilt', 'F'),
              ('C17_monotone', 'L'), ('C17_monotone', 'F')]
    crow = [(k[0], k[1], ck[k][0], ck[k][1]) for k in order]
    if any(r[3] for r in crow):
        write_checks(list(unit_rows) + crow)
        log('CHECK FAILURE: ' + ', '.join('%s %s n=%d v=%d' % r for r in crow if r[3]))
        sys.exit(1)
    mrows = []
    for nm in ['M1_err15_margin', 'M1x_err15_exact', 'M2_cap_margin', 'M3_lfrise_margin',
               'M4_floor_margin', 'M4x_floor_exact']:
        for a in ('L', 'F'):
            mrows.append((nm, a, ck[(nm, a)][0], ck[(nm, a)][1]))
    mrows.append(('M5_pick_margin', 'L', ck[('M5_pick_margin', 'L')][0], ck[('M5_pick_margin', 'L')][1]))
    write_checks(list(unit_rows) + crow + mrows)

    # write files
    log('writing')
    ra = []
    for a in ('L', 'F'):
        left = acct[a][0]
        ra.append([a, '0', COND_NAMES[0], str(acct[a][0]), '0', str(acct[a][0])])
        for st in range(1, 6):
            ra.append([a, str(st), COND_NAMES[st], str(left), str(acct[a][st]), str(left - acct[a][st])])
            left -= acct[a][st]
    write_csv('row_accounting.csv', ['arm', 'step', 'condition', 'rows_in', 'rows_dropped', 'rows_left'], ra)
    po = []
    for a in ('L', 'F'):
        for p in ('design', 'test'):
            d = pop_counts(AA[a], p)
            for it in ITEMS19:
                po.append([a, p, it, str(d[it])])
    write_csv('populations.csv', ['arm', 'period', 'item', 'n'], po)
    rtab = []
    for a in ('L', 'F'):
        for p in PERIODS:
            for pop in POPS:
                for r in RULES18:
                    t = tables[(a, p, pop, r)]
                    rtab.append([a, p, pop, r, str(t['n']), f6(t['mae']), f6(t['bias']), f6(t['off']),
                                 f6(t['low']), f6(t['high']), f6(t['mean_d']), f6(t['off_diff']),
                                 f6(t['low_diff']), f6(t['high_diff']), f6(t['mae_rel']),
                                 str(t['n_differ'])])
    write_csv('rule_tables.csv', ['arm', 'period', 'population', 'rule', 'n', 'mae', 'bias', 'off', 'low',
                                  'high', 'mean_d', 'off_diff', 'low_diff', 'high_diff', 'mae_rel',
                                  'n_differ'], rtab)
    write_csv('cap_description.csv', ['period', 'group', 'n', 'mean_d', 'lo', 'hi', 'label'], capd)
    write_csv('cap_classes.csv', ['period', 'item', 'n', 'share'], cap_class_rows)
    write_csv('intervals.csv', ['id', 'period', 'rule', 'population', 'x', 'n', 'est', 'lo', 'hi',
                                'n_valid', 'n_skipped'], iv_rows)
    write_csv('pick_design.csv', ['rule', 'tie_order', 'mean_d_all', 'off_rising', 'c_off_rising',
                                  'n_rising', 'mean_d_sign', 'qualifies', 'is_leader', 'is_tied',
                                  'is_first_tied'], pick_rows)
    write_csv('decision_inputs.csv', ['name', 'value'], di)
    write_csv('decision.csv', ['item', 'result'], dec)
    write_csv('rises_test.csv', ['event_id', 'event_t0', 'rule', 'n', 'mae', 'lower_than_P'], rt)
    write_csv('timing_gate.csv', ['key', 'value'], tg)
    write_csv('timing_candidates.csv', ['shift', 'rule', 'n_all', 'mean_d_all', 'n_rising',
                                        'off_diff_rising', 'n_rl', 'off_diff_rl', 'mae_rel_rl'], tc)
    write_csv('timing_pick.csv', ['shift', 'item', 'value'], tp)
    log('done')


if __name__ == '__main__':
    main()
