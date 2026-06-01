import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    medianCfs, medianOfRecord,
    robustCurrentReading, robustPastReading,
    selectHistoricReading, dropLocalSpikes
} from '../src/estimation/rise-rate-robust.mjs';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

// Build an ascending-by-timestamp PoR-style history: cfsFn(hoursAgo) -> cfs.
// `now` is fixed so tests are deterministic.
function makeHistory(now, hoursAgoList, cfsFn) {
    return hoursAgoList
        .map(h => ({ timestamp: now - h * HOUR, cfs: cfsFn(h), stage: null }))
        .sort((a, b) => a.timestamp - b.timestamp);
}

// Reproduces the production flow-state decision from a current/past pair.
function flowStateFrom(current, past) {
    if (!current || !past) return null;
    const hoursDiff = (current.timestamp - past.timestamp) / HOUR;
    if (!(hoursDiff >= 3 && hoursDiff <= 9)) return null;
    const changeCFS = current.cfs - past.cfs;
    const threshold = Math.max(100, current.cfs * 0.02);
    if (Math.abs(changeCFS) < threshold) return 'steady';
    return changeCFS > 0 ? 'rising' : 'falling';
}

describe('medianCfs / medianOfRecord', () => {
    it('medianCfs handles odd and even counts', () => {
        assert.equal(medianCfs([{ cfs: 10 }, { cfs: 30 }, { cfs: 20 }]), 20);
        assert.equal(medianCfs([{ cfs: 10 }, { cfs: 20 }, { cfs: 30 }, { cfs: 40 }]), 25);
        assert.equal(medianCfs([]), null);
    });

    it('medianOfRecord returns a REAL entry (consistent cfs+timestamp), newer on ties', () => {
        const e = medianOfRecord([
            { cfs: 100, timestamp: 1 },
            { cfs: 300, timestamp: 2 },
            { cfs: 200, timestamp: 3 },
        ]);
        assert.equal(e.cfs, 200);
        assert.equal(e.timestamp, 3); // its own timestamp, not synthesized

        // even count → newer of the two central records
        const ev = medianOfRecord([
            { cfs: 100, timestamp: 10 },
            { cfs: 200, timestamp: 20 },
            { cfs: 300, timestamp: 30 },
            { cfs: 400, timestamp: 40 },
        ]);
        assert.ok(ev.cfs === 200 || ev.cfs === 300);
    });
});

describe('getPoRRiseRate core: stale/glitch last-entry must NOT flip to rising', () => {
    it('clean falling series → falling, even with an out-of-order stale-high last element', () => {
        const now = 1_000_000_000_000;
        // Falling 22k→16k over 6h, dense (~10 min cadence) for a solid window.
        const hoursAgo = [];
        for (let m = 0; m <= 6 * 60; m += 10) hoursAgo.push(m / 60);
        const hist = makeHistory(now, hoursAgo, h => 16000 + Math.round((6 - h) / 6 * 6000) * 0 + Math.round(h * 1000));
        // (cfs increases with hoursAgo → newest is lowest = falling)

        // Inject a stale-high glitch that is physically the LAST array element
        // (simulating an out-of-order localStorage entry) but timestamped ~90 min ago.
        hist.push({ timestamp: now - 90 * MIN, cfs: 30000, stage: null });

        const current = robustCurrentReading(hist, now);
        const past = robustPastReading(hist, now, current.timestamp);
        assert.equal(flowStateFrom(current, past), 'falling');
        // The glitch (30000) must not be the chosen current value.
        assert.ok(current.cfs < 20000, `current ${current.cfs} should ignore the 30k spike`);
    });

    it('single isolated spike amid flat data → steady (spike outvoted, not dropped)', () => {
        const now = 2_000_000_000_000;
        const hoursAgo = [];
        for (let m = 0; m <= 7 * 60; m += 10) hoursAgo.push(m / 60);
        const hist = makeHistory(now, hoursAgo, () => 16000);
        // one glitch 8 min ago
        const glitch = hist.find(e => Math.abs((now - e.timestamp) - 8 * MIN) < 6 * MIN);
        if (glitch) glitch.cfs = 40000;
        const current = robustCurrentReading(hist, now);
        const past = robustPastReading(hist, now, current.timestamp);
        assert.equal(current.cfs, 16000);
        assert.equal(flowStateFrom(current, past), 'steady');
    });
});

describe('getPoRRiseRate core: genuine sustained rise is preserved', () => {
    it('clean rising series → rising', () => {
        const now = 3_000_000_000_000;
        const hoursAgo = [];
        for (let m = 0; m <= 7 * 60; m += 10) hoursAgo.push(m / 60);
        // rising: older = lower, newest = highest. +20% over 6h.
        const hist = makeHistory(now, hoursAgo, h => Math.round(20000 - h * 600));
        const current = robustCurrentReading(hist, now);
        const past = robustPastReading(hist, now, current.timestamp);
        assert.ok(current.cfs > past.cfs, 'current should exceed past on a rise');
        assert.equal(flowStateFrom(current, past), 'rising');
    });
});

describe('robustCurrentReading sparse fallback', () => {
    it('fewer than 3 points in the trailing window → null (caller defers to NWS)', () => {
        const now = 4_000_000_000_000;
        // Only 2 recent points within 90 min.
        const hist = [
            { timestamp: now - 80 * MIN, cfs: 16000 },
            { timestamp: now - 20 * MIN, cfs: 16100 },
            { timestamp: now - 5 * HOUR, cfs: 18000 },
            { timestamp: now - 6 * HOUR, cfs: 19000 },
        ].sort((a, b) => a.timestamp - b.timestamp);
        assert.equal(robustCurrentReading(hist, now), null);
    });

    it('future-dated entries (clock skew) are excluded from the window', () => {
        const now = 4_100_000_000_000;
        const hist = [
            { timestamp: now + 30 * MIN, cfs: 99000 }, // future glitch
            { timestamp: now - 10 * MIN, cfs: 16000 },
            { timestamp: now - 30 * MIN, cfs: 16050 },
            { timestamp: now - 60 * MIN, cfs: 16100 },
        ];
        const cur = robustCurrentReading(hist, now);
        assert.ok(cur && cur.cfs < 20000, 'future-dated spike must be excluded');
    });
});

describe('selectHistoricReading (getPoRFromHoursAgo core)', () => {
    it('returns a single real entry intact (no value smear / limb bias)', () => {
        const now = 5_000_000_000_000;
        const target = now - 21 * HOUR;
        // rising limb around the target; entries every 15 min in the ±1h window
        const hist = [];
        for (let m = -60; m <= 60; m += 15) {
            hist.push({ timestamp: target + m * MIN, cfs: 22000 + m * 5, stage: 4.9 });
        }
        const pick = selectHistoricReading(hist, target);
        // chosen entry's cfs must equal one of the real entries (not an average)
        assert.ok(hist.some(e => e.timestamp === pick.timestamp && e.cfs === pick.cfs));
        // and it should be the closest-to-target entry
        assert.equal(pick.timestamp, target);
    });

    it('drops a lone glitch in the window but keeps a real close entry', () => {
        const now = 5_100_000_000_000;
        const target = now - 21 * HOUR;
        const hist = [
            { timestamp: target - 30 * MIN, cfs: 22000 },
            { timestamp: target - 5 * MIN, cfs: 60000 },  // glitch, closest to target
            { timestamp: target + 20 * MIN, cfs: 22100 },
            { timestamp: target + 40 * MIN, cfs: 22050 },
        ];
        const pick = selectHistoricReading(hist, target);
        assert.ok(pick.cfs < 30000, `glitch 60k should be rejected, got ${pick.cfs}`);
    });

    it('returns null when nothing is within the 1h match window', () => {
        const now = 5_200_000_000_000;
        const hist = [{ timestamp: now - 30 * HOUR, cfs: 22000 }];
        assert.equal(selectHistoricReading(hist, now - 21 * HOUR), null);
    });
});

describe('dropLocalSpikes (graph display filter)', () => {
    it('removes an isolated reversal spike but keeps the smooth trend around it', () => {
        const pts = [16000, 15800, 15600, 40000, 15400, 15200, 15000]
            .map((cfs, i) => ({ cfs, hrs: -6 + i }));
        const filtered = dropLocalSpikes(pts, { frac: 0.40, key: 'cfs' });
        assert.ok(!filtered.some(p => p.cfs === 40000), 'spike should be dropped from plot');
        assert.equal(filtered.length, pts.length - 1);
    });

    it('keeps every point of a strong but smooth decline (no false drops)', () => {
        const pts = [22000, 21000, 20000, 19000, 18000, 17000, 16000]
            .map((cfs, i) => ({ cfs, hrs: -6 + i }));
        const filtered = dropLocalSpikes(pts, { frac: 0.40, key: 'cfs' });
        assert.equal(filtered.length, pts.length);
    });

    it('NEVER drops the leading edge of a genuine steep, sparse rise (owner constraint)', () => {
        // Hourly-spaced accelerating surge — every point is part of a monotone run,
        // so none is a local extremum. All must survive the display filter.
        const pts = [16000, 22000, 30000, 40000, 46000]
            .map((cfs, i) => ({ cfs, hrs: -4 + i }));
        const filtered = dropLocalSpikes(pts, { frac: 0.40, key: 'cfs' });
        assert.equal(filtered.length, pts.length, 'no point of a real rise may be dropped');
    });

    it('preserves a sustained level step (not a reversal, so not a spike)', () => {
        const pts = [16000, 16000, 40000, 40000, 40000]
            .map((cfs, i) => ({ cfs, hrs: -4 + i }));
        const filtered = dropLocalSpikes(pts, { frac: 0.40, key: 'cfs' });
        assert.equal(filtered.length, pts.length);
    });

    it('drops a clear reversal spike even in a 3-point series', () => {
        const pts = [{ cfs: 16000 }, { cfs: 40000 }, { cfs: 16000 }];
        const filtered = dropLocalSpikes(pts);
        assert.equal(filtered.length, 2);
        assert.ok(!filtered.some(p => p.cfs === 40000));
    });

    it('keeps both points when fewer than 3 (no two-sided context)', () => {
        const pts = [{ cfs: 16000 }, { cfs: 40000 }];
        assert.equal(dropLocalSpikes(pts).length, 2);
    });
});
