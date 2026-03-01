// Potomac Pulse — About tooltip + Easter eggs
// Extracted from index.html inline script

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

    // ==================== EASTER EGGS ====================
    // Toby Woby easter egg - hover to preview, double-click to activate
    const tobyEgg = document.getElementById('toby-egg');
    if (tobyEgg) {
        const originalText = tobyEgg.textContent;
        let isActivated = false;

        // Hover: show preview
        tobyEgg.addEventListener('mouseenter', () => {
            if (!isActivated) {
                tobyEgg.textContent = "Toby Woby is working on it...";
                tobyEgg.style.color = "var(--accent-amber)";
            }
        });

        tobyEgg.addEventListener('mouseleave', () => {
            if (!isActivated) {
                tobyEgg.textContent = originalText;
                tobyEgg.style.color = "";
            }
        });

        // Double-click: activate permanently
        tobyEgg.addEventListener('dblclick', () => {
            isActivated = true;
            tobyEgg.textContent = "🐕 Toby Woby is STILL working on it";
            tobyEgg.style.color = "var(--accent-amber)";
            tobyEgg.title = "Legend has it, Toby has been 'working on it' since 2019...";
        });
    }
}
