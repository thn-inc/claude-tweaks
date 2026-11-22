'use strict';
// tests/bin-lib/ci-audit/phases.test.js — #5757: nearest-rank percentiles and the per-job
// waiting / setup / running phase split over the normalized job shape.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { percentile, splitJobPhases, nameMatches } = require('../../../plugin/bin/lib/ci-audit/phases');

const T = (mmss) => `2026-11-16T00:${mmss}Z`;

function job(overrides = {}) {
  return {
    name: 'test',
    createdAt: T('00:00'),
    startedAt: T('00:30'),
    completedAt: T('02:30'),
    conclusion: 'success',
    steps: [
      { name: 'Set up job', number: 1, startedAt: T('00:30'), completedAt: T('00:50') },
      { name: 'Install', number: 2, startedAt: T('00:50'), completedAt: T('01:20') },
      { name: 'Test', number: 3, startedAt: T('01:20'), completedAt: T('02:30') },
    ],
    ...overrides,
  };
}

const DECLARED = [
  { name: 'Install', kind: 'command' },
  { name: 'Test', kind: 'command' },
];

test('percentile is nearest-rank', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 90), 5);
  assert.equal(percentile([5, 1, 4, 2, 3], 50), 3, 'input order does not matter');
});

test('percentile of an empty array is null', () => {
  assert.equal(percentile([], 50), null);
});

test('splitJobPhases splits at the first declared command step', () => {
  assert.deepEqual(splitJobPhases(job(), DECLARED), { waitingMs: 30000, setupMs: 20000, runningMs: 100000 });
});

test('splitJobPhases with no declared steps leaves setup null and runs from start', () => {
  assert.deepEqual(splitJobPhases(job(), null), { waitingMs: 30000, setupMs: null, runningMs: 120000 });
});

test('splitJobPhases counts declared action steps before the first command as setup', () => {
  const declared = [{ name: 'Install', kind: 'action' }, { name: 'Test', kind: 'command' }];
  assert.deepEqual(splitJobPhases(job(), declared), { waitingMs: 30000, setupMs: 50000, runningMs: 70000 });
});

test('splitJobPhases with no run step matching a declared command leaves setup null', () => {
  const declared = [{ name: 'Lint', kind: 'command' }];
  assert.deepEqual(splitJobPhases(job(), declared), { waitingMs: 30000, setupMs: null, runningMs: 120000 });
});

test('splitJobPhases returns null when startedAt precedes createdAt', () => {
  assert.equal(splitJobPhases(job({ startedAt: T('00:00'), createdAt: T('00:10') }), DECLARED), null);
});

test('splitJobPhases returns null when completedAt is missing', () => {
  assert.equal(splitJobPhases(job({ completedAt: null }), DECLARED), null);
  const { completedAt, ...noKey } = job();
  void completedAt;
  assert.equal(splitJobPhases(noKey, DECLARED), null);
});

test('percentile of a non-array input is null', () => {
  assert.equal(percentile(null, 50), null);
  assert.equal(percentile('1,2,3', 50), null);
});

test('percentile with a non-finite or out-of-range p is null', () => {
  assert.equal(percentile([1, 2, 3], NaN), null);
  assert.equal(percentile([1, 2, 3], Infinity), null);
  assert.equal(percentile([1, 2, 3], -1), null);
  assert.equal(percentile([1, 2, 3], 101), null);
});

test('percentile ignores non-finite values', () => {
  assert.equal(percentile([10, NaN, Infinity, 'x', 20], 50), 10);
  assert.equal(percentile([NaN, NaN, Infinity], 50), null);
});

test('splitJobPhases with a boundary outside the job window leaves setup null', () => {
  const j = job();
  j.steps[1] = { ...j.steps[1], startedAt: T('03:00') };
  j.steps[2] = { ...j.steps[2], startedAt: T('00:10') };
  assert.deepEqual(splitJobPhases(j, DECLARED), { waitingMs: 30000, setupMs: null, runningMs: 120000 });
});

test('splitJobPhases returns null when completedAt precedes startedAt', () => {
  assert.equal(splitJobPhases(job({ completedAt: T('00:20') }), DECLARED), null);
});

test('splitJobPhases returns null for an unparseable instant', () => {
  assert.equal(splitJobPhases(job({ startedAt: 'not-a-date' }), DECLARED), null);
});

test('splitJobPhases passes over a matched command step the run skipped and uses the next command', () => {
  const j = job();
  j.steps[1] = { ...j.steps[1], conclusion: 'skipped', startedAt: T('00:50'), completedAt: T('00:50') };
  assert.deepEqual(splitJobPhases(j, DECLARED), { waitingMs: 30000, setupMs: 50000, runningMs: 70000 });
});

test('splitJobPhases gives setup null when the first matched command step has no usable startedAt', () => {
  // Not skipped, so it ran (or should have): its start is unknown, and setup is never moved onto Test.
  const j = job();
  j.steps[1] = { ...j.steps[1], startedAt: null, completedAt: null };
  assert.deepEqual(splitJobPhases(j, DECLARED), { waitingMs: 30000, setupMs: null, runningMs: 120000 });
});

test('splitJobPhases gives setup null when a declared command before the boundary matches no run step', () => {
  // `Lint` was declared first but the run data has no such step: never pushed onto Install.
  const declared = [{ name: 'Lint', kind: 'command' }, ...DECLARED];
  assert.deepEqual(splitJobPhases(job(), declared), { waitingMs: 30000, setupMs: null, runningMs: 120000 });
  // …and a declared command with an unknown run name (runName null) likewise.
  const unknown = [{ name: null, kind: 'command', runName: null }, ...DECLARED];
  assert.deepEqual(splitJobPhases(job(), unknown), { waitingMs: 30000, setupMs: null, runningMs: 120000 });
  // An unmatched action before the boundary is harmless: its time is setup either way.
  const action = [{ name: 'Cache', kind: 'action' }, ...DECLARED];
  assert.deepEqual(splitJobPhases(job(), action), { waitingMs: 30000, setupMs: 20000, runningMs: 100000 });
});

test('splitJobPhases matches by runName when the step carries one, and in declaration order', () => {
  const j = job();
  j.steps = [
    { name: 'Set up job', number: 1, startedAt: T('00:30'), completedAt: T('00:40') },
    { name: 'Run npm ci', number: 2, startedAt: T('00:40'), completedAt: T('01:00') },
    { name: 'Run npm ci', number: 3, startedAt: T('01:00'), completedAt: T('02:30') },
  ];
  const declared = [
    { name: 'npm ci', kind: 'command', runName: 'Run npm ci' },
    { name: 'npm ci', kind: 'command', runName: 'Run npm ci' },
  ];
  assert.deepEqual(splitJobPhases(j, declared), { waitingMs: 30000, setupMs: 10000, runningMs: 110000 });
  // the bare declared name does not match the run data's `Run …` name
  assert.deepEqual(splitJobPhases(j, [{ name: 'npm ci', kind: 'command' }]).setupMs, null);
});

test('a boundary step named only by a template is unknown: setup null, never the forge\'s first step', () => {
  // 240 s of real setup (Set up job 1 s, then preparation) before the step named `${{ matrix.task }}`.
  const j = {
    name: 'run', createdAt: T('00:00'), startedAt: T('00:00'), completedAt: T('05:00'), conclusion: 'success',
    steps: [
      { name: 'Set up job', number: 1, startedAt: T('00:01'), completedAt: T('00:02') },
      { name: 'Run make deps', number: 2, startedAt: T('00:02'), completedAt: T('04:00') },
      { name: 'lint', number: 3, startedAt: T('04:00'), completedAt: T('05:00') },
    ],
  };
  const declared = [{ name: '${{ matrix.task }}', kind: 'command', runName: '${{ matrix.task }}' }];
  assert.deepEqual(splitJobPhases(j, declared), { waitingMs: 0, setupMs: null, runningMs: 300000 });
});

test('splitJobPhases orders run steps by number before finding the boundary', () => {
  const j = job();
  j.steps = [j.steps[2], j.steps[0], j.steps[1]];
  assert.deepEqual(splitJobPhases(j, DECLARED), { waitingMs: 30000, setupMs: 20000, runningMs: 100000 });
});

test('a run step without a finite number keeps its own slot while numbered steps sort around it', () => {
  // Install (no number) sits in slot 0, ahead of the numbered Set up job and Test: it is the boundary.
  const j = job();
  j.steps = [{ ...j.steps[1], number: null }, j.steps[2], j.steps[0]];
  assert.deepEqual(splitJobPhases(j, DECLARED), { waitingMs: 30000, setupMs: 20000, runningMs: 100000 });
  // Only the slot decides: two run steps named Test, the unnumbered one (00:50) in slot 0 and #3
  // (01:20). Kept in its slot, the unnumbered one is the first match; moved last, #3 would be.
  const k = job();
  k.steps = [{ ...k.steps[2], number: null, startedAt: T('00:50') }, k.steps[2], k.steps[0]];
  assert.deepEqual(splitJobPhases(k, [{ name: 'Test', kind: 'command' }]), { waitingMs: 30000, setupMs: 20000, runningMs: 100000 });
});

test('nameMatches: trimmed equality, or a ${{ }} template with each expression one or more characters', () => {
  assert.equal(nameMatches('Test', 'Test'), true);
  assert.equal(nameMatches(' Test ', 'Test'), true);
  assert.equal(nameMatches('Test', 'Tests'), false);
  const tpl = 'shard ${{ matrix.shard }}/${{ strategy.job-total }}';
  assert.equal(nameMatches(tpl, 'shard 1/4'), true);
  assert.equal(nameMatches(tpl, 'shard 12/40'), true);
  assert.equal(nameMatches(tpl, 'shard /4'), false, 'an expression stands for at least one character');
  assert.equal(nameMatches(tpl, 'shard 1/'), false);
  assert.equal(nameMatches(tpl, 'xshard 1/4'), false, 'anchored at the start');
  assert.equal(nameMatches('Build (${{ matrix.os }})', 'Build (ubuntu)'), true);
  assert.equal(nameMatches('Build (${{ matrix.os }})', 'Build (ubuntu) extra'), false, 'anchored at the end');
  // A template that is only expressions has no literal text to anchor on: unknown, matches nothing.
  assert.equal(nameMatches('${{ matrix.name }}', 'anything'), false);
  assert.equal(nameMatches(' ${{ a }} ${{ b }} ', 'x y'), false);
  assert.equal(nameMatches('${{ matrix.name }}', ''), false);
  assert.equal(nameMatches('a ${{ x', 'a ${{ x'), true, 'an unclosed expression is literal text');
  assert.equal(nameMatches('a ${{ x', 'a b'), false);
  assert.equal(nameMatches(null, 'x'), false);
});
