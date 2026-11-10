// Potomac Pulse - app version reader (v39.5). The version lives in <meta name="app-version">,
// not in the page title. Takes a document so it can be tested without a browser.
export function readAppVersion(doc) {
    return doc?.querySelector?.('meta[name="app-version"]')?.content || 'unknown';
}
