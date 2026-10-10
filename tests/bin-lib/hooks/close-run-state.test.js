'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { closeRunState, hasUnarchivedWork } = require('../../../plugin/bin/lib/hooks/close-run-state');

function makeTmpRunDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-run-state-test-'));
  return dir;
}

test('closeRunState: notYetArchived is true when the run dir still has a top-level work/ subdirectory', () => {
  const dir = makeTmpRunDir();
  try {
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'work', '42-spec.md'), '# 42\n');
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    assert.strictEqual(r.status, 'closed');
    assert.strictEqual(r.notYetArchived, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('closeRunState: notYetArchived is true when a multi-spec spec-N/work/ subdirectory exists', () => {
  const dir = makeTmpRunDir();
  try {
    fs.mkdirSync(path.join(dir, 'spec-42', 'work'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec-42', 'work', '42-spec.md'), '# 42\n');
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    assert.strictEqual(r.notYetArchived, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('closeRunState: notYetArchived is false when no work/ subdirectory exists anywhere under the run dir', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'decisions.md'), '# decisions\n');
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    assert.strictEqual(r.notYetArchived, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Review finding: the defensive readdirSync catch (fail-open — an unreadable
// run dir is reported as having no unarchived work, matching the function's
// own header comment: this must never block a stuck/foreign run's manual
// close) had no direct test. A non-existent runDir exercises it exactly —
// fs.existsSync(work) returns false without throwing, then
// fs.readdirSync(runDir) throws ENOENT.
test('hasUnarchivedWork: unreadable/non-existent run dir fails open (returns false), never throws', () => {
  const missing = path.join(os.tmpdir(), 'close-run-state-test-does-not-exist-' + Date.now());
  assert.strictEqual(hasUnarchivedWork(missing), false);
});

test('closeRunState: refused-foreign case never reaches the notYetArchived check', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ sessionId: 'other-session' }));
    const r = closeRunState(dir, { explicit: false, callerIdentity: { sessionId: 'this-session' } });
    assert.strictEqual(r.status, 'refused-foreign');
    assert.strictEqual('notYetArchived' in r, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// #1502: an implicit close (no explicit --run) landing, via the fallback
// resolver, on a run whose run-state.json never recorded a sessionId must
// not close it while its worktree directory still physically exists —
// there is no owner to compare against, so the live worktree is the only
// available signal that this run is presumptively still in progress.
test('closeRunState: refused-live-worktree when no sessionId was ever recorded and the worktree dir still exists', () => {
  const dir = makeTmpRunDir();
  const worktree = makeTmpRunDir(); // stands in for a real worktree directory
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree }));
    const r = closeRunState(dir, { explicit: false, callerIdentity: { sessionId: 'some-session' } });
    assert.strictEqual(r.status, 'refused-live-worktree');
    assert.strictEqual('notYetArchived' in r, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('closeRunState: an implicit close still closes normally when no sessionId was recorded but the worktree path is already gone', () => {
  const dir = makeTmpRunDir();
  const goneWorktree = path.join(os.tmpdir(), 'close-run-state-test-gone-worktree-' + Date.now());
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: goneWorktree }));
    const r = closeRunState(dir, { explicit: false, callerIdentity: { sessionId: 'some-session' } });
    assert.strictEqual(r.status, 'closed', 'a worktree path that no longer exists on disk is not "live" — nothing to refuse on');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// teardown-run's own legitimate self-close: record-worktree already stamped
// THIS session's own id, and the worktree still exists on disk at the moment
// closeRunState runs (teardown-run's own worktree removal is a later step) —
// the new check must never fire here, since the foreignOwner comparison
// above already proves this run belongs to the calling session.
test('closeRunState: a live worktree with a recorded, matching sessionId still closes normally (teardown-run\'s own self-close path)', () => {
  const dir = makeTmpRunDir();
  const worktree = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ sessionId: 'this-session', worktree }));
    const r = closeRunState(dir, { explicit: false, callerIdentity: { sessionId: 'this-session' } });
    assert.strictEqual(r.status, 'closed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('closeRunState: explicit: true bypasses the live-worktree refusal, same as it bypasses refused-foreign', () => {
  const dir = makeTmpRunDir();
  const worktree = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree }));
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 'some-session' } });
    assert.strictEqual(r.status, 'closed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

function readEventTypes(dir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch { return []; }
  return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).type);
}

// #2553: a run whose run-state.json already reads `status: clean` at the
// moment ExitWorktree/close runs again (e.g. a second close reached while
// wrap-up is mid-archival) must not get a false `close-without-wrapup`
// terminal-state signal — nothing about this run's wrap-up state changed,
// only its own already-clean status is being re-observed.
test('closeRunState: status already "clean" suppresses close-without-wrapup even when no wrapup event was ever seen', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ sessionId: 's1', status: 'clean' }));
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    assert.strictEqual(r.status, 'closed');
    assert.strictEqual(r.wrapupSeen, false);
    assert.ok(!readEventTypes(dir).includes('close-without-wrapup'), 'an already-clean run must not log a false close-without-wrapup event');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC8's negative control: a genuinely non-clean run with no recorded wrapup
// must still get the real close-without-wrapup signal — the fix narrows the
// false positive without suppressing a true one.
test('closeRunState: a genuinely active (non-clean) run with no wrapup event still logs close-without-wrapup', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ sessionId: 's1', status: 'active' }));
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    assert.strictEqual(r.status, 'closed');
    assert.strictEqual(r.wrapupSeen, false);
    assert.ok(readEventTypes(dir).includes('close-without-wrapup'), 'a genuinely non-clean, no-wrapup close must still be flagged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// No run-state.json at all (never recorded any status) must behave like the
// pre-fix default — status isn't provably "clean", so the signal still fires.
test('closeRunState: missing run-state.json (no status to compare) still logs close-without-wrapup', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'decisions.md'), '# decisions\n');
    const r = closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    assert.strictEqual(r.status, 'closed');
    assert.ok(readEventTypes(dir).includes('close-without-wrapup'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
