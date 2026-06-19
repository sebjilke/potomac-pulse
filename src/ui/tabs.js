// Potomac Pulse — Tab switching and keyboard navigation
// Extracted from index.html inline script

import { updateMapVisibility } from '../ui/map.js';

// ==================== TAB SWITCHING ====================

/**
 * Activates the given tab and its associated panel, updating ARIA state and map visibility.
 * @param {HTMLElement} tab - The tab element to activate; its dataset.tab identifies the panel.
 */
export function activateTab(tab) {
    const allTabs = document.querySelectorAll(".tab");
    const allPanels = document.querySelectorAll(".tab-content");
    allTabs.forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
        t.setAttribute("tabindex", "-1");
    });
    allPanels.forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    tab.setAttribute("tabindex", "0");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    updateMapVisibility(tab.dataset.tab);
}

// ==================== TAB EVENT SETUP ====================

/**
 * Wires up tab click handlers and WAI-ARIA keyboard navigation, then sets the initial map visibility.
 */
export function initTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => activateTab(tab));
    });

    // Keyboard arrow navigation for tabs (WAI-ARIA Tabs pattern)
    document.querySelector('.tabs')?.addEventListener('keydown', e => {
        const tabs = Array.from(document.querySelectorAll('.tab'));
        const current = tabs.indexOf(document.activeElement);
        if (current === -1) return;
        let target;
        switch (e.key) {
            case 'ArrowRight': target = tabs[(current + 1) % tabs.length]; break;
            case 'ArrowLeft':  target = tabs[(current - 1 + tabs.length) % tabs.length]; break;
            case 'Home':       target = tabs[0]; break;
            case 'End':        target = tabs[tabs.length - 1]; break;
            case 'Enter':
            case ' ':          e.preventDefault(); activateTab(tabs[current]); return;
            default: return;
        }
        e.preventDefault();
        target.focus();
        activateTab(target);
    });

    // Initialize map visibility (map hidden by default since Great Falls is now default tab)
    updateMapVisibility('greatfalls');
}
