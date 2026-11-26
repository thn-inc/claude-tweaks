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
  // #5053 D3: the build's exit waits on `needs:answer` and keeps the grants in any posture
  'added `needs:answer` (in any posture), kept every `auto:*` grant',
];

const RELAY_ANCHORS = [
  'failed:plan-review-needs-human',
  '<!-- plan-review-question -->',
  // #5053: the two answer options — an `/answer` reply the next bare drain folds in, or a body
  // Decision and a typed resume
  'reply `/answer …` on that question comment',
  "the next bare `/claude-tweaks:dispatch` drain folds the reply into #{n}'s body and resumes the build",
  "add a `**Decision**` paragraph (or an Acceptance Criterion) to #{n}'s body and run `/claude-tweaks:dispatch resume #{n}`",
  'no `AskUserQuestion` in a subagent',
  // a re-pick cannot happen: the kept draft PR holds the record in the open-pr exclusion
  'the open-pr exclusion',
];

// Retired from both paragraphs by #5053: the headless block, the re-grant and the re-pick.
const RETIRED_SETTLE = ['added `bot:blocked`', 'removed every `auto:*` grant'];
const RETIRED_RELAY = ['bot:blocked', 're-grant', 're-run `/claude-tweaks:dispatch #{n}`', 're-pick'];
const retired = (text, banned) => banned.filter((b) => text.includes(b));

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

test('#5053: neither paragraph keeps the headless block, the re-grant or the re-pick', () => {
  assert.deepStrictEqual(retired(paragraph(read(SETTLE), SETTLE_HEAD), RETIRED_SETTLE), []);
  assert.deepStrictEqual(retired(paragraph(read(REPORTING), RELAY_HEAD), RETIRED_RELAY), []);
});

test('go-red: retired() flags each banned clause planted in its own live paragraph', () => {
  const cases = [
    [paragraph(read(SETTLE), SETTLE_HEAD), RETIRED_SETTLE],
    [paragraph(read(REPORTING), RELAY_HEAD), RETIRED_RELAY],
  ];
  for (const [live, banned] of cases) {
    for (const b of banned) assert.deepStrictEqual(retired(`${live} ${b}`, banned), [b], b);
  }
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
  // #5053: the stop adds `needs:answer` and keeps the grants; `bot:blocked` is the retry ceiling only.
  assert.ok(rows[0].includes('adds `needs:answer`'), 'the /dispatch row must say the stop adds needs:answer');
  assert.ok(!rows[0].includes('bot:blocked'), 'the /dispatch row must not say the stop applies bot:blocked');
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

// plan-review.md's resume path sends the human to /claude-tweaks:backlog attention
// (the `needs:answer` row), an edge /build owns; /backlog must not restate it.
test('AC8.1: docs/skill-graph.md states the /build → /backlog edge once, in the build section', () => {
  const text = read(GRAPH);
  const rows = section(text, 'build').split('\n').filter((l) => l.startsWith('| `/backlog` |'));
  assert.strictEqual(rows.length, 1, 'expected exactly one /backlog row under ## build');
  assert.ok(rows[0].includes('build/plan-review.md') && rows[0].includes('/claude-tweaks:backlog attention'), 'the /backlog row must name build/plan-review.md and /claude-tweaks:backlog attention');
  assert.ok(rows[0].includes('`needs:answer`'), 'the /backlog row must name needs:answer');
  assert.ok(!rows[0].includes('/claude-tweaks:backlog refine'), 'the /backlog row must not send the human to refine');
  const backlogRows = section(text, 'backlog').split('\n').filter((l) => l.startsWith('|') && l.includes('plan-review'));
  assert.deepStrictEqual(backlogRows, [], 'the ## backlog section must not restate the edge');
});

// A plan-review question is `needs:answer`; `bot:blocked` is the retry ceiling only
// (expand-contract, #5053 D10). Every consumer that explains `bot:blocked` to a human
// points a plan-review question at `needs:answer` and no longer names the old cause. Each
// pin reads only the explaining passage — a line (`line`) or a blank-line-delimited
// paragraph (`para`) starting at `head` — so it goes red when that passage loses the
// pointer, not when some other line mentions it. `pointer: false` passages (the
// LABELS_JSON description, a 100-char cap) only get the old-cause ban.
const BLOCKED_CONSUMERS = [
  [path.join('plugin', 'skills', '_shared', 'work-record.md'), '| **Bot state** |', 'line', true],
  [path.join('plugin', 'skills', '_shared', 'work-record.md'), '  `transient`-classified one preserves it.', 'para', true],
  [path.join('plugin', 'skills', 'tidy', 'step-1-records.md'), '`isBotBlocked(record)`', 'para', true],
  [path.join('plugin', 'skills', 'tidy', 'step-1-records.md'), '→ Collect each as: `[blocked]', 'line', false],
  [path.join('plugin', 'skills', 'backlog', 'attention-mode.md'), '| #{n} | bot:blocked |', 'line', true],
  [path.join('plugin', 'skills', 'backlog', 'refine-lanes.md'), 'Population: `.blocked`', 'para', true],
  [path.join('plugin', 'skills', 'backlog', 'refine-mode.md'), 'For every record in `blocked`', 'para', true],
  [path.join('plugin', 'skills', '_shared', 'github-pr-scan.md'), '   - **`bot:blocked`** —', 'line', true],
  [path.join('plugin', 'skills', 'backlog', 'SKILL.md'), '- A record hit its retry ceiling', 'line', true],
  [path.join('plugin', 'skills', '_shared', 'label-bootstrap.md'), '  ["bot:blocked",', 'line', false],
  [path.join('plugin', 'skills', 'help', 'status-scan.md'), '- Blocked: **', 'line', false],
  [path.join('plugin', 'skills', '_shared', 'github-pr-scan-triage.md'), 'Render as three lines:', 'line', false],
  [path.join('plugin', 'skills', '_shared', 'work-record-permission-matrix.md'), '| **Executors**', 'line', true],
  [path.join('docs', 'skill-graph.md'), '| `/dispatch` | `/tidy` Step 4.7', 'line', true],
];

// The retired plan-review causes, each in its whitespace-collapsed spelling [IL-66].
const OLD_BLOCKED_CAUSES = [
  'plan-review-question',
  'plan-review question awaits',
  'plan-review question awaiting',
  'plan-review answer',
  'awaits an answer',
  'awaiting an answer',
  'headless plan-review',
  'plan-review needs-human stop',
];

function passage(text, head, mode) {
  const start = text.indexOf(head);
  assert.ok(start >= 0, `passage head not found: ${head}`);
  const end = text.indexOf(mode === 'line' ? '\n' : '\n\n', start);
  return text.slice(start, end < 0 ? undefined : end);
}

// Returns the problems found in one passage; each carries its own message.
function blockedProblems(text, wantsPointer) {
  const flat = text.replace(/\s+/g, ' ');
  const out = [];
  if (wantsPointer && !flat.includes('needs:answer')) out.push('does not point a plan-review question at needs:answer');
  for (const old of OLD_BLOCKED_CAUSES) {
    if (flat.includes(old)) out.push(`still names the retired cause "${old}"`);
  }
  return out;
}

test('every bot:blocked explanation sends a plan-review question to needs:answer', () => {
  for (const [file, head, mode, wantsPointer] of BLOCKED_CONSUMERS) {
    assert.deepStrictEqual(blockedProblems(passage(read(file), head, mode), wantsPointer), [], `${file} (${head})`);
  }
});

test('go-red: blockedProblems flags a lost pointer and each retired cause', () => {
  const [file, head, mode] = BLOCKED_CONSUMERS[0];
  const live = passage(read(file), head, mode);
  assert.deepStrictEqual(blockedProblems(live, true), []);
  const lost = live.split('needs:answer').join('');
  assert.notStrictEqual(lost, live, 'live Bot state row no longer names needs:answer');
  assert.deepStrictEqual(blockedProblems(lost, true), ['does not point a plan-review question at needs:answer']);
  assert.deepStrictEqual(blockedProblems(lost, false), []);
  for (const old of OLD_BLOCKED_CAUSES) {
    assert.deepStrictEqual(blockedProblems(`${live} ${old}`, true), [`still names the retired cause "${old}"`], old);
  }
});

test('every passage the pointer test reads actually names needs:answer when it must (per-consumer mutation)', () => {
  let pointers = 0;
  for (const [file, head, mode, wantsPointer] of BLOCKED_CONSUMERS) {
    if (!wantsPointer) continue;
    pointers += 1;
    const live = passage(read(file), head, mode);
    const lost = live.split('needs:answer').join('');
    assert.notStrictEqual(lost, live, `${file} (${head}) has no needs:answer to remove`);
    assert.ok(blockedProblems(lost, true).includes('does not point a plan-review question at needs:answer'), `${file} (${head})`);
  }
  assert.ok(pointers >= 10, `expected at least 10 pointer consumers, saw ${pointers}`);
});

test('the bot:blocked label description stays within the 100-char cap', () => {
  const { ensureLabelPayload } = require('../plugin/bin/lib/issues/labels.js');
  const match = read('plugin', 'skills', '_shared', 'label-bootstrap.md').match(/\["bot:blocked",\s*"([^"]*)",\s*"([^"]*)"\]/);
  assert.ok(match, 'could not locate the bot:blocked LABELS_JSON row');
  assert.doesNotThrow(() => ensureLabelPayload('bot:blocked', match[1], match[2]));
});
