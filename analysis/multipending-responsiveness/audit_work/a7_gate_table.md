| Row | Group | Python | R | Threshold | Pass | File flags py/R | Margins (positive = passing side) | Narrow |
|---|---|---|---|---|---|---|---|---|
| R2 | deciding | point -0.130298; CI lo -0.324489 | point -0.130298; CI lo -0.324489 | point >= 0.05 AND CI lo > 0 | FAIL | 0/0 | point FAILS -18.03 pp; CI lo FAILS -32.45 pp |  |
| R3 | deciding | 8 of 21 | 8 of 21 | >= 14 of 21 (100*imp >= 65*21) | FAIL | 0/0 | events FAILS -6 events |  |
| B1 | deciding | -0.130683 | -0.130683 | point > 0 | FAIL | 0/0 | point FAILS -13.07 pp |  |
| B2 | robustness | min -0.153135 (drop 32); max -0.070784; 0 of 21 drops > 0 | min -0.153135; max -0.070784 | every drop point > 0 | FAIL | 0/0 | min drop FAILS -15.31 pp |  |
| B3 | robustness | -0.823651 | -0.823651 | point > 0 | FAIL | 0/0 | point FAILS -82.37 pp |  |
| N1 | guard | point -0.043982; CI hi -0.023605 | point -0.043982; CI hi -0.023605 | point <= 0.01 AND CI hi <= 0.02 | PASS | 1/1 | point ok 5.398 pp; CI hi ok 4.361 pp |  |
| N2 | guard | 5 of 18 cells fail | 5 of 18 cells fail | cell fails if (point > 0.03 AND CI lo > 0) OR (point > 0.05 AND n >= 2000) | FAIL | 0/0 | failed: 0-3000|falling (n 3548, point 0.0560, CI lo -0.0012, cond2); 0-3000|rising (n 2867, point 0.0720, CI lo 0.0145, cond1+cond2); 0-3000|steady (n 18231, point 0.0865, CI lo 0.0469, cond1+cond2); 3000-6000|rising (n 4921, point 0.1053, CI lo 0.0544, cond1+cond2); 3000-6000|steady (n 15975, point 0.0654, CI lo 0.0173, cond1+cond2). Passing cells within 1 pp of a fail condition: none |  |
| N3 | guard | -0.000956 | -0.000956 | point <= 0.02 | PASS | 1/1 | point ok 2.096 pp |  |
| D1 | guard | point -0.5984 pp; CI hi 0.1821 pp | point -0.5984 pp; CI hi 0.1821 pp | point <= +0.5 pp AND CI hi <= +1.0 pp | PASS | 1/1 | point ok 1.098 x 1.0 pp; CI hi ok 0.8179 x 1.0 pp | narrow |
| C1 | guard | single 0.849122 (91824/108140), multi 0.842769 (91137) (|miss| multi 5.723 pp vs allowed 5.088 pp) | single 0.849122, multi 0.842769 | |100 c_m - 90 n| <= max(4 n, |100 c_s - 90 n|) | FAIL | 0/0 | coverage FAILS -0.6353 pp |  |
| C2 | guard | single 0.496561 (361/727), multi 0.488308 (355) | single 0.496561, multi 0.488308 | 100 c_m >= 100 c_s - 2 n | PASS | 1/1 | coverage ok 1.175 pp |  |
| C3 | guard | single 0.767970 (2436/3172), multi 0.757251 (2402) | single 0.767970, multi 0.757251 | 100 c_m >= 100 c_s - 2 n | PASS | 1/1 | coverage ok 0.9281 pp | narrow |
| S1 | guard | point 0.038514 (U_s 254, U_m 282, n 727); CI hi 0.080104 | point 0.038514; CI hi 0.080104 | 100 (U_m - U_s) <= n AND CI hi <= 0.030 | FAIL | 0/0 | point FAILS -2.851 pp; CI hi FAILS -5.01 pp |  |
| S2 | guard | point -0.006305 (U_s 140, U_m 120, n 3172); CI hi 0.004342 | point -0.006305; CI hi 0.004342 | 100 (U_m - U_s) <= n AND CI hi <= 0.030 | PASS | 1/1 | point ok 1.631 pp; CI hi ok 2.566 pp |  |

Rows passing: 6 of 14. Auditor decision equals both file flags on every row: True
