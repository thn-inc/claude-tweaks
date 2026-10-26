// bin/lib/flow/run-mode.js — a run's recorded mode: the `mode:` line of its
// config.yml. One reader for lib/flow/consolidated-pass.js (the console
// re-entry rule) and bin/context-gauge.js (the handoff's resume line).
'use strict';
const fs = require('fs');
const path = require('path');

// runDir -> config.yml's `mode:` value, or null (no config.yml, unreadable, or
// no mode line).
function readRunMode(runDir, { fsImpl = fs } = {}) {
  let text;
  try { text = fsImpl.readFileSync(path.join(runDir, 'config.yml'), 'utf8'); } catch { return null; }
  const m = text.match(/^mode:[ \t]*(\S+)/m);
  return m ? m[1] : null;
}

module.exports = { readRunMode };
