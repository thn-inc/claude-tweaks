'use strict';
// tests/hooks-session-end.test.js — #3977: SessionEnd archives the session's
// own ad hoc run on a terminal reason, and keeps today's `interrupted` stamp
// everywhere else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sessionEnd = require('../plugin/bin/lib/hooks/session-end');

const { TERMINAL_SESSION_END_REASONS } = sessionEnd;

function project() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-session-end-')));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude-tweaks/\n');
  return root;
}

function mkRunDir(root, name, state, { staged = [] } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-10-01T00:00:00.000Z', type: 'friction' })}\n`);
  for (const s of staged) {
    fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'staged', s), 'x\n');
  }
  return dir;
}

const ADHOC = '2026-10-01T000000-adhoc-standalone';
const archivedPath = (root, name) => path.join(root, '.claude-tweaks', 'pipelines', 'archive', name);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const lastEvent = (dir) => {
  const lines = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
};

function ctxFor(root, dir, reason, attribution = 'session') {
  return { input: { reason, session_id: 'S1' }, cwd: root, ownedRun: { dir, attribution } };
}

test('the terminal reason set is exactly the harness exit reasons', () => {
  assert.deepEqual([...TERMINAL_SESSION_END_REASONS], ['logout', 'prompt_input_exit', 'other']);
});

for (const reason of ['logout', 'prompt_input_exit', 'other']) {
  test(`AC9: a terminal reason (${reason}) closes and archives the own ad hoc run, events.jsonl included`, () => {
    const root = project();
    const dir = mkRunDir(root, ADHOC, { status: 'active', sessionId: 'S1', worktree: root });
    sessionEnd.run(ctxFor(root, dir, reason));
    const arch = archivedPath(root, ADHOC);
    assert.equal(fs.existsSync(dir), false, 'the live run dir is gone and not recreated');
    const state = readJson(path.join(arch, 'run-state.json'));
    assert.equal(state.status, 'clean');
    assert.equal(state.closedBy, 'session-end');
    const ev = fs.readFileSync(path.join(arch, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const endIdx = ev.findIndex((e) => e.type === 'session-end');
    assert.ok(endIdx > 0, 'the session-end event is in the archived log');
    assert.equal(ev[endIdx].reason, reason);
    assert.ok(ev.slice(endIdx + 1).every((e) => e.type === 'close-without-wrapup'), 'only the close itself follows the session-end event');
  });
}

for (const reason of ['clear', 'resume', 'some-future-reason', undefined]) {
  test(`AC9: a non-terminal reason (${reason}) stamps interrupted exactly as before`, () => {
    const root = project();
    const dir = mkRunDir(root, ADHOC, { status: 'active', sessionId: 'S1', worktree: root });
    sessionEnd.run(ctxFor(root, dir, reason));
    assert.equal(fs.existsSync(archivedPath(root, ADHOC)), false);
    const state = readJson(path.join(dir, 'run-state.json'));
    assert.equal(state.status, 'interrupted');
    assert.equal(state.lastEvent, 'session-end');
    assert.equal(lastEvent(dir).type, 'session-end');
  });
}

test('AC9: a non-review staged item keeps the interrupted stamp', () => {
  const root = project();
  const dir = mkRunDir(root, ADHOC, { status: 'active', sessionId: 'S1', worktree: root }, { staged: ['reflect-1.md'] });
  sessionEnd.run(ctxFor(root, dir, 'other'));
  assert.equal(fs.existsSync(archivedPath(root, ADHOC)), false);
  assert.equal(readJson(path.join(dir, 'run-state.json')).status, 'interrupted');
});

test('review-only staged items still close', () => {
  const root = project();
  const dir = mkRunDir(root, ADHOC, { status: 'active', sessionId: 'S1', worktree: root }, { staged: ['review-unconfirmed-1.md'] });
  sessionEnd.run(ctxFor(root, dir, 'logout'));
  assert.equal(fs.existsSync(dir), false);
  assert.equal(readJson(path.join(archivedPath(root, ADHOC), 'run-state.json')).closedBy, 'session-end');
});

test('AC9: a formal run stamps interrupted as before', () => {
  const root = project();
  const dir = mkRunDir(root, '2026-10-01T000000-record-5', { status: 'active', sessionId: 'S1' });
  sessionEnd.run(ctxFor(root, dir, 'prompt_input_exit'));
  const state = readJson(path.join(dir, 'run-state.json'));
  assert.equal(state.status, 'interrupted');
  assert.equal(state.closedBy, undefined);
  assert.equal(lastEvent(dir).type, 'session-end');
});

test('AC9: a fallback attribution touches nothing beyond the event', () => {
  const root = project();
  const dir = mkRunDir(root, ADHOC, { status: 'active', sessionId: 'S0', worktree: root });
  sessionEnd.run(ctxFor(root, dir, 'other', 'fallback'));
  assert.equal(fs.existsSync(archivedPath(root, ADHOC)), false);
  assert.equal(readJson(path.join(dir, 'run-state.json')).status, 'active', 'no stamp on a guessed run');
  assert.equal(lastEvent(dir).attribution, 'fallback');
});

test('archive refusal falls back to the interrupted stamp', () => {
  const root = project();
  const dir = mkRunDir(root, ADHOC, { status: 'active', sessionId: 'S1', worktree: root });
  let closed = false;
  sessionEnd.run(ctxFor(root, dir, 'other'), {
    listStagedItems: () => [],
    archiveRunDir: () => ({ ok: false, reason: 'mkdir-failed' }),
    closeRunState: () => { closed = true; },
  });
  assert.equal(closed, false);
  const state = readJson(path.join(dir, 'run-state.json'));
  assert.equal(state.status, 'interrupted');
  assert.equal(lastEvent(dir).type, 'session-end');
  const ends = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').filter((l) => l.includes('"session-end"'));
  assert.equal(ends.length, 1, 'the event is appended once');
});
