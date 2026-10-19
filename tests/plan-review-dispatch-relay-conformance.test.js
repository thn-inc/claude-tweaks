'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
// #3377: /build Common Step 1.6 (build/plan-review.md) can stop a dispatched
// first call with `failed:plan-review-needs-human`. The build's own exit has
// already posted the question and released the claim, so dispatch's Settle
// must not count a retry, post a failure comment, or tombstone the draft PR —
// and the dispatching session must relay the question, since the Task call
// cannot ask it. Read live: both dispatch files grow with every special case.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const SETTLE = path.join('plugin', 'skills', 'dispatch', 'settle-and-merge.md');
const REPORTING = path.join('plugin', 'skills', 'dispatch', 'reporting.md');
const GRAPH = path.join('docs', 'skill-graph.md');

const SETTLE_HEAD = '**Plan-review needs-human special case (#3377).**';
const STEP_1_HEAD = '1. The CLI in step 2 performs the ownership read';
const RELAY_HEAD = '**Plan-review questions are relayed, not dropped (#3377).**';

function paragraph(text, head) {
  const lines = text.split('\n');
  const found = lines.filter((l) => l.startsWith(head));
  assert.strictEqual(found.length, 1, `expected exactly one paragraph starting ${head}`);
  return found[0];
}

function missing(text, anchors) {
  return anchors.filter((a) => !text.includes(a));
}

const SETTLE_ANCHORS = [
  'failed:plan-review-needs-human',
  'build/plan-review.md',
  'Skip steps 1-7',
  'dispatch-retry-ceiling',
  'no failure comment',
  'no PR tombstone',
  // controller addition (a): the ordinary first-call teardown still runs
  'dispatch/two-call-gate.md` §5',
  'removes the local worktree only',
  'the pushed branch and draft PR stay open for the resumed run',
];

const RELAY_ANCHORS = [
  'failed:plan-review-needs-human',
  '<!-- plan-review-question -->',
  "editing #{n}'s body",
  '/claude-tweaks:dispatch #{n}',
  '/claude-tweaks:backlog refine',
  'no `AskUserQuestion` in a subagent',
  // controller addition (c): a non-headless block can be re-picked headlessly
  'A non-headless block keeps `auto:build` with the claim released',
  'a later Routine drain may re-pick the still-unanswered record',
  '`bot:blocked`',
  'answering on the record promptly avoids that spent run',
];

test('Review Focus 5: Settle skips its numbered steps for the plan-review needs-human stop', () => {
  const text = read(SETTLE);
  assert.deepStrictEqual(missing(paragraph(text, SETTLE_HEAD), SETTLE_ANCHORS), []);
  const at = text.indexOf(SETTLE_HEAD);
  const step1 = text.indexOf(`\n${STEP_1_HEAD}`);
  assert.ok(step1 > 0, 'Settle step 1 anchor not found');
  assert.ok(at < step1, 'the special case must precede Settle step 1');
  assert.ok(text.indexOf('**Headless ride-along special case (#1780).**') < at,
    'the special case sits after the Headless ride-along special case');
});

test('Review Focus 5: the dispatching session relays the question to the human', () => {
  assert.deepStrictEqual(missing(paragraph(read(REPORTING), RELAY_HEAD), RELAY_ANCHORS), []);
});

test('reporting.md\'s PushNotification rule names the plan-review headless block (controller addition b)', () => {
  const rule = paragraph(read(REPORTING), '`PushNotification` fires only');
  assert.deepStrictEqual(missing(rule, [
    'at the retry ceiling',
    'auto-merge FYIs',
    'headless plan-review needs-human block',
    '`build/plan-review.md`',
    'never per-firing',
  ]), []);
});

test('reporting.md\'s PushNotification rule agrees with plan-review.md\'s headless branch', () => {
  const planReview = read('plugin', 'skills', 'build', 'plan-review.md');
  assert.ok(planReview.includes('send a `PushNotification`'), 'plan-review.md no longer sends a PushNotification — revisit reporting.md');
});

function section(text, name) {
  const start = text.indexOf(`\n## ${name}\n`);
  assert.ok(start >= 0, `no ## ${name} section`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

test('AC8.1: docs/skill-graph.md states the /build → /dispatch edge once, in the build section', () => {
  const text = read(GRAPH);
  const rows = section(text, 'build').split('\n').filter((l) => l.startsWith('| `/dispatch` |'));
  assert.strictEqual(rows.length, 1, 'expected exactly one /dispatch row under ## build');
  assert.ok(rows[0].includes('build/plan-review.md'), 'the /dispatch row must name build/plan-review.md');
  const dispatchRows = section(text, 'dispatch').split('\n').filter((l) => l.startsWith('|') && l.includes('build/plan-review.md'));
  assert.deepStrictEqual(dispatchRows, [], 'the ## dispatch section must not restate the edge');
});

test('go-red: missing() flags each removed anchor', () => {
  const settle = paragraph(read(SETTLE), SETTLE_HEAD);
  for (const anchor of SETTLE_ANCHORS) {
    assert.ok(missing(settle.split(anchor).join(''), SETTLE_ANCHORS).includes(anchor), `removing ${anchor} was not flagged`);
  }
  const relay = paragraph(read(REPORTING), RELAY_HEAD);
  for (const anchor of RELAY_ANCHORS) {
    assert.ok(missing(relay.split(anchor).join(''), RELAY_ANCHORS).includes(anchor), `removing ${anchor} was not flagged`);
  }
});

test('grown dispatch files stay within the rail', () => {
  for (const file of [SETTLE, REPORTING]) {
    const bytes = Buffer.byteLength(read(file), 'utf8');
    assert.ok(bytes <= RAIL_BYTES, `${file} is ${bytes} B, over the ${RAIL_BYTES} B rail`);
  }
});
