"""One command from the study folder:  python3 -I py_W/run_all.py"""
import sys, os, time
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ppw import *
import q_w12, q_w3, rundata, q_w456, q_w7

ctx = {}
t0 = time.time()
q_w12.run(ctx); flush_metrics()
rundata.load(ctx)
q_w3.run(ctx); flush_metrics()
q_w456.run(ctx); flush_metrics()
q_w7.run(ctx); flush_metrics()
with open(OUT + 'boot_skips.csv', 'w', newline='') as f:
    w = csv.writer(f, lineterminator='\n'); w.writerow(['statistic', 'n_skipped_of_2000'])
    for r in BOOT_SKIPS: w.writerow(r)
with open(OUT + 'run_log.txt', 'w') as f: f.write('\n'.join(LOG) + '\n')
print('done in %.1f s' % (time.time() - t0))
