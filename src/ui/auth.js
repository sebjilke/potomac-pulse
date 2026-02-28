// Potomac Pulse — PIN protection for Learning tab
// Extracted from index.html inline script

import { updateGFBinStats } from '../ui/learning-ui.js';

// ==================== PIN PROTECTION ====================
const LEARN_PIN_HASH = "e97776493f213d50b346f81e3f93a78aad1fd0f19c051a38bd8f88b43e46e5b5";

export async function hashPIN(pin) {
    const encoder = new TextEncoder();
    const pinData = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', pinData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkLearnAccess() {
    const pin = document.getElementById('learnPIN').value;
    const hash = await hashPIN(pin);

    if (hash === LEARN_PIN_HASH) {
        document.getElementById('learnLocked').style.display = 'none';
        document.getElementById('learnUnlocked').style.display = 'block';
        document.getElementById('pinError').style.display = 'none';
        document.getElementById('learnTab').textContent = '🧠 Learning';
        sessionStorage.setItem('learnUnlocked', 'true');
        updateGFBinStats();
    } else {
        document.getElementById('pinError').style.display = 'block';
        document.getElementById('learnPIN').value = '';
    }
}

export function lockLearning() {
    document.getElementById('learnLocked').style.display = 'block';
    document.getElementById('learnUnlocked').style.display = 'none';
    document.getElementById('learnTab').textContent = '🔒 Learning';
    document.getElementById('learnPIN').value = '';
    sessionStorage.removeItem('learnUnlocked');
}

// ==================== AUTO-UNLOCK & KEY BINDING ====================

export function initAuth() {
    // Check if already unlocked in this session
    if (sessionStorage.getItem('learnUnlocked') === 'true') {
        document.getElementById('learnLocked').style.display = 'none';
        document.getElementById('learnUnlocked').style.display = 'block';
        document.getElementById('learnTab').textContent = '🧠 Learning';
        updateGFBinStats();
    }

    // Allow Enter key to submit PIN
    document.getElementById('learnPIN')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') checkLearnAccess();
    });

    // Bind unlock button
    document.getElementById('learnUnlockBtn')?.addEventListener('click', checkLearnAccess);
}
