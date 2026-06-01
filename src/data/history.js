// Potomac Pulse — PoR and GF history management
// Extracted from index.html inline script

import {
    POR_HISTORY_KEY, POR_HISTORY_MAX_AGE,
    GF_HISTORY_KEY, GF_HISTORY_MAX_AGE,
    SYNC_API
} from '../model/constants.js';

import {
    porHistory, setPorHistory,
    gfHistory, setGfHistory,
    gfDataReady, gfEstimate
} from '../state/store.js';

// Forward declaration — resolved at runtime to avoid circular deps
// updateGreatFallsUI and updateForecastPeriods are imported lazily
let _updateGreatFallsUI = null;
let _updateForecastPeriods = null;

export function setUpdateGreatFallsUI(fn) { _updateGreatFallsUI = fn; }
export function setUpdateForecastPeriods(fn) { _updateForecastPeriods = fn; }

// ==================== PoR HISTORY MANAGEMENT ====================

export function loadPoRHistory() {
    try {
        const stored = localStorage.getItem(POR_HISTORY_KEY);
        if (stored) {
            let parsed = JSON.parse(stored);
            const cutoff = Date.now() - POR_HISTORY_MAX_AGE;
            parsed = parsed.filter(entry => entry.timestamp > cutoff);
            setPorHistory(parsed);
            console.log(`📊 Loaded ${porHistory.length} PoR history entries from localStorage`);
        }
    } catch (e) {
        console.warn('Failed to load PoR history:', e);
        setPorHistory([]);
    }

    fetchServerPoRHistory();
}

export async function fetchServerPoRHistory() {
    try {
        const response = await fetch(SYNC_API + '?endpoint=por-history');
        if (!response.ok) return;

        const result = await response.json();
        const serverReadings = result.readings || [];
        if (serverReadings.length === 0) return;

        const cutoff = Date.now() - POR_HISTORY_MAX_AGE;
        const DEDUP_WINDOW = 5 * 60 * 1000;

        const validServerReadings = serverReadings.filter(r => r.timestamp > cutoff);

        const countBefore = porHistory.length;

        let newFromServer = 0;
        let healed = 0;
        for (const serverEntry of validServerReadings) {
            const nearby = porHistory.find(
                local => Math.abs(local.timestamp - serverEntry.timestamp) < DEDUP_WINDOW
            );
            if (nearby) {
                // Self-heal: the server feed is authoritative and clean, so overwrite a
                // drifted/glitch local value in place. Aligning the timestamp to the
                // server's makes repeat fetches idempotent (next fetch is a no-op).
                // Local-only points between hourly cron samples are left untouched.
                if (nearby.cfs !== serverEntry.cfs) {
                    nearby.cfs = serverEntry.cfs;
                    nearby.stage = serverEntry.stage ?? nearby.stage;
                    nearby.timestamp = serverEntry.timestamp;
                    healed++;
                }
            } else {
                porHistory.push({
                    timestamp: serverEntry.timestamp,
                    cfs: serverEntry.cfs,
                    stage: serverEntry.stage || null
                });
                newFromServer++;
            }
        }

        if (newFromServer > 0 || healed > 0) {
            porHistory.sort((a, b) => a.timestamp - b.timestamp);
            setPorHistory(porHistory.filter(entry => entry.timestamp > cutoff));
            savePoRHistory();
            console.log(`📊 Merged ${newFromServer} new + healed ${healed} server PoR history entries, total: ${porHistory.length}`);

            const expanded = countBefore < 4 && porHistory.length >= 4;
            if (gfDataReady && (expanded || healed > 0) && _updateGreatFallsUI) {
                console.log(`📊 PoR history updated (expanded=${expanded}, healed=${healed}) — re-running GF estimation`);
                _updateGreatFallsUI();
            }
        }
    } catch (e) {
        console.warn('Failed to fetch server PoR history (non-fatal):', e);
    }
}

export function savePoRHistory() {
    try {
        localStorage.setItem(POR_HISTORY_KEY, JSON.stringify(porHistory));
    } catch (e) {
        console.warn('Failed to save PoR history:', e);
    }
}

export function recordPoRReading(cfs, stage) {
    // Reject ONLY physically-impossible values (mirrors backfillPoRHistory in
    // fetch.js). Plausible river flows are never dropped — robustness against
    // spikes is handled at read time (getPoRRiseRate / getPoRFromHoursAgo).
    if (!cfs || cfs <= 0 || cfs > 500000) return;

    const now = Date.now();

    // Rate-limit to one entry per ~10 min, but REPLACE the existing slot with the
    // fresh value instead of dropping the new reading — the freshest clean reading
    // must always win, otherwise a stale entry could persist as the latest point.
    const recentEntry = porHistory.find(e => (now - e.timestamp) < 10 * 60 * 1000 && (now - e.timestamp) >= 0);
    if (recentEntry) {
        recentEntry.cfs = cfs;
        recentEntry.stage = stage || null;
        recentEntry.timestamp = now;
    } else {
        porHistory.push({
            timestamp: now,
            cfs: cfs,
            stage: stage || null
        });
    }

    // Keep timestamp-sorted: getPoRRiseRate/getPoRFromHoursAgo and the [0]/[-1]
    // diagnostics rely on ascending order, which a bare push would not guarantee
    // once out-of-order server entries have been merged in.
    porHistory.sort((a, b) => a.timestamp - b.timestamp);

    const cutoff = now - POR_HISTORY_MAX_AGE;
    setPorHistory(porHistory.filter(entry => entry.timestamp > cutoff));

    savePoRHistory();
    console.log(`📊 Recorded PoR: ${cfs} cfs, history has ${porHistory.length} entries`);
}

// ==================== GF ESTIMATE HISTORY MANAGEMENT ====================

export function loadGFHistory() {
    try {
        const stored = localStorage.getItem(GF_HISTORY_KEY);
        if (stored) {
            let parsed = JSON.parse(stored);
            const cutoff = Date.now() - GF_HISTORY_MAX_AGE;
            parsed = parsed.filter(entry => entry.timestamp > cutoff);
            setGfHistory(parsed);
            console.log(`📈 Loaded ${gfHistory.length} GF history entries from localStorage`);
        }
    } catch (e) {
        console.warn('Failed to load GF history:', e);
        setGfHistory([]);
    }

    fetchServerGFHistory();
}

export async function fetchServerGFHistory() {
    try {
        const response = await fetch(SYNC_API + '?endpoint=gf-history');
        if (!response.ok) return;

        const result = await response.json();
        const serverReadings = result.readings || [];
        if (serverReadings.length === 0) return;

        const cutoff = Date.now() - GF_HISTORY_MAX_AGE;
        const DEDUP_WINDOW = 5 * 60 * 1000;

        const validServerReadings = serverReadings.filter(r => r.timestamp > cutoff);

        let newFromServer = 0;
        let healed = 0;
        for (const serverEntry of validServerReadings) {
            const nearby = gfHistory.find(
                local => Math.abs(local.timestamp - serverEntry.timestamp) < DEDUP_WINDOW
            );
            if (nearby) {
                // Server feed is authoritative & clean — heal drifted/glitch local
                // values in place (idempotent via timestamp alignment).
                if (nearby.cfs !== serverEntry.cfs) {
                    nearby.cfs = serverEntry.cfs;
                    nearby.stage = serverEntry.stage ?? nearby.stage;
                    nearby.timestamp = serverEntry.timestamp;
                    healed++;
                }
            } else {
                gfHistory.push({
                    timestamp: serverEntry.timestamp,
                    cfs: serverEntry.cfs,
                    stage: serverEntry.stage
                });
                newFromServer++;
            }
        }

        if (newFromServer > 0 || healed > 0) {
            gfHistory.sort((a, b) => a.timestamp - b.timestamp);
            setGfHistory(gfHistory.filter(entry => entry.timestamp > cutoff));
            saveGFHistory();
            console.log(`📈 Merged ${newFromServer} new + healed ${healed} server GF history entries, total: ${gfHistory.length}`);

            if (gfEstimate && _updateForecastPeriods) {
                _updateForecastPeriods(gfEstimate);
            }
        }
    } catch (e) {
        console.warn('Failed to fetch server GF history (non-fatal):', e);
    }
}

export function saveGFHistory() {
    try {
        localStorage.setItem(GF_HISTORY_KEY, JSON.stringify(gfHistory));
    } catch (e) {
        console.warn('Failed to save GF history:', e);
    }
}

export function recordGFEstimate(cfs, stage) {
    if (!cfs || cfs <= 0 || cfs > 500000) return;
    const now = Date.now();
    // Replace the same-slot entry with the fresh estimate rather than dropping it.
    const recentEntry = gfHistory.find(e => (now - e.timestamp) < 10 * 60 * 1000 && (now - e.timestamp) >= 0);
    if (recentEntry) {
        recentEntry.cfs = cfs;
        recentEntry.stage = stage || null;
        recentEntry.timestamp = now;
    } else {
        gfHistory.push({ timestamp: now, cfs: cfs, stage: stage || null });
    }
    gfHistory.sort((a, b) => a.timestamp - b.timestamp);
    const cutoff = now - GF_HISTORY_MAX_AGE;
    setGfHistory(gfHistory.filter(entry => entry.timestamp > cutoff));
    saveGFHistory();
    console.log(`📈 Recorded GF estimate: ${cfs} cfs, history has ${gfHistory.length} entries`);
}
