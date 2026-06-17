#!/usr/bin/env python3
"""
v36.1 coverage validation for the corrected-residual 90% CI (C2, plan P5 / S-F1 / S-F3 / S-F4).

Coverage identity: the band [est-q95, est-q05] covers actual iff q05 <= (est-actual) <= q95,
i.e. iff the corrected residual r is in [q05, q95]. So coverage = fraction of residuals in [q05,q95].

Three checks:
 1. OUT-OF-SAMPLE (method generalization): split multi residuals by time (80% train / 20% recent test);
    derive q05/q95 per cell on TRAIN, measure coverage on the held-out recent TEST. Target 90% +/- 4 pts.
    Two-sided miss symmetry (~5%/5%). Moving-block bootstrap CI on global coverage (autocorrelation).
 2. SHIPPED TABLE on full multi residuals (does the actually-shipped EMPIRICAL_CI_90 cover?).
 3. SHIPPED TABLE on SINGLE-pending residuals (the deployed-correction proxy — the real S-F3 question:
    does the union-widened table cover what production actually serves?).

The residuals are already PREQUENTIAL (the harness applied as-of-t corrections), so this is prequential
coverage (S-F4) by construction.
"""
import pandas as pd, numpy as np

BURN = 30
QM = 'linear'  # type-7
BINS = ['0-3000','3000-6000','6000-12000','12000-25000','25000-50000','50000+']

# The SHIPPED table (from src/model/constants.js EMPIRICAL_CI_90) — kept in sync manually.
SHIPPED = {
 '0-3000':     {'rising':(-547,369),'steady':(-271,250),'falling':(-315,336),'all':(-309,284)},
 '3000-6000':  {'rising':(-676,535),'steady':(-327,287),'falling':(-391,361),'all':(-425,356)},
 '6000-12000': {'rising':(-1650,1046),'steady':(-404,320),'falling':(-451,359),'all':(-628,506)},
 '12000-25000':{'rising':(-2384,1543),'steady':(-549,425),'falling':(-514,464),'all':(-884,741)},
 '25000-50000':{'rising':(-3851,2860),'steady':(-2013,1844),'falling':(-1068,1059),'all':(-2402,1899)},
 '50000+':     {'rising':(-7354,5519),'steady':(-5858,6410),'falling':(-4099,6429),'all':(-5858,6410)},
}

def load(path):
    df = pd.read_csv(path)
    df = df[df.binCountAtPred >= BURN].copy()
    df['predTs'] = pd.to_datetime(df['predTs'])
    return df.sort_values('predTs').reset_index(drop=True)

def cell_quant(df):
    out = {}
    for b in BINS:
        for s in ['rising','steady','falling']:
            d = df[(df.flowBin==b)&(df.flowState==s)].residual.values
            if len(d) >= 250:
                out[(b,s)] = (np.quantile(d,0.05,method=QM), np.quantile(d,0.95,method=QM), len(d))
        dall = df[df.flowBin==b].residual.values
        if len(dall) >= 250:
            out[(b,'all')] = (np.quantile(dall,0.05,method=QM), np.quantile(dall,0.95,method=QM), len(dall))
    return out

def band_for(b, s, table):
    """Resolve (q05,q95) with cell -> bin-all fallback, mirroring getGFUncertainty."""
    if isinstance(table, dict) and (b,s) in table:        # train-derived dict
        return table[(b,s)][:2]
    if isinstance(table, dict) and (b,'all') in table:
        return table[(b,'all')][:2]
    return None

def coverage(df, table_lookup):
    """table_lookup(b,s) -> (q05,q95) or None. Returns global cov, low-miss, high-miss, per-cell."""
    hits=lo=hi=tot=0
    percell={}
    for (b,s), g in df.groupby(['flowBin','flowState']):
        qq = table_lookup(b,s)
        if qq is None: continue
        q05,q95 = qq
        r = g.residual.values
        c_lo = (r < q05).mean(); c_hi = (r > q95).mean(); cov = ((r>=q05)&(r<=q95)).mean()
        percell[(b,s)] = (cov, len(r), c_lo, c_hi)
        hits += ((r>=q05)&(r<=q95)).sum(); lo += (r<q05).sum(); hi += (r>q95).sum(); tot += len(r)
    return hits/tot, lo/tot, hi/tot, percell

def block_boot_cov(df, table_lookup, L=24, B=1000, seed=12345):
    rng = np.random.default_rng(seed)
    # flatten to per-row hit (1/0) in predTs order, then moving-block bootstrap the hit series
    df = df.sort_values('predTs')
    hit=[]
    for b,s,r in zip(df.flowBin, df.flowState, df.residual):
        qq = table_lookup(b,s)
        if qq is None: hit.append(np.nan); continue
        hit.append(1.0 if qq[0]<=r<=qq[1] else 0.0)
    hit=np.array(hit); hit=hit[~np.isnan(hit)]
    n=len(hit); nb=n//L
    covs=[]
    starts_max=n-L
    for _ in range(B):
        idx=rng.integers(0,starts_max+1,size=nb)
        sample=np.concatenate([hit[i:i+L] for i in idx])
        covs.append(sample.mean())
    return np.quantile(covs,0.025), np.quantile(covs,0.975)

print("="*70)
multi = load("analysis/ci_residuals_v361_multi.csv")
single = load("analysis/ci_residuals_v361_single.csv")
print(f"multi residuals (post burn-in): {len(multi)}   single: {len(single)}")

# ---- 1. OUT-OF-SAMPLE (time split 80/20) ----
cut = multi.predTs.quantile(0.80)
train = multi[multi.predTs<=cut]; test = multi[multi.predTs>cut]
print(f"\n[1] OUT-OF-SAMPLE  train={len(train)} (<= {cut.date()})  test={len(test)} (recent held-out)")
tq = cell_quant(train)
g,lo,hi,pc = coverage(test, lambda b,s: band_for(b,s,tq))
cl,ch = block_boot_cov(test, lambda b,s: band_for(b,s,tq))
print(f"    global coverage = {g*100:.1f}%   (target 90 +/-4)  block-boot 95% CI [{cl*100:.1f}, {ch*100:.1f}]")
print(f"    two-sided miss: low={lo*100:.1f}%  high={hi*100:.1f}%  (target ~5/5)")
print(f"    {'PASS' if abs(g-0.90)<=0.04 else 'CHECK'} global; per-cell coverage (test):")
for (b,s),(cov,n,clo,chi) in sorted(pc.items()):
    flag='' if abs(cov-0.90)<=0.06 else '  <-- off'
    print(f"      {b:12s}/{s:8s} n={n:6d} cov={cov*100:5.1f}%  (lo{clo*100:4.1f}/hi{chi*100:4.1f}){flag}")

# ---- 2. SHIPPED table on full multi ----
ship_lk = lambda b,s: SHIPPED[b].get(s, SHIPPED[b]['all'])
g2,lo2,hi2,pc2 = coverage(multi, ship_lk)
print(f"\n[2] SHIPPED table on FULL MULTI residuals: global={g2*100:.1f}%  miss lo={lo2*100:.1f}/hi={hi2*100:.1f}")

# ---- 3. SHIPPED table on SINGLE (deployed-correction proxy) ----
g3,lo3,hi3,pc3 = coverage(single, ship_lk)
cl3,ch3 = block_boot_cov(single, ship_lk)
print(f"\n[3] SHIPPED table on SINGLE-pending residuals (deployed proxy): global={g3*100:.1f}%  "
      f"boot95 CI [{cl3*100:.1f},{ch3*100:.1f}]  miss lo={lo3*100:.1f}/hi={hi3*100:.1f}")
print("    high-flow cell coverage on single (the S-F3 union target):")
for b in ['25000-50000','50000+']:
    for s in ['rising','steady','falling']:
        if (b,s) in pc3:
            cov,n,clo,chi = pc3[(b,s)]
            print(f"      {b:12s}/{s:8s} n={n:5d} cov={cov*100:5.1f}%  (lo{clo*100:4.1f}/hi{chi*100:4.1f})")

print("\n" + "="*70)
print("Interpretation: [1] tests the METHOD generalizes out-of-sample; [2] sanity on multi;")
print("[3] is the deployment-relevant check — does the union-widened shipped table cover the")
print("laggier single-pending residuals production actually serves?")
