'use strict';
// Loads the production server code of one commit (frozen export under ../code/<ver>/) with the network, the
// database client library and the clock stubbed. Documented stubs only:
//   - '@supabase/supabase-js' is replaced (shared/model.js requires it at load; nothing calls it in the replay)
//   - global fetch is replaced by a stub that serves frozen readings (set by the engine per run)
//   - Date.now is frozen per run by the engine
//   - LOADER SHIM: scheduled-update.js does not export storePoRHistory. The file is read from the frozen export,
//     one line is APPENDED IN MEMORY (`exports._replayShim = { storePoRHistory };`), and the text is compiled as
//     the module. The file on disk and every function body are unchanged.
// Any module that resolves outside the frozen export (the live working tree) is refused.
const path = require('path');
const fs = require('fs');
const Module = require('module');

const CODE_ROOT = path.resolve(__dirname, '..', 'code');
const LIVE = '/Users/sebjilke/Desktop/PotomacPulse';
const STUDY = path.resolve(__dirname, '..');

const origResolve = Module._resolveFilename;
const origLoad = Module._load;
let installed = false;
function install() {
    if (installed) return;
    installed = true;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'HEALTHCHECKS_PING_URL', 'SENTRY_DSN', 'USGS_API_KEY', 'USGS_SOURCE', 'COMMIT_REF']) delete process.env[k];
    Module._resolveFilename = function (request, parent, ...rest) {
        if (request === '@supabase/supabase-js') return '@supabase/supabase-js';
        const r = origResolve.call(this, request, parent, ...rest);
        if (typeof r === 'string' && path.isAbsolute(r) && fs.existsSync(r)) {
            const rp = fs.realpathSync(r);
            if (rp.startsWith(LIVE) && !rp.startsWith(STUDY)) throw new Error('refusing to load ' + rp + ' (live working tree)');
        }
        return r;
    };
    Module._load = function (request, ...rest) {
        if (request === '@supabase/supabase-js') return { createClient: () => { throw new Error('supabase blocked in replay'); } };
        return origLoad.call(this, request, ...rest);
    };
}

const cache = {};
function load(ver) {
    install();
    if (cache[ver]) return cache[ver];
    const dir = path.join(CODE_ROOT, ver, 'netlify', 'functions');
    const file = path.join(dir, 'scheduled-update.js');
    const src = fs.readFileSync(file, 'utf8') + '\nexports._replayShim = { storePoRHistory };\n';
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(dir);
    m._compile(src, file);
    const SU = m.exports;
    const M = require(path.join(dir, 'shared', 'model.js'));
    const OBS = require(path.join(dir, 'shared', 'observations.js'));
    cache[ver] = { SU, T: SU._test, shim: SU._replayShim, M, OBS, dir };
    return cache[ver];
}
module.exports = { load };
