// Potomac Pulse — Cloud sync via serverless function
// Extracted from index.html inline script

import { SYNC_API } from '../model/constants.js';
import {
    cloudSyncEnabled, setCloudSyncEnabled,
    lastSyncTime, setLastSyncTime,
    learningData,
    syncPending, setSyncPending,
    syncTimeout, setSyncTimeout
} from '../state/store.js';

// ==================== CLOUD SYNC ====================

export function initCloudSync() {
    // Cloud sync is always attempted via serverless function
    // Will gracefully fallback to localStorage if unavailable
    setCloudSyncEnabled(true);
    console.log('☁️ Cloud sync enabled via serverless function');
    return true;
}

export async function syncToCloud() {
    // Debounce: wait 30 seconds after last change before syncing
    if (syncTimeout) clearTimeout(syncTimeout);

    const timeoutId = setTimeout(async () => {
        if (syncPending) return;
        setSyncPending(true);
        updateSyncStatus('syncing');

        try {
            // Prepare data for sync
            const metadata = {
                startDate: learningData.startDate,
                totalObs: learningData.totalObs
            };

            // Collect recent observations (only new ones)
            const recentObs = [];
            for (const [gaugeId, obs] of Object.entries(learningData.observations)) {
                const recent = obs.slice(-10);
                for (const o of recent) {
                    if (o.timestamp > (lastSyncTime || 0)) {
                        recentObs.push({
                            gauge_id: gaugeId,
                            data: o
                        });
                    }
                }
            }

            // Send to serverless function
            const response = await fetch(SYNC_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metadata,
                    corrections: learningData.corrections,
                    observations: recentObs,
                    lastSyncTime
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            if (result && result.success === false) {
                // C46: the server accepted the request (200) but the write failed — report it
                // honestly and don't advance lastSyncTime, so un-saved data isn't marked synced.
                updateSyncStatus('error');
                console.warn('Cloud sync: server reported failure —', result.error);
            } else {
                setLastSyncTime(Date.now());
                updateSyncStatus('synced');
                console.log(`☁️ Synced to cloud (${result.savedCount} items)`);
            }

        } catch(e) {
            console.log('Cloud sync error:', e);
            updateSyncStatus('error');
        }

        setSyncPending(false);
        setSyncTimeout(null);
    }, 30000); // 30 second debounce

    setSyncTimeout(timeoutId);
}

export function updateSyncStatus(status) {
    const el = document.getElementById('syncStatus');
    if (!el) return;

    const statusConfig = {
        synced: { icon: '☁️', color: 'var(--accent-green)', title: 'Cloud synced' },
        syncing: { icon: '☁️', color: 'var(--accent-amber)', title: 'Syncing...' },
        error: { icon: '⚠️', color: 'var(--accent-red-light)', title: 'Sync error' },
        local: { icon: '💾', color: 'var(--text-muted)', title: 'Local only' }
    };
    const cfg = statusConfig[status] || statusConfig.local;
    el.textContent = cfg.icon;
    el.style.color = cfg.color;
    el.title = cfg.title;
}
