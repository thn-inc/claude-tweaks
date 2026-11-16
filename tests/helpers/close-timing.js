'use strict';
// Shared fixtures for the closing-path timing tests (#5555 Task 4): the close-run
// cases in tests/bin-lib/hooks/close-run-state.test.js and the teardown-run cases in
// tests/hooks-teardown-run.test.js drive the same in-process verbs and read the same files.
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const transcript = require('../../plugin/bin/lib/timing/transcript');
const atClose = require('../../plugin/bin/lib/timing/at-close');

const SID = 'sess-5555';
const A = [10, 20, 30, 40];
const B = [1, 2, 3, 4];

function writeEvents(runDir) {
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
    { skill: 'claude-tweaks:build', ts: '2026-11-16T10:00:00.000Z', type: 'skill_invoked' },
    { skill: 'claude-tweaks:test', ts: '2026-11-16T10:10:00.000Z', type: 'skill_invoked' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// Two assistant lines with usage under {cfg}/projects/{slug(worktree)}/{sid}.jsonl (returns that path), stamped
// inside writeEvents' 10:00..10:10 span by default (the at-close writer clips to the run's
// lifetime, which always covers its events); `stamps` places them inside another fixture's.
function writeTranscript(cfg, worktree, [a, b] = [A, B], sid = SID, [s1, s2] = ['2026-11-16T10:01:00.000Z', '2026-11-16T10:09:00.000Z']) {
  const dir = path.join(cfg, 'projects', transcript.slugForCwd(worktree));
  fs.mkdirSync(dir, { recursive: true });
  const line = (id, ts, u) => JSON.stringify({
    timestamp: ts,
    message: { role: 'assistant', id, model: 'claude-test', content: [], usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } },
  });
  const file = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(file, [line('m1', s1, a), line('m2', s2, b)].join('\n') + '\n');
  return file;
}

const sum = (a, b) => ({ input: a[0] + b[0], output: a[1] + b[1], cacheRead: a[2] + b[2], cacheCreate: a[3] + b[3] });
const pickTokens = (t) => ({ input: t.input, output: t.output, cacheRead: t.cacheRead, cacheCreate: t.cacheCreate });
const readTiming = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'timing.json'), 'utf8'));

function skipLines(runDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.startsWith('- SKIP '));
}

function assertPhaseRows(timing) {
  assert.ok(Array.isArray(timing.phases));
  assert.ok(timing.phases.some((p) => p.phase === 'build' && p.source === 'skill_invoked'));
  assert.ok(timing.phases.some((p) => p.phase === 'test' && p.source === 'skill_invoked'));
}

// Replaces module[name] for fn's duration (sync or async), then restores it.
async function withStub(module, name, stub, fn) {
  const real = module[name];
  module[name] = stub;
  try { return await fn(); } finally { module[name] = real; }
}

// AC5: runs call() with the run's transcript reader never settling. The reader is held
// open until the time bound is crossed with mock timers (the real TIMING_BOUND_MS, no wait);
// asserts the call was still pending just before and settled right after. -> call's result.
async function boundedWithHungReader(call) {
  assert.ok(atClose.TIMING_BOUND_MS <= 60000);
  let entered = false;
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    return await withStub(transcript, 'readUsage', () => { entered = true; return new Promise(() => {}); }, async () => {
      let settled = false;
      const p = call().finally(() => { settled = true; });
      // setImmediate is not mocked: yield until the reader is in flight.
      for (let i = 0; i < 5000 && !entered; i++) await new Promise((r) => setImmediate(r));
      assert.equal(entered, true, 'the hung reader was never reached');
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      assert.equal(settled, false, 'the close returned before the time bound');
      mock.timers.tick(atClose.TIMING_BOUND_MS);
      return p;
    });
  } finally {
    mock.timers.reset();
  }
}

// Makes at-close.js fail the way a load fault does: whatever a caller's require() of it hands back
// throws on first use. Done through the module cache entry, restored afterwards.
async function withLoadFault(fn) {
  const entry = require.cache[require.resolve('../../plugin/bin/lib/timing/at-close')];
  assert.ok(entry, 'at-close.js must be loaded before it can be faulted');
  const real = entry.exports;
  entry.exports = new Proxy({}, { get() { throw new Error('load fault'); } });
  try { return await fn(); } finally { entry.exports = real; }
}

module.exports = {
  SID, A, B, writeEvents, writeTranscript, sum, pickTokens, readTiming, skipLines, assertPhaseRows, withStub, withLoadFault, boundedWithHungReader,
};
