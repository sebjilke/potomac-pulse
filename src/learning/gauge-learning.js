// Potomac Pulse — Gauge learning system (System 1)
// Travel time corrections based on observed rise events
// Extracted from index.html inline script

import {
    LF, STORAGE_KEY, SYNC_API, GAUGES,
    MIN_OBS_FOR_CORRECTION
} from '../model/constants.js';

import {
    data,
    learningData, setLearningData,
    learningEnabled,
    cloudSyncEnabled
} from '../state/store.js';

import { syncToCloud, updateSyncStatus } from '../learning/cloud-sync.js';

// ==================== LEARNING DATA MANAGEMENT ====================

export async function loadLearning() {
    // First try localStorage for immediate data
    let localData = loadLocalLearning();

    // If cloud sync is enabled, try to merge cloud data
    if (cloudSyncEnabled) {
        try {
            const cloudData = await loadCloudLearning();
            if (cloudData) {
                // Merge: cloud data takes precedence for corrections, combine observations
                localData = mergeLearningData(localData, cloudData);
                console.log('☁️ Loaded and merged cloud learning data');
                updateSyncStatus('synced');
            }
        } catch(e) {
            console.log('Cloud load failed, using local:', e);
            updateSyncStatus('error');
        }
    }

    return localData;
}

export function loadLocalLearning() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.observations && parsed.startDate) {
                return parsed;
            }
        }
    } catch(e) {
        console.log("Local learning data reset:", e);
    }
    return createEmptyLearning();
}

export async function loadCloudLearning() {
    try {
        const response = await fetch(SYNC_API, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const cloudLearning = await response.json();
        return cloudLearning;
    } catch(e) {
        console.log('Cloud learning load error:', e);
        return null;
    }
}

export function mergeLearningData(local, cloud) {
    if (!cloud) return local;

    const merged = createEmptyLearning();

    // Use earlier start date
    merged.startDate = new Date(local.startDate) < new Date(cloud.startDate)
        ? local.startDate : cloud.startDate;

    // Merge corrections (cloud takes precedence over local).
    // Cloud aggregates corrections from multiple sessions/devices and is more reliable
    // than a single browser session. If local has a gauge the cloud doesn't, it's added
    // via spread order. This is intentional policy, not an oversight.
    merged.corrections = { ...local.corrections, ...cloud.corrections };

    // Merge observations (dedupe by timestamp)
    const allGauges = new Set([
        ...Object.keys(local.observations),
        ...Object.keys(cloud.observations)
    ]);

    for (const gaugeId of allGauges) {
        const localObs = local.observations[gaugeId] || [];
        const cloudObs = cloud.observations[gaugeId] || [];

        // Combine and dedupe by timestamp
        const combined = [...localObs, ...cloudObs];
        const seen = new Set();
        merged.observations[gaugeId] = combined.filter(o => {
            const key = o.timestamp || o.created_at;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(-500); // Keep last 500
    }

    // Sum total obs (may be slightly inflated if same session synced to cloud and back,
    // but observation arrays are deduped by timestamp so data integrity is preserved)
    merged.totalObs = (local.totalObs || 0) + (cloud.totalObs || 0);

    return merged;
}

export function createEmptyLearning() {
    return {
        startDate: new Date().toISOString(),
        observations: {},
        corrections: {},
        totalObs: 0
    };
}

export async function saveLearning() {
    // Always save locally first (fast)
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(learningData));
    } catch(e) {
        console.log("Failed to save local learning:", e);
    }

    // Then sync to cloud if enabled (async, don't block)
    if (cloudSyncEnabled) {
        syncToCloud();
    }
}

// ==================== OBSERVATION RECORDING ====================

export function recordObservation() {
    if (!learningEnabled || !learningData || !data[LF.id]) return;

    const now = Date.now();
    const lfQ = data[LF.id].q;
    const lfH = data[LF.id].h;

    // Track significant rises for arrival verification
    const lfObs = learningData.observations[LF.id] || [];
    const lastLfQ = lfObs[lfObs.length - 1]?.q || lfQ;
    const lfRising = lfQ > lastLfQ * 1.08; // 8% rise at LF — matches arrival matching threshold in calculateCorrections()

    for (const [id, g] of Object.entries(GAUGES)) {
        if (id === LF.id) continue;
        const d = data[id];
        if (!d || !d.q || !d.h) continue;

        // Skip ice-affected or estimated gauges - stale data shouldn't train the model
        if (d.iceAffected || d.estimated) continue;

        // Store observation
        if (!learningData.observations[id]) {
            learningData.observations[id] = [];
        }

        const obs = learningData.observations[id];
        const last = obs[obs.length - 1];

        // Skip if <1hr since last observation
        if (last && (now - last.timestamp) < 3600000) continue;

        // Detect significant rise at this gauge (potential wave start)
        const isRising = last && d.q > last.q * 1.15; // 15% rise

        obs.push({
            timestamp: now,
            q: d.q,
            h: d.h,
            lfQ: lfQ,
            lfH: lfH,
            predictedHrs: d.travelHrs,
            rising: isRising,
            lfRising: lfRising  // TODO: stored but not used in calculateCorrections() — kept for cloud compat
        });

        // Keep only last 500 observations per gauge
        if (obs.length > 500) obs.shift();

        learningData.totalObs++;
    }

    // Store LF observations for tracking arrivals
    if (!learningData.observations[LF.id]) {
        learningData.observations[LF.id] = [];
    }
    const lfObsList = learningData.observations[LF.id];
    const lastLfObs = lfObsList[lfObsList.length - 1];
    if (!lastLfObs || (now - lastLfObs.timestamp) >= 3600000) {
        lfObsList.push({ timestamp: now, q: lfQ, h: lfH });
        if (lfObsList.length > 500) lfObsList.shift();
    }

    // Throttle correction recalculation: O(gauges × obs × rises) — only run every 5 new obs
    // Save runs every time regardless so observations aren't lost
    if (learningData.totalObs % 5 === 0) {
        calculateCorrections();
    }
    saveLearning();
}

// ==================== CORRECTION CALCULATION ====================

export function calculateCorrections() {
    // Match upstream rises with downstream arrivals at Little Falls
    const lfObs = learningData.observations[LF.id] || [];
    if (lfObs.length < 10) return;

    for (const [id, obs] of Object.entries(learningData.observations)) {
        if (id === LF.id || obs.length < MIN_OBS_FOR_CORRECTION) continue;

        const g = GAUGES[id];
        if (!g) continue;

        // Find rise events at this gauge
        const riseEvents = obs.filter(o => o.rising);
        if (riseEvents.length < 3) continue;

        let totalRatio = 0;
        let matchCount = 0;

        for (const rise of riseEvents) {
            // Expected arrival time at LF
            const expectedArrival = rise.timestamp + (rise.predictedHrs * 3600000);

            // Look for corresponding rise at LF within ±50% of predicted time
            const windowStart = rise.timestamp + (rise.predictedHrs * 1800000); // 0.5x
            const windowEnd = rise.timestamp + (rise.predictedHrs * 5400000);   // 1.5x

            // Find LF rise in that window
            const lfRise = lfObs.find(lf =>
                lf.timestamp > windowStart &&
                lf.timestamp < windowEnd &&
                lf.q > rise.lfQ * 1.08 // 8% rise
            );

            if (lfRise) {
                const actualHrs = (lfRise.timestamp - rise.timestamp) / 3600000;
                const ratio = actualHrs / rise.predictedHrs;

                // Only count reasonable ratios (0.3x to 3x)
                if (ratio > 0.3 && ratio < 3.0) {
                    totalRatio += ratio;
                    matchCount++;
                }
            }
        }

        // Calculate correction factor (weighted toward 1.0 with few observations)
        if (matchCount >= 2) {
            const avgRatio = totalRatio / matchCount;
            // Blend with 1.0 based on confidence (more matches = more weight)
            const confidence = Math.min(matchCount / 10, 1.0);
            learningData.corrections[id] = (avgRatio * confidence) + (1.0 * (1 - confidence));
        }
    }
}

export function getCorrectionFactor(gaugeId) {
    if (!learningData) return 1.0;
    return learningData.corrections[gaugeId] || 1.0;
}
