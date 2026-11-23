from lib import *
from data import *

COLS = ['gauge', 'parameter', 'n_pairs', 'n_equal', 'n_changed', 'first_changed_time_utc', 'last_changed_time_utc',
        'max_abs_diff', 'n_distinct_lm_minutes_of_changed']


def compare(oldd, curd, g, p):
    sh = sorted(t for t in oldd if t in curd)
    ch = [t for t in sh if oldd[t][0] != curd[t][0]]
    lms = set(iso_minute(curd[t][1]) for t in ch if curd[t][1] is not None)
    return dict(gauge=g, parameter=p, n_pairs=len(sh), n_equal=len(sh) - len(ch), n_changed=len(ch),
                first_changed_time_utc=iso(ch[0]) if ch else None, last_changed_time_utc=iso(ch[-1]) if ch else None,
                max_abs_diff=max([abs(oldd[t][0] - curd[t][0]) for t in sh]) if sh else None,
                n_distinct_lm_minutes_of_changed=len(lms))


def run(c, M, rep):
    rows = []
    for k in sorted(c.old):
        if k == (POR, '00060'):
            continue
        cd = c.cur.get(k)
        if cd is None:
            rep.append('R2: no current series for %s' % (k,))
            continue
        rows.append(compare(c.old[k], cd, k[0], k[1]))
    n = write_table('R2_series', COLS, rows)
    rep.append('R2_series rows %d' % n)
    r = compare(c.octp[(POR, '00065')], c.cur[(POR, '00065')], POR, '00065')
    n = write_table('R2_por_level_octpull', COLS, [r])
    rep.append('R2_por_level_octpull rows %d' % n)
    # job log
    lev = c.cur[(POR, '00065')]
    rows = []
    nn = ne = nmiss = 0
    for seq in c.seqs:
        r_ = c.run_by_seq[seq]
        t = ts(r_['in_por_hT_utc'])
        lh = fnum(r_['in_por_h'])
        ch = lev[t][0] if t in lev else None
        if lh is None or ch is None:
            nmiss += 1
            continue
        nn += 1
        if lh == ch:
            ne += 1
        else:
            rows.append(dict(seq=seq, in_por_hT_utc=iso(t), logged_h=lh, current_h=ch))
    M.add('R2', 'n', nn)
    M.add('R2', 'n_equal', ne)
    n = write_table('R2_por_level_log_mismatch', ['seq', 'in_por_hT_utc', 'logged_h', 'current_h'], rows)
    rep.append('R2_por_level_log_mismatch rows %d; used runs without a comparable pair: %d' % (n, nmiss))
