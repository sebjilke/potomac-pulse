#!/usr/bin/python3
"""Third implementation (plan section 7, step 6) of the rising-limb travel backtest.

Independent Python port of production makeGFPrediction (scheduled-update.js) and its
shared/model.js helpers, the variants A, B, C (plan section 1), the single-slot pending
chain with the production learning gate (plan section 4), the primary lag view and the
arm-independent truth (plan sections 2 and 4, D-5). Written from the plan and the
production code only; no harness source was read.

Regenerates every output in this folder:
  rising_limb_model_check.csv          one row per event x arm x field
  rising_limb_model_check_rebuild.csv  seeded empty-state rebuild, bin by bin
  _replay_<event>.csv                  (diagnostic) my per-tick values next to the harness's

JavaScript semantics notes: Math.round(x) == math.floor(x + 0.5) (jsround below);
`a || b` treats 0/NaN/None as falsy (jsor); new Date(ms) truncates fractional ms toward 0.
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.dirname(HERE)
DATA_CSV = os.path.join(BT, 'hourly_backtest_data_v39.csv')
EVENTS_CSV = os.path.join(BT, 'rising_limb_events_python_v39.csv')
SNAP_JSON = os.path.join(BT, 'rising_limb_snapshots_t0m72.json')
TICKS_CSV = os.path.join(BT, 'rising_limb_ticks.csv')

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

# ---------------------------------------------------------------- chain


class Chain:
    """One arm's single-slot pending chain + bins (production order per tick)."""

    def __init__(self, arm, bins, pending):
        self.arm = arm
        self.bins = bins            # flowBin -> state -> stats
        self.pending = pending      # dict createdMs, dueMs, rawFinalCFS, predictedCFS, flowBin, flowState

    def validate(self, D, i, now):
        out = {'validated': 0, 'hard_flag': 0, 'soft_flag': 0}
        lfq = D.v('lf_discharge', i)
        if not truthy(lfq):
            return out
        if lfq < 500 or lfq > 500000:
            return out
        p = self.pending
        if p is None:
            return out
        age = now - p['createdMs']
        if age > STALE_MS:
            self.pending = None
            out['stale'] = 1
            return out
        delay = now - p['dueMs']
        if now >= p['dueMs'] and delay <= VALIDATION_MAX_DELAY_MS:
            actual = lfq
            rawCFS = p['rawFinalCFS'] if p['rawFinalCFS'] is not None else p['predictedCFS']
            err = rawCFS - actual
            errPctRaw = (err / actual) * 100
            flowBin = p['flowBin']
            flowState = p['flowState'] if p['flowState'] else 'steady'
            stage = D.v('lf_stage', i)
            wt = D.v('water_temp_c', i)
            hard = 0
            soft = 0
            efh = D.v('ef_stage', i)
            efNow = None
            if truthy(efh) and EF['minStage'] <= efh <= EF['maxStage']:
                cold = wt is not None and wt <= EF['coldMaxTemp']
                efNow = (EF['coldCoef'] if cold else EF['coef']) * math.pow(efh, EF['coldExp'] if cold else EF['exp'])
            if truthy(efNow) and truthy(actual):
                if (efNow - actual) / actual > 0.25:
                    soft += 2
            if truthy(stage) and truthy(actual):
                exp_ = estimateLFFlowFromStage(stage)
                if exp_ > 0 and (exp_ - actual) / actual > 0.35:
                    hard += 2
            if actual < 1500 and (stage is not None and stage > 2.45) and isIcePlausible(wt, now):
                hard += 2
            if abs(errPctRaw) > 50:
                soft += 1
            # claim: slot released (hard flags are still claimed)
            self.pending = None
            out['validated'] = 1
            bd = self.bins[flowBin][flowState]
            if classifyOutlier(bd, err):
                soft += 2
            isHard = hard >= 2
            isSoft = (not isHard) and soft >= 2
            out['hard_flag'] = int(isHard)
            out['soft_flag'] = int(isSoft)
            if not isHard:
                updateCorrectionBin(bd, err, isSoft)
        return out

    def store(self, pred, now):
        if pred is None:
            return 'no_prediction'
        if self.pending is not None:
            if not ((now - self.pending['dueMs']) > VALIDATION_MAX_DELAY_MS):
                return 'skipped_in_window'
            slot = 'replaced'
        else:
            slot = 'stored'
        self.pending = {'createdMs': now, 'dueMs': pred['dueMs'], 'rawFinalCFS': pred['rawFinalCFS'],
                        'predictedCFS': pred['predictedCFS'], 'flowBin': pred['flowBin'],
                        'flowState': pred['flowState']}
        return slot

    def tick(self, D, i, hist=None, inp=None):
        now = D.tms(i)
        if hist is None:
            hist = D.history(i)
        if inp is None:
            inp = D.inputs(i)
        val = self.validate(D, i, now)
        pred, tr = makeGFPrediction(self.arm, inp, hist, D.v('water_temp_c', i), self.bins, now)
        slot = self.store(pred, now)
        row = {'tick_utc': iso(now), 'arm': self.arm, 'has_pred': int(pred is not None), 'slot': slot}
        row.update(val)
        if pred is not None:
            row.update({'raw': pred['rawFinalCFS'], 'raw_unc': tr['rawUnc'], 'unc': tr['unc'],
                        'disp': pred['predictedCFS'], 'ceiling_applied': int(pred['ceilingApplied']),
                        'corr': tr['corr'], 'flow_bin': pred['flowBin'], 'flow_state': pred['flowState'],
                        'rst': tr['rst'], 'rate': tr['rate'], 'stop': tr['stop'], 'it': tr['it'],
                        'travel_por_gf': tr['t'], 'travel_gf_lf': pred['travelTimeGFtoLF'],
                        'b_active': int(tr['b_active']),
                        'delta_on': None if tr['deltaOn'] is None else int(tr['deltaOn']), 'pct': tr['pct']})
        return row


def bins_from_snapshot(sb):
    out = {}
    for fb in GF_FLOW_BINS:
        out[fb] = {}
        for s in STATES:
            o = dict(sb[fb][s])
            out[fb][s] = o
    return out


def pending_from_snapshot(sp):
    if sp is None:
        return None
    d = sp['data']
    return {'createdMs': int(sp['createdMs']), 'dueMs': parse_iso(d['validationDue']),
            'rawFinalCFS': d.get('rawFinalCFS'), 'predictedCFS': d.get('predictedCFS'),
            'flowBin': d['flowBin'], 'flowState': d.get('flowState'), 'created_at': sp.get('created_at')}

# ---------------------------------------------------------------- tick-file access and comparison

TICK_COLS = None


def read_tick_rows(D, i0, i1):
    """Rows of the harness tick file for ticks i0..i1 inclusive (4 rows per tick, arm order)."""
    global TICK_COLS
    if TICK_COLS is None:
        TICK_COLS = pd.read_csv(TICKS_CSV, nrows=0).columns.tolist()
    df = pd.read_csv(TICKS_CSV, skiprows=range(1, 1 + 4 * i0), nrows=4 * (i1 - i0 + 1),
                     dtype=str, keep_default_na=False)
    assert df['tick_utc'].iloc[0] == iso(D.tms(i0)), (df['tick_utc'].iloc[0], iso(D.tms(i0)))
    assert df['tick_utc'].iloc[-1] == iso(D.tms(i1))
    return df


def load_events():
    e = pd.read_csv(EVENTS_CSV)
    e = e[e.event_row == 1]
    k = e[(e.kept == 1) & (e.event_class == 'GATE')].sort_values('event_t0')
    nonoct = k[k.oct == 0]
    assert len(nonoct) == 20, len(nonoct)
    pick = [nonoct.iloc[0], nonoct.iloc[9], nonoct.iloc[19]] + [r for _, r in k[k.oct == 1].iterrows()]
    assert len(pick) == 4
    return sorted(pick, key=lambda r: r['event_t0']), e


NUM_TOL = {'raw': 1.0, 'travel_por_gf': 0.01, 'travel_gf_lf': 0.01, 'corr': 0.5,
           'raw_unc': None, 'unc': None, 'disp': None, 'rate': None, 'pct': None}
EXACT = ['has_pred', 'slot', 'validated', 'hard_flag', 'soft_flag', 'ceiling_applied', 'flow_bin', 'flow_state',
         'rst', 'stop', 'it', 'b_active', 'delta_on']
TICK_NUM = {'tau_ref': 1e-9, 'truth': 1e-9}
TICK_EXACT = ['mask', 'mask_why', 'tau_converged', 'truth_tick_utc']


def fnum(s):
    if s is None or s == '':
        return None
    return float(s)


def fmt(x):
    if x is None:
        return ''
    if isinstance(x, bool):
        return str(int(x))
    if isinstance(x, float) and x.is_integer() and abs(x) < 1e15:
        return str(int(x))
    return str(x) if not isinstance(x, float) else repr(x)


ARM_FIELDS = [  # field, tolerance (None = exact string compare), frozen?
    ('raw', 1.0, 'frozen'), ('travel_por_gf', 0.01, 'frozen'), ('travel_gf_lf', 0.01, 'frozen'),
    ('corr', 0.5, 'frozen'),
    ('slot', None, 'frozen'), ('validated', None, 'frozen'), ('hard_flag', None, 'frozen'),
    ('soft_flag', None, 'frozen'),
    ('raw_unc', 1.0, 'info'), ('unc', 1.0, 'info'), ('disp', 1.0, 'info'), ('rate', 1e-6, 'info'),
    ('pct', 1e-6, 'info'),
    ('has_pred', None, 'info'), ('ceiling_applied', None, 'info'), ('flow_bin', None, 'info'),
    ('flow_state', None, 'info'), ('rst', None, 'info'), ('stop', None, 'info'), ('it', None, 'info'),
    ('b_active', None, 'info'), ('delta_on', None, 'info'),
]
TICK_FIELDS = [
    ('mask', None, 'truth'), ('mask_why', None, 'truth'), ('tau_ref', 1e-9, 'truth'),
    ('tau_converged', None, 'truth'), ('truth', 1e-9, 'truth'), ('truth_tick_utc', None, 'truth'),
    ('lf_view', 0.0, 'view'), ('por_view', 0.0, 'view'), ('lf_carry_h', None, 'view'), ('por_carry_h', None, 'view'),
]
SLOT_MAP = {'replaced': 'stored'}  # TICK_SCHEMA col 47 has only stored / skipped_in_window / no_prediction


def tick_values(D, i):
    t = D.truth(i)
    out = {'mask': t['mask'], 'mask_why': t['mask_why'], 'tau_ref': t['tau_ref'],
           'tau_converged': t['tau_converged'], 'truth': t['truth'], 'truth_tick_utc': t['truth_tick']}
    for col, name in (('lf_discharge', 'lf'), ('por_now', 'por')):
        x = D.v(col, i)
        out[name + '_view'] = x
        out[name + '_carry_h'] = None if x is None else int(D.carry[col][i])
    return out


class Cmp:
    def __init__(self, event_id, arm, field, tol, kind):
        self.k = dict(event_id=event_id, arm=arm, field=field, kind=kind,
                      tolerance='exact' if tol is None else tol)
        self.tol = tol
        self.n = 0
        self.nboth = 0
        self.maxd = 0.0
        self.nbad = 0
        self.first = None

    def add(self, tick, mine, harness):
        self.n += 1
        if self.tol is None:
            a = fmt(mine)
            if self.k['field'] == 'slot':
                a = SLOT_MAP.get(a, a)
            ok = (a == harness)
            if ok and a != '':
                self.nboth += 1
            if not ok:
                self.nbad += 1
                if self.first is None:
                    self.first = (tick, a, harness)
            return
        h = fnum(harness)
        if mine is None or h is None:
            if (mine is None) != (h is None):
                self.nbad += 1
                if self.first is None:
                    self.first = (tick, fmt(mine), harness)
            return
        self.nboth += 1
        d = abs(float(mine) - h)
        self.maxd = max(self.maxd, d)
        if d > self.tol:
            self.nbad += 1
            if self.first is None:
                self.first = (tick, repr(float(mine)), harness)

    def row(self):
        r = dict(self.k)
        r.update(ticks_compared=self.n, ticks_both_nonblank=self.nboth,
                 max_abs_diff=('' if self.tol is None else repr(self.maxd)), n_beyond_tol=self.nbad,
                 first_diverging_tick=self.first[0] if self.first else '',
                 mine_at_first=self.first[1] if self.first else '',
                 harness_at_first=self.first[2] if self.first else '')
        return r


BIN_FIELDS = ['count', 'sumError', 'sumErrorSq', 'meanError', 'emaMeanError']


def compare_bins(mine, snap_bins):
    """Returns list of dicts per bin x field with abs diff (None for absent-vs-absent emaMeanError)."""
    rows = []
    for fb in GF_FLOW_BINS:
        for s in STATES:
            a = mine[fb][s]
            b = snap_bins[fb][s]
            for f in BIN_FIELDS:
                x = a.get(f)
                y = b.get(f)
                if x is None and y is None:
                    d = 0.0
                elif x is None or y is None:
                    # an unwritten bin has no emaMeanError; equivalent to an empty bin only when count == 0
                    d = 0.0 if (f == 'emaMeanError' and a['count'] == 0 and b['count'] == 0) else float('inf')
                else:
                    d = abs(float(x) - float(y))
                rows.append(dict(bin=f'{fb}_{s}', field=f, mine='' if x is None else repr(x),
                                 harness='' if y is None else repr(y), abs_diff=d))
    return rows


def pending_compare(mine, sp):
    """Compare my pending slot with a snapshot pending record."""
    if mine is None or sp is None:
        return [dict(field='pending_present', mine=str(mine is not None), harness=str(sp is not None),
                     equal=(mine is None) == (sp is None))]
    d = sp['data']
    out = []
    for f, x, y in [('createdMs', mine['createdMs'], int(sp['createdMs'])),
                    ('validationDue_ms', mine['dueMs'], parse_iso(d['validationDue'])),
                    ('rawFinalCFS', mine['rawFinalCFS'], d.get('rawFinalCFS')),
                    ('predictedCFS', mine['predictedCFS'], d.get('predictedCFS')),
                    ('flowBin', mine['flowBin'], d.get('flowBin')),
                    ('flowState', mine['flowState'], d.get('flowState'))]:
        out.append(dict(field=f, mine=str(x), harness=str(y), equal=(x == y)))
    if 'travelTimeGFtoLF' in mine:
        out.append(dict(field='travelTimeGFtoLF', mine=repr(mine['travelTimeGFtoLF']),
                        harness=repr(d.get('travelTimeGFtoLF')),
                        equal=abs(mine['travelTimeGFtoLF'] - d.get('travelTimeGFtoLF')) <= 0.01))
    return out


def replay_event(D, r, snaps, diag_rows):
    eid = int(r['event_id'])
    i_t0 = (parse_stamp(r['event_t0']) - D.T0) // H
    i_end = (parse_stamp(r['event_tend']) - D.T0) // H + 24
    i0 = i_t0 - 71
    df = read_tick_rows(D, i0, i_end)
    sn = {s['arm']: s for s in snaps if s['event_id'] == eid}
    assert sn['base']['tick_utc'] == iso(D.tms(i_t0 - 72))
    chains = {a: Chain(a, bins_from_snapshot(sn[a]['bins']), pending_from_snapshot(sn[a]['pending'])) for a in ARMS}
    cmps = {}
    for a in ARMS:
        for f, tol, kind in ARM_FIELDS + TICK_FIELDS:
            cmps[(a, f)] = Cmp(eid, a, f, tol, kind)
    # later snapshots of other kept events inside this window
    inside = {}
    for s in snaps:
        it = (parse_iso(s['tick_utc']) - D.T0) // H
        if s['event_id'] != eid and i0 <= it <= i_end:
            inside.setdefault(it, []).append(s)
    snap_checks = []
    rows = df.to_dict('records')
    counts = {a: {'replaced': 0, 'stale': 0} for a in ARMS}
    for k, i in enumerate(range(i0, i_end + 1)):
        hist = D.history(i)
        inp = D.inputs(i)
        tv = tick_values(D, i)
        for j, a in enumerate(ARMS):
            hr = rows[4 * k + j]
            assert hr['arm'] == a and hr['tick_utc'] == iso(D.tms(i))
            my = chains[a].tick(D, i, hist, inp)
            if my['slot'] == 'replaced':
                counts[a]['replaced'] += 1
            if my.get('stale'):
                counts[a]['stale'] += 1
            for f, tol, kind in ARM_FIELDS:
                cmps[(a, f)].add(hr['tick_utc'], my.get(f), hr[f])
            for f, tol, kind in TICK_FIELDS:
                cmps[(a, f)].add(hr['tick_utc'], tv[f], hr[f])
            d = {'event_id': eid, 'tick_utc': hr['tick_utc'], 'arm': a}
            for f, _, _ in ARM_FIELDS:
                d['my_' + f] = fmt(my.get(f))
                d['h_' + f] = hr[f]
            diag_rows.append(d)
        for s in inside.get(i, []):
            rows_b = compare_bins(chains[s['arm']].bins, s['bins'])
            mx = max(x['abs_diff'] for x in rows_b)
            pend = pending_compare(chains[s['arm']].pending, s['pending'])
            snap_checks.append(dict(event_id=eid, snapshot_event=s['event_id'], tick_utc=s['tick_utc'],
                                    arm=s['arm'], max_bin_abs_diff=mx,
                                    pending_equal=all(p['equal'] for p in pend)))
    return [c.row() for c in cmps.values()], snap_checks, counts, (i0, i_end)


def rebuild(D, r, snaps):
    eid = int(r['event_id'])
    i_t0 = (parse_stamp(r['event_t0']) - D.T0) // H
    i_last = i_t0 - 72
    ch = Chain('base', empty_bins(), None)
    stats = {'ticks': 0, 'validated': 0, 'hard_flag': 0, 'soft_flag': 0, 'stale': 0, 'stored': 0, 'replaced': 0,
             'skipped_in_window': 0, 'no_prediction': 0}
    for i in range(0, i_last + 1):
        now = D.tms(i)
        hist = D.history(i)
        v = ch.validate(D, i, now)
        pred, tr = makeGFPrediction('base', D.inputs(i), hist, D.v('water_temp_c', i), ch.bins, now)
        slot = ch.store(pred, now)
        if slot in ('stored', 'replaced'):
            ch.pending['travelTimeGFtoLF'] = pred['travelTimeGFtoLF']
        stats['ticks'] += 1
        stats[slot] += 1
        for f in ('validated', 'hard_flag', 'soft_flag', 'stale'):
            stats[f] += v.get(f, 0)
    sb = [s for s in snaps if s['event_id'] == eid and s['arm'] == 'base'][0]
    assert sb['tick_utc'] == iso(D.tms(i_last))
    return compare_bins(ch.bins, sb['bins']), pending_compare(ch.pending, sb['pending']), sb['tick_utc'], stats


def main():
    D = Data()
    events, _ = load_events()
    snaps = json.load(open(SNAP_JSON))['snapshots']
    all_rows = []
    all_snap = []
    summary = {}
    for r in events:
        diag = []
        rows, sc, counts, (i0, i1) = replay_event(D, r, snaps, diag)
        all_rows += rows
        all_snap += sc
        eid = int(r['event_id'])
        summary[eid] = dict(first_tick=iso(D.tms(i0)), last_tick=iso(D.tms(i1)), n_ticks=i1 - i0 + 1,
                            replaced=counts, snapshots_inside=len(sc))
        pd.DataFrame(diag).to_csv(os.path.join(HERE, f'_replay_event{eid}.csv'), index=False)
        print(eid, summary[eid], 'beyond-tolerance rows:',
              sum(1 for x in rows if x['n_beyond_tol'] > 0), flush=True)
    out = pd.DataFrame(all_rows)
    out.to_csv(os.path.join(HERE, 'rising_limb_model_check.csv'), index=False)
    pick = int(np.random.default_rng(20261112).integers(0, 4))
    pr = events[pick]
    brows, prow, tick, rstats = rebuild(D, pr, snaps)
    rb = pd.DataFrame(brows)
    rb.insert(0, 'snapshot_tick_utc', tick)
    rb.insert(0, 'event_id', int(pr['event_id']))
    rb.insert(0, 'seed_index', pick)
    rb['beyond_1e-6'] = rb['abs_diff'] > 1e-6
    pend = pd.DataFrame(prow)
    pend.insert(0, 'bin', 'PENDING_SLOT')
    pend = pend.rename(columns={'equal': 'beyond_1e-6'})
    pend['beyond_1e-6'] = ~pend['beyond_1e-6'].astype(bool)
    pend['event_id'] = int(pr['event_id'])
    pend['seed_index'] = pick
    pend['snapshot_tick_utc'] = tick
    full = pd.concat([rb, pend], ignore_index=True, sort=False)
    full.to_csv(os.path.join(HERE, 'rising_limb_model_check_rebuild.csv'), index=False)
    json.dump(dict(summary=summary, snapshots_inside_windows=all_snap, rebuild_pick=pick,
                   rebuild_event=int(pr['event_id']), rebuild_chain_stats=rstats, rebuild_max_bin_diff=float(rb['abs_diff'].max()),
                   rebuild_pending_equal=bool(not pend['beyond_1e-6'].any())),
              open(os.path.join(HERE, '_run_summary.json'), 'w'), indent=1, default=str)
    print('rebuild stats', rstats)
    print('rebuild pick', pick, 'event', int(pr['event_id']), 'max bin diff', rb['abs_diff'].max(),
          'pending beyond', int(pend['beyond_1e-6'].sum()))


if __name__ == '__main__':
    main()
