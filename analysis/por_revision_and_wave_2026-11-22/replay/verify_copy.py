#!/usr/bin/env python3
"""Mechanical check that lib/post_iteration_copy.cjs equals production lines 999-1082 of makeGFPrediction (v39.11)
minus trace/console/flowState lines, line by line, and that the three versions have the same body.
Run: python3 -I verify_copy.py   (exit code 0 = identical)"""
import re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
def body(path, a, b):
    L = open(path).read().split('\n'); return [(i + 1, L[i]) for i in range(a - 1, b)]
def norm_prod(rows):
    out = []; skip = False
    for n, raw in rows:
        st = re.sub(r'\s*//.*$', '', raw).strip()
        if not st: continue
        if st.startswith('console.log'):
            skip = not st.endswith(');'); continue
        if skip:
            if st.endswith(');'): skip = False
            continue
        if 'getFlowState' in st or 'timeShiftedHoursAgo' in st or 'trace' in st: continue
        out.append((n, st))
    return out
v11 = norm_prod(body(os.path.join(HERE, 'code/v39.11/netlify/functions/scheduled-update.js'), 999, 1082))
v6 = norm_prod(body(os.path.join(HERE, 'code/v39.6/netlify/functions/scheduled-update.js'), 867, 950))
v2 = norm_prod(body(os.path.join(HERE, 'code/v39.2/netlify/functions/scheduled-update.js'), 854, 937))
ok = True
for name, v in (('v39.6', v6), ('v39.2', v2)):
    if [s for _, s in v] != [s for _, s in v11]:
        print('BODY DIFFERS', name); ok = False
cp = []
for l in open(os.path.join(HERE, 'lib/post_iteration_copy.cjs')).read().split('\n'):
    m = re.search(r'//\s*(\d+)\s*$', l)
    st = re.sub(r'\s*//.*$', '', l).strip()
    if m and st: cp.append((int(m.group(1)), st))
if [(n, s) for n, s in v11] != cp:
    ok = False
    for a, b in zip(v11, cp):
        if a != b: print('MISMATCH production', a, 'copy', b); break
    print('lengths', len(v11), len(cp))
print('IDENTICAL' if ok else 'DIFFERENT'); sys.exit(0 if ok else 1)
