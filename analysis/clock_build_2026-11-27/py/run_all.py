#!/usr/bin/env python3
# Analysis driver for ANALYSIS_SPEC.md version 1.2 (the measured clock, replay description).
# Python 3, standard library only. Run:  python3 -I py/run_all.py   (from analysis/clock_build_2026-11-27/)
# Writes the 11 files of spec section 13.2 into its own folder (py/).
# No sum(), no math.fsum, no statistics.*, no round().

import csv
import hashlib
import math
import os
import re
import sys
import time

T_START = time.time()

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)          # analysis/clock_build_2026-11-27
OUT = HERE

HOUR = 3600000.0
CENTER = 1350000.0
TAU_BEFORE = 660000

# ----------------------------------------------------------------------------
# 1. Inputs and checksums
# ----------------------------------------------------------------------------
INPUTS = [
    ("S01_sha_shadow_OLD", "shadow_OLD", "../onset_correction_2026-11-25/replay_L/shadow_L.csv", 109952178,
     "dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba"),
    ("S02_sha_learn_OLD", "learn_OLD", "../onset_correction_2026-11-25/replay_L/learn_L.csv", 5197278,
     "be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6"),
    ("S03_sha_counts_OLD", "counts_OLD", "../onset_correction_2026-11-25/replay_L/counts_L.txt", 1200,
     "2413d7da60ef9445959e75316e6868de6945678836c63ccf22675fde3a7dde7e"),
    ("S04_sha_bins_OLD", "bins_OLD", "../onset_correction_2026-11-25/replay_L/bins_L.csv", 1658625,
     "ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea"),
    ("S05_sha_hourly", "hourly", "../rising-limb-travel-backtest/hourly_backtest_data_v39.csv", 10133893,
     "d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f"),
    ("S06_sha_events", "events", "../rising-limb-travel-backtest/rising_limb_events_python_v39.csv", 24205,
     "978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44"),
    ("S07_sha_units", "units", "../clock_study_2026-11-27/py/units.csv", 27619,
     "9f912c545d4645b870749a1169dc82a8b08984e412d863a74fd368738040b883"),
    ("S08_sha_boot", "boot", "../onset_correction_2026-11-25/tools/boot_uniforms.csv", 13000392,
     "71d75af9b10c1ba4d3d9492f0e07d17497a35e01d3568d9b3ed8ab8fe528d515"),
    ("S09_sha_shadow_NEW", "shadow_NEW", "replay_NEW/shadow_L.csv", 113025453,
     "e0111ffcae8ffe135921fccc5db9a26e5d49e12ef9230f43b23dab489fdb9cc3"),
    ("S10_sha_learn_NEW", "learn_NEW", "replay_NEW/learn_L.csv", 8299789,
     "cebe8e728d7ba2ec669d5b00c63479cf62d4d01c81e7dadaa7651d5fc9f29750"),
    ("S11_sha_counts_NEW", "counts_NEW", "replay_NEW/counts_L.txt", 1200,
     "ecb415ca3ccb62b1fe3068a51455eea3f2785a0711989db51b6d89e49e43eed8"),
    ("S12_sha_bins_NEW", "bins_NEW", "replay_NEW/bins_L.csv", 2656268,
     "e6d95c886cd9060a4710da8294a252971b15e8f8935a7148c965b79d1b9678b1"),
]
PATH = {}
for _id, _name, _rel, _b, _s in INPUTS:
    PATH[_name] = os.path.normpath(os.path.join(BASE, _rel))

# ----------------------------------------------------------------------------
# checks machinery
# ----------------------------------------------------------------------------
CHECKS = []


class StopRun(Exception):
    pass


def add_check(cid, expected, got, result):
    CHECKS.append((cid, str(expected), str(got), result))
    if result == "F":
        raise StopRun(cid)


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def checks_text():
    lines = ["id,description,expected,got,result"]
    for cid, e, g, r in CHECKS:
        lines.append("%s,%s,%s,%s,%s" % (cid, cid, e, g, r))
    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------
# 2. Basic functions
# ----------------------------------------------------------------------------
def floor_half(x):
    return math.floor(x + 0.5)


def days_from_civil(Y, M, D):
    y = Y - (1 if M <= 2 else 0)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (M + (-3 if M > 2 else 9)) + 2) // 5 + D - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def key_of(predTs):
    Y = int(predTs[0:4])
    M = int(predTs[5:7])
    D = int(predTs[8:10])
    HH = int(predTs[11:13])
    return days_from_civil(Y, M, D) * 24 + HH


def epoch_ms(s):
    Y = int(s[0:4])
    M = int(s[5:7])
    D = int(s[8:10])
    HH = int(s[11:13])
    MM = int(s[14:16])
    SS = 0
    mmm = 0
    if len(s) > 16:
        SS = int(s[17:19])
        mmm = int(s[20:23])
    return (days_from_civil(Y, M, D) * 86400 + HH * 3600 + MM * 60 + SS) * 1000 + mmm


def event_to_predts(s):
    # "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:00:00.000Z"
    return s[0:10] + "T" + s[11:13] + ":00:00.000Z"


def sum_loop(xs):
    s = 0.0
    for x in xs:
        s = s + x
    return s


def median_of(xs):
    x = sorted(xs)
    n = len(x)
    if n % 2 == 1:
        return x[(n - 1) // 2]
    return (x[n // 2 - 1] + x[n // 2]) / 2.0


def percentile_sorted(x, p):
    m = len(x)
    pos = (m - 1) * p
    i = math.floor(pos)
    frac = pos - i
    if i + 1 > m - 1:
        return x[i]
    return x[i] + frac * (x[i + 1] - x[i])


def percentile(xs, p):
    return percentile_sorted(sorted(xs), p)


def f6(x):
    s = "%.6f" % x
    if s == "-0.000000":
        s = "0.000000"
    if "nan" in s or "inf" in s:
        raise ValueError("non-finite number written")
    return s


def mic(s):
    if s == "-0.000000":
        s = "0.000000"
    return int(s.replace(".", ""))


def period_of(predTs):
    if predTs < "2012-12-01T00:00:00.000Z":
        return "burnin"
    if predTs < "2020-01-01T00:00:00.000Z":
        return "design"
    return "test"


def design_month(predTs):
    return (int(predTs[0:4]) * 12 + int(predTs[5:7])) - (2012 * 12 + 12)


def test_month(predTs):
    return (int(predTs[0:4]) * 12 + int(predTs[5:7])) - (2020 * 12 + 1)


# 2.3 truth -------------------------------------------------------------------
def truth_from(m, tau):
    if isinstance(tau, int):
        lo0 = ((tau - 1350000) // 3600000) * 3600000
    else:
        lo0 = math.floor((tau - CENTER) / HOUR) * HOUR
    cLo = lo0 + CENTER
    cHi = lo0 + HOUR + CENTER
    lo = m.get(lo0)
    hi = m.get(lo0 + 3600000)
    if lo is not None and hi is not None:
        return lo + (hi - lo) * ((tau - cLo) / HOUR)
    if lo is not None and (tau - cLo) <= HOUR:
        return lo
    if hi is not None and (cHi - tau) <= HOUR:
        return hi
    return None


def in_range(v):
    return v >= 500.0 and v <= 500000.0


# 2.5 -----------------------------------------------------------------------
def cap_vals(rawUnc, corrUsed, L):
    u = rawUnc - corrUsed
    shownN = floor_half(u)
    lim = 1.2 * L
    shownP = floor_half(min(u, lim))
    capped = u > lim
    return u, shownP, shownN, capped


def err_pct(shown, truth):
    return ((shown - truth) / truth) * 100.0


# 4 clock -------------------------------------------------------------------
def clock_of(Q):
    Qc = min(max(Q, 1400.0), 20000.0)
    return 98.2 * (Qc ** -0.3935)


def stair(t, h):
    dueMs = t + h * 3600000.0
    Tv = float(math.ceil(dueMs / 3600000.0)) * 3600000.0
    tau = Tv - 660000
    return dueMs, Tv, tau


# 9.1 band -----------------------------------------------------------------
BAND = {
    "0-3000": {"rising": (-547, 369), "steady": (-271, 250), "falling": (-315, 336), "all": (-309, 284)},
    "3000-6000": {"rising": (-676, 535), "steady": (-327, 287), "falling": (-391, 361), "all": (-425, 356)},
    "6000-12000": {"rising": (-1650, 1046), "steady": (-404, 320), "falling": (-451, 359), "all": (-628, 506)},
    "12000-25000": {"rising": (-2384, 1543), "steady": (-549, 425), "falling": (-514, 464), "all": (-884, 741)},
    "25000-50000": {"rising": (-3851, 2860), "steady": (-2013, 1844), "falling": (-1068, 1059), "all": (-2402, 1899)},
    "50000+": {"rising": (-7354, 5519), "steady": (-5858, 6410), "falling": (-4099, 6429), "all": (-5858, 6410)},
}
FLOWSTATES = ("rising", "steady", "falling")


def band_of(flowBin, flowState, est):
    cell = BAND[flowBin]
    q05, q95 = cell[flowState] if flowState in cell and flowState != "all" else cell["all"]
    if flowState not in FLOWSTATES:
        q05, q95 = cell["all"]
    return max(0, est - q95), est - q05


# 8 yardsticks -------------------------------------------------------------
def yard0(L):
    return floor_half(L)


def yard1(L, L3, a, clock):
    if L3 is None or a is None:
        return yard0(L)
    return floor_half(L + max(0.0, ((L - L3) / 3.0) * (clock + a)))


def label_cap(lo, hi):
    if lo == "" or hi == "":
        return "unclear"
    if mic(lo) > 0:
        return "cap_closer"
    if mic(hi) < 0:
        return "cap_farther"
    return "unclear"


def label_yard(lo, hi):
    if lo == "" or hi == "":
        return "unclear"
    if mic(lo) > 0:
        return "app_closer"
    if mic(hi) < 0:
        return "yardstick_closer"
    return "unclear"


HOLD_LABELS = ("cap_closer", "cap_farther", "app_closer", "yardstick_closer")


def reading_of(a, b, c):
    r = a if (a == b and b == c) else "mixed"
    return r, (1 if r in HOLD_LABELS else 0)


def jumps_of(corr, raw):
    out = []
    for i in range(1, len(corr)):
        out.append((100.0 * abs(corr[i] - corr[i - 1])) / raw[i])
    return out


def move_pct(old, new):
    if old <= 0:
        return None
    return ((new - old) / old) * 100.0


# ----------------------------------------------------------------------------
# unit tests (U01 to U18)
# ----------------------------------------------------------------------------
class V:
    def __init__(self):
        self.n = 0

    def ok(self, cond):
        if not cond:
            self.n += 1


def close(a, b, tol):
    return a is not None and abs(a - b) <= tol


def u01():
    v = V()
    for x, e in ((0.5, 1), (2.4, 2), (2.5, 3), (-0.5, 0), (-1.5, -1), (8.49, 8), (8.5, 9)):
        v.ok(floor_half(x) == e)
    return v.n


def u02():
    v = V()
    v.ok(key_of("2020-01-01T00:00:00.000Z") == 438288)
    v.ok(key_of("2012-12-01T00:00:00.000Z") == 376200)
    v.ok(key_of("2019-12-31T23:00:00.000Z") == 438287)
    v.ok(key_of("2026-11-09T23:00:00.000Z") == 498407)
    v.ok(key_of("1970-01-01T00:00:00.000Z") == 0)
    return v.n


def u03():
    v = V()
    v.ok(epoch_ms("2012-01-01 00:00") == 1325376000000)
    v.ok(epoch_ms("1970-01-01 00:30") == 1800000)
    v.ok(epoch_ms("2013-06-01T05:49:00.000Z") == 1370065740000)
    v.ok(epoch_ms("2013-06-01T05:49:00.000Z") == epoch_ms("2013-06-01 05:49"))
    v.ok(epoch_ms("2020-06-01T05:00:00.000Z") == 1590987600000)
    c = event_to_predts("2015-06-20 12:00")
    v.ok(c == "2015-06-20T12:00:00.000Z")
    v.ok(key_of(c) == 398556)
    return v.n


def u04():
    v = V()
    x = [float(i) for i in range(1, 10001)]
    v.ok(close(percentile_sorted(x, 0.025), 250.975, 1e-9))
    v.ok(close(percentile_sorted(x, 0.975), 9750.025, 1e-9))
    y = [float(i) for i in range(1, 12)]
    v.ok(close(percentile_sorted(y, 0.05), 1.5, 1e-9))
    v.ok(close(percentile_sorted(y, 0.95), 10.5, 1e-9))
    v.ok(median_of(y) == 6)
    v.ok(median_of([1.0, 2.0, 3.0, 4.0]) == 2.5)
    return v.n


def u05():
    v = V()
    v.ok(mic("0.500000") == 500000)
    v.ok(mic("-0.020000") == -20000)
    v.ok(mic("10.000000") == 10000000)
    v.ok(mic("-1.000000") == -1000000)
    w = f6(-0.0000001)
    v.ok(w == "0.000000")
    v.ok(mic(w) == 0)
    return v.n


def u06():
    v = V()
    m = {0: 1000.0, 3600000: 2000.0, 10800000: 4000.0}
    v.ok(close(truth_from(m, 2250000), 1250.0, 1e-9))
    v.ok(close(truth_from(m, 1350000), 1000.0, 1e-9))
    v.ok(close(truth_from(m, 3150000), 1500.0, 1e-9))
    v.ok(close(truth_from(m, 1349999), 1000.0, 1e-9))
    v.ok(close(truth_from(m, 5400000), 2000.0, 1e-9))
    v.ok(close(truth_from(m, 8551000), 4000.0, 1e-9))
    v.ok(truth_from(m, 18000000 + 1350000 + 5) is None)
    v.ok(close(truth_from(m, 2250000.5), 1250.000138888889, 1e-9))
    v.ok(in_range(500.0))
    v.ok(not in_range(499.9))
    v.ok(in_range(500000.0))
    v.ok(not in_range(500000.1))
    return v.n


def boot_index(n, B):
    return (n * B) // 10 ** 12


def u07():
    v = V()
    v.ok(boot_index(0, 85) == 0)
    v.ok(boot_index(999999999999, 85) == 84)
    v.ok(boot_index(0, 83) == 0)
    v.ok(boot_index(999999999999, 83) == 82)
    v.ok(boot_index(500000000000, 7) == 3)
    with open(PATH["boot"], newline="", encoding="utf-8") as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        next(rd)
        row = next(rd)
    n0 = int(row[0])
    v.ok(n0 == 343638232196)
    v.ok(boot_index(n0, 85) == 29)
    v.ok(boot_index(n0, 83) == 28)
    return v.n


def u08():
    v = V()
    v.ok(period_of("2019-12-31T23:00:00.000Z") == "design")
    v.ok(period_of("2020-01-01T00:00:00.000Z") == "test")
    v.ok(period_of("2012-11-30T23:00:00.000Z") == "burnin")
    v.ok(period_of("2012-12-01T00:00:00.000Z") == "design")
    v.ok(design_month("2012-12-01T00:00:00.000Z") == 0)
    v.ok(design_month("2019-12-01T00:00:00.000Z") == 84)
    v.ok(test_month("2020-01-01T00:00:00.000Z") == 0)
    v.ok(test_month("2026-11-01T00:00:00.000Z") == 82)
    return v.n


def u09():
    v = V()
    e = err_pct(850, 1000)
    v.ok(e == -15 and abs(e) >= 15 and e <= -15)
    e = err_pct(1150, 1000)
    v.ok(e == 15 and abs(e) >= 15 and e >= 15)
    e = err_pct(17, 20)
    v.ok(e == -15)
    e = err_pct(1149, 1000)
    v.ok(close(e, 14.9, 1e-9) and abs(e) < 15)
    return v.n


def u10():
    v = V()
    u, sp, sn, cp = cap_vals(2600.0, 100.0, 1500.0)
    v.ok(sp == 1800 and sn == 2500 and cp)
    u, sp, sn, cp = cap_vals(1900.0, 100.0, 1500.0)
    v.ok(sp == 1800 and (not cp))
    u, sp, sn, cp = cap_vals(1901.0, 100.0, 1500.0)
    v.ok(sp == 1800 and sn == 1801 and cp)
    u, sp, sn, cp = cap_vals(1700.5, 0.0, 1500.0)
    v.ok(sn == 1701)
    return v.n


def u11():
    v = V()
    v.ok(close(clock_of(1000.0), 5.676885120152289, 1e-9))
    v.ok(close(clock_of(1400.0), 5.676885120152289, 1e-9))
    v.ok(close(clock_of(3000.0), 4.205951632159436, 1e-9))
    v.ok(close(clock_of(5000.0), 3.440066128281308, 1e-9))
    v.ok(close(clock_of(10000.0), 2.6188552085600927, 1e-9))
    v.ok(close(clock_of(20000.0), 1.9936833617872496, 1e-9))
    v.ok(close(clock_of(50000.0), 1.9936833617872496, 1e-9))
    c = clock_of(3000.0)
    v.ok(close(1.23 * c, 5.173320507556106, 1e-9))
    v.ok(close(0.30 * c, 1.2617854896478307, 1e-9))
    return v.n


def u12():
    v = V()
    t = epoch_ms("2020-06-01T05:00:00.000Z")
    v.ok(t == 1590987600000)
    tau = t + 4.2 * 3600000.0
    v.ok(close(tau, 1591002720000, 1e-3))
    due, Tv, tau = stair(t, 4.2)
    v.ok(Tv == 1591005600000 and tau == 1591004940000)
    due, Tv, tau = stair(t, 4.0)
    v.ok(Tv == 1591002000000 and tau == 1591001340000)
    due, Tv, tau = stair(t, 0.5981050085361749)
    v.ok(Tv == 1590991200000)
    return v.n


def u13():
    v = V()
    lo, hi = band_of("3000-6000", "rising", 4000)
    v.ok(lo == 3465 and hi == 4676)
    v.ok(lo <= 3465 and 3465 <= hi)
    v.ok(not (lo <= 3464 and 3464 <= hi))
    v.ok(lo <= 4676 and 4676 <= hi)
    v.ok(not (lo <= 4677 and 4677 <= hi))
    lo, hi = band_of("0-3000", "steady", 300)
    v.ok(lo == 50 and hi == 571)
    lo, hi = band_of("0-3000", "steady", 100)
    v.ok(lo == 0 and hi == 371)
    lo, hi = band_of("50000+", "falling", 60000)
    v.ok(lo == 53571 and hi == 64099)
    lo, hi = band_of("6000-12000", "weird", 8000)
    v.ok(lo == 7494 and hi == 8628)
    return v.n


def u14():
    v = V()
    v.ok(yard1(1000.0, 910.0, 1.0, 4.0) == 1150)
    v.ok(yard1(1000.0, 1100.0, 1.0, 4.0) == 1000)
    v.ok(yard1(1000.0, None, 1.0, 4.0) == 1000)
    v.ok(yard1(1000.0, 910.0, None, 4.0) == 1000)
    v.ok(yard0(1000.4) == 1000)
    v.ok(yard0(1000.5) == 1001)
    return v.n


def u15():
    v = V()
    m = move_pct(1000.0, 950.0)
    v.ok(m == -5 and abs(m) >= 5.0 and m < 0)
    m = move_pct(1000.0, 1049.0)
    v.ok(close(m, 4.9, 1e-9) and not (abs(m) >= 5.0))
    v.ok(move_pct(0.0, 5.0) is None)
    return v.n


def u16():
    v = V()
    v.ok(label_cap("0.100000", "0.300000") == "cap_closer")
    v.ok(label_cap("-0.300000", "-0.100000") == "cap_farther")
    v.ok(label_cap("-0.100000", "0.200000") == "unclear")
    v.ok(label_cap("0.000000", "0.200000") == "unclear")
    v.ok(label_cap("-0.200000", "0.000000") == "unclear")
    v.ok(label_cap("", "0.200000") == "unclear")
    v.ok(label_cap("0.000001", "0.200000") == "cap_closer")
    v.ok(label_yard("0.100000", "0.300000") == "app_closer")
    v.ok(label_yard("-0.300000", "-0.100000") == "yardstick_closer")
    v.ok(label_yard("-0.100000", "0.200000") == "unclear")
    v.ok(label_yard("", "") == "unclear")
    return v.n


def u17():
    v = V()
    v.ok(reading_of("cap_closer", "cap_closer", "cap_closer") == ("cap_closer", 1))
    v.ok(reading_of("cap_closer", "unclear", "cap_closer") == ("mixed", 0))
    v.ok(reading_of("unclear", "unclear", "unclear") == ("unclear", 0))
    v.ok(reading_of("app_closer", "app_closer", "app_closer") == ("app_closer", 1))
    v.ok(reading_of("cap_farther", "cap_closer", "cap_farther") == ("mixed", 0))
    v.ok(reading_of("yardstick_closer", "yardstick_closer", "yardstick_closer") == ("yardstick_closer", 1))
    return v.n


def u18():
    v = V()
    j = jumps_of([100.0, 160.0, 100.0], [1000.0, 1000.0, 1000.0])
    v.ok(len(j) == 2 and j[0] == 6 and j[1] == 6)
    c = 0
    for x in j:
        if x >= 5.0:
            c += 1
    v.ok(c == 2)
    j = jumps_of([100.0, 104.0, 100.0], [1000.0, 1000.0, 1000.0])
    v.ok(close(j[0], 0.4, 1e-9) and close(j[1], 0.4, 1e-9))
    c = 0
    for x in j:
        if x >= 5.0:
            c += 1
    v.ok(c == 0)
    return v.n


UNITS_LIST = [
    ("U01_round", u01), ("U02_key", u02), ("U03_time", u03), ("U04_percentile", u04), ("U05_mic", u05),
    ("U06_truth", u06), ("U07_boot_index", u07), ("U08_periods", u08), ("U09_error", u09), ("U10_cap", u10),
    ("U11_clock", u11), ("U12_due", u12), ("U13_band", u13), ("U14_yard", u14), ("U15_move", u15),
    ("U16_labels", u16), ("U17_reading", u17), ("U18_jump", u18),
]


def count_check(cid, nviol):
    add_check(cid, "0", str(nviol), "P" if nviol == 0 else "F")


# ----------------------------------------------------------------------------
# file readers
# ----------------------------------------------------------------------------
def sha_and_size(path):
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
            n += len(b)
    return h.hexdigest(), n


def read_csv_rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        rows = []
        for r in rd:
            if r and r[-1].endswith("\r"):
                r[-1] = r[-1][:-1]
            rows.append(r)
    return rows


COLS_TEXT_OLD = ["predTs", "status", "flowBin", "flowState", "valHourTs", "tauTs", "truthInProdRange",
                 "truthDependentHard", "rawFinalCFS", "rawUnc", "lfCap", "lfQ", "age_lf_h", "travelPoRtoGF",
                 "travelGFtoLF", "predictedCFS", "corrUsed", "truthFlow", "errPctCorr"]
COLS_19 = ["predTs", "status", "flowBin", "flowState", "predictedCFS", "rawFinalCFS", "rawUnc", "corrUsed",
           "lfCap", "lfQ", "age_lf_h", "travelPoRtoGF", "travelGFtoLF", "valHourTs", "tauTs", "truthFlow",
           "truthInProdRange", "truthDependentHard", "errPctCorr"]


def read_shadow(path, names, expected_ncols):
    """One pass; keep only the named columns as lists of strings. Returns (header, cols, nrows, nbadfields)."""
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.reader(f, quoting=csv.QUOTE_NONE)
        header = next(rd)
        if header and header[-1].endswith("\r"):
            header[-1] = header[-1][:-1]
        pos = {}
        for nm in names:
            if header.count(nm) == 1:
                pos[nm] = header.index(nm)
        cols = {nm: [] for nm in names}
        nrows = 0
        nbad = 0
        for row in rd:
            if row and row[-1].endswith("\r"):
                row[-1] = row[-1][:-1]
            nrows += 1
            ln = len(row)
            if ln != expected_ncols:
                nbad += 1
            for nm in names:
                p = pos.get(nm)
                cols[nm].append(row[p] if (p is not None and p < ln) else "")
    return header, cols, nrows, nbad


def blank(s):
    return s == ""


# ----------------------------------------------------------------------------
# main pipeline
# ----------------------------------------------------------------------------
def main():
    # ---------------- U checks ----------------
    for cid, fn in UNITS_LIST:
        count_check(cid, fn())

    # ---------------- S01 to S12 ----------------
    for cid, name, rel, nbytes, sha in INPUTS:
        s, n = sha_and_size(PATH[name])
        exp = "%s:%d" % (sha, nbytes)
        got = "%s:%d" % (s, n)
        add_check(cid, exp, got, "P" if exp == got else "F")

    # ---------------- read files ----------------
    names_new = COLS_19 + ["clockQ", "clockHrs"]
    hdrO, O, nO, badO = read_shadow(PATH["shadow_OLD"], COLS_19, 87)
    hdrN, N, nN, badN = read_shadow(PATH["shadow_NEW"], names_new, 89)

    NR = nO  # rows (aligned by S15)
    K0 = 367421

    # hourly
    with open(PATH["hourly"], encoding="utf-8", newline="") as f:
        htxt = f.read()
    hlines = htxt.strip().split("\n")
    hlines_data = hlines[1:]
    hmap = {}
    h_viol = 0
    prev_ts = None
    for ln in hlines_data:
        fld = ln.split(",")
        if len(fld) != 12:
            h_viol += 1
            continue
        ts = fld[0]
        if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:00$", ts):
            h_viol += 1
            continue
        if prev_ts is not None and not (ts > prev_ts):
            h_viol += 1
        prev_ts = ts
        lf = fld[4]
        if lf != "":
            try:
                val = float(lf)
            except ValueError:
                h_viol += 1
                continue
            if not (val > 0):
                h_viol += 1
            hmap[epoch_ms(ts)] = val
    n_hourly = len(hlines_data)

    # events, units, boot, learn, counts
    ev_rows = read_csv_rows(PATH["events"])
    ev_header = ev_rows[0]
    ev_data = ev_rows[1:]
    un_rows = read_csv_rows(PATH["units"])
    un_header = un_rows[0]
    un_data = un_rows[1:]
    boot_rows = read_csv_rows(PATH["boot"])
    boot_header = boot_rows[0]
    boot_data = boot_rows[1:]

    def read_learn(path):
        with open(path, newline="", encoding="utf-8") as f:
            rd = csv.reader(f, quoting=csv.QUOTE_NONE)
            header = next(rd)
            if header and header[-1].endswith("\r"):
                header[-1] = header[-1][:-1]
            pos = {nm: header.index(nm) for nm in ("predTs", "tauTs", "outcome", "clamped")}
            out = {nm: [] for nm in pos}
            for row in rd:
                if row and row[-1].endswith("\r"):
                    row[-1] = row[-1][:-1]
                for nm, p in pos.items():
                    out[nm].append(row[p] if p < len(row) else "")
        return out

    LO = read_learn(PATH["learn_OLD"])
    LN = read_learn(PATH["learn_NEW"])

    # ---------------- S13 to S16 ----------------
    got = "%d:%d" % (nO, nN)
    add_check("S13_rows", "130987:130987", got, "P" if got == "130987:130987" else "F")

    count_check("S14_fields", badO + badN)

    viol = 0
    # header names exactly once
    for nm in COLS_19:
        if hdrO.count(nm) != 1:
            viol += 1
    for nm in names_new:
        if hdrN.count(nm) != 1:
            viol += 1
    if ",".join(hdrN) != ",".join(hdrO) + ",clockQ,clockHrs":
        viol += 1
    pat = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):00:00\.000Z$")
    for label, F in (("O", O), ("N", N)):
        prev = None
        pts = F["predTs"]
        for i in range(len(pts)):
            s = pts[i]
            if not pat.match(s):
                viol += 1
                prev = None
                continue
            k = key_of(s)
            if i == 0:
                if k != 367421:
                    viol += 1
            else:
                if prev is None or k != prev + 1:
                    viol += 1
            prev = k
        if len(pts) > 0:
            if prev != 498407:
                viol += 1
    count_check("S15_header_grid", viol)

    viol = h_viol
    if n_hourly != 130416:
        viol += 1
    if len(ev_data) != 87:
        viol += 1
    for r in ev_data:
        if len(r) != 47:
            viol += 1
    for nm in ("event_id", "event_t0", "event_class", "rl_start", "rl_end", "kept"):
        if ev_header.count(nm) != 1:
            viol += 1
    if ",".join(un_header) != "unit_id,kind,event_id,cluster,onset_key,peak_key,start_key,a,b,n_hours,q,qclass,period,lf_start,lf_peak,share_lower,share_upper,share_whole,dr_fallback":
        viol += 1
    if len(un_data) != 225:
        viol += 1
    kind_ct = {"event": 0, "small": 0, "bump": 0, "recession": 0}
    for r in un_data:
        kd = r[1]
        if kd in kind_ct:
            kind_ct[kd] += 1
        else:
            viol += 1
    if (kind_ct["event"], kind_ct["small"], kind_ct["bump"], kind_ct["recession"]) != (53, 33, 86, 53):
        viol += 1
    if len(boot_data) != 10000:
        viol += 1
    if len(boot_header) != 100:
        viol += 1
    for r in boot_data:
        if len(r) != 100:
            viol += 1
    if len(LO["predTs"]) != 23688:
        viol += 1
    if len(LN["predTs"]) != 37913:
        viol += 1
    count_check("S16_other_rows", viol)

    # ---------------- derived per-row arrays ----------------
    def num_or_none(s):
        return None if s == "" else float(s)

    perN = [period_of(s) for s in O["predTs"]]  # period of each row (same in both files)
    hasO = [(O["predictedCFS"][i] != "" and O["rawUnc"][i] != "" and O["corrUsed"][i] != "") for i in range(NR)]
    hasN = [(N["predictedCFS"][i] != "" and N["rawUnc"][i] != "" and N["corrUsed"][i] != "") for i in range(NR)]

    def getf(F, name, i):
        s = F[name][i]
        return None if s == "" else float(s)

    # lfCap numeric for OLD (group decisions) -- blank -> None
    lfO = [num_or_none(s) for s in O["lfCap"]]

    # units
    unit_by_id = {}
    for r in un_data:
        unit_by_id[r[0]] = r
    win_all = [False] * NR      # [a, b] of any unit
    limb_ev = [False] * NR      # event, small
    limb_evb = [False] * NR     # event, small, bump

    def mark(arr, lo, hi):
        lo2 = max(lo, K0)
        hi2 = min(hi, K0 + NR - 1)
        for k in range(lo2, hi2 + 1):
            arr[k - K0] = True

    for r in un_data:
        kind = r[1]
        a = int(r[7])
        b = int(r[8])
        mark(win_all, a, b)
        if kind in ("event", "small", "bump"):
            sk = int(r[6])
            pk = int(r[5 + 0]) if False else int(r[5])
            # peak_key is column index 5 (header: unit_id,kind,event_id,cluster,onset_key,peak_key,start_key,...)
            mark(limb_evb, sk, pk)
            if kind in ("event", "small"):
                mark(limb_ev, sk, pk)

    # selected rises
    ei = {nm: ev_header.index(nm) for nm in ("event_id", "event_t0", "event_class", "rl_start", "rl_end", "kept")}
    rises = []
    for r in ev_data:
        if r[ei["event_class"]] == "GATE" and r[ei["kept"]] == "1":
            rises.append({
                "id": r[ei["event_id"]], "t0": r[ei["event_t0"]],
                "s": event_to_predts(r[ei["rl_start"]]), "e": event_to_predts(r[ei["rl_end"]]),
            })
    for rs in rises:
        u = unit_by_id.get("E" + rs["id"])
        if u is None or u[15] == "":
            rs["status"] = "unk"
        else:
            sh = float(u[15])
            rs["status"] = "creek" if sh > 0.15 else "not"
        rs["period"] = "design" if rs["t0"] < "2020-01-01 00:00" else "test"

    rise_of = [None] * NR        # first rise index of the limb
    overlap_ct = 0
    pts = O["predTs"]
    for i in range(NR):
        if not hasO[i] or perN[i] == "burnin":
            continue
        s = pts[i]
        found = []
        for ri, rs in enumerate(rises):
            if rs["s"] <= s and s <= rs["e"]:
                found.append(ri)
        if len(found) >= 2:
            overlap_ct += 1
        if found:
            rise_of[i] = found[0]

    GROUPS11 = ["all", "lf_rising", "rl_rises", "rl_rises_bump", "low_water", "high_12_20", "high_20plus",
                "rl_large", "rl_large_creekfed", "rl_large_notcreek", "rl_large_shareunk"]
    GROUPS10 = GROUPS11[:10]
    grp = {g: [False] * NR for g in GROUPS11}
    for i in range(NR):
        if not hasO[i] or perN[i] == "burnin":
            continue
        L = lfO[i]
        grp["all"][i] = True
        if i - 6 >= 0 and lfO[i - 6] is not None and L is not None:
            if L >= 1.10 * lfO[i - 6]:
                grp["lf_rising"][i] = True
        grp["rl_rises"][i] = limb_ev[i]
        grp["rl_rises_bump"][i] = limb_evb[i]
        if L is not None:
            if L < 3000.0 and not win_all[i]:
                grp["low_water"][i] = True
            if L >= 12000.0 and L < 20000.0:
                grp["high_12_20"][i] = True
            if L >= 20000.0:
                grp["high_20plus"][i] = True
        if rise_of[i] is not None:
            grp["rl_large"][i] = True
            st = rises[rise_of[i]]["status"]
            if st == "creek":
                grp["rl_large_creekfed"][i] = True
            elif st == "not":
                grp["rl_large_notcreek"][i] = True
            else:
                grp["rl_large_shareunk"][i] = True

    base = [i for i in range(NR) if hasO[i] and perN[i] != "burnin"]
    PERIODS = ("design", "test")

    gcount = {p: {g: 0 for g in GROUPS11} for p in PERIODS}
    for i in base:
        for g in GROUPS11:
            if grp[g][i]:
                gcount[perN[i]][g] += 1

    G_EXPECT = {
        "design": [60663, 4428, 2220, 3256, 10381, 10858, 11643, 275, 167, 108, 0],
        "test": [60120, 4514, 2975, 4488, 16140, 7271, 4480, 452, 159, 293, 0],
    }
    gid = 1
    for p in PERIODS:
        for gi, g in enumerate(GROUPS11):
            cid = "G%02d_%s_%s" % (gid, p, g)
            e = G_EXPECT[p][gi]
            gg = gcount[p][g]
            add_check(cid, str(e), str(gg), "P" if e == gg else "F")
            gid += 1

    # G23
    cnt = {}
    for rs in rises:
        cnt[(rs["period"], rs["status"])] = cnt.get((rs["period"], rs["status"]), 0) + 1
    nd = len([1 for rs in rises if rs["period"] == "design"])
    nt = len([1 for rs in rises if rs["period"] == "test"])
    got = "%d:%d:%d:%d:%d:%d:%d:%d" % (nd, nt, cnt.get(("design", "creek"), 0), cnt.get(("test", "creek"), 0),
                                       cnt.get(("design", "not"), 0), cnt.get(("test", "not"), 0),
                                       cnt.get(("design", "unk"), 0), cnt.get(("test", "unk"), 0))
    add_check("G23_rises", "8:13:5:5:3:8:0:0", got, "P" if got == "8:13:5:5:3:8:0:0" else "F")
    count_check("G24_limb_overlap", overlap_ct)

    # ---------------- B01 ----------------
    FLOWBINS = set(BAND.keys())
    viol = 0
    for label, F, Hh in (("O", O, hasO), ("N", N, hasN)):
        for i in range(NR):
            if Hh[i]:
                bad = False
                for nm in ("predictedCFS", "rawUnc", "corrUsed", "lfCap", "lfQ", "age_lf_h", "flowBin", "flowState",
                           "travelGFtoLF", "valHourTs", "tauTs"):
                    if F[nm][i] == "":
                        bad = True
                if label == "N":
                    if F["clockQ"][i] == "" or F["clockHrs"][i] == "":
                        bad = True
                if not bad:
                    if F["flowState"][i] not in FLOWSTATES:
                        bad = True
                    if F["flowBin"][i] not in FLOWBINS:
                        bad = True
                    if not (float(F["lfCap"][i]) > 0):
                        bad = True
                    if not (float(F["predictedCFS"][i]) > 0):
                        bad = True
                if bad:
                    viol += 1
            else:
                if F["status"][i] in ("predicted", "no_truth"):
                    viol += 1
    count_check("B01_inputs_wellformed", viol)

    # B02
    viol = 0
    for i in range(NR):
        if hasO[i] != hasN[i]:
            viol += 1
    count_check("B02_same_hours", viol)

    # B03
    viol = 0
    B03COLS = ("rawUnc", "rawFinalCFS", "flowBin", "flowState", "lfCap", "lfQ", "age_lf_h", "travelPoRtoGF",
               "travelGFtoLF")
    i02 = 0
    for i in range(NR):
        if hasO[i] or hasN[i]:
            for nm in B03COLS:
                if O[nm][i] != N[nm][i]:
                    viol += 1
                    break
            if O["travelGFtoLF"][i] != N["travelGFtoLF"][i]:
                i02 += 1
    count_check("B03_raw_same", viol)

    # numeric arrays (est hours only; others None)
    def fl(F, name, Hh):
        return [(float(F[name][i]) if Hh[i] else None) for i in range(NR)]

    predO = fl(O, "predictedCFS", hasO)
    predN = fl(N, "predictedCFS", hasN)
    rawO = fl(O, "rawUnc", hasO)
    rawN = fl(N, "rawUnc", hasN)
    corO = fl(O, "corrUsed", hasO)
    corN = fl(N, "corrUsed", hasN)
    lfN = fl(N, "lfCap", hasN)
    clockQN = fl(N, "clockQ", hasN)
    clockHN = fl(N, "clockHrs", hasN)
    trvO = fl(O, "travelGFtoLF", hasO)
    ageN = fl(N, "age_lf_h", hasN)

    # B04
    viol = 0
    clk = [None] * NR
    for i in range(NR):
        if hasN[i]:
            c = clock_of(clockQN[i])
            clk[i] = c
            if abs(clockHN[i] - c) > 1e-9:
                viol += 1
    count_check("B04_clock_cols", viol)

    # B05 / B06 / M05
    tsO_tau = [None] * NR
    m05 = 0

    def own_check(F, Hh, hcol, label):
        nonlocal m05
        viol = 0
        for i in range(NR):
            if not Hh[i]:
                continue
            t = (K0 + i) * 3600000
            h = hcol[i]
            dueMs, Tv, tau = stair(t, h)
            if abs(dueMs - 3600000.0 * math.floor(dueMs / 3600000.0 + 0.5)) < 1.0:
                m05 += 1
            tv = truth_from(hmap, int(tau))
            bad = False
            if epoch_ms(F["tauTs"][i]) != tau:
                bad = True
            if epoch_ms(F["valHourTs"][i]) != Tv:
                bad = True
            tf = F["truthFlow"][i]
            if (tv is not None) != (tf != ""):
                bad = True
            elif tv is not None:
                tfv = float(tf)
                if not (abs(tv - tfv) <= 1e-6 * max(1.0, abs(tfv))):
                    bad = True
            if bad:
                viol += 1
        return viol

    count_check("B05_new_own_truth", own_check(N, hasN, clockHN, "N"))
    count_check("B06_old_own_truth", own_check(O, hasO, trvO, "O"))

    # B07
    viol = 0
    for F, Hh, rawA, corA in ((O, hasO, rawO, corO), (N, hasN, rawN, corN)):
        for i in range(NR):
            if Hh[i]:
                u, sp, sn, cp = cap_vals(rawA[i], corA[i], float(F["lfCap"][i]))
                if not (float(sp) == float(F["predictedCFS"][i])):
                    viol += 1
    count_check("B07_shown_recomputed", viol)

    # B08 and rebuilt own truths at tauTs
    ownO = [None] * NR
    ownN = [None] * NR
    viol = 0
    for F, Hh, own in ((O, hasO, ownO), (N, hasN, ownN)):
        for i in range(NR):
            if Hh[i]:
                tv = truth_from(hmap, epoch_ms(F["tauTs"][i]))
                own[i] = tv
                if F["truthFlow"][i] != "":
                    tfv = float(F["truthFlow"][i])
                    if tv is None or not (abs(tv - tfv) <= 1e-6 * max(1.0, abs(tfv))):
                        viol += 1
    count_check("B08_own_truth_rebuilt", viol)

    # counts files
    def read_counts(path):
        with open(path, encoding="utf-8", newline="") as f:
            lines = f.read().split("\n")
        lines = [ln.lstrip(" ") for ln in lines]
        d = {}

        def sel(prefix):
            m = [ln for ln in lines if ln.startswith(prefix)]
            if len(m) != 1:
                raise RuntimeError("counts file %s: prefix %r matched %d lines" % (path, prefix, len(m)))
            return m[0][len(prefix):]
        r = sel("learning track: slots stored ")
        d["slots_stored"] = int(r.split(";")[0])
        key = "; hours a new prediction found the slot occupied "
        rest = r[r.index(key) + len(key):]
        d["slot_blocked_hours"] = int(rest)
        d["learn_validations"] = int(sel("validations (truth found, in production range): "))
        d["learned"] = int(sel("learned: "))
        d["hard_skipped"] = int(sel("hard-skipped (excluded from learning): "))
        d["retries"] = int(sel("retries (no truth or truth out of production range at the validation hour): "))
        d["dropped_missed_window"] = int(sel("dropped, missed 2.5 h window: "))
        d["pending_at_end"] = int(sel("slot still pending at end of run: "))
        return d

    CNT = {"OLD": read_counts(PATH["counts_OLD"]), "NEW": read_counts(PATH["counts_NEW"])}
    LRN = {"OLD": LO, "NEW": LN}

    # B09
    viol = 0
    lrn_period_counts = {}
    for run in ("OLD", "NEW"):
        Lr = LRN[run]
        c = CNT[run]
        n = len(Lr["predTs"])
        nl = 0
        nh = 0
        pc = {"burnin": 0, "design": 0, "test": 0}
        for i in range(n):
            if Lr["outcome"][i] == "learned":
                nl += 1
            if Lr["outcome"][i] == "hard_skipped":
                nh += 1
            pc[period_of(Lr["predTs"][i])] += 1
        lrn_period_counts[run] = pc
        if n != c["learn_validations"]:
            viol += 1
        if c["learned"] + c["hard_skipped"] != c["learn_validations"]:
            viol += 1
        if nl != c["learned"]:
            viol += 1
        if nh != c["hard_skipped"]:
            viol += 1
        if pc["burnin"] + pc["design"] + pc["test"] != c["learn_validations"]:
            viol += 1
    count_check("B09_counts_file", viol)

    # B11
    def common_truths(i):
        Q = clockQN[i]
        c = clock_of(Q)
        t = (K0 + i) * 3600000
        res = []
        for mult in (1.0, 1.23, 0.30):
            h = c if mult == 1.0 else mult * c
            tau = t + h * 3600000.0
            res.append(truth_from(hmap, tau))
        return res

    B11 = [
        ("2013-10-07T10:00:00.000Z", [1517.829896030, 1703.794713267, 1370.000000000]),
        ("2015-12-26T11:00:00.000Z", [20800.000000000, 20800.000000000, 20566.931502563]),
        ("2019-12-04T05:00:00.000Z", [3830.000000000, 3830.000000000, 3750.000000000]),
        ("2023-09-24T13:00:00.000Z", [6210.000000000, 6365.964228735, 6345.617093952]),
        ("2020-06-01T05:00:00.000Z", [11200.000000000, 11200.000000000, 11150.000000000]),
        ("2026-07-20T18:00:00.000Z", [None, None, None]),
    ]
    viol = 0
    for ts, exp in B11:
        i = key_of(ts) - K0
        got3 = common_truths(i)
        for g, e in zip(got3, exp):
            if e is None:
                if g is not None:
                    viol += 1
            else:
                if g is None or abs(g - e) > 1e-6:
                    viol += 1
    count_check("B11_common_fixed", viol)

    # ---------------- common truths over the base set ----------------
    TRUTHS = ("central", "long", "short")
    tc = {c: [None] * NR for c in TRUTHS}       # truth value
    valid = {c: [False] * NR for c in TRUTHS}
    hardO = O["truthDependentHard"]
    hardN = N["truthDependentHard"]
    acc_common = {c: [0, 0, 0, 0, 0, 0] for c in TRUTHS}   # counts dropped per step 1..5, plus left
    i04_old = 0
    i04_new = 0
    for i in base:
        t = (K0 + i) * 3600000
        cl = clk[i]
        for c, mult in (("central", 1.0), ("long", 1.23), ("short", 0.30)):
            h = cl if mult == 1.0 else mult * cl
            tau = t + h * 3600000.0
            tv = truth_from(hmap, tau)
            tc[c][i] = tv
    # row accounting data
    n_read = NR
    n_noest = 0
    n_burn = 0
    for i in range(NR):
        if not hasO[i]:
            n_noest += 1
        elif perN[i] == "burnin":
            n_burn += 1
    RA = []

    def ra_add(scope, steps, nread):
        rin = nread
        for k, (cond, dropped) in enumerate(steps):
            rl = rin - dropped
            RA.append((scope, k, cond, rin, dropped, rl))
            rin = rl

    # movement scope
    n_nonpos = 0
    for i in base:
        if predO[i] <= 0:
            n_nonpos += 1
    ra_add("movement", [("read", 0), ("no_estimate", n_noest), ("burn_in", n_burn), ("old_nonpositive", n_nonpos)],
           NR)

    for c in TRUTHS:
        miss = 0
        oor = 0
        hard = 0
        for i in base:
            tv = tc[c][i]
            if tv is None:
                miss += 1
            elif not in_range(tv):
                oor += 1
            elif hardO[i] == "1" or hardN[i] == "1":
                hard += 1
                if c == "central" and perN[i] == "test":
                    if hardO[i] == "1":
                        i04_old += 1
                    if hardN[i] == "1":
                        i04_new += 1
            else:
                valid[c][i] = True
        ra_add("common_" + c, [("read", 0), ("no_estimate", n_noest), ("burn_in", n_burn),
                               ("truth_missing", miss), ("truth_out_of_range", oor), ("hard_flag_either", hard)], NR)

    # two-by-two set
    n_noest2 = 0
    n_burn2 = 0
    for i in range(NR):
        if (not hasO[i]) and (not hasN[i]):
            n_noest2 += 1
    tbt = [False] * NR
    d3 = d4 = d5 = d6 = d7 = 0
    n_burn2 = 0
    for i in range(NR):
        if not (hasO[i] and hasN[i]):
            continue
        if perN[i] == "burnin":
            n_burn2 += 1
            continue
        if O["truthFlow"][i] == "" or N["truthFlow"][i] == "" or ownO[i] is None or ownN[i] is None:
            d3 += 1
            continue
        if O["status"][i] != "predicted" or N["status"][i] != "predicted":
            d4 += 1
            continue
        if hardO[i] == "1" or hardN[i] == "1":
            d5 += 1
            continue
        if O["truthInProdRange"][i] == "0" or N["truthInProdRange"][i] == "0":
            d6 += 1
            continue
        if O["errPctCorr"][i] == "" or N["errPctCorr"][i] == "":
            d7 += 1
            continue
        tbt[i] = True
    # step 1 "no_estimate_either": rows with no estimate in either; rows with estimate in only one file (B02 = 0
    # so none) would be dropped by the "either" wording of the later steps; B02 has passed so n_oneonly == 0.
    ra_add("two_by_two", [("read", 0), ("no_estimate_either", n_noest2), ("burn_in", n_burn2),
                          ("truth_missing_either", d3), ("status_not_predicted_either", d4),
                          ("hard_flag_either", d5), ("truth_out_of_range_either", d6),
                          ("blank_error_either", d7)], NR)

    # ---------------- table 3: groups.csv ----------------
    groups_rows = []
    for p in PERIODS:
        for g in GROUPS11:
            n = 0
            nc = {c: 0 for c in TRUTHS}
            n2 = 0
            for i in base:
                if perN[i] == p and grp[g][i]:
                    n += 1
                    for c in TRUTHS:
                        if valid[c][i]:
                            nc[c] += 1
                    if tbt[i]:
                        n2 += 1
            groups_rows.append([p, g, str(n), str(nc["central"]), str(nc["long"]), str(nc["short"]), str(n2)])

    # ---------------- movement.csv ----------------
    movement_rows = []
    for p in PERIODS:
        for g in GROUPS10:
            ms = []
            n_ex = 0
            for i in base:
                if perN[i] == p and grp[g][i]:
                    m = move_pct(predO[i], predN[i])
                    if m is None:
                        n_ex += 1
                    else:
                        ms.append(m)
            n = len(ms)
            if n == 0:
                movement_rows.append([p, g, "0", str(n_ex), "", "", "", "", "", "0", "0", "0", ""])
                continue
            mean = sum_loop(ms) / n
            med = median_of(ms)
            srt = sorted(ms)
            p05 = percentile_sorted(srt, 0.05)
            p95 = percentile_sorted(srt, 0.95)
            ge5 = 0
            nu = nd_ = ns = 0
            for m in ms:
                if abs(m) >= 5.0:
                    ge5 += 1
                if m > 0:
                    nu += 1
                elif m < 0:
                    nd_ += 1
                else:
                    ns += 1
            share = (100.0 * ge5) / n
            direction = "lower" if nd_ > nu else ("higher" if nu > nd_ else "equal")
            movement_rows.append([p, g, str(n), str(n_ex), f6(mean), f6(med), f6(p05), f6(p95), f6(share),
                                  str(nu), str(nd_), str(ns), direction])

    # ---------------- measure helper ----------------
    def measures(errs):
        n = len(errs)
        if n == 0:
            return ["0", "", "", "", "", ""]
        ae = []
        off = low = high = 0
        for e in errs:
            ae.append(abs(e))
            if abs(e) >= 15:
                off += 1
            if e <= -15:
                low += 1
            if e >= 15:
                high += 1
        mae = sum_loop(ae) / n
        bias = sum_loop(errs) / n
        return [str(n), f6(mae), f6(bias), f6((100.0 * off) / n), f6((100.0 * low) / n), f6((100.0 * high) / n)]

    # ---------------- badly_low_rising.csv ----------------
    bl_rows = []
    for p in PERIODS:
        for c in TRUTHS:
            res = {}
            for run, pr in (("OLD", predO), ("NEW", predN)):
                n = 0
                nl = 0
                for i in base:
                    if perN[i] == p and grp["lf_rising"][i] and valid[c][i]:
                        e = err_pct(pr[i], tc[c][i])
                        n += 1
                        if e <= -15:
                            nl += 1
                res[run] = (n, nl)
                bl_rows.append([p, c, run, str(n), str(nl), f6((100.0 * nl) / n) if n > 0 else ""])
            n = res["OLD"][0]
            diff = res["NEW"][1] - res["OLD"][1]
            bl_rows.append([p, c, "NEW_minus_OLD", str(n), str(diff), f6((100.0 * diff) / n) if n > 0 else ""])

    # ---------------- two_by_two.csv ----------------
    tbt_rows = []
    for p in PERIODS:
        for g in GROUPS10:
            hours = [i for i in base if perN[i] == p and grp[g][i] and tbt[i]]
            for run, pr, own_self, own_other in (("OLD", predO, ownO, ownN), ("NEW", predN, ownN, ownO)):
                for tname, ow in (("own", own_self), ("other", own_other)):
                    errs = [err_pct(pr[i], ow[i]) for i in hours]
                    tbt_rows.append([p, g, run, tname] + measures(errs))

    # ---------------- common_truth_errors.csv ----------------
    cte_rows = []
    cte_mae = {}
    for p in PERIODS:
        for g in GROUPS10:
            for c in TRUTHS:
                hours = [i for i in base if perN[i] == p and grp[g][i] and valid[c][i]]
                for run, pr in (("OLD", predO), ("NEW", predN)):
                    errs = [err_pct(pr[i], tc[c][i]) for i in hours]
                    ms = measures(errs)
                    cte_rows.append([p, g, c, run] + ms)
                    cte_mae[(p, g, c, run)] = ms[1]

    # ---------------- boot matrices ----------------
    def build_counts(B):
        Cm = []
        for r in boot_data:
            row = [0] * B
            for k in range(B):
                n = int(r[k])
                row[(n * B) // 10 ** 12] += 1
            Cm.append(row)
        return Cm

    CB = {85: build_counts(85), 83: build_counts(83)}

    # ---------------- new_cap_yardsticks.csv ----------------
    COMPS = ("cap", "Y0", "Y1")
    ncy_rows = []
    labels = {}
    # per-hour errors (NEW), per truth
    # precompute Y0, Y1, N
    shownN = [None] * NR
    Y0 = [None] * NR
    Y1 = [None] * NR
    for i in base:
        u = rawN[i] - corN[i]
        shownN[i] = floor_half(u)
        L = lfN[i]
        Y0[i] = yard0(L)
        L3 = lfN[i - 3] if i - 3 >= 0 else None
        # Row(3) lfCap non-blank (text) -- Row(3) need not have an estimate
        L3 = num_or_none(N["lfCap"][i - 3]) if i - 3 >= 0 else None
        a = ageN[i]
        Y1[i] = yard1(L, L3, a, clk[i])

    for p in PERIODS:
        B = 85 if p == "design" else 83
        mon = design_month if p == "design" else test_month
        Cm = CB[B]
        for g in GROUPS10:
            for c in TRUTHS:
                hours = [i for i in base if perN[i] == p and grp[g][i] and valid[c][i]]
                eP = {}
                for i in hours:
                    eP[i] = err_pct(predN[i], tc[c][i])
                for comp in COMPS:
                    n = len(hours)
                    if n == 0:
                        ncy_rows.append([p, g, c, comp, "0", "", "", "0", "0", "", "", "", "0", "10000", "unclear"])
                        labels[(p, g, comp, c)] = "unclear"
                        continue
                    aeP = []
                    aeO = []
                    ds = []
                    nlow_a = 0
                    nlow_o = 0
                    S = [0.0] * B
                    Nj = [0] * B
                    for i in hours:
                        if comp == "cap":
                            other = shownN[i]
                        elif comp == "Y0":
                            other = Y0[i]
                        else:
                            other = Y1[i]
                        eo = err_pct(other, tc[c][i])
                        ep = eP[i]
                        d = abs(eo) - abs(ep)
                        aeP.append(abs(ep))
                        aeO.append(abs(eo))
                        ds.append(d)
                        if ep <= -15:
                            nlow_a += 1
                        if eo <= -15:
                            nlow_o += 1
                        j = mon(O["predTs"][i])
                        S[j] = S[j] + d
                        Nj[j] += 1
                    mae_app = sum_loop(aeP) / n
                    mae_oth = sum_loop(aeO) / n
                    mean_d = sum_loop(ds) / n
                    act = [j for j in range(B) if Nj[j] > 0]
                    vals = []
                    nskip = 0
                    for r in range(10000):
                        cr = Cm[r]
                        num = 0.0
                        den = 0
                        for j in act:
                            cj = cr[j]
                            if cj:
                                num = num + cj * S[j]
                                den = den + cj * Nj[j]
                        if den == 0:
                            nskip += 1
                        else:
                            vals.append(num / den)
                    nvalid = 10000 - nskip
                    if nskip > 500:
                        lo = ""
                        hi = ""
                    else:
                        srt = sorted(vals)
                        lo = f6(percentile_sorted(srt, 0.025))
                        hi = f6(percentile_sorted(srt, 0.975))
                    lab = label_cap(lo, hi) if comp == "cap" else label_yard(lo, hi)
                    labels[(p, g, comp, c)] = lab
                    ncy_rows.append([p, g, c, comp, str(n), f6(mae_app), f6(mae_oth), str(nlow_a), str(nlow_o),
                                     f6(mean_d), lo, hi, str(nvalid), str(nskip), lab])

    # ---------------- new_readings.csv ----------------
    nr_rows = []
    for p in PERIODS:
        for g in GROUPS10:
            for comp in COMPS:
                lc = labels[(p, g, comp, "central")]
                ll = labels[(p, g, comp, "long")]
                ls = labels[(p, g, comp, "short")]
                r, h = reading_of(lc, ll, ls)
                nr_rows.append([p, g, comp, lc, ll, ls, r, str(h)])

    # ---------------- self_report.csv ----------------
    DAYS = {"design": 2587.0, "test": 2505.0}
    sr_rows = []
    sr_acc = {}
    i05 = {}
    for p in PERIODS:
        pass
    sr_data = {}
    for run, F, Hh, predA, ownKey in (("OLD", O, hasO, predO, None), ("NEW", N, hasN, predN, None)):
        Lr = LRN[run]
        nlr = len(Lr["predTs"])
        stats = {p: {"n_rows": 0, "n_learned": 0, "n_joined": 0, "n_unjoined": 0, "n_low15": 0, "n_inband": 0}
                 for p in PERIODS}
        d_hard = d_burn = d_nosh = d_tmiss = 0
        for k in range(nlr):
            pts_k = Lr["predTs"][k]
            per = period_of(pts_k)
            if per != "burnin":
                stats[per]["n_rows"] += 1
            if Lr["outcome"][k] != "learned":
                d_hard += 1
                continue
            if per == "burnin":
                d_burn += 1
                continue
            stats[per]["n_learned"] += 1
            si = key_of(pts_k) - K0
            if si < 0 or si >= NR or not Hh[si]:
                d_nosh += 1
                stats[per]["n_unjoined"] += 1
                continue
            tss = Lr["tauTs"][k]
            tv = None if tss == "" else truth_from(hmap, epoch_ms(tss))
            if tv is None or not (tv > 0):
                d_tmiss += 1
                stats[per]["n_unjoined"] += 1
                continue
            shown = predA[si]
            e = err_pct(shown, tv)
            if e <= -15:
                stats[per]["n_low15"] += 1
            bl, bh = band_of(F["flowBin"][si], F["flowState"][si], shown)
            if bl <= tv and tv <= bh:
                stats[per]["n_inband"] += 1
            stats[per]["n_joined"] += 1
        sr_data[run] = stats
        ra_add("self_" + run, [("read", 0), ("hard_skipped", d_hard), ("burn_in", d_burn),
                               ("no_shadow_estimate", d_nosh), ("truth_missing", d_tmiss)], nlr)
        i05[run] = stats["design"]["n_unjoined"] + stats["test"]["n_unjoined"]
    for p in PERIODS:
        for run in ("OLD", "NEW"):
            s = sr_data[run][p]
            nj = s["n_joined"]
            sr_rows.append([p, run, str(s["n_rows"]), str(s["n_learned"]), str(nj), str(s["n_unjoined"]),
                            f6(s["n_rows"] / DAYS[p]), f6(s["n_learned"] / DAYS[p]), str(s["n_low15"]),
                            f6((100.0 * s["n_low15"]) / nj) if nj > 0 else "", str(s["n_inband"]),
                            f6((100.0 * s["n_inband"]) / nj) if nj > 0 else ""])

    # ---------------- learning_health.csv ----------------
    lh_rows = []
    lh_val = {}
    m07 = {}
    m03 = {}
    m06 = {}
    for run, F, Hh, rawA, corA in (("OLD", O, hasO, rawO, corO), ("NEW", N, hasN, rawN, corN)):
        c = CNT[run]
        order = ["slots_stored", "slot_blocked_hours", "learn_validations", "learned", "hard_skipped", "retries",
                 "dropped_missed_window", "pending_at_end"]
        for mname in order:
            lh_rows.append([run, "whole_run", mname, str(c[mname]), "counts_file"])
        ss = c["slots_stored"]
        for mname, x in (("rate_missed_window", c["dropped_missed_window"]), ("rate_retries", c["retries"]),
                         ("rate_hard_skipped", c["hard_skipped"])):
            v = f6((100.0 * x) / ss) if ss != 0 else ""
            lh_rows.append([run, "whole_run", mname, v, "counts_file"])
        # block 2
        Lr = LRN[run]
        for per in ("burnin", "design", "test"):
            nrw = nl = nh = ncl = 0
            for k in range(len(Lr["predTs"])):
                if period_of(Lr["predTs"][k]) == per:
                    nrw += 1
                    if Lr["outcome"][k] == "learned":
                        nl += 1
                    if Lr["outcome"][k] == "hard_skipped":
                        nh += 1
                    if Lr["clamped"][k] == "1":
                        ncl += 1
            lh_rows.append([run, per, "n_learn_rows", str(nrw), "learn_file"])
            lh_rows.append([run, per, "n_learned", str(nl), "learn_file"])
            lh_rows.append([run, per, "n_hard_skipped", str(nh), "learn_file"])
            lh_rows.append([run, per, "n_clamped", str(ncl), "learn_file"])
        # block 3
        m07[run] = 0
        m03[run] = 0
        m06[run] = 0
        for per in PERIODS:
            n_est = 0
            n_cap = 0
            n_cap_rise = 0
            n_rise = 0
            jumps = []
            for i in range(NR):
                if not Hh[i] or perN[i] != per:
                    continue
                n_est += 1
                u = rawA[i] - corA[i]
                L = float(F["lfCap"][i])
                if grp["lf_rising"][i]:
                    n_rise += 1
                if u > 1.2 * L:
                    n_cap += 1
                    if grp["lf_rising"][i]:
                        n_cap_rise += 1
                if i - 1 >= 0 and Hh[i - 1] and rawA[i] > 0:
                    jumps.append((100.0 * abs(corA[i] - corA[i - 1])) / rawA[i])
            nj = len(jumps)
            ge5 = 0
            for j in jumps:
                if j >= 5.0:
                    ge5 += 1
                if abs(j - 5.0) < 1e-9:
                    m07[run] += 1
            lh_rows.append([run, per, "n_est_hours", str(n_est), "shadow_file"])
            lh_rows.append([run, per, "n_capped", str(n_cap), "shadow_file"])
            lh_rows.append([run, per, "capped_share", f6((100.0 * n_cap) / n_est) if n_est > 0 else "",
                            "shadow_file"])
            lh_rows.append([run, per, "n_capped_lf_rising", str(n_cap_rise), "shadow_file"])
            lh_rows.append([run, per, "capped_lf_rising_share",
                            f6((100.0 * n_cap_rise) / n_rise) if n_rise > 0 else "", "shadow_file"])
            lh_rows.append([run, per, "n_corr_steps", str(nj), "shadow_file"])
            if nj > 0:
                srt = sorted(jumps)
                p95 = f6(percentile_sorted(srt, 0.95))
                p99 = f6(percentile_sorted(srt, 0.99))
            else:
                p95 = p99 = ""
            lh_rows.append([run, per, "corr_jump_p95", p95, "shadow_file"])
            lh_rows.append([run, per, "corr_jump_p99", p99, "shadow_file"])
            lh_rows.append([run, per, "n_jumps_ge5", str(ge5), "shadow_file"])
        # M03 / M06 over ALL estimate hours (spec 3.1 definition of "estimate hour")
        for i in range(NR):
            if not Hh[i]:
                continue
            u = rawA[i] - corA[i]
            L = float(F["lfCap"][i])
            if 0 < abs(u - 1.2 * L) < 1e-9 * max(1.0, abs(u)):
                m03[run] += 1
            if abs((u + 0.5) - math.floor((u + 0.5) + 0.5)) < 1e-9:
                m06[run] += 1

    def lh_get(run, per, metric):
        for r in lh_rows:
            if r[0] == run and r[1] == per and r[2] == metric:
                return r[3]
        raise KeyError((run, per, metric))

    # ---------------- remaining checks ----------------
    def mae_cmp(p, g, cid, stopping):
        new = cte_mae[(p, g, "central", "NEW")]
        old = cte_mae[(p, g, "central", "OLD")]
        ok = (new != "" and old != "" and mic(new) <= mic(old))
        got = "%s:%s" % (new, old)
        if stopping:
            add_check(cid, "NEW<=OLD", got, "P" if ok else "F")
        else:
            add_check(cid, "", got, "I")

    mae_cmp("test", "all", "B10a_mae_all", True)
    mae_cmp("test", "lf_rising", "B10b_mae_lf_rising", True)
    mae_cmp("test", "low_water", "B10c_mae_low_water", True)

    # H01
    got = "%d:%d" % (CNT["OLD"]["pending_at_end"], CNT["NEW"]["pending_at_end"])
    add_check("H01_pending_end", "0:0", got, "P" if got == "0:0" else "F")
    # H02
    viol = 0
    for x in ("dropped_missed_window", "retries", "hard_skipped"):
        if not (2 * CNT["NEW"][x] * CNT["OLD"]["slots_stored"] <= 3 * CNT["OLD"][x] * CNT["NEW"]["slots_stored"]):
            viol += 1
    count_check("H02_rates", viol)
    # H03
    pn = lh_get("NEW", "test", "corr_jump_p99")
    po = lh_get("OLD", "test", "corr_jump_p99")
    if pn == "" or po == "":
        viol = 1
    else:
        viol = 0 if (2 * mic(pn) <= 3 * mic(po)) else 1
    count_check("H03_jump_p99", viol)
    # H04
    jn = int(lh_get("NEW", "test", "n_jumps_ge5"))
    jo = int(lh_get("OLD", "test", "n_jumps_ge5"))
    count_check("H04_jumps_ge5", 0 if (2 * jn <= 3 * jo) else 1)

    mae_cmp("design", "all", "I01_design_mae_all", False)
    mae_cmp("design", "lf_rising", "I01_design_mae_lf_rising", False)
    mae_cmp("design", "low_water", "I01_design_mae_low_water", False)

    add_check("I02_new_travel_same", "", str(i02), "I")
    i03 = 0
    for i in range(NR):
        if hasN[i]:
            if abs(clockQN[i] - lfN[i]) > 1e-9 * max(1.0, abs(lfN[i])):
                i03 += 1
    add_check("I03_clockq_lfcap", "", str(i03), "I")
    add_check("I04_hard_in_common", "", "%d:%d" % (i04_old, i04_new), "I")
    add_check("I05_unjoined", "", "%d:%d" % (i05["OLD"], i05["NEW"]), "I")

    # M01 / M02
    m01 = 0
    m02 = 0
    for c in TRUTHS:
        for i in base:
            if valid[c][i]:
                for pr in (predO, predN):
                    e = err_pct(pr[i], tc[c][i])
                    a = abs(e)
                    if 0 < abs(a - 15.0) < 1e-9:
                        m01 += 1
                    if a == 15.0:
                        m02 += 1
    add_check("M01_err15_margin", "", str(m01), "I")
    add_check("M02_err15_exact", "", str(m02), "I")
    add_check("M03_cap_margin", "", "%d:%d" % (m03["OLD"], m03["NEW"]), "I")
    m04 = 0
    for i in base:
        if i - 6 >= 0 and lfO[i - 6] is not None and lfO[i] is not None:
            L = lfO[i]
            L6 = lfO[i - 6]
            if 0 < abs(L - 1.10 * L6) < 1e-9 * max(1.0, abs(L)):
                m04 += 1
    add_check("M04_lfrise_margin", "", str(m04), "I")
    add_check("M05_due_knife", "0", str(m05), "P" if m05 == 0 else "F")
    add_check("M06_floor_margin", "", "%d:%d" % (m06["OLD"], m06["NEW"]), "I")
    add_check("M07_jump_margin", "", "%d:%d" % (m07["OLD"], m07["NEW"]), "I")

    # ---------------- write outputs ----------------
    def table_text(header, rows):
        lines = [header]
        for r in rows:
            lines.append(",".join(r))
        return "\n".join(lines) + "\n"

    ra_rows = [[s, str(k), cnd, str(a), str(b), str(c)] for (s, k, cnd, a, b, c) in RA]

    outputs = [
        ("badly_low_rising.csv", table_text("period,truth,run,n,n_low,low_share", bl_rows), 18),
        ("movement.csv", table_text("period,group,n,n_excluded,mean,median,p05,p95,share_ge5,n_up,n_down,n_same,direction_by_count", movement_rows), 20),
        ("groups.csv", table_text("period,group,n,n_central,n_long,n_short,n_two_by_two", groups_rows), 22),
        ("two_by_two.csv", table_text("period,group,run,truth,n,mae,bias,off,low,high", tbt_rows), 80),
        ("common_truth_errors.csv", table_text("period,group,truth,run,n,mae,bias,off,low,high", cte_rows), 120),
        ("new_cap_yardsticks.csv", table_text("period,group,truth,comparison,n,mae_app,mae_other,n_low_app,n_low_other,mean_d,lo,hi,n_valid,n_skipped,label", ncy_rows), 180),
        ("new_readings.csv", table_text("period,group,comparison,label_central,label_long,label_short,reading,holds", nr_rows), 60),
        ("self_report.csv", table_text("period,run,n_rows,n_learned,n_joined,n_unjoined,validations_per_day,learned_per_day,n_low15,low15_share,n_inband,inband_share", sr_rows), 4),
        ("learning_health.csv", table_text("run,period,metric,value,source", lh_rows), 82),
        ("checks.csv", checks_text(), 89),
        ("row_accounting.csv", table_text("scope,step,condition,rows_in,rows_dropped,rows_left", ra_rows), 40),
    ]
    for name, text, nexp in outputs:
        nrows = text.count("\n") - 1
        if nrows != nexp:
            sys.stderr.write("row count mismatch in %s: %d != %d\n" % (name, nrows, nexp))
            raise RuntimeError("row count mismatch in " + name)
        if "-0.000000" in text or "nan" in text.lower().replace("nan", "nan") and False:
            raise RuntimeError("bad token in " + name)
    for name, text, nexp in outputs:
        write_text(os.path.join(OUT, name), text)


OUTNAMES = ["badly_low_rising.csv", "movement.csv", "groups.csv", "two_by_two.csv", "common_truth_errors.csv",
            "new_cap_yardsticks.csv", "new_readings.csv", "self_report.csv", "learning_health.csv", "checks.csv",
            "row_accounting.csv"]

if __name__ == "__main__":
    for nm in OUTNAMES:
        p = os.path.join(OUT, nm)
        if os.path.exists(p):
            os.remove(p)
    try:
        main()
    except StopRun as e:
        write_text(os.path.join(OUT, "checks.csv"), checks_text())
        sys.stderr.write("STOP: check failed: %s\n" % (e,))
        sys.exit(1)
    sys.stderr.write("done in %.1f s\n" % (time.time() - T_START))
