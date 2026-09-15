// tests/release-lifecycle-wiring-byte-budget.test.js
//
// #2257 AC3/AC6: `wrap-up/SKILL.md` and `tidy/scan-procedures.md` were both
// near or over their byte-warning tier before this unit's edits (35,392 and
// 42,249 bytes respectively, measured at the commit immediately preceding
// this unit's own changes — 747092c4). Pin both ceilings mechanically so a
// later unrelated edit to either file gets a signal if it pushes past
// budget, rather than relying on manual review to notice.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bytesOf = (rel) => Buffer.byteLength(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Baselines captured at 747092c4 (the tip immediately before #2257's own
// changes landed) — see the PR description for the byte-for-byte git show
// this pins against.
const WRAP_UP_BASELINE_BYTES = 35392;
// scan-procedures.md's baseline was re-measured at 92ecb93c (main's tip at
// merge time): unrelated main-branch edits landed on this same file between
// 747092c4 and the merge (net +217 bytes), independent of this unit's own
// -148-byte edit — re-pinning against the file's actual pre-merge size keeps
// this test checking "did this unit's own edit net-zero or shrink the file"
// rather than freezing a byte count concurrent unrelated work has since moved past.
const SCAN_PROCEDURES_BASELINE_BYTES = 42466;

test('AC3: wrap-up/SKILL.md grew by no more than ~200 bytes for the release Next Actions row', () => {
  const bytes = bytesOf('plugin/skills/wrap-up/SKILL.md');
  const grown = bytes - WRAP_UP_BASELINE_BYTES;
  assert.ok(
    grown <= 200,
    `wrap-up/SKILL.md grew by ${grown} bytes (baseline ${WRAP_UP_BASELINE_BYTES}, now ${bytes}) — over the ~200-byte, one-row budget`,
  );
});

test('AC6: tidy/scan-procedures.md is no larger than it was before the release-probe generalization edit', () => {
  const bytes = bytesOf('plugin/skills/tidy/scan-procedures.md');
  assert.ok(
    bytes <= SCAN_PROCEDURES_BASELINE_BYTES,
    `tidy/scan-procedures.md grew from ${SCAN_PROCEDURES_BASELINE_BYTES} to ${bytes} bytes — the generalization edit must net-zero or shrink the file`,
  );
});
