'use strict';
// tests/bin-lib/ci-audit/phases.test.js — #5757: nearest-rank percentiles and the per-job
// waiting / setup / running phase split over the normalized job shape.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { percentile, splitJobPhases } = require('../../../plugin/bin/lib/ci-audit/phases');

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
