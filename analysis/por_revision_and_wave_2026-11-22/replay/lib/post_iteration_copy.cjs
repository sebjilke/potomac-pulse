'use strict';
// SEPARATE COPY of the steps of makeGFPrediction AFTER the travel-time iteration, for the 2 x 2 x 2 (PLAN 4.4, audit N3).
// This is the ONLY place where production arithmetic is copied. Source: scheduled-update.js of commit cd7b0c3 (v39.11),
// function makeGFPrediction, lines 999 to 1082. The same body is in v39.2 (lines 854 to 937) and v39.6 (867 to 950):
// the function body is byte-identical in all three (R8A_CODE_DIFF.md). Constants and helpers (EF_MODEL, getEFWeight,
// DECAY_CAP) are imported from the version's own shared/model.js, not copied.
//
// Deliberately NOT copied (not part of the raw estimate):
//   - every `trace` assignment and every console.log (write-only in production); the values the log records
//     (preCfs, pct, decay, ratio) are captured into local variables at the same points;
//   - the production lines `const flowState = getFlowState(porHistory, por.q)` and `const timeShiftedHoursAgo = ...`
//     (between lines 1050 and 1055): they feed the learned correction, not the raw estimate (the 2 x 2 x 2 is on the raw
//     estimate only);
//   - the production lines after 1082 (applyGFCorrection and the 120% cap).
// Every code line below ends with the production line number it copies; lines marked "(production line N: ...)" replace a
// trace assignment. tools/verify (replay/verify_copy.py) re-derives this correspondence mechanically.
// Inputs that production takes from its earlier lines are passed in:
//   historicPoR   = {cfs, actualHoursAgo} from the iteration loop or null (loop found no reading)
//   travelPoRtoGF = final PoR -> GF travel time of the loop
//   por.q         = current Point of Rocks reading; monocacyFlow..senecaFlow = tributary flows; ef.h = Edwards Ferry stage
function postIteration(inp, M) {
    const { historicPoR, travelPoRtoGF, por, monocacyFlow, gooseFlow, broadRunFlow, senecaFlow, ef, waterTempC } = inp;
    const { EF_MODEL, getEFWeight, DECAY_CAP } = M;
    let pct = null, decay = null, ratio = null, preCfs;
    let porEstimateCFS;                                                                              // 999
    let useTimeShifted = false;                                                                      // 1000
    if (historicPoR) {                                                                               // 1002
        porEstimateCFS = historicPoR.cfs + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;     // 1003
        useTimeShifted = true;                                                                       // 1004
        preCfs = porEstimateCFS;                                                                     // (production line 1005: trace.preCfs)
        const porChangeRatio = por.q / historicPoR.cfs;                                              // 1010
        const porChangePct = (porChangeRatio - 1) * 100;                                             // 1011
        pct = porChangePct;                                                                          // (production line 1012: trace.pct)
        if (Math.abs(porChangePct) > 5) {                                                            // 1014
            const fractionElapsed = Math.min(1.0, (historicPoR.actualHoursAgo || 0) / Math.max(1, travelPoRtoGF)); // 1015
            const decayFactor = Math.min(DECAY_CAP, Math.sqrt(fractionElapsed));                     // 1016
            const appliedRatio = 1 + (porChangeRatio - 1) * decayFactor;                             // 1017
            const rawEstimate = porEstimateCFS;                                                      // 1018
            decay = decayFactor; ratio = appliedRatio;                                               // (production line 1019: trace.decay / trace.ratio)
            porEstimateCFS = Math.round(porEstimateCFS * appliedRatio);                              // 1020
        }                                                                                            // 1023
    } else {                                                                                         // 1024
        porEstimateCFS = por.q + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;               // 1025
        preCfs = porEstimateCFS;                                                                     // (production line 1026: trace.preCfs)
    }                                                                                                // 1027
    let efEstimateCFS = null;                                                                        // 1033
    let useEfEnsemble = false;                                                                       // 1034
    let efModelType = 'default';                                                                     // 1035
    const efStage = ef?.h || null;                                                                   // 1036
    if (efStage && efStage >= EF_MODEL.minStage && efStage <= EF_MODEL.maxStage) {                   // 1038
        const useCold = waterTempC !== null && waterTempC <= EF_MODEL.coldMaxTemp;                   // 1040
        const coef = useCold ? EF_MODEL.coldCoef : EF_MODEL.coef;                                    // 1041
        const exp = useCold ? EF_MODEL.coldExp : EF_MODEL.exp;                                       // 1042
        efModelType = useCold ? 'cold' : (waterTempC !== null ? 'default' : 'default-no-temp');      // 1043
        efEstimateCFS = coef * Math.pow(efStage, exp);                                               // 1045
        if (efEstimateCFS > 500 && efEstimateCFS < 500000) {                                         // 1046
            useEfEnsemble = true;                                                                    // 1047
        }                                                                                            // 1048
    }                                                                                                // 1049
    let estimatedCFS;                                                                                // 1055
    let efWeightUsed = null;                                                                         // 1056
    if (useEfEnsemble) {                                                                             // 1057
        efWeightUsed = getEFWeight(porEstimateCFS);                                                  // 1058
        const porWeight = 1 - efWeightUsed;                                                          // 1059
        const discrepancy = Math.abs(efEstimateCFS - porEstimateCFS) / porEstimateCFS;               // 1062
        if (discrepancy > 0.50) {                                                                    // 1064
            estimatedCFS = porEstimateCFS;                                                           // 1066
            useEfEnsemble = false;                                                                   // 1067
            efWeightUsed = null;                                                                     // 1068
        } else {                                                                                     // 1069
            estimatedCFS = porWeight * porEstimateCFS + efWeightUsed * efEstimateCFS;                // 1070
        }                                                                                            // 1072
    } else {                                                                                         // 1073
        estimatedCFS = porEstimateCFS;                                                               // 1074
    }                                                                                                // 1075
    const rawFinalUnclipped = estimatedCFS;                                                          // 1082
    return { rawFinalUnclipped, porEstimateCFS, preCfs, pct, decay, ratio, useTimeShifted, efWeightUsed, useEfEnsemble, efModelType };
}
module.exports = { postIteration };
