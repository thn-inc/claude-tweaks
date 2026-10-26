'use strict';
const fs = require('node:fs');

function readEventsKinds(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    // Missing or unreadable (TOCTOU with a concurrent archive/prune) — see
    // tsv-reader.js's readTsv for the identical rationale.
    return null;
  }
  const counts = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!parsed || typeof parsed.type !== 'string') continue;
    // #4186: a test:true denial is the test suite exercising the hook's deny
    // logic, not operator friction — the same rule bin/friction-events.js's
    // readEvents applies (#1337, widened #2282).
    if ((parsed.type === 'gate-denial' || parsed.type === 'wd-guard-refusal') && parsed.test === true) continue;
    counts[parsed.type] = (counts[parsed.type] || 0) + 1;
  }
  return { counts };
}

module.exports = { readEventsKinds };
