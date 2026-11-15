// Process-kill matcher linearity budget (#4548) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// processKillByName runs on every Bash call the pre-tool-use hook sees that names a kill word, so
// a super-linear scan is a session-breaking stall. The pgrep/ps substitution matchers must not
// re-scan the rest of the word from every opener: the quadratic form took 2-3 s on the first two
// shapes below. Lives outside tests/ for the same reason the other perf/ files do: a wall-clock
// assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { processKillByName } = require('../plugin/bin/lib/hooks/git-command');

const BUDGET_MS = 400;

for (const command of [
  'kill ' + '`'.repeat(32000), "kill '" + '$('.repeat(32000), 'kill ' + '$(ps '.repeat(8000),
  'kill $(ps ' + '|'.repeat(32000), 'kill $(ps aux ' + '|/'.repeat(16000),
  'kill ' + '$($'.repeat(10000), 'kill $(' + '$/'.repeat(16000), 'kill ' + '`$/'.repeat(10000),
]) {
  test(`processKillByName: ${JSON.stringify(command.slice(0, 14))}… (${command.length} chars) stays linear`, () => {
    // The bound is the fastest of three runs, so a loaded machine's one slow run does not fail it.
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      assert.ok(Array.isArray(processKillByName(command, '/repo')));
      best = Math.min(best, performance.now() - start);
    }
    assert.ok(best < BUDGET_MS, `took ${best.toFixed(0)} ms at best`);
  });
}
