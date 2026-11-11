"""Auditor check 2: join Python and R metric tables on run,criterion,arm,subset,stat,key; report unmatched rows and diffs."""
import os, sys, pandas as pd, numpy as np
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); D = os.path.dirname(os.path.abspath(__file__))
K = ["run","criterion","arm","subset","stat","key"]
py = pd.read_csv(os.path.join(P,"metrics_python/rising_limb_metrics_python.csv"), keep_default_na=False, dtype=str)
r  = pd.read_csv(os.path.join(P,"metrics_R/rising_limb_metrics_R.csv"), keep_default_na=False, dtype=str)
for d in (py, r): assert not d.duplicated(K).any()
m = py.merge(r, on=K, how="outer", suffixes=("_py","_r"), indicator=True)
print("rows python", len(py), "R", len(r), "joined both", (m._merge=="both").sum())
print("only in python:"); print(m[m._merge=="left_only"][K+["value_py"]].to_string())
print("only in R:"); print(m[m._merge=="right_only"][K+["value_r"]].to_string())
b = m[m._merge=="both"].copy()
def num(x):
    try: return float(x)
    except: return np.nan
b["vp"] = b.value_py.map(num); b["vr"] = b.value_r.map(num)
txt = b[b.vp.isna() | b.vr.isna()]
txt_bad = txt[txt.value_py != txt.value_r]
print("non-numeric rows:", len(txt), "differing:", len(txt_bad)); print(txt_bad[K+["value_py","value_r"]].to_string())
n = b[~(b.vp.isna() | b.vr.isna())].copy()
n["ad"] = (n.vp - n.vr).abs(); n["rd"] = n.ad / n[["vp","vr"]].abs().max(axis=1).replace(0, np.nan)
COUNT = n.stat.str.startswith("n_") | n.stat.isin(["improved","pass","ok","all_pass","n_failed","label_mismatches","truth_mismatches","truth_mismatches_after_override"])
n["is_count"] = COUNT
# E3 exemption: calendar-month block bootstrap for normal hours (report-only); identify by stat name containing 'block' or 'month'
n["exempt"] = n.stat.str.contains("block|month", case=False) | n.subset.str.contains("block|month", case=False)
bad_cnt = n[n.is_count & (n.ad != 0)]
bad_num = n[~n.is_count & ~n.exempt & (n.ad > 0.01)]
print("count/id rows not exactly equal:", len(bad_cnt)); print(bad_cnt[K+["value_py","value_r"]].to_string())
print("numeric rows beyond 0.01:", len(bad_num)); print(bad_num[K+["value_py","value_r","ad"]].to_string())
s = n[~n.exempt].groupby(["run","criterion"]).agg(rows=("ad","size"), max_abs=("ad","max"), max_rel=("rd","max")).reset_index()
pd.set_option("display.width",200)
print(s.to_string())
s.to_csv(os.path.join(D,"a2_agreement_by_criterion.csv"), index=False)
print("exempt rows:", n.exempt.sum())
