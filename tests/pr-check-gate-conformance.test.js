'use strict';
// #3013: /test's pipeline gate and /review Step 1.5 both route through one
// shared PR-check procedure; red is a gate failure in both; no-pr fails open
// with a SKIP trace; and the classifier's failing-conclusion set stays equal
// to the merge gate's prose list (code twin of _shared/pr-first-merge.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FAILING_CONCLUSIONS, classifyRollup } = require('../plugin/bin/lib/pr-checks/classify');

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

test('red names the merge-verification lever and its off value (parity with pr-first-merge.md Step 2.5)', () => {
  const red = section(GATE, /\*\*`red`\*\*/, /\n- \*\*/);
  assert.ok(red.includes('merge-verification'), 'red bullet names the merge-verification lever');
  assert.ok(red.includes('`off`'), 'red bullet names the off value');
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

test('/test Step 2 (Report) also points at the gate, at the point TEST_PASSED is set', () => {
  const step2 = section(TEST_SKILL, /## Step 2: Report/, /\n## /);
  assert.ok(step2.includes('_shared/pr-check-gate.md'), 'test/SKILL.md Step 2 cites _shared/pr-check-gate.md');
  assert.ok(step2.includes('TEST_PASSED'), 'test/SKILL.md Step 2 names TEST_PASSED');
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

const PR_CHECKS = read('plugin/bin/pr-checks.js');

test('AC1.1: inherited-red passes with a caveat and an AUTO line naming the base sha and checks', () => {
  const b = section(GATE, /\*\*`inherited-red`\*\*/, /\n- \*\*/);
  assert.match(b, /caveat/i);
  assert.match(b, /--status AUTO/);
  assert.ok(b.includes('{baseSha short}'), 'AUTO text names the base sha');
  assert.ok(b.includes('({names})'), 'AUTO text names the inherited checks');
  assert.match(b, /`TEST_PASSED` is set/);
});

test('AC2.1: red names only checks not flagged inherited as the cause', () => {
  const red = section(GATE, /\*\*`red`\*\*/, /\n- \*\*/);
  assert.match(red, /`inherited`/);
  assert.match(red, /attributable/i);
  assert.match(red, /those alone\s+are the cause/, 'only the attributable checks are named as the cause');
  assert.ok(!red.includes('separate follow-up record'), 'stale deferral note removed');
});

test('AC3.1: the gate states an unreadable base stays red, never green', () => {
  const red = section(GATE, /\*\*`red`\*\*/, /\n- \*\*/);
  assert.match(red, /`baseReason`/);
  assert.match(GATE, /the state stays `red` with `baseReason`/);
});

test('every state pr-checks.js can print is routed by a bullet in the gate (code twin)', () => {
  const m = PR_CHECKS.match(/'  state: ([^'\\]+)\\n'/);
  assert.ok(m, 'USAGE state line found');
  const states = m[1].split('|').map((s) => s.trim()).filter(Boolean);
  assert.ok(states.includes('inherited-red'));
  const routing = section(GATE, /## Routing by `state`/, /\n## /);
  for (const s of states) assert.ok(routing.includes(`\`${s}\``), `gate routes ${s}`);
});

test('/test names inherited-red in its PR-check gate bullet', () => {
  const pb = section(TEST_SKILL, /\*\*Pipeline behavior:\*\*/, /\n## /);
  assert.ok(pb.includes('`inherited-red`'), 'test/SKILL.md Pipeline behavior names inherited-red');
});

// #3257: Step 2.5 normalizes StatusContext entries before the red/pending
// rules, and its state → verdict prose must agree with classifyRollup.
function statusContextBlock(text) {
  // Step 3's post-merge report also names StatusContext; only Step 2.5's paragraph names the code twin.
  return text.split('\n\n').find((b) => b.includes('`StatusContext`') && b.includes('`normalizeEntry`'));
}

function assertStatusContextNormalization(text) {
  const block = statusContextBlock(text);
  assert.ok(block, 'pr-first-merge.md Step 2.5 names StatusContext normalization');
  const readAt = text.indexOf('**Read state first');
  assert.notEqual(readAt, -1, 'pr-first-merge.md Step 2.5 anchor `**Read state first` not found — the ordering check would pass vacuously');
  const redAt = text.indexOf('entry with `conclusion` in');
  assert.notEqual(redAt, -1, 'pr-first-merge.md anchor `entry with `conclusion` in` not found — the ordering check would pass vacuously');
  assert.ok(text.indexOf(block) > readAt, 'StatusContext paragraph sits inside Step 2.5');
  assert.ok(text.indexOf(block) < redAt, 'StatusContext paragraph precedes the red/pending rules');
  assert.ok(block.includes('bin/lib/pr-checks/classify.js'), 'StatusContext paragraph names the code twin');
  const verdicts = {};
  for (const m of block.matchAll(/((?:`[A-Z]+`(?: or |, ))*`[A-Z]+`) → (red|pending|green)/g)) {
    for (const [, state] of m[1].matchAll(/`([A-Z]+)`/g)) verdicts[state] = m[2];
  }
  assert.equal(verdicts.FAILURE, 'red');
  assert.equal(verdicts.ERROR, 'red');
  assert.equal(verdicts.SUCCESS, 'green');
  assert.equal(verdicts.PENDING, 'pending');
  assert.equal(verdicts.EXPECTED, 'pending');
  for (const [state, verdict] of Object.entries(verdicts)) {
    const rollup = [{ __typename: 'StatusContext', context: 'ci/x', state, targetUrl: null }];
    const got = classifyRollup({ rollup, headRefOid: 'h', localHead: 'h', hasPrCi: true }).state;
    assert.equal(got, verdict, `classifyRollup(${state}) matches the prose verdict`);
  }
}

test('AC1.1/AC2.1: Step 2.5 normalizes StatusContext before the red/pending rules — FAILURE red, SUCCESS green, matching normalizeEntry (#3257)', () => {
  assertStatusContextNormalization(MERGE);
});

test('AC2.1 go-red control: removing the StatusContext paragraph fails the pin', () => {
  const block = statusContextBlock(MERGE);
  const mutated = block ? MERGE.replace(block, '') : MERGE;
  assert.notEqual(mutated, MERGE, 'the StatusContext paragraph is present to remove');
  assert.throws(() => assertStatusContextNormalization(mutated), /names StatusContext normalization/);
});

test('#3770 go-red control: removing the **Read state first anchor fails the pin, naming it', () => {
  const mutated = MERGE.replace('**Read state first', '');
  assert.notEqual(mutated, MERGE, 'the **Read state first anchor is present to remove');
  assert.throws(() => assertStatusContextNormalization(mutated), /\*\*Read state first/);
});

test('#3770 go-red control: removing the entry with `conclusion` in anchor fails the pin, naming it', () => {
  const mutated = MERGE.replace('entry with `conclusion` in', '');
  assert.notEqual(mutated, MERGE, 'the entry with `conclusion` in anchor is present to remove');
  assert.throws(() => assertStatusContextNormalization(mutated), /entry with `conclusion` in/);
});
