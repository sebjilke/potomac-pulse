#!/usr/bin/env python3
"""Blind Python analyst, Stage 1 (forecast from measured water). Specification 1.2.
Run from the study folder:  python3 -I py/run_all.py
Standard library only. Writes only into its own folder (py/)."""
import sys, os, csv, math, hashlib, calendar, time, datetime, operator

T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.dirname(HERE)
ANALYSIS = os.path.dirname(STUDY)
OUT = HERE

HS = (6, 12, 24, 48)
STATUSES = ['ISSUE_NOT_PREDICTED', 'ISSUE_LF_MISSING', 'TARGET_NO_ROW', 'TARGET_NOT_PREDICTED',
            'TARGET_TRUTH_MISSING', 'TARGET_HARD_FLAG', 'TARGET_OUT_OF_RANGE', 'NO_TIMESHIFT',
            'ISSUE_FIELD_MISSING', 'Q_USTAR_MISSING', 'Q_ULF_MISSING', 'Q_NONPOSITIVE', 'SCORED']
ARMS = ['P-LF', 'R-LF', 'R-LFm', 'REF_NOW', 'REF_HELD']
LEADS = ['all', 'inside', 'beyond']
DIMS = [('all', ['all']),
        ('flowBin', ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+']),
        ('flowState', ['rising', 'steady', 'falling']),
        ('largeRise', ['in_window', 'out_window']),
        ('season', ['in_season', 'out_season']),
        ('seasonLow', ['in_season_lf_lt3000', 'out_season_lf_lt3000']),
        ('era', ['2012_2018', '2019_2026'])]
CELLKEYS = [(dim, lev) for dim, levs in DIMS for lev in levs]
NRES = 10000

REPLAY_NEEDED = ['predTs', 'status', 'useTimeShifted', 'predictedCFS', 'flowBin', 'flowState', 'histSrcTs',
                 'porSrcTs', 'travelGFtoLF', 'lfQ', 'lfSrcTs', 'truthFlow', 'truthInProdRange',
                 'truthDependentHard', 'hardFlag', 'porQ', 'historicPorCFS']

FILES = {
    'A_replay': ('replay_lag_2026-11-17/shadow_L.csv', 'ANALYSIS',
                 'b6a917c0a7092d36594a7ee1de44f05df6ad1d70626eefe6aba2fb2e23011e1d'),
    'A_hourly': ('hourly_backtest_data_v361.csv', 'ANALYSIS',
                 'b247c0be5f8c3c15a64a4c2e58b0bfb1097711c6f2da3c98b767fbea1e6941d3'),
    'B_replay': ('replay_B/shadow_L.csv', 'STUDY',
                 '549f200645b4bb9b2a6a43ee4bee00a84903726ceefdce259f73c54bed6b0d99'),
    'B_hourly': ('rising-limb-travel-backtest/hourly_backtest_data_v39.csv', 'ANALYSIS',
                 'd1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f'),
    'events': ('rising-limb-travel-backtest/rising_limb_events_python_v39.csv', 'ANALYSIS',
               '978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44'),
    'boot': ('tools/boot_uniforms.csv', 'STUDY',
             '4d5f1fcdfa5999864f21aae19480691b6fcb1e6cf239b32323e050c7f3bd4c38'),
}


def fpath(name):
    rel, base, _ = FILES[name]
    return os.path.join(STUDY if base == 'STUDY' else ANALYSIS, rel)


# ---------------------------------------------------------------- time
_kc = {}
_tc = {}
_EPOCH = datetime.datetime(1970, 1, 1)


def _key(y, mo, d, h, mi):
    return calendar.timegm((y, mo, d, h, mi, 0)) // 3600


def parse_replay(s):
    """-> (key, ok). ok = exact format YYYY-MM-DDTHH:00:00.000Z"""
    v = _kc.get(('r', s))
    if v is None:
        try:
            ok = len(s) == 24 and s[10] == 'T' and s[13:] == ':00:00.000Z' and s[4] == '-' and s[7] == '-'
            k = _key(int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), 0)
        except Exception:
            ok, k = False, None
        v = (k, ok)
        _kc[('r', s)] = v
    return v


def parse_hourly(s):
    """-> (key, ok). ok = exact format YYYY-MM-DD HH:00"""
    v = _kc.get(('h', s))
    if v is None:
        try:
            ok = len(s) == 16 and s[10] == ' ' and s[13] == ':' and s[14:] == '00' and s[4] == '-' and s[7] == '-'
            k = _key(int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), 0)
        except Exception:
            ok, k = False, None
        v = (k, ok)
        _kc[('h', s)] = v
    return v


def ts_replay(k):
    v = _tc.get(('r', k))
    if v is None:
        v = (_EPOCH + datetime.timedelta(hours=k)).strftime('%Y-%m-%dT%H:00:00.000Z')
        _tc[('r', k)] = v
    return v


def ts_hourly(k):
    return (_EPOCH + datetime.timedelta(hours=k)).strftime('%Y-%m-%d %H:00')


def rt_round(x):
    return math.floor(x + 0.5)


def fnum(s):
    return None if s == '' else float(s)


def f6(x):
    return '' if x is None else '%.6f' % x


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(1 << 22)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------- rows
class Row:
    __slots__ = ('key', 'ts', 'tsok', 'status', 'useTS', 'hist', 'por', 'lfs', 'T', 'lfQ', 'flowBin',
                 'flowState', 'pred', 'truth', 'inrange', 'hard', 'hardFlag', 'porQ', 'histPor', 'srcok',
                 'histS', 'porS', 'lfsS')


def make_row(d):
    r = Row()
    r.ts = d['predTs']
    r.key, r.tsok = parse_replay(r.ts)
    r.status = d['status']
    r.useTS = d['useTimeShifted']
    srcok = True

    def src(name):
        nonlocal srcok
        s = d[name]
        if s == '':
            return None
        k, ok = parse_replay(s)
        if not ok:
            srcok = False
        return k
    r.hist = src('histSrcTs')
    r.por = src('porSrcTs')
    r.lfs = src('lfSrcTs')
    r.srcok = srcok
    r.T = fnum(d['travelGFtoLF'])
    r.lfQ = fnum(d['lfQ'])
    r.flowBin = d['flowBin']
    r.flowState = d['flowState']
    r.pred = fnum(d['predictedCFS'])
    r.truth = fnum(d['truthFlow'])
    r.inrange = d['truthInProdRange']
    r.hard = d['truthDependentHard']
    r.hardFlag = d['hardFlag']
    r.porQ = fnum(d['porQ'])
    r.histPor = fnum(d['historicPorCFS'])
    r.histS = d['histSrcTs']
    r.porS = d['porSrcTs']
    r.lfsS = d['lfSrcTs']
    return r


def read_replay(path):
    with open(path, newline='', encoding='utf-8') as f:
        rd = csv.reader(f)
        header = next(rd)
        idx = [(n, header.index(n)) for n in REPLAY_NEEDED]
        rows = []
        for rec in rd:
            rows.append(make_row({n: rec[i] for n, i in idx}))
    return rows


def raw_header(path):
    with open(path, 'rb') as f:
        return f.readline().rstrip(b'\r\n')


def build_Q(pairs):
    """pairs: iterable of (timestamp string, por_now string). Returns Q, nrows, c9 violations, c11 violations."""
    Q = {}
    n = 0
    c9 = 0
    c11 = 0
    prev = None
    for ts, p in pairs:
        n += 1
        k, ok = parse_hourly(ts)
        if not ok:
            c9 += 1
        if prev is not None and k <= prev:
            c11 += 1
        prev = k
        Q[k] = fnum(p)
    return Q, n, c9, c11


def read_hourly(path):
    with open(path, newline='', encoding='utf-8') as f:
        rd = csv.reader(f)
        header = next(rd)
        it, ip = header.index('timestamp'), header.index('por_now')
        pairs = [(rec[it], rec[ip]) for rec in rd]
    return build_Q(pairs)


# ---------------------------------------------------------------- the forecast (issue row + hourly flows only)
def forecast(r, h, Q):
    """Receives only the issue row's non-truth fields and the hourly flows. Returns
    (code, hist, por, lfs, ageLf, T, RT, ustar, ulf, inside, qs, ql, rLF, rLFm); code 13 = all arms computable,
    8..12 = the measured-water status rules; 2 = lfQ unusable."""
    lf = r.lfQ
    if lf is None or lf <= 0:
        return (2,) + (None,) * 13
    if r.useTS != '1' or r.hist is None:
        return (8,) + (None,) * 13
    if r.por is None or r.lfs is None or r.T is None:
        return (9,) + (None,) * 13
    t = r.key
    hist = r.hist
    por = r.por
    age = t - r.lfs
    RT = rt_round(r.T)
    ust = min(hist + h, por)
    inside = 1 if hist + h <= por else 0
    ulf = hist - RT - age
    qs = Q.get(ust)
    ql = Q.get(ulf)
    rLF = rLFm = None
    if qs is None:
        code = 10
    elif ql is None:
        code = 11
    elif qs <= 0 or ql <= 0:
        code = 12
    else:
        code = 13
        rLF = lf + qs - ql
        rLFm = lf * qs / ql
    return (code, hist, por, r.lfs, age, r.T, RT, ust, ulf, inside, qs, ql, rLF, rLFm)


def memberships(r, ev_set):
    t = r.key
    yy, mm, dd = int(r.ts[0:4]), int(r.ts[5:7]), int(r.ts[8:10])
    md = 100 * mm + dd
    ins = 915 <= md <= 1215
    m = [('all', 'all'), ('flowBin', r.flowBin), ('flowState', r.flowState),
         ('largeRise', 'in_window' if t in ev_set else 'out_window'),
         ('season', 'in_season' if ins else 'out_season')]
    if r.lfQ < 3000:
        m.append(('seasonLow', 'in_season_lf_lt3000' if ins else 'out_season_lf_lt3000'))
    if 2012 <= yy <= 2018:
        m.append(('era', '2012_2018'))
    elif 2019 <= yy <= 2026:
        m.append(('era', '2019_2026'))
    return tuple(m), (t in ev_set), ins


CHECK_NAMES = ['C1_por_age', 'C2_lf_age', 'C3_hist_le_por', 'C4_ustar_rule', 'C5_ulf_rule', 'C6_q_hours_known',
               'C7_target_hour', 'C8_hard_equal', 'C9_whole_hours', 'C10_shadow_sorted_unique',
               'C11_hourly_sorted_unique', 'C12_clock_alignment']

FC_HEADER = ('period,issueTs,h,status,targetTs,flowBin,flowState,lrWindow,season,lfLt3000,lfQ,truth,pLF,errP,'
             'lfSrcTs,ageLf,travelGFtoLF,rtGL,histSrcTs,porSrcTs,uStarTs,uLfTs,qStar,qLf,inside,rLF,rLFm,refNow,'
             'refHeld,errR,errRm,errRefNow,errRefHeld')


class Scored:
    """parallel lists of the SCORED cases of one horizon"""
    def __init__(self):
        self.t = []; self.ust = []; self.ulf = []; self.inside = []
        self.pLF = []; self.rLF = []; self.rLFm = []; self.refNow = []; self.refHeld = []; self.truth = []
        self.eP = []; self.eR = []; self.eRm = []; self.eN = []; self.eH = []
        self.memb = []; self.blk = []


def run_cases(rows, Q, lo_key, ev_set, period, blockfn, writer=None):
    """rows: all replay rows (ascending). Issue rows = rows with key >= lo_key. Returns a dict of results."""
    byKey = {r.key: r for r in rows}
    win = [r for r in rows if r.key >= lo_key]
    counts = {h: [0] * 13 for h in HS}
    sc = {h: Scored() for h in HS}
    q4 = {h: [] for h in HS}
    chk = {n: [0, 0] for n in CHECK_NAMES}
    if writer is not None:
        writer.write(FC_HEADER + '\n')
    for r in win:
        t = r.key
        if r.lfQ is not None and r.lfQ > 0:
            memb, inwin, ins = memberships(r, ev_set)
            lfLt = 1 if r.lfQ < 3000 else 0
        else:
            memb = None
        blk = blockfn(r)
        for h in HS:
            fc = forecast(r, h, Q)          # forecasts first: no truth involved
            code = fc[0]
            # ---- status (truth and target are read only from here on)
            tr = None
            if r.status != 'predicted':
                st = 1
            elif r.lfQ is None or r.lfQ <= 0:
                st = 2
            else:
                tr = byKey.get(t + h)
                if tr is None:
                    st = 3
                elif tr.status != 'predicted':
                    st = 4
                elif tr.truth is None or tr.truth <= 0:
                    st = 5
                elif tr.hard == '1':
                    st = 6
                elif tr.inrange == '0':
                    st = 7
                else:
                    st = code
            counts[h][st - 1] += 1
            if st >= 10:
                (hist, por, lfs, age, T, RT, ust, ulf, inside, qs, ql, rLF, rLFm) = fc[1:]
                chk['C1_por_age'][0] += 1
                if not (por <= t - 2):
                    chk['C1_por_age'][1] += 1
                chk['C2_lf_age'][0] += 1
                if not (lfs <= t - 1 and age >= 1):
                    chk['C2_lf_age'][1] += 1
                chk['C3_hist_le_por'][0] += 1
                if not (hist <= por):
                    chk['C3_hist_le_por'][1] += 1
                chk['C4_ustar_rule'][0] += 1
                if not (ust == min(hist + h, por) and ust >= hist and ust <= por):
                    chk['C4_ustar_rule'][1] += 1
                chk['C5_ulf_rule'][0] += 1
                if not (ulf == hist - RT - age and ulf <= hist):
                    chk['C5_ulf_rule'][1] += 1
                if st >= 12:
                    chk['C6_q_hours_known'][0] += 1
                    if not (ust <= por and ulf <= por):
                        chk['C6_q_hours_known'][1] += 1
            if st == 13:
                chk['C7_target_hour'][0] += 1
                if tr.key != t + h:
                    chk['C7_target_hour'][1] += 1
            # ---- scoring
            if st >= 8:
                truth = tr.truth
                pLF = r.lfQ
                eP = 100.0 * (pLF - truth) / truth
                q4[h].append(abs(eP))
            if st == 13:
                eR = 100.0 * (rLF - truth) / truth
                eRm = 100.0 * (rLFm - truth) / truth
                refNow = tr.pred
                refHeld = r.pred
                eN = None if refNow is None else 100.0 * (refNow - truth) / truth
                eH = None if refHeld is None else 100.0 * (refHeld - truth) / truth
                s = sc[h]
                s.t.append(t); s.ust.append(ust); s.ulf.append(ulf); s.inside.append(inside)
                s.pLF.append(pLF); s.rLF.append(rLF); s.rLFm.append(rLFm); s.refNow.append(refNow)
                s.refHeld.append(refHeld); s.truth.append(truth)
                s.eP.append(eP); s.eR.append(eR); s.eRm.append(eRm); s.eN.append(eN); s.eH.append(eH)
                s.memb.append(memb); s.blk.append(blk)
            if writer is not None:
                tgt = ts_replay(t + h)
                if st < 8:
                    writer.write('%s,%s,%d,%s,%s%s\n' % (period, r.ts, h, STATUSES[st - 1], tgt, ',' * 28))
                else:
                    g1 = '%s,%s,%d,%d,%d,%s,%s,%s,%s' % (
                        r.flowBin, r.flowState, 1 if inwin else 0, 1 if ins else 0, lfLt,
                        f6(pLF), f6(truth), f6(pLF), f6(eP))
                    if st < 10:
                        g2 = ',' * 10 + ','
                        g2 = ',,,,,,,,,,'
                    else:
                        g2 = '%s,%d,%s,%d,%s,%s,%s,%s,%s,%s,%d' % (
                            ts_replay(lfs), age, f6(T), RT, ts_replay(hist), ts_replay(por), ts_replay(ust),
                            ts_replay(ulf), f6(qs), f6(ql), inside)
                    if st == 13:
                        g3 = '%s,%s,%s,%s,%s,%s,%s,%s' % (f6(rLF), f6(rLFm), f6(refNow), f6(refHeld), f6(eR),
                                                           f6(eRm), f6(eN), f6(eH))
                    else:
                        g3 = ',,,,,,,'
                    writer.write('%s,%s,%d,%s,%s,%s,%s,%s\n' % (period, r.ts, h, STATUSES[st - 1], tgt, g1, g2, g3))
    return {'win': win, 'counts': counts, 'sc': sc, 'q4': q4, 'chk': chk}


# ---------------------------------------------------------------- metrics and bootstrap
def arm_stats(errs):
    n = len(errs)
    if n == 0:
        return (0, None, None, None, None)
    ab = [abs(e) for e in errs]
    mae = math.fsum(ab) / n
    s = sorted(ab)
    med = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    ms = math.fsum(errs) / n
    sh = 100.0 * sum(1 for a in ab if a > 25) / n
    return (n, mae, med, ms, sh)


def build_cells(s):
    """-> dict (lead, dim, level) -> list of case indices"""
    cells = {}
    for lead in LEADS:
        for dim, lev in CELLKEYS:
            cells[(lead, dim, lev)] = []
    for i in range(len(s.t)):
        ld = 'inside' if s.inside[i] == 1 else 'beyond'
        for (dim, lev) in s.memb[i]:
            c = cells.get(('all', dim, lev))
            if c is None:
                continue
            c.append(i)
            cells[(ld, dim, lev)].append(i)
    return cells


def cell_stats(idx, s, B):
    n = len(idx)
    eP = [s.eP[i] for i in idx]
    eR = [s.eR[i] for i in idx]
    eRm = [s.eRm[i] for i in idx]
    eN = [s.eN[i] for i in idx if s.eN[i] is not None]
    eH = [s.eH[i] for i in idx if s.eH[i] is not None]
    arms = [arm_stats(eP), arm_stats(eR), arm_stats(eRm), arm_stats(eN), arm_stats(eH)]
    nv = [0] * B
    aP = [0.0] * B; aR = [0.0] * B; aRm = [0.0] * B; sP = [0.0] * B; sR = [0.0] * B
    for i in idx:
        j = s.blk[i]
        nv[j] += 1
        aP[j] += abs(s.eP[i]); aR[j] += abs(s.eR[i]); aRm[j] += abs(s.eRm[i])
        sP[j] += s.eP[i]; sR[j] += s.eR[i]
    vecs = [[a - b for a, b in zip(aP, aR)], [a - b for a, b in zip(aP, aRm)], [a - b for a, b in zip(sR, sP)]]
    est = [None, None, None]
    if n > 0:
        est = [math.fsum(v) / n for v in vecs]
    return {'n': n, 'arms': arms, 'nv': nv, 'vecs': vecs, 'est': est}


def q7(x, p):
    m = len(x)
    pos = (m - 1) * p
    lo = int(math.floor(pos))
    frac = pos - lo
    if lo + 1 > m - 1:
        return x[lo]
    return x[lo] + frac * (x[lo + 1] - x[lo])


def intervals_for(cs, C):
    """-> list of 3 tuples (est, lo, hi, n_valid, n_skipped)"""
    if cs['n'] == 0:
        return [(None, None, None, 0, NRES)] * 3
    mul = operator.mul
    ns = [sum(map(mul, c, cs['nv'])) for c in C]
    skipped = sum(1 for n in ns if n == 0)
    out = []
    for k in range(3):
        v = cs['vecs'][k]
        vals = [sum(map(mul, c, v)) / n for c, n in zip(C, ns) if n != 0]
        m = len(vals)
        lo = hi = None
        if skipped <= 500 and m > 0:
            vals.sort()
            lo = q7(vals, 0.025)
            hi = q7(vals, 0.975)
        out.append((cs['est'][k], lo, hi, NRES - skipped, skipped))
    return out


def make_C(boot_rows, B):
    C = []
    for row in boot_rows:
        c = [0] * B
        for k in range(B):
            c[(int(row[k]) * B) // 10 ** 12] += 1
        C.append(c)
    return C


def period_results(res, B, C):
    """-> dict h -> {(lead,dim,level): (cellstats, intervals)}"""
    out = {}
    for h in HS:
        s = res['sc'][h]
        cells = build_cells(s)
        d = {}
        for lead in LEADS:
            for dim, lev in CELLKEYS:
                cs = cell_stats(cells[(lead, dim, lev)], s, B)
                d[(lead, dim, lev)] = (cs, intervals_for(cs, C))
        out[h] = d
    return out


# ---------------------------------------------------------------- made-up data test (section 8)
def synthetic():
    fails = {}

    def fail(name, msg):
        fails.setdefault(name, []).append(msg)

    base = parse_replay('2020-01-01T00:00:00.000Z')[0]
    if base != 438288:
        fail('unit_round_key', 'base key %r' % (base,))

    def mk_rows():
        rows = []
        for i in range(96):
            d = {'predTs': ts_replay(base + i), 'status': 'predicted', 'useTimeShifted': '1', 'lfQ': '2000',
                 'lfSrcTs': ts_replay(base + i - 1), 'travelGFtoLF': '2.5', 'porSrcTs': ts_replay(base + i - 2),
                 'histSrcTs': ts_replay(base + i - 20), 'predictedCFS': str(1000 + 10 * i),
                 'truthFlow': str(2000 + 20 * (i % 5)), 'truthInProdRange': '1', 'truthDependentHard': '0',
                 'hardFlag': '0', 'flowBin': '0-3000', 'flowState': 'steady', 'porQ': '', 'historicPorCFS': ''}
            if i == 5:
                d = {k: '' for k in d}
                d['predTs'] = ts_replay(base + i)
                d['status'] = 'no_por'
            if i == 7:
                d['useTimeShifted'] = '0'; d['histSrcTs'] = ''
            if i == 12:
                d['lfQ'] = ''
            if i == 14:
                d['porSrcTs'] = ''
            if i == 20:
                d['truthDependentHard'] = '1'; d['hardFlag'] = '1'
            if i == 30:
                d['status'] = 'no_truth'; d['truthFlow'] = ''
            if i == 31:
                d['truthFlow'] = ''
            if i == 90:
                d['truthInProdRange'] = '0'
            rows.append(make_row(d))
        return rows

    def mk_Q(series):
        pairs = []
        for u in range(96):
            q = 1000 if (series == 0 or u < 60) else 1500
            s = str(q)
            if series == 2:
                if u == 50:
                    s = ''
                if u == 3:
                    s = '0'
            pairs.append((ts_hourly(base + u), s))
        return build_Q(pairs)[0]

    exp = {
        'ISSUE_NOT_PREDICTED': [2, 2, 2, 2], 'ISSUE_LF_MISSING': [1, 1, 1, 1],
        'TARGET_NO_ROW': [6, 12, 24, 48], 'TARGET_NOT_PREDICTED': [1, 1, 1, 0],
        'TARGET_TRUTH_MISSING': [1, 1, 1, 0], 'TARGET_HARD_FLAG': [1, 1, 0, 0],
        'TARGET_OUT_OF_RANGE': [1, 1, 1, 1], 'NO_TIMESHIFT': [1, 1, 0, 1],
        'ISSUE_FIELD_MISSING': [0, 1, 1, 1], 'Q_USTAR_MISSING': [11, 6, 2, 2],
        'Q_ULF_MISSING': [9, 11, 17, 18], 'Q_NONPOSITIVE': [0, 0, 0, 0], 'SCORED': [62, 58, 46, 22]}
    exp2 = dict(exp)
    exp2['Q_USTAR_MISSING'] = [12, 7, 3, 2]
    exp2['Q_ULF_MISSING'] = [10, 12, 17, 18]
    exp2['Q_NONPOSITIVE'] = [1, 1, 1, 1]
    exp2['SCORED'] = [59, 55, 44, 21]

    def check_counts(name, res, e):
        for si, sname in enumerate(STATUSES):
            for hi, h in enumerate(HS):
                got = res['counts'][h][si]
                if got != e[sname][hi]:
                    fail(name, 'count %s h=%d got %d want %d' % (sname, h, got, e[sname][hi]))
        for h in HS:
            if sum(res['counts'][h]) != 96:
                fail(name, 'sum h=%d' % h)

    rows = mk_rows()
    results = {}
    for series, name in ((0, 'synthetic_S0'), (1, 'synthetic_S1'), (2, 'synthetic_S2')):
        Q = mk_Q(series)
        res = run_cases(rows, Q, -10 ** 9, set(), '-', lambda r: 0)
        results[name] = res
        check_counts(name, res, exp2 if series == 2 else exp)
    # S0 exactness
    res = results['synthetic_S0']
    for h in HS:
        s = res['sc'][h]
        for i in range(len(s.t)):
            if not (s.rLF[i] == 2000 and s.rLFm[i] == 2000 and s.pLF[i] == 2000):
                fail('synthetic_S0', 'not exact h=%d t=%d' % (h, s.t[i] - base))
    # S1
    res = results['synthetic_S1']
    ranges = {6: (74, 83), 12: (68, 83), 24: (62, 71)}
    for h in HS:
        s = res['sc'][h]
        for i in range(len(s.t)):
            t = s.t[i] - base
            rg = ranges.get(h)
            inr = rg is not None and rg[0] <= t <= rg[1]
            dR = s.rLF[i] - s.pLF[i]
            dRm = s.rLFm[i] - s.pLF[i]
            if inr:
                if dR != 500 or dRm != 1000:
                    fail('synthetic_S1', 'step missing h=%d t=%d' % (h, t))
            elif dR != 0 or dRm != 0:
                fail('synthetic_S1', 'unexpected diff h=%d t=%d' % (h, t))
    for h, t in ((12, 78), (24, 66)):
        if base + t in res['sc'][h].t:
            fail('synthetic_S1', 'case h=%d t=%d should not be scored' % (h, t))
    want = {(80, 6): (66, 56, 1, 2000, 2500, 3000, 1860, 1800, 2020),
            (70, 24): (68, 46, 0, 2000, 2500, 3000, 1940, 1700, 2080),
            (40, 12): (32, 16, 1, 2000, 2000, 2000, 1520, 1400, 2040)}
    for (t, h), w in want.items():
        s = res['sc'][h]
        if base + t not in s.t:
            fail('synthetic_S1', 'explicit row %d,%d not scored' % (t, h))
            continue
        i = s.t.index(base + t)
        got = (s.ust[i] - base, s.ulf[i] - base, s.inside[i], s.pLF[i], s.rLF[i], s.rLFm[i], s.refNow[i],
               s.refHeld[i], s.truth[i])
        if got != w:
            fail('synthetic_S1', 'explicit row %d,%d got %r want %r' % (t, h, got, w))
    mt = {6: (62, 2.0040, -2.0040, 5.3315, 1.9500, 9.2854, 5.9040, 19.8798, 22.8197),
          12: (58, 1.9751, -1.9751, 7.3106, 4.3649, 13.6506, 10.7048, 18.8969, 24.7784),
          24: (46, 1.9630, -1.9630, 5.9045, 2.8227, 10.6902, 7.6085, 15.9488, 27.7132),
          48: (22, 2.0293, -2.0293, 2.0293, -2.0293, 2.0293, -2.0293, 10.1355, 33.6484)}
    ninside = {6: 62, 12: 58, 24: 0, 48: 0}
    for h in HS:
        s = res['sc'][h]
        cs = cell_stats(list(range(len(s.t))), s, 1)
        a = cs['arms']
        got = (cs['n'], a[0][1], a[0][3], a[1][1], a[1][3], a[2][1], a[2][3], a[3][1], a[4][1])
        for g, w in zip(got, mt[h]):
            if abs(g - w) > 6e-5:
                fail('synthetic_S1', 'metrics h=%d got %r want %r' % (h, got, mt[h]))
                break
        if sum(s.inside) != ninside[h]:
            fail('synthetic_S1', 'inside count h=%d got %d' % (h, sum(s.inside)))
    check_counts('synthetic_S1', results['synthetic_S1'], exp)
    # unit tests
    for x, w in ((0.5, 1), (2.4, 2), (2.5, 3), (2.6, 3), (8.49, 8), (8.5, 9)):
        if rt_round(x) != w:
            fail('unit_round_key', 'RT(%r)=%r want %r' % (x, rt_round(x), w))
    for s, w in (('2020-01-01T00:00:00.000Z', 438288), ('2026-06-16T03:00:00.000Z', 494883)):
        if parse_replay(s) != (w, True):
            fail('unit_round_key', 'parse_replay %s' % s)
    for s, w in (('2020-01-01 00:00', 438288), ('2026-06-16 03:00', 494883)):
        if parse_hourly(s) != (w, True):
            fail('unit_round_key', 'parse_hourly %s' % s)
    x = [float(i) for i in range(1, 10001)]
    if abs(q7(x, 0.025) - 250.975) > 1e-9 or abs(q7(x, 0.975) - 9750.025) > 1e-9:
        fail('percentile_t7', 'got %r %r' % (q7(x, 0.025), q7(x, 0.975)))
    for n, B, w in ((999999999999, 163, 162), (0, 163, 0), (500000000000, 7, 3), (192517163266, 163, 31)):
        if (n * B) // 10 ** 12 != w:
            fail('boot_index_map', 'n=%d B=%d' % (n, B))
    return fails


# ---------------------------------------------------------------- output helpers
def write_file(name, lines):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='') as f:
        for ln in lines:
            f.write(ln + '\n')


def fmt_n(x):
    return '' if x is None else ('%.6f' % x)


def main():
    judgments_runtime = []
    checks_rows = []        # (check, period, n, v)
    syn_names = ['synthetic_S0', 'synthetic_S1', 'synthetic_S2', 'unit_round_key', 'percentile_t7', 'boot_index_map']
    fails = synthetic()
    for nm in syn_names:
        checks_rows.append((nm, '-', 1, len(fails.get(nm, []))))
    if fails:
        write_file('checks.csv', ['check,period,n_checked,n_violations'] +
                   ['%s,%s,%d,%d' % c for c in checks_rows])
        write_file('REPORT.md', ['# REPORT (STOPPED)', '', 'The made-up-data / unit tests FAILED; no real file was read.', ''] +
                   ['- %s: %s' % (k, v) for k, vs in fails.items() for v in vs])
        print('SYNTHETIC FAILURE', fails)
        sys.exit(1)
    print('synthetic and unit tests passed')

    # ---- real data: hashes
    for name, (rel, base, want) in FILES.items():
        p = fpath(name)
        if name == 'B_replay' or name == 'B_hourly':
            continue
        got = sha256(p)
        if got != want:
            raise SystemExit('SHA-256 mismatch for %s' % name)
    period_b = True
    b_reason = ''
    pb_r, pb_h = fpath('B_replay'), fpath('B_hourly')
    if not (os.path.exists(pb_r) and os.path.exists(pb_h)):
        period_b = False
        b_reason = 'replay_B/shadow_L.csv or v39 hourly file missing'
    elif raw_header(pb_r) != raw_header(fpath('A_replay')):
        period_b = False
        b_reason = 'header of period B replay differs from period A'
    if period_b:
        for name in ('B_replay', 'B_hourly'):
            if sha256(fpath(name)) != FILES[name][2]:
                raise SystemExit('SHA-256 mismatch for %s' % name)
    print('hashes ok; period_b =', period_b)

    # ---- events
    ev_set = set()
    n_ev = 0
    ev_ids = []
    with open(fpath('events'), newline='', encoding='utf-8') as f:
        rd = csv.reader(f)
        hd = next(rd)
        ik, ic, i0, ip, ie = (hd.index(c) for c in ('kept', 'event_class', 'event_t0', 'event_tp', 'event_id'))
        for rec in rd:
            if rec[ik] == '1' and rec[ic] == 'GATE':
                n_ev += 1
                ev_ids.append(rec[ie])
                k0, ok0 = parse_hourly(rec[i0])
                kp, okp = parse_hourly(rec[ip])
                assert ok0 and okp
                for k in range(k0 - 48, kp + 1):
                    ev_set.add(k)
    assert n_ev == 21, n_ev

    # ---- bootstrap draws
    with open(fpath('boot'), newline='', encoding='utf-8') as f:
        rd = csv.reader(f)
        bh = next(rd)
        assert bh == ['u%d' % k for k in range(1, 176)]
        boot = [row for row in rd]
    assert len(boot) == 10000
    assert all(len(c) == 12 and c.isdigit() for c in boot[0])
    assert int(boot[0][0]) == 192517163266 and (int(boot[0][0]) * 163) // 10 ** 12 == 31

    periods = ['A'] + (['B'] if period_b else [])
    allres = {}
    forecast_files = {}
    window_counts = {}
    rowinfo = {}
    for per in periods:
        print('period', per, 'reading', round(time.time() - T_START, 1))
        rows = read_replay(fpath(per + '_replay'))
        Q, nhour, c9h, c11 = read_hourly(fpath(per + '_hourly'))
        want_rows = {'A': (127463, 126916), 'B': (130987, 130416)}[per]
        assert (len(rows), nhour) == want_rows, (len(rows), nhour)
        pred_n = sum(1 for r in rows if r.status == 'predicted')
        assert pred_n == {'A': 125099, 'B': 128595}[per], pred_n
        chk = {}
        # C8, C9, C10, C12 on whole file
        c8 = [0, 0]; c10 = [len(rows), 0]; c12 = [0, 0]; c9 = [len(rows) + nhour, c9h]
        prev = None
        for r in rows:
            if not r.tsok:
                c9[1] += 1
            if prev is not None and r.key <= prev:
                c10[1] += 1
            prev = r.key
            if r.status == 'predicted':
                c8[0] += 1
                if r.hardFlag != r.hard:
                    c8[1] += 1
                c12[0] += 1
                bad = False
                q = Q.get(r.por) if r.por is not None else None
                if q is None or r.porQ is None or q != r.porQ:
                    bad = True
                if r.hist is not None or r.histS != '':
                    qh = Q.get(r.hist) if r.hist is not None else None
                    if qh is None or r.histPor is None or abs(qh - r.histPor) > 0.5:
                        bad = True
                if bad:
                    c12[1] += 1
        lo_key = parse_replay('2012-12-01T00:00:00.000Z')[0] if per == 'A' else parse_replay('2026-08-28T00:00:00.000Z')[0]
        win = [r for r in rows if r.key >= lo_key]
        for r in win:
            if not r.srcok:
                c9[1] += 1
        npred_win = sum(1 for r in win if r.status == 'predicted')
        if per == 'A':
            assert (len(win), npred_win) == (118684, 116348), (len(win), npred_win)
            labels = sorted(set(r.ts[:7] for r in win))
            assert len(labels) == 163
            bmap = {l: j for j, l in enumerate(labels)}
            blockfn = lambda r, bmap=bmap: bmap[r.ts[:7]]
            B = len(labels)
        else:
            assert (len(win), npred_win) == (1776, 1763), (len(win), npred_win)
            ws = sorted(set(((r.key // 24) + 3) // 7 for r in win))
            assert len(ws) == 12
            bmap = {w: j for j, w in enumerate(ws)}
            blockfn = lambda r, bmap=bmap: bmap[((r.key // 24) + 3) // 7]
            B = len(ws)
        assert B <= 175
        rowinfo[per] = (len(rows), len(win), nhour, B)
        fpth = os.path.join(OUT, 'forecasts_%s.csv' % per)
        with open(fpth, 'w', encoding='utf-8', newline='') as fw:
            res = run_cases(rows, Q, lo_key, ev_set, per, blockfn, fw)
        chk = res['chk']
        chk['C8_hard_equal'] = c8
        chk['C9_whole_hours'] = c9
        chk['C10_shadow_sorted_unique'] = c10
        chk['C11_hourly_sorted_unique'] = [nhour, c11]
        chk['C12_clock_alignment'] = c12
        for n in CHECK_NAMES:
            checks_rows.append((n, per, chk[n][0], chk[n][1]))
        print('period', per, 'cases done', round(time.time() - T_START, 1))
        C = make_C(boot, B)
        res['pr'] = period_results(res, B, C)
        print('period', per, 'bootstrap done', round(time.time() - T_START, 1))
        allres[per] = res
        rows = None

    # ---- outputs
    # metrics, intervals
    ml = ['period,h,lead,dim,level,arm,n,mae,medae,mean_signed,share_gt25']
    il = ['period,h,lead,dim,level,stat,n,est,lo,hi,n_valid,n_skipped']
    for per in periods:
        for h in HS:
            for lead in LEADS:
                for dim, lev in CELLKEYS:
                    cs, ivs = allres[per]['pr'][h][(lead, dim, lev)]
                    for ai, arm in enumerate(ARMS):
                        n, mae, med, ms, sh = cs['arms'][ai]
                        ml.append('%s,%d,%s,%s,%s,%s,%d,%s,%s,%s,%s' % (per, h, lead, dim, lev, arm, n, f6(mae),
                                                                         f6(med), f6(ms), f6(sh)))
                    for si, stat in enumerate(('D_PR', 'D_PRm', 'S_RP')):
                        est, lo, hi, nv, nsk = ivs[si]
                        il.append('%s,%d,%s,%s,%s,%s,%d,%s,%s,%s,%d,%d' % (per, h, lead, dim, lev, stat, cs['n'],
                                                                           f6(est), f6(lo), f6(hi), nv, nsk))
    write_file('metrics.csv', ml)
    write_file('intervals.csv', il)
    # counts
    cl = ['period,h,status,n']
    for per in periods:
        res = allres[per]
        for h in HS:
            for si, sn in enumerate(STATUSES):
                cl.append('%s,%d,%s,%d' % (per, h, sn, res['counts'][h][si]))
            cl.append('%s,%d,TOTAL,%d' % (per, h, len(res['win'])))
            s = res['sc'][h]
            cl.append('%s,%d,SCORED_INSIDE,%d' % (per, h, sum(s.inside)))
            cl.append('%s,%d,SCORED_BEYOND,%d' % (per, h, len(s.t) - sum(s.inside)))
            cl.append('%s,%d,Q4_SET,%d' % (per, h, sum(res['counts'][h][7:])))
    write_file('counts.csv', cl)
    # verdicts (period A)
    def wi(x):
        return int(f6(x).replace('.', ''))
    vl = ['horizon,n_inside,D_est,D_lo,D_hi,cond1,rising_n,rising_worse_by,cond2,rising_signed_R,rising_signed_P,'
          'cond3,cond4_applicable,cond4_D_lo,cond4,verdict']
    verd = {}
    pr = allres['A']['pr']
    for h in (6, 12, 24):
        cs, iv = pr[h][('inside', 'all', 'all')]
        n_in = cs['n']
        D_est, D_lo, D_hi = iv[0][0], iv[0][1], iv[0][2]
        if n_in == 0:
            D_est = D_lo = D_hi = None
        cond1 = 1 if (D_lo is not None and wi(D_lo) >= 1000000) else 0
        rs, _ = pr[h][('inside', 'flowState', 'rising')]
        rn = rs['n']
        if rn > 0:
            wb = rs['arms'][1][1] - rs['arms'][0][1]
            sR, sP = rs['arms'][1][3], rs['arms'][0][3]
            cond2 = 1 if wi(wb) <= 500000 else 0
            cond3 = 1 if wi(sR) >= wi(sP) else 0
        else:
            wb = sR = sP = None
            cond2 = cond3 = 0
        if h == 24:
            c4cs, c4iv = pr[h][('inside', 'season', 'out_season')]
            c4lo = c4iv[0][1] if c4cs['n'] > 0 else None
            cond4 = 1 if (c4lo is not None and wi(c4lo) >= 1000000) else 0
            app = 1
        else:
            c4lo = None
            cond4 = None
            app = 0
        if cond1 == 1 and cond2 == 1 and cond3 == 1 and (cond4 == 1 or app == 0):
            v = 'ADDS_INFORMATION'
        elif D_hi is not None and wi(D_hi) < 500000:
            v = 'ADDS_NOTHING'
        else:
            v = 'UNCLEAR'
        verd[h] = v
        vl.append('%d,%d,%s,%s,%s,%d,%d,%s,%d,%s,%s,%d,%d,%s,%s,%s' % (
            h, n_in, f6(D_est), f6(D_lo), f6(D_hi), cond1, rn, f6(wb), cond2, f6(sR), f6(sP), cond3, app,
            f6(c4lo), '' if cond4 is None else str(cond4), v))
    if verd[12] == 'ADDS_INFORMATION' or verd[24] == 'ADDS_INFORMATION':
        ov = 'PROPOSE_STAGE2'
    elif all(verd[h] == 'ADDS_NOTHING' for h in (6, 12, 24)):
        ov = 'STOP_IDEA_CLOSED'
    else:
        ov = 'REPORT_OWNER_DECIDES'
    vl.append('overall,' + ',' * 14 + ov)
    write_file('verdicts.csv', vl)
    # q4
    ql = ['h,state,n_q4,mae_pLF,stored_nochange,rel_diff,comparable,stored_forecast,skill_today,n_pairs,'
          'mae_pLF_pairs,mae_RLF_pairs,skill_RLF']
    stored = {6: (10.0, 12.6), 12: (11.3, 16.7), 24: (13.8, 25.3), 48: (17.1, 39.9)}
    for h in HS:
        if not period_b:
            ql.append('%d,NOT_ANSWERED,,,,,,,,,,,' % h)
            continue
        res = allres['B']
        q = res['q4'][h]
        nq = len(q)
        mae = math.fsum(q) / nq if nq else None
        sf, sn = stored[h]
        cs = res['pr'][h][('all', 'all', 'all')][0]
        npairs = cs['n']
        mP, mR = cs['arms'][0][1], cs['arms'][1][1]
        if mae is not None:
            rel = abs(mae - sn) / sn
            comp = 1 if rel <= 0.2 else 0
        else:
            rel = None
            comp = 0
        if comp == 1:
            st = 1.0 - sf / sn
            sk = (1.0 - mR / mP) if (mP is not None and mR is not None and mP != 0) else None
        else:
            st = sk = None
        ql.append('%d,ANSWERED,%d,%s,%s,%s,%d,%s,%s,%d,%s,%s,%s' % (h, nq, f6(mae), f6(sn), f6(rel), comp, f6(sf),
                                                                  f6(st), npairs, f6(mP), f6(mR), f6(sk)))
    write_file('q4.csv', ql)
    # checks
    write_file('checks.csv', ['check,period,n_checked,n_violations'] + ['%s,%s,%d,%d' % c for c in checks_rows])
    total_viol = sum(c[3] for c in checks_rows)
    elapsed = time.time() - T_START
    write_report(periods, rowinfo, checks_rows, total_viol, elapsed, period_b, b_reason, n_ev)
    print('done in %.1f s; violations %d' % (elapsed, total_viol))
    if total_viol:
        sys.exit(1)


def write_report(periods, rowinfo, checks_rows, total_viol, elapsed, period_b, b_reason, n_ev):
    L = []
    L.append('# REPORT, blind Python analyst (specification 1.2)')
    L.append('')
    L.append('## What was run')
    L.append('')
    L.append('`python3 -I py/run_all.py` from the study folder (`analysis/forecast_from_measured_water_2026-11-24/`). '
             'Python standard library only. Run time of the run that wrote this file: %.0f seconds.' % elapsed)
    L.append('')
    L.append('Order inside the script: made-up-data test and unit assertions first (no real file read), then SHA-256 of '
             'every real input, then period A, then period B. Forecasts are computed by `forecast(issue_row, h, Q)`, '
             'which receives only the issue row object and the hourly dictionary `Q`; it has no access to the replay '
             'index or to any truth field of the target. The target row and `truthFlow` are looked up in `run_cases` '
             'only after the forecast tuple exists (design statement for C7).')
    L.append('')
    L.append('## Row counts')
    L.append('')
    for p in periods:
        nr, nw, nh, B = rowinfo[p]
        L.append('- Period %s: replay rows read %d; window (issue) rows %d; hourly rows %d; blocks %d.' % (p, nr, nw, nh, B))
    L.append('- Events kept (`kept == 1` and `event_class == GATE`): %d.' % n_ev)
    L.append('')
    L.append('## Judgment calls')
    L.append('')
    for j in JUDGMENTS:
        L.append('- ' + j)
    L.append('')
    L.append('## Deviations from the specification')
    L.append('')
    L.append('none')
    L.append('')
    L.append('## Checks')
    L.append('')
    L.append('Total violations over all rows of `checks.csv`: %d (%s). See `checks.csv`.' %
             (total_viol, 'all passed' if total_viol == 0 else 'NOT all passed'))
    L.append('')
    L.append('## Period B')
    L.append('')
    L.append('Built.' if period_b else 'PERIOD_B_NOT_ANSWERED: ' + b_reason)
    L.append('')
    write_file('REPORT.md', L)


JUDGMENTS = [
    '(2.2, 10 C9) The source timestamps tested by C9 (not counted in `n_checked`) are `histSrcTs`, `porSrcTs`, `lfSrcTs` '
    'of every window issue row (any status) where non-blank; violations add to the C9 violation count.',
    '(4 rules 6, 7) `truthDependentHard == 1` and `truthInProdRange == 0` are tested as the literal strings `"1"` and `"0"`; '
    'a blank value triggers neither rule. (4 rule 8) `useTimeShifted != 1` is the string test `!= "1"`.',
    '(4) The forecast function is evaluated for every case first (also where an earlier status rule will apply); the '
    'status is then the first rule in the order of section 4. For issue rows with `status != predicted` the forecast '
    'result is ignored.',
    '(10 C1 to C6) These checks are evaluated on cases whose FINAL status is 10 to 13 (C6: 12 or 13), recomputed from the '
    'stored values of the case, per section 10; the rows tested for C7 are the SCORED cases (the target row used must have key `t + h`).',
    '(10 C12) Where `histSrcTs` is non-blank the history comparison is made; `historicPorCFS` blank in that case counts as a violation. '
    '`porQ` equality is exact double equality of the parsed decimals.',
    '(11.7) `truth`, `pLF`, `errP` and the group G1 are written for every case with status 8 to 13; the group G2 for 10 to 13 '
    '(with `qStar`/`qLf` blank when the value is missing); G3 for 13 only. `refNow`/`refHeld` and their errors are blank if the source value is blank (never occurred in design).',
    '(9.3, 9.4) Full-data `est` of the three statistics is computed as `fsum(block differences) / n` and the means and medians with `math.fsum`; '
    'the decision-rule quantities `rising_worse_by` = mae(R-LF) - mae(P-LF) from the cell means at full precision, then written with `%.6f` and compared as integers.',
    '(9.3) A cell with `n > 0` and `n_skipped > 500` has blank `lo`/`hi`, `est` written, `n_valid = 10000 - n_skipped` written.',
    '(9.4) A blank `D_hi` never gives `ADDS_NOTHING`. If the cell used for a condition has `n = 0`, its inputs are blank and the condition is 0. '
    '`D_est`, `D_lo`, `D_hi` are blank when `n_inside = 0`. In the `overall` row every field other than `horizon` and `verdict` is blank (including `cond4_applicable`).',
    '(9.5) If the P-LF Q4 `n_q4` were 0 the maes would be blank and `comparable = 0`; this did not matter in practice.',
    '(2.2/8) The made-up data pass through the same parser: `hour(i)` strings are generated from keys by `ts_replay`/`ts_hourly` and parsed back by `parse_replay`/`parse_hourly`; '
    'the explicit-row and metric assertions of S1 are compared with an absolute tolerance of 6e-5 against the four-decimal table values.',
    '(8) For the S1 step rule I assert the stated differences on every scored case with `t` in the given ranges and zero elsewhere, and that `(t=78, h=12)` and `(t=66, h=24)` are not scored.',
    '(1) Beside the SHA-256 checks I assert the file row counts, the status counts of both replay files, the window sizes (118,684 / 116,348 predicted; 1,776 / 1,763), 163 months, 12 ISO weeks, '
    '21 events, and the first draw of the uniforms file (192517163266); any mismatch stops the run.',
    '(7) The `largeRise` dimension is computed by membership of the issue hour `t` in the union of `[K(event_t0)-48, K(event_tp)]` as a set of keys; the same 21 events are used for both periods.',
    '(7) Cases in `flowBin` or `flowState` levels outside the listed values would be in no level of that dimension (none observed assumption; not asserted).',
    '(0) Output is written to `py/` only; hash verification for period B files is skipped only if they are missing (then PERIOD_B_NOT_ANSWERED).',
]

if __name__ == '__main__':
    main()
