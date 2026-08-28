# Forecast accuracy — FINAL SNAPSHOT before the v37.16 reset

Captured 2026-08-28T16:2x UTC, immediately before `resetForecastAccuracy`.

These counters accrued while forecasts were scored one GF→LF travel time TOO EARLY
(the v37.16 defect). They are preserved here because they are the empirical
corroboration of that bug and are otherwise permanently deleted by the reset.

**Do not compare these to post-reset numbers** — different scoring convention.

| Horizon | Model MAPE | n | NWS raw | n | NWS corrected | n | Persistence | n |
|---|---|---|---|---|---|---|---|---|
| +6h | 12.02% | 3058 | 14.28% | 1138 | 10.87% | 1138 | 10.52% | 1138 |
| +12h | 11.99% | 3057 | 14.70% | 1137 | 13.28% | 1137 | 13.23% | 1137 |
| +24h | 13.32% | 3045 | 17.09% | 1124 | 15.94% | 1124 | 18.76% | 1125 |
| +48h | 18.25% | 3038 | 17.72% | 1119 | 17.72% | 1119 | 21.11% | 1119 |

**The signature of the bug.** At +6h the model (12.02%) scored WORSE than naive persistence
(10.52%) while beating it comfortably at +12h, +24h and +48h. A fixed timing offset is
proportionally most damaging at the shortest horizon — at typical summer flow the ~7-9h GF→LF
travel gap exceeded the +6h horizon itself. Caveat, on the record: the model n (~3,050) and the
baseline n (~1,130) cover different periods, since C24 only began persisting baselines
2026-06-16, so this is corroboration rather than proof. The code trace was the proof.

Raw payload preserved below for completeness.

```json

{
  "horizons": {
    "6": {
      "validations": 3058,
      "avgErrorPercent": 12.018186657527894,
      "sumAbsErrorPercent": 36751.6147987203,
      "nwsRawValidations": 1138,
      "nwsRawAvgErrorPercent": 14.28147984425208,
      "nwsCorrectedValidations": 1138,
      "nwsCorrectedAvgErrorPercent": 10.873222459091453,
      "persistenceValidations": 1138,
      "persistenceAvgErrorPercent": 10.515121107219843
    },
    "12": {
      "validations": 3057,
      "avgErrorPercent": 11.98741258262917,
      "sumAbsErrorPercent": 36645.52026509737,
      "nwsRawValidations": 1137,
      "nwsRawAvgErrorPercent": 14.704725758482597,
      "nwsCorrectedValidations": 1137,
      "nwsCorrectedAvgErrorPercent": 13.275011093076479,
      "persistenceValidations": 1137,
      "persistenceAvgErrorPercent": 13.233110428416932
    },
    "24": {
      "validations": 3045,
      "avgErrorPercent": 13.321151098679165,
      "sumAbsErrorPercent": 40562.905095478054,
      "nwsRawValidations": 1124,
      "nwsRawAvgErrorPercent": 17.090802242363665,
      "nwsCorrectedValidations": 1124,
      "nwsCorrectedAvgErrorPercent": 15.942674514807116,
      "persistenceValidations": 1125,
      "persistenceAvgErrorPercent": 18.763010437917053
    },
    "48": {
      "validations": 3038,
      "avgErrorPercent": 18.24980714635706,
      "sumAbsErrorPercent": 55442.91411063275,
      "nwsRawValidations": 1119,
      "nwsRawAvgErrorPercent": 17.722587461280227,
      "nwsCorrectedValidations": 1119,
      "nwsCorrectedAvgErrorPercent": 17.723134385196655,
      "persistenceValidations": 1119,
      "persistenceAvgErrorPercent": 21.106818143558765
    }
  }
}
```