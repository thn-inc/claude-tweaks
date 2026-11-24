// tests/hooks-lifecycle.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const sessionEnd = require('../plugin/bin/lib/hooks/session-end');
const preCompact = require('../plugin/bin/lib/hooks/pre-compact');

function mkRun(state) {
  const project = scratchDir('ct-lc-');
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  if (state) fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return { project, run };
}
const readState = (run) => JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
const readEvents = (run) => fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

test('session-end marks active run interrupted and logs the event', () => {
  const { run } = mkRun({ status: 'active' });
  const out = sessionEnd.run({ env: process.env, input: { reason: 'exit', session_id: 's1' }, runDir: run, runState: readState(run), ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(readState(run).status, 'interrupted');
  const ev = readEvents(run);
  assert.strictEqual(ev[0].type, 'session-end');
  assert.strictEqual(ev[0].reason, 'exit');
});

test('session-end leaves a clean run untouched', () => {
  const { run } = mkRun({ status: 'clean' });
  sessionEnd.run({ env: process.env, input: {}, runDir: run, runState: readState(run), ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.strictEqual(readState(run).status, 'clean');
});

test('session-end with no run dir is a no-op', () => {
  assert.deepStrictEqual(sessionEnd.run({ env: process.env, input: {}, runDir: null, runState: null, ownedRun: { dir: null, attribution: null }, cwd: '/x' }), {});
});

test('session-end on a run dir with no run-state.json marks interrupted and logs the event', () => {
  const { run } = mkRun(); // no state written -> readRunState(run) is null
  const out = sessionEnd.run({ env: process.env, input: { reason: 'exit', session_id: 's1' }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(readState(run).status, 'interrupted');
  const ev = readEvents(run);
  assert.strictEqual(ev[0].type, 'session-end');
  assert.strictEqual(ev[0].reason, 'exit');
});

test('pre-compact appends breadcrumb and stamps lastEvent', () => {
  const { run } = mkRun({ status: 'active' });
  preCompact.run({ env: process.env, input: { trigger: 'auto' }, runDir: run, runState: readState(run), ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.strictEqual(readEvents(run)[0].type, 'pre-compact');
  assert.strictEqual(readEvents(run)[0].trigger, 'auto');
  assert.strictEqual(readState(run).lastEvent, 'pre-compact');
});
