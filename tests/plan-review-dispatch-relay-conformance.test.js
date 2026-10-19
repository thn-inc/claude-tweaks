'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
// #3377: /build Common Step 1.6 (build/plan-review.md) can stop a dispatched
// first call with `failed:plan-review-needs-human`. The build's own exit has
// already posted the question; dispatch's Settle releases the claim (steps 1-2,
// against the group run dir the claim is keyed to) but
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

function section(text, name) {
  const start = text.indexOf(`\n## ${name}\n`);
  assert.ok(start >= 0, `no ## ${name} section`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

const SETTLE_ANCHORS = [
  'failed:plan-review-needs-human',
  'build/plan-review.md',
  'Skip steps 3-7',
  'it released no claim',
  'Steps 1-2 run as normal',
  '`release-claim.js` with `--reason "failed: plan-review-needs-human"`',
  'the group directory the claim is keyed to',
  'dispatch-retry-ceiling',
  'no failure comment',
  'no PR tombstone',
  // the ordinary first-call teardown still runs
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
  // a non-headless block can be re-picked headlessly
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
  const rideAlong = text.indexOf('**Headless ride-along special case (#1780).**');
  assert.ok(rideAlong >= 0, 'the Headless ride-along special case anchor is missing');
  assert.ok(rideAlong < at, 'the special case sits after the Headless ride-along special case');
});

test('Review Focus 5: the dispatching session relays the question to the human', () => {
  assert.deepStrictEqual(missing(paragraph(read(REPORTING), RELAY_HEAD), RELAY_ANCHORS), []);
});

test('reporting.md\'s PushNotification rule names the plan-review headless block (headless block notification)', () => {
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

test('AC8.1: docs/skill-graph.md states the /build → /dispatch edge once, in the build section', () => {
  const text = read(GRAPH);
  const rows = section(text, 'build').split('\n').filter((l) => l.startsWith('| `/dispatch` |'));
  assert.strictEqual(rows.length, 1, 'expected exactly one /dispatch row under ## build');
  assert.ok(rows[0].includes('build/plan-review.md'), 'the /dispatch row must name build/plan-review.md');
  const dispatchRows = section(text, 'dispatch').split('\n').filter((l) => l.startsWith('|') && l.includes('build/plan-review.md'));
  assert.deepStrictEqual(dispatchRows, [], 'the ## dispatch section must not restate the edge');
});

test('go-red: missing() flags each removed anchor', () => {
  const cases = [
    [paragraph(read(SETTLE), SETTLE_HEAD), SETTLE_ANCHORS],
    [paragraph(read(REPORTING), RELAY_HEAD), RELAY_ANCHORS],
  ];
  for (const [source, anchors] of cases) {
    for (const anchor of anchors) {
      assert.ok(missing(source.split(anchor).join(''), anchors).includes(anchor), `removing ${anchor} was not flagged`);
    }
  }
});

test('grown dispatch files stay within the rail', () => {
  for (const file of [SETTLE, REPORTING]) {
    const bytes = Buffer.byteLength(read(file), 'utf8');
    assert.ok(bytes <= RAIL_BYTES, `${file} is ${bytes} B, over the ${RAIL_BYTES} B rail`);
  }
});

// plan-review.md's resume path sends the human to
// /claude-tweaks:backlog refine, an edge /build owns; /backlog must not restate it.
test('AC8.1: docs/skill-graph.md states the /build → /backlog edge once, in the build section', () => {
  const text = read(GRAPH);
  const rows = section(text, 'build').split('\n').filter((l) => l.startsWith('| `/backlog` |'));
  assert.strictEqual(rows.length, 1, 'expected exactly one /backlog row under ## build');
  assert.ok(rows[0].includes('build/plan-review.md') && rows[0].includes('/claude-tweaks:backlog refine'));
  const backlogRows = section(text, 'backlog').split('\n').filter((l) => l.startsWith('|') && l.includes('plan-review'));
  assert.deepStrictEqual(backlogRows, [], 'the ## backlog section must not restate the edge');
});

// `bot:blocked` gained a second cause (a headless
// plan-review question awaiting an answer). Every consumer that explains the label
// to a human names that cause. Each pin reads only the explaining passage — a line
// (`line`) or a blank-line-delimited paragraph (`para`) starting at `head` — so it
// goes red when that passage loses the cause, not when some other line mentions it.
const BLOCKED_CONSUMERS = [
  [path.join('plugin', 'skills', '_shared', 'work-record.md'), '| **Bot state** |', 'line', 'build/plan-review.md'],
  [path.join('plugin', 'skills', '_shared', 'work-record.md'), '  `transient`-classified one preserves it.', 'para', 'plan-review-question'],
  [path.join('plugin', 'skills', 'tidy', 'step-1-records.md'), '`isBotBlocked(record)`', 'para', 'plan-review-question'],
  [path.join('plugin', 'skills', 'tidy', 'step-1-records.md'), '→ Collect each as: `[blocked]', 'line', 'plan-review question'],
  [path.join('plugin', 'skills', 'backlog', 'attention-mode.md'), '| #{n} | bot:blocked |', 'line', 'plan-review-question'],
  [path.join('plugin', 'skills', 'backlog', 'refine-lanes.md'), 'Population: `.blocked`', 'para', 'plan-review-question'],
  [path.join('plugin', 'skills', 'backlog', 'refine-mode.md'), 'For every record in `blocked`', 'para', 'plan-review-question'],
  [path.join('plugin', 'skills', '_shared', 'github-pr-scan.md'), '   - **`bot:blocked`** —', 'line', 'plan-review-question'],
  [path.join('plugin', 'skills', 'backlog', 'SKILL.md'), '- A record hit its retry ceiling', 'line', 'plan-review'],
  [path.join('plugin', 'skills', '_shared', 'label-bootstrap.md'), '  ["bot:blocked",', 'line', 'plan-review question'],
  [path.join('plugin', 'skills', 'help', 'status-scan.md'), '- Blocked: **', 'line', 'plan-review question'],
  [path.join('plugin', 'skills', '_shared', 'github-pr-scan.md'), 'Render as three lines:', 'line', 'plan-review question'],
  [path.join('plugin', 'skills', '_shared', 'work-record-permission-matrix.md'), '| **Executors**', 'line', 'build/plan-review.md'],
  [path.join('docs', 'skill-graph.md'), '| `/dispatch` | `/tidy` Step 4.7', 'line', 'plan-review question'],
];

function passage(text, head, mode) {
  const start = text.indexOf(head);
  assert.ok(start >= 0, `passage head not found: ${head}`);
  const end = text.indexOf(mode === 'line' ? '\n' : '\n\n', start);
  return text.slice(start, end < 0 ? undefined : end);
}

test('every bot:blocked explanation names the plan-review question as a cause', () => {
  for (const [file, head, mode, cause] of BLOCKED_CONSUMERS) {
    assert.ok(passage(read(file), head, mode).includes(cause), `${file} (${head}) does not name "${cause}"`);
  }
});

test('the widened bot:blocked label description stays within the 100-char cap', () => {
  const { ensureLabelPayload } = require('../plugin/bin/lib/issues/labels.js');
  const match = read('plugin', 'skills', '_shared', 'label-bootstrap.md').match(/\["bot:blocked",\s*"([^"]*)",\s*"([^"]*)"\]/);
  assert.ok(match, 'could not locate the bot:blocked LABELS_JSON row');
  assert.doesNotThrow(() => ensureLabelPayload('bot:blocked', match[1], match[2]));
});
