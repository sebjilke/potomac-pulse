#!/usr/bin/env node
// One-time recovery script: reconstruct correction bins from validated predictions
// Run AFTER the Supabase root cause is fixed (RLS policy / unique constraint)
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/recover-bins.js
//   --dry-run   Show what would be written without writing (default)
//   --apply     Actually write recovered bins to Supabase
//   --cleanup   Also expire the stuck pending prediction from Feb 27

const { createClient } = require('@supabase/supabase-js');
const { getFlowBin } = require('../netlify/functions/shared/model');

const DRY_RUN = !process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const EMA_ALPHA = 0.3;

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
        console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables');
        process.exit(1);
    }

    const client = createClient(url, key);
    console.log(DRY_RUN ? '🔍 DRY RUN (use --apply to write)' : '⚡ APPLYING changes to Supabase');

    // Step 1: Fetch all validated predictions (they have errorCFS, flowBin, flowState)
    const { data: validated, error: fetchErr } = await client
        .from('potomac_observations')
        .select('id, data, created_at')
        .eq('observation_type', 'gf_prediction')
        .in('gauge_id', ['validated', 'soft_flagged'])
        .order('created_at', { ascending: true });

    if (fetchErr) {
        console.error('Failed to fetch validated predictions:', fetchErr.message);
        process.exit(1);
    }

    console.log(`Found ${validated?.length || 0} validated/soft_flagged predictions`);
    if (!validated?.length) {
        console.log('Nothing to recover');
        return;
    }

    // Step 2: Reconstruct bins from validated predictions
    const bins = {};
    let skipped = 0;

    for (const pred of validated) {
        const d = pred.data;
        if (d.errorCFS === undefined || d.errorCFS === null || !d.flowBin || d.skipLearning || d.isHardFlagged) {
            skipped++;
            continue;
        }

        const flowState = d.flowState || 'steady';
        const binKey = `${d.flowBin}_${flowState}`;
        const errorCFS = d.errorCFS;

        if (!bins[binKey]) {
            bins[binKey] = { count: 0, sumError: 0, sumErrorSq: 0, meanError: 0, emaMeanError: 0 };
        }

        const bin = bins[binKey];
        bin.count += 1;
        bin.sumError += errorCFS;
        bin.sumErrorSq += errorCFS * errorCFS;
        bin.meanError = bin.sumError / bin.count;

        if (bin.count === 1) {
            bin.emaMeanError = errorCFS;
        } else {
            bin.emaMeanError = EMA_ALPHA * errorCFS + (1 - EMA_ALPHA) * bin.emaMeanError;
        }
    }

    console.log(`Reconstructed ${Object.keys(bins).length} bins from ${validated.length - skipped} observations (${skipped} skipped)`);

    for (const [key, data] of Object.entries(bins)) {
        console.log(`  ${key}: n=${data.count}, mean=${data.meanError.toFixed(0)}, ema=${data.emaMeanError.toFixed(0)}`);
    }

    // Step 3: Write bins to Supabase
    if (!DRY_RUN) {
        let successes = 0;
        let failures = 0;

        for (const [binKey, binData] of Object.entries(bins)) {
            const { error: upsertErr } = await client.from('potomac_observations').upsert({
                observation_type: 'gf_correction_bin',
                gauge_id: binKey,
                data: binData
            }, { onConflict: 'observation_type,gauge_id' });

            if (upsertErr) {
                console.error(`❌ Bin upsert FAILED for ${binKey}:`, upsertErr.message, upsertErr.code);
                failures++;
            } else {
                console.log(`✅ Wrote bin ${binKey}`);
                successes++;
            }
        }

        console.log(`\nResults: ${successes} written, ${failures} failed`);

        if (failures > 0) {
            console.error('\n⚠️  Some writes failed — the Supabase root cause may not be fixed yet.');
            console.error('Check: unique constraint on (observation_type, gauge_id), RLS INSERT policy.');
        }
    }

    // Step 4: Clean up stuck pending prediction
    if (CLEANUP) {
        const { data: pending, error: pendErr } = await client
            .from('potomac_observations')
            .select('id, data, created_at')
            .eq('observation_type', 'gf_prediction')
            .eq('gauge_id', 'pending');

        if (pendErr) {
            console.error('Failed to fetch pending predictions:', pendErr.message);
        } else if (pending?.length) {
            console.log(`\nFound ${pending.length} stuck pending prediction(s):`);
            for (const p of pending) {
                const age = (Date.now() - new Date(p.created_at).getTime()) / 3600000;
                console.log(`  id=${p.id}, age=${age.toFixed(1)}h, predicted=${p.data.predictedCFS}cfs`);

                if (!DRY_RUN) {
                    const { error: expireErr } = await client.from('potomac_observations').update({
                        gauge_id: 'expired',
                        data: { ...p.data, expiredAt: new Date().toISOString(), reason: 'manual_recovery_cleanup' }
                    }).eq('id', p.id);

                    if (expireErr) {
                        console.error(`  ❌ Expire FAILED for ${p.id}:`, expireErr.message);
                    } else {
                        console.log(`  ✅ Expired ${p.id}`);
                    }
                }
            }
        } else {
            console.log('\nNo stuck pending predictions found');
        }
    }

    // Step 5: Show current metadata health
    const { data: meta } = await client
        .from('potomac_observations')
        .select('data')
        .eq('observation_type', 'gf_metadata')
        .eq('gauge_id', 'system')
        .single();

    if (meta?.data) {
        const m = meta.data;
        console.log('\n📊 Current metadata:');
        console.log(`  totalValidations: ${m.totalValidations}`);
        console.log(`  totalPredictions: ${m.totalPredictions}`);
        console.log(`  binWriteSuccesses: ${m.binWriteSuccesses ?? 'N/A'}`);
        console.log(`  binWriteFailures: ${m.binWriteFailures ?? 'N/A'}`);
        console.log(`  lastBinError: ${m.lastBinError ?? 'none'}`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
