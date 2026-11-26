#!/usr/bin/env python3
"""Source check (TODO A3r): which forecast series does the Weather Service's river model serve,
and how far ahead do they reach?

One run = one sample. Read-only: three plain GET requests to api.water.noaa.gov, no key, no header
of our own, nothing but a river-reach id or a gauge id in the address.

Run from anywhere:   python3 -I analysis/forecast_source_check_2026-11-26/check_source.py

Each run
  - appends one line per series to source_samples.csv (created with a header on the first run),
  - saves the raw answers for our reach and for the Little Falls gauge under samples/,
    so the model's numbers can later be put beside what the river did.

Standard library only. Nothing here feeds the app.
"""
import csv
import datetime
import json
import os
import sys
import urllib.request

BASE = 'https://api.water.noaa.gov/nwps/v1'
OUR_REACH = '4512772'          # the reach the Little Falls gauge (BRKM2) sits on
CONTROL_REACH = '4710000'      # Susquehanna at Harrisburg: tells "our reach" from "the whole service"
GAUGE = 'BRKM2'
SERIES_KEYS = ['analysisAssimilation', 'shortRange', 'mediumRange', 'mediumRangeBlend', 'longRange']
HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, 'source_samples.csv')
RAW_DIR = os.path.join(HERE, 'samples')
HEADER = ['sampled_utc', 'reach', 'series', 'part', 'n_points', 'reference_time', 'first_valid',
          'last_valid', 'last_hours_ahead', 'first_flow', 'last_flow', 'units', 'note']


def fetch(url):
    """Returns (status, body text or None, error text or '')."""
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            return r.status, r.read().decode('utf-8'), ''
    except Exception as e:  # network error, timeout, HTTP error
        return None, None, str(e)[:120]


def parse_time(t):
    return datetime.datetime.fromisoformat(t.replace('Z', '+00:00'))


def rows_for(stamp, now, reach, body, err):
    if body is None:
        return [[stamp, reach, '', '', '', '', '', '', '', '', '', '', 'request failed: ' + err]]
    try:
        d = json.loads(body)
    except ValueError:
        return [[stamp, reach, '', '', '', '', '', '', '', '', '', '', 'answer is not JSON']]
    out = []
    for key in SERIES_KEYS:
        v = d.get(key)
        parts = []
        if isinstance(v, dict):
            for name, s in v.items():
                if isinstance(s, dict) and isinstance(s.get('data'), list) and s['data']:
                    parts.append((name, s))
        if not parts:
            out.append([stamp, reach, key, '', 0, '', '', '', '', '', '', '', 'empty'])
            continue
        for name, s in parts:
            pts = s['data']
            last = parse_time(pts[-1]['validTime'])
            out.append([stamp, reach, key, name, len(pts), s.get('referenceTime', ''),
                        pts[0]['validTime'], pts[-1]['validTime'],
                        '%.1f' % ((last - now).total_seconds() / 3600.0),
                        pts[0].get('flow', ''), pts[-1].get('flow', ''), s.get('units', ''), ''])
    return out


def compact_stageflow(body):
    """The gauge answer holds a month of observed readings (over 1 MB). Keep the official forecast
    as received and only the last 48 observed readings."""
    try:
        d = json.loads(body)
    except ValueError:
        return json.dumps({'note': 'answer is not JSON'})
    obs = d.get('observed') or {}
    kept = dict(obs)
    kept['data'] = (obs.get('data') or [])[-48:]
    return json.dumps({'forecast': d.get('forecast'), 'observed_last48': kept}, separators=(',', ':'))


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    fstamp = now.strftime('%Y%m%dT%H%M%SZ')
    os.makedirs(RAW_DIR, exist_ok=True)
    rows = []
    for reach in (OUR_REACH, CONTROL_REACH):
        _status, body, err = fetch('%s/reaches/%s/streamflow' % (BASE, reach))
        rows += rows_for(stamp, now, reach, body, err)
        if reach == OUR_REACH and body is not None:
            with open(os.path.join(RAW_DIR, '%s_reach%s.json' % (fstamp, reach)), 'w', encoding='utf-8') as f:
                f.write(body)
    _status, body, err = fetch('%s/gauges/%s/stageflow' % (BASE, GAUGE))
    if body is not None:
        with open(os.path.join(RAW_DIR, '%s_%s_official.json' % (fstamp, GAUGE)), 'w', encoding='utf-8') as f:
            f.write(compact_stageflow(body))
    else:
        rows.append([stamp, GAUGE, 'official', '', '', '', '', '', '', '', '', '', 'request failed: ' + err])
    new_file = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, 'a', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        if new_file:
            w.writerow(HEADER)
        w.writerows(rows)
    for r in rows:
        if r[1] == OUR_REACH:
            print('%-22s %-8s n=%-4s last %s h  %s' % (r[2], r[3], r[4], r[8] or '-', r[12]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
