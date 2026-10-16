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

// #3198: a run dir already archived (or otherwise removed) between
// resolution and this call must never be recreated by a write attempt —
// matching log-decision.js's own refusal instead of writing fresh
// bookkeeping files into a path a concurrent archival just removed.
test('closeRunState: a non-existent run dir refuses with status "missing" and creates nothing', () => {
  const missing = path.join(os.tmpdir(), 'close-run-state-test-missing-' + Date.now());
  const r = closeRunState(missing, { explicit: true, callerIdentity: { sessionId: 's1' } });
  assert.strictEqual(r.status, 'missing');
  assert.strictEqual(fs.existsSync(missing), false);
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
