"""Auditor check 5 (own code, no harness import): production text between the plan anchors vs the ported copies.
Prints every line that differs after removing only the permitted hook lines."""
import os, difflib, subprocess
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.abspath(os.path.join(P, "..", ".."))
prod = subprocess.run(["git","-C",REPO,"show","17c6060:netlify/functions/scheduled-update.js"],capture_output=True,text=True).stdout.split("\n")
cur = open(os.path.join(REPO,"netlify/functions/scheduled-update.js")).read().split("\n")
print("production scheduled-update.js identical at 17c6060 and now:", prod == cur)
def one(a):
    h=[i for i,l in enumerate(prod) if l.strip().startswith(a)]; assert len(h)==1,(a,len(h)); return h[0]
def close(i):
    for j in range(i+1,len(prod)):
        if prod[j]=="}": return j
def between(lines,a,b): return lines[lines.index(a)+1:lines.index(b)]
gs, ge = one("// Check 1: EF cross-check"), one("const binUpdate = updateCorrectionBin(binData, errorCFS, isSoftFlagged);")
block = prod[gs:ge+1]
gate = open(os.path.join(P,"rising_limb_learning_gate.mjs")).read().split("\n")
copy = between(gate,"// GATE-COPY-BEGIN","// GATE-COPY-END")
# strip permitted hooks: production claim statement (anchor to first line ending ';') and bin read (anchor to '.single();')
def strip_prod(b):
    out=[];i=0
    while i<len(b):
        t=b[i].strip()
        if t.startswith("const { data: claimed, error: claimErr } = await client.from('potomac_observations')"):
            out.append("<<CLAIM>>")
            while not b[i].strip().endswith(";"): i+=1
            i+=1; continue
        if t.startswith("const { data: existingBin, error: binReadErr } = await client"):
            out.append("<<BINREAD>>")
            while b[i].strip()!=".single();": i+=1
            i+=1; continue
        out.append(b[i]); i+=1
    return out
pc = strip_prod(block)
cc = ["<<CLAIM>>" if "GATE-HOOK[claim]" in l else "<<BINREAD>>" if "GATE-HOOK[binread]" in l else l for l in copy]
d = list(difflib.unified_diff(pc, cc, "production(gate, hooks stripped)", "port", lineterm=""))
print("gate block lines prod/port:", len(block), len(copy), "equal after hook strip:", pc==cc)
for l in d: print(l)
print("removed production hook text:")
for l in block:
    pass
# show claim/binread original statements
i=[k for k,l in enumerate(block) if "claimErr } = await client" in l][0]; j=i
while not block[j].strip().endswith(";"): j+=1
print("\n".join(block[i:j+1]))
i=[k for k,l in enumerate(block) if "binReadErr } = await client" in l][0]; j=i
while block[j].strip()!=".single();": j+=1
print("\n".join(block[i:j+1]))
print("port hook lines:", [l.strip() for l in copy if "GATE-HOOK" in l])
# preamble: last 'const actualCFS = lf.q;' before gate start, inside validatePendingPredictions
vf = one("async function validatePendingPredictions(")
ps = max(k for k in range(vf,gs) if prod[k].strip().startswith("const actualCFS = lf.q;"))
pre = between(gate,"// PREAMBLE-COPY-BEGIN","// PREAMBLE-COPY-END")
print("preamble equal:", pre == prod[ps:gs], len(pre))
# model / por blocks
ms = one("function makeGFPrediction("); me = close(ms)
pos = one("function getPoRFromHistory(history, hoursAgo) {"); poe = close(pos)
var = open(os.path.join(P,"rising_limb_model_variants.mjs")).read().split("\n")
mc = between(var,"// MODEL-COPY-BEGIN","// MODEL-COPY-END"); pcpy = between(var,"// POR-COPY-BEGIN","// POR-COPY-END")
print("POR block equal:", pcpy == prod[pos:poe+1])
H = ["let mult = getFlowMultiplier(lf.q);","const historicMult = getFlowMultiplier(historicPoR.cfs);","porEstimateCFS = Math.round(porEstimateCFS * appliedRatio);"]
pm = [l for l in prod[ms:me+1] if not any(l.strip().startswith(h) for h in H)]
mcs = [l for l in mc if "VARIANT-HOOK" not in l]
print("MODEL block equal after hook strip:", pm == mcs, "lines", me-ms+1)
for l in difflib.unified_diff(pm, mcs, lineterm=""): print(l)
print("variant hook lines:"); [print("  ", l.strip()) for l in mc if "VARIANT-HOOK" in l]
print("model start line (1-based):", ms+1, "end", me+1, "gate", gs+1, ge+1)
