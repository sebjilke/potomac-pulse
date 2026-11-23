"""Shared helpers for Part R (standard library only)."""
import csv, math, os, bisect, collections, datetime, calendar

HERE = os.path.dirname(os.path.abspath(__file__))
S = os.path.dirname(HERE)           # study folder
TIDY = os.path.join(S, 'data', 'tidy')
OUTD = os.path.join(S, 'replay', 'out')
FOLD = os.path.join(S, 'replay', 'f_old')
TABLES = os.path.join(HERE, 'tables')
os.makedirs(TABLES, exist_ok=True)

# ---------------------------------------------------------------- times
def ts(s):
    """ISO string (Z or +00:00, optional fraction) -> epoch seconds (float)."""
    if s is None or s == '':
        return None
    s = s.strip()
    y, mo, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
    if len(s) > 10:
        hh, mm, ss = int(s[11:13]), int(s[14:16]), int(s[17:19])
    else:
        hh = mm = ss = 0
    frac = 0.0
    if len(s) > 19 and s[19] == '.':
        j = 20
        while j < len(s) and s[j].isdigit():
            j += 1
        frac = float('0.' + s[20:j])
    return calendar.timegm((y, mo, d, hh, mm, ss)) + frac

def iso(t, ms=False):
    if t is None:
        return ''
    whole = math.floor(t)
    g = datetime.datetime(1970, 1, 1) + datetime.timedelta(seconds=whole)
    base = g.strftime('%Y-%m-%dT%H:%M:%S')
    if ms:
        return base + '.%03dZ' % round((t - whole) * 1000)
    return base + 'Z'

def iso_minute(t):
    return iso(math.floor(t / 60) * 60)

def day_of(t):
    return iso(math.floor(t / 86400) * 86400)[:10]

def day_start(dstr):
    return ts(dstr + 'T00:00:00Z')

CUTOFF = ts('2026-11-22T10:00:00Z')
DAY = 86400.0

# ---------------------------------------------------------------- csv
def read_csv(path):
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))

def fmt(x):
    if x is None:
        return ''
    if isinstance(x, bool):
        return '1' if x else '0'
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            return ''
        return '%.12g' % x
    return str(x)

def write_table(name, cols, rows):
    path = os.path.join(TABLES, name + '.csv')
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(cols)
        for r in rows:
            w.writerow([fmt(r.get(c)) for c in cols])
    return len(rows)

class Metrics:
    def __init__(self):
        self.rows = []
    def add(self, q, metric, value, group=''):
        self.rows.append((q, group, metric, fmt(value)))
    def write(self, path):
        order = {}
        with open(path, 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(['question', 'group', 'metric', 'value'])
            for r in self.rows:
                w.writerow(r)

# ---------------------------------------------------------------- stats
def fnum(x):
    if x is None or x == '':
        return None
    return float(x)

def mean(v):
    return sum(v) / len(v) if v else None

def sd(v):
    n = len(v)
    if n < 2:
        return None
    m = sum(v) / n
    return math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1))

def quantile7(v, p):
    s = sorted(v)
    n = len(s)
    if n == 0:
        return None
    h = (n - 1) * p
    lo = math.floor(h)
    hi = min(lo + 1, n - 1)
    return s[lo] + (h - lo) * (s[hi] - s[lo])

def median(v):
    return quantile7(v, 0.5)

def pearson(x, y):
    n = len(x)
    if n < 2:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)

def ols_slope(x, y):
    n = len(x)
    if n < 2:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    if sxx <= 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / sxx

def rnd_half_away(x, nd=0):
    f = 10 ** nd
    return math.copysign(math.floor(abs(x) * f + 0.5), x) / f

def h100(level):
    """level (ft) -> integer hundredths, half away from zero."""
    return int(rnd_half_away(level * 100.0, 0))

# ---------------------------------------------------------------- readings
def load_readings(fname, cutoff=CUTOFF):
    """-> dict (gauge,param) -> dict epoch -> (value float, lm epoch or None). Blank values skipped; after cutoff skipped."""
    out = collections.defaultdict(dict)
    nblank = 0
    for r in read_csv(os.path.join(TIDY, fname)):
        t = ts(r['time_utc'])
        if t > cutoff:
            continue
        if r['value'] == '':
            nblank += 1
            continue
        lm = ts(r['last_modified_utc']) if r['last_modified_utc'] else None
        out[(r['gauge'], r['parameter'])][t] = (float(r['value']), lm)
    return out

# ---------------------------------------------------------------- series preparation
class Prepared:
    """Common-part section 3 preparation of one series over [w0, w1]."""
    def __init__(self, readings, w0, w1, name=''):
        self.name = name
        self.w0, self.w1 = w0, w1
        times = sorted(readings)
        inwin = [t for t in times if w0 <= t <= w1]
        dc = collections.Counter(round(b - a) for a, b in zip(inwin, inwin[1:]))
        best = max(dc.values())
        cands = sorted(k for k, v in dc.items() if v == best)
        self.step = cands[0]
        self.tie = len(cands) > 1
        st = self.step
        self.n = int(round((w1 - w0) / st)) + 1
        n = self.n
        vals = [None] * n
        present = filled = 0
        outside_nb = 0
        for i in range(n):
            t = w0 + i * st
            if t in readings:
                vals[i] = readings[t][0]
                present += 1
            else:
                j = bisect.bisect_left(times, t)
                if 0 < j < len(times):
                    a, b = times[j - 1], times[j]
                    if b - a <= 1800:
                        va, vb = readings[a][0], readings[b][0]
                        vals[i] = va + (vb - va) * (t - a) / (b - a)
                        filled += 1
                        if a < w0 or b > w1:
                            outside_nb += 1
        self.vals = vals
        self.present, self.filled = present, filled
        self.missing = n - present - filled
        self.filled_with_outside_neighbour = outside_nb
        # prefix sums
        ps = [0.0] * (n + 1)
        pc = [0] * (n + 1)
        for i, v in enumerate(vals):
            ps[i + 1] = ps[i] + (v if v is not None else 0.0)
            pc[i + 1] = pc[i] + (1 if v is not None else 0)
        self.ps, self.pc = ps, pc
        half = int(round(12 * 3600 / st))
        self.half = half
        ma = [None] * n
        for i in range(half, n - half):
            tot = 2 * half + 1
            c = pc[i + half + 1] - pc[i - half]
            if 100 * c >= 95 * tot:
                ma[i] = (ps[i + half + 1] - ps[i - half]) / c
        self.ma = ma

    def idx(self, t):
        k = (t - self.w0) / self.step
        if abs(k - round(k)) > 1e-9:
            return None
        return int(round(k))

    def day_range(self, dstr):
        t0 = day_start(dstr)
        i0 = math.ceil((t0 - self.w0) / self.step - 1e-9)
        i1 = math.ceil((t0 + DAY - self.w0) / self.step - 1e-9)  # exclusive
        i0 = max(i0, 0)
        i1 = min(i1, self.n)
        return i0, i1

    def day_mean(self, dstr):
        i0, i1 = self.day_range(dstr)
        if i1 <= i0:
            return None
        c = self.pc[i1] - self.pc[i0]
        tot = i1 - i0
        if 100 * c < 90 * tot:
            return None
        return (self.ps[i1] - self.ps[i0]) / c

    def ma_at(self, t):
        i = self.idx(t)
        if i is None or i < 0 or i >= self.n:
            return None
        return self.ma[i]

    def event_day(self, dstr):
        t0 = day_start(dstr)
        a = self.ma_at(t0)
        b = self.ma_at(t0 + DAY)
        if a is None or b is None:
            return True
        return abs(b - a) / a > 0.10

def days_between(d0, d1):
    out = []
    t = day_start(d0)
    e = day_start(d1)
    while t <= e:
        out.append(day_of(t))
        t += DAY
    return out

def prev_day(dstr, k=1):
    return day_of(day_start(dstr) - k * DAY)

# ---------------------------------------------------------------- bootstrap
_U = None
def uniforms():
    global _U
    if _U is None:
        rows = read_csv(os.path.join(TIDY, 'boot_uniforms.csv'))
        _U = [[float(r['u%d' % k]) for k in range(1, 121)] for r in rows]
    return _U

def boot_ci_blocks(blocks, stat_fn):
    """blocks: dict key -> list of rows. stat_fn(list_of_rows)->value or None. Day-block bootstrap.
    Returns (lo, hi, n_skipped). blocks sorted by key."""
    keys = sorted(blocks)
    D = len(keys)
    assert D <= 60
    U = uniforms()
    vals = []
    skipped = 0
    for b in range(len(U)):
        pooled = []
        for k in range(D):
            pooled.extend(blocks[keys[int(math.floor(U[b][k] * D))]])
        v = stat_fn(pooled)
        if v is None:
            skipped += 1
        else:
            vals.append(v)
    if skipped > 0.05 * len(U) or not vals:
        return None, None, skipped
    return quantile7(vals, 0.025), quantile7(vals, 0.975), skipped

def boot_mean_ci(rows):
    """rows: list of (block_key, value). CI of the mean via per-block sums (fast)."""
    blocks = collections.defaultdict(lambda: [0.0, 0])
    for k, v in rows:
        blocks[k][0] += v
        blocks[k][1] += 1
    keys = sorted(blocks)
    D = len(keys)
    if D == 0:
        return None, None, 0
    assert D <= 60
    U = uniforms()
    sums = [blocks[k][0] for k in keys]
    cnts = [blocks[k][1] for k in keys]
    vals = []
    for b in range(len(U)):
        s = 0.0
        c = 0
        ub = U[b]
        for k in range(D):
            j = int(math.floor(ub[k] * D))
            s += sums[j]
            c += cnts[j]
        vals.append(s / c)
    return quantile7(vals, 0.025), quantile7(vals, 0.975), 0

def boot_diff_ci(rows1, rows2):
    """two groups; statistic = mean(group2) - mean(group1). Returns lo, hi, skipped."""
    def agg(rows):
        blocks = collections.defaultdict(lambda: [0.0, 0])
        for k, v in rows:
            blocks[k][0] += v
            blocks[k][1] += 1
        keys = sorted(blocks)
        return [blocks[k][0] for k in keys], [blocks[k][1] for k in keys]
    s1, c1 = agg(rows1)
    s2, c2 = agg(rows2)
    D1, D2 = len(s1), len(s2)
    if D1 == 0 or D2 == 0:
        return None, None, 0
    assert D1 <= 60 and D2 <= 60
    U = uniforms()
    vals = []
    for b in range(len(U)):
        ub = U[b]
        a = n1 = 0
        for k in range(D1):
            j = int(math.floor(ub[k] * D1))
            a += s1[j]; n1 += c1[j]
        bb = n2 = 0
        for k in range(D2):
            j = int(math.floor(ub[60 + k] * D2))
            bb += s2[j]; n2 += c2[j]
        vals.append(bb / n2 - a / n1)
    return quantile7(vals, 0.025), quantile7(vals, 0.975), 0

# ---------------------------------------------------------------- interpolation
def interp_at(times, vals_by_t, t):
    """linear interpolation between neighbouring non-blank readings (times sorted list); exact hit returns reading."""
    if t in vals_by_t:
        return vals_by_t[t][0]
    j = bisect.bisect_left(times, t)
    if j == 0 or j == len(times):
        return None
    a, b = times[j - 1], times[j]
    va, vb = vals_by_t[a][0], vals_by_t[b][0]
    return va + (vb - va) * (t - a) / (b - a)

def nearest_within(times, t, tol):
    """nearest time within tol seconds, earlier one on a tie; None if none."""
    j = bisect.bisect_left(times, t)
    cands = []
    if j > 0:
        cands.append(times[j - 1])
    if j < len(times):
        cands.append(times[j])
    best = None
    for c in cands:  # earlier first
        d = abs(c - t)
        if d <= tol and (best is None or d < abs(best - t)):
            best = c
    return best

PHASE_ORDER = ['OLD', 'TRANS', 'NEW']
