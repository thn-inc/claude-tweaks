// CI-log terminal-control strip linearity budget (#5369 review) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// normalizeCiLog() strips terminal controls from a CI job log downloaded with
// --allow-escape-sequences, and that log is uncapped text a PR's test output wrote. The shapes
// below repeat each pattern's opening without its end: an unterminated OSC run, a CSI whose
// parameter run never reaches a final byte, and an ESC-[ run the SGR lookahead must reject. ESC is
// outside every repeated class, so no attempt rescans another's run.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes
// under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeCiLog } = require('../plugin/bin/lib/verify/ci-source');

function timed(input) {
  const start = performance.now();
  const value = normalizeCiLog(input, '');
  return { value, elapsed: performance.now() - start };
}

test('normalizeCiLog: unterminated and repeated control openings stay linear', () => {
  const ESC = '\x1b';
  const shapes = {
    'ESC] run': { input: `${ESC}]`.repeat(100000), expected: '' },
    'ESC]a run': { input: `${ESC}]a`.repeat(70000), expected: '' },
    'ESC[ + long parameter run': { input: `${ESC}[${';'.repeat(200000)}`, expected: `[${';'.repeat(200000)}` },
    'ESC[ run': { input: `${ESC}[`.repeat(100000), expected: '['.repeat(100000) },
    'ESC[1; run': { input: `${ESC}[1;`.repeat(60000), expected: '[1;'.repeat(60000) },
  };
  for (const [name, { input, expected }] of Object.entries(shapes)) {
    const { value, elapsed } = timed(input);
    assert.ok(value === expected, `verdict changed on ${name} (length ${value.length})`);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms on ${name}`);
  }
});
