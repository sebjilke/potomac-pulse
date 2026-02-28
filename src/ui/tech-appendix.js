// Potomac Pulse — Technical Appendix download
// Extracted from index.html inline script

import techAppendixContent from '../assets/tech-appendix.md?raw';

export function downloadTechAppendix() {
    // Download as Markdown file
    const blob = new Blob([techAppendixContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Potomac_Pulse_Technical_Appendix.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
