#!/usr/bin/env python3
"""Step 6: parse the saved daily report pages of the regional water-supply commission (ICPRB CO-OP) into
data/tidy/withdrawals_coop.csv, one row per report page. No network. Python 3 stdlib only.
Run: python3 -I tools/06_parse_coop_reports.py
Values are as printed (MGD for withdrawals and for the commission's flow-below-Great-Falls quantity, cfs for gauges); nothing is converted or computed.
Also writes data/tidy/withdrawals_coop_summary.json (counts of blanks and flags) and merges the saved pages into data/MANIFEST.json."""
import re, html, glob, os, csv, json, collections, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coop_common
STUDY = coop_common.STUDY; COOP = coop_common.COOP
OUT = os.path.join(STUDY, 'data', 'tidy')

WD = [  # column stem, label printed on the page (case-insensitive)
 ('fairfax_corbalis', 'Fairfax Water Corbalis withdrawal - Potomac'),
 ('wssc_potomac', 'WSSC Water Potomac withdrawal'),
 ('wash_aqueduct_great_falls', 'Washington Aqueduct withdrawal - Great Falls'),
 ('wash_aqueduct_little_falls', 'Washington Aqueduct withdrawal - Little Falls'),
 ('loudoun_withdrawal', 'Loudoun Water withdrawal'),
 ('loudoun_broad_run_discharge', 'Loudoun Water Broad Run discharge'),
 ('total_potomac_withdrawal', 'Total Potomac withdrawal'),
 ('total_net_potomac_withdrawal', 'Total net Potomac withdrawal'),
]
COLS = ['node', 'report_date', 'withdrawal_date', 'source_url', 'source_file']
for stem, _ in WD: COLS += [stem + '_mgd', stem + '_flag']
COLS += ['lf_prev_day_cfs', 'lf_prev_day_flag', 'por_prev_day_cfs', 'por_prev_day_flag',
         'coop_flow_below_gf_intake_mgd', 'coop_flow_below_gf_intake_cfs', 'coop_flow_below_gf_intake_flag', 'special_conditions_text']

def body_html(s):
    m = re.search(r'field--name-body[^>]*>(.*)', s, re.S)
    if not m: raise SystemExit('no body div')
    b = m.group(1)
    e = b.find('field--name-field-tags')       # stop at the tags block if present
    return b
def norm(t): return re.sub(r'\s+', ' ', html.unescape(t).replace('\xa0', ' ')).strip()
def to_text(b):
    b = re.sub(r'<br\s*/?>', '\n', b); b = re.sub(r'</p>', '\n\n', b); b = re.sub(r'<[^>]+>', '', b)
    return html.unescape(b).replace('\xa0', ' ')

def parse_flow(lines, label, date):
    """line 'LABEL DATE[*]: value-part'; returns (mgd, cfs, flag, found). Only the line whose date equals the withdrawal date."""
    rx = re.compile(r'^' + re.escape(label) + r' (\d{4}-\d\d-\d\d)(\*?):\s*(.*)$')
    for ln in lines:
        m = rx.match(ln)
        if not m or m.group(1) != date: continue
        marks = []
        if m.group(2): marks.append('*')
        rest = m.group(3)
        if rest.lower().startswith('not available'):
            return '', '', rest.strip(), True
        mm = re.match(r'^(\d+)\s*MGD\s*(\(estimate\))?\s*(?:\(\s*(\d+)\s*cfs\s*\))?\s*(.*)$', rest)
        if not mm: raise SystemExit('unparsed flow line: ' + ln)
        if mm.group(2): marks.append(mm.group(2))
        if mm.group(4): marks.append(mm.group(4))
        return mm.group(1), (mm.group(3) or ''), ' '.join(marks), True
    return '', '', '', False

def parse_wd(lines, label):
    rx = re.compile(r'^' + re.escape(label) + r':\s*(.*)$', re.I)
    for ln in lines:
        m = rx.match(ln)
        if not m: continue
        rest = m.group(1)
        if rest.lower().startswith('not available'): return '', rest.strip(), True
        mm = re.match(r'^(\d+)\s*MGD\s*(.*)$', rest)
        if not mm: raise SystemExit('unparsed withdrawal line: ' + ln)
        return mm.group(1), mm.group(2).strip(), True
    return '', '', False

def main():
    rows = []; stat = collections.OrderedDict(); notes = []
    blanks = collections.Counter(); flags = collections.Counter(); missing_line = collections.Counter(); na = collections.Counter()
    for fp in sorted(glob.glob(os.path.join(COOP, 'node*.html')), key=lambda p: int(re.search(r'node(\d+)', p).group(1))):
        node = re.search(r'node(\d+)\.html', fp).group(1)
        s = open(fp, encoding='utf-8').read()
        t = re.search(r'<title>(.*?)</title>', s, re.S).group(1)
        m = re.search(r'\((\w+), (\d{4}-\d\d-\d\d)\)', t)
        if not m: raise SystemExit('no report date in title of ' + fp)
        report_date = m.group(2)
        txt = to_text(body_html(s))
        lines = [norm(l) for l in txt.split('\n')]
        lines = [l for l in lines if l]
        wm = re.search(r"Yesterday.s Washington metropolitan area Potomac River withdrawals and discharges \((\d{4}-\d\d-\d\d)\)", norm(txt))
        if not wm: raise SystemExit('no withdrawal date: ' + fp)
        wdate = wm.group(1)
        r = collections.OrderedDict((c, '') for c in COLS)
        r.update(node=node, report_date=report_date, withdrawal_date=wdate, source_url='https://icprbcoop.org/node/' + node, source_file=os.path.relpath(fp, STUDY))
        for stem, label in WD:
            v, f, found = parse_wd(lines, label)
            r[stem + '_mgd'] = v; r[stem + '_flag'] = f
            if not found: missing_line[stem + '_mgd'] += 1; notes.append('node %s: line for %s not on the page' % (node, stem))
            if found and v == '': blanks[stem + '_mgd'] += 1; na[stem + '_mgd'] += 1
            if f and v != '': flags[stem + '_flag'] += 1
        for stem, label, mcol, ccol in (('lf_prev_day', 'Little Falls gage flow', None, 'lf_prev_day_cfs'), ('por_prev_day', 'Point of Rocks flow', None, 'por_prev_day_cfs'),
                                         ('coop_flow_below_gf_intake', 'Great Falls estimated flow', 'coop_flow_below_gf_intake_mgd', 'coop_flow_below_gf_intake_cfs')):
            mgd, cfs, flag, found = parse_flow(lines, label, wdate)
            r[ccol] = cfs; r[stem + '_flag'] = flag
            if mcol: r[mcol] = mgd
            if not found: missing_line[ccol] += 1; notes.append('node %s: no previous-day line for "%s"' % (node, label))
            if found and cfs == '': blanks[ccol] += 1; na[ccol] += 1 if flag.lower().startswith('not available') else 0
            if mcol and found and mgd == '': blanks[mcol] += 1
            if flag and not flag.lower().startswith('not available'): flags[stem + '_flag'] += 1
            if flag.lower().startswith('not available'): flags[stem + '_flag(not available text)'] += 1
        # special conditions: the paragraph that follows the heading
        sc = ''
        pm = re.search(r'Special Conditions:?\s*(?:</strong>)?(.*?)</p>', body_html(s), re.S)   # heading is <strong> on 49 pages, plain <p> on node 801
        if pm: sc = norm(re.sub(r'<[^>]+>', ' ', re.sub(r'<br\s*/?>', ' ', pm.group(1))))
        if pm and not sc:   # heading is a paragraph of its own (nodes 828, 829): the text is the next paragraph
            nm = re.search(r'<p[^>]*>(.*?)</p>', body_html(s)[pm.end():], re.S)
            if nm: sc = norm(re.sub(r'<[^>]+>', ' ', re.sub(r'<br\s*/?>', ' ', nm.group(1))))
        r['special_conditions_text'] = sc
        if not pm: notes.append('node %s: no Special Conditions paragraph' % node)
        rows.append(r)
    with open(os.path.join(OUT, 'withdrawals_coop.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator='\n'); w.writerow(COLS)
        for r in rows: w.writerow([r[c] for c in COLS])
    nman = coop_common.add_manifest()
    summ = {'rows': len(rows), 'columns': len(COLS), 'pages_in': len(glob.glob(os.path.join(COOP, 'node*.html'))), 'manifest_entries_added': nman,
            'blank_values_not_available_or_missing_by_column': dict(blanks), 'of_which_printed_as_not_available': dict(na),
            'lines_absent_from_page_by_column': dict(missing_line), 'nonblank_flags_by_column': dict(flags),
            'rows_with_nonblank_special_conditions_text': sum(1 for r in rows if r['special_conditions_text']),
            'special_conditions_none_or_blank': sum(1 for r in rows if r['special_conditions_text'] in ('', 'None')), 'notes': notes}
    json.dump(summ, open(os.path.join(OUT, 'withdrawals_coop_summary.json'), 'w'), indent=1)
    print(json.dumps(summ, indent=1))
main()
