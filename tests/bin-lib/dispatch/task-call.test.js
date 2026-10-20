'use strict';
// #3711: the dispatch-call discriminator used by wrap-up/auto-merge-short-circuit.md's
// Dispatch-call branch — decides whether this call is one of /claude-tweaks:dispatch's Task
// calls (run-state.json carries `dispatched: true` AND a `sessionId` equal to the current one).
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
