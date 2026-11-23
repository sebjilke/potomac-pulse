'use strict';
// Minimal RFC-4180 CSV reader (quotes, embedded commas and newlines). Returns array of objects keyed by header.
const fs = require('fs');
function parse(text) {
    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (inQ) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
            field += c; i++; continue;
        }
        if (c === '"') { inQ = true; i++; continue; }
        if (c === ',') { row.push(field); field = ''; i++; continue; }
        if (c === '\r') { i++; continue; }
        if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
        field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}
function readObjects(file) {
    const rows = parse(fs.readFileSync(file, 'utf8'));
    const head = rows[0];
    const out = [];
    for (let r = 1; r < rows.length; r++) {
        if (rows[r].length === 1 && rows[r][0] === '') continue;
        const o = {};
        for (let c = 0; c < head.length; c++) o[head[c]] = rows[r][c] === undefined ? '' : rows[r][c];
        out.push(o);
    }
    return out;
}
function esc(v) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
}
function writeObjects(file, cols, rows) {
    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(','));
    fs.writeFileSync(file, lines.join('\n') + '\n');
}
module.exports = { parse, readObjects, writeObjects, esc };
