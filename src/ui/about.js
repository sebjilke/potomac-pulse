// Potomac Pulse — About tooltip
// Extracted from index.html inline script

/**
 * Initializes the About tooltip toggle/dismiss behavior.
 */
export function initAbout() {
    // ==================== ABOUT TOOLTIP ====================
    const aboutBtn = document.getElementById('about-btn');
    const aboutTooltip = document.getElementById('about-tooltip');
    aboutBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        aboutTooltip.style.display = aboutTooltip.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
        if (!aboutTooltip?.contains(e.target) && e.target !== aboutBtn) {
            aboutTooltip.style.display = 'none';
        }
    });

}
