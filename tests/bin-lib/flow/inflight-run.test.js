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

// ---- multi-spec runs: judged per spec from manifest.yml, never from the run-wide rows ----
const both = check(check(body, 'build'), 'test');
const spec = (status, { phase, exits = [] } = {}) => ({ id: 1, status, phase, decisions: exits.map(exit).join('') });

test('a multi-spec run whose first spec exited build and test but whose second is still at build is in flight, though both rows are checked', () => {
  const readDecisions = reader([exit('build') + exit('test')]);
  const specs = [spec('complete', { phase: 'wrap-up', exits: ['build', 'test'] }), spec('running', { phase: 'build' })];
  assert.equal(inFlightPhase({ runState: active, body: both, readDecisions, readSpecs: () => specs }), 'build');
  assert.equal(readDecisions.calls, 0, 'the run-wide decisions set is not consulted');
});

test('a multi-spec run with a pending spec is in flight at build; a running spec past build is in flight at test', () => {
  const done = spec('complete', { exits: ['build', 'test'] });
  assert.equal(inFlightPhase({ runState: active, body: both, readDecisions: reader([]), readSpecs: () => [done, spec('pending')] }), 'build');
  assert.equal(inFlightPhase({ runState: active, body: both, readDecisions: reader([]), readSpecs: () => [done, spec('running', { phase: 'test', exits: ['build'] })] }), 'test');
});

test('a multi-spec run is not in flight once every spec is settled or past test (an exit record or a later manifest phase)', () => {
  const specs = [
    spec('complete'), spec('failed'), spec('not-run'),
    spec('running', { phase: 'wrap-up' }),
    spec('running', { phase: 'test', exits: ['test'] }),
  ];
  assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader([]), readSpecs: () => specs }), null);
});

test('a readSpecs throw propagates; a null readSpecs (single-spec run) falls back to the rows', () => {
  assert.throws(() => inFlightPhase({ runState: active, body, readDecisions: reader([]), readSpecs: () => { throw new Error('manifest unreadable'); } }), /manifest unreadable/);
  assert.equal(inFlightPhase({ runState: active, body: both, readDecisions: reader([]), readSpecs: () => null }), null);
});

// ---- runs that predate phase-exit records ----
const entryIn = (section) => `## ${section}\n${formatEntry({ status: 'AUTO', step: 'Step 1', text: 'did a thing', now })}\n`;

test('a run with no phase-exit record whose decisions carry a /review or /wrap-up entry is past test, though both rows are unchecked', () => {
  for (const section of ['/review', '/wrap-up']) {
    assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader([entryIn('/build'), entryIn(section)]) }), null, section);
  }
});

test('a run with no phase-exit record and only /flow, /build or /test entries is still in flight at build', () => {
  assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader([entryIn('/flow') + entryIn('/build') + entryIn('/test')]) }), 'build');
});

test('once a run holds any phase-exit record, a /review entry no longer stands in for one', () => {
  assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader([exit('build') + entryIn('/review')]) }), 'test');
});

test('a test exit with no build exit (build exited on an earlier release) finishes build too', () => {
  assert.equal(inFlightPhase({ runState: active, body, readDecisions: reader([exit('test')]) }), null);
});
