// tests/resolve-console.test.js — #2568: hooks.js resolve-console's write
// path (console-execute.js's resolveConsoleExecution), exercised via an
// injected fake `gh` runner per gh-api-module-pattern's contract — no real
// `gh` call is ever made here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveConsoleExecution, REVERSE_FAILED_NOTE, DROPPED_NOTE, FILING_FAILED_NOTE,
} = require('../plugin/bin/lib/reconcile/console-execute');

function makeRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-'));
}

function writeConsoleJson(dir, overrides = {}) {
  const base = {
    commentIds: ['IC_primary'],
    prNumber: 42,
    items: [
      { id: '1', kind: 'batch', summary: 'apply fix A' },
      { id: '2', kind: 'batch', summary: 'apply fix B' },
      { id: '3', kind: 'batch', summary: 'apply fix C', isMergeRow: true },
    ],
  };
  const consoleJson = { ...base, ...overrides };
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(consoleJson));
  return consoleJson;
}

// Primary comment body carrying the Resolve row plus one row per item id —
// every row starts unticked, matching a console a human never touched via
// the PR checkboxes (the exact #2568 scenario: answered in chat instead).
function primaryCommentBody(ids = ['1', '2', '3']) {
  const itemRows = ids.map((id) => `<!-- console-item: ${id} -->\n- [ ] item ${id}`).join('\n');
  return `<!-- console-item: resolve -->\n- [ ] **Resolve console** — tick this last\n${itemRows}`;
}

function fakeGh(calls, { prViewBody, extraComments = [] } = {}) {
  return async (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({
        comments: [
          { id: 'IC_primary', body: prViewBody !== undefined ? prViewBody : primaryCommentBody() },
          ...extraComments,
        ],
        body: 'Fixes #42',
      });
    }
    if (args[0] === 'pr' && args[1] === 'comment') return '';
    // The marker edit and the reply-comment update path both go through
    // `gh api graphql` with an `updateIssueComment` mutation — a REST PATCH
    // to `issues/comments/{id}` would 404 in reality (`primary.id`/an
    // existing reply's `id` are GraphQL node IDs, not REST numeric IDs), so
    // this fake only accepts the GraphQL shape, never a REST `-X PATCH`.
    if (args[0] === 'api' && args[1] === 'graphql') return '{}';
    throw new Error(`fakeGh: unexpected args ${JSON.stringify(args)}`);
  };
}

// AC1 — exact write order: reply comment, before the marker edit, before the
// console.json write, all three happening, in that order.
test('resolveConsoleExecution: posts exactly one reply, before the marker edit, before console.json write, in that order', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const writeCalls = [];
  const deps = {
    now: () => Date.parse('2026-09-21T00:00:00Z'),
    gh: fakeGh(ghCalls),
    writeFile: (p, content) => writeCalls.push({ path: p, content }),
  };

  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);

  assert.equal(result.status, 'executed');
  assert.equal(ghCalls.length, 3, 'expected pr view (read) + pr comment (reply) + api graphql (marker edit)');
  assert.deepEqual(ghCalls[0].slice(0, 2), ['pr', 'view']);
  assert.deepEqual(ghCalls[1].slice(0, 2), ['pr', 'comment']);
  assert.deepEqual(ghCalls[2].slice(0, 2), ['api', 'graphql']);
  assert.match(ghCalls[2].join(' '), /updateIssueComment/);
  assert.equal(writeCalls.length, 1, 'console.json must be written exactly once');
  const written = JSON.parse(writeCalls[0].content);
  assert.equal(typeof written.executedAt, 'string');
  assert.equal(written.resolved, true);
});

test('resolveConsoleExecution: every item approved ticks the Resolve box in the marker-edit body', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const deps = {
    now: () => Date.now(),
    gh: fakeGh(ghCalls),
    writeFile: () => {},
  };
  await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  const patchCall = ghCalls.find((a) => a[0] === 'api');
  const bodyArg = patchCall.find((a) => a.startsWith('body='));
  assert.match(bodyArg, /<!-- claude-tweaks-console-resolved -->/);
  assert.match(bodyArg, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);
});

// AC5/#1294-style partial resolution — a declined isMergeRow item leaves the
// Resolve box unticked and console.json.resolved false.
test('resolveConsoleExecution: a declined isMergeRow item leaves Resolve unticked and console.json.resolved false', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const writeCalls = [];
  const deps = {
    now: () => Date.now(),
    gh: fakeGh(ghCalls),
    writeFile: (p, content) => writeCalls.push({ path: p, content }),
  };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2'], decline: ['3'] }, deps);
  assert.equal(result.status, 'executed');
  assert.equal(result.resolved, false);
  const item3 = result.outcomes.find((o) => o.id === '3');
  assert.equal(item3.outcome, 'declined');
  assert.equal(item3.note, 'declined, no reason given');

  const patchCall = ghCalls.find((a) => a[0] === 'api');
  const bodyArg = patchCall.find((a) => a.startsWith('body='));
  assert.doesNotMatch(bodyArg, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);

  const written = JSON.parse(writeCalls[0].content);
  assert.equal(written.resolved, false);
});

// AC: an item passed in --decline is logged "declined, no reason given" and
// no execution procedure runs for it (it never becomes 'executed').
test('resolveConsoleExecution: a declined item is logged with the Override-drill convention and never marked executed', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const deps = {
    now: () => Date.now(),
    gh: fakeGh([]),
    writeFile: () => {},
  };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2'], decline: ['3'] }, deps);
  const declined = result.outcomes.filter((o) => o.outcome === 'declined');
  assert.equal(declined.length, 1);
  assert.equal(declined[0].id, '3');
  assert.equal(declined[0].note, 'declined, no reason given');
});

// #3636 — an `isRulingRow: true` item (an sdd-ruling-* row) that is not
// ratified is a reversal, not a decline: it counts as cleared for Resolve.
const RULING_ITEMS = [
  { id: '1', kind: 'batch', summary: 'fix A' },
  { id: 'r1', kind: 'staged', summary: 'SDD ruling', isRulingRow: true },
];

async function runRuling(items, { approve, decline, reverseFailed, filingFailed }) {
  const dir = makeRunDir();
  writeConsoleJson(dir, { items });
  const ghCalls = [];
  const writeCalls = [];
  const deps = {
    now: () => Date.now(),
    gh: fakeGh(ghCalls, { prViewBody: primaryCommentBody(items.map((i) => i.id)) }),
    writeFile: (p, content) => writeCalls.push({ path: p, content }),
  };
  const result = await resolveConsoleExecution(dir, { approve, decline, reverseFailed, filingFailed }, deps);
  const markerBody = ghCalls.find((a) => a[0] === 'api').find((a) => a.startsWith('body='));
  const replyCall = ghCalls.find((a) => a[0] === 'pr' && a[1] === 'comment');
  const replyBody = replyCall[replyCall.indexOf('--body') + 1];
  return { result, markerBody, replyBody, written: JSON.parse(writeCalls[0].content) };
}

function assertRulingReversedAndCleared({ result, markerBody, replyBody, written }) {
  assert.equal(result.status, 'executed');
  const r1 = result.outcomes.find((o) => o.id === 'r1');
  assert.equal(r1.outcome, 'reversed');
  assert.equal(r1.note, 'reversed');
  assert.equal(r1.isRulingRow, true);
  assert.equal(result.resolved, true);
  assert.match(markerBody, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);
  assert.ok(replyBody.includes('`r1`: reversed'));
  assert.ok(!replyBody.includes('no reason given'));
  assert.equal(written.resolved, true);
}

test('AC1.1: a flagged ruling item, unticked and in neither list, resolves to reversed and a cleared Resolve', async () => {
  assertRulingReversedAndCleared(await runRuling(RULING_ITEMS, { approve: ['1'], decline: [] }));
});

test('AC2.1: the same flagged ruling named in --decline resolves to reversed', async () => {
  assertRulingReversedAndCleared(await runRuling(RULING_ITEMS, { approve: ['1'], decline: ['r1'] }));
});

test('AC2.2: an unflagged item named in --decline still reads declined', async () => {
  const { result } = await runRuling(RULING_ITEMS, { approve: ['r1'], decline: ['1'] });
  const one = result.outcomes.find((o) => o.id === '1');
  assert.equal(one.outcome, 'declined');
  assert.equal(one.note, 'declined, no reason given');
  assert.equal(result.resolved, false);
});

test('a flagged ruling named in both --approve and --decline reads reversed (decline outranks approve)', async () => {
  assertRulingReversedAndCleared(await runRuling(RULING_ITEMS, { approve: ['1', 'r1'], decline: ['r1'] }));
});

test('ratified ruling stays executed', async () => {
  const { result } = await runRuling(RULING_ITEMS, { approve: ['1', 'r1'], decline: [] });
  assert.equal(result.outcomes.find((o) => o.id === 'r1').outcome, 'executed');
});

test('reversed ruling plus declined merge row leaves Resolve unticked', async () => {
  const items = [
    { id: '1', kind: 'batch', summary: 'merge', isMergeRow: true },
    { id: 'r1', kind: 'staged', summary: 'SDD ruling', isRulingRow: true },
  ];
  const { result, markerBody, written } = await runRuling(items, { approve: [], decline: ['1'] });
  assert.equal(result.outcomes.find((o) => o.id === 'r1').outcome, 'reversed');
  assert.equal(result.outcomes.find((o) => o.id === '1').outcome, 'declined');
  assert.equal(result.resolved, false);
  assert.doesNotMatch(markerBody, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);
  assert.equal(written.resolved, false);
});

// A refused reverse must not read as filed and cleared: a flagged ruling named in
// reverseFailed outranks approve, decline, and ticks, and is NOT cleared.
test('a flagged ruling named in reverseFailed reads reverse-failed, uncleared, Resolve unticked', async () => {
  const { result, markerBody, replyBody, written } = await runRuling(RULING_ITEMS, {
    approve: ['1', 'r1'], decline: ['r1'], reverseFailed: ['r1'],
  });
  assert.equal(result.status, 'executed');
  const r1 = result.outcomes.find((o) => o.id === 'r1');
  assert.equal(r1.outcome, 'reverse-failed');
  assert.equal(r1.note, 'reverse not filed — see decisions.md');
  assert.equal(r1.isRulingRow, true);
  assert.equal(result.resolved, false);
  assert.doesNotMatch(markerBody, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);
  assert.ok(replyBody.includes(`\`r1\`: ${REVERSE_FAILED_NOTE}`));
  assert.equal(written.resolved, false);
});

test('an unflagged id in reverseFailed is rejected as not-ruling-items before any write', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir, { items: RULING_ITEMS });
  const ghCalls = [];
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: ['1'], decline: [], reverseFailed: ['1', 'r1'] }, {
    now: () => Date.now(),
    gh: fakeGh(ghCalls, { prViewBody: primaryCommentBody(['1', 'r1']) }),
    writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'not-ruling-items');
  assert.deepEqual(result.ids, ['1']);
  assert.ok(ghCalls.every((a) => !(a[0] === 'pr' && a[1] === 'comment') && a[0] !== 'api'));
  assert.equal(writeCalls.length, 0);
});

test('an id in reverseFailed that matches no console row is rejected as unknown-item-ids', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir, { items: RULING_ITEMS });
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: [], decline: [], reverseFailed: ['nope'] }, {
    now: () => Date.now(),
    gh: fakeGh([], { prViewBody: primaryCommentBody(['1', 'r1']) }),
    writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.reason, 'unknown-item-ids');
  assert.deepEqual(result.ids, ['nope']);
  assert.equal(writeCalls.length, 0);
});

// #3949 — a finding row (`findingItem`: a can't-tell Low-confidence/Contested item) is
// tick = file, untick = drop: an unticked or declined one is dropped (a decided outcome, cleared);
// one whose filing failed is named in filingFailed and is not cleared.
const FINDING_ITEMS = [
  { id: '1', kind: 'batch', summary: 'fix A' },
  { id: 'f1', kind: 'staged', summary: 'can\'t-tell finding', findingItem: 'tiebreak:3f2a9c1b7d04' },
];

test('a finding row unticked and in neither list reads dropped and clears Resolve', async () => {
  const { result, markerBody, replyBody, written } = await runRuling(FINDING_ITEMS, { approve: ['1'], decline: [] });
  const f1 = result.outcomes.find((o) => o.id === 'f1');
  assert.equal(f1.outcome, 'dropped');
  assert.equal(f1.note, 'dropped — nothing filed');
  assert.equal(result.resolved, true);
  assert.match(markerBody, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);
  assert.ok(replyBody.includes(`\`f1\`: ${DROPPED_NOTE}`));
  assert.ok(!replyBody.includes('no reason given'));
  assert.equal(written.resolved, true);
});

test('a finding row named in --decline reads dropped; approved it reads executed', async () => {
  assert.equal((await runRuling(FINDING_ITEMS, { approve: ['1', 'f1'], decline: ['f1'] })).result.outcomes.find((o) => o.id === 'f1').outcome, 'dropped');
  assert.equal((await runRuling(FINDING_ITEMS, { approve: ['1', 'f1'], decline: [] })).result.outcomes.find((o) => o.id === 'f1').outcome, 'executed');
});

test('a finding row named in filingFailed reads filing-failed, uncleared, Resolve unticked', async () => {
  const { result, markerBody, replyBody, written } = await runRuling(FINDING_ITEMS, { approve: ['1', 'f1'], decline: [], filingFailed: ['f1'] });
  const f1 = result.outcomes.find((o) => o.id === 'f1');
  assert.equal(f1.outcome, 'filing-failed');
  assert.equal(f1.note, 'filing failed — see decisions.md');
  assert.equal(result.resolved, false);
  assert.doesNotMatch(markerBody, /<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i);
  assert.ok(replyBody.includes(`\`f1\`: ${FILING_FAILED_NOTE}`));
  assert.equal(written.resolved, false);
});

test('#4172: console.json persists each item\'s outcome — filing-failed carries its note, executed carries none', async () => {
  const { written } = await runRuling(FINDING_ITEMS, { approve: ['1', 'f1'], decline: [], filingFailed: ['f1'] });
  const byId = Object.fromEntries(written.items.map((i) => [i.id, i]));
  assert.equal(byId.f1.outcome, 'filing-failed');
  assert.equal(byId.f1.note, FILING_FAILED_NOTE);
  assert.equal(byId.f1.findingItem, 'tiebreak:3f2a9c1b7d04');
  assert.equal(byId['1'].outcome, 'executed');
  assert.equal('note' in byId['1'], false);
});

test('#4172: console.json persists a reverse-failed ruling outcome', async () => {
  const { written } = await runRuling(RULING_ITEMS, { approve: ['1'], decline: [], reverseFailed: ['r1'] });
  const r1 = written.items.find((i) => i.id === 'r1');
  assert.equal(r1.outcome, 'reverse-failed');
  assert.equal(r1.note, REVERSE_FAILED_NOTE);
});

// #3949 review: a long console splits into overflow comments, each carrying its own rows' ticks.
async function runOverflow(overflowBody) {
  const dir = makeRunDir();
  writeConsoleJson(dir, { commentIds: ['IC_primary', 'IC_overflow1'], items: [FINDING_ITEMS[0], { ...FINDING_ITEMS[1], commentId: 'IC_overflow1' }] });
  const ghCalls = [];
  const writeCalls = [];
  const extraComments = overflowBody === null ? [] : [{ id: 'IC_overflow1', body: overflowBody }];
  const result = await resolveConsoleExecution(dir, { approve: ['1'], decline: [] }, {
    now: () => Date.now(),
    gh: fakeGh(ghCalls, { prViewBody: primaryCommentBody(['1']), extraComments }),
    writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  return { result, written: writeCalls.length ? JSON.parse(writeCalls[0].c) : null };
}

test('a finding row ticked in an overflow comment reads executed, not dropped', async () => {
  const { result } = await runOverflow('<!-- console-item: f1 -->\n- [x] item f1');
  assert.equal(result.outcomes.find((o) => o.id === 'f1').outcome, 'executed');
  assert.equal(result.resolved, true);
});

test('a finding row whose tick no comment carries reads declined and leaves Resolve unticked', async () => {
  const { result, written } = await runOverflow(null);
  assert.equal(result.outcomes.find((o) => o.id === 'f1').outcome, 'declined');
  assert.equal(result.resolved, false);
  assert.equal(written.resolved, false);
});

test('an id without findingItem in filingFailed is rejected as not-finding-items before any write', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir, { items: FINDING_ITEMS });
  const ghCalls = [];
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: [], decline: [], filingFailed: ['1', 'f1'] }, {
    now: () => Date.now(),
    gh: fakeGh(ghCalls, { prViewBody: primaryCommentBody(['1', 'f1']) }),
    writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'not-finding-items');
  assert.deepEqual(result.ids, ['1']);
  assert.ok(ghCalls.every((a) => !(a[0] === 'pr' && a[1] === 'comment') && a[0] !== 'api'));
  assert.equal(writeCalls.length, 0);
});

test('non-true flag reads unflagged', async () => {
  const items = [
    { id: 'f', kind: 'staged', summary: 'false flag', isRulingRow: false },
    { id: 's', kind: 'staged', summary: 'string flag', isRulingRow: 'true' },
  ];
  const { result } = await runRuling(items, { approve: [], decline: [] });
  assert.equal(result.outcomes.find((o) => o.id === 'f').outcome, 'declined');
  assert.equal(result.outcomes.find((o) => o.id === 's').outcome, 'declined');
});

// AC2 — omitting --run is a hooks.js-level concern (tested separately below
// against the real CLI); here: the underlying function performs zero writes
// on every error/no-op branch.
test('resolveConsoleExecution: no console.json at all performs zero writes', async () => {
  const dir = makeRunDir();
  const ghCalls = [];
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: [], decline: [] }, {
    now: () => Date.now(), gh: fakeGh(ghCalls), writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'no-console');
  assert.equal(ghCalls.length, 0);
  assert.equal(writeCalls.length, 0);
});

// AC: already resolved (resolved: true) no-ops rather than re-executing.
test('resolveConsoleExecution: an already-resolved console no-ops and performs zero writes', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir, { resolved: true, executedAt: '2026-09-01T00:00:00Z' });
  const ghCalls = [];
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: ['1'], decline: [] }, {
    now: () => Date.now(), gh: fakeGh(ghCalls), writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'noop');
  assert.equal(result.reason, 'already-resolved');
  assert.equal(ghCalls.length, 0);
  assert.equal(writeCalls.length, 0);
});

// AC: a live (non-stale) executingAt claim no-ops rather than racing it.
test('resolveConsoleExecution: a live executingAt claim no-ops and performs zero writes', async () => {
  const dir = makeRunDir();
  const now = Date.now();
  writeConsoleJson(dir, { executingAt: new Date(now - 60 * 1000).toISOString(), executingSession: 'sess-other' });
  const ghCalls = [];
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: ['1'], decline: [] }, {
    now: () => now, gh: fakeGh(ghCalls), writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'noop');
  assert.equal(result.reason, 'claimed');
  assert.equal(result.executingSession, 'sess-other');
  assert.equal(ghCalls.length, 0);
  assert.equal(writeCalls.length, 0);
});

// A STALE executingAt claim (past the 30-minute reclaim window) IS
// reclaimable — this verb proceeds and executes normally.
test('resolveConsoleExecution: a stale executingAt claim is reclaimable and executes normally', async () => {
  const dir = makeRunDir();
  const now = Date.now();
  writeConsoleJson(dir, { executingAt: new Date(now - 45 * 60 * 1000).toISOString() });
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, {
    now: () => now, gh: fakeGh([]), writeFile: () => {},
  });
  assert.equal(result.status, 'executed');
});

// AC4 — an unknown id in --approve/--decline exits (here: returns an error
// status) naming the unknown id(s), and performs zero writes.
test('resolveConsoleExecution: an unknown item id is rejected before any write, naming the id', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const writeCalls = [];
  const result = await resolveConsoleExecution(dir, { approve: ['1', 'nonexistent-id'], decline: [] }, {
    now: () => Date.now(), gh: fakeGh(ghCalls), writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'unknown-item-ids');
  assert.deepEqual(result.ids, ['nonexistent-id']);
  // The read (pr view) is allowed — validation needs the comment's own rows
  // — but no reply/edit/console.json write ever happens.
  assert.ok(ghCalls.every((a) => !(a[0] === 'pr' && a[1] === 'comment') && a[0] !== 'api'));
  assert.equal(writeCalls.length, 0);
});

// A reply-comment failure must not proceed to the marker edit or the
// console.json write — the all-or-nothing-per-step posture the write order
// depends on.
test('resolveConsoleExecution: a reply-comment failure stops before the marker edit or console.json write', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const writeCalls = [];
  const ghCalls = [];
  const gh = async (args) => {
    ghCalls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({ comments: [{ id: 'IC_primary', body: primaryCommentBody() }], body: 'Fixes #42' });
    }
    if (args[0] === 'pr' && args[1] === 'comment') throw new Error('network reset');
    throw new Error(`unexpected: ${JSON.stringify(args)}`);
  };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, {
    now: () => Date.now(), gh, writeFile: (p, c) => writeCalls.push({ p, c }),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'reply-comment-failed');
  assert.ok(ghCalls.every((a) => a[0] !== 'api'), 'marker edit must never run after a failed reply');
  assert.equal(writeCalls.length, 0, 'console.json must never be written after a failed reply');
});

// A retry after a prior attempt already posted the executed reply (e.g. the
// marker edit or console.json write failed last time) must update that
// existing reply in place rather than posting a duplicate — the exact
// duplicate-comment defect this idempotency check exists to prevent.
test('resolveConsoleExecution: a retry with an existing executed-reply comment updates it in place instead of posting a duplicate', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const deps = {
    now: () => Date.now(),
    gh: fakeGh(ghCalls, { extraComments: [{ id: 'IC_existing_reply', body: '<!-- console-item: executed -->\n- `1`: executed (stale)', authorAssociation: 'MEMBER' }] }),
    writeFile: () => {},
  };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.equal(result.status, 'executed');
  assert.ok(ghCalls.every((a) => !(a[0] === 'pr' && a[1] === 'comment')), 'must never create a new reply comment when one already exists');
  const graphqlCalls = ghCalls.filter((a) => a[0] === 'api' && a[1] === 'graphql');
  assert.equal(graphqlCalls.length, 2, 'expected one graphql update for the reply, one for the marker edit');
  const replyUpdate = graphqlCalls.find((a) => a.includes('id=IC_existing_reply'));
  assert.ok(replyUpdate, 'the existing reply comment must be updated by its own id');
  assert.match(replyUpdate.find((a) => a.startsWith('body=')), /`1`: executed/);
});

// #3358 AC3: the executed-reply marker is plantable by anyone who can comment on
// the PR -- only an owner/member/collaborator comment may be updated in place.
// An untrusted marker comment takes the "no such comment" path: a fresh reply is
// created, and the skipped comment is named on the result so it is not silent.
const PLANTED_REPLY = {
  id: 'IC_planted', body: '<!-- console-item: executed -->\n- x', url: 'https://x/c9', author: { login: 'eve' }, authorAssociation: 'NONE',
};
const PLANTED_NOTE = 'skipped marker comment https://x/c9 by eve (NONE) — not an owner, member, or collaborator';

test('AC3.1: an existing executed reply authored NONE is not updated', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const deps = { now: () => Date.now(), gh: fakeGh(ghCalls, { extraComments: [PLANTED_REPLY] }), writeFile: () => {} };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.equal(result.status, 'executed');
  assert.ok(ghCalls.every((a) => !a.includes('id=IC_planted')), 'a planted reply must never be the update target');
});

test('AC3.2: a new reply is created and the result names the skipped comment', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const deps = { now: () => Date.now(), gh: fakeGh(ghCalls, { extraComments: [PLANTED_REPLY] }), writeFile: () => {} };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.equal(ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'comment').length, 1, 'a fresh reply is created');
  assert.deepEqual(result.skippedUntrusted, [PLANTED_NOTE]);
});

test('skippedUntrusted is [] on an executed result when no marker comment was passed over', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const deps = { now: () => Date.now(), gh: fakeGh([]), writeFile: () => {} };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.deepEqual(result.skippedUntrusted, []);
});

test('a non-marker comment authored NONE is silently irrelevant -- no skip note', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const chatter = { id: 'IC_chat', body: 'looks good to me', url: 'https://x/c10', author: { login: 'eve' }, authorAssociation: 'NONE' };
  const deps = { now: () => Date.now(), gh: fakeGh([], { extraComments: [chatter] }), writeFile: () => {} };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.deepEqual(result.skippedUntrusted, []);
});

test('a trusted reply is still updated when an untrusted planted one is also present', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const trusted = { id: 'IC_real_reply', body: '<!-- console-item: executed -->\n- `1`: executed (stale)', authorAssociation: 'OWNER' };
  const deps = { now: () => Date.now(), gh: fakeGh(ghCalls, { extraComments: [PLANTED_REPLY, trusted] }), writeFile: () => {} };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.ok(ghCalls.some((a) => a.includes('id=IC_real_reply')), 'the trusted reply is updated in place');
  assert.ok(ghCalls.every((a) => !a.includes('id=IC_planted')));
  assert.deepEqual(result.skippedUntrusted, [PLANTED_NOTE]);
});

// The final console.json write is the only unguarded I/O in the function
// (#2568 follow-up review finding): a throw there — after both gh writes
// already landed — must surface as a distinguishable error status, never
// propagate uncaught to hooks.js's top-level catch-and-exit-0.
test('resolveConsoleExecution: a console.json write failure after both gh writes landed returns console-write-failed, never throws', async () => {
  const dir = makeRunDir();
  writeConsoleJson(dir);
  const ghCalls = [];
  const deps = {
    now: () => Date.now(),
    gh: fakeGh(ghCalls),
    writeFile: () => { throw new Error('ENOSPC: no space left on device'); },
  };
  const result = await resolveConsoleExecution(dir, { approve: ['1', '2', '3'], decline: [] }, deps);
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'console-write-failed');
  assert.match(result.error, /ENOSPC/);
  assert.equal(ghCalls.length, 3, 'both gh writes (reply, marker edit) must have already run before the write failure');
});
