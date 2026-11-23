from ppw import *

def read_csv(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))

def load(ctx):
    runs = [r for r in read_csv(S + 'data/tidy/runs.csv') if r['used'] == '1']
    runs.sort(key=lambda r: int(r['seq']))
    labels = {int(r['seq']): r for r in read_csv(S + 'replay/out/labels.csv')}
    truth = {}
    for r in read_csv(S + 'replay/out/truth.csv'):
        truth[(int(r['seq']), r['scenario'])] = r
    replay = {}
    for r in read_csv(S + 'replay/out/replay_runs.csv'):
        replay[(int(r['seq']), r['scenario'])] = r
    cells = collections.defaultdict(dict)
    for r in read_csv(S + 'replay/out/replay_2x2x2.csv'):
        cells[(int(r['seq']), r['old_rule'])][(r['flow_numbers'], r['reading_pick_from'], r['due_from'])] = r
    phase = {}; gm = {}
    for q, l in labels.items():
        a = l['label_all_three']
        phase[q] = 'OLD' if a == 'old' else ('NEW' if a == 'new' else 'TRANS')
        gm[q] = l['gate_miss']
    ctx.update(runs=runs, labels=labels, truth=truth, replay=replay, cells=cells, phase=phase, gate_miss=gm)
    for r in runs:
        r['seq_i'] = int(r['seq'])
        r['at_t'] = parse_iso(r['at_utc']); r['due_t'] = parse_iso(r['due_utc'])
        r['day'] = int(r['at_t'] // 86400)
    ctx['runs_by_seq'] = {r['seq_i']: r for r in runs}
    assert len(runs) == 275 and len(phase) == 275
    # phase facts
    for p in ('OLD', 'NEW', 'TRANS'):
        sq = [r['seq_i'] for r in runs if phase[r['seq_i']] == p]
        M('W3', p, 'phase_n_runs', len(sq)); M('W3', p, 'phase_first_seq', min(sq)); M('W3', p, 'phase_last_seq', max(sq))
        log('phase %s n=%d first=%d last=%d' % (p, len(sq), min(sq), max(sq)))
