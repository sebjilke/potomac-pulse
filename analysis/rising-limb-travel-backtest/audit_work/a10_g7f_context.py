"""Auditor, report-only context for the binding criterion G7f (decides nothing): where does the displayed-error loss come from?
Primary tick file, GATE kept RL ticks, rules 1-2 and D-8. Splits ticks by cap state of base and arm; per-event G7f; leave-one-out range."""
import os, numpy as np, pandas as pd
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(D)
ev = pd.read_csv(os.path.join(P,"rising_limb_events_python_v39.csv"), dtype=str, keep_default_na=False)
ids = [int(x) for x in ev[(ev.event_row=="1")&(ev.event_class=="GATE")&(ev.kept=="1")].event_id]
t = pd.read_csv(os.path.join(P,"rising_limb_ticks.csv"), usecols=["tick_utc","arm","in_scoring","mask","unc","disp","truth","ceiling_applied","rl_event"], dtype={"rl_event":"Int64"})
t = t[(t.in_scoring==1)&(t["mask"]==1)&t.rl_event.isin(ids)&(t.tick_utc!="2026-11-09T12:00:00.000Z")]
W = {a: t[t.arm==a].set_index("tick_utc") for a in ["base","A","B","C"]}
b = W["base"]
for a in "ABC":
    x = W[a]
    ea, eb = (x.disp-x.truth).abs(), (b.disp-b.truth).abs()
    print(f"arm {a}: G7f={1-ea.sum()/eb.sum():+.4f}  e_unc gain={1-(x.unc-x.truth).abs().sum()/(b.unc-b.truth).abs().sum():+.4f}")
    for cb in (0,1):
        for ca in (0,1):
            s = (b.ceiling_applied==cb)&(x.ceiling_applied==ca)
            print(f"   base_cap={cb} arm_cap={ca}: ticks={s.sum():4d}  sum|e_disp| arm-base = {ea[s].sum()-eb[s].sum():+12.0f}  mean signed e_disp base={(b.disp-b.truth)[s].mean():+8.0f} arm={(x.disp-x.truth)[s].mean():+8.0f}")
    pe = pd.DataFrame({"a": ea.groupby(x.rl_event).sum(), "b": eb.groupby(x.rl_event).sum()})
    pe["g"] = 1 - pe.a/pe.b
    loo = [1 - (pe.a.sum()-pe.a[e])/(pe.b.sum()-pe.b[e]) for e in pe.index]
    print(f"   events with arm displayed error lower: {(pe.a<pe.b).sum()}/{len(pe)};  leave-one-event-out G7f range [{min(loo):+.4f}, {max(loo):+.4f}]")
