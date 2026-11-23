"""Driver for Part R.  Run from the study folder:  python3 -I py_R/run_all.py [R1 R2 ...]"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import data

wanted = sys.argv[1:] or ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']
if len(wanted) == 8:
    for d in ('tables', 'metrics_parts'):
        p = os.path.join(HERE, d)
        if os.path.isdir(p):
            for fn in os.listdir(p):
                os.remove(os.path.join(p, fn))
t0 = time.time()
c = data.load()
print('loaded', round(time.time() - t0, 1), 's', flush=True)
rep = []
metrics_all = []
for q in wanted:
    mod = __import__(q.lower())
    M = Metrics()
    mod.run(c, M, rep)
    # metrics of each question go to their own part file, merged at the end
    os.makedirs(os.path.join(HERE, 'metrics_parts'), exist_ok=True)
    M.write(os.path.join(HERE, 'metrics_parts', '%s.csv' % q))
    print(q, 'done', round(time.time() - t0, 1), 's', flush=True)
full = len(wanted) == 8
with open(os.path.join(HERE, 'run_log.txt' if full else 'run_log_partial_%s.txt' % '_'.join(wanted)), 'w') as f:
    f.write('\n'.join(rep) + '\n')
# merge metric parts of all questions present
import csv
allrows = []
for q in ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']:
    p = os.path.join(HERE, 'metrics_parts', '%s.csv' % q)
    if os.path.exists(p):
        with open(p, newline='') as f:
            rd = csv.reader(f)
            next(rd)
            allrows.extend(list(rd))
with open(os.path.join(HERE, 'metrics.csv'), 'w', newline='') as f:
    w = csv.writer(f, lineterminator='\n')
    w.writerow(['question', 'group', 'metric', 'value'])
    w.writerows(allrows)
