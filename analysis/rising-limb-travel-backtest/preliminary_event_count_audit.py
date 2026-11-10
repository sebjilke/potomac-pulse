import csv, sys, math
from datetime import datetime, timedelta
from collections import Counter

PATH = sys.argv[1]
rows = {}
temp = {}
por = {}
with open(PATH) as f:
    for r in csv.DictReader(f):
        t = datetime.strptime(r['timestamp'], '%Y-%m-%d %H:%M')
        rows[t] = float(r['lf_discharge']) if r['lf_discharge'] else None
        temp[t] = float(r['water_temp_c']) if r['water_temp_c'] else None
        por[t] = float(r['por_now']) if r['por_now'] else None
t0g, t1g = min(rows), max(rows)
n = int((t1g - t0g).total_seconds() // 3600) + 1
T = [t0g + timedelta(hours=i) for i in range(n)]
raw = [rows.get(t) for t in T]
P = [por.get(t) for t in T]
W = [temp.get(t) for t in T]
# fill gaps <=3h linearly
lf = raw[:]
i = 0
while i < n:
    if lf[i] is None:
        j = i
        while j < n and lf[j] is None: j += 1
        if i > 0 and j < n and (j - i) <= 3:
            for k in range(i, j):
                lf[k] = lf[i-1] + (lf[j] - lf[i-1]) * (k - i + 1) / (j - i + 1)
        i = j
    else:
        i += 1

def detect(on=6000, lo=4500, pk=12000, look=48, cap=240, endthr=None):
    endthr = endthr if endthr else on
    ev = []
    i = 1
    while i < n:
        if lf[i] is not None and lf[i] >= on and lf[i-1] is not None and lf[i-1] < on:
            prev = [x for x in lf[max(0, i-look):i] if x is not None]
            if prev and min(prev) <= lo:
                # tend: first stamp after t0 with LF<=endthr ; tp argmax in [t0,tend]; cap
                j = i + 1
                while j < n and not (lf[j] is not None and lf[j] <= endthr): j += 1
                seg = [(lf[k], k) for k in range(i, min(j, n)) if lf[k] is not None]
                pv, tp = max(seg)
                tend = min(j, tp + cap)
                ev.append([i, tp, tend, pv])
                i = j
                continue
        i += 1
    # merge
    merged = []
    for e in ev:
        if merged and e[0] - merged[-1][2] <= 48:
            m = merged[-1]
            if e[3] > m[3]: m[1], m[3] = e[1], e[3]
            m[2] = e[2]
        else:
            merged.append(e)
    return [e for e in merged if e[3] >= pk], merged

def x1(e):
    a, b = e[0]-24, e[2]
    for k in range(max(0,a), min(n,b+1)):
        if T[k].month in (12,1,2,3) and (W[k] is None or W[k] <= 5): return True
    return False
def x2(e):
    a, b = e[0]-12, e[2]
    miss = 0; run = 0; worst = 0
    for k in range(max(0,a), min(n,b+1)):
        m = raw[k] is None or P[k] is None
        miss += m; run = run+1 if m else 0; worst = max(worst, run)
    return worst >= 6 or miss > 0.10*(b-a+1)
def x4(e): return e[2] >= n-1

import json
base, allr = detect()
print('all onsets (any peak):', len(allr), ' peak>=12k:', len(base))
yr = Counter(T[e[0]].year for e in base)
print('per year:', dict(sorted(yr.items())))
fl = {'X1':0,'X2':0,'X4':0}
keep=[]
for e in base:
    f=[]
    if x1(e): f.append('X1')
    if x2(e): f.append('X2')
    if x4(e): f.append('X4')
    for z in f: fl[z]+=1
    if not f: keep.append(e)
    rl_end = min(e[0]+24, e[1])
    porlead = (P[e[0]] or 0) < 0.5*lf[e[0]]
    print(T[e[0]].strftime('%Y-%m-%d %H'), 'tp', T[e[1]].strftime('%m-%d %H'), 'pk', int(e[3]), 'RLticks', rl_end-(e[0]-12)+1, 'tp-t0 h', e[1]-e[0], 'LFled' if porlead else '', ','.join(f))
print('excl counts (overlapping):', fl, ' kept:', len(keep))
keep_noX1 = [e for e in base if not x2(e) and not x4(e)]
print('kept if X1 dropped:', len(keep_noX1))
# X1 alternative: only months 12-2, or temp-known rule
def x1b(e):
    a, b = e[0]-24, e[2]
    for k in range(max(0,a), min(n,b+1)):
        if T[k].month in (12,1,2) and (W[k] is None or W[k] <= 5): return True
    return False
print('kept with X1 restricted to Dec-Feb:', len([e for e in base if not x1b(e) and not x2(e) and not x4(e)]))
print('rise duration t0->tp hours: ', sorted(e[1]-e[0] for e in keep))
# sensitivity
for on,lo,pk in [(6000,4500,10000),(6000,4500,15000),(6000,4500,8000),(6000,5000,12000),(6000,4000,12000),(5000,4000,10000),(6000,4500,25000),(6000,4500,6000),(8000,6000,12000)]:
    b,_=detect(on,lo,pk)
    k=[e for e in b if not x1(e) and not x2(e) and not x4(e)]
    print(f'on={on} lo={lo} pk={pk}: events={len(b)} kept={len(k)}')

print('--- burn-in adjusted (t0 >= 2012-12-01) and tp restricted to t0+240h')
from datetime import datetime as D
bi = D(2012,12,1)
def detect2(on=6000, lo=4500, pk=12000, look=48, cap=240):
    ev=[]; i=1
    while i<n:
        if lf[i] is not None and lf[i]>=on and lf[i-1] is not None and lf[i-1]<on:
            prev=[x for x in lf[max(0,i-look):i] if x is not None]
            if prev and min(prev)<=lo:
                j=i+1
                while j<n and not (lf[j] is not None and lf[j]<=on): j+=1
                seg=[(lf[k],-k) for k in range(i,min(j,n,i+cap)) if lf[k] is not None]
                pv,tpn=max(seg); tp=-tpn
                ev.append([i,tp,min(j,tp+cap),pv]); i=j; continue
        i+=1
    return [e for e in ev if e[3]>=pk]
for pk in (6000,8000,10000,12000,15000):
    b=[e for e in detect2(pk=pk) if T[e[0]]>=bi]
    k=[e for e in b if not x1(e) and not x2(e) and not x4(e)]
    rl=sum(min(e[0]+24,e[1])-(e[0]-12)+1 for e in k)
    print(f'pk>={pk}: detected(post burn-in)={len(b)} kept={len(k)} RLticks~{rl} keptX1only-dropped={len([e for e in b if not x2(e) and not x4(e)])}')
k12=[e for e in detect2() if T[e[0]]>=bi and not x1(e) and not x2(e) and not x4(e)]
print('kept 12k list:', [T[e[0]].strftime('%Y-%m-%d') for e in k12])
print('LF-led among kept:', sum((P[e[0]] or 0) < 0.5*lf[e[0]] for e in k12))
