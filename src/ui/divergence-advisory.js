// Potomac Pulse — EF divergence advisory (v37.13, TODO #22)
//
// Display-only honesty signal: when the server's persisted divergence state is active and
// fresh, the GF card downgrades its displayed confidence one notch and shows an advisory
// explaining why the estimate deserves less trust. The v38 ESTIMATOR change failed its
// pre-registered gate (analysis/v38_gate_verdict_2026-07-20.md) — nothing here may feed
// the estimate, the weights, or learning. Server-authoritative: the client computes no
// divergence; it renders `gfLearningData.efDivergence` as shipped by sync-learning.
//
// Module import is side-effect-free (no top-level window/document) so the pure helpers can
// be unit-tested under Node (same pattern as offline-banner.js shouldShowOffline).

import { EF_DIVERGENCE_STALE_MS } from '../model/constants.js';

/**
 * Decides whether the divergence advisory should show: server state active AND fresh
 * (updatedAt within EF_DIVERGENCE_STALE_MS — a stalled cron must fail silent, not stale-loud).
 * @param {{active?: boolean, updatedAt?: string}|null|undefined} efDivergence - Server advisory state from the learning payload.
 * @param {number} [nowMs=Date.now()] - Current epoch ms (injectable for tests).
 * @returns {boolean} True when the advisory (and confidence notch) should render.
 */
export function shouldShowDivergenceAdvisory(efDivergence, nowMs = Date.now()) {
    if (!efDivergence || !efDivergence.active) return false;
    const t = Date.parse(efDivergence.updatedAt || '');
    return Number.isFinite(t) && (nowMs - t) >= 0 && (nowMs - t) <= EF_DIVERGENCE_STALE_MS;
}

/**
 * One-notch display-only confidence downgrade (high→medium, medium→low, low stays low).
 * Stacks intentionally with the estimator's own EF-trend downgrade — different signals.
 * @param {('high'|'medium'|'low'|string)} level - The estimator's confidence level.
 * @returns {('medium'|'low')} The downgraded display level.
 */
export function downgradeConfidence(level) {
    return level === 'high' ? 'medium' : 'low';
}

// The user-facing "why to trust it less" copy. Numbers are from the v38 gate residuals
// (122,976 replayed hours; see the advisory plan §0): divergence-active hours have ~2.4×
// the median error and ~3× the >25%-miss rate, 76% of those big misses under-reads.
// Wording constraint from the gate verdict: the sensors DISAGREE — never claim EF is right.
export const DIVERGENCE_ADVISORY_TITLE =
    '⚠️ Cross-check gauge disagrees — treat this estimate with extra caution.';
export const DIVERGENCE_ADVISORY_BODY =
    'The Edwards Ferry gauge — an independent cross-check just upstream of Great Falls — ' +
    'has been reading well above what the upstream gauges suggest for several hours. ' +
    'Sometimes that’s just gauge noise at low water, but it can mean water is entering ' +
    'the Potomac below those gauges — water this estimate may not fully see. In 15 years ' +
    'of replayed history, hours like this were about 2–3× less accurate than ' +
    'usual, and large misses (>25% off) were three times more likely — mostly ' +
    'under-reads. If the river looks higher than the number, believe the river.';
