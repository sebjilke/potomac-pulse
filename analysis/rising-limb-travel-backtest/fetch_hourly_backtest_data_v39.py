#!/usr/bin/env python3
"""
Build hourly_backtest_data_v39.csv for the rising-limb travel backtest (plan A7, section 2).

  v39 CSV = v38 rows verbatim (frozen, win) + rows for 2026-07-21 00:00 .. 2026-11-09 23:00 UTC
  fetched from USGS IV (read-only GETs).

Construction is identical to fetch_hourly_backtest_data_v38.py: same 9 series, UTC-truncated hourly
MEDIAN of all readings in [T, T+1h), union row driver (a row exists only if PoR>0 or LF>0 at that
hour), blank cells for missing series, por_lagged / travel_time_h columns built as in v38.
The standard-library-only fetch differs from v38 only in transport (urllib instead of requests) and
in using explicit UTC startDT/endDT (v38 passed bare dates).

Overlap check: the fetch window starts 2026-06-14 (same as v38's), so every v38 row from 2026-06-14
on is re-fetched and diffed against the v38 file (all 12 columns); v38 rows are never replaced.

Raw responses are cached under raw/ (one site+parameter, <=30-day chunk per file). Reruns use the
cache; the fetch date is stored in raw/FETCH_MANIFEST.json the first time a file is fetched.
Outputs are deterministic given the cache (no wall-clock time in outputs).

Run:  python3 fetch_hourly_backtest_data_v39.py
"""
import csv
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
ANALYSIS = os.path.dirname(HERE)
V38_PATH = os.path.join(ANALYSIS, "hourly_backtest_data_v38.csv")
RAW_DIR = os.path.join(HERE, "raw")
MANIFEST = os.path.join(RAW_DIR, "FETCH_MANIFEST.json")
OUT_PATH = os.path.join(HERE, "hourly_backtest_data_v39.csv")
PROV_PATH = os.path.join(HERE, "hourly_backtest_data_v39.PROVENANCE.txt")
DATA_MANIFEST = os.path.join(HERE, "hourly_backtest_data_v39.MANIFEST.json")

FETCH_START = datetime(2026, 6, 12, tzinfo=timezone.utc)      # 2 days of lead-in so por_lagged (48 h look-back) is valid at 06-14
OVERLAP_START = "2026-06-14 00:00"                            # overlap diff starts here (as v38 fetch)
FETCH_END = datetime(2026, 11, 10, tzinfo=timezone.utc)       # exclusive
APPEND_START = datetime(2026, 7, 21, 0, tzinfo=timezone.utc)  # plan section 2
APPEND_LAST = datetime(2026, 11, 9, 23, tzinfo=timezone.utc)  # plan section 2
CHUNK_DAYS = 30
PAUSE_S = 1.0

IV_URL = "https://waterservices.usgs.gov/nwis/iv/"
FETCHES = [
    ("01638500", "00060", "por_discharge"),
    ("01638500", "00010", "por_temp"),
    ("01643000", "00060", "monocacy"),
    ("01644000", "00060", "goose"),
    ("01644280", "00060", "broad_run"),
    ("01645000", "00060", "seneca"),
    ("01644148", "00065", "ef_stage"),
    ("01646500", "00060", "lf_discharge"),
    ("01646500", "00065", "lf_stage"),
]
FIELDNAMES = ["timestamp", "por_now", "por_lagged", "ef_stage", "lf_discharge",
              "lf_stage", "water_temp_c", "monocacy", "goose", "broad_run",
              "seneca", "travel_time_h"]
HEADERS = {"Accept-Encoding": "identity",
           "User-Agent": "PotomacPulse-backtest/v39 (hydrology research)"}


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%MZ")


def chunks():
    s = FETCH_START
    while s < FETCH_END:
        e = min(s + timedelta(days=CHUNK_DAYS), FETCH_END)
        yield s, e
        s = e


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as f:
            return json.load(f)
    return {"files": {}}


def get_raw(site, param, s, e, manifest):
    """Return parsed JSON for one site+param+chunk, from cache or a single polite GET."""
    # endDT is inclusive in USGS; use e - 1 minute so chunks do not overlap (readings are on :00/:15/:30/:45)
    q = {"sites": site, "parameterCd": param, "startDT": iso(s), "endDT": iso(e - timedelta(minutes=1)),
         "format": "json", "siteStatus": "all"}
    url = IV_URL + "?" + urllib.parse.urlencode(q)
    fn = f"{site}_{param}_{s:%Y%m%d}_{e:%Y%m%d}.json"
    path = os.path.join(RAW_DIR, fn)
    if not os.path.exists(path):
        last = None
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read()
                json.loads(body)  # validate
                with open(path, "wb") as f:
                    f.write(body)
                manifest["files"][fn] = {
                    "url": url, "fetched_utc_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
                with open(MANIFEST, "w") as f:
                    json.dump(manifest, f, indent=1, sort_keys=True)
                time.sleep(PAUSE_S)
                break
            except Exception as ex:  # noqa
                last = ex
                time.sleep(2.0 * (attempt + 1))
        else:
            raise RuntimeError(f"{url} failed: {last}")
    with open(path, "rb") as f:
        return json.loads(f.read())


def records_from(data):
    out = []
    for ts in data.get("value", {}).get("timeSeries", []):
        for v in ts.get("values", [{}])[0].get("value", []):
            try:
                val = float(v["value"])
                if val > -999990:
                    out.append((v["dateTime"], val))
            except (ValueError, KeyError, TypeError):
                continue
    return out


def resample_to_hourly(records):
    # NO dedupe: as in v38, every reading of every returned timeSeries enters the hourly median
    # (PoR/LF discharge return several timeSeries per site). Chunks do not overlap (endDT = next start - 1 min).
    bins = defaultdict(list)
    for dt_str, val in records:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        bins[dt.replace(minute=0, second=0, microsecond=0, tzinfo=None)].append(val)
    return {k: median(v) for k, v in bins.items()}


def compute_travel_time_hours(lf_cfs):
    if lf_cfs is None or lf_cfs <= 0:
        return None
    total_h = 4139.0 * (lf_cfs ** -0.5963)
    return max(2.0, min(48.0, total_h * 0.75))


def interpolate_por(por_hourly, target_dt):
    hf = target_dt.replace(minute=0, second=0, microsecond=0)
    hc = hf + timedelta(hours=1)
    vf, vc = por_hourly.get(hf), por_hourly.get(hc)
    if vf is not None and vc is not None:
        frac = (target_dt - hf).total_seconds() / 3600.0
        return vf + (vc - vf) * frac
    return vf if vf is not None else vc


def cell(v, nd):
    return round(v, nd) if v is not None else ""


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    manifest = load_manifest()
    hourly = {}
    raw_counts = {}
    urls = []
    for site, param, label in FETCHES:
        recs = []
        for s, e in chunks():
            data = get_raw(site, param, s, e, manifest)
            recs.extend(records_from(data))
        hourly[label] = resample_to_hourly(recs)
        raw_counts[label] = (len(recs), len(hourly[label]))
        print(f"[{label}] {len(recs)} readings -> {len(hourly[label])} hourly stamps")
    for fn in sorted(manifest["files"]):
        urls.append(manifest["files"][fn]["url"])

    all_hours = sorted(set(hourly["por_discharge"]) | set(hourly["lf_discharge"]))
    fetched = {}
    for t in all_hours:
        por_now = hourly["por_discharge"].get(t)
        lf_val = hourly["lf_discharge"].get(t)
        has_por = por_now is not None and por_now > 0
        has_lf = lf_val is not None and lf_val > 0
        if not has_por and not has_lf:
            continue
        travel_h = compute_travel_time_hours(lf_val) if has_lf else None
        por_lagged = None
        if travel_h is not None:
            pl = interpolate_por(hourly["por_discharge"], t - timedelta(hours=travel_h))
            por_lagged = pl if (pl is not None and pl > 0) else None
        key = t.strftime("%Y-%m-%d %H:%M")
        fetched[key] = {
            "timestamp": key,
            "por_now": cell(por_now, 1) if has_por else "",
            "por_lagged": cell(por_lagged, 1),
            "ef_stage": cell(hourly["ef_stage"].get(t), 2),
            "lf_discharge": cell(lf_val, 1) if has_lf else "",
            "lf_stage": cell(hourly["lf_stage"].get(t), 2),
            "water_temp_c": cell(hourly["por_temp"].get(t), 1),
            "monocacy": cell(hourly["monocacy"].get(t), 1),
            "goose": cell(hourly["goose"].get(t), 1),
            "broad_run": cell(hourly["broad_run"].get(t), 1),
            "seneca": cell(hourly["seneca"].get(t), 1),
            "travel_time_h": cell(travel_h, 1),
        }

    v38 = []
    with open(V38_PATH, newline="") as f:
        for r in csv.DictReader(f):
            v38.append(r)
    v38_by_ts = {r["timestamp"]: r for r in v38}
    v38_last = v38[-1]["timestamp"]

    # overlap diff (all v38 timestamps from FETCH_START on; also report v38 rows with no fetched row)
    diff_rows = []        # (ts, [(col, old, new)])
    n_overlap = 0
    missing_in_fetch = []
    for r in v38:
        if r["timestamp"] < OVERLAP_START:
            continue
        n_overlap += 1
        new = fetched.get(r["timestamp"])
        if new is None:
            missing_in_fetch.append(r["timestamp"])
            continue
        d = [(c, r[c], str(new[c])) for c in FIELDNAMES[1:]
             if r[c] != str(new[c]) and not (r[c] == "" and new[c] == "")]
        if d:
            diff_rows.append((r["timestamp"], d))
    fetched_not_in_v38_within_v38_span = [k for k in fetched
                                          if OVERLAP_START <= k <= v38_last
                                          and k not in v38_by_ts]

    a0, a1 = APPEND_START.strftime("%Y-%m-%d %H:%M"), APPEND_LAST.strftime("%Y-%m-%d %H:%M")
    appended = [fetched[k] for k in sorted(fetched) if a0 <= k <= a1 and k not in v38_by_ts]

    with open(OUT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, lineterminator="\n")
        w.writeheader()
        w.writerows(v38)
        w.writerows(appended)

    # per-gauge counts, gaps in appended period
    cols = ["por_now", "ef_stage", "lf_discharge", "lf_stage", "water_temp_c",
            "monocacy", "goose", "broad_run", "seneca"]
    n_hours_app = int((APPEND_LAST - APPEND_START).total_seconds() // 3600) + 1
    nonblank = {c: sum(1 for r in appended if r[c] != "") for c in cols}
    # gaps: consecutive missing hourly stamps for por_now and lf_discharge over the appended period
    present = {c: {r["timestamp"] for r in appended if r[c] != ""} for c in ("por_now", "lf_discharge")}
    gaps = {}
    for c in ("por_now", "lf_discharge"):
        runs, cur, start = [], 0, None
        for i in range(n_hours_app):
            t = (APPEND_START + timedelta(hours=i)).strftime("%Y-%m-%d %H:%M")
            if t in present[c]:
                if cur:
                    runs.append((start, cur))
                cur = 0
            else:
                if cur == 0:
                    start = t
                cur += 1
        if cur:
            runs.append((start, cur))
        gaps[c] = runs

    # October coverage precondition (plan section 2): per-day non-blank counts 2026-10-05..22
    cov_cols = ["por_now", "lf_discharge", "ef_stage", "monocacy", "goose", "broad_run", "seneca"]
    cov = defaultdict(lambda: defaultdict(int))
    for r in appended:
        d = r["timestamp"][:10]
        if "2026-10-05" <= d <= "2026-10-22":
            for c in cov_cols:
                if r[c] != "":
                    cov[d][c] += 1

    out_sha = sha256_file(OUT_PATH)
    n_rows = len(v38) + len(appended)
    with open(DATA_MANIFEST, "w") as f:
        json.dump({"file": "hourly_backtest_data_v39.csv", "rows": n_rows, "v38_rows": len(v38),
                   "appended_rows": len(appended), "first_timestamp": v38[0]["timestamp"],
                   "last_timestamp": appended[-1]["timestamp"] if appended else v38_last,
                   "sha256": out_sha}, f, indent=1)

    fetch_dates = sorted({v["fetched_utc_date"] for v in manifest["files"].values()})
    with open(PROV_PATH, "w") as f:
        W = f.write
        W("hourly_backtest_data_v39.csv provenance\n")
        W(f"Fetch date(s) (UTC, from raw/FETCH_MANIFEST.json): {', '.join(fetch_dates)}\n")
        W("Generator: analysis/rising-limb-travel-backtest/fetch_hourly_backtest_data_v39.py\n")
        W(f"Base: hourly_backtest_data_v38.csv ({len(v38)} rows, {v38[0]['timestamp']} .. {v38_last}, FROZEN, rows win)\n")
        W(f"Appended: {len(appended)} rows, {a0} .. {a1} (plan section 2 window; data after 2026-06-14 are PROVISIONAL USGS values)\n")
        W(f"Output: {n_rows} rows, last stamp {appended[-1]['timestamp'] if appended else v38_last}, sha256 {out_sha}\n")
        W("Median-of-readings rule: each stamp T = UTC-truncated median of all 15-min readings in [T, T+1h).\n")
        W("Row driver: a row exists only if PoR>0 or LF>0 at that hour (unchanged from v38).\n\n")
        W("Per series (fetch window 2026-06-12..2026-11-09): readings -> hourly stamps\n")
        for lab in raw_counts:
            W(f"  {lab}: {raw_counts[lab][0]} readings -> {raw_counts[lab][1]} stamps\n")
        W(f"\nNon-blank cells in appended rows (of {n_hours_app} possible hourly stamps, {len(appended)} rows exist):\n")
        for c in cols:
            W(f"  {c}: {nonblank[c]}\n")
        W("\nGaps in appended period (runs of missing hourly stamps, start UTC, length):\n")
        for c in ("por_now", "lf_discharge"):
            W(f"  {c}: {len(gaps[c])} runs; " + "; ".join(f"{s} x{n}" for s, n in gaps[c]) + "\n")
        W(f"\nGap between v38 end ({v38_last}) and append start ({a0}): "
          f"{int((APPEND_START - datetime.strptime(v38_last, '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)).total_seconds() // 3600) - 1} "
          "hourly stamps not covered by either (literal plan window).\n")
        W(f"\nOVERLAP CHECK vs v38 ({n_overlap} v38 rows with stamp >= 2026-06-14 00:00):\n")
        W(f"  v38 rows with no refetched row: {len(missing_in_fetch)}"
          + (" e.g. " + ", ".join(missing_in_fetch[:5]) if missing_in_fetch else "") + "\n")
        W(f"  refetched rows absent from v38 inside v38 span: {len(fetched_not_in_v38_within_v38_span)}"
          + (" e.g. " + ", ".join(fetched_not_in_v38_within_v38_span[:5]) if fetched_not_in_v38_within_v38_span else "") + "\n")
        W(f"  v38 rows with at least one differing cell: {len(diff_rows)}\n")
        colcount = defaultdict(int)
        for ts, d in diff_rows:
            for c, o, n in d:
                colcount[c] += 1
        W("  differing cells by column: " + ", ".join(f"{c}={n}" for c, n in sorted(colcount.items())) + "\n")
        bymonth = defaultdict(int)
        for ts, d in diff_rows:
            bymonth[ts[:7]] += 1
        W("  differing rows by month: " + ", ".join(f"{m}={n}" for m, n in sorted(bymonth.items())) + "\n")
        # size of revisions (relative), numeric columns
        import statistics as st
        W("  relative revision (new-old)/old, by column [median, p5, p95, max abs] over rows where both present:\n")
        for c in ("por_now", "lf_discharge", "monocacy", "goose", "broad_run", "seneca", "lf_stage", "ef_stage"):
            rel = []
            for r in v38:
                if r["timestamp"] < OVERLAP_START or r["timestamp"] not in fetched:
                    continue
                o, n = r[c], fetched[r["timestamp"]][c]
                if o != "" and n != "" and float(o) != 0:
                    rel.append((float(n) - float(o)) / float(o))
            if rel:
                rel.sort()
                q = lambda p: rel[min(len(rel) - 1, int(p * len(rel)))]
                W(f"    {c}: n={len(rel)} median={st.median(rel):+.4f} p5={q(0.05):+.4f} p95={q(0.95):+.4f} max_abs={max(abs(x) for x in rel):.4f}\n")
        for lab, lo, hi in (("2026-06-14..06-30", "2026-06-14", "2026-07-01"), ("2026-07-01..07-20", "2026-07-01", "2026-07-21")):
            for c in ("por_now", "lf_discharge"):
                rel = []
                for r in v38:
                    if lo <= r["timestamp"][:10] < hi and r["timestamp"] in fetched and r[c] != "" and fetched[r["timestamp"]][c] != "":
                        rel.append((float(fetched[r["timestamp"]][c]) - float(r[c])) / float(r[c]))
                if rel:
                    W(f"    {c} {lab}: n={len(rel)} median={st.median(rel):+.4f}\n")
        W("  first 40 differing rows:\n")
        for ts, d in diff_rows[:40]:
            W(f"    {ts}: " + "; ".join(f"{c}: {o!r} -> {n!r}" for c, o, n in d) + "\n")
        W("\nOctober coverage precondition (non-blank hours/day, appended rows, 2026-10-05..22):\n")
        W("  day         " + "  ".join(f"{c[:6]:>6}" for c in cov_cols) + "\n")
        for d in sorted(cov):
            W(f"  {d}  " + "  ".join(f"{cov[d][c]:6d}" for c in cov_cols) + "\n")
        W("\nUSGS query URLs (read-only GET; no credentials):\n")
        for u in urls:
            W("  " + u + "\n")
    print(f"{OUT_PATH}: {n_rows} rows ({len(v38)} v38 + {len(appended)} appended), sha256 {out_sha}")
    print(f"overlap rows {n_overlap}, differing {len(diff_rows)}")


if __name__ == "__main__":
    sys.exit(main())
