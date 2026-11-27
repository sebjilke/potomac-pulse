#!/usr/bin/env python3
# Clock study, Python analyst. Implements ANALYSIS_SPEC.md version 1.2.
# Run from the study folder:  python3 -I py/run_all.py
import sys, os, hashlib, csv, math, re, time

T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.dirname(HERE)
OUT = HERE

P_HOURLY = os.path.join(STUDY, '..', 'rising-limb-travel-backtest', 'hourly_backtest_data_v39.csv')
P_RISE = os.path.join(STUDY, '..', 'rising-limb-travel-backtest', 'rising_limb_events_python_v39.csv')
P_REPLAY = os.path.join(STUDY, '..', 'onset_correction_2026-11-25', 'replay_L', 'shadow_L.csv')
P_DR = os.path.join(STUDY, 'data', 'difficult_run_hourly.csv')
SHA = {
    'hourly': ('d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f', 10133893),
    'rise': ('978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44', 24205),
    'replay': ('dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba', 109952178),
}
DR_SHA = 'fc35a7fc5440823b04cfb287e52d212cc48eef6e7b69489ec8901f1cea17f4e0'
DR_SIZE = 2879671

K0 = 367421
K1 = 498407
NREC = K1 - K0 + 1


def log(*a):
    print('[%6.1fs]' % (time.time() - T_START), *a, flush=True)


# ---------------------------------------------------------------- 2.1 time
def dfc(Y, M, D):
    y = Y - (1 if M <= 2 else 0)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (M + (-3 if M > 2 else 9)) + 2) // 5 + D - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def key_of(s):
    return dfc(int(s[0:4]), int(s[5:7]), int(s[8:10])) * 24 + int(s[11:13])


def wk(h):
    return ((h // 24) + 3) // 7


def ws(w):
    return (7 * w - 3) * 24


# ---------------------------------------------------------------- format
def f6(x):
    if x is None:
        return ''
    s = '%.6f' % x
    if s == '-0.000000':
        s = '0.000000'
    return s


def fi(x):
    return '' if x is None else str(int(x))


def mic(s):
    if s == '' or s is None:
        return None
    return int(s.replace('.', ''))


# ---------------------------------------------------------------- 3.1 stats
def median(v):
    x = sorted(v)
    n = len(x)
    if n == 0:
        return None
    if n % 2 == 1:
        return x[(n - 1) // 2]
    return (x[n // 2 - 1] + x[n // 2]) / 2.0


def percentile(v, p):
    x = sorted(v)
    m = len(x)
    if m == 0:
        return None
    pos = (m - 1) * p
    i = int(math.floor(pos))
    frac = pos - i
    if i + 1 > m - 1:
        return x[i]
    return x[i] + frac * (x[i + 1] - x[i])


def pearson(xs, ys):
    n = len(xs)
    if n == 0:
        return None
    sx = 0.0
    for x in xs:
        sx = sx + x
    sy = 0.0
    for y in ys:
        sy = sy + y
    mx = sx / n
    my = sy / n
    sxx = 0.0
    syy = 0.0
    sxy = 0.0
    for x, y in zip(xs, ys):
        dx = x - mx
        dy = y - my
        sxx = sxx + dx * dx
        syy = syy + dy * dy
        sxy = sxy + dx * dy
    if sxx <= 0.0 or syy <= 0.0:
        return None
    return sxy / math.sqrt(sxx * syy)


def parab_delta(rm, r0, rp):
    den = (rm - 2.0 * r0) + rp
    if den == 0.0:
        d = 0.0
    else:
        d = (0.5 * (rm - rp)) / den
    return max(-0.5, min(0.5, d))


GATES = (0.4, 0.5, 0.6, 0.7)


def gate_flags(r):
    return [1 if r >= g else 0 for g in GATES]


# ---------------------------------------------------------------- series
class Ser(object):
    __slots__ = ('base', 'arr', '_ch')

    def __init__(self, base, arr):
        self.base = base
        self.arr = arr
        self._ch = None

    def get(self, h):
        i = h - self.base
        if i < 0 or i >= len(self.arr):
            return None
        return self.arr[i]

    def ch(self):
        if self._ch is None:
            a = self.arr
            c = [None] * len(a)
            for i in range(1, len(a)):
                x = a[i]
                y = a[i - 1]
                if x is not None and y is not None:
                    c[i] = x - y
            self._ch = Ser(self.base, c)
        return self._ch


def XC(up, down, a, b, smin, smax):
    dc = down.ch()
    uc = up.ch()
    da = dc.arr
    dbase = dc.base
    nda = len(da)
    ua = uc.arr
    ubase = uc.base
    nua = len(ua)
    ts = []
    cds = []
    for t in range(a + 1, b + 1):
        i = t - dbase
        if 0 <= i < nda:
            v = da[i]
            if v is not None:
                ts.append(t)
                cds.append(v)
    rs = {}
    ns = {}
    for s in range(smin, smax + 1):
        xs = []
        ys = []
        off = s + ubase
        for t, cd in zip(ts, cds):
            j = t - off
            if 0 <= j < nua:
                u = ua[j]
                if u is not None:
                    xs.append(u)
                    ys.append(cd)
        n = len(xs)
        if n >= 24:
            r = pearson(xs, ys)
            if r is not None:
                rs[s] = r
                ns[s] = n
    res = {'status': None, 'sb': None, 'n': None, 'r': None, 'delta': None, 'lag': None,
           'g': None, 'rs': rs, 'n_elig': len(rs), 'tie': False}
    if not rs:
        res['status'] = 'no_eligible'
        return res
    best = None
    for s in range(smin, smax + 1):
        if s in rs:
            if best is None or rs[s] > rs[best]:
                best = s
    if len(rs) >= 2:
        top = sorted(rs.values(), reverse=True)
        res['tie'] = (top[0] - top[1]) < 1e-12
    sb = best
    res['sb'] = sb
    res['n'] = ns[sb]
    res['r'] = rs[sb]
    if sb == smin or sb == smax:
        res['status'] = 'end'
        return res
    if (sb - 1) not in rs or (sb + 1) not in rs:
        res['status'] = 'neighbour'
        return res
    d = parab_delta(rs[sb - 1], rs[sb], rs[sb + 1])
    res['status'] = 'ok'
    res['delta'] = d
    res['lag'] = sb + d
    res['g'] = gate_flags(rs[sb])
    return res


def whole_close(lag):
    return abs(lag - math.floor(lag + 0.5)) <= 0.1


# ---------------------------------------------------------------- 5.1 start
def start_of(get, o):
    m = None
    s = None
    for h in range(o - 47, o + 1):
        v = get(h)
        if v is None:
            continue
        if m is None or v < m:
            m = v
            s = h
        elif v == m:
            s = h
    return s


def fclass(q):
    if q < 3000:
        return 'lt3000'
    if q < 6000:
        return '3000-6000'
    if q < 12000:
        return '6000-12000'
    if q < 25000:
        return '12000-25000'
    return 'ge25000'


def wclass(q):
    if q < 1500:
        return 'lt1500'
    if q < 2000:
        return '1500-2000'
    return '2000-3000'


# ---------------------------------------------------------------- 5.3 bumps
def bump_candidates(get, k0, k1):
    out = []
    for p in range(k0, k1 + 1):
        v = get(p)
        if v is None or not (v < 6000):
            continue
        ok = True
        for q in range(p - 24, p):
            x = get(q)
            if x is not None and not (x < v):
                ok = False
                break
        if not ok:
            continue
        for q in range(p + 1, p + 25):
            x = get(q)
            if x is not None and not (x <= v):
                ok = False
                break
        if not ok:
            continue
        cnt = 0
        for q in range(p - 47, p + 1):
            if get(q) is not None:
                cnt += 1
        if cnt < 36:
            continue
        s = start_of(get, p)
        if s is None:
            continue
        m = get(s)
        if not (m < 3000):
            continue
        if not (v >= 1.4 * m):
            continue
        out.append((p, s, v, m, s - 6, p + 6))
    return out


def thin(cands):
    # cands: list of (p, v); returns kept p ascending
    order = sorted(cands, key=lambda c: (-c[1], c[0]))
    acc = []
    for p, v in order:
        if all(abs(p - q) >= 96 for q in acc):
            acc.append(p)
    return sorted(acc)


# ---------------------------------------------------------------- 5.6 use
def use_rule(up, down, a, b):
    n = b - a + 1
    cu = cd = cb = 0
    for h in range(a, b + 1):
        u = up.get(h)
        d = down.get(h)
        if u is not None:
            cu += 1
        if d is not None:
            cd += 1
        if u is not None and d is not None:
            cb += 1
    used = (10 * cu >= 9 * n) and (10 * cd >= 9 * n) and (cb >= 24)
    return used, cb


def overlap_hours(a, b, a2, b2):
    return max(0, min(b, b2) - max(a, a2) + 1)


def join_cluster(a, b, event_windows):
    best = 0
    bi = None
    for i, (ea, eb) in enumerate(event_windows):
        ov = overlap_hours(a, b, ea, eb)
        if ov > best:
            best = ov
            bi = i
    return bi


# ---------------------------------------------------------------- 6 creek
def creek_share(lf, creeks, dr, a, b, local, gauged_with, gauged_wo):
    """creeks: list of Ser (non-DR, listed order); dr: Ser or None (file absent / not part of leg).
    Returns (share, status, dr_fallback)."""
    n = b - a + 1

    def enough(ser):
        c = 0
        for h in range(a, b + 1):
            if ser.get(h) is not None:
                c += 1
        return 10 * c >= 9 * n

    def ssum(ser):
        base = None
        s = 0.0
        for h in range(a, b + 1):
            v = ser.get(h)
            if v is None:
                continue
            if base is None:
                base = v
            s = s + max(0.0, v - base)
        return s

    if not enough(lf):
        return None, 'unknown', 0
    slf = ssum(lf)
    if slf <= 0.0:
        return None, 'unknown', 0
    for c in creeks:
        if not enough(c):
            return None, 'unknown', 0
    use_dr = False
    fb = 0
    if dr is not None:
        if enough(dr):
            use_dr = True
        else:
            fb = 1
    scr = 0.0
    for c in creeks:
        scr = scr + ssum(c)
    if use_dr:
        scr = scr + ssum(dr)
        gauged = gauged_with
    else:
        gauged = gauged_wo
    share = (scr * (local / gauged)) / slf
    return share, ('heavy' if share > 0.15 else 'clean'), fb


# ---------------------------------------------------------------- 7.2 parts
def window_vals(ser, a, b):
    n = b - a + 1
    hs = []
    vs = []
    for h in range(a, b + 1):
        v = ser.get(h)
        if v is not None:
            hs.append(h)
            vs.append(v)
    return (10 * len(hs) >= 9 * n), hs, vs


def cross_parts(hs, vs):
    v0 = vs[0]
    mx = vs[0]
    for v in vs:
        if v > mx:
            mx = v
    rise = mx - v0
    crest = None
    best = None
    for h, v in zip(hs, vs):
        if best is None or v > best:
            best = v
            crest = h
    if rise <= 0.0:
        return rise, None, crest
    times = []
    for f in (0.1, 0.5, 0.9):
        level = v0 + f * rise
        if vs[0] >= level:
            times.append(float(hs[0]))
            continue
        t = None
        for j in range(1, len(vs)):
            if vs[j] >= level:
                t = hs[j - 1] + ((level - vs[j - 1]) / (vs[j] - vs[j - 1])) * (hs[j] - hs[j - 1])
                break
        times.append(t)
    return rise, times, crest


def unit_parts_calc(up, down, a, b, sb):
    e1, hd, vd = window_vals(down, a, b)
    e2, hu, vu = window_vals(up, a - sb, b - sb)
    if not (e1 and e2):
        return 'data', None
    rd, td, cd = cross_parts(hd, vd)
    ru, tu, cu = cross_parts(hu, vu)
    if rd <= 0.0 or ru <= 0.0:
        return 'no_rise', None
    if None in td or None in tu:
        return 'no_rise', None
    return 'ok', [td[0] - tu[0], td[1] - tu[1], td[2] - tu[2], cd - cu]


# ---------------------------------------------------------------- 9 low water
def detrend(ser):
    a = ser.arr
    n = len(a)
    out = [None] * n
    for i in range(n):
        x = a[i]
        if x is None:
            continue
        s = 0.0
        c = 0
        for j in range(max(i - 12, 0), min(i + 12, n - 1) + 1):
            y = a[j]
            if y is not None:
                s = s + y
                c += 1
        if c >= 19:
            out[i] = x - s / c
    return Ser(ser.base, out)


def phase_of(sb, rm, r0, rp):
    d = parab_delta(rm, r0, rp)
    ph = sb + d
    if ph < 0:
        ph += 24
    if ph >= 24:
        ph -= 24
    return d, ph


def cd_circ(a, b):
    d = abs(a - b)
    return min(d, 24.0 - d)


def circ_median(phases):
    xs = sorted(phases)
    best = None
    dbest = None
    for c in xs:
        s = 0.0
        for p in xs:
            s = s + cd_circ(c, p)
        if best is None:
            best = c
            dbest = s
        elif s < dbest - 1e-9:
            best = c
            dbest = s
    spread = median([cd_circ(p, best) for p in xs])
    return best, spread


def whole_days(phi, Mb):
    bestk = None
    bd = None
    for k in (0, 1, 2):
        d = abs((phi + 24.0 * k) - Mb)
        if bd is None or d < bd:
            bd = d
            bestk = k
    return bestk, phi + 24.0 * bestk


def week_phase(upd, downd, wstart):
    rs = {}
    ns = {}
    for s in range(24):
        xs = []
        ys = []
        for t in range(wstart, wstart + 168):
            d = downd.get(t)
            if d is None:
                continue
            u = upd.get(t - s)
            if u is None:
                continue
            xs.append(u)
            ys.append(d)
        n = len(xs)
        if n >= 24:
            r = pearson(xs, ys)
            if r is not None:
                rs[s] = r
                ns[s] = n
    res = {'status': None, 'sb': None, 'n': None, 'r': None, 'delta': None, 'phase': None, 'gate50': 0, 'rs': rs}
    if not rs:
        res['status'] = 'no_eligible'
        return res
    best = None
    for s in range(24):
        if s in rs and (best is None or rs[s] > rs[best]):
            best = s
    res['sb'] = best
    res['n'] = ns[best]
    res['r'] = rs[best]
    sm = (best - 1) % 24
    sp = (best + 1) % 24
    if sm not in rs or sp not in rs:
        res['status'] = 'neighbour'
        return res
    d, ph = phase_of(best, rs[sm], rs[best], rs[sp])
    res['status'] = 'ok'
    res['delta'] = d
    res['phase'] = ph
    res['gate50'] = 1 if rs[best] >= 0.5 else 0
    return res


# ---------------------------------------------------------------- 10 fits
def ts_fit(Q, X, Y):
    n = len(Q)
    if n < 5:
        return None
    sl = []
    for i in range(n - 1):
        qi = Q[i]
        xi = X[i]
        yi = Y[i]
        for q, x, y in zip(Q[i + 1:], X[i + 1:], Y[i + 1:]):
            if q != qi:
                sl.append((y - yi) / (x - xi))
    if not sl:
        return None
    B = median(sl)
    A = median([Y[i] - B * X[i] for i in range(n)])
    return B, A, len(sl)


def ts_points(Qs, lags):
    X = []
    Y = []
    nfl = 0
    for q, l in zip(Qs, lags):
        X.append(math.log(q))
        if l > 0.05:
            Y.append(math.log(l))
        else:
            Y.append(math.log(0.05))
            nfl += 1
    return X, Y, nfl


class LCG(object):
    def __init__(self, seed):
        self.x = seed

    def next(self):
        self.x = (48271 * self.x) % 2147483647
        return self.x

    def idx(self, m):
        return (self.next() * m) // 2147483647


def draw_clusters(lcg, m):
    return [lcg.idx(m) for _ in range(m)]


# ---------------------------------------------------------------- 12/13
def range_ends(L, lo, hi, drvalid, drq25):
    if L is None or lo is None or hi is None:
        return None, None, None
    long_end = 0.37 * hi
    central = 0.36 * L
    if drvalid:
        if drq25 is None:
            short_end = None
        else:
            short_end = min((0.75 * 0.36) * L, drq25)
    else:
        short_end = (0.4 * 0.34) * lo
    return long_end, central, short_end


def switched_in(medP, medv, nP, nv, usable):
    if not usable:
        return False
    if nP < 3 or nv < 3:
        return False
    if medP is None or medv is None:
        return False
    return abs(mic(f6(medv)) - mic(f6(medP))) > 1000000


def merged_bounds(plo, phi, sens):
    los = []
    his = []
    if plo is not None and phi is not None:
        los.append(plo)
        his.append(phi)
    for lo, hi in sens:
        if lo is not None and hi is not None:
            los.append(lo)
            his.append(hi)
    if not los:
        return None, None
    return min(los), max(his)


def formula_value(q):
    return (6.5 * (4139.0 * (max(q, 1000.0) ** -0.5963))) / 25.8


def cell_status(app, longe, shorte):
    a = mic(app)
    lo = mic(longe)
    sh = mic(shorte)
    if a is not None and lo is not None and a > lo:
        return 'TOO LONG'
    if a is not None and sh is not None and a < sh:
        return 'TOO SHORT'
    return 'INSIDE'


def verdict(statuses):
    nq = sum(1 for s in statuses if s != 'not_qualified')
    nl = sum(1 for s in statuses if s == 'TOO LONG')
    ns = sum(1 for s in statuses if s == 'TOO SHORT')
    ni = sum(1 for s in statuses if s == 'INSIDE')
    if nq < 2:
        return 'NOT DECIDED'
    if nl >= 2 and ns == 0:
        return 'TOO LONG'
    if ni == nq:
        return 'ABOUT RIGHT'
    return 'MIXED'


# ---------------------------------------------------------------- 11 DR
def dr_candidates(get, k0, k1):
    out = []
    for p in range(k0, k1 + 1):
        v = get(p)
        if v is None:
            continue
        ok = True
        cnt = 0
        mn = None
        for q in range(p - 24, p):
            x = get(q)
            if x is None:
                continue
            cnt += 1
            if not (x < v):
                ok = False
                break
            if mn is None or x < mn:
                mn = x
        if not ok or cnt < 18:
            continue
        for q in range(p + 1, p + 25):
            x = get(q)
            if x is not None and not (x <= v):
                ok = False
                break
        if not ok:
            continue
        rise = v - mn
        if rise >= 50.0:
            out.append((p, rise))
    return out


def dr_separate(cands):
    order = sorted(cands, key=lambda c: (-c[1], c[0]))
    acc = []
    for p, rise in order:
        if all(abs(p - q) >= 48 for q, _ in acc):
            acc.append((p, rise))
    return acc


def dr_cond_ef(get, p):
    vals = []
    for h in range(p - 24, p + 13):
        v = get(h)
        if v is not None:
            vals.append(v)
    if len(vals) < 30:
        return False, None
    mx = max(vals)
    mn = min(vals)
    rel = (mx - mn) / mn
    return (rel < 0.05), rel


def dr_cond_creek(get, p, rise):
    vals = []
    first = None
    for h in range(p - 24, p + 13):
        v = get(h)
        if v is not None:
            vals.append(v)
            if first is None:
                first = v
    if len(vals) < 30:
        return False, None
    cr = max(0.0, max(vals) - first)
    return (cr < 0.25 * rise), cr


def dr_to_arr(vals):
    arr = []
    nonpos = 0
    for v in vals:
        if v is None:
            arr.append(None)
        elif v <= 0:
            arr.append(None)
            nonpos += 1
        else:
            arr.append(v)
    return arr, nonpos


# ================================================================ unit tests
def near(a, b, tol=1e-9):
    return a is not None and b is not None and abs(a - b) <= tol


def t_key():
    return (key_of('1970-01-01 00:00') == 0 and key_of('2020-01-01 00:00') == 438288 and
            key_of('2012-12-01 00:00') == 376200 and key_of('2019-12-31 23:00') == 438287 and
            key_of('2026-11-09 23:00') == 498407 and key_of('2011-12-01 05:00') == 367421 and
            key_of('2015-06-20 12:00') == 398556 and key_of('2015-06-20T12:00:00.000Z') == 398556)


def t_weeks():
    k = key_of('2020-01-06 00:00')
    return (wk(k) == 2610 and ws(2610) == 438408 and k == 438408 and
            wk(key_of('2020-01-05 23:00')) == 2609 and key_of('2020-01-05 23:00') == 438407 and
            wk(key_of('2020-01-12 23:00')) == 2610 and key_of('2020-01-12 23:00') == 438575 and
            wk(key_of('2020-01-13 00:00')) == 2611 and wk(0) == 0 and ws(0) == -72 and wk(-72) == 0)


def t_stats():
    return (median([3, 1, 2]) == 2 and median([4, 1, 3, 2]) == 2.5 and
            near(percentile([1, 2, 3, 4, 5], 0.25), 2.0) and
            near(percentile(list(range(1, 11)), 0.25), 3.25) and
            near(percentile(list(range(1, 10001)), 0.025), 250.975) and
            near(percentile(list(range(1, 10001)), 0.975), 9750.025))


def t_corr():
    return (near(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]), 0.7745966692414834) and
            pearson([1, 1, 1], [1, 2, 3]) is None)


def _xc_series(down35_missing=False, zero_up=False):
    base = -100
    n = 400
    upv = [0.0] * n
    if not zero_up:
        vals = [0, 1, 3, 7, 12, 20, 25, 22, 15, 9, 5, 2, 1, 0]
        for i, v in enumerate(vals):
            upv[30 + i - base] = float(v)
    dn = [None] * n
    for i in range(n):
        h = i + base
        dn[i] = 0.8 * (upv[h - 5 - base] if h - 5 - base >= 0 else 0.0) + 0.2 * (upv[h - 6 - base] if h - 6 - base >= 0 else 0.0)
    if down35_missing:
        dn[35 - base] = None
    return Ser(base, upv), Ser(base, dn)


def t_xc():
    up, dn = _xc_series()
    r = XC(up, dn, 20, 70, 0, 12)
    ok = (r['status'] == 'ok' and r['sb'] == 5 and r['n'] == 50 and near(r['rs'][5], 0.9912981076214433) and
          near(r['rs'][4], 0.7098083831168271) and near(r['rs'][6], 0.8501476405787828) and
          near(r['lag'], 5.166026871401152) and r['g'][2] == 1 and r['g'][3] == 1)
    r = XC(up, dn, 20, 70, 0, 5)
    ok = ok and r['status'] == 'end' and r['sb'] == 5
    r = XC(up, dn, 20, 70, 6, 12)
    ok = ok and r['status'] == 'end' and r['sb'] == 6
    r = XC(up, dn, 20, 40, 0, 12)
    ok = ok and r['status'] == 'no_eligible'
    up0, dn0 = _xc_series(zero_up=True)
    up0 = Ser(up0.base, [0.0] * len(up0.arr))
    r = XC(up0, dn, 20, 70, 0, 12)
    ok = ok and r['status'] == 'no_eligible'
    up2, dn2 = _xc_series(down35_missing=True)
    r = XC(up2, dn2, 20, 70, 0, 12)
    ok = ok and r['status'] == 'ok' and r['sb'] == 5 and r['n'] == 48 and \
        near(r['lag'], 5.166653914337471)
    ok = ok and len([1 for s in (0, 5) if s in r['rs']]) == 2
    return ok


def t_parabola():
    ok = (near(parab_delta(0.5, 0.9, 0.7), 0.1666666666666666) and parab_delta(0.5, 0.5, 0.5) == 0.0 and
          parab_delta(0.9, 0.9, 0.5) == -0.5 and parab_delta(0.5, 0.9, 0.9) == 0.5)
    d, ph = phase_of(0, 0.80, 0.90, 0.60)
    ok = ok and near(ph, 23.75)
    d, ph = phase_of(23, 0.6, 0.9, 0.8)
    ok = ok and near(ph, 23.25)
    return ok


def t_start():
    d = {}
    for h in range(100, 141):
        d[h] = 600.0
    d[110] = 500.0
    d[120] = 500.0
    d[130] = 700.0
    ok = start_of(d.get, 140) == 120
    d = {}
    for h in range(90, 141):
        d[h] = 600.0
    d[92] = 100.0
    d[93] = 500.0
    ok = ok and start_of(d.get, 140) == 93
    d = {}
    for h in range(50, 93):
        d[h] = 600.0
    ok = ok and start_of(d.get, 140) is None and start_of(d.get, 100) == 92
    return ok


def t_parts():
    hs = list(range(10, 18))
    vs = [100.0, 100.0, 112.0, 140.0, 185.0, 200.0, 200.0, 190.0]
    rise, t, c = cross_parts(hs, vs)
    ok = rise == 100 and near(t[0], 11.833333333333334) and near(t[1], 13.222222222222221) and \
        near(t[2], 14.333333333333334) and c == 15
    hs = [10, 12, 14, 16]
    vs = [100.0, 112.0, 185.0, 200.0]
    rise, t, c = cross_parts(hs, vs)
    ok = ok and rise == 100 and near(t[0], 11.666666666666666) and near(t[1], 13.04109589041096) and \
        near(t[2], 14.666666666666666) and c == 16
    return ok


def t_bumps():
    arr = [1000.0] * 230
    for h in range(100, 111):
        arr[h] = 1000.0 + 50 * (h - 100)
    for h in range(111, 121):
        arr[h] = 1500.0 - 50 * (h - 110)
    for h in range(160, 166):
        arr[h] = 1000.0 + 70 * (h - 160)
    for h in range(166, 171):
        arr[h] = 1350.0 - 70 * (h - 165)
    s = Ser(0, arr)
    c = bump_candidates(s.get, 0, 229)
    return len(c) == 1 and c[0][0] == 110 and c[0][1] == 100 and c[0][2] == 1500 and c[0][3] == 1000 and \
        c[0][4] == 94 and c[0][5] == 116


def t_thin():
    return (thin([(1000, 5000), (1050, 4500), (1100, 3000), (1200, 3500)]) == [1000, 1100, 1200] and
            thin([(1000, 5000), (1096, 4000)]) == [1000, 1096] and
            thin([(1000, 5000), (1095, 4000)]) == [1000])


def t_creek():
    lf = Ser(0, [100.0, 110.0, 130.0, 120.0, 115.0])
    sen = Ser(0, [10.0, 12.0, 20.0, 15.0, 10.0])
    br = Ser(0, [5.0, 5.0, 5.0, 6.0, 5.0])
    dr = Ser(0, [2.0, 3.0, 8.0, 5.0, 2.0])
    g_wo = 101.0 + 76.1
    g_w = (101.0 + 76.1) + 57.8
    s, st, fb = creek_share(lf, [sen, br], None, 0, 4, 430.0, g_w, g_wo)
    ok = near(s, 0.5827216261998871) and st == 'heavy'
    s, st, fb = creek_share(lf, [sen, br], dr, 0, 4, 430.0, g_w, g_wo)
    ok = ok and near(s, 0.6834113807293885) and st == 'heavy' and fb == 0
    sen2 = Ser(0, [None, 12.0, 20.0, 15.0, 10.0])
    s, st, fb = creek_share(lf, [sen2, br], None, 0, 4, 430.0, g_w, g_wo)
    ok = ok and s is None and st == 'unknown'
    dr2 = Ser(0, [None, None, 8.0, 5.0, 2.0])
    s, st, fb = creek_share(lf, [sen, br], dr2, 0, 4, 430.0, g_w, g_wo)
    ok = ok and near(s, 0.5827216261998871) and st == 'heavy' and fb == 1
    s, st, fb = creek_share(lf, [sen2, br], dr2, 0, 4, 430.0, g_w, g_wo)
    ok = ok and s is None and st == 'unknown'
    return ok


def t_theilsen():
    Q = [1000, 2000, 4000, 8000, 8000, 3000]
    lag = [10, 7.1, 5, 3.6, 3.7, 6]
    X, Y, nf = ts_points(Q, lag)
    f = ts_fit(Q, X, Y)
    ok = f is not None and f[2] == 14 and near(f[0], -0.49061072757099455) and near(f[1], 5.690876476384307)
    X, Y, nf = ts_points([1000, 1000], [3, 4])
    ok = ok and ts_fit([1000, 1000], X, Y) is None
    Q = [1000, 2000, 3000, 4000, 5000]
    lag = [0.04, 5, 4, 3, 2]
    X, Y, nf = ts_points(Q, lag)
    f = ts_fit(Q, X, Y)
    ok = ok and nf == 1 and near(Y[0], -2.995732273553991) and f is not None and f[2] == 10 and \
        near(f[0], -0.6436526536897076) and near(f[1], 6.437099349353944)
    return ok


def t_circ():
    m, s = circ_median([1, 2, 23, 22, 12])
    ok = m == 1 and s == 2.0
    m, s = circ_median([0, 12])
    ok = ok and m == 0 and s == 6.0
    m, s = circ_median([10, 10, 11])
    ok = ok and m == 10 and s == 0.0
    return ok and cd_circ(0.5, 23.5) == 1.0


def t_lcg():
    g = LCG(20261127)
    exp = [919802032, 539484947, 1091173115, 686024196, 876128376]
    got = [g.next() for _ in range(5)]
    ok = got == exp
    g = LCG(20261127)
    for _ in range(1000):
        g.next()
    ok = ok and g.x == 251994556 and (919802032 * 7) // 2147483647 == 2
    return ok


def t_detrend():
    arr = [float((h * h) % 17) for h in range(41)]
    for h in (10, 11, 20):
        arr[h] = None
    d = detrend(Ser(0, arr))
    return (near(d.get(15), -5.136363636363637) and near(d.get(24), 7.916666666666667) and
            near(d.get(30), 8.40909090909091) and d.get(3) is None and d.get(10) is None and d.get(0) is None)


def t_days():
    return (whole_days(3.0, 26.5) == (1, 27.0) and whole_days(0.0, 12.0)[0] == 0 and
            whole_days(20.0, 3.0)[0] == 0 and whole_days(5.0, 100.0)[0] == 2)


def t_range():
    le, ce, se = range_ends(10.0, 8.0, 12.0, False, None)
    ok = near(le, 4.4399999999999995) and near(ce, 3.5999999999999996) and near(se, 1.088)
    le, ce, se = range_ends(10.0, 8.0, 12.0, True, 2.0)
    ok = ok and near(se, 2.0)
    le, ce, se = range_ends(10.0, 8.0, 12.0, True, 3.0)
    ok = ok and near(se, 2.7)

    def sw(m3, n=(5, 5, 5)):
        return [switched_in(m3[0], m3[i], n[0], n[i], True) for i in (1, 2)]
    ok = ok and sw((10.0, 9.2, 10.9)) == [False, False]
    ok = ok and sw((10.0, 11.0, 10.0)) == [False, False]
    ok = ok and sw((10.0, 11.000001, 10.0)) == [True, False]
    ok = ok and sw((10.0, 9.2, 8.9)) == [False, True]
    ok = ok and sw((10.0, 12.0, 10.0), (5, 2, 5)) == [False, False]
    ok = ok and merged_bounds(8, 12, [(7, 15)]) == (7, 15)
    ok = ok and merged_bounds(8, 12, [(9, 13)]) == (8, 13)
    ok = ok and merged_bounds(8, 12, [(9, 13), (7, 15)]) == (7, 15)
    ok = ok and merged_bounds(8, 12, []) == (8, 12)
    ok = ok and near(formula_value(5000.0), 6.493715588514094) and near(formula_value(500.0), 16.954659687540097)
    return ok


def t_verdict():
    nq = 'not_qualified'
    ok = verdict(['TOO LONG', 'TOO LONG', 'INSIDE', nq]) == 'TOO LONG'
    ok = ok and verdict(['TOO LONG', 'TOO SHORT', 'TOO LONG', 'INSIDE']) == 'MIXED'
    ok = ok and verdict(['INSIDE'] * 4) == 'ABOUT RIGHT'
    ok = ok and verdict(['INSIDE', nq, nq, nq]) == 'NOT DECIDED'
    ok = ok and verdict(['TOO LONG', nq, nq, nq]) == 'NOT DECIDED'
    ok = ok and verdict(['INSIDE', 'TOO LONG', nq, nq]) == 'MIXED'
    ok = ok and verdict(['TOO SHORT', 'TOO SHORT', 'INSIDE', 'INSIDE']) == 'MIXED'
    ok = ok and cell_status('6.000000', '5.999999', '1.000000') == 'TOO LONG'
    ok = ok and cell_status('5.999999', '5.999999', '1.000000') == 'INSIDE'
    ok = ok and cell_status('0.999999', '5.999999', '1.000000') == 'TOO SHORT'
    ok = ok and cell_status('1.000000', '5.999999', '1.000000') == 'INSIDE'
    return ok


def t_dr():
    d = {}
    for h in range(0, 301):
        d[h] = 100.0
    for h, v in zip(range(98, 102), (200, 300, 400, 300)):
        d[h] = float(v)
    for h, v in zip(range(129, 132), (250, 350, 250)):
        d[h] = float(v)
    for h, v in zip(range(199, 202), (150, 180, 150)):
        d[h] = float(v)
    for h, v in zip(range(249, 252), (120, 140, 120)):
        d[h] = float(v)
    c = dr_candidates(d.get, 0, 300)
    ok = [(p, int(r)) for p, r in c] == [(100, 300), (130, 250), (200, 80)]
    sep = dr_separate(c)
    ok = ok and [(p, int(r)) for p, r in sep] == [(100, 300), (200, 80)]
    ok = ok and (0.1 * 2000 <= 300) and not (80 >= 0.1 * 2000)
    # condition ef
    e = {h: 5.0 for h in range(-24, 13)}
    e[0] = 5.2
    ok = ok and dr_cond_ef(e.get, 0)[0] is True
    e[0] = 5.25
    ok = ok and dr_cond_ef(e.get, 0)[0] is False
    # condition creek
    c1 = {h: 10.0 for h in range(-24, 13)}
    c1[-5] = 84.5
    ok = ok and dr_cond_creek(c1.get, 0, 300.0)[0] is True and near(dr_cond_creek(c1.get, 0, 300.0)[1], 74.5)
    c2 = dict(c1)
    c2[-5] = 85.0
    ok = ok and dr_cond_creek(c2.get, 0, 300.0)[0] is False
    c3 = {h: (100.0 if h < 0 else 40.0) for h in range(-24, 13)}
    r3 = dr_cond_creek(c3.get, 0, 300.0)
    ok = ok and r3[0] is True and r3[1] == 0.0
    c4 = dict(c1)
    del c4[-24]
    c4[-23] = 20.0
    r4 = dr_cond_creek(c4.get, 0, 300.0)
    ok = ok and r4[0] is True and near(r4[1], 64.5)
    # nonpositive
    vals = [d[h] for h in range(301)]
    vals[60] = -5.0
    vals[150] = 0.0
    vals[151] = -2.0
    arr, nonpos = dr_to_arr(vals)
    ok = ok and nonpos == 3 and sum(1 for v in arr if v is not None) == 298
    ds = Ser(0, arr)
    c = dr_candidates(ds.get, 0, 300)
    ok = ok and [(p, int(r)) for p, r in c] == [(100, 300), (130, 250), (200, 80)]
    ok = ok and near(3.0 * (9.1 / 7.4), 3.6891891891891886)
    return ok


def t_mic():
    return (mic('0.500000') == 500000 and mic('-0.020000') == -20000 and mic('10.000000') == 10000000 and
            mic('-1.000000') == -1000000 and f6(-0.0000001) == '0.000000' and mic(f6(-0.0000001)) == 0)


def t_cluster():
    ev = [(0, 100), (90, 200)]
    return (join_cluster(95, 120, ev) == 1 and join_cluster(95, 104, ev) == 1 and
            join_cluster(300, 320, ev) is None)


def t_draw():
    g = LCG(20261127)
    clusters = [[1, 2], [3], [4]]
    d1 = draw_clusters(g, 3)
    p1 = [p for i in d1 for p in clusters[i]]
    d2 = draw_clusters(g, 3)
    p2 = [p for i in d2 for p in clusters[i]]
    return d1 == [1, 0, 1] and p1 == [3, 1, 2, 3] and d2 == [0, 1, 1] and p2 == [1, 2, 3, 3]


def t_use():
    n = 30
    up = {h: 1.0 for h in range(30) if h > 2}
    dn = {h: 1.0 for h in range(30) if h > 5 or h < 3}
    ok = use_rule(Ser(0, [up.get(h) for h in range(30)]), Ser(0, [dn.get(h) for h in range(30)]), 0, 29) == (True, 24)
    up = {h: 1.0 for h in range(30) if h > 3}
    dn = {h: 1.0 for h in range(30) if h > 6 or h < 4}
    u2, cb = use_rule(Ser(0, [up.get(h) for h in range(30)]), Ser(0, [dn.get(h) for h in range(30)]), 0, 29)
    return ok and u2 is False


UNIT_TESTS = [
    ('unit_key', t_key), ('unit_weeks', t_weeks), ('unit_stats', t_stats), ('unit_corr', t_corr),
    ('unit_xc', t_xc), ('unit_parabola', t_parabola), ('unit_start', t_start), ('unit_parts', t_parts),
    ('unit_bumps', t_bumps), ('unit_thin', t_thin), ('unit_creek', t_creek), ('unit_theilsen', t_theilsen),
    ('unit_circ', t_circ), ('unit_lcg', t_lcg), ('unit_detrend', t_detrend), ('unit_days', t_days),
    ('unit_range', t_range), ('unit_verdict', t_verdict), ('unit_dr', t_dr), ('unit_mic', t_mic),
    ('unit_cluster', t_cluster), ('unit_draw', t_draw), ('unit_use', t_use),
]


# ================================================================ output helpers
CHECKS = []


def write_csv(name, header, rows):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(','.join(header) + '\n')
        for r in rows:
            assert len(r) == len(header), (name, r)
            f.write(','.join(r) + '\n')


def write_checks():
    write_csv('checks.csv', ['check', 'n_checked', 'n_violations'],
              [[c, str(n), str(v)] for c, n, v in CHECKS])


def stop(msg):
    write_checks()
    log('STOP:', msg)
    sys.exit(1)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def read_rows(path):
    with open(path, 'r', encoding='utf-8', newline='') as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        for row in rd:
            if row and row[-1].endswith('\r'):
                row[-1] = row[-1][:-1]
            yield row


TSRE = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:00$')
NUMRE = re.compile(r'^[0-9]+(\.[0-9]+)?$')
DRRE = re.compile(r'^-?[0-9]+(\.[0-9]+)?$')
TRRE = re.compile(r'^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$')
PTRE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$')


def ts_ok(s):
    if not TSRE.match(s):
        return False
    return 1 <= int(s[5:7]) <= 12 and 1 <= int(s[8:10]) <= 31 and 0 <= int(s[11:13]) <= 23


VERS = ['LOW_P', 'LOW_A', 'LOW_B', 'UPP', 'WHO']
LEG = {'LOW_P': 'lower', 'LOW_A': 'lower', 'LOW_B': 'lower', 'UPP': 'upper', 'WHO': 'whole'}


def main():
    # ---------------------------------------------------------- unit tests
    for name, fn in UNIT_TESTS:
        try:
            ok = bool(fn())
        except Exception as e:
            log('unit test exception', name, repr(e))
            ok = False
        CHECKS.append((name, 1, 0 if ok else 1))
        if not ok:
            stop('unit test failed: ' + name)
    log('unit tests passed:', len(UNIT_TESTS))

    # ---------------------------------------------------------- C00
    dr_present = os.path.exists(P_DR)
    files = [('hourly', P_HOURLY), ('rise', P_RISE), ('replay', P_REPLAY)]
    viol = 0
    for k, p in files:
        sh, sz = SHA[k]
        if sha256_file(p) != sh or os.path.getsize(p) != sz:
            viol += 1
    if dr_present:
        if sha256_file(P_DR) != DR_SHA or os.path.getsize(P_DR) != DR_SIZE:
            viol += 1
    CHECKS.append(('C00_inputs_sha', 4 if dr_present else 3, viol))
    if viol:
        stop('C00')
    log('C00 ok')

    # ---------------------------------------------------------- hourly
    rd = read_rows(P_HOURLY)
    header = next(rd)
    want = ['timestamp', 'por_now', 'ef_stage', 'lf_discharge', 'lf_stage', 'monocacy', 'goose', 'broad_run', 'seneca']
    v1 = 0
    for c in want:
        if header.count(c) != 1:
            v1 += 1
    if len(header) != 12:
        v1 += 1
    hi = {c: header.index(c) for c in want if header.count(c) == 1}
    numcols = want[1:]
    cols = {c: [None] * NREC for c in numcols}
    nrows = 0
    prev = None
    first_key = None
    last_key = None
    for row in rd:
        nrows += 1
        if len(row) != 12:
            v1 += 1
            continue
        ts = row[hi['timestamp']]
        if not ts_ok(ts):
            v1 += 1
            continue
        k = key_of(ts)
        if prev is not None and not (k > prev):
            v1 += 1
        prev = k
        if first_key is None:
            first_key = k
        last_key = k
        if not (K0 <= k <= K1):
            v1 += 1
            continue
        for c in numcols:
            s = row[hi[c]]
            if s == '':
                continue
            if not NUMRE.match(s):
                v1 += 1
                continue
            x = float(s)
            if not (x > 0):
                v1 += 1
                continue
            cols[c][k - K0] = x
    if nrows != 130416:
        v1 += 1
    if first_key != K0:
        v1 += 1
    if last_key != K1:
        v1 += 1
    CHECKS.append(('C01_hourly_file', nrows, v1))
    if v1:
        stop('C01')
    hourly_rows = nrows
    log('hourly read', nrows)

    S = {}
    for c in numcols:
        S[c] = Ser(K0, cols[c])
    efq = [None if x is None else 126.0 * (x ** 2.46) for x in cols['ef_stage']]
    lnef = [None if x is None else math.log(x) for x in cols['ef_stage']]
    lnlf = [None if x is None else math.log(x) for x in cols['lf_discharge']]
    S['EFQ'] = Ser(K0, efq)
    S['LNEF'] = Ser(K0, lnef)
    S['LNLF'] = Ser(K0, lnlf)
    LF = S['lf_discharge']
    lfget = LF.get
    VS = {
        'LOW_P': (S['ef_stage'], S['lf_stage']),
        'LOW_A': (S['EFQ'], S['lf_discharge']),
        'LOW_B': (S['LNEF'], S['LNLF']),
        'UPP': (S['por_now'], S['EFQ']),
        'WHO': (S['por_now'], S['lf_discharge']),
    }

    # ---------------------------------------------------------- rise list
    rd = read_rows(P_RISE)
    header = next(rd)
    v2 = 0
    need = ['onset_no', 'onset_t0', 'onset_tp', 'event_id', 'event_t0', 'event_tp', 'event_class']
    for c in need:
        if c not in header:
            v2 += 1
    ri = {c: header.index(c) for c in need if c in header}
    rrows = []
    for row in rd:
        if len(row) != 47:
            v2 += 1
            continue
        rrows.append(row)
    n_rise_rows = len(rrows) + 0
    n_class = 0
    n_small = 0
    events = []  # [event_id, t0, tp]
    seen = {}
    small_rows = []
    for row in rrows:
        cl = row[ri['event_class']]
        if cl != '':
            n_class += 1
            eid = row[ri['event_id']]
            t0 = row[ri['event_t0']]
            tp = row[ri['event_tp']]
            if not TSRE.match(t0):
                v2 += 1
            if not TSRE.match(tp):
                v2 += 1
            if eid in seen:
                e = events[seen[eid]]
                if e[1] != t0 or e[2] != tp:
                    v2 += 1
            else:
                seen[eid] = len(events)
                events.append([eid, t0, tp])
        else:
            n_small += 1
            t0 = row[ri['onset_t0']]
            tp = row[ri['onset_tp']]
            if not TSRE.match(t0):
                v2 += 1
            if not TSRE.match(tp):
                v2 += 1
            small_rows.append((row[ri['onset_no']], t0, tp))
    if len(rrows) != 87:
        v2 += 1
    if n_class != 54:
        v2 += 1
    if len(events) != 53:
        v2 += 1
    if n_small != 33:
        v2 += 1
    CHECKS.append(('C02_events_file', len(rrows), v2))
    if v2:
        stop('C02')

    # ---------------------------------------------------------- replay
    rd = read_rows(P_REPLAY)
    header = next(rd)
    v3 = 0
    for c in ('predTs', 'status', 'travelGFtoLF'):
        if header.count(c) != 1:
            v3 += 1
    ip = header.index('predTs')
    ist = header.index('status')
    itr = header.index('travelGFtoLF')
    rp_key = []
    rp_status = []
    rp_trav = []
    nrp = 0
    exp_key = K0
    for row in rd:
        nrp += 1
        if len(row) != 87:
            v3 += 1
            rp_key.append(None)
            rp_status.append('')
            rp_trav.append(None)
            exp_key += 1
            continue
        pt = row[ip]
        st = row[ist]
        tr = row[itr]
        if not PTRE.match(pt):
            v3 += 1
            k = None
        else:
            k = key_of(pt)
            if k != exp_key:
                v3 += 1
        exp_key += 1
        if st not in ('predicted', 'no_por', 'no_truth', 'no_lf'):
            v3 += 1
        val = None
        if st in ('predicted', 'no_truth'):
            if tr == '' or not TRRE.match(tr):
                v3 += 1
            else:
                val = float(tr)
        elif tr != '' and TRRE.match(tr):
            val = float(tr)
        rp_key.append(k)
        rp_status.append(st)
        rp_trav.append(val)
    if nrp != 130987:
        v3 += 1
    CHECKS.append(('C03_replay_file', nrp, v3))
    if v3:
        stop('C03')
    log('replay read', nrp)

    # ---------------------------------------------------------- DR file
    DRS = None
    nonpos = 0
    if dr_present:
        rd = read_rows(P_DR)
        header = next(rd)
        v4 = 0
        if header != ['timestamp', 'dr_discharge']:
            v4 += 1
        drvals = []
        nd = 0
        prevk = None
        for row in rd:
            nd += 1
            if len(row) != 2:
                v4 += 1
                drvals.append(None)
                continue
            ts = row[0]
            if not ts_ok(ts):
                v4 += 1
                drvals.append(None)
                continue
            k = key_of(ts)
            if prevk is None:
                if ts != '2011-12-01 05:00':
                    v4 += 1
            elif k != prevk + 1:
                v4 += 1
            prevk = k
            s = row[1]
            if s == '':
                drvals.append(None)
            elif not DRRE.match(s):
                v4 += 1
                drvals.append(None)
            else:
                drvals.append(float(s))
        if nd != 130987:
            v4 += 1
        CHECKS.append(('C04_dr_file', nd, v4))
        if v4:
            stop('C04')
        arr, nonpos = dr_to_arr(drvals)
        DRS = Ser(K0, arr)
        log('DR read', nd, 'nonpositive', nonpos)
    else:
        CHECKS.append(('C04_dr_file', 0, 0))

    # ---------------------------------------------------------- units
    class U_(object):
        pass

    c_no_start = 0
    c_small_no_peak = 0
    c_small_under30 = 0
    units = []

    def mk(uid, kind, o, p, s, a, b):
        u = U_()
        u.id = uid
        u.kind = kind
        u.event_id = ''
        u.cluster = None
        u.o = o
        u.p = p
        u.s = s
        u.a = a
        u.b = b
        u.n_hours = b - a + 1
        vals = []
        for h in range(a, b + 1):
            x = lfget(h)
            if x is not None:
                vals.append(x)
        u.q = median(vals) if vals else None
        u.qclass = fclass(u.q) if u.q is not None else ''
        u.period = 'pre2020' if a < 438288 else 'from2020'
        u.lf_start = lfget(s) if s is not None else None
        u.lf_peak = lfget(p)
        u.share = {'lower': None, 'upper': None, 'whole': None}
        u.cstat = {'lower': 'na', 'upper': 'na', 'whole': 'na'}
        u.fb = 0
        u.onset_no = None
        return u

    event_units = []
    for eid, t0, tp in events:
        o = key_of(t0)
        p = key_of(tp)
        s = start_of(lfget, o)
        if s is None:
            c_no_start += 1
            continue
        u = mk('E' + eid, 'event', o, p, s, s - 6, p + 6)
        u.event_id = eid
        u.cluster = 'E' + eid
        event_units.append(u)
    small_units = []
    for no, t0, tp in small_rows:
        o = key_of(t0)
        p = key_of(tp)
        s = start_of(lfget, o)
        if s is None:
            c_no_start += 1
            continue
        lp = lfget(p)
        if lp is None:
            c_small_no_peak += 1
            continue
        if not (lp >= 1.3 * lfget(s)):
            c_small_under30 += 1
            continue
        u = mk('S' + no, 'small', o, p, s, s - 6, p + 6)
        u.onset_no = no
        small_units.append(u)
    rise_units = event_units + small_units

    # bumps
    cands = bump_candidates(lfget, K0, K1)
    log('bump candidates', len(cands))
    bstatus = {}
    rem = []
    drop_overlap = 0
    for c in cands:
        p, s, v, m, a, b = c
        ov = False
        for u in rise_units:
            if a <= u.b and u.a <= b:
                ov = True
                break
        if ov:
            bstatus[p] = 'overlap'
            drop_overlap += 1
        else:
            rem.append(c)
    order = sorted(rem, key=lambda c: (-c[2], c[0]))
    acc = []
    drop_spacing = 0
    for c in order:
        if all(abs(c[0] - q[0]) >= 96 for q in acc):
            acc.append(c)
            bstatus[c[0]] = 'kept'
        else:
            bstatus[c[0]] = 'spacing'
            drop_spacing += 1
    acc.sort(key=lambda c: c[0])
    bump_units = []
    for p, s, v, m, a, b in acc:
        u = mk('B%d' % p, 'bump', None, p, s, a, b)
        u.cluster = 'B%d' % p
        bump_units.append(u)

    # recessions
    rec_units = []
    rec_cut = 0
    starts = [u.a for u in rise_units] + [u.a for u in bump_units]
    for e in event_units:
        a = e.p - 6
        b = e.p + 72
        nx = None
        for x in starts:
            if x > e.p - 6 and (nx is None or x < nx):
                nx = x
        if nx is not None:
            b = min(b, nx - 1)
        if b < e.p + 72:
            rec_cut += 1
        u = mk('R' + e.event_id, 'recession', None, e.p, None, a, b)
        u.event_id = e.event_id
        u.cluster = ''
        u.lf_start = None
        u.lf_peak = None
        rec_units.append(u)

    # clusters
    ew = [(e.a, e.b) for e in event_units]
    small_joined = 0
    for u in small_units:
        bi = join_cluster(u.a, u.b, ew)
        if bi is None:
            u.cluster = 'S' + u.onset_no
        else:
            u.cluster = event_units[bi].cluster
            small_joined += 1
    singles = {}
    for u in small_units + bump_units:
        if not u.cluster.startswith('E'):
            singles[u.cluster] = u
    corder = [e.cluster for e in event_units]
    for u in sorted(singles.values(), key=lambda u: (u.a, u.id)):
        corder.append(u.cluster)
    cidx = {c: i for i, c in enumerate(corder)}
    clusters_small = sum(1 for u in small_units if u.cluster.startswith('S'))
    clusters_bump = len(bump_units)

    U = event_units + small_units + bump_units + rec_units

    # weeks
    covered = bytearray(NREC)
    for u in U:
        for h in range(max(u.a, K0), min(u.b, K1) + 1):
            covered[h - K0] = 1
    weeks = []
    w_complete = 0
    d_cov = d_med = d_ovl = 0
    for w in range(wk(K0) - 1, wk(K1) + 2):
        st = ws(w)
        if st < K0 or st + 167 > K1:
            continue
        w_complete += 1
        vals = []
        for h in range(st, st + 168):
            x = lfget(h)
            if x is not None:
                vals.append(x)
        if len(vals) < 152:
            d_cov += 1
            continue
        q = median(vals)
        if not (q < 3000):
            d_med += 1
            continue
        ov = False
        for h in range(st, st + 168):
            if covered[h - K0]:
                ov = True
                break
        if ov:
            d_ovl += 1
            continue
        weeks.append((w, st, q, wclass(q)))
    log('units', len(U), 'weeks', len(weeks))

    # creek shares
    g_lower_w = (101.0 + 76.1) + 57.8
    g_lower_wo = 101.0 + 76.1
    g_upper = 817.0 + 332.0
    g_whole_w = (((817.0 + 332.0) + 101.0) + 76.1) + 57.8
    g_whole_wo = ((817.0 + 332.0) + 101.0) + 76.1
    mon, goo, sen, brn = S['monocacy'], S['goose'], S['seneca'], S['broad_run']
    for u in rise_units + bump_units:
        fb = 0
        sh, st, f1 = creek_share(LF, [sen, brn], DRS, u.a, u.b, 430.0, g_lower_w, g_lower_wo)
        u.share['lower'] = sh
        u.cstat['lower'] = st
        fb = max(fb, f1)
        sh, st, f2 = creek_share(LF, [mon, goo], None, u.a, u.b, 1479.0, g_upper, g_upper)
        u.share['upper'] = sh
        u.cstat['upper'] = st
        sh, st, f3 = creek_share(LF, [mon, goo, sen, brn], DRS, u.a, u.b, 1909.0, g_whole_w, g_whole_wo)
        u.share['whole'] = sh
        u.cstat['whole'] = st
        fb = max(fb, f3)
        u.fb = fb

    # ---------------------------------------------------------- C05 (partial) and C06
    n_pred = sum(1 for s in rp_status if s == 'predicted')
    n_clock = sum(1 for s, t in zip(rp_status, rp_trav) if s in ('predicted', 'no_truth') and t is not None)
    kinds_rise = [u for u in U if u.kind in ('event', 'small')]
    used_cnt = {}
    for v in VERS:
        if v == 'UPP':
            continue
        up, down = VS[v]
        for kn, lst in (('rise', kinds_rise), ('bump', bump_units), ('recession', rec_units)):
            c = 0
            for u in lst:
                if use_rule(up, down, u.a, u.b)[0]:
                    c += 1
            used_cnt['used_%s_%s' % (v, kn)] = c
    weeks_used = {}
    for v in VERS:
        up, down = VS[v]
        c = 0
        for w, st, q, cl in weeks:
            if use_rule(up, down, st, st + 167)[0]:
                c += 1
        weeks_used['weeks_used_' + v] = c

    ACC = []  # (item, n, expected)
    ACC.append(('hourly_rows', hourly_rows, 130416))
    ACC.append(('hourly_span', last_key - first_key + 1, 130987))
    ACC.append(('hourly_missing', (last_key - first_key + 1) - hourly_rows, 571))
    ACC.append(('events_rows', len(rrows), 87))
    ACC.append(('event_rows_with_class', n_class, 54))
    ACC.append(('event_units', len(event_units), 53))
    ACC.append(('small_onsets', n_small, 33))
    ACC.append(('unit_no_start', c_no_start, 0))
    ACC.append(('small_no_peak', c_small_no_peak, 0))
    ACC.append(('small_under30', c_small_under30, 0))
    ACC.append(('rise_units', len(rise_units), 86))
    ACC.append(('bump_candidates', len(cands), 103))
    ACC.append(('bump_drop_overlap', drop_overlap, 1))
    ACC.append(('bump_drop_spacing', drop_spacing, 16))
    ACC.append(('bump_units', len(bump_units), 86))
    ACC.append(('recession_windows', len(rec_units), 53))
    ACC.append(('recession_cut', rec_cut, 0))
    ACC.append(('weeks_complete', w_complete, 779))
    ACC.append(('weeks_drop_lf_coverage', d_cov, 37))
    ACC.append(('weeks_drop_median', d_med, 567))
    ACC.append(('weeks_drop_overlap', d_ovl, 75))
    ACC.append(('weeks_low_water', len(weeks), 100))
    ACC.append(('weeks_lt1500', sum(1 for w in weeks if w[3] == 'lt1500'), 17))
    ACC.append(('weeks_1500_2000', sum(1 for w in weeks if w[3] == '1500-2000'), 30))
    ACC.append(('weeks_2000_3000', sum(1 for w in weeks if w[3] == '2000-3000'), 53))
    ACC.append(('small_joined', small_joined, 6))
    ACC.append(('clusters_event', len(event_units), 53))
    ACC.append(('clusters_small', clusters_small, 27))
    ACC.append(('clusters_bump', clusters_bump, 86))
    ACC.append(('clusters_total', len(corder), 166))
    ACC.append(('replay_rows', nrp, 130987))
    ACC.append(('replay_predicted', n_pred, 128595))
    ACC.append(('replay_with_clock', n_clock, 129534))
    exp_used = {
        'used_LOW_P_rise': 81, 'used_LOW_P_bump': 75, 'used_LOW_P_recession': 53,
        'used_LOW_A_rise': 81, 'used_LOW_A_bump': 74, 'used_LOW_A_recession': 53,
        'used_LOW_B_rise': 81, 'used_LOW_B_bump': 74, 'used_LOW_B_recession': 53,
        'used_UPP_rise': None, 'used_UPP_bump': None, 'used_UPP_recession': None,
        'used_WHO_rise': 76, 'used_WHO_bump': 69, 'used_WHO_recession': 48,
    }
    exp_weeks = {'weeks_used_LOW_P': 93, 'weeks_used_LOW_A': 93, 'weeks_used_LOW_B': 93,
                 'weeks_used_UPP': 92, 'weeks_used_WHO': 99}
    used_item_idx = {}
    for v in VERS:
        for kn in ('rise', 'bump', 'recession'):
            item = 'used_%s_%s' % (v, kn)
            used_item_idx[item] = len(ACC)
            ACC.append([item, used_cnt.get(item), exp_used[item]])
    for v in VERS:
        item = 'weeks_used_' + v
        ACC.append((item, weeks_used[item], exp_weeks[item]))
    ACC.append(('dr_present', 1 if dr_present else 0, None))
    assert len(ACC) == 54, len(ACC)
    viol = 0
    nchk = 0
    for it, n, e in ACC:
        if e is not None:
            nchk += 1
            if n != e:
                viol += 1
                log('C05 mismatch', it, n, e)
    CHECKS.append(('C05_row_accounting', nchk, viol))
    if viol:
        stop('C05')

    # C06
    v6 = 0
    ids = set()
    for u in U:
        if u.id in ids:
            v6 += 1
        ids.add(u.id)
        if u.kind != 'recession' and u.s > u.p:
            v6 += 1
        if u.a > u.b:
            v6 += 1
        if u.kind != 'recession' and u.n_hours < 16:
            v6 += 1
        if u.q is None or not (u.q > 0):
            v6 += 1
        if u.kind == 'recession' and u.b < u.p - 6:
            v6 += 1
    CHECKS.append(('C06_unit_sanity', len(U), v6))
    if v6:
        stop('C06')

    # ---------------------------------------------------------- lags
    class R_(object):
        pass
    RES = {}
    m3_checked = 0
    m3_viol = 0
    for ui, u in enumerate(U):
        for v in VERS:
            up, down = VS[v]
            r = R_()
            r.used = 0
            r.n_both = None
            r.status = 'data'
            r.sb = r.n = r.r = r.delta = r.lag = None
            r.g = None
            r.pstatus = 'no_xc'
            r.parts = None
            r.smax = 72 if (u.kind == 'bump' or v == 'WHO') else 48
            a, b = u.a, u.b
            skip = False
            if v == 'UPP':
                lp = RES[(ui, 'LOW_P')]
                if lp.status != 'ok':
                    skip = True
                else:
                    a -= lp.sb
                    b -= lp.sb
            if not skip:
                used, cb = use_rule(up, down, a, b)
                r.n_both = cb
                r.used = 1 if used else 0
                if used:
                    x = XC(up, down, a, b, 0, r.smax)
                    r.status = x['status']
                    if x['n_elig'] >= 2:
                        m3_checked += 1
                        if x['tie']:
                            m3_viol += 1
                    if x['status'] in ('end', 'neighbour', 'ok'):
                        r.sb = x['sb']
                        r.n = x['n']
                        r.r = x['r']
                    if x['status'] == 'ok':
                        r.delta = x['delta']
                        r.lag = x['lag']
                        r.g = x['g']
                        ps, pl = unit_parts_calc(up, down, a, b, r.sb)
                        r.pstatus = ps
                        r.parts = pl
            if u.kind == 'recession':
                r.share = None
                r.creek = 'na'
            else:
                r.share = u.share[LEG[v]]
                r.creek = u.cstat[LEG[v]]
            RES[(ui, v)] = r
    log('lags done')
    for v in VERS:
        for kn, lst in (('rise', kinds_rise), ('bump', bump_units), ('recession', rec_units)):
            item = 'used_%s_%s' % (v, kn)
            c = 0
            for u in lst:
                if RES[(U.index(u), v)].used:
                    c += 1
            ACC[used_item_idx[item]][1] = c
    # C07
    v7 = 0
    n7 = 0
    for ui, u in enumerate(U):
        for v in VERS:
            r = RES[(ui, v)]
            if r.status != 'ok':
                continue
            n7 += 1
            if r.sb <= 0 or r.sb >= r.smax:
                v7 += 1
            if abs(r.r) > 1 + 1e-9:
                v7 += 1
            if not (0 < r.lag < r.smax):
                v7 += 1
            g = r.g
            if (g[3] and not g[2]) or (g[2] and not g[1]) or (g[1] and not g[0]):
                v7 += 1
    if len(U) * 5 != 1125:
        v7 += 1
    CHECKS.append(('C07_lag_sanity', n7, v7))
    if v7:
        stop('C07')

    # ---------------------------------------------------------- weeks phase
    DET = {}
    for nm in ('ef_stage', 'lf_stage', 'EFQ', 'lf_discharge', 'LNEF', 'LNLF', 'por_now'):
        DET[nm] = detrend(S[nm])
    log('detrended')
    VNAMES = {
        'LOW_P': ('ef_stage', 'lf_stage'), 'LOW_A': ('EFQ', 'lf_discharge'), 'LOW_B': ('LNEF', 'LNLF'),
        'UPP': ('por_now', 'EFQ'), 'WHO': ('por_now', 'lf_discharge'),
    }
    WRES = {}
    for (w, st, q, cl) in weeks:
        for v in VERS:
            up, down = VS[v]
            used, cb = use_rule(up, down, st, st + 167)
            d = {'used': 1 if used else 0, 'n_both': cb, 'status': 'data', 'sb': None, 'n': None, 'r': None,
                 'delta': None, 'phase': None, 'gate50': 0}
            if used:
                un, dn = VNAMES[v]
                x = week_phase(DET[un], DET[dn], st)
                d['status'] = x['status']
                if x['status'] in ('neighbour', 'ok'):
                    d['sb'] = x['sb']
                    d['n'] = x['n']
                    d['r'] = x['r']
                if x['status'] == 'ok':
                    d['delta'] = x['delta']
                    d['phase'] = x['phase']
                    d['gate50'] = x['gate50']
            WRES[(w, v)] = d
    v8 = 0
    for (w, st, q, cl) in weeks:
        if ((st // 24) + 3) % 7 != 0:
            v8 += 1
        if q >= 3000:
            v8 += 1
        for v in VERS:
            d = WRES[(w, v)]
            if d['status'] == 'ok' and not (0 <= d['phase'] < 24):
                v8 += 1
    if len(weeks) != 100:
        v8 += 1
    CHECKS.append(('C08_week_sanity', len(weeks), v8))
    if v8:
        stop('C08')
    log('weeks done')

    # ---------------------------------------------------------- class summary
    GROUPS = ['event', 'small', 'bump', 'all_rise', 'recession']
    CLASSES = ['all', 'lt3000', '3000-6000', '6000-12000', '12000-25000', 'ge25000']

    def in_group(u, g):
        if g == 'all_rise':
            return u.kind in ('event', 'small', 'bump')
        return u.kind == g

    CS = {}
    cs_rows = []
    for v in VERS:
        for g in GROUPS:
            for cl in CLASSES:
                sel = [(ui, u) for ui, u in enumerate(U) if in_group(u, g) and (cl == 'all' or u.qclass == cl)]
                n_units = len(sel)
                n_used = n_ok = 0
                ng = [0, 0, 0, 0]
                n60h = n60u = n60c = 0
                lags = [[], [], [], []]
                lags60all = []
                lags60clean = []
                whole = 0
                parts = [[], [], [], []]
                npart = 0
                for ui, u in sel:
                    r = RES[(ui, v)]
                    if r.status != 'data':
                        n_used += 1
                    if r.status != 'ok':
                        continue
                    n_ok += 1
                    clean = r.creek in ('clean', 'na')
                    for i in range(4):
                        if r.g[i]:
                            ng[i] += 1
                            if clean:
                                lags[i].append(r.lag)
                    if r.g[2]:
                        lags60all.append(r.lag)
                        if r.creek == 'heavy':
                            n60h += 1
                        elif r.creek == 'unknown':
                            n60u += 1
                        else:
                            n60c += 1
                            lags60clean.append(r.lag)
                            if whole_close(r.lag):
                                whole += 1
                            if r.pstatus == 'ok':
                                npart += 1
                                for i in range(4):
                                    parts[i].append(r.parts[i])
                row = {
                    'n_units': n_units, 'n_used': n_used, 'n_ok': n_ok,
                    'n_g40': ng[0], 'n_g50': ng[1], 'n_g60': ng[2], 'n_g70': ng[3],
                    'n_g60_heavy': n60h, 'n_g60_unknown': n60u, 'n_g60_clean': n60c,
                    'med_g40': median(lags[0]), 'med_g50': median(lags[1]), 'med_g60': median(lags[2]),
                    'med_g70': median(lags[3]),
                    'q1_g60': percentile(lags60clean, 0.25) if lags60clean else None,
                    'q3_g60': percentile(lags60clean, 0.75) if lags60clean else None,
                    'med_g60_all': median(lags60all),
                    'share_whole_g60': (whole / n60c) if n60c > 0 else None,
                    'n_parts': npart,
                    'med_lag10': median(parts[0]), 'med_lag50': median(parts[1]),
                    'med_lag90': median(parts[2]), 'med_lagcrest': median(parts[3]),
                }
                CS[(v, g, cl)] = row
                cs_rows.append([v, g, cl] + [fi(row[k]) if k.startswith('n_') else f6(row[k]) for k in
                               ['n_units', 'n_used', 'n_ok', 'n_g40', 'n_g50', 'n_g60', 'n_g70', 'n_g60_heavy',
                                'n_g60_unknown', 'n_g60_clean', 'med_g40', 'med_g50', 'med_g60', 'med_g70',
                                'q1_g60', 'q3_g60', 'med_g60_all', 'share_whole_g60', 'n_parts', 'med_lag10',
                                'med_lag50', 'med_lag90', 'med_lagcrest']])
    log('class summary')

    # ---------------------------------------------------------- fits
    # points
    FP = {}
    for v in VERS:
        pts = []
        for ui, u in enumerate(U):
            if u.kind not in ('event', 'small', 'bump'):
                continue
            r = RES[(ui, v)]
            if r.status == 'ok' and r.g[2] == 1 and r.creek == 'clean':
                lagp = r.lag if r.lag > 0.05 else 0.05
                pts.append({'ui': ui, 'q': u.q, 'x': math.log(u.q), 'y': math.log(lagp), 'lag': r.lag,
                            'cl': cidx[u.cluster], 'period': u.period})
        FP[v] = pts
    # flows
    GRID = [1500, 2000, 3000, 5000, 7500, 10000, 15000, 25000, 50000]
    qP = [p['q'] for p in FP['LOW_P']]
    cell_flows = []
    for sel in ([q for q in qP if q < 6000], [q for q in qP if 6000 <= q < 12000], [q for q in qP if q >= 12000]):
        cell_flows.append(median(sel) if sel else None)
    FLOWS = [('g%d' % g, float(g)) for g in GRID] + [('cell1', cell_flows[0]), ('cell2', cell_flows[1]),
                                                     ('cell3', cell_flows[2])]

    FIT = {}
    fit_rows = []
    for v in VERS:
        for per in ('all', 'pre2020', 'from2020'):
            pts = [p for p in FP[v] if per == 'all' or p['period'] == per]
            n_points = len(pts)
            n_clusters = len(set(p['cl'] for p in pts))
            n_floor = sum(1 for p in pts if p['lag'] <= 0.05)
            qmin = min(p['q'] for p in pts) if pts else None
            qmax = max(p['q'] for p in pts) if pts else None
            f = ts_fit([p['q'] for p in pts], [p['x'] for p in pts], [p['y'] for p in pts])
            d = {'n_points': n_points, 'n_clusters': n_clusters, 'n_floor': n_floor, 'qmin': qmin, 'qmax': qmax,
                 'fit': f, 'n_valid': None, 'n_skipped': None, 'B_lo': None, 'B_hi': None, 'bounds': None}
            if per == 'all' and f is not None:
                # bootstrap
                bycl = {}
                for i, p in enumerate(pts):
                    bycl.setdefault(p['cl'], []).append(i)
                cl = sorted(bycl.keys())
                m = len(cl)
                lcg = LCG(20261127)
                Q = [p['q'] for p in pts]
                X = [p['x'] for p in pts]
                Y = [p['y'] for p in pts]
                Bs = []
                flowvals = {fid: [] for fid, F in FLOWS if F is not None}
                lnF = {fid: math.log(F) for fid, F in FLOWS if F is not None}
                nskip = 0
                for dd in range(10000):
                    idxs = []
                    for j in range(m):
                        idxs.extend(bycl[cl[lcg.idx(m)]])
                    if len(idxs) < 5:
                        nskip += 1
                        continue
                    ft = ts_fit([Q[i] for i in idxs], [X[i] for i in idxs], [Y[i] for i in idxs])
                    if ft is None:
                        nskip += 1
                        continue
                    Bd, Ad, ns_ = ft
                    Bs.append(Bd)
                    for fid in flowvals:
                        flowvals[fid].append(math.exp(Ad + Bd * lnF[fid]))
                d['n_valid'] = 10000 - nskip
                d['n_skipped'] = nskip
                if nskip > 500 or not Bs:
                    d['bounds'] = None
                else:
                    d['B_lo'] = percentile(Bs, 0.025)
                    d['B_hi'] = percentile(Bs, 0.975)
                    d['bounds'] = {fid: (percentile(vals, 0.025), percentile(vals, 0.975))
                                   for fid, vals in flowvals.items()}
                log('bootstrap', v, 'valid', d['n_valid'])
            FIT[(v, per)] = d
            fit_rows.append([v, per, fi(n_points), fi(n_clusters), f6(qmin) if n_points >= 1 else '',
                             f6(qmax) if n_points >= 1 else '', fi(n_floor),
                             fi(f[2]) if f else '', f6(f[0]) if f else '', f6(f[1]) if f else '',
                             fi(d['n_valid']), fi(d['n_skipped']), f6(d['B_lo']), f6(d['B_hi'])])

    FAF = {}
    faf_rows = []
    for v in VERS:
        d = FIT[(v, 'all')]
        for fid, F in FLOWS:
            usable = 0
            lag = lo = hi = None
            if d['fit'] is not None and F is not None and d['qmin'] <= F <= d['qmax']:
                usable = 1
                B, A, _ = d['fit']
                lag = math.exp(A + B * math.log(F))
                if d['bounds'] is not None:
                    lo, hi = d['bounds'][fid]
            FAF[(v, fid)] = {'usable': usable, 'lag': lag, 'lo': lo, 'hi': hi}
            faf_rows.append([v, fid, f6(F), fi(usable), f6(lag), f6(lo), f6(hi)])

    # ---------------------------------------------------------- DR check (11)
    DRQ25 = None
    DRvalid = 0
    dr_unit_rows = []
    dr_sum = []
    if dr_present:
        DRg = DRS.get
        cands_dr = dr_candidates(DRg, K0, K1)
        sep = dr_separate(cands_dr)
        f_lf = f_r10 = f_ef = f_cr = 0
        passes = []
        for p, rise in sep:
            vals = []
            for h in range(p - 47, p - 23):
                x = lfget(h)
                if x is not None:
                    vals.append(x)
            lfday = median(vals) if len(vals) >= 12 else None
            if lfday is None or not (lfday < 6000):
                f_lf += 1
                continue
            if not (rise >= 0.1 * lfday):
                f_r10 += 1
                continue
            ok_ef, rel = dr_cond_ef(S['ef_stage'].get, p)
            if not ok_ef:
                f_ef += 1
                continue
            ok_s, cs_ = dr_cond_creek(sen.get, p, rise)
            ok_b, cb_ = dr_cond_creek(brn.get, p, rise)
            if not (ok_s and ok_b):
                f_cr += 1
                continue
            passes.append((p, rise, lfday, rel, cs_, cb_))
        sel = passes[:40]
        n_used = 0
        n_pass_gate = 0
        scaled = []
        for rank, (p, rise, lfday, rel, cs_, cb_) in enumerate(sel, 1):
            a, b = p - 12, p + 36
            used, cb = use_rule(DRS, LF, a, b)
            st = 'data'
            sb = n = r = dl = lg = ls = None
            if used:
                n_used += 1
                x = XC(DRS, LF, a, b, 0, 24)
                st = x['status']
                if st in ('end', 'neighbour', 'ok'):
                    sb, n, r = x['sb'], x['n'], x['r']
                if st == 'ok':
                    dl = x['delta']
                    lg = x['lag']
                    ls = lg * (9.1 / 7.4)
            pas = 1 if (st == 'ok' and r >= 0.6) else 0
            if pas:
                n_pass_gate += 1
                scaled.append(ls)
            dr_unit_rows.append(['D%d' % p, fi(p), fi(rank), f6(rise), f6(lfday), f6(rel), f6(cs_), f6(cb_),
                                  fi(1 if used else 0), st, fi(sb), fi(n), f6(r), f6(dl), f6(lg), f6(ls), fi(pas)])
        DRvalid = 1 if n_pass_gate >= 10 else 0
        DRQ25 = percentile(scaled, 0.25) if scaled else None
        sfb = sum(1 for u in rise_units + bump_units if u.fb == 1)
        dr_sum = [('dr_present', '1'), ('nonpositive_hours', fi(nonpos)), ('candidates', fi(len(cands_dr))),
                  ('separate', fi(len(sep))), ('fail_lf', fi(f_lf)), ('fail_rise10', fi(f_r10)),
                  ('fail_ef', fi(f_ef)), ('fail_creek', fi(f_cr)), ('pass_conditions', fi(len(passes))),
                  ('selected', fi(len(sel))), ('used', fi(n_used)), ('n_pass_gate', fi(n_pass_gate)),
                  ('valid', fi(DRvalid)), ('median_scaled', f6(median(scaled))),
                  ('q25_scaled', f6(DRQ25)), ('q75_scaled', f6(percentile(scaled, 0.75) if scaled else None)),
                  ('share_fallback', fi(sfb)), ('dr_sha256', DR_SHA)]
        log('DR check done; selected', len(sel))
    else:
        dr_unit_rows = [['ABSENT'] + [''] * 16]
        names = ['dr_present', 'nonpositive_hours', 'candidates', 'separate', 'fail_lf', 'fail_rise10', 'fail_ef',
                 'fail_creek', 'pass_conditions', 'selected', 'used', 'n_pass_gate', 'valid', 'median_scaled',
                 'q25_scaled', 'q75_scaled', 'share_fallback', 'dr_sha256']
        dr_sum = [(nm, '0' if nm == 'dr_present' else '') for nm in names]

    # ---------------------------------------------------------- low-water class phase etc
    WCL = ['lt1500', '1500-2000', '2000-3000']
    PH = {}
    lw_sum_rows = []
    for v in VERS:
        for cl in WCL:
            wk_c = [w for w in weeks if w[3] == cl]
            pas = [WRES[(w[0], v)]['phase'] for w in wk_c if WRES[(w[0], v)]['gate50'] == 1]
            if len(pas) >= 5:
                med, spr = circ_median(pas)
            else:
                med = spr = None
            PH[(v, cl)] = (med, spr)
            lw_sum_rows.append(['phase', v, cl, fi(len(wk_c)), fi(len(pas)), f6(med), f6(spr), '', '', '', '', '',
                                 '', '', '', '', ''])
    L94 = {}
    NB = {}
    for v in ('LOW_P', 'UPP', 'WHO'):
        lags = []
        for ui, u in enumerate(U):
            if u.kind != 'bump':
                continue
            r = RES[(ui, v)]
            if r.status == 'ok' and r.g[2] == 1 and r.creek in ('clean', 'na'):
                lags.append(r.lag)
        nb = len(lags)
        Mb = median(lags) if nb >= 3 else None
        NB[v] = (nb, Mb)
        for cl in WCL:
            phi, spr = PH[(v, cl)]
            k = L = lo = hi = None
            if phi is not None and Mb is not None:
                k, L = whole_days(phi, Mb)
                lo = max(0.0, L - spr)
                hi = L + spr
            L94[(v, cl)] = {'k': k, 'L': L, 'lo': lo, 'hi': hi}
            lw_sum_rows.append(['lag', v, cl, '', '', f6(phi), f6(spr), fi(nb), f6(Mb), fi(k), f6(L), f6(lo),
                                 f6(hi), '', '', '', ''])
    CHAIN = {}
    for cl in WCL:
        lp, up_, wh = L94[('LOW_P', cl)]['L'], L94[('UPP', cl)]['L'], L94[('WHO', cl)]['L']
        if lp is not None and up_ is not None and wh is not None:
            sm = up_ + lp
            df = abs(sm - wh)
            pas = 1 if mic(f6(df)) <= 3000000 else 0
            CHAIN[cl] = {'sum': sm, 'whole': wh, 'diff': df, 'pass': pas}
            lw_sum_rows.append(['chain', '', cl, '', '', '', '', '', '', '', '', '', '', f6(sm), f6(wh), f6(df),
                                 fi(pas)])
        else:
            CHAIN[cl] = None
            lw_sum_rows.append(['chain', '', cl] + [''] * 14)
    settled = {cl: (CHAIN[cl] is not None and CHAIN[cl]['pass'] == 1) for cl in WCL}

    # ---------------------------------------------------------- range / grid / cells
    def rising_range(fid, F):
        blank = {'L': None, 'lo': None, 'hi': None, 'cover_both': None, 'long_end': None, 'central': None,
                 'short_end': None}
        P = FAF[('LOW_P', fid)]
        if not P['usable'] or F is None:
            return blank, False
        cl = fclass(F)
        sens = []
        cov = 0
        for v in ('LOW_A', 'LOW_B'):
            sv = FAF[(v, fid)]
            cp = CS[('LOW_P', 'all_rise', cl)]
            cv = CS[(v, 'all_rise', cl)]
            if switched_in(cp['med_g60'], cv['med_g60'], cp['n_g60_clean'], cv['n_g60_clean'], sv['usable'] == 1):
                cov = 1
                sens.append((sv['lo'], sv['hi']))
        L = P['lag']
        if cov:
            lo, hi = merged_bounds(P['lo'], P['hi'], sens)
        else:
            lo, hi = P['lo'], P['hi']
        le, ce, se = range_ends(L, lo, hi, DRvalid == 1, DRQ25)
        return {'L': L, 'lo': lo, 'hi': hi, 'cover_both': cov, 'long_end': le, 'central': ce,
                'short_end': se}, True

    def lowwater_range(F):
        blank = {'L': None, 'lo': None, 'hi': None, 'cover_both': None, 'long_end': None, 'central': None,
                 'short_end': None}
        if F is None or not (F < 3000):
            return blank, False
        cl = wclass(F)
        if not settled[cl]:
            return blank, False
        d = L94[('LOW_P', cl)]
        le, ce, se = range_ends(d['L'], d['lo'], d['hi'], DRvalid == 1, DRQ25)
        return {'L': d['L'], 'lo': d['lo'], 'hi': d['hi'], 'cover_both': None, 'long_end': le, 'central': ce,
                'short_end': se}, True

    grid_rows = []
    for fid, F in FLOWS[:9]:
        rr, ok1 = rising_range(fid, F)
        if ok1:
            src = 'rising_fit'
            rg = rr
        else:
            lw, ok2 = lowwater_range(F)
            if ok2:
                src = 'low_water'
                rg = lw
            else:
                src = 'none'
                rg = {k: None for k in rr}
        grid_rows.append([f6(F), src, f6(rg['L']), f6(rg['lo']), f6(rg['hi']), fi(rg['cover_both']),
                          f6(rg['long_end']), f6(rg['central']), f6(rg['short_end']), fi(DRvalid)])

    # cells
    rp_hits = [(k, t) for k, s, t in zip(rp_key, rp_status, rp_trav) if s in ('predicted', 'no_truth') and t is not None]
    cell_rows = []
    cell_status_list = []
    pts_all = FP['LOW_P']
    cell_defs = [
        ('rising_lt6000', [p for p in pts_all if p['q'] < 6000], 'cell1'),
        ('rising_6000_12000', [p for p in pts_all if 6000 <= p['q'] < 12000], 'cell2'),
        ('rising_ge12000', [p for p in pts_all if p['q'] >= 12000], 'cell3'),
    ]
    cell_flow_map = dict(FLOWS)
    for name, pts, fid in cell_defs + [('low_water', None, None)]:
        cov = bytearray(NREC)
        if pts is not None:
            n_units = len(pts)
            qs = [p['q'] for p in pts]
            for p in pts:
                u = U[p['ui']]
                for h in range(max(u.a, K0), min(u.b, K1) + 1):
                    cov[h - K0] = 1
            medq = median(qs) if qs else None
            if n_units >= 5:
                rg, _ = rising_range(fid, medq)
                qual = 1 if all(rg[k] is not None for k in ('L', 'lo', 'hi', 'long_end', 'short_end')) else 0
                reason = 'ok' if qual else 'no_range'
            else:
                rg, _ = rising_range(fid, medq) if medq is not None else (
                    {'L': None, 'lo': None, 'hi': None, 'cover_both': None, 'long_end': None, 'central': None,
                     'short_end': None}, False)
                qual = 0
                reason = 'few_units'
        else:
            pw = [w for w in weeks if WRES[(w[0], 'LOW_P')]['gate50'] == 1]
            n_units = len(pw)
            qs = [w[2] for w in pw]
            for w in pw:
                for h in range(w[1], w[1] + 168):
                    cov[h - K0] = 1
            medq = median(qs) if qs else None
            rg, _ = lowwater_range(medq)
            qual = 0
            if n_units < 20:
                reason = 'few_weeks'
            else:
                cl = wclass(medq)
                if PH[('LOW_P', cl)][0] is None:
                    reason = 'no_phase'
                elif any(NB[v][1] is None for v in ('LOW_P', 'UPP', 'WHO')):
                    reason = 'no_bumps'
                elif CHAIN[cl] is None or CHAIN[cl]['pass'] != 1:
                    reason = 'chain'
                else:
                    reason = 'ok'
                    qual = 1
        vals = [t for k, t in rp_hits if cov[k - K0]]
        app = median(vals) if vals else None
        formula = formula_value(medq) if medq is not None else None
        if qual:
            status = cell_status(f6(app), f6(rg['long_end']), f6(rg['short_end']))
        else:
            status = 'not_qualified'
        cell_status_list.append(status)
        cell_rows.append([name, fi(n_units), f6(medq), fi(qual), reason, fi(len(vals)), f6(app), f6(formula),
                          f6(rg['L']), f6(rg['lo']), f6(rg['hi']), fi(rg['cover_both']), f6(rg['long_end']),
                          f6(rg['central']), f6(rg['short_end']), fi(DRvalid), status])
    nq = sum(1 for s in cell_status_list if s != 'not_qualified')
    nl = sum(1 for s in cell_status_list if s == 'TOO LONG')
    nsh = sum(1 for s in cell_status_list if s == 'TOO SHORT')
    ni = sum(1 for s in cell_status_list if s == 'INSIDE')
    verd = verdict(cell_status_list)
    dec_rows = [['nq', fi(nq)], ['nlong', fi(nl)], ['nshort', fi(nsh)], ['ninside', fi(ni)],
                ['dr_present', fi(1 if dr_present else 0)], ['dr_valid', fi(DRvalid)], ['verdict', verd]]

    # ---------------------------------------------------------- M rows
    m1c = m1v = 0
    m2c = m2v = 0
    for ui, u in enumerate(U):
        for v in VERS:
            r = RES[(ui, v)]
            if r.status == 'ok':
                m1c += 1
                if any(0 < abs(r.r - g) < 1e-9 for g in GATES):
                    m1v += 1
            if r.share is not None:
                m2c += 1
                if 0 < abs(r.share - 0.15) < 1e-9:
                    m2v += 1
    for (w, st, q, cl) in weeks:
        for v in VERS:
            d = WRES[(w, v)]
            if d['status'] == 'ok':
                m1c += 1
                if any(0 < abs(d['r'] - g) < 1e-9 for g in GATES):
                    m1v += 1
    m4c = sum(FIT[(v, 'all')]['n_points'] for v in VERS)
    m4v = sum(FIT[(v, 'all')]['n_floor'] for v in VERS)
    CHECKS.append(('M1_gate_margin', m1c, m1v))
    CHECKS.append(('M2_creek_margin', m2c, m2v))
    CHECKS.append(('M3_tie_margin', m3_checked, m3_viol))
    CHECKS.append(('M4_floor', m4c, m4v))
    assert len(CHECKS) == 36, len(CHECKS)

    # ---------------------------------------------------------- write files
    write_checks()
    write_csv('row_accounting.csv', ['item', 'n', 'expected'],
              [[it, fi(n), fi(e)] for it, n, e in ACC])
    # units.csv
    rows = []
    for u in U:
        rows.append([u.id, u.kind, u.event_id if u.kind in ('event', 'recession') else '',
                     '' if u.kind == 'recession' else u.cluster,
                     fi(u.o) if u.kind in ('event', 'small') else '', fi(u.p),
                     fi(u.s) if u.kind != 'recession' else '', fi(u.a), fi(u.b), fi(u.n_hours), f6(u.q),
                     u.qclass, u.period, f6(u.lf_start), f6(u.lf_peak),
                     f6(u.share['lower']), f6(u.share['upper']), f6(u.share['whole']),
                     fi(0 if u.kind == 'recession' else u.fb)])
    write_csv('units.csv', ['unit_id', 'kind', 'event_id', 'cluster', 'onset_key', 'peak_key', 'start_key', 'a', 'b',
                            'n_hours', 'q', 'qclass', 'period', 'lf_start', 'lf_peak', 'share_lower', 'share_upper',
                            'share_whole', 'dr_fallback'], rows)
    # unit_lags.csv
    rows = []
    for ui, u in enumerate(U):
        for v in VERS:
            r = RES[(ui, v)]
            g = r.g if r.g else [None] * 4
            pl = r.parts if (r.parts is not None and r.pstatus == 'ok') else [None] * 4
            rows.append([u.id, v, fi(r.used), fi(r.n_both), r.status, fi(r.sb), fi(r.n), f6(r.r), f6(r.delta),
                         f6(r.lag), fi(g[0]), fi(g[1]), fi(g[2]), fi(g[3]), f6(r.share), r.creek, r.pstatus,
                         f6(pl[0]), f6(pl[1]), f6(pl[2]), fi(pl[3])])
    write_csv('unit_lags.csv', ['unit_id', 'version', 'used', 'n_both', 'status', 's_best', 'n_pairs', 'r', 'delta',
                                'lag', 'g40', 'g50', 'g60', 'g70', 'share', 'creek', 'parts_status', 'lag10',
                                'lag50', 'lag90', 'lagcrest'], rows)
    # bumps.csv
    rows = []
    for p, s, v, m, a, b in cands:
        rows.append([fi(p), fi(s), fi(a), fi(b), f6(v), f6(m), bstatus[p]])
    write_csv('bumps.csv', ['peak_key', 'start_key', 'a', 'b', 'lf_peak', 'lf_base', 'status'], rows)
    write_csv('class_summary.csv', ['version', 'group', 'class', 'n_units', 'n_used', 'n_ok', 'n_g40', 'n_g50',
                                    'n_g60', 'n_g70', 'n_g60_heavy', 'n_g60_unknown', 'n_g60_clean', 'med_g40',
                                    'med_g50', 'med_g60', 'med_g70', 'q1_g60', 'q3_g60', 'med_g60_all',
                                    'share_whole_g60', 'n_parts', 'med_lag10', 'med_lag50', 'med_lag90',
                                    'med_lagcrest'], cs_rows)
    write_csv('fits.csv', ['version', 'period', 'n_points', 'n_clusters', 'qmin', 'qmax', 'n_floor', 'nslopes', 'B',
                           'A', 'n_valid', 'n_skipped', 'B_lo', 'B_hi'], fit_rows)
    write_csv('fit_at_flows.csv', ['version', 'flow_id', 'flow', 'usable', 'lag', 'lo', 'hi'], faf_rows)
    write_csv('clock_grid.csv', ['flow', 'source', 'L', 'lo', 'hi', 'cover_both', 'long_end', 'central',
                                 'short_end', 'dr_used'], grid_rows)
    rows = []
    for (w, st, q, cl) in weeks:
        for v in VERS:
            d = WRES[(w, v)]
            rows.append(['W%d' % w, v, fi(st), f6(q), cl, fi(d['used']), fi(d['n_both']), d['status'],
                         fi(d['sb']), fi(d['n']), f6(d['r']), f6(d['delta']), f6(d['phase']), fi(d['gate50'])])
    write_csv('lowwater_weeks.csv', ['week_id', 'version', 'start_key', 'q', 'class', 'used', 'n_both', 'status',
                                     's_best', 'n_pairs', 'r', 'delta', 'phase', 'gate50'], rows)
    write_csv('lowwater_summary.csv', ['row_type', 'version', 'class', 'n_weeks', 'n_gate', 'phase', 'spread',
                                       'n_bumps', 'bump_median', 'k', 'lag', 'lag_lo', 'lag_hi', 'chain_sum',
                                       'chain_whole', 'chain_diff', 'chain_pass'], lw_sum_rows)
    write_csv('dr_units.csv', ['unit_id', 'peak_key', 'rank', 'rise', 'lf_day', 'ef_rel_range', 'seneca_rise',
                               'broad_run_rise', 'used', 'status', 's_best', 'n_pairs', 'r', 'delta', 'lag',
                               'lag_scaled', 'pass'], dr_unit_rows)
    write_csv('dr_summary.csv', ['name', 'value'], [[a, b] for a, b in dr_sum])
    write_csv('cells.csv', ['cell', 'n_units', 'median_q', 'qual', 'reason', 'n_app_rows', 'app_value',
                            'formula_value', 'L', 'lo', 'hi', 'cover_both', 'long_end', 'central', 'short_end',
                            'dr_used', 'status'], cell_rows)
    write_csv('decision.csv', ['item', 'value'], dec_rows)
    log('all files written; run time %.1f s' % (time.time() - T_START))


if __name__ == '__main__':
    main()
