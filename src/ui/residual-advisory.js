// Potomac Pulse — LF-residual advisory (v37.15)
//
// Second display-only honesty signal, sibling of divergence-advisory.js: the server latches
// when the model's own validated predictions ran badly low against Little Falls (rule R2,
// decision-gated backtest — analysis/lf-residual-advisory-plan-2026-07-23.md §0). LF sits
// below ALL the ungauged PoR→LF inflow, so this catches the below-EF events the EF
// divergence detector is structurally blind to. Nothing here may feed the estimate, the
// weights, or learning. Server-authoritative: the client computes no residuals; it renders
// `gfLearningData.lfResidual` as shipped by sync-learning.
//
// Module import is side-effect-free (no top-level window/document) so the pure helpers can
// be unit-tested under Node (same pattern as divergence-advisory.js).

import { LF_RESIDUAL_STALE_MS } from '../model/constants.js';

/**
 * Decides whether the LF-residual advisory should show: server state active AND fresh
 * (updatedAt within LF_RESIDUAL_STALE_MS — a stalled cron must fail silent, not stale-loud).
 * @param {{active?: boolean, updatedAt?: string}|null|undefined} lfResidual - Server advisory state from the learning payload.
 * @param {number} [nowMs=Date.now()] - Current epoch ms (injectable for tests).
 * @returns {boolean} True when the advisory (and confidence notch) should render.
 */
export function shouldShowResidualAdvisory(lfResidual, nowMs = Date.now()) {
    if (!lfResidual || !lfResidual.active) return false;
    const t = Date.parse(lfResidual.updatedAt || '');
    return Number.isFinite(t) && (nowMs - t) >= 0 && (nowMs - t) <= LF_RESIDUAL_STALE_MS;
}

// The user-facing copy. Evidence behind it (banner-up predictions scored median |err|
// 10.6% vs 1.8% baseline, ~21× the big-miss rate, overwhelmingly under-reads) lives in the
// plan §0 and tech-appendix §5.9 — no stats sentence in the displayed copy, per the user's
// v37.14 direction. Wording notes (plan F7): "Recently" not "past few hours" (a single
// validation can latch and persist up to 12h of signal staleness); "often" not "usually"
// (the backtest measured degradation, not cause). Confidence downgrade reuses
// downgradeConfidence from divergence-advisory.js — stacking with the EF advisory is
// intended (different observables; their coincidence is genuinely stronger evidence).
export const RESIDUAL_ADVISORY_TITLE =
    '⚠️ Recent estimates ran low — treat this one with extra caution.';
export const RESIDUAL_ADVISORY_BODY =
    'Recently, this model’s estimates have come in well below what the downstream ' +
    'check gauge at Little Falls later measured. That often means rain-swollen local ' +
    'streams are adding water the upstream gauges can’t see. The current number may ' +
    'be low too. If the river looks higher than the number, believe the river.';
