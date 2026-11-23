#!/usr/bin/env python3
"""Step 1: freeze local evidence (Supabase exports, old-service archive, October pull).
Python 3 stdlib only. Run: python3 -I tools/01_freeze_local.py
Never overwrites an existing frozen file whose content differs: it stops instead."""
import json, re, os, sys, hashlib, tarfile, io, gzip, shutil

STUDY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(STUDY, 'data', 'raw')
SB_DIR = '/Users/sebjilke/.claude/projects/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/tool-results'
EXPORTS = {
 'tick_log.json': ('mcp-claude_ai_Supabase-execute_sql-1795344705680-efw1x0.txt', 305,
   "select id, created_at, observation_type, gauge_id, data from potomac_observations where observation_type = 'tick_log' and created_at < '2026-11-22 10:30:00+00' order by created_at, id;"),
 'validation_log.json': ('mcp-claude_ai_Supabase-execute_sql-1795344710164-jg0vdu.txt', 20,
   "select id, created_at, observation_type, gauge_id, data from potomac_observations where observation_type = 'validation_log' and created_at < '2026-11-22 10:30:00+00' order by created_at, id;"),
 'state_rows.json': ('mcp-claude_ai_Supabase-execute_sql-1795344714793-arl5qf.txt', 97,
   "select id, created_at, observation_type, gauge_id, data from potomac_observations where observation_type in ('bin_snapshot','gf_correction_bin','gf_metadata','gf_prediction','validation_failure') and created_at < '2026-11-22 10:30:00+00' order by observation_type, created_at, id;"),
}
ARCH = '/Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/raw'
OCT = '/Users/sebjilke/Desktop/PotomacPulse/analysis/pulse-audit-2026-10/audit_inputs.tar.gz'
OCT_MEMBER = 'data/usgs_iv_2026-10-05_2026-10-22.json'

def sha(b): return hashlib.sha256(b).hexdigest()
log = []
def say(s): print(s); log.append(s)

def write_if_new(path, data: bytes):
    if os.path.exists(path):
        if open(path,'rb').read() != data:
            sys.exit('STOP: %s exists with different content' % path)
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path,'wb').write(data); return True

# (a) Supabase
os.makedirs(os.path.join(RAW,'supabase'), exist_ok=True)
for out,(src,expect,sql) in EXPORTS.items():
    if not os.path.exists(os.path.join(SB_DIR, src)) and os.path.exists(os.path.join(RAW, 'supabase', out)):
        say('supabase %s: session source file gone, frozen copy kept as is (not rebuilt)' % out); continue
    r = json.load(open(os.path.join(SB_DIR, src)))['result']
    # the result text mentions the tag in a warning sentence first; the data is wrapped by the LAST open tag
    tag = re.search(r'<(untrusted-data-[0-9a-f-]+)>', r).group(1)
    first = r.index('<%s>' % tag)
    a = r.index('<%s>' % tag, first + 5); a = r.index('>', a) + 1
    b = r.rindex('</%s>' % tag)
    rows = json.loads(r[a:b])
    assert len(rows) == expect, (out, len(rows), expect)
    assert all(set(x) == {'id','created_at','observation_type','gauge_id','data'} for x in rows)
    data = (json.dumps(rows, indent=1, ensure_ascii=False) + '\n').encode()
    write_if_new(os.path.join(RAW,'supabase',out), data)
    say('supabase %s: %d rows, sha256 %s' % (out, len(rows), sha(data)))
q = ['# Supabase exports (read-only SELECTs)', '',
     'Exported by the orchestrator on 2026-11-22 at about 10:51 UTC. Project database table `potomac_observations`.', '',
     'Frozen by tools/01_freeze_local.py from the session tool-result files named below (copy made 2026-11-22).', '']
for out,(src,expect,sql) in EXPORTS.items():
    q += ['## %s (%d rows)' % (out, expect), '', 'Source file: `%s/%s`' % (SB_DIR, src), '', '```sql', sql, '```', '']
write_if_new(os.path.join(RAW,'supabase','QUERIES.md'), '\n'.join(q).encode())

# (b) archive
man = json.load(open(os.path.join(ARCH,'FETCH_MANIFEST.json')))['files']
files = sorted(f for f in os.listdir(ARCH) if f != 'FETCH_MANIFEST.json')
say('archive: %d data files on disk, %d in manifest' % (len(files), len(man)))
assert set(files) == set(man), (set(files) ^ set(man))
bad = []
for f in files:
    b = open(os.path.join(ARCH,f),'rb').read()
    if sha(b) != man[f]['sha256'] or len(b) != man[f]['bytes']: bad.append(f)
if bad: sys.exit('STOP: archive hash mismatch: %s' % bad)
say('archive: all %d files match FETCH_MANIFEST sha256 and bytes' % len(files))
tgz = os.path.join(RAW,'archive_old_2026-11-10.tar.gz')
if not os.path.exists(tgz):
    # deterministic: sorted members, fixed mtime/uid, gzip mtime 0
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', mtime=0, compresslevel=9) as gz:
        with tarfile.open(fileobj=gz, mode='w') as t:
            for f in files + ['FETCH_MANIFEST.json']:
                ti = tarfile.TarInfo('archive_old/' + f)
                b = open(os.path.join(ARCH,f),'rb').read()
                ti.size = len(b); ti.mtime = 0; ti.mode = 0o644
                t.addfile(ti, io.BytesIO(b))
    open(tgz,'wb').write(buf.getvalue())
say('archive tar.gz: %d bytes sha256 %s' % (os.path.getsize(tgz), sha(open(tgz,'rb').read())))
wd = os.path.join(RAW,'archive_old'); os.makedirs(wd, exist_ok=True)
with tarfile.open(tgz) as t:
    for m in t.getmembers():
        assert m.name.startswith('archive_old/') and '..' not in m.name
        name = m.name.split('/',1)[1]
        data = t.extractfile(m).read()
        write_if_new(os.path.join(wd,name), data)
# verify the extracted copy against the manifest again
for f in files:
    assert sha(open(os.path.join(wd,f),'rb').read()) == man[f]['sha256']
say('archive working copy extracted and re-verified: %d files' % len(files))

# (c) October pull
od = os.path.join(RAW,'oct_pull'); os.makedirs(od, exist_ok=True)
with tarfile.open(OCT) as t:
    m = t.getmember(OCT_MEMBER)
    data = t.extractfile(m).read()
dst = os.path.join(od, os.path.basename(OCT_MEMBER))
write_if_new(dst, data)
say('oct pull: %s %d bytes sha256 %s (source tar sha256 %s)' % (os.path.basename(OCT_MEMBER), len(data), sha(data), sha(open(OCT,'rb').read())))
open(os.path.join(od,'ORIGIN.txt'),'w').write('member %s of %s (tar sha256 %s)\nOld-service shape, pulled about 2026-11-09.\n' % (OCT_MEMBER, OCT, sha(open(OCT,'rb').read())))
