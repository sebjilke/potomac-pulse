#!/usr/bin/python3
"""Blind Python metrics for the rising-limb travel backtest (plan step 4).

Regenerates everything in metrics_python/:
  rising_limb_metrics_python.csv / .json      (gate criteria, all four runs)
  rising_limb_report_only_python.csv          (report-only items, plan sections 3 and 4)
Fixed order (plan D-7 E8): 1 checksums -> 2 arm-independent assertions (STOP on mismatch) -> 3 metrics.

Run:  /usr/bin/python3 rising_limb_metrics_python.py [--assert-only]
Interpreter: /usr/bin/python3 3.9.6, numpy 2.0.2, pandas 2.3.3. No other dependency.
"""
import hashlib
import json
import math
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.dirname(HERE)  # analysis/rising-limb-travel-backtest

TICK_FILES = {
    'primary': 'rising_limb_ticks.csv',
    'S2': 'rising_limb_ticks_S2.csv',
    'S3': 'rising_limb_ticks_S3.csv',
    'multi': 'rising_limb_ticks_multi.csv',
}
EVENT_FILE = 'rising_limb_events_python_v39.csv'
EVENT_SHA = '978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44'
RAW_FILE = 'hourly_backtest_data_v39.csv'
RAW_SHA = 'd1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f'
BOOT_ALL = 'rising_limb_bootstrap_indices.csv'
BOOT_NON = 'rising_limb_bootstrap_indices_nonoct.csv'

ARMS = ['base', 'A', 'B', 'C']
D8_TICK = '2026-11-09T12:00:00.000Z'      # plan D-8: excluded from the common mask
LAST_TICK_ISO = '2026-11-09T23:00:00.000Z'  # last tick of the D-5 H1 grid
OCT_STAMP = '2026-10-14 12:00'

# production constants (netlify/functions/shared/model.js)
TRAVEL_COEF = 4139.0
TRAVEL_EXP = -0.5963
MEDIAN_TRAVEL = 25.8
TRAVEL_GF_LF_BASELINE = 6.5

H_MS = 3600000


def log(msg):
    with open(os.path.join(HERE, 'LOG.md'), 'a') as f:
        f.write(msg.rstrip() + '\n')
    print(msg)


def stop(msg):
    log('\n**STOP**: ' + msg)
    sys.exit(2)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- step 1
def step1_checksums():
    expected = {}
    with open(os.path.join(BT, 'GATE_RUN_MANIFEST.txt')) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and len(parts[0]) == 64:
                for p in parts[1:]:
                    if p.endswith('.csv') or p.endswith('.json'):
                        expected[p] = parts[0]
                        break
    with open(os.path.join(BT, 'rising_limb_bootstrap_indices.sha256.txt')) as f:
        for line in f:
            for name in (BOOT_ALL, BOOT_NON):
                if line.startswith(name + ':'):
                    expected[name] = line.strip().split('sha256 ')[-1]
    expected[EVENT_FILE] = EVENT_SHA
    expected[RAW_FILE] = RAW_SHA
    need = list(TICK_FILES.values()) + [EVENT_FILE, RAW_FILE, BOOT_ALL, BOOT_NON]
    res = {}
    for n in need:
        if n not in expected:
            stop('no expected checksum for ' + n)
        got = sha256(os.path.join(BT, n))
        if got != expected[n]:
            stop('checksum mismatch %s: got %s expected %s' % (n, got, expected[n]))
        res[n] = got
    return res


# ---------------------------------------------------------------- helpers: time
def to_hours(series):
    """'YYYY-MM-DD HH:MM' or ISO strings -> integer hours since epoch (UTC)."""
    dt = pd.to_datetime(series, utc=True)
    return (dt.astype('int64') // (3600 * 10**9)).to_numpy()


def hours_to_iso(h):
    return pd.to_datetime(np.asarray(h, dtype='int64') * 3600, unit='s', utc=True).strftime(
        '%Y-%m-%dT%H:%M:%S.000Z').to_numpy()


# ---------------------------------------------------------------- raw data and lag view
def load_raw():
    raw = pd.read_csv(os.path.join(BT, RAW_FILE))
    hrs = to_hours(raw['timestamp'])
    h0, h1 = hrs.min(), hrs.max()
    T = int(h1 - h0 + 1)
    idx = hrs - h0

    def grid(col):
        a = np.full(T, np.nan)
        a[idx] = raw[col].to_numpy(dtype=float)
        return a
    return dict(h0=int(h0), T=T, por=grid('por_now'), lf=grid('lf_discharge'))


def carried_view(series, lag, carry=3):
    """View at tick i = series[i-lag], else i-lag-1 .. i-lag-carry (H2). NaN if none."""
    T = len(series)
    out = np.full(T, np.nan)
    for c in range(carry, -1, -1):  # later (smaller c) overrides
        src = np.arange(T) - lag - c
        ok = src >= 0
        v = np.full(T, np.nan)
        v[ok] = series[src[ok]]
        good = ~np.isnan(v)
        out[good] = v[good]
    return out


def last_valid_index(valid):
    """L[j] = largest k <= j with valid[k], else -1."""
    T = len(valid)
    idx = np.where(valid, np.arange(T), -1)
    return np.maximum.accumulate(idx)


def rise_rate_all(por):
    """getPoRRiseRateFromHistory at every tick, Date.now = tick, history = PoR stamps
    s' in [t-72h, t-2h] (non-blank), timestamp s'+30 min (plan section 2, D-5 H3).
    Returns (has_rr, rate, state) arrays."""
    T = len(por)
    valid = ~np.isnan(por)
    L = last_valid_index(valid)
    cs = np.concatenate([[0], np.cumsum(valid.astype(np.int64))])
    i = np.arange(T)
    lo = i - 72
    hi = i - 2
    lo_c = np.clip(lo, 0, None)
    count = np.where(hi >= 0, cs[np.clip(hi + 1, 0, T)] - cs[np.clip(lo_c, 0, T)], 0)
    cur = np.where(hi >= 0, L[np.clip(hi, 0, T - 1)], -1)
    cur = np.where(cur >= lo, cur, -1)
    # past: most recent entry with timestamp <= now - 6h  <=>  s'*H+30min <= t*H - 6H  <=>  s' <= t-7
    p_hi = i - 7
    past = np.where(p_hi >= 0, L[np.clip(p_hi, 0, T - 1)], -1)
    past = np.where(past >= lo, past, -1)
    has = (count >= 4) & (cur >= 0) & (past >= 0)
    rate = np.full(T, np.nan)
    state = np.array([''] * T, dtype=object)
    with np.errstate(divide='ignore', invalid='ignore'):
        for t in np.where(has)[0]:
            c, p = cur[t], past[t]
            hours_diff = ((c * H_MS + 1800000) - (p * H_MS + 1800000)) / 3600000.0
            if hours_diff <= 0:
                has[t] = False
                continue
            cc, pc = por[c], por[p]
            pct = ((np.float64(cc) - pc) / np.float64(pc)) * 100.0
            rate[t] = pct / hours_diff
            # getFlowState(history, current.cfs)
            if count[t] < 8:
                state[t] = 'steady'
            else:
                change = cc - pc
                thr = max(100.0, cc * 0.02)
                if abs(change) >= thr and change > 0:
                    state[t] = 'rising'
                elif abs(change) >= thr and change < 0:
                    state[t] = 'falling'
                else:
                    state[t] = 'steady'
    return has, rate, state


def flow_mult(lf):
    flow = max(lf, 1000.0)
    return (TRAVEL_COEF * math.pow(flow, TRAVEL_EXP)) / MEDIAN_TRAVEL


def gf_lf_travel(mult, has_rr, rate, state):
    base = TRAVEL_GF_LF_BASELINE * mult
    if has_rr and state == 'rising' and rate > 0:
        red = min(0.30, rate * 0.02)
        return base * (1 - red)
    return base


def offset_of(h):
    return int(math.ceil(h - 1e-12))


def lf_view_search(lfv, v):
    """first non-missing LF view among ticks v, v+1, v+2 (2.5 h search, D-1 C2)."""
    T = len(lfv)
    for k in (v, v + 1, v + 2):
        if 0 <= k < T and not np.isnan(lfv[k]):
            return k
    return -1


def truth_rule(rawd):
    T = rawd['T']
    lfv = carried_view(rawd['lf'], 1)
    porv = carried_view(rawd['por'], 2)
    has_rr, rate, state = rise_rate_all(rawd['por'])
    tau = np.full(T, np.nan)
    conv = np.full(T, np.nan)
    truth = np.full(T, np.nan)
    ttick = np.full(T, -1, dtype=np.int64)
    why = np.array(['ok'] * T, dtype=object)
    for t in range(T):
        if np.isnan(lfv[t]) or np.isnan(porv[t]):
            why[t] = 'no_input'
            continue
        prev = 6.5
        cur = None
        converged = False
        failed = False
        for k in range(3):
            v = lf_view_search(lfv, t + offset_of(prev))
            if v < 0:
                failed = True
                break
            cur = gf_lf_travel(flow_mult(lfv[v]), has_rr[t], rate[t], state[t])
            if abs(cur - prev) < 0.5:
                converged = True
                break
            prev = cur
        if failed:
            why[t] = 'tau_lf_missing'
            continue
        tau[t] = cur
        conv[t] = 1.0 if converged else 0.0
        v = lf_view_search(lfv, t + offset_of(cur))
        if v < 0:
            why[t] = 'no_truth'
            continue
        truth[t] = lfv[v]
        ttick[t] = v
    mask = (why == 'ok')
    return dict(lfv=lfv, porv=porv, tau=tau, conv=conv, truth=truth, ttick=ttick, why=why, mask=mask,
                has_rr=has_rr, rate=rate, state=state)


# ---------------------------------------------------------------- events and labels
def load_events():
    ev = pd.read_csv(os.path.join(BT, EVENT_FILE))
    comps = ev[ev['event_id'].notna()].copy()
    comps['event_id'] = comps['event_id'].astype(int)
    events = comps[comps['event_row'] == 1].copy()
    for c in ('event_t0', 'event_tp', 'event_tend'):
        events[c + '_h'] = to_hours(events[c])
    comps['onset_t0_h'] = to_hours(comps['onset_t0'])
    comps['onset_tp_h'] = to_hours(comps['onset_tp'])
    events = events.sort_values('event_t0_h').reset_index(drop=True)
    return events, comps


def filled_lf(lf):
    """LF with runs of <= 3 consecutive missing stamps linearly filled (plan section 3, D-1 C1)."""
    out = lf.copy()
    T = len(lf)
    miss = np.isnan(lf)
    t = 0
    while t < T:
        if miss[t]:
            s = t
            while t < T and miss[t]:
                t += 1
            e = t  # first non-missing after run
            if s > 0 and e < T and (e - s) <= 3:
                a, b = lf[s - 1], lf[e]
                for k in range(s, e):
                    out[k] = a + (b - a) * (k - (s - 1)) / (e - (s - 1))
        else:
            t += 1
    return out


def derive_labels(events, comps, rawd):
    T, h0 = rawd['T'], rawd['h0']
    rl = np.full(T, np.nan)
    rlx = np.full(T, np.nan)
    rec = np.full(T, np.nan)
    ew = np.zeros(T, dtype=np.int64)
    multi = 0
    lff = filled_lf(rawd['lf'])
    rec_check = []

    def put(arr, a, b, eid):
        nonlocal multi
        a = max(a, 0)
        b = min(b, T - 1)
        if b < a:
            return
        seg = arr[a:b + 1]
        if np.any(~np.isnan(seg) & (seg != eid)):
            multi += 1
        arr[a:b + 1] = eid

    for _, e in events.iterrows():
        eid = int(e['event_id'])
        t0 = int(e['event_t0_h']) - h0
        tp = int(e['event_tp_h']) - h0
        tend = int(e['event_tend_h']) - h0
        ew[max(t0 - 12, 0):min(tend + 24, T - 1) + 1] = 1
        if int(e['kept']) != 1:
            continue
        put(rl, t0 - 12, min(t0 + 24, tp), eid)
        put(rlx, t0 - 12, tp, eid)
        # REC (M1)
        stamps = []
        if tp != t0 + 239:
            lftp = lff[tp]
            r = None
            for s in range(tp + 1, min(tend, T - 1) + 1):
                if not np.isnan(lff[s]) and lff[s] > lftp:
                    r = s
                    break
            stamps = [s for s in range(tp + 1, tend + 1) if (r is None or s < r)]
            later = comps[(comps['event_id'] == eid) & (comps['onset_t0_h'] > int(e['event_t0_h']))]
            for _, c in later.iterrows():
                a = int(c['onset_t0_h']) - h0 - 12
                b = int(c['onset_tp_h']) - h0
                stamps = [s for s in stamps if not (a <= s <= b)]
        for s in stamps:
            if 0 <= s < T:
                if not np.isnan(rec[s]) and rec[s] != eid:
                    multi += 1
                rec[s] = eid
        fs = e['rec_start'] if isinstance(e['rec_start'], str) else ''
        fe = e['rec_end'] if isinstance(e['rec_end'], str) else ''
        mine_s = hours_to_iso([stamps[0] + h0])[0][:16].replace('T', ' ') if stamps else ''
        mine_e = hours_to_iso([stamps[-1] + h0])[0][:16].replace('T', ' ') if stamps else ''
        rec_check.append((eid, fs == mine_s and fe == mine_e and int(e['rec_n_stamps']) == len(stamps)))
    return dict(rl=rl, rlx=rlx, rec=rec, ew=ew, normal=1 - ew, multi=multi, rec_check=rec_check)


# ---------------------------------------------------------------- tick files
NUM_COLS = ['in_scoring', 'has_pred', 'raw', 'unc', 'disp', 'ceiling_applied', 'corr', 'nonconverged',
            'lookup_fail', 'travel_por_gf', 'travel_gf_lf', 'b_active', 'lf_view', 'por_view', 'lf_carry_h',
            'por_carry_h', 'mask', 'tau_ref', 'tau_converged', 'truth', 'truth_basehz', 'truth_own',
            'rl_event', 'rlx_event', 'rec_event', 'ew_any', 'normal', 'rate']
STR_COLS = ['tick_utc', 'arm', 'flow_bin', 'flow_state', 'rst', 'stop', 'base_rst', 'base_stop',
            'base_flow_bin', 'base_flow_state', 'mask_why', 'truth_tick_utc', 'truth_basehz_tick',
            'truth_own_tick', 'slot']
TICK_LEVEL = ['in_scoring', 'lf_view', 'por_view', 'lf_carry_h', 'por_carry_h', 'base_rst', 'base_stop',
              'base_flow_bin', 'base_flow_state', 'mask', 'mask_why', 'tau_ref', 'tau_converged', 'truth',
              'truth_tick_utc', 'truth_basehz', 'truth_basehz_tick', 'rl_event', 'rlx_event', 'rec_event',
              'ew_any', 'normal']


def load_ticks(name):
    dtypes = {c: 'float64' for c in NUM_COLS}
    dtypes.update({c: 'object' for c in STR_COLS})
    df = pd.read_csv(os.path.join(BT, TICK_FILES[name]), usecols=NUM_COLS + STR_COLS, dtype=dtypes,
                     keep_default_na=False, na_values=[''])
    n = len(df)
    if n % 4:
        stop('%s: row count %d not a multiple of 4' % (name, n))
    T = n // 4
    d = {}
    for c in NUM_COLS:
        d[c] = df[c].to_numpy().reshape(T, 4)
    for c in STR_COLS:
        d[c] = df[c].fillna('').to_numpy().reshape(T, 4)
    d['T'] = T
    # D-8 OVERRIDE (plan section 12, orchestrator ruling 2026-11-11): the harness gave tick 2026-11-09T12:00Z a
    # truth read at 2026-11-10T00:00Z, one hour beyond the last tick of the D-5 H1 grid. Literal reading stands:
    # that tick has no truth and is outside the common mask in all four files. `mask_file` keeps the mask as
    # written (used only for the report-only G4a_edge / G4b_edge sensitivity and for the step-2 mismatch count).
    d['mask_file'] = d['mask'].copy()
    hit = np.where(d['tick_utc'][:, 0] == D8_TICK)[0]
    if len(hit) != 1:
        stop('%s: D-8 tick %s not found exactly once' % (name, D8_TICK))
    d['mask'][hit[0], :] = 0.0
    d['d8_index'] = int(hit[0])
    return d


def tick_structure_checks(name, d, h0, T_raw):
    T = d['T']
    if T != T_raw:
        stop('%s: %d ticks, expected %d' % (name, T, T_raw))
    arms_ok = np.all(d['arm'] == np.array(ARMS)[None, :])
    if not arms_ok:
        stop('%s: arm order is not base,A,B,C on every tick' % name)
    if not np.all(d['tick_utc'] == d['tick_utc'][:, :1]):
        stop('%s: tick_utc differs within a tick block' % name)
    expect = hours_to_iso(np.arange(T) + h0)
    if not np.all(d['tick_utc'][:, 0] == expect):
        stop('%s: tick_utc is not the hourly grid' % name)
    bad_cols = []
    for c in TICK_LEVEL:
        a = d[c]
        if a.dtype == object:
            same = np.all(a == a[:, :1], axis=1)
        else:
            same = np.all((a == a[:, :1]) | (np.isnan(a) & np.isnan(a[:, :1])), axis=1)
        if not np.all(same):
            bad_cols.append((c, int((~same).sum())))
    if bad_cols:
        stop('%s: tick-level columns differ across arm rows: %s' % (name, bad_cols))
    m = d['mask'][:, 0] == 1
    hp = d['has_pred'][m]
    nbad = int((hp != 1).sum())
    if nbad:
        stop('%s: has_pred != 1 on %d masked arm rows' % (name, nbad))
    return dict(masked_ticks=int(m.sum()))


def eq_nan(a, b):
    return (a == b) | (np.isnan(a) & np.isnan(b))


def step2_assertions(rawd, tr, lab, events):
    h0, T = rawd['h0'], rawd['T']
    my_ttick_iso = np.where(tr['ttick'] >= 0, hours_to_iso(np.maximum(tr['ttick'], 0) + h0), '')
    check = {}
    other_views = {
        'S2': (carried_view(rawd['por'], 0), carried_view(rawd['lf'], 0)),
        'S3': (carried_view(rawd['por'], 1), carried_view(rawd['lf'], 1)),
        'multi': (tr['porv'], tr['lfv']),
    }
    for name in TICK_FILES:
        d = load_ticks(name)
        tick_structure_checks(name, d, h0, T)
        f_tau = d['tau_ref'][:, 0]
        f_truth = d['truth'][:, 0]
        f_tt = d['truth_tick_utc'][:, 0]
        f_mask = d['mask_file'][:, 0] == 1   # mask as written (before the D-8 override)
        f_why = d['mask_why'][:, 0]
        f_conv = d['tau_converged'][:, 0]
        tau_eq = np.isclose(f_tau, tr['tau'], rtol=0, atol=1e-9) | (np.isnan(f_tau) & np.isnan(tr['tau']))
        both = ~np.isnan(f_tau) & ~np.isnan(tr['tau'])
        tau_max = float(np.max(np.abs(f_tau[both] - tr['tau'][both]))) if both.any() else 0.0
        truth_eq = eq_nan(f_truth, tr['truth'])
        tt_eq = (f_tt == my_ttick_iso)
        conv_eq = eq_nan(f_conv, tr['conv'])
        if name == 'primary':
            my_mask = tr['mask']
            why_eq = (f_why == tr['why'])
            lfv_eq = eq_nan(d['lf_view'][:, 0], tr['lfv'])
            porv_eq = eq_nan(d['por_view'][:, 0], tr['porv'])
        else:
            pv, lv = other_views[name]
            my_mask = tr['mask'] & ~np.isnan(pv) & ~np.isnan(lv)
            my_why = np.where(tr['mask'] & ~my_mask, 'view_input_missing', tr['why'])
            why_eq = (f_why == my_why)
            lfv_eq = eq_nan(d['lf_view'][:, 0], lv)
            porv_eq = eq_nan(d['por_view'][:, 0], pv)
        mask_eq = (f_mask == my_mask)
        mism = ~(tau_eq & truth_eq & tt_eq & mask_eq & conv_eq & why_eq)
        # D-8: the override tick must be the ONLY difference; after the override the masks must agree everywhere
        d8 = d['d8_index']
        other = np.where(mism)[0]
        other = other[other != d8]
        mask_after = d['mask'][:, 0] == 1
        mask_after_mism = int((mask_after != my_mask).sum())
        after = int(len(other)) + mask_after_mism
        # D-8: no labelled tick may draw any truth from beyond the H1 grid
        labelled = ~np.isnan(d['rl_event'][:, 0]) | ~np.isnan(d['rlx_event'][:, 0]) | ~np.isnan(d['rec_event'][:, 0])
        beyond = np.zeros(T, dtype=bool)
        for col in ('truth_tick_utc', 'truth_basehz_tick', 'truth_own_tick'):
            a = d[col]
            beyond |= np.any((a != '') & (a > LAST_TICK_ISO), axis=1)
        n_lab_beyond = int((labelled & beyond).sum())
        # labels
        lab_m = ~(eq_nan(d['rl_event'][:, 0], lab['rl']) & eq_nan(d['rlx_event'][:, 0], lab['rlx']) &
                  eq_nan(d['rec_event'][:, 0], lab['rec']) & (d['ew_any'][:, 0] == lab['ew']) &
                  (d['normal'][:, 0] == lab['normal']))
        ins = d['in_scoring'][:, 0] == 1
        my_ins = (np.arange(T) + h0) >= to_hours(pd.Series(['2012-12-01 00:00']))[0]
        info = dict(
            truth_ticks_compared=int(T), truth_mismatches=int(mism.sum()),
            truth_mismatches_after_override=after, d8_tick_is_mismatch=bool(mism[d8]),
            labelled_ticks_truth_beyond_grid=n_lab_beyond,
            ticks_any_truth_beyond_grid=int(beyond.sum()),
            tau_mism=int((~tau_eq).sum()), truth_val_mism=int((~truth_eq).sum()),
            truth_tick_mism=int((~tt_eq).sum()), mask_mism=int((~mask_eq).sum()),
            conv_mism=int((~conv_eq).sum()), mask_why_mism=int((~why_eq).sum()),
            lf_view_mism=int((~lfv_eq).sum()), por_view_mism=int((~porv_eq).sum()),
            tau_max_abs_diff=tau_max, label_mismatches=int(lab_m.sum()),
            in_scoring_mism=int((ins != my_ins).sum()),
            masked_ticks_file=int(f_mask.sum()), masked_ticks_after_override=int(mask_after.sum()),
            n_tau_nonconverged_masked=int((mask_after & ins & (f_conv == 0)).sum()),
            n_tau_nonconverged_masked_all_ticks_file=int((f_mask & (f_conv == 0)).sum()),
        )
        check[name] = info
        log('- %s: %s' % (name, json.dumps(info)))
        if info['truth_mismatches'] or info['label_mismatches'] or info['in_scoring_mism']:
            first = np.where(mism | lab_m)[0][:5]
            if len(other) or mask_after_mism:
                first = np.concatenate([other[:5], first])
            for t in first:
                log('    tick %s: file tau=%r truth=%r tt=%s mask=%r conv=%r | mine tau=%r truth=%r tt=%s mask=%r conv=%r'
                    ' | file rl/rlx/rec/ew=%r/%r/%r/%r mine=%r/%r/%r/%r' % (
                        d['tick_utc'][t, 0], f_tau[t], f_truth[t], f_tt[t], f_mask[t], f_conv[t],
                        tr['tau'][t], tr['truth'][t], my_ttick_iso[t], my_mask[t], tr['conv'][t],
                        d['rl_event'][t, 0], d['rlx_event'][t, 0], d['rec_event'][t, 0], d['ew_any'][t, 0],
                        lab['rl'][t], lab['rlx'][t], lab['rec'][t], lab['ew'][t]))
        del d
    return check


# ---------------------------------------------------------------- metrics
class Out:
    def __init__(self):
        self.rows = []

    def add(self, run, crit, arm, subset, stat, value, key=''):
        if isinstance(value, (bool, np.bool_)):
            value = int(value)
        if isinstance(value, (np.integer,)):
            value = int(value)
        if isinstance(value, (np.floating,)):
            value = float(value)
        self.rows.append((run, crit, arm, subset, stat, '' if key is None else str(key), value))


def per_event_sums(lab, sel, V, ids):
    """S[n_ids, k] sums of V over ticks with lab == id and sel; N[n_ids] tick counts."""
    k = V.shape[1]
    S = np.zeros((len(ids), k))
    N = np.zeros(len(ids), dtype=np.int64)
    for j, eid in enumerate(ids):
        m = sel & (lab == eid)
        N[j] = int(m.sum())
        S[j] = V[m].sum(axis=0)
    return S, N


def boot_counts(indices, n):
    C = np.zeros((indices.shape[0], n), dtype=np.float64)
    rows = np.repeat(np.arange(indices.shape[0]), indices.shape[1])
    np.add.at(C, (rows, indices.ravel()), 1.0)
    return C


def pct_ci(x):
    lo, hi = np.percentile(x, [2.5, 97.5])
    return float(lo), float(hi)


def compute_run(run, d, ev, boots, out):
    T = d['T']
    sc = (d['in_scoring'][:, 0] == 1) & (d['mask'][:, 0] == 1)
    truth = d['truth'][:, 0]
    unc, raw, disp = d['unc'], d['raw'], d['disp']
    e_unc = unc - truth[:, None]
    e_raw = raw - truth[:, None]
    e_disp = disp - truth[:, None]
    for nm, e in (('e_unc', e_unc), ('e_raw', e_raw), ('e_disp', e_disp)):
        if np.isnan(e[sc]).any():
            stop('%s: NaN %s on a scored row' % (run, nm))
    A_unc, A_raw, A_disp = np.abs(e_unc), np.abs(e_raw), np.abs(e_disp)
    rl, rlx, rec = d['rl_event'][:, 0], d['rlx_event'][:, 0], d['rec_event'][:, 0]
    gate, nonoct, oct_id, hold = ev['gate'], ev['nonoct'], ev['oct'], ev['holdout']
    res = {}  # (crit, arm) -> pass

    def gain_from(S, rows, a):
        s = S[rows].sum(axis=0)
        return 1.0 - s[a] / s[0]

    S_rl_all, N_rl_all = per_event_sums(rl, sc, A_unc, gate)
    gate_pos = {e: j for j, e in enumerate(gate)}
    pos_non = [gate_pos[e] for e in nonoct]

    # G1a / G1b
    C_all = boots['all']
    C_non = boots['non']
    for crit, rows, C, thr in (('G1a', list(range(len(gate))), C_all, 0.15), ('G1b', pos_non, C_non, 0.10)):
        S = S_rl_all[rows]
        Nn = N_rl_all[rows]
        Sb = C @ S
        for a in (1, 2, 3):
            mae_a = S[:, a].sum() / Nn.sum()
            mae_b = S[:, 0].sum() / Nn.sum()
            g = 1.0 - S[:, a].sum() / S[:, 0].sum()
            gb = 1.0 - Sb[:, a] / Sb[:, 0]
            lo, hi = pct_ci(gb)
            ok = (g >= thr) and (lo > 0)
            sub = 'RL_all' if crit == 'G1a' else 'RL_nooct'
            for st, v in (('mae_arm', mae_a), ('mae_base', mae_b), ('gain', g), ('ci_lo', lo), ('ci_hi', hi),
                          ('n_ticks', int(Nn.sum())), ('n_events', len(rows)), ('pass', ok)):
                out.add(run, crit, ARMS[a], sub, st, v)
            res[(crit, a)] = ok

    # G2
    for a in (1, 2, 3):
        imp = 0
        for j, eid in enumerate(gate):
            out.add(run, 'G2', ARMS[a], 'RL_all', 'sum_abs_arm', S_rl_all[j, a], key=eid)
            out.add(run, 'G2', ARMS[a], 'RL_all', 'sum_abs_base', S_rl_all[j, 0], key=eid)
            out.add(run, 'G2', ARMS[a], 'RL_all', 'n_ticks', int(N_rl_all[j]), key=eid)
            if S_rl_all[j, a] < S_rl_all[j, 0]:
                imp += 1
        n = len(gate)
        ok = imp * 100 >= 65 * n
        for st, v in (('improved', imp), ('n_events', n), ('share', imp / n), ('pass', ok)):
            out.add(run, 'G2', ARMS[a], 'RL_all', st, v)
        res[('G2', a)] = ok

    # G3a / G3b
    with np.errstate(divide='ignore', invalid='ignore'):
        P_raw = 100.0 * e_raw / truth[:, None]
    B_rec, N_rec = per_event_sums(rec, sc, P_raw, gate)
    tot_n = N_rec.sum()
    bias = B_rec.sum(axis=0) / tot_n
    Bb = (C_all @ B_rec) / (C_all @ N_rec.astype(float))[:, None]
    for a in (1, 2, 3):
        db = abs(bias[a]) - abs(bias[0])
        dbb = np.abs(Bb[:, a]) - np.abs(Bb[:, 0])
        lo, hi = pct_ci(dbb)
        ok = (db <= 0) and (hi <= 1.0)
        for st, v in (('bias_arm', bias[a]), ('bias_base', bias[0]), ('d_bias', db), ('ci_lo', lo),
                      ('ci_hi', hi), ('n_ticks', int(tot_n)), ('pass', ok)):
            out.add(run, 'G3a', ARMS[a], 'REC_all', st, v)
        res[('G3a', a)] = ok
        ok3b = abs(bias[a]) <= 1.6
        out.add(run, 'G3b', ARMS[a], 'REC_all', 'abs_bias_arm', abs(bias[a]))
        out.add(run, 'G3b', ARMS[a], 'REC_all', 'pass', ok3b)
        res[('G3b', a)] = ok3b

    # G4a / G4b (decide) and G4a_edge / G4b_edge (report-only, D-8: the file's mask as written)
    cellkey = np.char.add(np.char.add(d['base_flow_bin'][:, 0].astype(str), '|'),
                          d['base_flow_state'][:, 0].astype(str))
    sc_edge = (d['in_scoring'][:, 0] == 1) & (d['mask_file'][:, 0] == 1)
    if np.isnan(A_disp[sc_edge]).any():
        stop('%s: NaN e_disp on a file-masked row' % run)
    for sel_base, ca, cb, decides in ((sc, 'G4a', 'G4b', True), (sc_edge, 'G4a_edge', 'G4b_edge', False)):
        nm = sel_base & (d['normal'][:, 0] == 1)
        sn = A_disp[nm].sum(axis=0)
        nn = int(nm.sum())
        cells = sorted(set(cellkey[nm]))
        for a in (1, 2, 3):
            rc = (sn[a] / nn) / (sn[0] / nn) - 1.0
            ok = rc <= 0.02
            for st, v in (('mae_arm', sn[a] / nn), ('mae_base', sn[0] / nn), ('rel_change', rc), ('n_ticks', nn),
                          ('pass', ok)):
                out.add(run, ca, ARMS[a], 'NORMAL', st, v)
            if decides:
                res[(ca, a)] = ok
            worst = -np.inf
            ncell = 0
            for ck in cells:
                cm = nm & (cellkey == ck)
                k = int(cm.sum())
                if k < 200:
                    continue
                s_ = A_disp[cm].sum(axis=0)
                r = (s_[a] / k) / (s_[0] / k) - 1.0
                ncell += 1
                worst = max(worst, r)
                out.add(run, cb, ARMS[a], 'NORMAL', 'n_ticks', k, key=ck)
                out.add(run, cb, ARMS[a], 'NORMAL', 'rel_change', r, key=ck)
            ok = bool(ncell > 0 and worst <= 0.05)
            out.add(run, cb, ARMS[a], 'NORMAL', 'n_cells', ncell)
            out.add(run, cb, ARMS[a], 'NORMAL', 'worst_rel_change', worst)
            out.add(run, cb, ARMS[a], 'NORMAL', 'pass', ok)
            if decides:
                res[(cb, a)] = ok

    # G5 / G7e / P3
    stop_ = d['stop']
    nonconv = (stop_ == 'max_iter')
    if not np.array_equal(nonconv, d['nonconverged'] == 1):
        # rows without prediction carry blanks; compare only on scored rows
        if not np.array_equal(nonconv[sc], (d['nonconverged'] == 1)[sc]):
            stop('%s: nonconverged column disagrees with stop == max_iter on scored rows' % run)
    lfail = (stop_ == 'no_hist') | (stop_ == 'hist_lost')
    base_rising = d['base_rst'][:, 0] == 'rising'

    def rising_sel(ids):
        return sc & base_rising & np.isin(rl, ids)
    shares = {}
    for sub, ids in (('RL_rising_all', gate), ('RL_rising_nooct', nonoct)):
        rs = rising_sel(ids)
        nr = int(rs.sum())
        for a in range(4):
            nc = int(nonconv[rs, a].sum())
            sh = nc / nr if nr else float('nan')
            shares[(sub, a)] = sh
            out.add(run, 'G5a', ARMS[a], sub, 'n_rising', nr)
            out.add(run, 'G5a', ARMS[a], sub, 'n_nonconverged', nc)
            out.add(run, 'G5a', ARMS[a], sub, 'share', sh)
    for a in (2, 3):
        ok = all(shares[(s, a)] < 0.05 for s in ('RL_rising_all', 'RL_rising_nooct'))
        out.add(run, 'G5a', ARMS[a], '', 'pass', ok)
        res[('G5a', a)] = ok
    oks = []
    for sub in ('RL_rising_all', 'RL_rising_nooct'):
        diff = shares[(sub, 1)] - shares[(sub, 0)]
        out.add(run, 'G5b', 'A', sub, 'diff', diff)
        oks.append(diff <= 0)
    out.add(run, 'G5b', 'A', '', 'pass', all(oks))
    res[('G5b', 1)] = all(oks)
    rs = rising_sel(gate)
    nr = int(rs.sum())
    for a in (1, 2, 3):
        sa = lfail[rs, a].sum() / nr
        sb = lfail[rs, 0].sum() / nr
        ok = sa <= sb
        out.add(run, 'G7e', ARMS[a], 'RL_rising_all', 'share_arm', sa)
        out.add(run, 'G7e', ARMS[a], 'RL_rising_all', 'share_base', sb)
        out.add(run, 'G7e', ARMS[a], 'RL_rising_all', 'pass', ok)
        res[('G7e', a)] = ok
    if oct_id is not None:
        rs = sc & base_rising & (rl == oct_id)
        nr = int(rs.sum())
        nc = int(nonconv[rs, 0].sum())
        sh = nc / nr if nr else float('nan')
        out.add(run, 'P3', 'base', 'OCT_RL_rising', 'n_rising', nr)
        out.add(run, 'P3', 'base', 'OCT_RL_rising', 'n_nonconverged', nc)
        out.add(run, 'P3', 'base', 'OCT_RL_rising', 'share', sh)
        out.add(run, 'P3', 'base', 'OCT_RL_rising', 'pass', bool(sh >= 0.20))

    # G6a
    for a in (1, 2, 3):
        allok = True
        for sub, ids in (('LOEO_all', gate), ('LOEO_nooct', nonoct)):
            gains = []
            subok = True
            for drop in ids:
                rows = [gate_pos[e] for e in ids if e != drop]
                g = gain_from(S_rl_all, rows, a)
                imp = int(sum(S_rl_all[r, a] < S_rl_all[r, 0] for r in rows))
                n = len(rows)
                thr = 0.10 if (sub == 'LOEO_nooct' or drop == oct_id) else 0.15
                ok = (g >= thr) and (imp * 100 >= 65 * n)
                gains.append(g)
                subok = subok and ok
                for st, v in (('gain', g), ('improved', imp), ('n_events', n), ('threshold_gain', thr), ('ok', ok)):
                    out.add(run, 'G6a', ARMS[a], sub, st, v, key=drop)
            out.add(run, 'G6a', ARMS[a], sub, 'min_gain', min(gains))
            out.add(run, 'G6a', ARMS[a], sub, 'pass', subok)
            allok = allok and subok
        out.add(run, 'G6a', ARMS[a], '', 'pass', allok)
        res[('G6a', a)] = allok

    # G6b
    hrows = [gate_pos[e] for e in hold]
    for a in (1, 2, 3):
        g = gain_from(S_rl_all, hrows, a)
        imp = int(sum(S_rl_all[r, a] < S_rl_all[r, 0] for r in hrows))
        n = len(hrows)
        ok = (g >= 0.10) and (imp * 100 >= 65 * n)
        for st, v in (('gain', g), ('improved', imp), ('n_events', n), ('pass', ok)):
            out.add(run, 'G6b', ARMS[a], 'RL_H', st, v)
        res[('G6b', a)] = ok

    # G7a, G7b, G7c, G7d, G7f
    rlsel = sc & np.isin(rl, gate)
    s_raw = A_raw[rlsel].sum(axis=0)
    n_rl = int(rlsel.sum())
    with np.errstate(divide='ignore', invalid='ignore'):
        mape = (100.0 * A_unc[rlsel] / truth[rlsel][:, None]).mean(axis=0)
    s_disp = A_disp[rlsel].sum(axis=0)
    rlxsel = sc & np.isin(rlx, gate)
    s_rlx = A_unc[rlxsel].sum(axis=0)
    tbh = d['truth_basehz'][:, 0]
    town = d['truth_own']
    bad_base_own = rlsel & ~eq_nan(town[:, 0], tbh)
    if bad_base_own.any():
        stop('%s: base truth_own != truth_basehz on %d RL ticks' % (run, int(bad_base_own.sum())))
    for a in (1, 2, 3):
        v = 1.0 - s_raw[a] / s_raw[0]
        ok = v > 0
        for st, x in (('rawmae_arm', s_raw[a] / n_rl), ('rawmae_base', s_raw[0] / n_rl), ('value', v), ('pass', ok)):
            out.add(run, 'G7a', ARMS[a], 'RL_all', st, x)
        res[('G7a', a)] = ok
        v = 1.0 - mape[a] / mape[0]
        ok = v > 0
        for st, x in (('mape_arm', mape[a]), ('mape_base', mape[0]), ('value', v), ('pass', ok)):
            out.add(run, 'G7b', ARMS[a], 'RL_all', st, x)
        res[('G7b', a)] = ok
        v = 1.0 - s_rlx[a] / s_rlx[0]
        ok = v >= 0
        out.add(run, 'G7c', ARMS[a], 'RLX_all', 'value', v)
        out.add(run, 'G7c', ARMS[a], 'RLX_all', 'pass', ok)
        res[('G7c', a)] = ok
        dsel = rlsel & ~np.isnan(tbh) & ~np.isnan(town[:, a])
        gbh = 1.0 - np.abs(unc[dsel, a] - tbh[dsel]).sum() / np.abs(unc[dsel, 0] - tbh[dsel]).sum()
        gown = 1.0 - np.abs(unc[dsel, a] - town[dsel, a]).sum() / np.abs(unc[dsel, 0] - town[dsel, 0]).sum()
        ok = (gbh >= 0) and (gown >= 0)
        for st, x in (('gain_basehz', gbh), ('gain_own', gown), ('n_ticks', int(dsel.sum())), ('pass', ok)):
            out.add(run, 'G7d', ARMS[a], 'RL_all', st, x)
        res[('G7d', a)] = ok
        v = 1.0 - s_disp[a] / s_disp[0]
        ok = v >= 0
        out.add(run, 'G7f', ARMS[a], 'RL_all', 'value', v)
        out.add(run, 'G7f', ARMS[a], 'RL_all', 'pass', ok)
        res[('G7f', a)] = ok

    # ARM
    common = ['G1a', 'G1b', 'G2', 'G3a', 'G3b', 'G4a', 'G4b', 'G6a', 'G6b', 'G7a', 'G7b', 'G7c', 'G7d', 'G7e', 'G7f']
    for a in (1, 2, 3):
        crits = common[:7] + (['G5b'] if a == 1 else ['G5a']) + common[7:]
        failed = [c for c in crits if not res[(c, a)]]
        out.add(run, 'ARM', ARMS[a], '', 'all_pass', len(failed) == 0)
        out.add(run, 'ARM', ARMS[a], '', 'n_failed', len(failed), key=';'.join(failed))


def event_sets(events):
    kept = events[events['kept'] == 1]
    g = kept[kept['event_class'] == 'GATE'].sort_values('event_t0_h')
    gate = [int(x) for x in g['event_id']]
    nonoct = [int(x) for x in g[g['oct'] != 1]['event_id']]
    octs = [int(x) for x in g[g['oct'] == 1]['event_id']]
    hold = [int(x) for x in g[g['holdout'] == 1]['event_id']]
    strat = [int(x) for x in kept[kept['event_class'] == 'STRATUM'].sort_values('event_t0_h')['event_id']]
    # oct flag must agree with the literal rule: GATE kept event containing 2026-10-14 12:00
    octh = to_hours(pd.Series([OCT_STAMP]))[0]
    lit = [int(r['event_id']) for _, r in g.iterrows() if r['event_t0_h'] <= octh <= r['event_tend_h']]
    if lit != octs:
        stop('oct flag in event file disagrees with literal rule: %s vs %s' % (octs, lit))
    hold_lit = nonoct[-int(math.ceil(0.20 * len(nonoct))):]
    if hold_lit != hold:
        stop('holdout flags disagree with last ceil(0.2 N_nonOct): %s vs %s' % (hold, hold_lit))
    return dict(gate=gate, nonoct=nonoct, oct=(octs[0] if octs else None), holdout=hold, stratum=strat)


def main():
    assert_only = '--assert-only' in sys.argv
    log('\n## run of rising_limb_metrics_python.py %s' % ('(assert-only)' if assert_only else '(full)'))
    sums = step1_checksums()
    log('step 1 checksums OK: ' + json.dumps(sums))

    rawd = load_raw()
    tr = truth_rule(rawd)
    events, comps = load_events()
    ev = event_sets(events)
    lab = derive_labels(events, comps, rawd)
    rc_bad = [e for e, ok in lab['rec_check'] if not ok]
    log('step 2: own lag view / tau_ref / truth / labels built. REC rebuilt from filled LF; events whose REC '
        'differs from the event file rec_start/rec_end/rec_n_stamps: %s; overlapping labels: %d' % (rc_bad, lab['multi']))
    log('event sets: GATE kept %d %s; non-Oct %d; Oct %s; holdout %s; STRATUM kept %d' % (
        len(ev['gate']), ev['gate'], len(ev['nonoct']), ev['oct'], ev['holdout'], len(ev['stratum'])))
    check = step2_assertions(rawd, tr, lab, events)
    bad = {k: v for k, v in check.items() if v['truth_mismatches_after_override'] or v['label_mismatches']
           or v['in_scoring_mism'] or v['labelled_ticks_truth_beyond_grid']}
    if rc_bad or lab['multi']:
        stop('own REC/label derivation inconsistent with event file: %s, overlaps %d' % (rc_bad, lab['multi']))
    if bad:
        stop('truth/label mismatches after the D-8 override, or labelled ticks with truth beyond the grid: '
             + json.dumps(bad))
    log('step 2 assertions PASSED on all four files (D-8 override applied: the only difference is %s).' % D8_TICK)
    with open(os.path.join(HERE, 'step2_check.json'), 'w') as f:
        json.dump(check, f, indent=1)
    if assert_only:
        return

    # step 3 metrics
    bi_all = pd.read_csv(os.path.join(BT, BOOT_ALL), header=None).to_numpy()
    bi_non = pd.read_csv(os.path.join(BT, BOOT_NON), header=None).to_numpy()
    if bi_all.shape != (10000, len(ev['gate'])) or bi_non.shape != (10000, len(ev['nonoct'])):
        stop('bootstrap index shapes %s %s' % (bi_all.shape, bi_non.shape))
    boots = dict(all=boot_counts(bi_all, len(ev['gate'])), non=boot_counts(bi_non, len(ev['nonoct'])))
    out = Out()
    for run in TICK_FILES:
        d = load_ticks(run)
        compute_run(run, d, ev, boots, out)
        c = check[run]
        for st in ('truth_ticks_compared', 'truth_mismatches', 'truth_mismatches_after_override',
                   'tau_max_abs_diff', 'label_mismatches'):
            out.add(run, 'CHECK', '', '', st, c[st])
        out.add(run, 'CHECK', '', '', 'n_gate_events', len(ev['gate']))
        out.add(run, 'CHECK', '', '', 'n_gate_events_nooct', len(ev['nonoct']))
        out.add(run, 'CHECK', '', '', 'n_holdout', len(ev['holdout']))
        out.add(run, 'CHECK', '', '', 'n_tau_nonconverged_masked', c['n_tau_nonconverged_masked'])
        log('step 3: gate metrics computed for run %s' % run)
        del d
    write_outputs(out)

    # step 4: report-only items (after the gate files are written and logged)
    ro = RO()
    for run in TICK_FILES:
        d = load_ticks(run)
        report_only(run, d, ev, events, rawd, ro)
        log('step 4: report-only items computed for run %s' % run)
        del d
    ro.write(os.path.join(HERE, 'rising_limb_report_only_python.csv'))
    log('wrote rising_limb_report_only_python.csv (%d rows)' % len(ro.rows))


# ---------------------------------------------------------------- report-only (plan sections 3 and 4)
class RO:
    def __init__(self):
        self.rows = []

    def add(self, run, item, arm, group, stat, value, key=''):
        if isinstance(value, (bool, np.bool_)):
            value = int(value)
        if isinstance(value, np.integer):
            value = int(value)
        if isinstance(value, np.floating):
            value = float(value)
        self.rows.append((run, item, arm, str(group), stat, str(key), value))

    def write(self, path):
        with open(path, 'w') as f:
            f.write('run,item,arm,group,stat,key,value\n')
            for r in self.rows:
                v = r[6]
                vs = repr(float(v)) if isinstance(v, float) else str(v)
                f.write(','.join([str(x) for x in r[:6]] + [vs]) + '\n')


def season_of(month):
    return {12: 'DJF', 1: 'DJF', 2: 'DJF', 3: 'MAM', 4: 'MAM', 5: 'MAM', 6: 'JJA', 7: 'JJA', 8: 'JJA',
            9: 'SON', 10: 'SON', 11: 'SON'}[month]


def observed_lag(por, lf, t0):
    """lag 0..48 h maximising the Pearson correlation of hourly first differences, LF over stamps
    [t0-12 h, t0+36 h] against PoR shifted back by the lag (raw stamps, pairs with both differences present)."""
    T = len(lf)
    dP = np.full(T, np.nan)
    dL = np.full(T, np.nan)
    dP[1:] = por[1:] - por[:-1]
    dL[1:] = lf[1:] - lf[:-1]
    s = np.arange(t0 - 12, t0 + 37)
    s = s[(s >= 0) & (s < T)]
    best = (None, -np.inf, 0)
    for k in range(0, 49):
        sp = s - k
        ok = sp >= 1
        x = dP[sp[ok]]
        y = dL[s[ok]]
        g = ~np.isnan(x) & ~np.isnan(y)
        if g.sum() < 10 or np.std(x[g]) == 0 or np.std(y[g]) == 0:
            continue
        r = float(np.corrcoef(x[g], y[g])[0, 1])
        if r > best[1]:
            best = (k, r, int(g.sum()))
    return best


def report_only(run, d, ev, events, rawd, ro):
    h0 = rawd['h0']
    T = d['T']
    sc = (d['in_scoring'][:, 0] == 1) & (d['mask'][:, 0] == 1)
    truth = d['truth'][:, 0]
    A_unc = np.abs(d['unc'] - truth[:, None])
    A_disp = np.abs(d['disp'] - truth[:, None])
    rl = d['rl_event'][:, 0]
    evi = events.set_index('event_id')

    def group_gain(item, group, ids, sel_lab=rl, V=A_unc):
        S, N = per_event_sums(sel_lab, sc, V, ids)
        for a in (1, 2, 3):
            imp = int(sum(S[j, a] < S[j, 0] for j in range(len(ids))))
            n_t = int(N.sum())
            ro.add(run, item, ARMS[a], group, 'n_events', len(ids))
            ro.add(run, item, ARMS[a], group, 'n_ticks', n_t)
            if n_t:
                ro.add(run, item, ARMS[a], group, 'mae_arm', S[:, a].sum() / n_t)
                ro.add(run, item, ARMS[a], group, 'mae_base', S[:, 0].sum() / n_t)
                ro.add(run, item, ARMS[a], group, 'gain', 1.0 - S[:, a].sum() / S[:, 0].sum())
            ro.add(run, item, ARMS[a], group, 'improved', imp)

    gate = ev['gate']
    # section 3 strata
    group_gain('STRATUM_RL', 'STRATUM_all', ev['stratum'])
    lfled, porled, unk = [], [], []
    for e in gate:
        t0 = int(evi.loc[e, 'event_t0_h']) - h0
        p, l = rawd['por'][t0], rawd['lf'][t0]
        if np.isnan(p) or np.isnan(l):
            unk.append(e)
        elif p < 0.5 * l:
            lfled.append(e)
        else:
            porled.append(e)
    for g, ids in (('LF_led', lfled), ('PoR_led', porled), ('unknown', unk)):
        ro.add(run, 'LEAD_RL', '', g, 'event_ids', ';'.join(map(str, ids)))
        if ids:
            group_gain('LEAD_RL', g, ids)
    seasons = {}
    for e in gate:
        m = int(pd.Timestamp(evi.loc[e, 'event_t0']).month)
        seasons.setdefault(season_of(m), []).append(e)
    for g in ('DJF', 'MAM', 'JJA', 'SON'):
        ids = seasons.get(g, [])
        ro.add(run, 'SEASON_RL', '', g, 'event_ids', ';'.join(map(str, ids)))
        if ids:
            group_gain('SEASON_RL', g, ids)
    pk1 = [e for e in gate if evi.loc[e, 'event_peak_lf'] < 25000]
    pk2 = [e for e in gate if evi.loc[e, 'event_peak_lf'] >= 25000]
    for g, ids in (('12k_25k', pk1), ('25k_plus', pk2)):
        ro.add(run, 'PEAK_RL', '', g, 'event_ids', ';'.join(map(str, ids)))
        if ids:
            group_gain('PEAK_RL', g, ids)

    # section 4 diagnostics
    trav = d['travel_por_gf'] + d['travel_gf_lf']
    for e in gate:
        t0 = int(evi.loc[e, 'event_t0_h']) - h0
        k, r, npair = observed_lag(rawd['por'], rawd['lf'], t0)
        ro.add(run, 'TRAVEL', '', 'GATE', 'observed_lag_h', '' if k is None else k, key=e)
        ro.add(run, 'TRAVEL', '', 'GATE', 'observed_corr', r if k is not None else '', key=e)
        ro.add(run, 'TRAVEL', '', 'GATE', 'n_pairs', npair, key=e)
        m = sc & (rl == e)
        for a in range(4):
            ro.add(run, 'TRAVEL', ARMS[a], 'GATE', 'modelled_por_lf_mean_h', float(np.mean(trav[m, a])), key=e)

    # PoR crest to LF crest, arm B
    ba = d['b_active']
    for e in gate:
        t0 = int(evi.loc[e, 'event_t0_h']) - h0
        tp = int(evi.loc[e, 'event_tp_h']) - h0
        seg = rawd['por'][max(t0 - 12, 0):tp + 1]
        if np.all(np.isnan(seg)):
            continue
        crest = max(t0 - 12, 0) + int(np.nanargmax(seg))
        ticks = np.arange(crest + 2, tp + 1)  # PoR crest reaches the model 2 h later (lag view)
        m = np.zeros(T, dtype=bool)
        m[ticks[(ticks >= 0) & (ticks < T)]] = True
        m &= sc
        n = int(m.sum())
        ro.add(run, 'CREST_B', '', 'GATE', 'por_crest_to_lf_crest_h', tp - crest, key=e)
        ro.add(run, 'CREST_B', 'B', 'GATE', 'n_ticks', n, key=e)
        if n:
            ro.add(run, 'CREST_B', 'B', 'GATE', 'n_b_inactive', int((ba[m, 2] == 0).sum()), key=e)
            ro.add(run, 'CREST_B', 'B', 'GATE', 'mae_arm', float(A_unc[m, 2].mean()), key=e)
            ro.add(run, 'CREST_B', 'B', 'GATE', 'mae_base', float(A_unc[m, 0].mean()), key=e)

    # literal brief window [t0, t0+24 h]
    lit = np.full(T, np.nan)
    for e in gate:
        t0 = int(evi.loc[e, 'event_t0_h']) - h0
        lit[max(t0, 0):min(t0 + 24, T - 1) + 1] = e
    group_gain('BRIEF_WINDOW', 'GATE_all', gate, sel_lab=lit)

    # event-equal-weighted gain
    S, N = per_event_sums(rl, sc, A_unc, gate)
    for g, ids in (('GATE_all', gate), ('GATE_nooct', ev['nonoct'])):
        rows = [gate.index(e) for e in ids]
        mae = S[rows] / N[rows][:, None]
        for a in (1, 2, 3):
            ro.add(run, 'EVENT_EQUAL', ARMS[a], g, 'mean_event_gain', float(np.mean(1.0 - mae[:, a] / mae[:, 0])))
            ro.add(run, 'EVENT_EQUAL', ARMS[a], g, 'gain_of_mean_mae',
                   float(1.0 - mae[:, a].mean() / mae[:, 0].mean()))

    # cap-bind rate
    ca = d['ceiling_applied']
    rlsel = sc & np.isin(rl, gate)
    nm = sc & (d['normal'][:, 0] == 1)
    for a in range(4):
        ro.add(run, 'CAP_BIND', ARMS[a], 'RL_all', 'rate', float((ca[rlsel, a] == 1).mean()))
        ro.add(run, 'CAP_BIND', ARMS[a], 'NORMAL', 'rate', float((ca[nm, a] == 1).mean()))

    # per-year and per-bin tables
    t0year = {e: int(pd.Timestamp(evi.loc[e, 'event_t0']).year) for e in gate}
    tick_year = pd.to_datetime((np.arange(T) + h0) * 3600, unit='s', utc=True).year.to_numpy()
    rl_year = np.array([t0year.get(int(x), -1) if not np.isnan(x) else -1 for x in rl])
    for y in sorted(set(t0year.values())):
        m = rlsel & (rl_year == y)
        for a in range(4):
            ro.add(run, 'YEAR_RL_MAE', ARMS[a], 'RL_all', 'mae_unc', float(A_unc[m, a].mean()), key=y)
        ro.add(run, 'YEAR_RL_MAE', '', 'RL_all', 'n_ticks', int(m.sum()), key=y)
    for y in sorted(set(tick_year[nm])):
        m = nm & (tick_year == y)
        for a in range(4):
            ro.add(run, 'YEAR_NORMAL_MAE', ARMS[a], 'NORMAL', 'mae_disp', float(A_disp[m, a].mean()), key=y)
        ro.add(run, 'YEAR_NORMAL_MAE', '', 'NORMAL', 'n_ticks', int(m.sum()), key=y)
    bb = d['base_flow_bin'][:, 0]
    for nmname, sel, V, st in (('BIN_RL_MAE', rlsel, A_unc, 'mae_unc'), ('BIN_NORMAL_MAE', nm, A_disp, 'mae_disp')):
        for b in sorted(set(bb[sel])):
            m = sel & (bb == b)
            for a in range(4):
                ro.add(run, nmname, ARMS[a], '', st, float(V[m, a].mean()), key=b)
            ro.add(run, nmname, '', '', 'n_ticks', int(m.sum()), key=b)

    # normal-hours calendar-month block bootstrap (seed 20261111, report-only, D-7 E3)
    ym = pd.to_datetime((np.arange(T) + h0) * 3600, unit='s', utc=True).strftime('%Y-%m').to_numpy()
    months = sorted(set(ym[nm]))
    M = len(months)
    pos = {m_: j for j, m_ in enumerate(months)}
    Sm = np.zeros((M, 4))
    for j, m_ in enumerate(months):
        Sm[j] = A_disp[nm & (ym == m_)].sum(axis=0)
    rng = np.random.default_rng(20261111)
    idx = rng.integers(0, M, size=(10000, M))
    Cm = boot_counts(idx, M)
    Sb = Cm @ Sm
    for a in (1, 2, 3):
        rc = Sb[:, a] / Sb[:, 0] - 1.0
        lo, hi = pct_ci(rc)
        ro.add(run, 'NORMAL_MONTH_BOOT', ARMS[a], 'NORMAL', 'rel_change', float(Sm[:, a].sum() / Sm[:, 0].sum() - 1.0))
        ro.add(run, 'NORMAL_MONTH_BOOT', ARMS[a], 'NORMAL', 'ci_lo', lo)
        ro.add(run, 'NORMAL_MONTH_BOOT', ARMS[a], 'NORMAL', 'ci_hi', hi)
        ro.add(run, 'NORMAL_MONTH_BOOT', ARMS[a], 'NORMAL', 'n_months', M)
    del pos


def write_outputs(out):
    cols = ['run', 'criterion', 'arm', 'subset', 'stat', 'key', 'value']
    path = os.path.join(HERE, 'rising_limb_metrics_python.csv')
    with open(path, 'w') as f:
        f.write(','.join(cols) + '\n')
        for r in out.rows:
            v = r[6]
            vs = repr(float(v)) if isinstance(v, float) else str(v)
            f.write(','.join([str(x) for x in r[:6]] + [vs]) + '\n')
    js = {}
    for run, crit, arm, sub, st, key, v in out.rows:
        if isinstance(v, float) and not math.isfinite(v):
            v = None
        js.setdefault(run, {}).setdefault(crit, {}).setdefault(arm, {}).setdefault(sub, {}).setdefault(st, {})[key] = v
    with open(os.path.join(HERE, 'rising_limb_metrics_python.json'), 'w') as f:
        json.dump(js, f, indent=1)
    log('wrote rising_limb_metrics_python.csv (%d rows) and .json' % len(out.rows))


if __name__ == '__main__':
    sys.path.insert(0, HERE)
    main()
