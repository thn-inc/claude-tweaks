// bin/lib/log-decision/timing-skip.js — the one "timing at close" SKIP line writer (#5555).
// Requires only ./append, so a closing path whose lib/timing/at-close.js failed to load
// can still log its SKIP through it; at-close.js's logTimingSkip delegates here too.
'use strict';
const fs = require('fs');
const { appendEntry, formatEntry } = require('./append');

// err -> its message, else String(err) — never `undefined`.
const errText = (err) => (err && err.message ? err.message : String(err));

// One SKIP line under decisions.md's /wrap-up section. A runDir that is not a
// directory gets none (appendEntry's lock would otherwise create it). Never throws.
function logTimingSkip(runDir, text) {
  try {
    if (!fs.lstatSync(runDir).isDirectory()) return;
    appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'SKIP', now: Date.now(), step: 'timing at close', text }) });
  } catch { /* a failed trace line never fails the close */ }
}

// The fallback SKIP for a closing path's own catch: `condition: {what} ({err}) → fallback: no timing.json written`.
function logTimingFailure(runDir, what, err) {
  logTimingSkip(runDir, `condition: ${what} (${errText(err)}) → fallback: no timing.json written`);
}

module.exports = { logTimingSkip, logTimingFailure, errText };
