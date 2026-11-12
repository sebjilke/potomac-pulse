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
// v39.8: one line inside the single notice box (src/ui/estimate-notice.js); the closing sentence is shared there.
export const RESIDUAL_LEAD = 'Recent estimates ran low:';
export const RESIDUAL_TEXT =
    'they came in well below what Little Falls later measured. That often means rain-swollen local ' +
    'streams are adding water the upstream gauges cannot see. The current number may be low too.';
export const RESIDUAL_LINE = RESIDUAL_LEAD + ' ' + RESIDUAL_TEXT;
