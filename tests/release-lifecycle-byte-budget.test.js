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
const os = require('os');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
// #3113: measure LF bytes, not whatever line ending the checkout happens to carry --
// a Windows core.autocrlf checkout reads CRLF, which inflates Buffer.byteLength past
// a ceiling derived from the LF blob CI actually sees. readText() normalizes \r\n -> \n
// before the byte count, the same fix tests/helpers/read-skill.js already applies for
// prose-literal assertions (#2763).
const byteSizeOfPath = (absPath) => Buffer.byteLength(readText(absPath), 'utf8');
const byteSize = (...p) => byteSizeOfPath(path.join(ROOT, ...p));

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
    `tidy/scan-procedures.md is ${size} bytes, over its ${SCAN_PROCEDURES_BASELINE}-byte pre-#2257 baseline — this file is already large, so a later edit must trim elsewhere to stay net-zero-or-shrink, not silently grow it further`,
  );
});

test('byteSize measures LF bytes even when the on-disk file is CRLF (#3113 AC1)', () => {
  const fixture = path.join(os.tmpdir(), `crlf-budget-fixture-${process.pid}.md`);
  const lfText = 'line one\nline two\nline three\n';
  const crlfText = lfText.replace(/\n/g, '\r\n');
  fs.writeFileSync(fixture, crlfText);
  try {
    const lfBytes = Buffer.byteLength(lfText, 'utf8');
    const crlfBytes = Buffer.byteLength(crlfText, 'utf8');
    const measured = byteSizeOfPath(fixture);
    // Precondition: the two really do differ, or this fixture proves nothing.
    assert.ok(crlfBytes > lfBytes, 'fixture setup error: CRLF text must be larger than LF text');
    assert.strictEqual(measured, lfBytes, 'byteSize must count the LF byte length, not the inflated CRLF checkout byte length');
    // Both directions of the AC: a ceiling at the true LF size passes; a ceiling
    // one byte below it (the file's LF size genuinely over budget) still fails --
    // normalization must not make every comparison vacuously pass.
    assert.ok(measured <= lfBytes, 'a ceiling at the LF size must pass');
    assert.ok(!(measured <= lfBytes - 1), 'a ceiling below the true LF size must still fail');
  } finally {
    fs.unlinkSync(fixture);
  }
});
