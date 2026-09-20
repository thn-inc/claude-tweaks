// tests/plan-audit-skip-sentence-bytes-prose.test.js — pins the #2000
// addition to plugin/skills/build/SKILL.md's Common Step 1.5 skip sentence:
// even when the rest of the step is skipped, `--bytes` still runs (Check D
// is the one check the skip gate doesn't cover). Reads the live skill file
// (this test pins prose WE just wrote, not a third-party fact — the
// skill-prose-conformance-tests live-vs-fixture distinction), mirroring
// tests/design-wrapper-polish-anomaly-prose.test.js's pattern.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_MD = path.join(__dirname, '..', 'plugin', 'skills', 'build', 'SKILL.md');

function read() {
  return fs.readFileSync(SKILL_MD, 'utf8');
}

test('build/SKILL.md Common Step 1.5 skip sentence names --bytes as the one check the skip gate does not cover (#2000)', () => {
  const text = read();
  const idx = text.indexOf('**Skip this step entirely when**');
  assert.ok(idx !== -1, 'skip sentence not found');
  const sentence = text.slice(idx, idx + 700);
  assert.match(sentence, /--bytes/);
});
