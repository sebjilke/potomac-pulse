#!/usr/bin/env python3
"""Step 7: cell-by-cell comparison of data/tidy/withdrawals_coop.csv with the researcher's hand-built
research/data/coop/coop_daily_reports_parsed.csv (shared columns). Read-only on both; writes data/tidy/withdrawals_coop_vs_researcher.json.
Stdlib only. Run: python3 -I tools/07_compare_coop_csv.py"""
import csv, json, os
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mine = {r['node']: r for r in csv.DictReader(open(os.path.join(S, 'data/tidy/withdrawals_coop.csv'), newline='', encoding='utf-8'))}
res = {r['node']: r for r in csv.DictReader(open(os.path.join(S, 'research/data/coop/coop_daily_reports_parsed.csv'), newline='', encoding='utf-8'))}
MAP = {'node': 'node', 'report_date': 'report_date', 'withdrawal_date': 'withdrawal_date', 'source_url': 'source_url',
 'fairfax_corbalis_mgd': 'fairfax_corbalis_MGD', 'wssc_potomac_mgd': 'wssc_potomac_MGD', 'wash_aqueduct_great_falls_mgd': 'wash_aqueduct_great_falls_MGD',
 'wash_aqueduct_great_falls_flag': 'wash_aqueduct_great_falls_flag', 'wash_aqueduct_little_falls_mgd': 'wash_aqueduct_little_falls_MGD',
 'loudoun_withdrawal_mgd': 'loudoun_withdrawal_MGD', 'loudoun_broad_run_discharge_mgd': 'loudoun_broad_run_discharge_MGD',
 'total_potomac_withdrawal_mgd': 'total_potomac_withdrawal_MGD', 'total_net_potomac_withdrawal_mgd': 'total_net_withdrawal_MGD',
 'lf_prev_day_cfs': 'lf_gage_prev_day_cfs', 'por_prev_day_cfs': 'por_prev_day_cfs', 'coop_flow_below_gf_intake_mgd': 'great_falls_est_MGD'}
diffs = []; cells = 0
for n in sorted(set(mine) | set(res), key=int):
    if n not in mine or n not in res: diffs.append({'node': n, 'note': 'row only in ' + ('mine' if n in mine else 'researcher CSV')}); continue
    for a, b in MAP.items():
        cells += 1
        if mine[n][a] != res[n][b]: diffs.append({'node': n, 'column_mine': a, 'column_researcher': b, 'mine': mine[n][a], 'researcher': res[n][b]})
out = {'cells_compared': cells, 'rows_mine': len(mine), 'rows_researcher': len(res), 'differences': diffs}
json.dump(out, open(os.path.join(S, 'data/tidy/withdrawals_coop_vs_researcher.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))
