"""Shared by 06_parse_coop_reports.py and 03_build_tidy.py: adds the saved commission report pages to data/MANIFEST.json."""
import os, json, hashlib, glob
STUDY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COOP = os.path.join(STUDY, 'research', 'data', 'coop')
README = 'research/data/README.md'

def sha(p):
    h = hashlib.sha256(open(p, 'rb').read()); return h.hexdigest()

def add_manifest():
    mp = os.path.join(STUDY, 'data', 'MANIFEST.json')
    m = json.load(open(mp))
    paths = [p for p in sorted(glob.glob(os.path.join(COOP, 'node*.html')) + glob.glob(os.path.join(COOP, 'list_p*.html')))]
    keep = [e for e in m['files'] if not e['path'].startswith('research/data/coop/')]
    new = []
    for p in paths:
        b = os.path.basename(p); rel = os.path.relpath(p, STUDY)
        if b.startswith('node'):
            origin = 'https://icprbcoop.org/node/' + b[4:-5]; t = '2026-11-22, between 10:58 and 11:00 UTC (range recorded in %s; per-file time not recorded)' % README
        else:
            origin = 'https://icprbcoop.org/products/monitoring-reports?page=' + b[6:-5]; t = '2026-11-22, between 10:56 and 10:58 UTC (range recorded in %s; per-file time not recorded)' % README
        new.append({'path': rel, 'bytes': os.path.getsize(p), 'sha256': sha(p), 'origin': origin, 'obtained_utc': t})
    m['files'] = sorted(keep + new, key=lambda e: e['path'])
    m['coop_pages_added_by'] = 'tools/coop_common.py (called by 06_parse_coop_reports.py and 03_build_tidy.py): %d saved pages (50 reports + listing pages), research/data/coop/' % len(new)
    json.dump(m, open(mp, 'w'), indent=1)
    return len(new)
