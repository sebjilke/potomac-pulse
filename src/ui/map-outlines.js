// Potomac Pulse: lazy map outline loader (v39.7)
// One run-once promise per file. A file that failed is cleared so the next map open retries only that
// file; a file that loaded is never added twice. No Leaflet here: the caller passes the add functions.

/**
 * @param {{fetchFn: Function, files: Array<{url: string, add: Function}>}} d
 * @returns {{ensureOutlines: Function}}
 */
export function createOutlineLoader({ fetchFn, files }) {
    const started = new Map(); // url -> promise
    function loadOne(file) {
        if (started.has(file.url)) return started.get(file.url);
        const p = Promise.resolve()
            .then(() => fetchFn(file.url))
            .then((r) => r.json())
            .then((data) => { file.add(data); })
            .catch((err) => {
                started.delete(file.url); // retry this file only, next time
                console.warn(`Map outline failed to load (${file.url}):`, err);
            });
        started.set(file.url, p);
        return p;
    }
    return { ensureOutlines: () => Promise.all(files.map(loadOne)) };
}
