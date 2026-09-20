// tests/release-lifecycle-byte-budget.test.js — #2257 AC3/AC6: two files in this
// unit's scope were already at or over their byte-warning tier before this build
// (wrap-up/SKILL.md at 36,090 bytes, tidy/scan-procedures.md at 42,466 bytes as of
// this commit's own baseline measurement, taken post-merge against main's #2080
// unrecognized-status-warning paragraph — a stale pre-merge measurement on this
// branch alone had that paragraph missing, an unrelated loss from an earlier merge
// on this same branch, not a deliberate removal) — a mechanical ceiling, not manual
// review alone, so a later unrelated edit to either file gets a signal if it pushes
// past budget. wrap-up/SKILL.md's own edit here added one Next Actions table row plus
// one render-list line (236 bytes measured against the correct post-merge baseline —
// under the record's own "~200" approximation); tidy/scan-procedures.md's edit shrank
// the file (net negative), so its ceiling is simply "no larger than before".
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const byteSize = (...p) => Buffer.byteLength(fs.readFileSync(path.join(ROOT, ...p)));

// Baselines captured from this build's own before/after measurement (git show
// HEAD~N or the pre-edit `wc -c`, recorded once here rather than re-derived from
// history on every test run — a moving baseline would defeat the point of a
// ceiling). Update these only alongside a deliberate, reviewed size change to
// either file, never to silence a real regression.
const WRAP_UP_BASELINE = 36090;
const WRAP_UP_CEILING = WRAP_UP_BASELINE + 300; // ~200 bytes/row target, +100 margin

const SCAN_PROCEDURES_BASELINE = 42466;

test('wrap-up/SKILL.md stays within ~one Next Actions row of its pre-#2257 baseline (AC3)', () => {
  const size = byteSize('plugin', 'skills', 'wrap-up', 'SKILL.md');
  assert.ok(
    size <= WRAP_UP_CEILING,
    `wrap-up/SKILL.md is ${size} bytes, over the ${WRAP_UP_CEILING}-byte ceiling (baseline ${WRAP_UP_BASELINE} + one row's budget) — a later edit grew this file past the release-row's own footprint`,
  );
});

test('tidy/scan-procedures.md does not grow past its pre-#2257 byte count (AC6)', () => {
  const size = byteSize('plugin', 'skills', 'tidy', 'scan-procedures.md');
  assert.ok(
    size <= SCAN_PROCEDURES_BASELINE,
    `tidy/scan-procedures.md is ${size} bytes, over its ${SCAN_PROCEDURES_BASELINE}-byte pre-#2257 baseline — this file is already past the 40 KB warning tier (docs/plugin-structure.md), so a later edit must trim elsewhere to stay net-zero-or-shrink, not silently grow it further`,
  );
});
