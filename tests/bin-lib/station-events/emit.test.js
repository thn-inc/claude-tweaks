'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scratchDir } = require('../../helpers/tmp-dir');
const {
  appendStationEvent, buildLine, eventKey, toRepoName, stationEventPath,
} = require('../../../plugin/bin/lib/station-events/emit');

const FIXED_NOW = () => new Date('2026-11-19T08:00:00.000Z');

function event(overrides = {}) {
  return {
    repoName: 'o/n',
    recordNumber: 42,
    kind: 'entered',
    station: 'build',
    runId: 'run-1',
    sessionId: 'sess-1',
    discriminator: 'claimedAt-1',
    ...overrides,
  };
}

function fakeStderr() {
  const calls = [];
  return { calls, write: (s) => { calls.push(String(s)); return true; } };
}

function deps(mainRoot, extra = {}) {
  const stderr = fakeStderr();
  return { stderr, d: { mainRoot, now: FIXED_NOW, stderr: stderr.write, ...extra } };
}

function readLines(mainRoot) {
  const raw = fs.readFileSync(stationEventPath(mainRoot), 'utf8');
  return { raw, lines: raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

test('v1 line has exactly the spec fields', () => {
  const line = buildLine(event(), { now: FIXED_NOW });
  assert.deepEqual(Object.keys(line).sort(), [
    'at', 'eventKey', 'kind', 'lane', 'outcome', 'payload', 'recordNumber',
    'repoName', 'runId', 'sessionId', 'station', 'v',
  ]);
  assert.equal(line.v, 1);
  assert.ok(line.at.endsWith('Z'));
  assert.equal(line.outcome, null);
  assert.deepEqual(line.payload, {});
  assert.equal(line.lane, 'unknown');
  const exited = buildLine(event({ kind: 'exited', outcome: 'passed', lane: 'driver' }), { now: FIXED_NOW });
  assert.equal(exited.outcome, 'passed');
  assert.equal(exited.lane, 'driver');
  // an outcome on a non-exited kind is not carried
  assert.equal(buildLine(event({ kind: 'started', outcome: 'passed' }), { now: FIXED_NOW }).outcome, null);
});

test('eventKey is deterministic', () => {
  const fields = { repoName: 'o/n', recordNumber: 42, kind: 'entered', station: 'build', runId: 'r', discriminator: 'd1' };
  assert.equal(eventKey(fields), eventKey({ ...fields }));
  assert.match(eventKey(fields), /^[0-9a-f]{32}$/);
  assert.notEqual(eventKey(fields), eventKey({ ...fields, discriminator: 'd2' }));
  const a = buildLine(event(), { now: () => new Date('2026-01-01T00:00:00Z') });
  const b = buildLine(event(), { now: () => new Date('2026-06-01T00:00:00Z') });
  assert.notEqual(a.at, b.at);
  assert.equal(a.eventKey, b.eventKey);
});

test('appends whole lines under the lock', () => {
  const root = scratchDir('ct-station-events-');
  const { stderr, d } = deps(root);
  assert.deepEqual(appendStationEvent(event(), d), { written: true });
  assert.deepEqual(appendStationEvent(event({ kind: 'exited', outcome: 'passed' }), d), { written: true });
  const { raw, lines } = readLines(root);
  assert.equal(lines.length, 2);
  assert.ok(raw.endsWith('\n'));
  assert.equal(stationEventPath(root), path.join(root, '.claude-tweaks', 'station-events.jsonl'));
  assert.equal(fs.existsSync(stationEventPath(root) + '.lock'), false);
  assert.equal(stderr.calls.length, 0);
});

test('resolves to the main checkout from a linked worktree', () => {
  const base = scratchDir('ct-station-events-wt-', { realpath: true });
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'x'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'x')}\n`);
  const prev = process.cwd();
  process.chdir(wt);
  let result;
  try {
    result = appendStationEvent(event(), { now: FIXED_NOW, stderr: () => true });
  } finally {
    process.chdir(prev);
  }
  assert.deepEqual(result, { written: true });
  assert.equal(readLines(main).lines.length, 1);
  assert.equal(fs.existsSync(path.join(wt, '.claude-tweaks')), false);
});

test('a write failure is swallowed', () => {
  const root = scratchDir('ct-station-events-');
  const throwingFs = { ...fs, appendFileSync: () => { throw new Error('disk full'); } };
  const { stderr, d } = deps(root, { fs: throwingFs });
  let result;
  assert.doesNotThrow(() => { result = appendStationEvent(event(), d); });
  assert.equal(result.written, false);
  assert.equal(typeof result.reason, 'string');
  assert.equal(stderr.calls.length, 1);
});

test('an unresolvable identity is dropped', () => {
  for (const bad of [{ repoName: 'unknown' }, { recordNumber: 0 }]) {
    const root = scratchDir('ct-station-events-');
    assert.equal(buildLine(event(bad), { now: FIXED_NOW }), null);
    const { stderr, d } = deps(root);
    const result = appendStationEvent(event(bad), d);
    assert.equal(result.written, false);
    assert.equal(stderr.calls.length, 1);
    assert.equal(fs.existsSync(stationEventPath(root)), false);
  }
});

test('kind and outcome outside the closed sets are refused', () => {
  for (const bad of [{ kind: 'teleported' }, { kind: 'exited', outcome: 'released' }, { kind: 'exited' }, { lane: 'fast' }]) {
    const root = scratchDir('ct-station-events-');
    assert.equal(buildLine(event(bad), { now: FIXED_NOW }), null);
    const { stderr, d } = deps(root);
    assert.equal(appendStationEvent(event(bad), d).written, false);
    assert.equal(stderr.calls.length, 1);
    assert.equal(fs.existsSync(stationEventPath(root)), false);
  }
});

test('toRepoName maps a host-prefixed or bare slug to owner/name', () => {
  assert.equal(toRepoName('github.com/o/n'), 'o/n');
  assert.equal(toRepoName('o/n'), 'o/n');
  assert.equal(toRepoName(''), null);
});
