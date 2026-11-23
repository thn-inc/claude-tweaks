'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composePrEarlyBody, composeExpressBody } = require('../../../plugin/bin/lib/flow/pr-body');
const { setPhaseRow } = require('../../../plugin/bin/lib/flow/pr-checklist');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');
const { PHASE_EXIT_STEP, phaseExitText } = require('../../../plugin/bin/lib/phase-exit/exit-record');
const { inFlightPhase } = require('../../../plugin/bin/lib/flow/inflight-run');

const body = composePrEarlyBody({ runId: 'R1', specSummary: 'S', target: '#1', nextStep: 'build', fixesLines: ['Fixes #1'] });
const check = (b, phase) => setPhaseRow({ body: b, phase }).body;
const active = { status: 'active', sessionId: 'S' };
const now = new Date(2026, 10, 23, 12, 0, 0);
const exit = (phase) => `## ${phase === 'build' ? '/build' : '/test'}\n${formatEntry({ status: 'AUTO', step: PHASE_EXIT_STEP, text: phaseExitText(phase, 'abc123'), now })}\n`;
// A readDecisions seam that counts its calls.
function reader(texts) {
  const r = () => { r.calls += 1; return texts; };
  r.calls = 0;
  return r;
}

test('a non-terminal run with build unchecked and no record is in flight at build', () => {
  const readDecisions = reader(['']);
  assert.equal(inFlightPhase({ runState: active, body, readDecisions }), 'build');
  assert.equal(readDecisions.calls, 1);
});

test('a build exit recorded with test unchecked is in flight at test', () => {
  assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader([exit('build')]) }), 'test');
});

test('AC3.2 + AC6.1: both exits recorded with both rows unchecked is not in flight', () => {
  const readDecisions = reader([exit('build') + exit('test')]);
  assert.equal(inFlightPhase({ runState: active, body, readDecisions }), null);
  assert.equal(readDecisions.calls, 1);
});

test('both rows checked is not in flight, and readDecisions is never called', () => {
  const readDecisions = reader([]);
  assert.equal(inFlightPhase({ runState: active, body: check(check(body, 'build'), 'test'), readDecisions }), null);
  assert.equal(readDecisions.calls, 0);
});

test('an express body (no Phases span) is not in flight', () => {
  const readDecisions = reader([]);
  const express = composeExpressBody({ runId: 'R1', specSummary: 'S', fixesLines: ['Fixes #1'] });
  assert.equal(inFlightPhase({ runState: active, body: express, readDecisions }), null);
  assert.equal(readDecisions.calls, 0);
});

test('a clean run, or a run state that is not an object, is not in flight', () => {
  for (const runState of [{ status: 'clean' }, null, undefined, 'active']) {
    const readDecisions = reader([]);
    assert.equal(inFlightPhase({ runState, body, readDecisions }), null, JSON.stringify(runState));
    assert.equal(readDecisions.calls, 0);
  }
});

test('a readDecisions throw propagates', () => {
  assert.throws(() => inFlightPhase({ runState: active, body, readDecisions: () => { throw new Error('unreadable'); } }), /unreadable/);
});

test('a build exit recorded only in a spec-2 text counts as finished', () => {
  assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader(['## /build\n', exit('build')]) }), 'test');
});
