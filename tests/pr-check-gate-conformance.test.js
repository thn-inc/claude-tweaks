'use strict';
// #3013: /test's pipeline gate and /review Step 1.5 both route through one
// shared PR-check procedure; red is a gate failure in both; no-pr fails open
// with a SKIP trace; and the classifier's failing-conclusion set stays equal
// to the merge gate's prose list (code twin of _shared/pr-first-merge.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FAILING_CONCLUSIONS } = require('../plugin/bin/lib/pr-checks/classify');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const GATE = read('plugin/skills/_shared/pr-check-gate.md');
const TEST_SKILL = read('plugin/skills/test/SKILL.md');
const REVIEW = read('plugin/skills/review/code-mode-steps.md');
const MERGE = read('plugin/skills/_shared/pr-first-merge.md');

function section(text, startRe, endRe) {
  const s = text.search(startRe);
  assert.ok(s >= 0, `section start ${startRe} not found`);
  const rest = text.slice(s);
  const e = rest.slice(1).search(endRe);
  return e < 0 ? rest : rest.slice(0, e + 1);
}

test('the shared gate runs the one reader and cites the merge gate as the classification authority', () => {
  assert.match(GATE, /bin\/pr-checks\.js" --run "\$PIPELINE_RUN_DIR"/);
  assert.match(GATE, /_shared\/pr-first-merge\.md`?'s Step 2\.5/);
});

test('red is a gate failure naming the check and URL; TEST_PASSED is not set', () => {
  const red = section(GATE, /\*\*`red`\*\*/, /\n- \*\*/);
  assert.match(red, /gate failure/i);
  assert.match(red, /name.*url/i);
  assert.match(red, /do not set `TEST_PASSED`/);
});

test('pending/stale pass with a caveat and an AUTO line', () => {
  const p = section(GATE, /\*\*`pending`\*\* or \*\*`stale`\*\*/, /\n- \*\*/);
  assert.match(p, /caveat/i);
  assert.match(p, /--status AUTO/);
});

test('no-pr / gh-absent / no-ci / read-failed fail open with a SKIP trace', () => {
  const f = section(GATE, /\*\*`no-pr`\*\*/, /\n- \*\*|\n## /);
  for (const s of ['`gh-absent`', '`no-ci`', '`read-failed`']) assert.ok(f.includes(s), `fail-open bullet names ${s}`);
  assert.match(f, /--status SKIP/);
  assert.match(f, /_shared\/auto-decision-log\.md/);
});

test('/test pipeline behavior cites the shared gate', () => {
  const pb = section(TEST_SKILL, /\*\*Pipeline behavior:\*\*/, /\n## /);
  assert.ok(pb.includes('_shared/pr-check-gate.md'), 'test/SKILL.md Pipeline behavior cites _shared/pr-check-gate.md');
});

test('/review Step 1.5 cites the shared gate and routes red to STOP in its gate table', () => {
  const s15 = section(REVIEW, /## Step 1\.5: Test Gate/, /\n## Step /);
  assert.ok(s15.includes('_shared/pr-check-gate.md'), 'Step 1.5 cites _shared/pr-check-gate.md');
  const gate = section(s15, /### Gate:/, /\n## /);
  assert.match(gate, /\|[^|\n]*`red`[^|\n]*\|\s*\*\*STOP\*\*/);
});

test('FAILING_CONCLUSIONS equals the merge gate prose list (code twin)', () => {
  const line = MERGE.split('\n').find((l) => l.includes('entry with `conclusion` in'));
  assert.ok(line, 'pr-first-merge.md red bullet found');
  const tail = line.slice(line.indexOf('`conclusion` in') + '`conclusion` in'.length);
  const prose = [...tail.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]);
  assert.deepEqual(prose, [...FAILING_CONCLUSIONS]);
});
