'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  escalateResidue, resolveResidue, residueFingerprint, residueBody,
} = require('../../../plugin/bin/lib/reconcile/escalate-residue');

test('residueFingerprint: stable for the same (reason, path), distinct across either', () => {
  const a = residueFingerprint('move-failed', '/x/run-1');
  const b = residueFingerprint('move-failed', '/x/run-1');
  const c = residueFingerprint('move-failed', '/x/run-2');
  const d = residueFingerprint('removal-failed', '/x/run-1');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test('residueBody: embeds the path, reason, and the fingerprint marker', () => {
  const { body, marker } = residueBody({ reason: 'move-failed', targetPath: '/x/run-1', count: 3, firstFailedAt: null, lastError: 'ENOENT' });
  assert.match(body, /move-failed/);
  assert.match(body, /\/x\/run-1/);
  assert.match(body, /ENOENT/);
  assert.ok(body.includes(marker));
});

test('escalateResidue: no prior issue -> files one via the injected runner, returns its number', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/99\n';
    throw new Error('unexpected call: ' + args.join(' '));
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.deepEqual(result, { status: 'filed', number: 99 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'issue');
  assert.equal(calls[0][1], 'list');
  assert.equal(calls[1][1], 'create');
});

test('escalateResidue: a prior matching issue already exists -> dedup-hit, never files a second one', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{ number: 42, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z' }]);
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.deepEqual(result, { status: 'dedup-hit', number: 42 });
  assert.equal(calls.length, 1, 'must never call issue create after a dedup hit');
});

test('escalateResidue: runner throws (gh absent / network) -> escalation-failed, never throws itself', () => {
  const runner = () => { throw new Error('gh: command not found'); };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.equal(result.status, 'escalation-failed');
  assert.match(result.reason, /gh: command not found/);
});

test('escalateResidue: no repo slug -> escalation-failed without calling the runner', () => {
  let called = false;
  const runner = () => { called = true; return '[]'; };
  const result = escalateResidue({ repo: null, reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.equal(result.status, 'escalation-failed');
  assert.equal(called, false);
});

// #1892 Deliverable 4 — a marker match that is already CLOSED means this
// path escalated once before, got resolved, and is now failing again: comment
// + reopen the SAME record rather than filing a duplicate.
test('escalateResidue: a prior matching issue is CLOSED -> comments and reopens it, never files a duplicate', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{
        number: 42, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'CLOSED',
      }]);
    }
    return '';
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 4, runner });
  assert.deepEqual(result, { status: 'reopened', number: 42 });
  assert.equal(calls.length, 3, 'expected list, comment, reopen — never a second create');
  assert.equal(calls[1][1], 'comment');
  assert.equal(calls[1][2], '42');
  assert.equal(calls[2][1], 'reopen');
  assert.equal(calls[2][2], '42');
  assert.ok(!calls.some((c) => c[1] === 'create'), 'must never file a duplicate for an already-tracked path');
});

// An OPEN prior match is unaffected by the CLOSED-only reopen branch — still
// a plain dedup-hit, exactly as before.
test('escalateResidue: a prior matching issue is OPEN -> still a plain dedup-hit, never reopened/commented', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{
      number: 42, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN',
    }]);
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.deepEqual(result, { status: 'dedup-hit', number: 42 });
  assert.equal(calls.length, 1, 'must never call comment/reopen/create on an already-open dedup-hit');
});

test('resolveResidue: an escalated OPEN match -> comments and closes it', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{
        number: 55, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN',
      }]);
    }
    return '';
  };
  const result = resolveResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.deepEqual(result, { status: 'closed', number: 55 });
  assert.equal(calls[1][1], 'comment');
  assert.equal(calls[2][1], 'close');
});

test('resolveResidue: no matching issue -> not-found, calls only the list', () => {
  const runner = () => '[]';
  const result = resolveResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.deepEqual(result, { status: 'not-found' });
});

test('resolveResidue: a matching issue already CLOSED -> already-closed, no further writes', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{
      number: 55, title: 'x', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'CLOSED',
    }]);
  };
  const result = resolveResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.deepEqual(result, { status: 'already-closed', number: 55 });
  assert.equal(calls.length, 1, 'must never comment/close an already-closed issue again');
});

test('resolveResidue: no repo slug -> resolution-failed without calling the runner', () => {
  let called = false;
  const runner = () => { called = true; return '[]'; };
  const result = resolveResidue({ repo: null, reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.equal(result.status, 'resolution-failed');
  assert.equal(called, false);
});
