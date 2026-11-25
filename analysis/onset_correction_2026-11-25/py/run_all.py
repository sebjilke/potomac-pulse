#!/usr/bin/env python3
# Onset study, Python implementation of ANALYSIS_SPEC.md version 1.2.
# Run from the study folder:  python3 -I py/run_all.py
# Standard library only. All outputs go to py/.
import sys
import os
import csv
import re
import math
import hashlib

SCRIPT = os.path.abspath(__file__)
PYDIR = os.path.dirname(SCRIPT)
STUDY = os.path.dirname(PYDIR)

PATH_L = os.path.join(STUDY, 'replay_L', 'shadow_L.csv')
PATH_F = os.path.join(STUDY, 'replay_F', 'shadow_F.csv')
PATH_U = os.path.join(STUDY, 'tools', 'boot_uniforms.csv')
HASHES = {
    PATH_L: ('dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba', 109952178),
    PATH_F: ('7fb8072237cd21c99d196a7b2c1525f4aa850885638e4f06321617cdcf2a63a3', 110149295),
    PATH_U: ('71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515', 13000392),
}

CAP = 1.2
NROWS = 130987
NCOLS = 87
BURN = '2012-12-01T00:00:00.000Z'
T2020 = '2020-01-01T00:00:00.000Z'
T2023 = '2023-06-01T00:00:00.000Z'
T1008 = '2026-10-08T00:00:00.000Z'

COLS21 = ['predTs', 'status', 'rawFinalCFS', 'predictedCFS', 'flowBin', 'flowState', 'truthFlow',
          'truthInProdRange', 'truthDependentHard', 'errPctRaw', 'errPctCorr', 'rawUnc', 'corrUsed',
          'corrR', 'corrS', 'corrF', 'd6', 'thr6', 'span_h', 'lfCap', 'ageR_h']
NUMCOLS15 = ['rawFinalCFS', 'predictedCFS', 'truthFlow', 'errPctRaw', 'errPctCorr', 'rawUnc', 'corrUsed',
             'corrR', 'corrS', 'corrF', 'd6', 'thr6', 'span_h', 'lfCap', 'ageR_h']
C06_NONBLANK = ['rawFinalCFS', 'predictedCFS', 'flowBin', 'flowState', 'truthFlow', 'truthInProdRange',
                'truthDependentHard', 'rawUnc', 'corrUsed', 'corrR', 'corrS', 'corrF', 'lfCap', 'thr6',
                'errPctRaw', 'errPctCorr']
LOW4 = ('0-3000', '3000-6000', '6000-12000', '12000-25000')
HIGH2 = ('25000-50000', '50000+')
SIXBINS = LOW4 + HIGH2
MS = (1.5, 2.0, 3.0, 5.0)

MONTHS = ['%04d-%02d' % (2020 + j // 12, j % 12 + 1) for j in range(83)]
QUARTERS = ['%04dQ%d' % (2020 + j // 4, j % 4 + 1) for j in range(28)]
MONTH_IDX = {s: i for i, s in enumerate(MONTHS)}
QUARTER_IDX = {s: i for i, s in enumerate(QUARTERS)}

NUM_RE = re.compile(r'-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?')
TS_RE = re.compile(r'[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):00:00\.000Z')

MEAS_COLS = ['n', 'n_affected', 'n_raised', 'n_lowered', 'mean_d', 'mean_d_affected',
             'mean_abs_change_cfs', 'mean_signed_change_cfs', 'mean_abs_change_pct', 'mae_prod',
             'mae_rule', 'bias_prod', 'bias_rule', 'below15_prod', 'below15_rule', 'above15_prod',
             'above15_rule', 'rel_mae_diff']
MEAS_INT = ('n', 'n_affected', 'n_raised', 'n_lowered')


# ---------------------------------------------------------------- basics
def fmt(x):
    if x is None:
        return ''
    s = '%.6f' % x
    if s == '-0.000000':
        s = '0.000000'
    return s


def fint(x):
    return '%d' % x


def rnd(x):
    return float(math.floor(x + 0.5))


def key_of(ts):
    Y = int(ts[0:4])
    M = int(ts[5:7])
    D = int(ts[8:10])
    HH = int(ts[11:13])
    y = Y - (1 if M <= 2 else 0)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (M + (-3 if M > 2 else 9)) + 2) // 5 + D - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days = era * 146097 + doe - 719468
    return days * 24 + HH


def md_of(ts):
    return 100 * int(ts[5:7]) + int(ts[8:10])


def month_label(ts):
    return ts[0:7]


def quarter_label(ts):
    return ts[0:4] + 'Q' + str((int(ts[5:7]) - 1) // 3 + 1)


def is_eel(ts):
    md = md_of(ts)
    return 915 <= md <= 1215


def mic(s):
    if s is None or s == '':
        return None
    if s == '-0.000000':
        s = '0.000000'
    return int(s.replace('.', ''))


def fsum_list(xs):
    s = 0.0
    for x in xs:
        s = s + x
    return s


# ---------------------------------------------------------------- rule arithmetic
def shown_from(rawUnc, corr, lfCap):
    v = rawUnc - corr
    if lfCap > 0:
        v = min(v, 1.2 * lfCap)
    return rnd(v)


def err_of(shown, truth):
    return (shown - truth) / truth * 100


def weight_up(d6, thr6, m):
    """hand-over weight, rising hour (tie -> 0)"""
    if thr6 <= 0:
        return 0.0
    if d6 == thr6:
        return 0.0
    r = d6 / thr6
    return min(1.0, (r - 1) / (m - 1))


def weight_fall(d6, thr6, m):
    if thr6 <= 0:
        return 0.0
    if (0 - d6) == thr6:
        return 0.0
    rf = (0 - d6) / thr6
    return min(1.0, (rf - 1) / (m - 1))


def blend(w, c_steady, c_other):
    return (1.0 - w) * c_steady + w * c_other


def ratio_group(r):
    if 1 <= r < 1.5:
        return '1-1.5'
    if 1.5 <= r < 2:
        return '1.5-2'
    if 2 <= r < 3:
        return '2-3'
    if 3 <= r < 5:
        return '3-5'
    if 5 <= r < 10:
        return '5-10'
    if r >= 10:
        return '10+'
    return None


def spell_group(k):
    if k == 1:
        return '1'
    if k == 2:
        return '2'
    if k == 3:
        return '3'
    if 4 <= k <= 6:
        return '4-6'
    if 7 <= k <= 12:
        return '7-12'
    return '13+'


def age_group(a):
    if a is None:
        return 'blank'
    if a < 24:
        return 'lt1d'
    if a < 168:
        return '1-7d'
    if a < 720:
        return '7-30d'
    return 'gt30d'


def spell_ages(keys, states):
    out = [None] * len(keys)
    prev_rising = False
    prev_k = 0
    prev_key = None
    for i in range(len(keys)):
        if states[i] == 'rising':
            if prev_rising and prev_key is not None and keys[i] is not None and keys[i] == prev_key + 1:
                k = prev_k + 1
            else:
                k = 1
            out[i] = k
            prev_rising = True
            prev_k = k
        else:
            prev_rising = False
        prev_key = keys[i]
    return out


def percentile(xs, p):
    m = len(xs)
    pos = (m - 1) * p
    i = int(math.floor(pos))
    frac = pos - i
    if i + 1 > m - 1:
        return xs[i]
    return xs[i] + frac * (xs[i + 1] - xs[i])


def period_labels(ts):
    out = []
    out.append('design' if (BURN <= ts < T2020) else ('test' if ts >= T2020 else 'pre'))
    return out


# ---------------------------------------------------------------- unit tests
def close(a, b, tol=1e-12):
    return abs(a - b) <= tol


def unit_tests(uniform_first_line):
    res = []

    # 1 round
    f = 0
    for x, e in ((0.5, 1), (2.4, 2), (2.5, 3), (-0.5, 0), (-1.5, -1), (8.49, 8), (8.5, 9)):
        if rnd(x) != e:
            f += 1
    res.append(('unit_round', 1, f))

    # 2 key
    f = 0
    for ts, e in (('2020-01-01T00:00:00.000Z', 438288), ('2012-12-01T00:00:00.000Z', 376200),
                  ('2026-11-09T23:00:00.000Z', 498407), ('1970-01-01T00:00:00.000Z', 0)):
        if key_of(ts) != e:
            f += 1
    res.append(('unit_key', 1, f))

    # 3 rule
    f = 0

    def chk(cond):
        nonlocal f
        if not cond:
            f += 1

    raw = 3000.4
    cs, cr, cf = 100.0, 300.0, -50.0

    def sh(corr, cap=3300.0, rawu=raw):
        return shown_from(rawu, corr, cap)

    w = weight_up(150.0, 100.0, 2.0)
    c = blend(w, cs, cr)
    chk(w == 0.5 and c == 200 and sh(c) == 2800)
    w = weight_up(100.0, 100.0, 2.0)
    c = blend(w, cs, cr)
    chk(w == 0 and c == 100 and sh(c) == 2900)
    w = weight_up(400.0, 100.0, 3.0)
    c = blend(w, cs, cr)
    chk(w == 1 and c == 300 and sh(c) == 2700)
    c = blend(0.5, cs, cr)
    chk(sh(c, 2000.0) == 2400)
    chk(sh(c, 0.0) == 2800)
    c = ((cr + cs) + cf) / 3
    chk(close(c, 116.66666666666667) and sh(c) == 2884)
    chk(sh(blend(0.0, cs, cr)) == 2900)
    w = weight_fall(-250.0, 100.0, 3.0)
    c = blend(w, cs, cf)
    chk(w == 0.75 and c == -12.5 and sh(c) == 3013)
    for m in MS:
        w = weight_up(100.0 * m, 100.0, m)
        chk(w == 1 and sh(blend(w, cs, cr)) == 2700)
    for m, we, ce, se in zip(MS, (0.5, 0.25, 0.125, 0.0625), (200, 150, 125, 112.5), (2800, 2850, 2875, 2888)):
        w = weight_up(125.0, 100.0, m)
        c = blend(w, cs, cr)
        chk(w == we and c == ce and sh(c) == se)
    for m, we, se in zip(MS, (1, 1, 0.75, 0.375), (2700, 2700, 2750, 2825)):
        w = weight_up(300.0, 120.0, m)
        c = blend(w, cs, cr)
        chk(w == we and sh(c) == se)
    chk(sh(100.0, 0.0, 3000.5) == 2901)
    chk(sh(100.0, 0.0, 99.5) == 0)
    chk(sh(100.0, 0.0, 98.5) == -1)
    chk(sh(blend(0.0, cs, cr), 2400.0) == 2880)
    chk(sh(blend(1.0, cs, cr), 2400.0) == 2700)
    chk(sh(blend(1.0, cs, cr), -5.0) == 2700)
    c = blend(0.5, -200.0, 100.0)
    chk(c == -50 and sh(c) == 3050)
    w = weight_fall(-100.0, 100.0, 3.0)
    chk(w == 0 and sh(blend(w, cs, cf)) == 2900)
    w = weight_fall(-400.0, 100.0, 3.0)
    c = blend(w, cs, cf)
    chk(w == 1 and c == -50 and sh(c) == 3050)
    chk((850 - 1000) / 1000 * 100 == -15 and (-15 <= -15))
    chk((1150 - 1000) / 1000 * 100 == 15)
    chk((17 - 20) / 20 * 100 == -15)
    res.append(('unit_rule', 1, f))

    # 4 groups
    f = 0
    for r, e in ((1.5, '1.5-2'), (10, '10+'), (1, '1-1.5'), (4.999, '3-5')):
        if ratio_group(r) != e:
            f += 1
    for k, e in ((3, '3'), (4, '4-6'), (6, '4-6'), (7, '7-12'), (12, '7-12'), (13, '13+')):
        if spell_group(k) != e:
            f += 1
    for a, e in ((23, 'lt1d'), (24, '1-7d'), (167, '1-7d'), (168, '7-30d'), (719, '7-30d'),
                 (720, 'gt30d'), (None, 'blank')):
        if age_group(a) != e:
            f += 1
    res.append(('unit_groups', 1, f))

    # 5 spell
    offs = [0, 1, 2, 3, 4, 5, 6, 8, 9]
    sts = ['steady', 'rising', 'rising', 'rising', '', 'rising', 'rising', 'rising', 'rising']
    got = spell_ages(offs, sts)
    f = 0 if got == [None, 1, 2, 3, None, 1, 2, 1, 2] else 1
    res.append(('unit_spell', 1, f))

    # 6 percentile
    xs = [float(i) for i in range(1, 10001)]
    f = 0
    if abs(percentile(xs, 0.025) - 250.975) > 1e-9:
        f += 1
    if abs(percentile(xs, 0.975) - 9750.025) > 1e-9:
        f += 1
    res.append(('unit_percentile', 1, f))

    # 7 periods
    def T(s):
        return s + ':00:00.000Z'

    def per(ts):
        return 'design' if BURN <= ts < T2020 else ('test' if ts >= T2020 else 'pre')

    f = 0
    chk_list = [
        per(T('2019-12-31T23')) == 'design', per(T('2020-01-01T00')) == 'test',
        (T('2023-05-31T23') < T2023) and (T('2023-06-01T00') >= T2023),
        (not is_eel(T('2025-09-14T23'))), is_eel(T('2025-09-15T00')), is_eel(T('2025-12-15T23')),
        (not is_eel(T('2025-12-16T00'))),
        (T('2026-10-07T23') < T1008), (T('2026-10-08T00') >= T1008),
        quarter_label(T('2020-03-01T00')) == '2020Q1', quarter_label(T('2020-04-01T00')) == '2020Q2',
        quarter_label(T('2026-11-01T00')) == '2026Q4',
        MONTH_IDX['2020-01'] == 0, MONTH_IDX['2026-11'] == 82, QUARTER_IDX['2026Q4'] == 27,
    ]
    for c in chk_list:
        if not c:
            f += 1
    res.append(('unit_periods', 1, f))

    # 8 boot index
    f = 0
    if (0 * 83) // 10 ** 12 != 0:
        f += 1
    if (999999999999 * 83) // 10 ** 12 != 82:
        f += 1
    if (500000000000 * 7) // 10 ** 12 != 3:
        f += 1
    first = int(uniform_first_line)
    if first != 343638232196:
        f += 1
    if (first * 83) // 10 ** 12 != 28:
        f += 1
    if (first * 28) // 10 ** 12 != 9:
        f += 1
    res.append(('unit_boot_index', 1, f))
    return res


# ---------------------------------------------------------------- reading
def sha256_file(path):
    h = hashlib.sha256()
    n = 0
    with open(path, 'rb') as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
            n += len(b)
    return h.hexdigest(), n


def read_shadow(path):
    with open(path, newline='', encoding='utf-8') as f:
        rd = csv.reader(f, delimiter=',', quoting=csv.QUOTE_NONE)
        header = next(rd)
        header = [h[:-1] if h.endswith('\r') else h for h in header]
        idx = {}
        for name in COLS21:
            c = header.count(name)
            idx[name] = header.index(name) if c == 1 else None
        cols = {name: [] for name in COLS21}
        nf = []
        pairs = [(name, idx[name]) for name in COLS21]
        for row in rd:
            if row and row[-1].endswith('\r'):
                row[-1] = row[-1][:-1]
            nf.append(len(row))
            L = len(row)
            for name, i in pairs:
                if i is None or i >= L:
                    cols[name].append('')
                else:
                    cols[name].append(row[i])
    return header, cols, nf


class Hr(object):
    __slots__ = ('i', 'ts', 'key', 'mi', 'qi', 'md', 'design', 'test', 'state', 'bin', 'low4', 'high2',
                 'truth', 'rawF', 'pred', 'raw', 'cu', 'cr', 'cs', 'cf', 'cap', 'd6', 'thr6', 'span',
                 'age', 'k', 'isR', 'isFL', 'shownP', 'errP', 'eel')


# variants: ('prod',), ('ho', m), ('half',), ('three',), ('steady',), ('both', m)
VARIANTS = [('prod',)] + [('ho', m) for m in MS] + [('half',), ('three',), ('steady',)] + \
           [('both', m) for m in MS]
C14_VARIANTS = VARIANTS[1:]


def variant_correction(h, var):
    kind = var[0]
    if kind == 'prod':
        return h.cu, False
    if kind == 'both':
        inset = h.isR or h.isFL
    else:
        inset = h.isR
    if not inset:
        return h.cu, False
    if kind == 'ho':
        w = weight_up(h.d6, h.thr6, var[1])
        return blend(w, h.cs, h.cr), True
    if kind == 'half':
        return blend(0.5, h.cs, h.cr), True
    if kind == 'three':
        return ((h.cr + h.cs) + h.cf) / 3, True
    if kind == 'steady':
        return blend(0.0, h.cs, h.cr), True
    if kind == 'both':
        if h.isR:
            w = weight_up(h.d6, h.thr6, var[1])
            return blend(w, h.cs, h.cr), True
        w = weight_fall(h.d6, h.thr6, var[1])
        return blend(w, h.cs, h.cf), True
    raise ValueError(var)


def variant_inset(h, var):
    kind = var[0]
    if kind == 'prod':
        return False
    if kind == 'both':
        return h.isR or h.isFL
    return h.isR


def build_variant_arrays(H):
    arr = {}
    for var in VARIANTS:
        sh = []
        er = []
        for h in H:
            corr, _ = variant_correction(h, var)
            s = shown_from(h.raw, corr, h.cap)
            sh.append(s)
            er.append(err_of(s, h.truth) if h.truth != 0 else 0.0)
        arr[var] = (sh, er)
    return arr


class Arm(object):
    pass


def process_arm(name, path, U):
    arm = Arm()
    arm.name = name
    arm.U = U
    header, cols, nf = read_shadow(path)
    nrows = len(nf)
    arm.nrows = nrows
    checks = []  # (check, n_checked, n_violations)

    # C01
    viol = sum(1 for x in nf if x != NCOLS)
    if nrows != NROWS:
        viol += 1
    checks.append(('C01_rows_fields', nrows, viol))
    # C02
    viol = 0
    for nm in COLS21:
        if header.count(nm) != 1:
            viol += 1
    checks.append(('C02_header', 21, viol))
    # C03
    ts = cols['predTs']
    viol = 0
    for t in ts:
        if TS_RE.fullmatch(t) is None:
            viol += 1
    checks.append(('C03_predTs_form', nrows, viol))
    # C04
    keys = [None] * nrows
    for i in range(nrows):
        if TS_RE.fullmatch(ts[i]) is not None:
            keys[i] = key_of(ts[i])
    viol = 0
    for i in range(1, nrows):
        if keys[i] is None or keys[i - 1] is None or keys[i] != keys[i - 1] + 1:
            viol += 1
    checks.append(('C04_hour_grid', max(nrows - 1, 0), viol))

    # row accounting
    status = cols['status']
    tdh = cols['truthDependentHard']
    tir = cols['truthInProdRange']
    ecorr = cols['errPctCorr']
    eraw = cols['errPctRaw']
    acct = []
    alive = list(range(nrows))
    acct.append((0, 'read', nrows, 0, nrows))

    def step(stepno, cname, pred):
        nonlocal alive
        rin = len(alive)
        alive = [i for i in alive if not pred(i)]
        acct.append((stepno, cname, rin, rin - len(alive), len(alive)))

    step(1, 'status_not_predicted', lambda i: status[i] != 'predicted')
    step(2, 'burn_in', lambda i: ts[i] < BURN)
    step(3, 'truth_dependent_hard', lambda i: tdh[i] == '1')
    step(4, 'truth_out_of_range', lambda i: tir[i] == '0')
    step(5, 'blank_error', lambda i: ecorr[i] == '' or eraw[i] == '')
    scored = alive
    arm.acct = acct
    arm.n_scored = len(scored)

    # C05
    nchk = 0
    viol = 0
    for nm in NUMCOLS15:
        c = cols[nm]
        for i in scored:
            s = c[i]
            if s != '':
                nchk += 1
                if NUM_RE.fullmatch(s) is None:
                    viol += 1
    checks.append(('C05_numbers_parse', nchk, viol))

    # C06
    viol = 0
    valid_state = ('rising', 'steady', 'falling')
    c06bad = set()
    for i in scored:
        bad = False
        for nm in C06_NONBLANK:
            if cols[nm][i] == '':
                bad = True
        fs = cols['flowState'][i]
        if fs not in valid_state:
            bad = True
        if cols['flowBin'][i] not in SIXBINS:
            bad = True
        if fs == 'rising' or fs == 'falling':
            if cols['d6'][i] == '' or cols['span_h'][i] == '':
                bad = True
        if bad:
            viol += 1
            c06bad.add(i)
    checks.append(('C06_needed_nonblank', len(scored), viol))

    # spell ages on ALL rows
    states = cols['flowState']
    spell = spell_ages(keys, states)

    # build hour records for good scored hours
    H = []

    def pf(s):
        return float(s)

    for i in scored:
        if i in c06bad:
            continue
        try:
            h = Hr()
            h.i = i
            h.ts = ts[i]
            h.key = keys[i]
            h.mi = MONTH_IDX.get(month_label(h.ts))
            h.qi = QUARTER_IDX.get(quarter_label(h.ts))
            h.md = md_of(h.ts)
            h.design = (BURN <= h.ts < T2020)
            h.test = (h.ts >= T2020)
            h.state = states[i]
            h.bin = cols['flowBin'][i]
            h.low4 = h.bin in LOW4
            h.high2 = h.bin in HIGH2
            h.truth = pf(cols['truthFlow'][i])
            h.rawF = pf(cols['rawFinalCFS'][i])
            h.pred = pf(cols['predictedCFS'][i])
            h.raw = pf(cols['rawUnc'][i])
            h.cu = pf(cols['corrUsed'][i])
            h.cr = pf(cols['corrR'][i])
            h.cs = pf(cols['corrS'][i])
            h.cf = pf(cols['corrF'][i])
            h.cap = pf(cols['lfCap'][i])
            h.thr6 = pf(cols['thr6'][i])
            s = cols['d6'][i]
            h.d6 = pf(s) if s != '' else None
            s = cols['span_h'][i]
            h.span = pf(s) if s != '' else None
            s = cols['ageR_h'][i]
            h.age = pf(s) if s != '' else None
            h.k = spell[i]
            h.isR = (h.state == 'rising' and h.low4)
            h.isFL = (h.state == 'falling' and h.low4)
            h.eel = is_eel(h.ts)
            h.shownP = shown_from(h.raw, h.cu, h.cap)
            h.errP = err_of(h.shownP, h.truth) if h.truth != 0 else 0.0
            # remember the C10/C11 inputs
            h.__class__ = Hr
        except (ValueError, ZeroDivisionError):
            continue
        H.append(h)
    arm.H = H
    nH = len(H)

    # C07
    viol = sum(1 for h in H if h.truth <= 0)
    checks.append(('C07_truth_positive', nH, viol))
    # C08
    viol = 0
    for h in H:
        i = h.i
        cu_t = cols['corrUsed'][i]
        if h.state == 'rising':
            o = cols['corrR'][i]
        elif h.state == 'steady':
            o = cols['corrS'][i]
        else:
            o = cols['corrF'][i]
        if cu_t != o:
            viol += 1
    checks.append(('C08_corr_of_state', nH, viol))
    # C09
    viol = sum(1 for h in H if h.shownP != h.pred)
    checks.append(('C09_shown_recomputed', nH, viol))
    # C10, C11
    v10 = 0
    v11 = 0
    for h in H:
        i = h.i
        if abs(h.errP - float(cols['errPctCorr'][i])) > 1e-9:
            v10 += 1
        if h.truth != 0 and abs((h.rawF - h.truth) / h.truth * 100 - float(cols['errPctRaw'][i])) > 1e-9:
            v11 += 1
    checks.append(('C10_err_corr', nH, v10))
    checks.append(('C11_err_raw', nH, v11))
    # C12
    nchk = 0
    viol = 0
    for h in H:
        if h.state == 'rising':
            nchk += 1
            if h.thr6 <= 0 or h.d6 < h.thr6:
                viol += 1
        elif h.state == 'falling':
            nchk += 1
            if h.thr6 <= 0 or (0 - h.d6) < h.thr6:
                viol += 1
    checks.append(('C12_ratio_ge_1', nchk, viol))

    # C13
    nchk = 0
    viol = 0
    for h in H:
        if h.isR:
            for m in MS:
                w = weight_up(h.d6, h.thr6, m)
                nchk += 1
                if w < 0 or w > 1:
                    viol += 1
            nchk += 1  # half_half, w = 0.5
            if 0.5 < 0 or 0.5 > 1:
                viol += 1
        if h.isFL:
            for m in MS:
                w = weight_fall(h.d6, h.thr6, m)
                nchk += 1
                if w < 0 or w > 1:
                    viol += 1
    checks.append(('C13_weights_range', nchk, viol))

    # variant arrays
    arr = build_variant_arrays(H)
    arm.arr = arr
    shP = [h.shownP for h in H]
    erP = [h.errP for h in H]
    arm.shP = shP
    arm.erP = erP

    # C14
    nchk = 0
    viol = 0
    for var in C14_VARIANTS:
        sh = arr[var][0]
        for p in range(nH):
            nchk += 1
            if not variant_inset(H[p], var) and sh[p] != shP[p]:
                viol += 1
    checks.append(('C14_unchanged_outside', nchk, viol))

    # C15
    nchk = 12 * nH
    viol = 0
    for var in VARIANTS:
        er = arr[var][1]
        for p in range(nH):
            e = er[p]
            if abs(e + 15) < 1e-9 or abs(e - 15) < 1e-9:
                viol += 1
    rh = [h for h in H if h.test and h.state == 'rising' and h.high2]
    nchk += 4 * len(rh)
    for h in rh:
        if h.thr6 <= 0:
            continue
        r = h.d6 / h.thr6
        for m in MS:
            if abs(r - m) < 1e-9 * m and r != m:
                viol += 1
    checks.append(('C15_parse_margin', nchk, viol))

    # C16
    nchk = 0
    viol = 0
    for i in scored:
        if ts[i] >= T2020:
            nchk += 1
            if TS_RE.fullmatch(ts[i]) is None or month_label(ts[i]) not in MONTH_IDX or \
                    quarter_label(ts[i]) not in QUARTER_IDX:
                viol += 1
    checks.append(('C16_blocks_cover', nchk, viol))

    arm.checks = checks
    return arm


# ---------------------------------------------------------------- measures
def meas(H, pop, shX, erX, shP, erP):
    n = len(pop)
    s_d = 0.0
    na = nr = nl = 0
    s_da = 0.0
    s_abs = 0.0
    s_sig = 0.0
    s_pct = 0.0
    s_maep = 0.0
    s_maer = 0.0
    s_bp = 0.0
    s_br = 0.0
    cbp = cbr = cap_ = car = 0
    for p in pop:
        ep = erP[p]
        ex = erX[p]
        d = abs(ex) - abs(ep)
        s_d = s_d + d
        sx = shX[p]
        sp = shP[p]
        if sx != sp:
            na += 1
            s_da = s_da + d
            chg = sx - sp
            s_abs = s_abs + abs(chg)
            s_sig = s_sig + chg
            s_pct = s_pct + abs(sx - sp) / H[p].truth * 100
            if sx > sp:
                nr += 1
            if sx < sp:
                nl += 1
        s_maep = s_maep + abs(ep)
        s_maer = s_maer + abs(ex)
        s_bp = s_bp + ep
        s_br = s_br + ex
        if ep <= -15:
            cbp += 1
        if ex <= -15:
            cbr += 1
        if ep >= 15:
            cap_ += 1
        if ex >= 15:
            car += 1
    o = {'n': n, 'n_affected': na, 'n_raised': nr, 'n_lowered': nl}
    if n == 0:
        for c in MEAS_COLS[4:]:
            o[c] = None
        return o
    o['mean_d'] = s_d / n
    if na > 0:
        o['mean_d_affected'] = s_da / na
        o['mean_abs_change_cfs'] = s_abs / na
        o['mean_signed_change_cfs'] = s_sig / na
        o['mean_abs_change_pct'] = s_pct / na
    else:
        o['mean_d_affected'] = None
        o['mean_abs_change_cfs'] = None
        o['mean_signed_change_cfs'] = None
        o['mean_abs_change_pct'] = None
    mp = s_maep / n
    mr = s_maer / n
    o['mae_prod'] = mp
    o['mae_rule'] = mr
    o['bias_prod'] = s_bp / n
    o['bias_rule'] = s_br / n
    o['below15_prod'] = 100 * cbp / n
    o['below15_rule'] = 100 * cbr / n
    o['above15_prod'] = 100 * cap_ / n
    o['above15_rule'] = 100 * car / n
    o['rel_mae_diff'] = (mr - mp) / mp if mp != 0 else None
    return o


def meas_cells(o):
    out = []
    for c in MEAS_COLS:
        if c in MEAS_INT:
            out.append(fint(o[c]))
        else:
            out.append(fmt(o[c]))
    return out


# ---------------------------------------------------------------- bootstrap
def load_uniforms():
    counts83 = []
    counts28 = []
    with open(PATH_U, newline='', encoding='utf-8') as f:
        rd = csv.reader(f, delimiter=',', quoting=csv.QUOTE_NONE)
        header = next(rd)
        header = [h.strip() for h in header]
        for row in rd:
            if row and row[-1].endswith('\r'):
                row[-1] = row[-1][:-1]
            vals = [int(row[k]) for k in range(83)]
            c = [0] * 83
            for n in vals:
                c[(n * 83) // 10 ** 12] += 1
            counts83.append(c)
            c = [0] * 28
            for k in range(28):
                c[(vals[k] * 28) // 10 ** 12] += 1
            counts28.append(c)
    return counts83, counts28


def interval(pop_H, xs, blocks, counts83, counts28):
    """pop_H: hours; xs: x values aligned; blocks: 'months' or 'quarters'."""
    n = len(pop_H)
    if blocks == 'months':
        B = 83
        counts = counts83
    else:
        B = 28
        counts = counts28
    est = None
    if n > 0:
        est = fsum_list(xs) / n
    if n == 0:
        return n, est, None, None, 0, 10000
    S = [0.0] * B
    N = [0] * B
    for h, x in zip(pop_H, xs):
        j = h.mi if blocks == 'months' else h.qi
        if j is None:
            continue
        S[j] = S[j] + x
        N[j] += 1
    vals = []
    skipped = 0
    for c in counts:
        num = 0.0
        den = 0
        for cj, s, nj in zip(c, S, N):
            num = num + cj * s
            den = den + cj * nj
        if den == 0:
            skipped += 1
        else:
            vals.append(num / den)
    n_valid = 10000 - skipped
    if skipped > 500:
        return n, est, None, None, n_valid, skipped
    vals.sort()
    lo = percentile(vals, 0.025)
    hi = percentile(vals, 0.975)
    return n, est, lo, hi, n_valid, skipped


# ---------------------------------------------------------------- output helper
def write_csv(name, header, rows):
    path = os.path.join(PYDIR, name)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(','.join(header) + '\n')
        for r in rows:
            f.write(','.join(r) + '\n')


def rule_name(var):
    kind = var[0]
    if kind == 'prod':
        return 'production'
    if kind == 'ho':
        m = var[1]
        return 'handover_m' + ('1.5' if m == 1.5 else str(int(m)))
    if kind == 'half':
        return 'half_half'
    if kind == 'three':
        return 'mean_of_three'
    if kind == 'steady':
        return 'steady_always'
    return 'both_sides'


# ---------------------------------------------------------------- main
def main():
    # unit tests 1-7 do not touch data; test 8 reads the first cell of the uniform file only
    with open(PATH_U, newline='', encoding='utf-8') as f:
        rd = csv.reader(f, delimiter=',', quoting=csv.QUOTE_NONE)
        next(rd)
        first_cell = next(rd)[0]
    units = unit_tests(first_cell)
    unit_rows = [(n, c, v) for (n, c, v) in units]
    if any(v != 0 for _, _, v in unit_rows):
        print('UNIT TEST FAILURE:', [(n, v) for n, _, v in unit_rows if v != 0])
        sys.exit(2)

    # hash checks
    for path, (hx, size) in HASHES.items():
        got, n = sha256_file(path)
        if got != hx or n != size:
            print('HASH/SIZE MISMATCH', path, got, n)
            sys.exit(3)

    armL = process_arm('L', PATH_L, 4)
    armF = process_arm('F', PATH_F, 5)

    # checks.csv
    rows = [(n, '-', c, v) for n, c, v in unit_rows]
    chL = {n: (c, v) for n, c, v in armL.checks}
    chF = {n: (c, v) for n, c, v in armF.checks}
    order = [n for n, _, _ in armL.checks]
    # spec order C01..C16
    order = ['C01_rows_fields', 'C02_header', 'C03_predTs_form', 'C04_hour_grid', 'C05_numbers_parse',
             'C06_needed_nonblank', 'C07_truth_positive', 'C08_corr_of_state', 'C09_shown_recomputed',
             'C10_err_corr', 'C11_err_raw', 'C12_ratio_ge_1', 'C13_weights_range',
             'C14_unchanged_outside', 'C15_parse_margin', 'C16_blocks_cover']
    for n in order:
        rows.append((n, 'L', chL[n][0], chL[n][1]))
        rows.append((n, 'F', chF[n][0], chF[n][1]))
    write_csv('checks.csv', ['check', 'arm', 'n_checked', 'n_violations'],
              [[a, b, fint(c), fint(d)] for a, b, c, d in rows])
    stop = False
    for n, arm_, c, v in rows:
        if n.startswith('C') and n != 'C15_parse_margin' and v != 0:
            stop = True
    if stop:
        print('STOP: violation in checks; see py/checks.csv')
        for n, arm_, c, v in rows:
            if v != 0:
                print(n, arm_, c, v)
        sys.exit(4)

    # row accounting
    acc_rows = []
    for arm in (armL, armF):
        for stp, cn, rin, rd_, rl in arm.acct:
            acc_rows.append([arm.name, fint(stp), cn, fint(rin), fint(rd_), fint(rl)])
    write_csv('row_accounting.csv', ['arm', 'step', 'condition', 'rows_in', 'rows_dropped', 'rows_left'],
              acc_rows)

    # populations
    def pops_of(arm):
        H = arm.H
        U = arm.U
        P = {}
        P['scored'] = list(range(len(H)))
        P['scored_design'] = [p for p, h in enumerate(H) if h.design]
        P['scored_test'] = [p for p, h in enumerate(H) if h.test]
        P['R_design'] = [p for p, h in enumerate(H) if h.isR and h.design]
        R_test = [p for p, h in enumerate(H) if h.isR and h.test]
        P['R_test'] = R_test
        P['R_design_span_unusual'] = [p for p in P['R_design'] if H[p].span != U]
        P['R_test_span_unusual'] = [p for p in R_test if H[p].span != U]
        P['R_span_usual'] = [p for p in R_test if H[p].span == U]
        P['R_half1'] = [p for p in R_test if H[p].ts < T2023]
        P['R_half2'] = [p for p in R_test if H[p].ts >= T2023]
        P['R_eel'] = [p for p in R_test if H[p].eel]
        P['R_noneel'] = [p for p in R_test if not H[p].eel]
        for b in LOW4:
            P['R_cell_' + b] = [p for p in R_test if H[p].bin == b]
        P['R_before1008'] = [p for p in R_test if H[p].ts < T1008]
        P['R_from1008'] = [p for p in R_test if H[p].ts >= T1008]
        P['rising_high_test'] = [p for p, h in enumerate(H) if h.test and h.state == 'rising' and h.high2]
        P['falling_low_test'] = [p for p, h in enumerate(H) if h.test and h.isFL]
        P['scored_all'] = P['scored_test']
        return P

    PL = pops_of(armL)
    PF = pops_of(armF)
    pop_rows = []
    for arm, P in ((armL, PL), (armF, PF)):
        seq = [('scored', len(P['scored'])), ('scored_design', len(P['scored_design'])),
               ('scored_test', len(P['scored_test'])), ('R_design', len(P['R_design'])),
               ('R_test', len(P['R_test'])), ('R_design_span_unusual', len(P['R_design_span_unusual'])),
               ('R_test_span_unusual', len(P['R_test_span_unusual'])), ('span_usual_value', arm.U),
               ('R_test_half1', len(P['R_half1'])), ('R_test_half2', len(P['R_half2'])),
               ('R_test_eel', len(P['R_eel'])), ('R_test_noneel', len(P['R_noneel']))]
        for b in LOW4:
            seq.append(('R_test_cell_' + b, len(P['R_cell_' + b])))
        seq += [('R_test_before1008', len(P['R_before1008'])), ('R_test_from1008', len(P['R_from1008'])),
                ('rising_high_test', len(P['rising_high_test'])),
                ('falling_low_test', len(P['falling_low_test'])), ('blocks_months', 83),
                ('blocks_quarters', 28)]
        for nm, v in seq:
            pop_rows.append([arm.name, nm, fint(v)])
    write_csv('populations.csv', ['arm', 'population', 'n'], pop_rows)

    # ---------------- Step A1 (arm L)
    H = armL.H
    arr = armL.arr
    steady_er = arr[('steady',)][1]
    rgs = ['1-1.5', '1.5-2', '2-3', '3-5', '5-10', '10+', 'all']
    tables = [('all', ['all']), ('corr', ['R_larger', 'R_not_larger']), ('flowbin', list(LOW4)),
              ('spell', ['1', '2', '3', '4-6', '7-12', '13+']),
              ('ageR', ['lt1d', '1-7d', '7-30d', 'gt30d', 'blank'])]
    acc = {}
    for t, levels in tables:
        for lv in levels:
            for rg in rgs:
                acc[(t, lv, rg)] = [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    for p in PL['R_design']:
        h = H[p]
        r = h.d6 / h.thr6
        rg = ratio_group(r)
        errRaw = (h.rawF - h.truth) / h.truth * 100
        errProd = h.errP
        errSt = steady_er[p]
        levs = [('all', 'all'),
                ('corr', 'R_larger' if h.cr > h.cs else 'R_not_larger'),
                ('flowbin', h.bin),
                ('spell', spell_group(h.k)),
                ('ageR', age_group(h.age))]
        for t, lv in levs:
            for g in ((rg, 'all') if rg is not None else ('all',)):
                a = acc[(t, lv, g)]
                a[0] += 1
                a[1] = a[1] + errRaw
                a[2] = a[2] + abs(errRaw)
                a[3] = a[3] + errProd
                a[4] = a[4] + abs(errProd)
                a[5] = a[5] + errSt
                a[6] = a[6] + abs(errSt)
    a1_rows = []
    for t, levels in tables:
        for lv in levels:
            for rg in rgs:
                a = acc[(t, lv, rg)]
                n = a[0]
                cells = [t, lv, rg, fint(n)]
                for q in range(1, 7):
                    cells.append(fmt(a[q] / n) if n > 0 else '')
                a1_rows.append(cells)
    write_csv('a1_tables.csv', ['table', 'split', 'rgroup', 'n', 'mean_signed_raw', 'mean_abs_raw',
                                'mean_signed_prod', 'mean_abs_prod', 'mean_signed_steady',
                                'mean_abs_steady'], a1_rows)

    # ---------------- Step A2
    rules8 = [('prod',)] + [('ho', m) for m in MS] + [('half',), ('three',), ('steady',)]
    a2 = {}
    for var in rules8:
        er = arr[var][1]
        n = len(PL['R_design'])
        s_abs = 0.0
        s_sig = 0.0
        for p in PL['R_design']:
            s_abs = s_abs + abs(er[p])
            s_sig = s_sig + er[p]
        a2[var] = (n, s_abs / n if n > 0 else None, s_sig / n if n > 0 else None)
    cands = [('ho', m) for m in MS]
    ranked = sorted(cands, key=lambda v: (mic(fmt(a2[v][1])), v[1]))
    b1 = ranked[0]
    b2 = ranked[1]
    Pp = mic(fmt(a2[('prod',)][1]))
    mae1 = mic(fmt(a2[b1][1]))
    mae2 = mic(fmt(a2[b2][1]))
    beats = 1 if mae1 < Pp else 0
    if beats == 0:
        mstar = b1[1]
    elif b2[1] < b1[1] and (mae2 - mae1) <= 20000 and mae2 < Pp:
        mstar = b2[1]
    else:
        mstar = b1[1]
    tie_used = 1 if mstar != b1[1] else 0
    a2_rows = []
    for var in rules8:
        role = 'baseline' if var[0] == 'prod' else ('candidate' if var[0] == 'ho' else 'control')
        n, mae, ms_ = a2[var]
        rank = fint(ranked.index(var) + 1) if role == 'candidate' else ''
        a2_rows.append([rule_name(var), role, fint(n), fmt(mae), fmt(ms_), rank])
    write_csv('a2_pick.csv', ['rule', 'role', 'n', 'mae', 'mean_signed', 'mae_rank'], a2_rows)
    mstar_rows = [['m_star', fmt(mstar)], ['m_best', fmt(b1[1])], ['m_second', fmt(b2[1])],
                  ['mae_best', fmt(a2[b1][1])], ['mae_second', fmt(a2[b2][1])],
                  ['gap_best_second', fmt(a2[b2][1] - a2[b1][1])], ['tie_rule_used', fint(tie_used)],
                  ['mae_production', fmt(a2[('prod',)][1])], ['beats_production', fint(beats)]]
    write_csv('mstar.csv', ['key', 'value'], mstar_rows)
    # read back (as step B would)
    with open(os.path.join(PYDIR, 'mstar.csv'), newline='', encoding='utf-8') as f:
        rd = csv.reader(f)
        next(rd)
        mrd = {r[0]: r[1] for r in rd}
    mstar = float(mrd['m_star'])
    beats = int(mrd['beats_production'])

    # ---------------- Step B
    HO = ('ho', mstar)
    BOTH = ('both', mstar)
    shHO, erHO = arr[HO]
    shHH, erHH = arr[('half',)]
    shBO, erBO = arr[BOTH]
    shP, erP = armL.shP, armL.erP

    Rt = PL['R_test']
    popsL = {}
    popsL['R'] = Rt
    for k in ('R_half1', 'R_half2', 'R_eel', 'R_noneel'):
        popsL[k] = PL[k]
    for b in LOW4:
        popsL['R_cell_' + b] = PL['R_cell_' + b]
    popsL['R_affected'] = [p for p in Rt if shHO[p] != shP[p]]
    popsL['R_raised'] = [p for p in Rt if shHO[p] > shP[p]]
    popsL['R_lowered'] = [p for p in Rt if shHO[p] < shP[p]]
    popsL['R_before1008'] = PL['R_before1008']
    popsL['R_from1008'] = PL['R_from1008']
    popsL['R_span_usual'] = PL['R_span_usual']
    popsL['scored_all'] = PL['scored_test']
    orderL = ['R', 'R_half1', 'R_half2', 'R_eel', 'R_noneel', 'R_cell_0-3000', 'R_cell_3000-6000',
              'R_cell_6000-12000', 'R_cell_12000-25000', 'R_affected', 'R_raised', 'R_lowered',
              'R_before1008', 'R_from1008', 'R_span_usual', 'scored_all']
    mainL = {}
    main_rows = []
    for nm in orderL:
        o = meas(H, popsL[nm], shHO, erHO, shP, erP)
        mainL[nm] = o
        main_rows.append(['L', 'handover_mstar', nm] + meas_cells(o))
    # arm F
    HF = armF.H
    arrF = armF.arr
    shHOF, erHOF = arrF[HO]
    shPF, erPF = armF.shP, armF.erP
    RtF = PF['R_test']
    popsF = {'R': RtF,
             'R_affected': [p for p in RtF if shHOF[p] != shPF[p]],
             'R_span_usual': PF['R_span_usual'],
             'scored_all': PF['scored_test']}
    mainF = {}
    for nm in ['R', 'R_affected', 'R_span_usual', 'scored_all']:
        o = meas(HF, popsF[nm], shHOF, erHOF, shPF, erPF)
        mainF[nm] = o
        main_rows.append(['F', 'handover_mstar', nm] + meas_cells(o))
    write_csv('stepb_main.csv', ['arm', 'rule', 'population'] + MEAS_COLS, main_rows)

    # stepb_rules
    rules_rows = []
    for var in rules8:
        sh, er = arr[var]
        o = meas(H, Rt, sh, er, shP, erP)
        rules_rows.append([rule_name(var), 'R_test'] + meas_cells(o))
    write_csv('stepb_rules.csv', ['rule', 'population'] + MEAS_COLS, rules_rows)

    # both_sides
    B_all = [p for p, h in enumerate(H) if h.test and (h.isR or h.isFL)]
    B_eel = [p for p in B_all if H[p].eel]
    B_non = [p for p in B_all if not H[p].eel]
    B_fall = PL['falling_low_test']
    B_fe = [p for p in B_fall if H[p].eel]
    B_fn = [p for p in B_fall if not H[p].eel]
    bs_rows = []
    for nm, pp in (('B_all', B_all), ('B_eel', B_eel), ('B_noneel', B_non), ('B_falling', B_fall),
                   ('B_falling_eel', B_fe), ('B_falling_noneel', B_fn)):
        o = meas(H, pp, shBO, erBO, shP, erP)
        bs_rows.append(['both_sides', nm] + meas_cells(o))
    write_csv('both_sides.csv', ['rule', 'population'] + MEAS_COLS, bs_rows)

    # step at 25000
    rh = PL['rising_high_test']
    n_rh = len(rh)
    small = [p for p in rh if (H[p].d6 / H[p].thr6) < mstar]
    n_small = len(small)
    s_diff = 0.0
    n_chg = 0
    s_abs = 0.0
    s_pct = 0.0
    for p in small:
        h = H[p]
        s_diff = s_diff + (h.cr - h.cs)
        w = weight_up(h.d6, h.thr6, mstar)
        corr = blend(w, h.cs, h.cr)
        hyp = shown_from(h.raw, corr, h.cap)
        if hyp != h.shownP:
            n_chg += 1
        s_abs = s_abs + abs(hyp - h.shownP)
        s_pct = s_pct + abs(hyp - h.shownP) / h.truth * 100
    sa_rows = [['n_rising_high', fint(n_rh)], ['n_small_rise', fint(n_small)],
               ['mean_corrR_minus_corrS', fmt(s_diff / n_small) if n_small > 0 else ''],
               ['n_hyp_changed', fint(n_chg)],
               ['mean_abs_hyp_change_cfs', fmt(s_abs / n_small) if n_small > 0 else ''],
               ['mean_abs_hyp_change_pct', fmt(s_pct / n_small) if n_small > 0 else '']]
    write_csv('step_at_25000.csv', ['key', 'value'], sa_rows)

    # ---------------- intervals
    counts83, counts28 = load_uniforms()
    dL = [abs(erHO[p]) - abs(erP[p]) for p in range(len(H))]
    dF = [abs(erHOF[p]) - abs(erPF[p]) for p in range(len(HF))]
    dHH = [abs(erHO[p]) - abs(erHH[p]) for p in range(len(H))]

    specs = []  # (id, arm, popname, x, blocks)
    specs.append(('I01', 'L', 'R', 'd', 'months'))
    specs.append(('I02', 'L', 'R', 'd', 'quarters'))
    mid = ['scored_all', 'R_affected', 'R_half1', 'R_half2', 'R_eel', 'R_noneel', 'R_cell_0-3000',
           'R_cell_3000-6000', 'R_cell_6000-12000', 'R_cell_12000-25000', 'R_raised', 'R_lowered',
           'R_before1008', 'R_from1008']
    for q, nm in enumerate(mid):
        specs.append(('I%02d' % (3 + q), 'L', nm, 'd', 'months'))
    specs.append(('I17', 'L', 'R', 'dHH', 'months'))
    specs.append(('I18', 'L', 'R', 'dHH', 'quarters'))
    specs.append(('I19', 'L', 'R_span_usual', 'd', 'months'))
    specs.append(('I20', 'L', 'R_span_usual', 'd', 'quarters'))
    specs.append(('I21', 'F', 'R', 'd', 'months'))
    specs.append(('I22', 'F', 'R', 'd', 'quarters'))
    specs.append(('I23', 'F', 'R_span_usual', 'd', 'months'))
    specs.append(('I24', 'F', 'R_span_usual', 'd', 'quarters'))
    for q, nm in enumerate(mid):
        specs.append(('I%02d' % (25 + q), 'L', nm, 'd', 'quarters'))
    iv = {}
    iv_rows = []
    for (iid, a, nm, xk, bl) in specs:
        if a == 'L':
            Hh = H
            pp = popsL[nm]
            xarr = dHH if xk == 'dHH' else dL
        else:
            Hh = HF
            pp = popsF[nm]
            xarr = dF
        popH = [Hh[p] for p in pp]
        xs = [xarr[p] for p in pp]
        n, est, lo, hi, nv, ns = interval(popH, xs, bl, counts83, counts28)
        iv[iid] = (n, est, lo, hi, nv, ns)
        iv_rows.append([iid, a, nm, xk, bl, fint(n), fmt(est), fmt(lo), fmt(hi), fint(nv), fint(ns)])
    write_csv('intervals.csv', ['id', 'arm', 'population', 'x', 'blocks', 'n', 'est', 'lo', 'hi',
                                'n_valid', 'n_skipped'], iv_rows)

    # ---------------- decision inputs
    mR = mainL['R']
    di = []

    def add(name, s):
        di.append((name, s))

    add('m_star', fmt(mstar))
    add('beats_production', fint(beats))
    add('R_mean_d', fmt(mR['mean_d']))
    add('R_ci_lo', fmt(iv['I01'][2]))
    add('R_ci_hi', fmt(iv['I01'][3]))
    add('half1_mean_d', fmt(mainL['R_half1']['mean_d']))
    add('half2_mean_d', fmt(mainL['R_half2']['mean_d']))
    add('eel_mean_d', fmt(mainL['R_eel']['mean_d']))
    add('noneel_mean_d', fmt(mainL['R_noneel']['mean_d']))
    cell_ids = {'0-3000': 'I09', '3000-6000': 'I10', '6000-12000': 'I11', '12000-25000': 'I12'}
    for b in LOW4:
        add('cell_%s_rel' % b, fmt(mainL['R_cell_' + b]['rel_mae_diff']))
        add('cell_%s_ci_lo' % b, fmt(iv[cell_ids[b]][2]))
    mLow = mainL['R_lowered']
    add('lowered_n', fint(mLow['n']))
    add('lowered_mean_d', fmt(mLow['mean_d']))
    if mLow['n'] > 0:
        add('lowered_below15_diff', fmt(mLow['below15_rule'] - mLow['below15_prod']))
    else:
        add('lowered_below15_diff', '')
    add('R_below15_diff', fmt(mR['below15_rule'] - mR['below15_prod']) if mR['n'] > 0 else '')
    add('R_above15_diff', fmt(mR['above15_rule'] - mR['above15_prod']) if mR['n'] > 0 else '')
    add('hh_est', fmt(iv['I17'][1]))
    add('hh_ci_hi', fmt(iv['I17'][3]))
    add('F_mean_d', fmt(mainF['R']['mean_d']))
    write_csv('decision_inputs.csv', ['name', 'value'], [[a, b] for a, b in di])
    D = dict(di)

    def lt(s, t):
        v = mic(s)
        return v is not None and v < t

    def le(s, t):
        v = mic(s)
        return v is not None and v <= t

    def gt(s, t):
        v = mic(s)
        return v is not None and v > t

    crit1 = 1 if (le(D['R_mean_d'], -250000) and lt(D['R_ci_hi'], 0)) else 0
    any_fail = False
    any_unclear = False
    any_empty = False
    for b in LOW4:
        o = mainL['R_cell_' + b]
        if o['n'] == 0 or o['mae_prod'] == 0:
            any_empty = True
            continue
        above = gt(D['cell_%s_rel' % b], 20000)
        lo_s = D['cell_%s_ci_lo' % b]
        fail = above and lo_s != '' and gt(lo_s, 0)
        unclear = above and not fail
        if fail:
            any_fail = True
        if unclear:
            any_unclear = True
    crit2 = 0 if (any_fail or any_empty) else 1
    flag_unclear = 1 if any_unclear else 0
    crit3 = 1 if (lt(D['half1_mean_d'], 0) and lt(D['half2_mean_d'], 0)) else 0
    crit4 = 1 if (le(D['eel_mean_d'], 0) and le(D['noneel_mean_d'], 0)) else 0
    if mLow['n'] == 0:
        crit5 = 1
    else:
        crit5 = 1 if (le(D['lowered_mean_d'], 0) and le(D['lowered_below15_diff'], 0)) else 0
    crit6 = 1 if (le(D['R_below15_diff'], 0) and le(D['R_above15_diff'], 500000)) else 0
    crit7 = 1 if (lt(D['hh_est'], 0) and lt(D['hh_ci_hi'], 0)) else 0
    crit8 = 1 if lt(D['F_mean_d'], 0) else 0
    flag_ns = 1 if beats == 0 else 0
    lo_s, hi_s = D['R_ci_lo'], D['R_ci_hi']
    cond_a = (lo_s == '' or hi_s == '' or (mic(lo_s) <= 0 <= mic(hi_s)))
    cond_b = gt(D['R_mean_d'], -100000)
    flag_fail = 1 if (cond_a or cond_b) else 0
    if flag_ns == 1:
        verdict = 'NOT_SUPPORTED'
    elif flag_fail == 1:
        verdict = 'FAIL'
    elif crit1 and crit2 and crit3 and crit4 and crit5 and crit6 and crit7 and crit8 and flag_unclear == 0:
        verdict = 'PASS'
    elif crit1 and crit2 and crit3 and crit4 and crit5 and crit6 and crit8 and (not crit7) and flag_unclear == 0:
        verdict = 'GAIN_WITHOUT_ONSET'
    else:
        verdict = 'UNCLEAR'
    dec = [['crit1_size', fint(crit1)], ['crit2_no_harm_by_cell', fint(crit2)],
           ['crit3_stable_time', fint(crit3)], ['crit4_stable_season', fint(crit4)],
           ['crit5_lowered', fint(crit5)], ['crit6_large_errors', fint(crit6)],
           ['crit7_tied_to_rise', fint(crit7)], ['crit8_timing', fint(crit8)],
           ['flag_unclear_cell', fint(flag_unclear)], ['flag_not_supported', fint(flag_ns)],
           ['flag_fail', fint(flag_fail)], ['verdict', verdict]]
    write_csv('decision.csv', ['item', 'result'], dec)

    write_report(rows, armL, armF)
    return 0


def write_report(check_rows, armL, armF):
    lines = []
    lines.append('# REPORT (Python analyst)')
    lines.append('')
    lines.append('## What was run')
    lines.append('')
    lines.append('`python3 -I py/run_all.py` from the study folder, specification version 1.2. '
                 'Python standard library only. Input hashes and sizes of the three input files were '
                 'verified before the shadow files were read for the study.')
    lines.append('')
    lines.append('## Row counts')
    lines.append('')
    for arm in (armL, armF):
        lines.append('Arm %s: rows read %d, scored %d.' % (arm.name, arm.nrows, arm.n_scored))
    lines.append('')
    lines.append('Row accounting is in `row_accounting.csv`; all counts are in the csv files.')
    lines.append('')
    lines.append('## Judgment calls')
    lines.append('')
    for t in JUDGMENT:
        lines.append('- ' + t)
    lines.append('')
    lines.append('## Deviations from the specification')
    lines.append('')
    lines.append('None known.')
    lines.append('')
    lines.append('## Checks')
    lines.append('')
    lines.append('check,arm,n_checked,n_violations')
    for n, a, c, v in check_rows:
        lines.append('%s,%s,%d,%d' % (n, a, c, v))
    lines.append('')
    with open(os.path.join(PYDIR, 'REPORT.md'), 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(lines))


JUDGMENT = [
    'mae and mean_signed in step A2 and all error measures are on the percent error `err` (percentage points); the 0.02-point tie margin is read on that scale.',
    '`C02_header`: the header is split on commas with no quote handling; n_checked is 21.',
    '`C05` n_checked counts every non-blank value of the 15 number columns on scored hours.',
    'Checks C07 to C14 run on scored hours whose needed fields all parse and pass C06 (all scored hours when the data are clean); the filter matters only on the stop path.',
    '`C13` counts the `half_half` weight 0.5 as one tested weight per R hour without computing it from data.',
    '`C14` change set of `both_sides` is R plus scored falling hours in LOW4; every other variant changes R only.',
    '`C15` counts a (hour, variant) pair once when the error is within 1e-9 of -15 or of +15; production and the 11 variants of C14 are the 12 variants.',
    '`crit2`: "mae_prod is 0" is tested on the full-precision value; an empty cell has n = 0.',
    '`flag_fail` condition on `R_mean_d` is false when `R_mean_d` is blank (blank makes a condition false).',
    'Hours with a ratio below 1 (impossible after C12) would fall in no ratio group of A1 but still in the `all` ratio level.',
    'The first data cell of `tools/boot_uniforms.csv` is read for `unit_boot_index` before the hash check of the three inputs; shadow files are read only after the unit tests and the hash check.',
    'Production variant weights: when `thr6 <= 0` (a C12 violation, stop path only) the weight is set to 0 so the run can finish writing `checks.csv`.',
    '`REPORT.md` is generated by `run_all.py`.',
    'Unit-test failures stop the run before any file is written (no `checks.csv`).',
]

if __name__ == '__main__':
    sys.exit(main())
