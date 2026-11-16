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

// A typed /claude-tweaks:wrap-up is recorded by the UserPromptSubmit hook with
// source "user" — the same proof as a model-initiated one, so the close is not
// flagged as skipping the procedure.
test('closeRunState: a typed (source:"user") wrap-up counts as wrapupSeen and writes no close-without-wrapup', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active', sessionId: 's' }));
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"skill":"claude-tweaks:wrap-up","source":"user","ts":"2026-08-01T09:50:00.000Z","type":"skill_invoked"}\n');
    const r = closeRunState(dir, { explicit: false, callerIdentity: { sessionId: 's' } });
    assert.strictEqual(r.status, 'closed');
    assert.strictEqual(r.wrapupSeen, true);
    const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
    assert.ok(!events.includes('"type":"close-without-wrapup"'), 'a typed wrap-up must not log close-without-wrapup');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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

// #3023: the close nulls `worktree`, so the prior path is kept as
// `worktreeAtClose` for wrap-up verify's on-disk check — and a second close
// (#2553's already-clean double-close) must never erase it.
test('closeRunState: records the prior worktree as worktreeAtClose, and a second close preserves it', () => {
  const dir = makeTmpRunDir();
  const worktree = path.join(os.tmpdir(), 'close-run-state-test-wt-' + Date.now());
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ sessionId: 's1', status: 'active', worktree }));
    closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    const first = JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
    assert.strictEqual(first.worktree, null);
    assert.strictEqual(first.worktreeAtClose, worktree);
    closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    const second = JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
    assert.strictEqual(second.worktree, null);
    assert.strictEqual(second.worktreeAtClose, worktree);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('closeRunState: writes no worktreeAtClose when no worktree was ever recorded', () => {
  const dir = makeTmpRunDir();
  try {
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ sessionId: 's1', status: 'active' }));
    closeRunState(dir, { explicit: true, callerIdentity: { sessionId: 's1' } });
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
    assert.strictEqual('worktreeAtClose' in after, false);
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

// #5555 Task 4: `hooks.js close-run` writes timing.json before it returns. In-process through
// run(argv, deps); a fixture repo holds the run dir under .claude-tweaks/pipelines/.
const { execFileSync } = require('child_process');
const { runCli } = require('../../helpers/run-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');
const ctxLib = require('../../../plugin/bin/lib/hooks/context');
const atClose = require('../../../plugin/bin/lib/timing/at-close');
const T = require('../../helpers/close-timing');

const HOOKS = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'hooks.js');
const RUN_ID = '2026-11-16T100000-spec-1';

// -> { root, cfg, wt, runDir }: an active run bound to a worktree, with events.jsonl and no timing.json.
function closeFixture({ worktree = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-close-timing-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env: cleanGitEnv() });
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  T.writeEvents(runDir);
  const wt = path.join(root, 'wt-a');
  ctxLib.writeRunState(runDir, { sessionId: T.SID, worktree: worktree ? wt : null, status: 'active' });
  return { root, cfg: path.join(root, 'cfg'), wt, runDir };
}

function closeRun(fx, runDir = fx.runDir) {
  return runCli(HOOKS, ['close-run', '--run', runDir], {
    cwd: fx.root, env: { ...cleanGitEnv(), PIPELINE_RUN_DIR: '', CLAUDE_CONFIG_DIR: fx.cfg, CLAUDE_CODE_SESSION_ID: T.SID },
  });
}

const cleanup = (fx) => fs.rmSync(fx.root, { recursive: true, force: true });

test('AC1.1/AC1.2 close-run: events.jsonl and no timing.json → timing.json with a phase row per phase and token totals, present when the call returns', async () => {
  const fx = closeFixture();
  try {
    T.writeTranscript(fx.cfg, fx.wt);
    const r = await closeRun(fx);
    assert.strictEqual(r.code, 0);
    const timing = T.readTiming(fx.runDir);
    T.assertPhaseRows(timing);
    assert.deepStrictEqual(T.pickTokens(timing.totals.tokens), T.sum(T.A, T.B));
    assert.deepStrictEqual(T.skipLines(fx.runDir), []);
  } finally {
    cleanup(fx);
  }
});

test('AC4.1 close-run: writeTimingAtClose stubbed to throw → stdout and exit code equal the no-op stub\'s, and decisions.md gains one SKIP line', async () => {
  const base = closeFixture();
  const thrown = closeFixture();
  try {
    // The base commit printed nothing about timing, so a no-op stub is its stand-in.
    const expected = await T.withStub(atClose, 'writeTimingAtClose', async () => ({}), () => closeRun(base));
    const actual = await T.withStub(atClose, 'writeTimingAtClose', async () => { throw new Error('boom'); }, () => closeRun(thrown));
    assert.strictEqual(actual.code, expected.code);
    assert.strictEqual(actual.stdout, expected.stdout);
    assert.deepStrictEqual(T.skipLines(base.runDir), []);
    const skips = T.skipLines(thrown.runDir);
    assert.strictEqual(skips.length, 1);
    assert.match(skips[0], /timing at close failed \(boom\)/);
  } finally {
    cleanup(base);
    cleanup(thrown);
  }
});

const stepYield = require('../../../plugin/bin/lib/timing/step-yield');

test('AC6.1: close-run leaves step-yield.json', async () => {
  const fx = closeFixture();
  try {
    T.writeTranscript(fx.cfg, fx.wt);
    const r = await closeRun(fx);
    assert.strictEqual(r.code, 0);
    const y = JSON.parse(fs.readFileSync(path.join(fx.runDir, stepYield.STEP_YIELD_FILE), 'utf8'));
    assert.strictEqual(y.schemaVersion, stepYield.SCHEMA_VERSION);
    assert.ok(y.steps.some((s) => s.phase === 'build'));
    assert.deepStrictEqual(T.skipLines(fx.runDir), []);
  } finally {
    cleanup(fx);
  }
});

test('AC6.2: close-run with the yield function stubbed to throw → stdout and exit code unchanged, one SKIP line', async () => {
  const base = closeFixture();
  const thrown = closeFixture();
  try {
    T.writeTranscript(base.cfg, base.wt);
    T.writeTranscript(thrown.cfg, thrown.wt);
    const expected = await closeRun(base);
    const actual = await T.withStub(stepYield, 'deriveStepYield', () => { throw new Error('boom yield'); }, () => closeRun(thrown));
    assert.strictEqual(actual.code, expected.code);
    assert.strictEqual(actual.stdout, expected.stdout);
    const skips = T.skipLines(thrown.runDir).filter((l) => l.includes('step yield could not be written'));
    assert.strictEqual(skips.length, 1, JSON.stringify(T.skipLines(thrown.runDir)));
    assert.strictEqual(T.skipLines(thrown.runDir).length, 1);
    assert.strictEqual(fs.existsSync(path.join(thrown.runDir, stepYield.STEP_YIELD_FILE)), false);
  } finally {
    cleanup(base);
    cleanup(thrown);
  }
});

test('close-run: a close whose run-state.json cannot be written reports it and writes no timing.json (the file is written only after the state change succeeds)', async () => {
  const fx = closeFixture();
  try {
    // A directory where run-state.json belongs makes the state write fail.
    fs.rmSync(path.join(fx.runDir, 'run-state.json'));
    fs.mkdirSync(path.join(fx.runDir, 'run-state.json'));
    T.writeTranscript(fx.cfg, fx.wt);
    const r = await closeRun(fx);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /failed to close run .* run-state\.json could not be written/);
    assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'timing.json')), false);
    assert.deepStrictEqual(T.skipLines(fx.runDir), []);
  } finally {
    cleanup(fx);
  }
});

test('AC4.2 close-run: at-close.js failing at load → stdout and exit code equal the no-op stub\'s (exit 0), one SKIP line', async () => {
  const base = closeFixture();
  const faulty = closeFixture();
  try {
    const expected = await T.withStub(atClose, 'writeTimingAtCloseSafe', async () => ({}), () => closeRun(base));
    const actual = await T.withLoadFault(() => closeRun(faulty));
    assert.strictEqual(actual.code, 0);
    assert.strictEqual(actual.code, expected.code);
    assert.strictEqual(actual.stdout, expected.stdout);
    const skips = T.skipLines(faulty.runDir);
    assert.strictEqual(skips.length, 1);
    assert.match(skips[0], /load fault/);
  } finally {
    cleanup(base);
    cleanup(faulty);
  }
});

// Mock timers drive the real TIMING_BOUND_MS (no 60 s wait): see boundedWithHungReader.
test('AC5.1 close-run: the transcript reader never resolves → returns at the TIMING_BOUND_MS bound, phase rows written, one SKIP line', { timeout: 10000 }, async () => {
  const fx = closeFixture();
  try {
    T.writeTranscript(fx.cfg, fx.wt);
    const r = await T.boundedWithHungReader(() => closeRun(fx));
    assert.strictEqual(r.code, 0);
    const timing = T.readTiming(fx.runDir);
    T.assertPhaseRows(timing);
    assert.strictEqual(Object.hasOwn(timing.totals, 'tokens'), false);
    const skips = T.skipLines(fx.runDir);
    assert.strictEqual(skips.length, 1);
    assert.match(skips[0], /time bound/);
  } finally {
    cleanup(fx);
  }
});

test('AC10.2 close-run: run-state.json in the older shape (no worktree, no worktreeAtClose) → same stdout and exit code as without the change, phase rows, no token totals', async () => {
  // No worktree recorded: that, not a missing transcript, is why the fixture gets no token totals.
  const base = closeFixture({ worktree: false });
  const older = closeFixture({ worktree: false });
  try {
    for (const fx of [base, older]) {
      // The older shape, as written before closeRunState kept worktreeAtClose.
      fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ sessionId: T.SID, worktree: null, status: 'active' }));
      T.writeTranscript(fx.cfg, fx.wt);
    }
    const expected = await T.withStub(atClose, 'writeTimingAtClose', async () => ({}), () => closeRun(base));
    const actual = await closeRun(older);
    assert.strictEqual(actual.code, expected.code);
    assert.strictEqual(actual.stdout, expected.stdout);
    const rs = JSON.parse(fs.readFileSync(path.join(older.runDir, 'run-state.json'), 'utf8'));
    assert.strictEqual('worktreeAtClose' in rs, false);
    const timing = T.readTiming(older.runDir);
    T.assertPhaseRows(timing);
    assert.strictEqual(Object.hasOwn(timing.totals, 'tokens'), false);
  } finally {
    cleanup(base);
    cleanup(older);
  }
});

test('AC12.2 close-run: a parent run with two spec-N children → one timing.json in the parent, none written into spec-N, an existing spec-N file byte-identical', async () => {
  const fx = closeFixture();
  try {
    T.writeTranscript(fx.cfg, fx.wt);
    for (const n of [1, 2]) {
      fs.mkdirSync(path.join(fx.runDir, `spec-${n}`));
      T.writeEvents(path.join(fx.runDir, `spec-${n}`));
    }
    const childFile = path.join(fx.runDir, 'spec-2', 'timing.json');
    fs.writeFileSync(childFile, '{"phases":[],"totals":{"minutes":1}}');
    const before = fs.readFileSync(childFile);
    assert.strictEqual((await closeRun(fx)).code, 0);
    T.assertPhaseRows(T.readTiming(fx.runDir));
    assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'spec-1', 'timing.json')), false);
    assert.ok(before.equals(fs.readFileSync(childFile)));
    // The same close pointed at a spec-N child itself writes nothing into it.
    await closeRun(fx, path.join(fx.runDir, 'spec-1'));
    assert.strictEqual(fs.existsSync(path.join(fx.runDir, 'spec-1', 'timing.json')), false);
    assert.ok(before.equals(fs.readFileSync(childFile)));
  } finally {
    cleanup(fx);
  }
});
