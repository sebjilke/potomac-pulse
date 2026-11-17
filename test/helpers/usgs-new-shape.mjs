// Test helper (not a test file: the npm test globs only pick up *.test.js and *.test.mjs).
// Turns an old-structure USGS body (the shape the app's parsers read) into the new service's
// FeatureCollection, so tests can stub the app's direct stage (api.waterdata.usgs.gov) with bodies that
// go through the real browser adapter. `param` keeps one parameter only (the app asks for `main` as two
// parallel calls, one per parameter). requestDT becomes the new service's `timeStamp`.

export function toNewShape(old, { param = null, timeStamp } = {}) {
    const note = old?.value?.queryInfo?.note?.find((n) => n && n.title === 'requestDT');
    const features = [];
    for (const ts of old.value.timeSeries) {
        const site = ts.sourceInfo.siteCode[0].value;
        const p = ts.variable.variableCode[0].value;
        if (param && p !== param) continue;
        for (const v of ts.values[0].value) {
            features.push({
                type: 'Feature',
                properties: {
                    monitoring_location_id: `USGS-${site}`, parameter_code: p, statistic_id: '00011',
                    time: v.dateTime, value: v.value, approval_status: 'Provisional', qualifier: null,
                    last_modified: v.dateTime, time_series_id: `ts-${site}-${p}`
                }
            });
        }
    }
    return { type: 'FeatureCollection', features, links: [], timeStamp: timeStamp !== undefined ? timeStamp : note?.value };
}

/** The parameter code in a new-service request address (main is asked one parameter per call). */
export const paramOf = (url) => /[?&]parameter_code=(\d{5})(?:&|$)/.exec(String(url))?.[1] ?? null;
