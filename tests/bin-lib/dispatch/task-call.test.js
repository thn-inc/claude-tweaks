'use strict';
// #3711: the dispatch-call discriminator used by wrap-up/auto-merge-short-circuit.md's
// Dispatch-call branch — decides whether this call is one of /claude-tweaks:dispatch's Task
// calls (run-state.json carries `dispatched: true` AND a `dispatchSessionId` equal to the current
// session, falling back to `sessionId` only for run-states that predate that field).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDispatchTaskCall, isDispatchTaskCallForRun } = require('../../../plugin/bin/lib/dispatch/task-call');

test('AC1.1: dispatched run, matching session -> true', () => {
  assert.strictEqual(isDispatchTaskCall({ runState: { dispatched: true, sessionId: 'S' }, sessionId: 'S' }), true);
});

test('AC2.1: false for every non-matching shape', () => {
  const rows = [
    ['human resume (session mismatch)', { runState: { dispatched: true, sessionId: 'S' }, sessionId: 'T' }],
    ['human-run /flow (no dispatched marker)', { runState: { sessionId: 'S' }, sessionId: 'S' }],
    ['stamped sessionId absent', { runState: { dispatched: true }, sessionId: 'S' }],
    ['current sessionId undefined', { runState: { dispatched: true, sessionId: 'S' }, sessionId: undefined }],
    ['both sessionIds empty', { runState: { dispatched: true, sessionId: '' }, sessionId: '' }],
    ['both sessionIds absent', { runState: { dispatched: true }, sessionId: undefined }],
    ['runState null', { runState: null, sessionId: 'S' }],
    ['runState string', { runState: 'x', sessionId: 'S' }],
    ['runState array', { runState: [], sessionId: 'S' }],
    ["dispatched is the string 'true'", { runState: { dispatched: 'true', sessionId: 'S' }, sessionId: 'S' }],
  ];
  // Collect every wrongly-true row so a regression names all of them, not just the first.
  const wronglyTrue = rows.filter(([, input]) => isDispatchTaskCall(input) !== false).map(([label]) => label);
  assert.deepStrictEqual(wronglyTrue, []);
});

test('#3711: the match is against dispatchSessionId, which a resume re-stamp of sessionId cannot move', () => {
  const stamped = { dispatched: true, sessionId: 'H', dispatchSessionId: 'D' };
  assert.strictEqual(isDispatchTaskCall({ runState: stamped, sessionId: 'H' }), false, 'human resume after re-stamp');
  assert.strictEqual(isDispatchTaskCall({ runState: stamped, sessionId: 'D' }), true, 'the dispatching session');
});

test('#3711: legacy run-state (no dispatchSessionId) falls back to sessionId; a present-but-bad dispatchSessionId does not', () => {
  assert.strictEqual(isDispatchTaskCall({ runState: { dispatched: true, sessionId: 'S' }, sessionId: 'S' }), true, 'legacy fallback');
  const empty = { dispatched: true, sessionId: 'S', dispatchSessionId: '' };
  assert.strictEqual(isDispatchTaskCall({ runState: empty, sessionId: '' }), false, 'empty vs empty');
  assert.strictEqual(isDispatchTaskCall({ runState: empty, sessionId: 'S' }), false, 'empty does not fall back');
  const nonString = { dispatched: true, sessionId: 'S', dispatchSessionId: 7 };
  assert.strictEqual(isDispatchTaskCall({ runState: nonString, sessionId: 'S' }), false, 'non-string does not fall back');
});

test('#3711: a null or missing argument is false, not a throw', () => {
  assert.strictEqual(isDispatchTaskCall(null), false);
  assert.strictEqual(isDispatchTaskCall(), false);
});

test('AC2.1: isDispatchTaskCallForRun reads run-state.json and never throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-call-'));
  try {
    assert.strictEqual(isDispatchTaskCallForRun(dir, 'S'), false, 'missing file');

    fs.writeFileSync(path.join(dir, 'run-state.json'), '{not json');
    assert.strictEqual(isDispatchTaskCallForRun(dir, 'S'), false, 'malformed JSON');

    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ dispatched: true, sessionId: 'S' }));
    assert.strictEqual(isDispatchTaskCallForRun(dir, 'S'), true, 'dispatched run, matching session');
    assert.strictEqual(isDispatchTaskCallForRun(dir, 'T'), false, 'dispatched run, foreign session');

    assert.strictEqual(isDispatchTaskCallForRun('', 'S'), false, 'empty runDir');
    assert.strictEqual(isDispatchTaskCallForRun(undefined, 'S'), false, 'undefined runDir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
