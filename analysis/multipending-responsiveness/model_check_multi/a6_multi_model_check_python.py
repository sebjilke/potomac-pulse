#!/usr/bin/python3
"""A6 third implementation (multipending-responsiveness-plan-2026-11-11.md, section 9 and 16b point 2).

Replays the BASE chain from empty bins over the full grid (2011-12-01T05:00Z .. 2026-11-09T23:00Z,
130,987 ticks) twice, independently of the JavaScript harness:
  - single: production one-slot rule (validate, predict, store-if-free / replace a missed-window row)
  - multi:  a pending at every tick with a prediction (plan section 9 chain rule)
and compares named columns with the base rows of the harness tick files.

The model, lag view, learning gate and bins (lines marked PORT below) are copied from the
independent port analysis/rising-limb-travel-backtest/model_check/rising_limb_model_check_python.py
(plan section 9 permits starting from it), re-checked against netlify/functions/scheduled-update.js
and shared/model.js. No harness source is read. No truth column is read, no error against truth is
computed.

Outputs (this folder): a6_multi_model_check.csv, a6_multi_validation_counts.csv,
a6_single_validation_counts.csv, a6_totals.json. Run: /usr/bin/python3 a6_multi_model_check_python.py
"""
# ---------------------------------------------------------------- PORT (copied, lines 18-536 of the A7 port)
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'rising-limb-travel-backtest')  # A6 change
DATA_CSV = os.path.join(BT, 'hourly_backtest_data_v39.csv')
EVENTS_CSV = os.path.join(BT, 'rising_limb_events_python_v39.csv')
# (A6: the snapshot file is not read; the tick files are named in the A6 section below)

H = 3600000
ARMS = ['base', 'A', 'B', 'C']

# ---------------------------------------------------------------- JS helpers

def jsround(x):
    return math.floor(x + 0.5)


def truthy(x):
    if x is None:
        return False
    if isinstance(x, float) and math.isnan(x):
        return False
    return x != 0


def finite(x):
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (ms % 1000)


def parse_iso(s):
    s = s.replace('Z', '+00:00')
    return int(round(datetime.fromisoformat(s).timestamp() * 1000))


def parse_stamp(s):  # 'YYYY-MM-DD HH:MM' UTC
    return int(datetime.strptime(s, '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)

# ---------------------------------------------------------------- shared/model.js

GF_FLOW_BINS = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+']
STATES = ['rising', 'falling', 'steady']
TRAVEL_COEF = 4139
TRAVEL_EXP = -0.5963
MEDIAN_TRAVEL = 25.8
TRAVEL_POR_GF_BASELINE = 19.4
TRAVEL_GF_LF_BASELINE = 6.5
EF = dict(coef=126, exp=2.46, coldCoef=160, coldExp=2.36, coldMaxTemp=10, minStage=2.5, maxStage=20.0)
GF_EMA_ALPHA = 0.3
CEILING_RATIO = 1.20
DECAY_CAP = 0.50
TRIB_FALLBACK = dict(monocacy=0.071, goose=0.030, broadRun=0.0066, seneca=0.0087)
VALIDATION_MAX_DELAY_MS = 2.5 * 60 * 60 * 1000
STALE_MS = 48 * 60 * 60 * 1000
CORR_SMOOTH_BAND = 0.12
CORR_SMOOTH_BOUNDARIES = [(3000, '0-3000', '3000-6000'), (6000, '3000-6000', '6000-12000'),
                          (12000, '6000-12000', '12000-25000')]
ICE_MONTHS = [10, 11, 0, 1, 2]


def getFlowBin(cfs):
    if cfs < 3000: return '0-3000'
    if cfs < 6000: return '3000-6000'
    if cfs < 12000: return '6000-12000'
    if cfs < 25000: return '12000-25000'
    if cfs < 50000: return '25000-50000'
    return '50000+'


def estimateLFFlowFromStage(stage):
    if stage < 2.40: return 0
    if stage < 2.46: return ((stage - 2.40) / 0.06) * 600
    if stage < 2.69: return 600 + ((stage - 2.46) / 0.23) * 700
    if stage < 2.83: return 1300 + ((stage - 2.69) / 0.14) * 700
    if stage < 2.96: return 2000 + ((stage - 2.83) / 0.13) * 600
    if stage < 3.09: return 2600 + ((stage - 2.96) / 0.13) * 600
    if stage < 3.16: return 3200 + ((stage - 3.09) / 0.07) * 400
    if stage < 3.23: return 3600 + ((stage - 3.16) / 0.07) * 600
    if stage < 3.35: return 4200 + ((stage - 3.23) / 0.12) * 800
    if stage < 3.46: return 5000 + ((stage - 3.35) / 0.11) * 700
    if stage < 3.67: return 5700 + ((stage - 3.46) / 0.21) * 1800
    if stage < 3.95: return 7500 + ((stage - 3.67) / 0.28) * 2500
    if stage < 4.29: return 10000 + ((stage - 3.95) / 0.34) * 3000
    if stage < 5.50: return 13000 + ((stage - 4.29) / 1.21) * 15000
    if stage < 6.79: return 28000 + ((stage - 5.50) / 1.29) * 22000
    if stage < 8.36: return 50000 + ((stage - 6.79) / 1.57) * 30000
    if stage < 10.93: return 80000 + ((stage - 8.36) / 2.57) * 70000
    return 150000 + ((stage - 10.93) / 2.5) * 100000


def getEFWeight(f):
    if f < 1000: return 0.0
    return 0.40 / (1 + math.exp(-5.0 * (math.log(f) - math.log(10000))))


def isIcePlausible(waterTempC, nowMs):
    if finite(waterTempC):
        return waterTempC <= 5
    return datetime.fromtimestamp(nowMs / 1000, tz=timezone.utc).month - 1 in ICE_MONTHS


def getFlowMultiplier(lfFlow):
    flow = max(lfFlow, 1000)
    return (TRAVEL_COEF * math.pow(flow, TRAVEL_EXP)) / MEDIAN_TRAVEL


def _rising_cut(rr):
    return rr is not None and rr['flowState'] == 'rising' and rr['ratePerHour'] > 0


def getPoRtoGFTravelTime(mult, rr=None):
    b = TRAVEL_POR_GF_BASELINE * mult
    if _rising_cut(rr):
        return b * (1 - min(0.30, rr['ratePerHour'] * 0.02))
    return b


def getGFtoLFTravelTime(mult, rr=None):
    b = TRAVEL_GF_LF_BASELINE * mult
    if _rising_cut(rr):
        return b * (1 - min(0.30, rr['ratePerHour'] * 0.02))
    return b


def medianCfs(entries):
    vals = sorted(e[1] for e in entries)
    m = len(vals) // 2
    return vals[m] if len(vals) % 2 else (vals[m - 1] + vals[m]) / 2


def selectHistoricReading(history, target):
    cands = [e for e in history if e[1] > 0 and abs(e[0] - target) < H]
    if not cands:
        return None
    pool = cands
    if len(cands) >= 3:
        med = medianCfs(cands)
        if med > 0:
            filt = [e for e in cands if abs(e[1] - med) / med <= 0.40]
            if filt:
                pool = filt
    best = pool[0]
    for e in pool:
        if abs(e[0] - target) < abs(best[0] - target):
            best = e
    return best


def getFlowState(history, currentCFS, now):
    if not history or len(history) < 8:
        return 'steady'
    six = now - 6 * H
    past = None
    for r in history:
        if r[0] <= six:
            past = r
    if past is None:
        return 'steady'
    change = currentCFS - past[1]
    thr = max(100, currentCFS * 0.02)
    if abs(change) >= thr:
        if change > 0: return 'rising'
        if change < 0: return 'falling'
    return 'steady'


def getPoRRiseRateFromHistory(history, now):
    if not history or len(history) < 4:
        return None
    six = now - 6 * H
    cur = history[-1]
    past = None
    for r in history:
        if r[0] <= six:
            past = r
    if past is None:
        return None
    hd = (cur[0] - past[0]) / 3600000
    if hd <= 0:
        return None
    pct = ((cur[1] - past[1]) / past[1]) * 100
    return {'ratePerHour': pct / hd, 'flowState': getFlowState(history, cur[1], now)}


def getPoRFromHistory(history, hoursAgo, now):
    if not history:
        return None
    target = now - (hoursAgo * 60 * 60 * 1000)
    c = selectHistoricReading(history, target)
    if c is None:
        return None
    return {'cfs': c[1], 'actualHoursAgo': (now - c[0]) / (60 * 60 * 1000)}


def getBinCorrection(sd):
    if 'emaMeanError' in sd and sd['emaMeanError'] is not None:  # JS: !== undefined (null never stored)
        return sd['emaMeanError']
    m = sd.get('meanError')
    return m if truthy(m) else 0


def getFallbackCorrection(bins, flowBin, flowState):
    b = bins.get(flowBin)
    if b:
        tw = 0
        ws = 0
        for s in STATES:
            sd = b.get(s)
            if sd and sd['count'] >= 5:
                ws += sd['count'] * getBinCorrection(sd)
                tw += sd['count']
        if tw > 0:
            return ws / tw
    idx = GF_FLOW_BINS.index(flowBin)
    for ni in (idx - 1, idx + 1):
        if 0 <= ni < len(GF_FLOW_BINS):
            nb = bins.get(GF_FLOW_BINS[ni])
            if not nb:
                continue
            sd = nb.get(flowState) or nb.get('steady')
            if sd and sd['count'] >= 5:
                return getBinCorrection(sd)
    return 0


def getGFCorrection(bins, flowBin, flowState):
    b = bins.get(flowBin)
    sd = (b.get(flowState) or b.get('steady')) if b else None
    count = (sd.get('count') or 0) if sd else 0
    if count >= 5:
        return getBinCorrection(sd)
    fb = getFallbackCorrection(bins, flowBin, flowState)
    w = count / 5
    bv = getBinCorrection(sd) if count > 0 else 0
    return w * bv + (1 - w) * fb


def getGFCorrectionInterpolated(bins, flowCFS, flowState):
    f = max(flowCFS, 1)
    lnf = math.log(f)
    for B, below, above in CORR_SMOOTH_BOUNDARIES:
        lnLo = math.log(B / (1 + CORR_SMOOTH_BAND))
        lnHi = math.log(B * (1 + CORR_SMOOTH_BAND))
        if lnLo < lnf < lnHi:
            t = (lnf - lnLo) / (lnHi - lnLo)
            return (1 - t) * getGFCorrection(bins, below, flowState) + t * getGFCorrection(bins, above, flowState)
    return getGFCorrection(bins, getFlowBin(f), flowState)


def empty_bins():
    """buildCorrectionBins([]) as a flat map key -> stats."""
    return {fb: {s: {'count': 0, 'sumError': 0, 'sumErrorSq': 0, 'meanError': 0} for s in STATES}
            for fb in GF_FLOW_BINS}


def applyGFCorrection(raw, lfCFS, bins, flowState):
    flowBin = getFlowBin(raw)
    corr = getGFCorrectionInterpolated(bins, raw, flowState)
    cu = raw - corr
    cf = cu
    ceil = False
    if lfCFS > 0:
        mx = lfCFS * CEILING_RATIO
        if cf > mx:
            cf = mx
            ceil = True
    return flowBin, corr, cu, cf, ceil


def updateCorrectionBin(bd, err, soft):
    preCount = bd['count']
    preMean = bd['meanError']
    ema = bd.get('emaMeanError')
    center = ema if ema is not None else preMean
    sdPre = None
    if preCount > 0:
        var = (bd['sumErrorSq'] / preCount) - (preMean * preMean)
        sdPre = math.sqrt(max(0, var))
    le = err
    if soft and preCount >= 10 and finite(sdPre) and sdPre > 0 and finite(center):
        md = 2 * sdPre
        le = max(center - md, min(center + md, err))
    bd['count'] += 1
    bd['sumError'] += err
    bd['sumErrorSq'] += err * err
    bd['meanError'] = bd['sumError'] / bd['count']
    if preCount == 0 or not finite(center):
        bd['emaMeanError'] = le
    else:
        bd['emaMeanError'] = GF_EMA_ALPHA * le + (1 - GF_EMA_ALPHA) * center


def classifyOutlier(bd, err):
    if not bd or not (bd['count'] >= 10):
        return False
    var = (bd['sumErrorSq'] / bd['count']) - (bd['meanError'] * bd['meanError'])
    sd = math.sqrt(max(0, var))
    if not math.isfinite(sd) or not (sd > 0):
        return False
    ema = bd.get('emaMeanError')
    center = ema if ema is not None else bd['meanError']
    if not finite(err) or not finite(center):
        return False
    return abs(err - center) / sd > 3

# ---------------------------------------------------------------- makeGFPrediction (+ variants)


def makeGFPrediction(arm, inp, hist, waterTempC, bins, now):
    """inp: dict lf_q, lf_h, por_q, mono, goose, br, sen, ef_h (None when missing).
    Returns (prediction dict, trace dict) or (None, None)."""
    lfq = inp['lf_q']
    porq = inp['por_q']
    if not truthy(lfq) or not truthy(porq):
        return None, None
    tr = {}
    rr = getPoRRiseRateFromHistory(hist, now)
    rising = bool(rr and rr['flowState'] == 'rising' and rr['ratePerHour'] > 0)     # B hook (after R)
    useB = arm in ('B', 'C')
    mult = getFlowMultiplier(max(lfq, porq) if (useB and rising) else lfq)          # H1
    tpg = getPoRtoGFTravelTime(mult, rr)
    hp = None
    tpg0 = tpg
    stop = 'max_iter'
    passes = 0
    for it in range(3):
        passes = it + 1
        th = getPoRFromHistory(hist, tpg, now)
        if th is None:
            stop = 'hist_lost' if hp is not None else 'no_hist'
            break
        hp = th
        hm = getFlowMultiplier(max(hp['cfs'], porq) if (useB and rising) else hp['cfs'])  # H2
        nt = getPoRtoGFTravelTime(hm, rr)
        if abs(nt - tpg) < 1.0:
            stop = 'converged'
            break
        tpg = nt
        mult = hm
    tgl = getGFtoLFTravelTime(mult, rr)
    tr['rate'] = rr['ratePerHour'] if rr else None
    tr['rst'] = rr['flowState'] if rr else None
    tr['t0'] = tpg0
    tr['t'] = tpg
    tr['it'] = passes
    tr['stop'] = stop
    tr['b_active'] = rising

    mono = inp['mono'] if truthy(inp['mono']) else lfq * TRIB_FALLBACK['monocacy']
    goose = inp['goose'] if truthy(inp['goose']) else lfq * TRIB_FALLBACK['goose']
    br = inp['br'] if truthy(inp['br']) else lfq * TRIB_FALLBACK['broadRun']
    sen = inp['sen'] if truthy(inp['sen']) else lfq * TRIB_FALLBACK['seneca']

    tr['pct'] = None
    tr['deltaOn'] = None
    if hp is not None:
        pe = hp['cfs'] + mono + goose + br + sen
        ratio = porq / hp['cfs']
        pct = (ratio - 1) * 100
        tr['pct'] = pct
        tr['deltaOn'] = abs(pct) > 5
        if abs(pct) > 5:
            ah = hp['actualHoursAgo']
            fe = min(1.0, (ah if truthy(ah) else 0) / max(1, tpg))
            decay = min(DECAY_CAP, math.sqrt(fe))
            ar = 1 + (ratio - 1) * decay
            if arm in ('A', 'C'):
                pe = jsround(hp['cfs'] * ar) + mono + goose + br + sen        # H3 (variant A)
            else:
                pe = jsround(pe * ar)                                           # H3 (base)
    else:
        pe = porq + mono + goose + br + sen

    efEst = None
    useEf = False
    efStage = inp['ef_h'] if truthy(inp['ef_h']) else None
    if efStage is not None and EF['minStage'] <= efStage <= EF['maxStage']:
        cold = waterTempC is not None and waterTempC <= EF['coldMaxTemp']
        coef = EF['coldCoef'] if cold else EF['coef']
        ex = EF['coldExp'] if cold else EF['exp']
        efEst = coef * math.pow(efStage, ex)
        if 500 < efEst < 500000:
            useEf = True
    flowState = getFlowState(hist, porq, now)
    if useEf:
        w = getEFWeight(pe)
        disc = abs(efEst - pe) / pe
        if disc > 0.50:
            est = pe
        else:
            est = (1 - w) * pe + w * efEst
    else:
        est = pe
    raw = est
    flowBin, corr, cu, cf, ceil = applyGFCorrection(raw, lfq, bins, flowState)
    tr['rawUnc'] = raw
    tr['corr'] = corr
    tr['unc'] = cu
    pred = {
        'predictedCFS': jsround(cf),
        'rawFinalCFS': jsround(raw),
        'flowBin': flowBin,
        'flowState': flowState,
        'travelTimeGFtoLF': tgl,
        'dueMs': math.trunc(now + tgl * 60 * 60 * 1000),   # new Date(ms) truncates (TimeClip)
        'ceilingApplied': ceil,
    }
    return pred, tr

# ---------------------------------------------------------------- data, lag view, history, truth


class Data:
    def __init__(self):
        d = pd.read_csv(DATA_CSV)
        ms = np.array([parse_stamp(s) for s in d['timestamp']], dtype=np.int64)
        self.T0 = int(ms[0])
        self.N = int((ms[-1] - ms[0]) // H) + 1
        idx = ((ms - self.T0) // H).astype(np.int64)
        def col(c):
            a = np.full(self.N, np.nan)
            a[idx] = d[c].to_numpy(dtype=float)
            return a
        self.raw = {c: col(c) for c in ['por_now', 'ef_stage', 'lf_discharge', 'lf_stage', 'water_temp_c',
                                        'monocacy', 'goose', 'broad_run', 'seneca']}
        lag = {'por_now': 2, 'water_temp_c': 2, 'broad_run': 2, 'ef_stage': 2,
               'lf_discharge': 1, 'lf_stage': 1, 'monocacy': 1, 'goose': 1, 'seneca': 1}
        self.view = {}
        self.carry = {}
        for c, L in lag.items():
            a = self.raw[c]
            v = np.full(self.N, np.nan)
            k = np.full(self.N, -1, dtype=np.int64)
            for kk in (3, 2, 1, 0):  # later assignment (smaller kk) wins
                src = np.arange(self.N) - L - kk
                ok = src >= 0
                vals = np.full(self.N, np.nan)
                vals[ok] = a[src[ok]]
                good = ~np.isnan(vals)
                v[good] = vals[good]
                k[good] = kk
            self.view[c] = v
            self.carry[c] = k
        self.por = self.raw['por_now']

    def tms(self, i):
        return self.T0 + i * H

    def v(self, c, i):
        x = self.view[c][i]
        return None if np.isnan(x) else float(x)

    def inputs(self, i):
        return {'lf_q': self.v('lf_discharge', i), 'lf_h': self.v('lf_stage', i), 'por_q': self.v('por_now', i),
                'mono': self.v('monocacy', i), 'goose': self.v('goose', i), 'br': self.v('broad_run', i),
                'sen': self.v('seneca', i), 'ef_h': self.v('ef_stage', i)}

    def history(self, i):
        out = []
        for j in range(max(0, i - 72), i - 1):  # stamps t-72h .. t-2h inclusive
            x = self.por[j]
            if not np.isnan(x):
                out.append((self.tms(j) + 30 * 60 * 1000, float(x)))
        return out

    def lf_at(self, i, h):
        """LF view at the first tick v >= t + h, trying v, v+1, v+2. Returns (value, v) or (None, None)."""
        v0 = i + math.ceil(h - 1e-12)
        for v in (v0, v0 + 1, v0 + 2):
            if 0 <= v < self.N:
                x = self.view['lf_discharge'][v]
                if not np.isnan(x):
                    return float(x), v
        return None, None

    def truth(self, i):
        """Returns dict mask, mask_why, tau_ref, tau_converged, truth, truth_tick."""
        r = {'mask': 0, 'mask_why': None, 'tau_ref': None, 'tau_converged': None, 'truth': None, 'truth_tick': None}
        if self.v('por_now', i) is None or self.v('lf_discharge', i) is None:
            r['mask_why'] = 'no_input'
            return r
        now = self.tms(i)
        rr = getPoRRiseRateFromHistory(self.history(i), now)
        tau = 6.5
        conv = False
        for _ in range(3):
            lf, _v = self.lf_at(i, tau)
            if lf is None:
                r['mask_why'] = 'tau_lf_missing'
                return r
            nt = getGFtoLFTravelTime(getFlowMultiplier(lf), rr)
            d = abs(nt - tau)
            tau = nt
            if d < 0.5:
                conv = True
                break
        r['tau_ref'] = tau
        r['tau_converged'] = 1 if conv else 0
        tv, vt = self.lf_at(i, tau)
        if tv is None:
            r['mask_why'] = 'no_truth'
            return r
        r['truth'] = tv
        r['truth_tick'] = iso(self.tms(vt))
        r['mask'] = 1
        r['mask_why'] = 'ok'
        return r

# ---------------------------------------------------------------- END PORT

# ================================================================ A6 (new code, not from the port)
import hashlib

TICK_FILES = {'single': os.path.join(BT, 'rising_limb_ticks.csv'),
              'multi': os.path.join(BT, 'rising_limb_ticks_multi.csv')}
SHA = {'single': '8d841145905de1f6b6d217835c65229862ec6e115f33823c9472ffcfbfca0a6f',
       'multi': 'c99c4b56e3ae3edc47cda561a7322174d6797709e509ea63f8e0106e17064778'}
MANIFEST = os.path.join(BT, 'GATE_RUN_MANIFEST.txt')
USECOLS = ['tick_utc', 'arm', 'has_pred', 'raw', 'corr', 'travel_por_gf', 'travel_gf_lf', 'slot',
           'validated', 'hard_flag', 'soft_flag']   # plan section 9: these columns only
GRID_FIRST = '2011-12-01T05:00:00.000Z'
GRID_LAST = '2026-11-09T23:00:00.000Z'
N_TICKS = 130987
REPORT_EVENTS = [11, 30, 51, 53]
# field -> tolerance (None = exact text). has_pred is compared too (informational).
FIELDS = [('corr', 0.5), ('raw', 1.0), ('travel_por_gf', 0.01), ('travel_gf_lf', 0.01),
          ('validated', None), ('hard_flag', None), ('soft_flag', None), ('slot', None), ('has_pred', None)]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 22), b''):
            h.update(b)
    return h.hexdigest()


def gate(D, i, now, p, bins):
    """Production learning gate for one pending row p validated at tick i (LF already valid, row due
    and inside the window). Mirrors validatePendingPredictions Check 1..5 and updateCorrectionBin.
    Returns (hard, soft) as 0/1; updates bins in place unless hard."""
    actual = D.v('lf_discharge', i)
    rawCFS = p['rawFinalCFS'] if p['rawFinalCFS'] is not None else p['predictedCFS']   # ??
    err = rawCFS - actual
    errPctRaw = (err / actual) * 100
    flowBin = p['flowBin']
    flowState = p['flowState'] if p['flowState'] else 'steady'                       # ||
    stage = D.v('lf_stage', i)
    wt = D.v('water_temp_c', i)
    hard = 0
    soft = 0
    efh = D.v('ef_stage', i)
    efNow = None
    if truthy(efh) and EF['minStage'] <= efh <= EF['maxStage']:
        cold = wt is not None and wt <= EF['coldMaxTemp']
        efNow = (EF['coldCoef'] if cold else EF['coef']) * math.pow(efh, EF['coldExp'] if cold else EF['exp'])
    if truthy(efNow) and truthy(actual):                                   # Check 1 (soft +2)
        if (efNow - actual) / actual > 0.25:
            soft += 2
    if truthy(stage) and truthy(actual):                                   # Check 2 (hard)
        exp_ = estimateLFFlowFromStage(stage)
        if exp_ > 0 and (exp_ - actual) / actual > 0.35:
            hard += 2
    if actual < 1500 and (stage is not None and stage > 2.45) and isIcePlausible(wt, now):   # Check 3 (hard)
        hard += 2
    if abs(errPctRaw) > 50:                                                # Check 4 (soft +1)
        soft += 1
    bd = bins[flowBin][flowState]
    if classifyOutlier(bd, err):                                           # Check 5 (soft +2), pre-update bin
        soft += 2
    isHard = hard >= 2
    isSoft = (not isHard) and soft >= 2
    if not isHard:
        updateCorrectionBin(bd, err, isSoft)
    return int(isHard), int(isSoft)


def lf_valid(D, i):
    """Production guard: !lf?.q || lf.q < 500 || lf.q > 500000 -> invalid."""
    q = D.v('lf_discharge', i)
    return truthy(q) and not (q < 500 or q > 500000)


def new_pending(pred, now):
    return {'createdMs': now, 'dueMs': pred['dueMs'], 'rawFinalCFS': pred['rawFinalCFS'],
            'predictedCFS': pred['predictedCFS'], 'flowBin': pred['flowBin'], 'flowState': pred['flowState']}


class SingleChain:
    """Production one-slot rule (A7 plan section 4; validatePendingPredictions + storePrediction)."""
    name = 'single'

    def __init__(self):
        self.bins = empty_bins()
        self.pending = None

    def validate(self, D, i, now):
        c = dict(n_val=0, n_learned=0, n_hard=0, n_soft=0, n_dropped_missed=0, n_stale=0)
        if not lf_valid(D, i) or self.pending is None:
            return c
        p = self.pending
        if now - p['createdMs'] > STALE_MS:          # stale first (C12)
            self.pending = None
            c['n_stale'] = 1
            return c
        if now >= p['dueMs'] and now - p['dueMs'] <= VALIDATION_MAX_DELAY_MS:
            self.pending = None                      # claim (also for hard flags)
            h, s = gate(D, i, now, p, self.bins)
            c['n_val'] = 1
            c['n_hard'] = h
            c['n_soft'] = s
            c['n_learned'] = 1 - h
        return c                                     # a missed-window row stays (replaced at store)

    def store(self, pred, now, c):
        if pred is None:
            return 'no_prediction'
        if self.pending is not None:
            if not ((now - self.pending['dueMs']) > VALIDATION_MAX_DELAY_MS):   # isExistingPredictionReplaceable
                return 'skipped_in_window'
            c['n_dropped_missed'] += 1               # replaced_missed_window
        self.pending = new_pending(pred, now)
        return 'stored'                              # 'replaced' is written 'stored' (TICK_SCHEMA col 47)

    def n_pending(self):
        return 0 if self.pending is None else 1


class MultiChain:
    """Plan section 9 chain rule: a pending at every tick with a prediction."""
    name = 'multi'

    def __init__(self):
        self.bins = empty_bins()
        self.pending = []                            # creation order

    def validate(self, D, i, now):
        c = dict(n_val=0, n_learned=0, n_hard=0, n_soft=0, n_dropped_missed=0, n_stale=0)
        if not lf_valid(D, i):
            return c                                 # nothing validated or dropped
        keep = []
        for p in self.pending:                       # order: created_at ascending
            if now - p['createdMs'] > STALE_MS:
                c['n_stale'] += 1
                continue
            if now >= p['dueMs']:
                if now - p['dueMs'] <= VALIDATION_MAX_DELAY_MS:
                    h, s = gate(D, i, now, p, self.bins)
                    c['n_val'] += 1
                    c['n_hard'] += h
                    c['n_soft'] += s
                    c['n_learned'] += 1 - h
                else:
                    c['n_dropped_missed'] += 1       # plan s9: due rows outside the window are dropped
                continue
            keep.append(p)
        self.pending = keep
        return c

    def store(self, pred, now, c):
        if pred is None:
            return 'no_prediction'
        self.pending.append(new_pending(pred, now))
        return 'stored'

    def n_pending(self):
        return len(self.pending)


def replay(D, chain, log):
    """Full grid from empty bins. Returns per-tick list of dicts (my values + counts)."""
    out = []
    t_start = datetime.now()
    for i in range(D.N):
        now = D.tms(i)
        c = chain.validate(D, i, now)
        pred, tr = makeGFPrediction('base', D.inputs(i), D.history(i), D.v('water_temp_c', i), chain.bins, now)
        slot = chain.store(pred, now, c)
        r = {'tick_utc': iso(now), 'has_pred': int(pred is not None), 'slot': slot,
             'validated': int(c['n_val'] > 0), 'hard_flag': int(c['n_hard'] > 0), 'soft_flag': int(c['n_soft'] > 0),
             'raw': None, 'corr': None, 'travel_por_gf': None, 'travel_gf_lf': None}
        if pred is not None:
            r.update(raw=pred['rawFinalCFS'], corr=tr['corr'], travel_por_gf=tr['t'],
                     travel_gf_lf=pred['travelTimeGFtoLF'])
        r.update(c)
        r['n_stored'] = int(slot == 'stored')
        r['n_pending_after'] = chain.n_pending()
        out.append(r)
        if i % 20000 == 0:
            log(f'  {chain.name} tick {i}/{D.N} {r["tick_utc"]} elapsed {(datetime.now() - t_start).seconds}s')
    return out


def read_base(name):
    parts = []
    for ch in pd.read_csv(TICK_FILES[name], usecols=USECOLS, dtype=str, keep_default_na=False, chunksize=200000):
        parts.append(ch[ch['arm'] == 'base'])
    df = pd.concat(parts, ignore_index=True)
    assert len(df) == N_TICKS, len(df)
    assert df['tick_utc'].iloc[0] == GRID_FIRST and df['tick_utc'].iloc[-1] == GRID_LAST
    return df


def fmt_exact(x):
    return '' if x is None else str(x)


class Cmp2:
    def __init__(self, chain, subset, field, tol):
        self.key = dict(chain=chain, subset=subset, field=field, tolerance='exact' if tol is None else tol)
        self.tol = tol
        self.n = 0
        self.nboth = 0
        self.nbad = 0
        self.maxd = 0.0
        self.first = None

    def add(self, tick, mine, h):
        self.n += 1
        if self.tol is None:
            a = fmt_exact(mine)
            if a != '' and h != '':
                self.nboth += 1
            if a != h:
                self.nbad += 1
                if self.first is None:
                    self.first = (tick, a, h)
            return
        hv = None if h == '' else float(h)
        if mine is None or hv is None:
            if (mine is None) != (hv is None):
                self.nbad += 1
                if self.first is None:
                    self.first = (tick, '' if mine is None else repr(mine), h)
            return
        self.nboth += 1
        d = abs(float(mine) - hv)
        self.maxd = max(self.maxd, d)
        if d > self.tol:
            self.nbad += 1
            if self.first is None:
                self.first = (tick, repr(float(mine)), h)

    def row(self):
        r = dict(self.key)
        r.update(n_compared=self.n, n_both_nonblank=self.nboth, n_beyond_tol=self.nbad,
                 max_abs_diff='' if self.tol is None else repr(self.maxd),
                 first_diverging_tick=self.first[0] if self.first else '',
                 mine_at_first=self.first[1] if self.first else '',
                 harness_at_first=self.first[2] if self.first else '')
        return r


def event_ranges(D):
    e = pd.read_csv(EVENTS_CSV, dtype=str, keep_default_na=False)
    e = e[e['event_row'] == '1']
    out = {}
    for eid in REPORT_EVENTS:
        r = e[e['event_id'] == str(eid)]
        assert len(r) == 1, eid
        r = r.iloc[0]
        i_t0 = (parse_stamp(r['event_t0']) - D.T0) // H
        i_end = (parse_stamp(r['event_tend']) - D.T0) // H + 24
        out[eid] = (i_t0 - 71, min(i_end, D.N - 1))
    return out


def compare(name, mine, harness, ranges):
    rows = []
    subsets = [('all', 0, len(mine) - 1)] + [(f'event_{k}', a, b) for k, (a, b) in ranges.items()]
    H_ = {f: harness[f].tolist() for f, _ in FIELDS}
    ticks = harness['tick_utc'].tolist()
    for sub, a, b in subsets:
        cm = {f: Cmp2(name, sub, f, tol) for f, tol in FIELDS}
        for i in range(a, b + 1):
            assert mine[i]['tick_utc'] == ticks[i]
            for f, _ in FIELDS:
                cm[f].add(ticks[i], mine[i][f], H_[f][i])
        sr = [c.row() for c in cm.values()]
        for r in sr:
            r['first_tick'] = ticks[a]
            r['last_tick'] = ticks[b]
        rows += sr
    return rows


COUNT_COLS = ['tick_utc', 'n_val', 'n_learned', 'n_hard', 'n_soft', 'n_dropped_missed', 'n_stale', 'n_pending_after']


def main():
    logf = open(os.path.join(HERE, 'LOG.txt'), 'a')

    def log(msg):
        s = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') + ' ' + msg
        print(s, flush=True)
        logf.write(s + '\n')
        logf.flush()

    log('RUN start')
    # A0-style input check: sha256 of both tick files, against the plan and GATE_RUN_MANIFEST.txt
    man = open(MANIFEST).read()
    for k, p in TICK_FILES.items():
        got = sha256(p)
        ok = got == SHA[k] and (got + '  ') in man
        log(f'sha256 {os.path.basename(p)} {got} match_plan_and_manifest={ok}')
        assert ok, k
    D = Data()
    assert D.N == N_TICKS and iso(D.tms(0)) == GRID_FIRST and iso(D.tms(D.N - 1)) == GRID_LAST
    ranges = event_ranges(D)
    log('report-event tick ranges: ' + json.dumps({k: [iso(D.tms(a)), iso(D.tms(b))] for k, (a, b) in ranges.items()}))
    results = []
    totals = {}
    for chain in (SingleChain(), MultiChain()):
        log(f'replay {chain.name} start')
        mine = replay(D, chain, log)
        cnt = pd.DataFrame(mine)[COUNT_COLS]
        cnt.to_csv(os.path.join(HERE, f'a6_{chain.name}_validation_counts.csv'), index=False)
        tot = {k: int(cnt[k].sum()) for k in ['n_val', 'n_learned', 'n_hard', 'n_soft', 'n_dropped_missed', 'n_stale']}
        tot['n_stored'] = int(sum(r['n_stored'] for r in mine))
        tot['n_pending_at_end'] = int(mine[-1]['n_pending_after'])
        tot['n_ticks_validated'] = int(sum(r['validated'] for r in mine))
        tot['n_ticks_hard'] = int(sum(r['hard_flag'] for r in mine))
        tot['n_ticks_soft'] = int(sum(r['soft_flag'] for r in mine))
        tot['max_n_val_per_tick'] = int(cnt['n_val'].max())
        tot['balance_stored_eq_val+missed+stale+pending_end'] = (
            tot['n_stored'] == tot['n_val'] + tot['n_dropped_missed'] + tot['n_stale'] + tot['n_pending_at_end'])
        totals[chain.name] = tot
        log(f'replay {chain.name} done; totals {json.dumps(tot)}')
        harness = read_base(chain.name)
        rows = compare(chain.name, mine, harness, ranges)
        results += rows
        for r in rows:
            if r['subset'] == 'all' or r['n_beyond_tol']:
                log(f"  cmp {r['chain']} {r['subset']} {r['field']}: n={r['n_compared']} beyond={r['n_beyond_tol']} "
                    f"maxd={r['max_abs_diff']} first={r['first_diverging_tick']} mine={r['mine_at_first']} "
                    f"harness={r['harness_at_first']}")
        del harness, mine
    pd.DataFrame(results).to_csv(os.path.join(HERE, 'a6_multi_model_check.csv'), index=False)
    json.dump(totals, open(os.path.join(HERE, 'a6_totals.json'), 'w'), indent=1)
    log('RUN end; beyond-tolerance rows: ' + str(sum(1 for r in results if r['n_beyond_tol'])))


if __name__ == '__main__':
    main()
