// USGS payload builders for the v39.6 (A5, A8) tests. Not a test file: the `npm test` globs only pick
// up *.test.js and *.test.mjs. A copy of the builders in test/prediction-logging-handler.test.js (which does
// not export them), extended with an Edwards Ferry stage series and a Difficult Run payload.

const iso = (ms) => new Date(ms).toISOString();

const ts = (site, param, vals) => ({
    sourceInfo: { siteCode: [{ value: site }] },
    variable: { variableCode: [{ value: param }] },
    values: [{ value: vals }],
});
// NOTE: the MAIN payload keeps the object qualifier form {qualifierCode} because the pre-existing
// fetchUSGSData reads that form (it does not match the real feed, see TODO.md; fixing it would change
// the estimate's ice handling and needs the owner). Only the Difficult Run payload uses real strings.
const one = (nowMs, v, ageMin = 10, quals = []) =>
    [{ value: String(v), dateTime: iso(nowMs - ageMin * 60000), qualifiers: quals.map(q => ({ qualifierCode: q })) }];

// efVals: optional array of stage values, oldest first, 15 minutes apart, the newest `efAgeMin` old.
function usgsPayload(nowMs, { lfQ = 11000, lfIce = false, noLF = false, porQ = 10000, efVals = null, efAgeMin = 20 } = {}) {
    const porHist = [];
    for (let k = 48 * 4; k >= 0; k--) porHist.push({ value: String(porQ), dateTime: iso(nowMs - k * 15 * 60000), qualifiers: [] });
    const efSeries = efVals
        ? efVals.map((v, i) => ({ value: String(v), dateTime: iso(nowMs - (efAgeMin + (efVals.length - 1 - i) * 15) * 60000), qualifiers: [] }))
        : one(nowMs, 4.0, 20);
    const series = [
        ts('01638500', '00060', porHist),
        ts('01638500', '00065', one(nowMs, 5.1)),
        ts('01646500', '00065', one(nowMs, 3.85, 12)),
        ts('01643000', '00060', one(nowMs, 800)),
        ts('01644000', '00060', one(nowMs, 350)),
        ts('01645000', '00060', one(nowMs, 100)),
        ts('01644148', '00065', efSeries),
    ];
    if (!noLF) series.push(ts('01646500', '00060', one(nowMs, lfQ, 15, lfIce ? ['Ice'] : [])));
    return { value: { timeSeries: series } };
}

const tempPayload = (nowMs) => ({ value: { timeSeries: [{ values: [{ value: [{ value: '12.5', dateTime: iso(nowMs - 5 * 60000) }] }] }] } });

// Qualifiers are plain strings, as the real USGS feed gives them; objectQuals builds the {qualifierCode} form.
// Difficult Run: n readings 15 minutes apart, the newest `ageMin` old. vals overrides the numbers (oldest first).
function drPayload(nowMs, { vals = null, n = 24, base = 13, ageMin = 60, quals = ['P'], site = '01646000', param = '00060', offset = null, objectQuals = false } = {}) {
    const v = vals || Array.from({ length: n }, (_, i) => base + i * 0.1);
    const pts = v.map((x, i) => {
        const t = nowMs - (ageMin + (v.length - 1 - i) * 15) * 60000;
        return { value: String(x), dateTime: offset ? offsetIso(t, offset) : iso(t), qualifiers: objectQuals ? quals.map(q => ({ qualifierCode: q })) : quals };
    });
    return { value: { timeSeries: [ts(site, param, pts)] } };
}
// ISO string with a fixed offset like -05:00, as USGS writes it.
function offsetIso(ms, off) {
    const sign = off[0] === '-' ? -1 : 1;
    const [hh, mm] = off.slice(1).split(':').map(Number);
    const shifted = new Date(ms + sign * (hh * 60 + mm) * 60000).toISOString().replace('Z', '');
    return shifted + off;
}

module.exports = { iso, ts, one, usgsPayload, tempPayload, drPayload, offsetIso };
