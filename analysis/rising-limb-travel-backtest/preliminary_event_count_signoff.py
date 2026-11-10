# Independent implementation of plan section 3 FINAL rule. LF-only detection; no model, no errors.
import csv, sys, math
from datetime import datetime, timedelta
PATH=sys.argv[1]
LF={};P={};W={}
with open(PATH) as f:
    for r in csv.DictReader(f):
        t=datetime.strptime(r['timestamp'],'%Y-%m-%d %H:%M')
        LF[t]=float(r['lf_discharge']) if r['lf_discharge'] else None
        P[t]=float(r['por_now']) if r['por_now'] else None
        W[t]=float(r['water_temp_c']) if r['water_temp_c'] else None
g0,g1=min(LF),max(LF); n=int((g1-g0).total_seconds()//3600)+1
T=[g0+timedelta(hours=i) for i in range(n)]
raw=[LF.get(t) for t in T]; por=[P.get(t) for t in T]; wt=[W.get(t) for t in T]
lf=raw[:]; i=0
while i<n:
    if lf[i] is None:
        j=i
        while j<n and lf[j] is None: j+=1
        if i>0 and j<n and (j-i)<=3:
            for k in range(i,j): lf[k]=lf[i-1]+(lf[j]-lf[i-1])*(k-i+1)/(j-i+1)
        i=j
    else: i+=1
PRIOR_INCL_T0M1 = True
onsets=[]
for i in range(1,n):
    if lf[i] is not None and lf[i]>=6000 and lf[i-1] is not None and lf[i-1]<6000:
        win=[x for x in lf[max(0,i-48):i] if x is not None]   # [t0-48h, t0-1h]
        if win and min(win)<=4500: onsets.append(i)
evs=[]
for i in onsets:
    j=None
    for k in range(i+1,min(n,i+30*24+1)):
        if lf[k] is not None and lf[k]<=6000: j=k;break
    E=j if j is not None else i+30*24
    hi=min(E,i+240)
    seg=[(lf[k],-k) for k in range(i,min(hi,n)) if lf[k] is not None]
    pv,tpn=max(seg); tp=-tpn
    tend=min(E,tp+240)
    cls='GATE' if pv>=12000 else ('STRATUM' if pv>=8000 else None)
    evs.append(dict(t0=i,tp=tp,tend=tend,E=E,pk=pv,cls=cls,Enone=j is None))
print('onsets (all classes incl <8k):',len(evs))
from collections import Counter
print('pre-merge class:',Counter(e['cls'] for e in evs))
q=[e for e in evs if e['cls']]
merged=[];nm=0
for e in q:
    if merged and 0<= e['t0']-merged[-1]['tend']<=48:
        m=merged[-1]; nm+=1
        span=range(m['t0'],e['tend']+1)  # one reading of 'union'
        comps=m.setdefault('comps',[(m['t0'],m['tp'],m['tend'],m['cls'])])
        comps.append((e['t0'],e['tp'],e['tend'],e['cls']))
        if e['pk']>m['pk']: m['tp'],m['pk']=e['tp'],e['pk']
        m['tend']=max(m['tend'],e['tend'])
        if 'GATE' in (m['cls'],e['cls']): m['cls']='GATE'
    else: merged.append(dict(e))
print('merges performed:',nm,' after merge:',len(merged),Counter(e['cls'] for e in merged))
for m in merged:
    if 'comps' in m: print('  merged:',T[m['t0']],[ (str(T[c[0]]),c[3]) for c in m['comps']], 'tp',T[m['tp']])
def x1(e):
    for k in range(max(0,e['t0']-24),min(n,e['tend']+1)):
        if T[k].month in (12,1,2,3) and (wt[k] is None or wt[k]<=5): return True
    return False
def x2(e,mode):
    a,b=e['t0']-12,e['tend']; miss=0;run=0;worst=0;tot=0
    for k in range(a,b+1):
        tot+=1
        if k<0 or k>=n: m=True
        else:
            L=lf[k] if mode=='filled' else raw[k]
            m=(L is None) or (por[k] is None)
        miss+=m; run=run+1 if m else 0; worst=max(worst,run)
    return worst>=6 or miss>0.10*tot
def x2sep(e):
    a,b=e['t0']-12,e['tend']
    for arr in (raw,por):
        miss=0;run=0;worst=0;tot=0
        for k in range(a,b+1):
            tot+=1; m = k<0 or k>=n or arr[k] is None
            miss+=m; run=run+1 if m else 0; worst=max(worst,run)
        if worst>=6 or miss>0.10*tot: return True
    return False
def x4(e): return e['tend']>n-1
BI=datetime(2012,12,1)
for cls in ('GATE','STRATUM'):
    L=[e for e in merged if e['cls']==cls]
    pre=[e for e in L if T[e['t0']]-timedelta(hours=12)<BI]
    print(f'\n{cls}: merged {len(L)}; with RL start before burn-in 2012-12-01: {len(pre)}')
    for mode in ('raw','filled','sep'):
        keep=[];c=Counter()
        for e in L:
            f=[]
            if T[e['t0']]-timedelta(hours=12)<BI: f.append('BI')
            if x1(e): f.append('X1')
            if (x2sep(e) if mode=='sep' else x2(e,mode)): f.append('X2')
            if x4(e): f.append('X4')
            for z in f: c[z]+=1
            if not f: keep.append(e)
        print(f'  X2 mode={mode}: flags {dict(c)} kept {len(keep)}')
        if mode=='raw' and cls=='GATE':
            for e in keep:
                rl_end=min(e['t0']+24,e['tp']); 
                print('   ',T[e['t0']],'tp',T[e['tp']],'tend',T[e['tend']],'pk',int(e['pk']),'tp-t0',e['tp']-e['t0'],'RLticks',rl_end-(e['t0']-12)+1,'LFled' if (por[e['t0']] or 0)<0.5*lf[e['t0']] else '', 'E_capped30d' if e['Enone'] else '', 'tend<E' if e['tend']<e['E'] else '')
            N=len(keep); import math
            print('   N_nonOct',N,'holdout size',math.ceil(0.2*N))
# sequential checks
L=[e for e in merged]
ov=0
for a,b in zip(L,L[1:]):
    if b['t0']-12 <= a['tend']+24: ov+=1
print('\nconsecutive merged events whose EW/RL windows overlap (next t0-12 <= prev tend+24):',ov)
ov2=sum(1 for a,b in zip(L,L[1:]) if b['t0']-12<=a['tend'])
print('next RL start inside previous [.,tend]:',ov2)
# events whose prior-onset crossing exists but prior min uses filled values
print('events where tp==t0 (RL ends at t0):',sum(1 for e in merged if e['tp']==e['t0']))
print('GATE with tp < t0+24:',sum(1 for e in merged if e['cls']=='GATE' and e['tp']<e['t0']+24))
print('\nBI GATE events other flags:')
for e in merged:
    if e['cls']=='GATE' and T[e['t0']]-timedelta(hours=12)<BI:
        print(' ',T[e['t0']],'X1',x1(e),'X2',x2(e,'raw'),'pk',e['pk'],'tp',T[e['tp']])
# lookback sensitivity
for lb in (47,49):
    c=0
    for i in range(1,n):
        if lf[i] is not None and lf[i]>=6000 and lf[i-1] is not None and lf[i-1]<6000:
            win=[x for x in lf[max(0,i-lb):i] if x is not None]
            if win and min(win)<=4500: c+=1
    print('lookback',lb,'onsets',c)
# onsets where 48h window has missing values
c=0
for i in onsets:
    if any(lf[k] is None for k in range(max(0,i-48),i)): c+=1
print('onsets with missing filled LF in prior 48h:',c)
# events where tp is at 240h edge
print('GATE kept with tp at t0+239 edge or E none:',[str(T[e['t0']]) for e in merged if e['cls']=='GATE' and (e['tp']-e['t0']>=230)])
# whether LF still rising after tp for edge events
for e in merged:
    if e['cls']=='GATE' and e['tp']-e['t0']>=230:
        nxt=[lf[k] for k in range(e['tp'],min(n,e['tp']+48)) if lf[k] is not None]
        print('  after tp max over next 48h:',max(nxt),'vs pk',e['pk'])
print('\nREC contamination among kept GATE (raw X2):')
for e in merged:
    if e['cls']!='GATE' or T[e['t0']]-timedelta(hours=12)<BI or x1(e) or x2(e,'raw') or x4(e): continue
    rec=[(k,lf[k]) for k in range(e['tp']+1,e['tend']+1) if lf[k] is not None]
    above=[k for k,v in rec if v>e['pk']]
    # rising ticks in REC: lf(k)-lf(k-6) >= max(100, 2% lf)
    rising=sum(1 for k,v in rec if k-6>=0 and lf[k-6] is not None and v-lf[k-6]>=max(100,0.02*v))
    print(' ',T[e['t0']].date(),'REC ticks',len(rec),'ticks above LF(tp)',len(above),'LF-rising(6h) ticks',rising, 'maxREC',int(max(v for k,v in rec)))
