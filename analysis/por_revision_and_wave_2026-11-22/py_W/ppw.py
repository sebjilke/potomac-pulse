"""Core module for Part W (Python, standard library only). Implements common spec section 3 and 4 once."""
import csv, math, os, bisect, collections, datetime

S = '/Users/sebjilke/Desktop/PotomacPulse/analysis/por_revision_and_wave_2026-11-22/'
OUT = S + 'py_W/'
TAB = OUT + 'tables/'
os.makedirs(TAB, exist_ok=True)

_dcache = {}
def day_of_date(s10):
    v = _dcache.get(s10)
    if v is None:
        v = datetime.date(int(s10[0:4]), int(s10[5:7]), int(s10[8:10])).toordinal() - 719163
        _dcache[s10] = v
    return v

def parse_iso(s):
    """'YYYY-MM-DDTHH:MM:SS[.fff]Z' or 'YYYY-MM-DD HH:MM' -> epoch seconds (float if fraction)."""
    t = day_of_date(s[0:10]) * 86400 + int(s[11:13]) * 3600 + int(s[14:16]) * 60
    if len(s) >= 19:
        t += int(s[17:19])
        if len(s) > 20 and s[19] == '.':
            frac = ''
            for ch in s[20:]:
                if ch.isdigit(): frac += ch
                else: break
            if frac: t += float('0.' + frac)
    return t

def iso(t):
    t = int(round(t))
    d, r = divmod(t, 86400)
    dt = datetime.date.fromordinal(d + 719163)
    return '%04d-%02d-%02dT%02d:%02d:%02dZ' % (dt.year, dt.month, dt.day, r // 3600, (r % 3600) // 60, r % 60)

def day_str(dn):
    dt = datetime.date.fromordinal(dn + 719163)
    return dt.isoformat()

def dn_of(dstr):  # 'YYYY-MM-DD' -> day number
    return day_of_date(dstr)

def weekday(dn):  # 0 = Monday
    return (dn + 3) % 7

START = parse_iso('2026-09-01T00:00:00Z')
END = parse_iso('2026-11-22T10:00:00Z')
START4 = parse_iso('2026-06-12T00:00:00Z')
LOCAL_CUT = parse_iso('2026-11-01T06:00:00Z')

def local_off(t):
    return 4 if t < LOCAL_CUT else 5

def local_hour_int(t):
    return int(math.floor(((t - local_off(t) * 3600) % 86400) / 3600.0))

def local_hod(t):
    return ((t - local_off(t) * 3600) % 86400) / 3600.0

# ---------------------------------------------------------------- output helpers
def fmt(v):
    if v is None: return ''
    if isinstance(v, bool): return '1' if v else '0'
    if isinstance(v, int): return str(v)
    if isinstance(v, float):
        if v != v or v in (float('inf'), float('-inf')): return ''
        return repr(v)
    return str(v)

def write_table(name, cols, rows):
    with open(TAB + name + '.csv', 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(cols)
        for r in rows:
            assert len(r) == len(cols), (name, len(r), len(cols))
            w.writerow([fmt(x) for x in r])
    return len(rows)

METRICS = []
def M(q, group, metric, value):
    METRICS.append((q, group if group is not None else '', metric, value))

def flush_metrics(order=None):
    with open(OUT + 'metrics.csv', 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['question', 'group', 'metric', 'value'])
        for q, g, m, v in METRICS:
            w.writerow([q, g, m, fmt(v)])

LOG = []   # lines destined for REPORT facts
def log(s):
    LOG.append(s)
    print(s, flush=True)

# ---------------------------------------------------------------- statistics
def quantile(xs, p):
    s = sorted(xs); n = len(s)
    if n == 0: return None
    h = (n - 1) * p; lo = int(math.floor(h)); hi = min(lo + 1, n - 1)
    return s[lo] + (h - lo) * (s[hi] - s[lo])

def median(xs):
    return quantile(xs, 0.5) if xs else None

def mean(xs):
    return sum(xs) / len(xs) if xs else None

def sd(xs):
    n = len(xs)
    if n < 2: return None
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))

def circ_mean(hs):
    if not hs: return None
    sx = sum(math.sin(2 * math.pi * h / 24) for h in hs) / len(hs)
    cx = sum(math.cos(2 * math.pi * h / 24) for h in hs) / len(hs)
    return (math.atan2(sx, cx) * 24 / (2 * math.pi)) % 24

def circ_sd(hs):
    if not hs: return None
    sx = sum(math.sin(2 * math.pi * h / 24) for h in hs) / len(hs)
    cx = sum(math.cos(2 * math.pi * h / 24) for h in hs) / len(hs)
    R = math.hypot(sx, cx)
    if R <= 0: return None
    return math.sqrt(max(0.0, -2 * math.log(R))) * 24 / (2 * math.pi)

def wrap12(x):
    """take into (-12, 12]"""
    y = x % 24.0
    if y > 12: y -= 24.0
    return y

def round_half_away(x):
    return int(math.copysign(math.floor(abs(x) + 0.5), x))

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return None
    mx = sum(xs) / n; my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs); syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx <= 0 or syy <= 0: return None
    return sxy / math.sqrt(sxx * syy)

# ---------------------------------------------------------------- reading tables
_T = {}
def load_table(name, keys, tmin='0', tmax='9'):
    """stream a tidy readings table; return {(gauge,param): sorted [(epoch, value)]} for wanted keys;
    blank values are skipped; times outside [tmin,tmax] (ISO strings) are skipped."""
    out = {k: [] for k in keys}
    with open(S + 'data/tidy/' + name + '.csv', newline='') as f:
        r = csv.reader(f)
        h = next(r)
        ig, ip, it, iv = h.index('gauge'), h.index('parameter'), h.index('time_utc'), h.index('value')
        for row in r:
            k = (row[ig], row[ip])
            if k in out:
                ts = row[it]
                if ts < tmin or ts > tmax: continue
                if row[iv] == '': continue
                out[k].append((parse_iso(ts), float(row[iv])))
    for k in out: out[k].sort()
    return out

# ---------------------------------------------------------------- series preparation
class Series:
    def __init__(self, label, readings, start, end, maxgap=1800):
        self.label = label; self.start = start; self.end = end
        rd = [(t, v) for t, v in readings if start <= t <= end]
        self.n_readings = len(rd)
        cnt = collections.Counter(int(round(b[0] - a[0])) for a, b in zip(rd, rd[1:]))
        mc = max(cnt.values())
        self.step = min(k for k, v in cnt.items() if v == mc)
        self.step_counts = dict(cnt.most_common(5))
        step = self.step
        N = int((end - start) // step) + 1
        self.N = N; self.t0 = start
        ts = [t for t, v in rd]
        vals = [None] * N
        npres = nfill = 0
        j = 0
        exact = {}
        for t, v in rd: exact[t] = v
        for i in range(N):
            g = start + i * step
            v = exact.get(g)
            if v is not None:
                vals[i] = v; npres += 1; continue
            k = bisect.bisect_left(ts, g)
            if k == 0 or k >= len(ts): continue
            t1, v1 = rd[k - 1]; t2, v2 = rd[k]
            if t2 - t1 <= maxgap:
                vals[i] = v1 + (v2 - v1) * (g - t1) / (t2 - t1); nfill += 1
        self.vals = vals; self.n_present = npres; self.n_filled = nfill; self.n_missing = N - npres - nfill
        # moving average with running sums
        h = int(12 * 3600 // step); self.h = h
        ps = [0.0] * (N + 1); pc = [0] * (N + 1)
        for i, v in enumerate(vals):
            ps[i + 1] = ps[i] + (v if v is not None else 0.0)
            pc[i + 1] = pc[i] + (1 if v is not None else 0)
        npts = 2 * h + 1
        ma = [None] * N
        for i in range(h, N - h):
            c = pc[i + h + 1] - pc[i - h]
            if c * 100 >= 95 * npts and c > 0:
                ma[i] = (ps[i + h + 1] - ps[i - h]) / c
        self.ma = ma
        self.d = [(vals[i] - ma[i]) if (vals[i] is not None and ma[i] is not None) else None for i in range(N)]
        self.smw = {300: 6, 900: 2, 3600: 1}[step]   # half width of centred mean (13/5/3 points)
        self.first_day = int(start // 86400)
        self.last_day = int((start + (N - 1) * step) // 86400)

    def t(self, i): return self.t0 + i * self.step

    def ma_at(self, t):
        if t < self.t0: return None
        q = (t - self.t0) / self.step
        i = int(round(q))
        if abs(q - i) > 1e-9 or i >= self.N: return None
        return self.ma[i]

    def day_range(self, dn):
        lo = max(0, -((-(dn * 86400 - self.t0)) // self.step))
        hi = min(self.N - 1, -((-((dn + 1) * 86400 - self.t0)) // self.step) - 1)
        return lo, hi

    def days(self):
        return range(self.first_day, self.last_day + 1)

    def counts_str(self):
        return 'step=%d min; readings in window=%d; grid=%d; present=%d; filled=%d; missing=%d' % (
            self.step // 60, self.n_readings, self.N, self.n_present, self.n_filled, self.n_missing)

    def event_flow(self, dn):
        a = self.ma_at(dn * 86400); b = self.ma_at((dn + 1) * 86400)
        if a is None or b is None: return True
        return abs(b - a) / a > 0.10

    def event_level_abs(self, dn):
        a = self.ma_at(dn * 86400); b = self.ma_at((dn + 1) * 86400)
        if a is None or b is None: return True
        return abs(b - a) > 0.10

    def day_info(self, dn, want_b=True, want_crest=True):
        lo, hi = self.day_range(dn)
        npts = hi - lo + 1
        info = dict(n_present=0, day_mean=None, A_a=None, A_b=None, phi_b=None, crest=None, trough=None)
        if npts <= 0: return info
        vs = [self.vals[i] for i in range(lo, hi + 1) if self.vals[i] is not None]
        info['n_present'] = len(vs)
        if len(vs) * 100 >= 90 * npts and vs:
            info['day_mean'] = sum(vs) / len(vs)
        ds = [self.d[i] for i in range(lo, hi + 1) if self.d[i] is not None]
        if ds and len(ds) * 100 >= 95 * npts:
            info['A_a'] = (max(ds) - min(ds)) / 2.0
        info['A_a_rel'] = None
        if info['A_a'] is not None and info['day_mean'] not in (None, 0):
            info['A_a_rel'] = info['A_a'] / info['day_mean']
        if want_crest and info['A_a'] is not None:
            w = self.smw; best = None; worst = None
            bi = wi = None
            for i in range(lo, hi + 1):
                if i - w < 0 or i + w >= self.N: continue
                seg = self.d[i - w:i + w + 1]
                if any(x is None for x in seg): continue
                m = sum(seg) / len(seg)
                if best is None or m > best: best = m; bi = i
                if worst is None or m < worst: worst = m; wi = i
            if bi is not None:
                tc = self.t(bi); tt = self.t(wi)
                info['crest'] = (tc - dn * 86400) / 3600.0; info['crest_local'] = local_hod(tc)
                info['trough'] = (tt - dn * 86400) / 3600.0; info['trough_local'] = local_hod(tt)
        if want_b:
            ws = (dn - 1) * 86400; we = (dn + 2) * 86400
            if ws >= self.start and we <= self.end:
                i0 = int(round((ws - self.t0) / self.step)); i1 = int(round((we - self.t0) / self.step))  # exclusive
                idx = [i for i in range(i0, i1) if self.vals[i] is not None]
                if len(idx) * 100 >= 90 * (i1 - i0):
                    fit = harmonic_fit([((self.t(i) - ws) / 3600.0, self.vals[i]) for i in idx])
                    if fit is not None:
                        c, s_ = fit
                        info['A_b'] = math.hypot(c, s_)
                        info['phi_b'] = (math.atan2(s_, c) * 24 / (2 * math.pi)) % 24
        return info

def harmonic_fit(pts):
    """least squares x = a + b*tau + c*cos(2 pi tau/24) + s*sin(2 pi tau/24); returns (c, s).
    tau of the linear term is centred at 36 h (changes only a)."""
    X = [[0.0] * 4 for _ in range(4)]; Y = [0.0] * 4
    for tau, x in pts:
        r = [1.0, tau - 36.0, math.cos(2 * math.pi * tau / 24), math.sin(2 * math.pi * tau / 24)]
        for i in range(4):
            Y[i] += r[i] * x
            for j in range(4): X[i][j] += r[i] * r[j]
    A = [X[i][:] + [Y[i]] for i in range(4)]
    for c in range(4):
        p = max(range(c, 4), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-12: return None
        A[c], A[p] = A[p], A[c]
        for r in range(c + 1, 4):
            f = A[r][c] / A[c][c]
            for k in range(c, 5): A[r][k] -= f * A[c][k]
    sol = [0.0] * 4
    for i in range(3, -1, -1):
        sol[i] = (A[i][4] - sum(A[i][j] * sol[j] for j in range(i + 1, 4))) / A[i][i]
    return sol[2], sol[3]

# ---------------------------------------------------------------- lagged correlation
def lagcorr(X, Y, lags):
    """X, Y: lists on one common grid (None = unusable). lags in grid steps (may be negative).
    returns {lag: (r or None, n)}"""
    N = len(X)
    xv = [x for x in X if x is not None]; yv = [y for y in Y if y is not None]
    cx = sum(xv) / len(xv) if xv else 0.0; cy = sum(yv) / len(yv) if yv else 0.0
    Xc = [None if x is None else x - cx for x in X]; Yc = [None if y is None else y - cy for y in Y]
    res = {}
    for L in lags:
        if L >= 0: a = Xc[0:N - L]; b = Yc[L:N]
        else: a = Xc[-L:N]; b = Yc[0:N + L]
        n = 0; sx = sy = sxx = syy = sxy = 0.0
        for x, y in zip(a, b):
            if x is None or y is None: continue
            n += 1; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y
        if n < 3: res[L] = (None, n); continue
        vx = n * sxx - sx * sx; vy = n * syy - sy * sy
        if vx <= 0 or vy <= 0: res[L] = (None, n); continue
        res[L] = ((n * sxy - sx * sy) / math.sqrt(vx * vy), n)
    return res

def local_maxima(res, lags):
    """lags ascending list (consecutive steps). interior lags with r(L)>r(L-1) and r(L)>=r(L+1)"""
    out = []
    for k in range(1, len(lags) - 1):
        r = res[lags[k]][0]; a = res[lags[k - 1]][0]; b = res[lags[k + 1]][0]
        if r is None or a is None or b is None: continue
        if r > a and r >= b: out.append(lags[k])
    return out

# ---------------------------------------------------------------- bootstrap
_U = None
def uniforms():
    global _U
    if _U is None:
        with open(S + 'data/tidy/boot_uniforms.csv', newline='') as f:
            r = csv.reader(f); h = next(r)
            _U = [[float(x) for x in row] for row in r]
        assert len(_U) == 2000 and len(_U[0]) == 120
    return _U

_dr = {}
def draws(D, off):
    assert D <= 60
    k = (D, off)
    if k not in _dr:
        U = uniforms()
        _dr[k] = [[int(math.floor(U[b][off + i] * D)) for i in range(D)] for b in range(2000)]
    return _dr[k]

BOOT_SKIPS = []
def boot_vec(D1, D2, f):
    """f(d1, d2) -> value or None for each of 2000 resamples; d1/d2 lists of block indices (multiplicity kept)."""
    a = draws(D1, 0) if D1 and D1 > 0 else None
    b = draws(D2, 60) if D2 and D2 > 0 else None
    out = []
    for r in range(2000):
        out.append(f(a[r] if a else None, b[r] if b else None))
    return out

def interval(vals, tag=''):
    """2.5/97.5 percentile of non-None values; blank if more than 5% skipped"""
    good = [v for v in vals if v is not None]
    skipped = len(vals) - len(good)
    BOOT_SKIPS.append((tag, skipped))
    if skipped > 0.05 * len(vals) or not good: return None, None, skipped
    return quantile(good, 0.025), quantile(good, 0.975), skipped

def mag_interval(lo, hi):
    if lo is None or hi is None: return None
    if lo * hi > 0 or (lo > 0 and hi > 0) or (lo < 0 and hi < 0):
        return (min(abs(lo), abs(hi)), max(abs(lo), abs(hi)))
    return (0.0, max(abs(lo), abs(hi)))

def label_from(lo, hi, kind):
    """kind 'mae' (points) or 'cycle' (fraction)."""
    mi = mag_interval(lo, hi)
    if mi is None: return 'undetermined'
    t_hi, t_lo = (1.0, 0.5) if kind == 'mae' else (0.10, 0.05)
    a, b = mi
    if a >= t_hi: return 'matters'
    if b < t_lo: return 'does not matter'
    if a >= t_lo and b < t_hi: return 'small'
    return 'undetermined'

# ---------------------------------------------------------------- hourly cycle helpers
def hourly_means(rows):
    """rows: iterable of (hour, value) -> {hour: (n, mean)}"""
    acc = {}
    for h, v in rows:
        a = acc.get(h)
        if a is None: acc[h] = [1, v]
        else: a[0] += 1; a[1] += v
    return {h: (a[0], a[1] / a[0]) for h, a in acc.items()}

def cycle_of(rows, minn=3):
    hm = hourly_means(rows)
    vm = [m for h, (n, m) in hm.items() if n >= minn]
    if len(vm) < 2: return None
    return (max(vm) - min(vm)) / 2.0

def crest_hour_of(rows, minn=3):
    hm = hourly_means(rows); best = None; bh = None
    for h in sorted(hm):
        n, m = hm[h]
        if n >= minn and (best is None or m > best): best = m; bh = h
    return bh
