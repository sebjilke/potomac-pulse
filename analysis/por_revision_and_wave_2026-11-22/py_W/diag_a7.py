import sys, os
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ppw import *
import q_w12
raw = load_table('readings_current_upstream', [('01637500', '00065')], '2026-09-01T00:00:00Z', '2026-11-22T10:00:00Z')
s = Series('x', raw[('01637500', '00065')], START, END)
dn = dn_of('2026-10-26'); ws = (dn - 1) * 86400; we = (dn + 2) * 86400
i0 = int(round((ws - s.t0) / s.step)); i1 = int(round((we - s.t0) / s.step))
pts = [((s.t(i) - ws) / 3600.0, s.vals[i]) for i in range(i0, i1) if s.vals[i] is not None]
print('grid points', i1 - i0, 'non-missing', len(pts), 'step', s.step)
X = [[0.0]*4 for _ in range(4)]; Y = [0.0]*4
for tau, x in pts:
    r = [1.0, tau - 36.0, math.cos(2*math.pi*tau/24), math.sin(2*math.pi*tau/24)]
    for i in range(4):
        Y[i] += r[i]*x
        for j in range(4): X[i][j] += r[i]*r[j]
A = [X[i][:] + [Y[i]] for i in range(4)]
for c in range(4):
    p = max(range(c, 4), key=lambda r: abs(A[r][c])); A[c], A[p] = A[p], A[c]
    for r in range(c+1, 4):
        f = A[r][c]/A[c][c]
        for k in range(c, 5): A[r][k] -= f*A[c][k]
sol = [0.0]*4
for i in range(3, -1, -1): sol[i] = (A[i][4]-sum(A[i][j]*sol[j] for j in range(i+1, 4)))/A[i][i]
a = sol[0] - 36*sol[1]; b = sol[1]; c = sol[2]; s_ = sol[3]
print('a %.12g b %.12g c %.12g s %.12g' % (a, b, c, s_))
print('A_b %.12g phi_b %.12g' % (math.hypot(c, s_), (math.atan2(s_, c)*24/(2*math.pi)) % 24))
