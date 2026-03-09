// Potomac Pulse — Great Falls estimation engine
// Extracted from index.html inline script

import {
    LF, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE,
    GOOSE_CREEK_PCT, EF_MODEL, EMPIRICAL_CI_90,
    GF_OUTLIER_THRESHOLD, POR_HISTORY_MAX_AGE
} from '../model/constants.js';

import {
    getFlowMultiplier, estimateLFStage, getGFFlowBin, getEFWeight
} from '../model/shared-model.js';

import {
    data, porHistory, gfLearningData, edwardsFerryData, waterTempC,
    efHysteresis
} from '../state/store.js';

import { recordPoRReading } from '../data/history.js';
import { estimateGFFromEdwardsFerry, getEdwardsFerryTrend } from '../estimation/edwards-ferry.js';

// ==================== TRAVEL TIME HELPERS ====================

export function getPoRtoGFTravelTime(mult, riseRate = null) {
    let baseTravelTime = TRAVEL_POR_GF_BASELINE * mult;

    if (riseRate && riseRate.flowState === 'rising' && riseRate.ratePerHour > 0) {
        const reductionFactor = Math.min(0.30, riseRate.ratePerHour * 0.02);
        const adjusted = baseTravelTime * (1 - reductionFactor);
        console.log(`⚡ Wave celerity: ${baseTravelTime.toFixed(1)}h → ${adjusted.toFixed(1)}h (${(reductionFactor*100).toFixed(0)}% faster, +${riseRate.ratePerHour.toFixed(1)}%/hr rise)`);
        return adjusted;
    }

    return baseTravelTime;
}

export function getGFtoLFTravelTime(mult, riseRate = null) {
    let baseTravelTime = TRAVEL_GF_LF_BASELINE * mult;

    if (riseRate && riseRate.flowState === 'rising' && riseRate.ratePerHour > 0) {
        const reductionFactor = Math.min(0.30, riseRate.ratePerHour * 0.02);
        return baseTravelTime * (1 - reductionFactor);
    }

    return baseTravelTime;
}

// ==================== ICE DETECTION ====================

export function isCriticalGaugeIceAffected() {
    const por = data["01638500"];
    const lf = data["01646500"];
    const ef = edwardsFerryData.current;
    return !!(por?.iceAffected || lf?.iceAffected || !ef);
}

// ==================== CORRECTION & UNCERTAINTY ====================

export function getGFCorrection(flowBin, flowState) {
    if (!gfLearningData?.correctionBins) return 0;

    const bin = gfLearningData.correctionBins[flowBin];
    if (!bin) return 0;

    const stateData = bin[flowState] || bin['steady'];
    if (!stateData || stateData.count < 5) return 0;

    if (stateData.emaMeanError !== undefined) {
        return stateData.emaMeanError;
    }

    return stateData.meanError || 0;
}

export function getGFUncertainty(flowBin, flowState) {
    const ciData = EMPIRICAL_CI_90[flowBin];
    if (!ciData) return null;

    const stateCI = ciData[flowState] || ciData['all'];

    let stdDev = null;
    let count = 0;
    if (gfLearningData?.correctionBins) {
        const bin = gfLearningData.correctionBins[flowBin];
        if (bin) {
            const stateData = bin[flowState] || bin['steady'];
            if (stateData && stateData.count >= 5) {
                const mean = stateData.meanError || 0;
                const variance = (stateData.sumErrorSq / stateData.count) - (mean * mean);
                stdDev = Math.sqrt(Math.max(0, variance));
                count = stateData.count;
            }
        }
    }

    return {
        q05: stateCI.q05,
        q95: stateCI.q95,
        stdDev: stdDev,
        count: count
    };
}

export function isGFOutlier(errorCFS, binData) {
    if (!binData || binData.count < 10) return false;

    const mean = binData.meanError || 0;
    const variance = (binData.sumErrorSq / binData.count) - (mean * mean);
    const stdDev = Math.sqrt(Math.max(0, variance));

    if (stdDev === 0) return false;

    const zScore = Math.abs((errorCFS - mean) / stdDev);
    return zScore > GF_OUTLIER_THRESHOLD;
}

// ==================== PoR HISTORY LOOKUPS ====================

export function getPoRFromHoursAgo(hoursAgo) {
    if (porHistory.length === 0) {
        console.log(`📊 getPoRFromHoursAgo(${hoursAgo.toFixed(1)}h): No history available`);
        return null;
    }

    const targetTime = Date.now() - (hoursAgo * 60 * 60 * 1000);

    let closest = null;
    let closestDiff = Infinity;

    for (const entry of porHistory) {
        const diff = Math.abs(entry.timestamp - targetTime);
        if (diff < closestDiff) {
            closestDiff = diff;
            closest = entry;
        }
    }

    if (closest && closestDiff < 60 * 60 * 1000) {
        return {
            cfs: closest.cfs,
            stage: closest.stage,
            actualHoursAgo: (Date.now() - closest.timestamp) / (60 * 60 * 1000),
            timestamp: closest.timestamp
        };
    }

    const oldestEntry = porHistory[0];
    const newestEntry = porHistory[porHistory.length - 1];
    const oldestHoursAgo = (Date.now() - oldestEntry.timestamp) / (60 * 60 * 1000);
    const newestHoursAgo = (Date.now() - newestEntry.timestamp) / (60 * 60 * 1000);
    console.log(`📊 getPoRFromHoursAgo(${hoursAgo.toFixed(1)}h): History spans ${newestHoursAgo.toFixed(1)}h to ${oldestHoursAgo.toFixed(1)}h ago (${porHistory.length} entries)`);

    return null;
}

export function getPoRRiseRate() {
    if (porHistory.length < 4) return null;

    const now = Date.now();
    const twoHoursAgo = now - (2 * 60 * 60 * 1000);

    let pastReading = null;
    for (const entry of porHistory) {
        if (entry.timestamp <= twoHoursAgo) {
            pastReading = entry;
        }
    }

    if (!pastReading) return null;

    const currentReading = porHistory[porHistory.length - 1];
    const currentCFS = currentReading.cfs;
    const pastCFS = pastReading.cfs;

    const changeCFS = currentCFS - pastCFS;
    const changePercent = (changeCFS / pastCFS) * 100;
    const hoursDiff = (currentReading.timestamp - pastReading.timestamp) / (60 * 60 * 1000);
    const ratePerHour = changePercent / hoursDiff;

    const absChange = Math.abs(changeCFS);
    const threshold = Math.max(100, currentCFS * 0.02);
    let flowState = 'steady';
    if (absChange >= threshold) {
        flowState = changeCFS > 0 ? 'rising' : 'falling';
    }

    return {
        ratePerHour,
        ratePercent: changePercent,
        changeCFS,
        flowState,
        currentCFS,
        pastCFS,
        hoursDiff
    };
}

// ==================== GF HISTORY FROM PoR ====================

export function computeGFHistoryFromPoR(hoursBack = 6) {
    if (porHistory.length === 0) return [];

    const cutoff = Date.now() - hoursBack * 3600000;
    const historyPoints = [];

    for (const entry of porHistory) {
        if (entry.timestamp < cutoff) continue;

        let estCFS = entry.cfs;
        const flowBin = getGFFlowBin(estCFS);
        // Use observed flow state rather than always 'steady' (approximation: applies
        // current state to all history points — acceptable for cold-start fallback only)
        const histRiseRate = getPoRRiseRate();
        const histFlowState = histRiseRate?.flowState ?? 'steady';
        const correction = getGFCorrection(flowBin, histFlowState);
        estCFS = estCFS - correction;
        if (estCFS < 0) estCFS = 0;
        const stage = estimateLFStage(estCFS);

        const hrsAgo = (Date.now() - entry.timestamp) / 3600000;
        historyPoints.push({
            hrs: -hrsAgo,
            cfs: Math.round(estCFS),
            stage: stage,
            time: new Date(entry.timestamp),
            isHistory: true
        });
    }

    historyPoints.sort((a, b) => a.hrs - b.hrs);
    return historyPoints;
}

// ==================== TRAVEL-TIME-AWARE PoR ====================

export function getTravelTimeAwarePor(targetHrsFromNow, porPoints, interpolateFn, currentPorCFS, currentMult) {
    const maxIterations = 3;
    let travelTime = TRAVEL_POR_GF_BASELINE * currentMult;
    let porDepartureHrs = targetHrsFromNow - travelTime;
    let porCFS = currentPorCFS;
    let source = 'current';
    let actualHoursAgo = null;

    for (let i = 0; i < maxIterations; i++) {
        if (porDepartureHrs < 0) {
            const hoursAgo = Math.abs(porDepartureHrs);
            const historicData = getPoRFromHoursAgo(hoursAgo);

            if (historicData) {
                porCFS = historicData.cfs;
                source = 'history';
                actualHoursAgo = historicData.actualHoursAgo;
            } else {
                porCFS = currentPorCFS;
                source = 'current';
                actualHoursAgo = 0;
            }
        } else {
            const forecastCFS = interpolateFn(porPoints, porDepartureHrs);
            if (forecastCFS !== null) {
                porCFS = forecastCFS;
                source = 'NWS';
            } else {
                porCFS = currentPorCFS;
                source = 'current';
            }
            actualHoursAgo = null;
        }

        const newMult = getFlowMultiplier(porCFS).mult;
        const newTravelTime = TRAVEL_POR_GF_BASELINE * newMult;

        if (Math.abs(newTravelTime - travelTime) < 0.5) {
            break;
        }

        travelTime = newTravelTime;
        porDepartureHrs = targetHrsFromNow - travelTime;
    }

    return {
        cfs: porCFS,
        source: source,
        travelTime: travelTime,
        porDepartureHrs: porDepartureHrs,
        actualHoursAgo: actualHoursAgo
    };
}

// ==================== FLOW STATE HELPERS ====================

// Determine flow state from NWS trend data (used as fallback)
function getFlowStateFromTrend(trend, currentFlow) {
    if (!trend) return 'steady';

    const pctChange = (trend.rate || 0) * 100;
    const absChange = Math.abs(pctChange * (currentFlow || 5000) / 100);

    const minAbsChange = 100;
    const minPctChange = 2;

    const threshold = Math.max(minAbsChange, (currentFlow || 5000) * minPctChange / 100);

    if (absChange >= threshold) {
        if (pctChange > 0) return 'rising';
        if (pctChange < 0) return 'falling';
    }
    return 'steady';
}

// ==================== MAIN ESTIMATION FUNCTION ====================

export function estimateGreatFalls() {
    const por = data["01638500"];
    const monocacy = data["01643000"];
    const goose = data["01644000"];
    const broadRun = data["01644280"];
    const seneca = data["01645000"];
    const lf = data[LF.id];

    if (!lf?.q) {
        return null;
    }

    if (!por?.q && !por?.iceAffected) {
        return null;
    }

    // When critical gauges are ice-affected, fall back to EF-only estimate
    if (por?.iceAffected || lf?.iceAffected) {
        const efEstimate = estimateGFFromEdwardsFerry();
        if (efEstimate && efEstimate.cfs > 0) {
            const estimatedStage = estimateLFStage(efEstimate.cfs);
            console.log(`🧊❄️ PoR ice-affected → using EF-only estimate: ${efEstimate.cfs} cfs (${estimatedStage.toFixed(2)} ft)`);
            return {
                cfs: efEstimate.cfs,
                stage: estimatedStage,
                flowState: getEdwardsFerryTrend() || 'steady',
                confidence: 'low',
                useTimeShifted: false,
                timeShiftedHoursAgo: null,
                useEfEnsemble: false,
                efOnly: true,
                forecastCFS: efEstimate.cfs,
                forecastStage: estimatedStage,
                inputs: {
                    porCFS: null,
                    porEstimateCFS: null,
                    historicPorCFS: null,
                    monocacyCFS: null,
                    monocacyActual: false,
                    gooseCFS: null,
                    gooseActual: false,
                    travelPoRtoGF: null,
                    travelGFtoLF: null,
                    correction: 0,
                    flowBin: null,
                    waveCelerity: null
                },
                uncertaintyRange: null,
                efEstimate: efEstimate,
                validationCountdown: null
            };
        }
        console.log('🧊 GF prediction skipped: critical gauge ice-affected, no EF data');
        return null;
    }

    recordPoRReading(por.q, por.h);

    let mult = data._mult?.mult || 1.0;

    const riseRate = getPoRRiseRate();

    const monocacyFlow = monocacy?.q || (lf.q * 0.071);
    const gooseFlow = goose?.q || (lf.q * GOOSE_CREEK_PCT);
    const broadRunFlow = broadRun?.q || (lf.q * 0.0066);
    const senecaFlow = seneca?.q || (lf.q * 0.0087);

    // Iterative travel time calculation
    let travelPoRtoGF = getPoRtoGFTravelTime(mult, riseRate);
    let historicPoR = null;
    let estimatedCFS, useTimeShifted = false, timeShiftedHoursAgo = null;

    for (let iteration = 0; iteration < 3; iteration++) {
        const lookupHours = travelPoRtoGF;
        const tryHistoric = getPoRFromHoursAgo(lookupHours);

        if (!tryHistoric) {
            break;
        }

        historicPoR = tryHistoric;

        const historicMult = getFlowMultiplier(historicPoR.cfs).mult;
        const newTravelTime = getPoRtoGFTravelTime(historicMult, riseRate);

        if (Math.abs(newTravelTime - travelPoRtoGF) < 1.0) {
            console.log(`📊 Travel time converged in ${iteration + 1} iterations: ${travelPoRtoGF.toFixed(1)}h`);
            break;
        }

        console.log(`📊 Iteration ${iteration + 1}: ${lookupHours.toFixed(1)}h ago → ${historicPoR.cfs} cfs → new travel time ${newTravelTime.toFixed(1)}h`);

        travelPoRtoGF = newTravelTime;
        mult = historicMult;
    }

    const travelGFtoLF = getGFtoLFTravelTime(mult, riseRate);

    // PoR-Delta staleness correction
    let porDeltaCorrection = null;

    if (historicPoR) {
        estimatedCFS = historicPoR.cfs + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;
        useTimeShifted = true;
        timeShiftedHoursAgo = historicPoR.actualHoursAgo;

        const porNow = por.q;
        const porThen = historicPoR.cfs;
        const porChangeRatio = porNow / porThen;
        const porChangePct = (porChangeRatio - 1) * 100;

        if (Math.abs(porChangePct) > 5) {
            const fractionElapsed = Math.min(1.0, (timeShiftedHoursAgo || 0) / Math.max(1, travelPoRtoGF));
            const decayFactor = Math.min(0.50, Math.sqrt(fractionElapsed));

            const appliedRatio = 1 + (porChangeRatio - 1) * decayFactor;
            const rawEstimate = estimatedCFS;
            estimatedCFS = Math.round(estimatedCFS * appliedRatio);

            porDeltaCorrection = {
                rawRatio: porChangeRatio,
                appliedRatio: appliedRatio,
                decayFactor: decayFactor,
                rawEstimate: rawEstimate,
                correctedCFS: estimatedCFS,
                porNow: porNow,
                porThen: porThen
            };

            console.log(`📊 PoR-delta correction: PoR changed ${porChangePct > 0 ? '+' : ''}${porChangePct.toFixed(1)}% since time-shifted reading. ` +
                `Decay factor: ${(decayFactor*100).toFixed(0)}%. Estimate: ${rawEstimate} → ${estimatedCFS} cfs`);
        }
    } else {
        estimatedCFS = por.q + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;
    }

    // Flow state
    const flowState = (riseRate && riseRate.flowState) ? riseRate.flowState : getFlowStateFromTrend(por.trend, por.q);
    if (riseRate && riseRate.flowState) {
        console.log(`📊 Flow state: ${flowState} (observed, ${riseRate.changeCFS > 0 ? '+' : ''}${Math.round(riseRate.changeCFS)} cfs over ${riseRate.hoursDiff.toFixed(1)}h)`);
    } else {
        console.log(`📊 Flow state: ${flowState} (NWS fallback, porHistory has ${porHistory.length} entries)`);
    }

    // Apply learned correction
    const flowBin = getGFFlowBin(estimatedCFS);
    const correction = getGFCorrection(flowBin, flowState);
    const uncertainty = getGFUncertainty(flowBin, flowState);
    const porEstimateCFS = estimatedCFS - correction;

    // Weighted ensemble with Edwards Ferry
    const efEstimate = estimateGFFromEdwardsFerry();
    let useEfEnsemble = false;
    let ensembleEfWeight = null;

    if (efEstimate && efEstimate.cfs > 0) {
        const efWeight = getEFWeight(porEstimateCFS);

        const discrepancy = Math.abs(efEstimate.cfs - porEstimateCFS) / porEstimateCFS;
        if (discrepancy > 0.50) {
            console.log(`⚠️ Skipping EF ensemble: ${Math.round(discrepancy*100)}% discrepancy ` +
                `(EF: ${efEstimate.cfs} vs PoR: ${Math.round(porEstimateCFS)})`);
            estimatedCFS = porEstimateCFS;
        } else {
            const porWeight = 1 - efWeight;
            estimatedCFS = Math.round(porWeight * porEstimateCFS + efWeight * efEstimate.cfs);
            useEfEnsemble = true;
            ensembleEfWeight = efWeight;

            console.log(`🔀 Ensemble: ${(porWeight*100).toFixed(0)}% PoR (${Math.round(porEstimateCFS)}) + ` +
                `${(efWeight*100).toFixed(0)}% EF (${efEstimate.cfs}) = ${estimatedCFS} cfs`);
        }
    } else {
        estimatedCFS = porEstimateCFS;
    }

    // Soft LF ceiling (120%)
    let ceilingApplied = false;
    const CEILING_RATIO = 1.20;
    if (lf?.q > 0) {
        const maxEstimate = lf.q * CEILING_RATIO;
        if (estimatedCFS > maxEstimate) {
            console.log(`🔒 LF ceiling: ${Math.round(estimatedCFS)} cfs → ${Math.round(maxEstimate)} cfs (120% of LF ${Math.round(lf.q)})`);
            estimatedCFS = Math.round(maxEstimate);
            ceilingApplied = true;
        }
    }

    const estimatedStage = estimateLFStage(estimatedCFS);

    // Uncertainty range — empirical 90% CI
    let uncertaintyRange = null;
    if (uncertainty) {
        const halfWidth = (uncertainty.q95 - uncertainty.q05) / 2;
        const lowCFS = Math.max(0, Math.round(estimatedCFS - halfWidth));
        const highCFS = Math.round(estimatedCFS + halfWidth);
        uncertaintyRange = {
            lowCFS: lowCFS,
            highCFS: highCFS,
            lowStage: estimateLFStage(lowCFS),
            highStage: estimateLFStage(highCFS),
            q05: uncertainty.q05,
            q95: uncertainty.q95,
            stdDevCFS: uncertainty.stdDev ? Math.round(uncertainty.stdDev) : null,
            observations: uncertainty.count
        };
    }

    // Confidence
    let confidence = 'medium';
    const hasActualTribs = !!(monocacy?.q && goose?.q);
    if (hasActualTribs && useTimeShifted) confidence = 'high';
    if (hasActualTribs && !useTimeShifted) confidence = 'medium';
    if (!hasActualTribs && !useTimeShifted) confidence = 'low';

    if (useEfEnsemble && confidence === 'medium') {
        confidence = 'high';
    }

    // Edwards Ferry cross-check
    const efTrend = getEdwardsFerryTrend();
    let efAgreement = null;
    if (efTrend) {
        efAgreement = (efTrend === flowState) || (efTrend === 'steady' && flowState === 'steady');
        if (!efAgreement && confidence === 'high') {
            confidence = 'medium';
            console.log(`⚠️ EF trend (${efTrend}) disagrees with GF estimate (${flowState})`);
        } else if (efAgreement && confidence === 'medium' && hasActualTribs) {
            confidence = 'high';
        }
    }

    // Forecast (current readings arriving at GF)
    const forecastTotal = por.q + monocacyFlow + gooseFlow + broadRunFlow + senecaFlow;

    return {
        cfs: Math.round(estimatedCFS),
        stage: estimatedStage,
        flowState: flowState,
        confidence: confidence,
        useTimeShifted: useTimeShifted,
        timeShiftedHoursAgo: timeShiftedHoursAgo,
        useEfEnsemble: useEfEnsemble,
        efWeight: ensembleEfWeight,
        forecastCFS: Math.round(forecastTotal),
        forecastStage: estimateLFStage(forecastTotal),
        inputs: {
            porCFS: Math.round(por.q),
            porEstimateCFS: Math.round(porEstimateCFS),
            historicPorCFS: historicPoR ? Math.round(historicPoR.cfs) : null,
            monocacyCFS: Math.round(monocacyFlow),
            monocacyActual: !!monocacy?.q,
            gooseCFS: Math.round(gooseFlow),
            gooseActual: !!goose?.q,
            broadRunCFS: Math.round(broadRunFlow),
            broadRunActual: !!broadRun?.q,
            senecaCFS: Math.round(senecaFlow),
            senecaActual: !!seneca?.q,
            travelPoRtoGF: travelPoRtoGF,
            travelGFtoLF: travelGFtoLF,
            correction: correction,
            flowBin: flowBin,
            waveCelerity: riseRate ? {
                applied: riseRate.flowState === 'rising' && riseRate.ratePerHour > 0,
                ratePerHour: riseRate.ratePerHour,
                reductionPct: riseRate.flowState === 'rising' ? Math.min(30, riseRate.ratePerHour * 2) : 0
            } : null,
            porDeltaCorrection: porDeltaCorrection,
            ceilingApplied: ceilingApplied
        },
        uncertaintyRange: uncertaintyRange,
        efEstimate: efEstimate,
        validationCountdown: travelGFtoLF
    };
}
