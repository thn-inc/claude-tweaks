// tests/reconcile.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classifyMirror } = require('../plugin/bin/lib/reconcile/classify');
const { mirrorFastForward } = require('../plugin/bin/lib/reconcile/mirror-ff');
const { decideReap } = require('../plugin/bin/lib/reconcile/reap-merged');
const { decideRelease } = require('../plugin/bin/lib/reconcile/release-merged');
const { decideArchive, readConsoleState, localHasMerge } = require('../plugin/bin/lib/reconcile/archive-merged');
const { formatSummary } = require('../plugin/bin/lib/reconcile/format-summary');
const { isWorktreeLocked } = require('../plugin/bin/lib/hooks/worktree-reap');
const { reconcile } = require('../plugin/bin/lib/reconcile');
const { gitRepo } = require('./helpers/git-fixtures');
const { skipUnderRoot } = require('./helpers/root');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      // #1130: `PIPELINE_RUN_DIR: ''` neutralizes any ambient run-dir env var
      // so a call that doesn't explicitly pass one can't resolve against
      // whatever real run happens to be ambient in this test runner's own
      // process.env (e.g. when npm test itself runs inside a /flow-dispatched
      // shell). A caller that needs a run dir still passes it explicitly via
      // `env`, which wins because it spreads last.
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...env },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// Two-repo fixture: `origin` (bare) + a clone that plays the role of the
// main checkout, both on `main`. Fully local — no network, no gh.
function pairedFixture() {
  const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-origin-'));
  git(['init', '-q', '--bare', '--initial-branch=main'], originDir);

  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-seed-'));
  git(['clone', '-q', originDir, seedDir]);
  git(['config', 'user.email', 'test@example.com'], seedDir);
  git(['config', 'user.name', 'Test'], seedDir);
  fs.writeFileSync(path.join(seedDir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], seedDir);
  git(['commit', '-q', '-m', 'seed'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-main-'));
  git(['clone', '-q', originDir, mainDir]);
  git(['config', 'user.email', 'test@example.com'], mainDir);
  git(['config', 'user.name', 'Test'], mainDir);

  return { originDir, seedDir, mainDir };
}

// --- classify.js / mirror-ff.js: real local git fixtures, no network ---

test('classifyMirror: current when local matches origin', () => {
  const { mainDir } = pairedFixture();
  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'current');
  assert.strictEqual(r.failure, null);
});

test('classifyMirror: behind when origin has moved ahead', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
});

test('classifyMirror: ahead when local has unpushed commits', () => {
  const { mainDir } = pairedFixture();
  fs.writeFileSync(path.join(mainDir, 'local.txt'), 'mine\n');
  git(['add', 'local.txt'], mainDir);
  git(['commit', '-q', '-m', 'local-only'], mainDir);

  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'ahead');
});

test('classifyMirror: diverged when both sides have unique commits', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'origin-side.txt'), 'x\n');
  git(['add', 'origin-side.txt'], seedDir);
  git(['commit', '-q', '-m', 'origin-side'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  fs.writeFileSync(path.join(mainDir, 'local-side.txt'), 'y\n');
  git(['add', 'local-side.txt'], mainDir);
  git(['commit', '-q', '-m', 'local-side'], mainDir);

  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'diverged');
});

test('classifyMirror: dirty when the working tree has uncommitted changes, before any fetch is attempted', () => {
  const { mainDir } = pairedFixture();
  fs.writeFileSync(path.join(mainDir, 'a.txt'), 'modified\n');
  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'dirty');
});

test('classifyMirror: skipFetch=true never calls fetch, trusts already-fetched refs', () => {
  const { originDir, mainDir } = pairedFixture();
  git(['fetch', 'origin'], mainDir); // caller already fetched, simulating the shared-fetch path
  // Point origin at an invalid URL so a *second* fetch attempt would fail —
  // if classifyMirror still fetched despite skipFetch, this would surface as
  // a non-null failure instead of the 'current' state proven by the fetch above.
  git(['remote', 'set-url', 'origin', 'https://example.invalid/nope.git'], mainDir);
  const result = classifyMirror(mainDir, 'main', { skipFetch: true });
  assert.equal(result.state, 'current');
  assert.equal(result.failure, null);
  void originDir;
});

test('mirrorFastForward: fast-forwards when strictly behind and clean (AC1)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const before = git(['rev-parse', 'main'], mainDir).trim();
  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
  assert.strictEqual(r.action, 'fast-forwarded');
  const after = git(['rev-parse', 'main'], mainDir).trim();
  assert.notStrictEqual(before, after);
  assert.strictEqual(after, git(['rev-parse', 'origin/main'], mainDir).trim());
});

test('mirrorFastForward: dirty tree reports dirty and moves nothing (AC1)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  fs.writeFileSync(path.join(mainDir, 'a.txt'), 'dirty\n');

  const before = git(['rev-parse', 'HEAD'], mainDir).trim();
  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'dirty');
  assert.strictEqual(r.action, 'none');
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), before);
});

test('mirrorFastForward: ahead (local-only commits) reports a warning and moves nothing (AC1)', () => {
  const { mainDir } = pairedFixture();
  fs.writeFileSync(path.join(mainDir, 'local.txt'), 'mine\n');
  git(['add', 'local.txt'], mainDir);
  git(['commit', '-q', '-m', 'local-only'], mainDir);
  const before = git(['rev-parse', 'HEAD'], mainDir).trim();

  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'ahead');
  assert.ok(r.warning);
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), before);
});

test('mirrorFastForward: idempotent — a second run after an ff produces zero further writes (AC3)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  mirrorFastForward(mainDir, 'main');
  const afterFirst = git(['rev-parse', 'HEAD'], mainDir).trim();
  const r2 = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r2.state, 'current');
  assert.strictEqual(r2.action, 'none');
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), afterFirst);
});

test('mirrorFastForward: a concurrent session on a different branch is never merged into — skipped, not silently ff-ed', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  // classifyMirror's rev-list comparison is ref-to-ref and reports 'behind'
  // regardless of what's checked out — the guard has to catch it downstream,
  // at the write itself, not by changing the classification.
  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  const before = git(['rev-parse', 'HEAD'], mainDir).trim();

  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
  assert.strictEqual(r.action, 'skipped');
  assert.match(r.reason, /wrong-branch/);
  assert.strictEqual(git(['branch', '--show-current'], mainDir).trim(), 'someone-elses-work');
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), before);
});

// --- decision tables: pure functions, zero I/O ---

test('decideReap: merged PR -> reap', () => {
  assert.deepStrictEqual(decideReap({ number: 5, state: 'MERGED' }), { action: 'reap' });
});
test('decideReap: closed-unmerged PR -> skip, surfaced (AC2)', () => {
  assert.deepStrictEqual(decideReap({ number: 5, state: 'CLOSED' }), { action: 'skip', reason: 'pr-closed-unmerged' });
});
test('decideReap: open PR -> skip, reason pr-open (AC2)', () => {
  assert.deepStrictEqual(decideReap({ number: 5, state: 'OPEN' }), { action: 'skip', reason: 'pr-open' });
});
test('decideReap: no PR at all -> skip, reason no-pr', () => {
  assert.deepStrictEqual(decideReap(null), { action: 'skip', reason: 'no-pr' });
});
test('decideReap: gh absent / network failure are distinguished, never silently collapsed', () => {
  assert.deepStrictEqual(decideReap('gh-absent'), { action: 'skip', reason: 'gh-absent' });
  assert.deepStrictEqual(decideReap('network-failure'), { action: 'skip', reason: 'network-failure' });
});

test('decideRelease: only live/stale claims are ever candidates for release', () => {
  assert.strictEqual(decideRelease('absent', { number: 1, state: 'MERGED' }).action, 'skip');
  assert.strictEqual(decideRelease('tombstone', { number: 1, state: 'MERGED' }).action, 'skip');
  assert.strictEqual(decideRelease('unreadable', { number: 1, state: 'MERGED' }).action, 'skip');
});
test('decideRelease: live claim + merged PR -> release', () => {
  const r = decideRelease('live', { number: 7, state: 'MERGED' });
  assert.strictEqual(r.action, 'release');
  assert.match(r.reason, /#7/);
});
test('decideRelease: stale claim + merged PR -> release (idempotence path)', () => {
  assert.strictEqual(decideRelease('stale', { number: 7, state: 'MERGED' }).action, 'release');
});
test('decideRelease: live claim + open PR -> skip, never released', () => {
  assert.deepStrictEqual(decideRelease('live', { number: 7, state: 'OPEN' }), { action: 'skip', reason: 'pr-open' });
});

// #1130: archiveMerged only ever iterates NON-terminal runs, so a missing
// console.json here always means wrap-up never rendered a console for this
// run — not the empty-console fast path, which ends with close-run (status
// clean) + the archive-run verb and never reaches this sweep. Archiving on
// 'none' swept live runs with pending staged decisions (the #657 incident).
test('decideArchive: merged + console never rendered -> skip, not archive', () => {
  assert.deepStrictEqual(
    decideArchive({ number: 3, state: 'MERGED' }, 'none'),
    { action: 'skip', reason: 'console-never-rendered' },
  );
});
test('decideArchive: merged + console resolved -> archive', () => {
  assert.deepStrictEqual(decideArchive({ number: 3, state: 'MERGED' }, 'resolved'), { action: 'archive' });
});
test('decideArchive: merged + console UNresolved -> never archived', () => {
  assert.deepStrictEqual(decideArchive({ number: 3, state: 'MERGED' }, 'unresolved'), { action: 'skip', reason: 'console-unresolved' });
});
test('decideArchive: PR not merged -> never archived regardless of console state', () => {
  assert.strictEqual(decideArchive({ number: 3, state: 'OPEN' }, 'resolved').action, 'skip');
});

test('readConsoleState: absent file reads as none, not unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  assert.strictEqual(readConsoleState(dir), 'none');
});
test('readConsoleState: {resolved:true} reads as resolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true }));
  assert.strictEqual(readConsoleState(dir), 'resolved');
});
test('readConsoleState: unparseable content fails closed to unresolved, never silently archived', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), '{not json');
  assert.strictEqual(readConsoleState(dir), 'unresolved');
});
// #1130: no production path writes `resolved` (`_shared/console-execution.md`'s
// Write order only ever stamped `executedAt`) — `readConsoleState` gating
// solely on `resolved === true` made the archive branch unreachable for
// every real console-carrying run. A non-empty `executedAt` is
// console-execution's own completion stamp and must read as 'resolved' too.
test('readConsoleState: {executedAt} with no resolved field reads as resolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ executedAt: '2026-08-20T10:00:00Z' }));
  assert.strictEqual(readConsoleState(dir), 'resolved');
});
test('readConsoleState: {} (neither resolved nor executedAt) reads as unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({}));
  assert.strictEqual(readConsoleState(dir), 'unresolved');
});
// #1130 review: a whitespace-only executedAt is not a completion stamp — the
// acceptance check trims before testing length, so it fails closed.
test('readConsoleState: whitespace-only executedAt reads as unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ executedAt: '   ' }));
  assert.strictEqual(readConsoleState(dir), 'unresolved');
});

// #1130: gh can report MERGED before the local main checkout has
// fast-forwarded to include the merge commit. Archiving then moves only the
// gitignored half (work/ arrives via the merge) — the #657 symptom.
test('localHasMerge: merge commit not in local history -> false; present -> true; unknown oid shape -> null', () => {
  const root = gitRepo();
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.strictEqual(localHasMerge(root, { oid: head }), true);
  assert.strictEqual(localHasMerge(root, { oid: 'f'.repeat(40) }), false);
  assert.strictEqual(localHasMerge(root, null), null);
  assert.strictEqual(localHasMerge(root, {}), null);
});

// --- archiveRunDir: real git fixture — the actual move/commit I/O, not just the pure decision table ---

function runDirFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-archive-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);

  const runId = '2026-08-14T120000-spec-999';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '999-spec.md'), '# 999\n');
  git(['add', path.join('.claude-tweaks', 'pipelines', runId, 'work', '999-spec.md')], root);
  git(['commit', '-q', '-m', 'materialize #999'], root);

  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: '/some/worktree' }));

  return { root, runDir, runId };
}

test('archiveRunDir: the git mv of work/ is committed, not left staged (no uncommitted rename after archival)', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const archivedWorkRel = path.relative(root, path.join(archiveDir, 'work'));
  const oldWorkRel = path.relative(root, path.join(runDir, 'work'));
  assert.ok(fs.existsSync(path.join(archiveDir, 'work', '999-spec.md')));
  assert.ok(!fs.existsSync(path.join(runDir, 'work')));
  // config.yml/decisions.md/run-state.json are plain (never git-tracked, same
  // as .gitignore's real-repo rule) — only the git-mv'd work/ path is checked
  // for cleanliness here, since that's the actual write this test pins.
  assert.strictEqual(git(['status', '--porcelain', '--', archivedWorkRel, oldWorkRel], root).trim(), '');
  assert.strictEqual(git(['ls-files', '--', archivedWorkRel], root).trim(),
    path.join(archivedWorkRel, '999-spec.md'));
  assert.match(git(['log', '-1', '--format=%s'], root).trim(), /archive run/);
});

test('archiveRunDir: run-state.json moves to the archived location with status: clean, not left orphaned at the old path', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const archived = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.strictEqual(archived.status, 'clean');
  assert.strictEqual(archived.worktree, null);
  assert.ok(!fs.existsSync(path.join(runDir, 'run-state.json')));
});

test('archiveRunDir: the old run dir is removed once empty — a later iterRunDirsWithState pass never re-yields it', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { iterRunDirsWithState } = require('../plugin/bin/lib/hooks/context');
  const { root, runDir } = runDirFixture();

  archiveRunDir(root, runDir);
  assert.ok(!fs.existsSync(runDir));
  assert.deepStrictEqual([...iterRunDirsWithState(root)], []);
});

test('archiveRunDir: enumeration archives files the fixed list never named (engine-state.json, extra.txt)', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'extra.txt'), 'hello\n');

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'engine-state.json')));
  assert.ok(fs.existsSync(path.join(archiveDir, 'extra.txt')));
  assert.ok(!fs.existsSync(runDir));
});

test('archiveRunDir: movedEntries reflects the real enumerated set, not a fixed list', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), '{}');

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);
  assert.ok(Array.isArray(result.movedEntries));
  assert.ok(result.movedEntries.includes('work'));
  assert.ok(result.movedEntries.includes('config.yml'));
  assert.ok(result.movedEntries.includes('engine-state.json'));
  // Never a hardcoded name that wasn't actually present in this fixture.
  assert.ok(!result.movedEntries.includes('manifest.yml'));
});

test('archiveRunDir: a run dir with no work/ still archives cleanly', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();
  fs.rmSync(path.join(runDir, 'work'), { recursive: true, force: true });
  git(['add', '-u'], root);
  git(['commit', '-q', '-m', 'remove work for fixture'], root);

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archiveRunDir: re-running over a partially-archived dir is idempotent', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();

  const first = archiveRunDir(root, runDir);
  assert.strictEqual(first.ok, true);
  // runDir is gone after a clean archival — re-run against the same (now
  // nonexistent) path exercises the fs.existsSync guards' no-op behavior.
  const second = archiveRunDir(root, runDir);
  assert.strictEqual(second.ok, true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archiveRunDir: a git-tracked non-work file in the run dir refuses with reason tracked-entry', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'accidentally track a stray file'], root);

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'tracked-entry');
  // Refusal is total — nothing else got moved either.
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')));
  assert.ok(fs.existsSync(path.join(runDir, 'tracked-stray.md')));
});

test('archiveRunDir: an unreadable run dir returns reason readdir-failed instead of throwing', skipUnderRoot('root ignores directory permissions'), () => {
  // Review finding #902: a TOCTOU between the existsSync guard and the
  // readdirSync enumeration (dir deleted/permission-changed in between)
  // must not crash the caller — hooks.js's archive-run verb has no
  // try/catch of its own around this call.
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.chmodSync(runDir, 0o000);
  try {
    const result = archiveRunDir(root, runDir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'readdir-failed');
  } finally {
    fs.chmodSync(runDir, 0o755);
  }
});

// --- isOrphanedMint / archiveOrphanedMint: dispatch-minted dirs that never got adopted by flow ---

function bareRepoRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-orphan-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  return root;
}

function mintEmptyRunDir(root, runId, { ageMs = 0 } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(dir, { recursive: true });
  if (ageMs) {
    const backdated = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, backdated, backdated);
  }
  return dir;
}

test('isOrphanedMint: false when config.yml exists, regardless of age', () => {
  const { isOrphanedMint, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-01T000000-record-999', { ageMs: ORPHAN_MINT_TTL_MS * 2 });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
  assert.strictEqual(isOrphanedMint(dir), false);
});

test('isOrphanedMint: false when empty but within the grace window', () => {
  const { isOrphanedMint } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-15T000000-record-999');
  assert.strictEqual(isOrphanedMint(dir), false);
});

test('isOrphanedMint: true when empty (no config.yml) and older than the TTL', () => {
  const { isOrphanedMint, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-01T000000-record-999', { ageMs: ORPHAN_MINT_TTL_MS + 60000 });
  assert.strictEqual(isOrphanedMint(dir), true);
});

test('archiveMerged: an orphaned mint older than the TTL is archived on the next sweep, not left in place', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T120000-record-999';
  mintEmptyRunDir(root, runId, { ageMs: ORPHAN_MINT_TTL_MS + 60000 });

  const result = archiveMerged({ cwd: root });

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(archiveDir), 'orphaned mint should be moved to the archive path');
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', runId)), 'original mint dir should no longer exist');
  assert.ok(result.archived.includes(path.join(root, '.claude-tweaks', 'pipelines', runId)));
});

test('archiveMerged: an orphaned mint within the TTL is left in place, not archived', () => {
  const { archiveMerged } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-15T120000-record-999';
  const dir = mintEmptyRunDir(root, runId);

  archiveMerged({ cwd: root });

  assert.ok(fs.existsSync(dir), 'a fresh mint should not be swept before the grace window elapses');
});

// --- #1117: -adhoc-standalone mints (post-tool-use.js's stampAdHocRunDir)
// are exempt from the blind isOrphanedMint mtime sweep — see
// archive-merged.js's isAdHocStandaloneMint.

test('isOrphanedMint: false for a genuine adhoc-standalone mint, regardless of age (#1117)', () => {
  const { isOrphanedMint, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-01T000000-adhoc-standalone', { ageMs: ORPHAN_MINT_TTL_MS * 3 });
  writeRunState(dir, { worktree: path.join(root, 'some-worktree'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isOrphanedMint(dir), false);
});

// #1604: the suffix alone is no longer sufficient — isAdHocStandaloneMint
// now also requires a real run-state.json carrying a non-empty `worktree`,
// closing the leak a malformed/mkdir-only dir sharing the suffix used to
// slip through (both isOrphanedMint's exemption and decideArchive's
// no-worktree/no-branch skip).
test('isAdHocStandaloneMint: requires the suffix AND a corroborating run-state.json worktree field (#1604)', () => {
  const { isAdHocStandaloneMint } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();

  const genuine = mintEmptyRunDir(root, '2026-08-01T000000-adhoc-standalone');
  writeRunState(genuine, { worktree: path.join(root, 'wt'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(genuine), true);

  const wrongSuffix = mintEmptyRunDir(root, '2026-08-01T000100-record-999');
  writeRunState(wrongSuffix, { worktree: path.join(root, 'wt'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(wrongSuffix), false);

  const extraSuffix = mintEmptyRunDir(root, '2026-08-01T000200-adhoc-standalone-extra');
  writeRunState(extraSuffix, { worktree: path.join(root, 'wt'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(extraSuffix), false);

  const noRunState = mintEmptyRunDir(root, '2026-08-01T000300-adhoc-standalone');
  assert.strictEqual(isAdHocStandaloneMint(noRunState), false, 'suffix alone, no run-state.json at all, must not be treated as ad-hoc');

  const noWorktreeField = mintEmptyRunDir(root, '2026-08-01T000400-adhoc-standalone');
  writeRunState(noWorktreeField, { status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(noWorktreeField), false, 'a run-state.json with no worktree field must not be treated as ad-hoc');
});

test('archiveMerged: an adhoc-standalone mint past the orphan TTL is left in place, not archived (#1117)', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();
  const runId = '2026-08-01T120000-adhoc-standalone';
  const dir = mintEmptyRunDir(root, runId, { ageMs: ORPHAN_MINT_TTL_MS * 3 });
  // A real ad-hoc dir's run-state.json always carries a `worktree` (stampAdHocRunDir) —
  // an arbitrary non-registered path here, so archiveMerged's merged-PR branch skips on
  // 'no-branch' without shelling out to `gh`, deliberately distinct from a genuine
  // orphaned mint (which has no run-state.json at all).
  writeRunState(dir, { worktree: path.join(root, 'nonexistent-worktree'), status: 'active', sessionId: 'sess-1' });

  const result = archiveMerged({ cwd: root });

  assert.ok(fs.existsSync(dir), 'adhoc-standalone mint should NOT be archived by the mtime orphan sweep');
  assert.ok(!result.archived.includes(dir));
  assert.ok(result.skipped.some((s) => s.runDir === dir && s.reason === 'no-branch'));
});

test('findRunsByWorktreePath still finds an adhoc-standalone dir after a reconcile sweep has run against it (#1117)', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState, findRunsByWorktreePath } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();
  const runId = '2026-08-01T130000-adhoc-standalone';
  const dir = mintEmptyRunDir(root, runId, { ageMs: ORPHAN_MINT_TTL_MS * 3 });
  const worktreePath = path.join(root, 'nonexistent-worktree');
  writeRunState(dir, { worktree: worktreePath, status: 'active', sessionId: 'sess-1' });

  archiveMerged({ cwd: root });

  const found = findRunsByWorktreePath(root, worktreePath, null);
  assert.ok(
    found.some((r) => r.runDir === dir),
    "the Friction lens's read path (bin/friction-events.js -> findRunsByWorktreePath) must still find the adhoc dir's events after the sweep",
  );
});

// --- #1604: isAdHocStandaloneSuperseded / archiveMerged's eventual-cleanup
// path for a genuinely superseded ad-hoc dir (worktree definitively gone) ---
//
// writeRunState() creates a file inside `dir`, which bumps the DIRECTORY's
// own mtime back to "now" — so any backdating must happen AFTER writing
// run-state.json, never via mintEmptyRunDir's own `ageMs` (which backdates
// before run-state.json exists, and gets silently undone).
function mintAdHocDir(root, runId, state, ageMs) {
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const dir = mintEmptyRunDir(root, runId);
  writeRunState(dir, state);
  if (ageMs) {
    const backdated = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, backdated, backdated);
  }
  return dir;
}

test('isAdHocStandaloneSuperseded: false while the recorded worktree still resolves, regardless of age (#1117 invariant unchanged)', () => {
  const {
    isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  // realpathSync(os.tmpdir()) — not the not-yet-created wtDir itself — since
  // macOS's /var is a symlink to /private/var and `git worktree list
  // --porcelain` always reports the resolved form; path.resolve() alone
  // does not resolve symlinks, so an unresolved wtDir would never match.
  const wtDir = path.join(fs.realpathSync(os.tmpdir()), `ct-recon-adhoc-wt-${Date.now()}`);
  git(['worktree', 'add', '-b', 'adhoc-live', wtDir], root);
  try {
    const state = { worktree: wtDir, status: 'active', sessionId: 'sess-1' };
    const dir = mintAdHocDir(root, '2026-08-01T140000-adhoc-standalone', state, ADHOC_SUPERSEDED_TTL_MS * 3);
    const { parseWorktreeList } = require('../plugin/bin/lib/hooks/worktree-reap');
    const { runGit } = require('../plugin/bin/lib/hooks/git-exec');
    const worktrees = parseWorktreeList(runGit(['worktree', 'list', '--porcelain'], root).stdout);
    assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, worktrees), false);
  } finally {
    git(['worktree', 'remove', '--force', wtDir], root);
  }
});

test('isAdHocStandaloneSuperseded: false when the worktree is gone but younger than the TTL', () => {
  const { isAdHocStandaloneSuperseded } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, '2026-08-01T150000-adhoc-standalone', state, 60 * 60 * 1000);
  assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, []), false);
});

test('isAdHocStandaloneSuperseded: true when the worktree is gone AND the TTL has elapsed', () => {
  const {
    isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, '2026-08-01T160000-adhoc-standalone', state, ADHOC_SUPERSEDED_TTL_MS * 2);
  assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, []), true);
});

test('isAdHocStandaloneSuperseded: false for a non-ad-hoc dir even past the TTL with a gone worktree', () => {
  const {
    isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, '2026-08-01T170000-record-42', state, ADHOC_SUPERSEDED_TTL_MS * 2);
  assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, []), false);
});

test('archiveMerged: a superseded ad-hoc-standalone dir is archived (moved out of the live pipelines dir), ending the SessionStart/probePipelineRuns nag (#1604)', () => {
  const { archiveMerged, ADHOC_SUPERSEDED_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T180000-adhoc-standalone';
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, runId, state, ADHOC_SUPERSEDED_TTL_MS * 2);

  const result = archiveMerged({ cwd: root });

  assert.ok(!fs.existsSync(dir), 'superseded ad-hoc dir must no longer sit in the live pipelines/ directory');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), 'it must have been moved to the archive/ location');
  assert.ok(result.archived.includes(dir));
});

test('archiveMerged: a still-live ad-hoc-standalone dir (worktree exists) is never swept, no matter how old (#1117 regression guard)', () => {
  const { archiveMerged, ADHOC_SUPERSEDED_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const wtDir = path.join(fs.realpathSync(os.tmpdir()), `ct-recon-adhoc-wt2-${Date.now()}`);
  git(['worktree', 'add', '-b', 'adhoc-live-2', wtDir], root);
  try {
    const runId = '2026-08-01T190000-adhoc-standalone';
    const state = { worktree: wtDir, status: 'active', sessionId: 'sess-1' };
    const dir = mintAdHocDir(root, runId, state, ADHOC_SUPERSEDED_TTL_MS * 3);

    const result = archiveMerged({ cwd: root });

    assert.ok(fs.existsSync(dir), 'a still-live ad-hoc dir must never be archived by the superseded sweep');
    assert.ok(!result.archived.includes(dir));
  } finally {
    git(['worktree', 'remove', '--force', wtDir], root);
  }
});

// --- isWorktreeLocked: reused verbatim from worktree-reap.js (not a copy) ---

test('isWorktreeLocked: a plain unlocked linked worktree is not locked', () => {
  const { originDir, mainDir } = pairedFixture();
  const wtDir = path.join(os.tmpdir(), `ct-recon-wt-${Date.now()}`);
  git(['worktree', 'add', '-b', 'feature-x', wtDir], mainDir);
  try {
    assert.strictEqual(isWorktreeLocked(wtDir, { cwd: mainDir }), false);
  } finally {
    git(['worktree', 'remove', '--force', wtDir], mainDir);
    void originDir;
  }
});

test('isWorktreeLocked: a path not registered in git worktree list at all is not locked (nothing to lock)', () => {
  const { mainDir } = pairedFixture();
  assert.strictEqual(isWorktreeLocked('/nonexistent/path/xyz', { cwd: mainDir }), false);
});

// --- reconcile() orchestrator: offline degradation and model gating ---

test('reconcile: local-merge project falls back to the legacy ancestry reap, skips mirror/release/archive (AC4-adjacent)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-lm-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  // No remote at all (truly no-forge) — integration-branch: must be explicit
  // in policy.yml for resolveIntegrationBranch to succeed, since there is no
  // origin/HEAD to fall back to. The legacy ancestry reap still needs a
  // resolved integration branch name regardless of forge reachability.
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'policy.yml'),
    'integration-model: local-merge\nintegration-branch: main\n',
  );

  const r = await reconcile({ cwd: dir });
  assert.strictEqual(r.mirror, null);
  assert.deepStrictEqual(r.worktrees, []); // legacy reap ran, found zero worktrees to consider
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,archive,archive-branches,remote-prune,console', reason: 'local-merge-model' }]);
});

test('reconcile: local-merge with no resolvable integration branch at all resolves no-remote, never crashes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-lm-noib-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\n');
  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile: no network / no remote resolves to no-remote, never crashes (AC4)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-noremote-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile: outside any repo resolves to no-repo, never crashes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-norepo-'));
  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-repo' }]);
});

test('reconcile: a non-canonical (dash-less) run-dir name is surfaced, never silently omitted (#848)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-noncanon-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines', '20260817T173343-spec-764'), { recursive: true });
  // No remote configured, same as the no-remote fixture above — the
  // non-canonical-run-dir report must appear ahead of (not instead of) the
  // no-remote skip, since it runs before that gate.
  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [
    { check: 'all', reason: 'non-canonical-run-dir', names: ['20260817T173343-spec-764'] },
    { check: 'all', reason: 'no-remote' },
  ]);
});

test('reconcile: checks filter excludes reap -> local-merge project runs nothing at all', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-checks-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'policy.yml'),
    'integration-model: local-merge\nintegration-branch: main\n',
  );

  const r = await reconcile({ cwd: dir, checks: ['mirror'] });
  // 'mirror' was requested but has no local-merge equivalent — nothing runs.
  assert.strictEqual(r.worktrees, null);
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,archive,archive-branches,remote-prune,console', reason: 'local-merge-model' }]);
});

test('reconcile: reap dispatches strictly after release and archive in source order (load-bearing, not incidental — #408)', () => {
  // release and archive both derive a run's branch from a live `git
  // worktree list`; reap physically removes worktrees. Running reap first
  // would starve release/archive of exactly the runs most likely to
  // qualify (a just-reaped worktree's PR is, by construction, merged).
  // Pinned structurally, the same way tests/hooks-gate-coverage.test.js
  // pins prose to code — a real ordering regression here has no other test
  // that would catch it without fabricating live PR/claim state.
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js'), 'utf8');
  const releaseIdx = src.indexOf("checks.includes('release')");
  const archiveIdx = src.indexOf("checks.includes('archive')");
  const reapIdx = src.lastIndexOf("checks.includes('reap')"); // the pr-first dispatch, not the local-merge fallback above it
  assert.ok(releaseIdx > 0 && archiveIdx > 0 && reapIdx > 0);
  assert.ok(releaseIdx < reapIdx, 'release must dispatch before reap');
  assert.ok(archiveIdx < reapIdx, 'archive must dispatch before reap');
});

test('reconcile: ALL_CHECKS includes red-tip immediately after mirror', () => {
  const { ALL_CHECKS } = require('../plugin/bin/lib/reconcile');
  const mirrorIdx = ALL_CHECKS.indexOf('mirror');
  assert.strictEqual(ALL_CHECKS[mirrorIdx + 1], 'red-tip', 'red-tip must be the entry immediately after mirror');
});

test('reconcile: red-tip dispatches immediately after mirror in source order (load-bearing — reads the ref mirror-ff just fetched)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js'), 'utf8');
  const mirrorIdx = src.indexOf("checks.includes('mirror')");
  const redTipIdx = src.indexOf("checks.includes('red-tip')");
  const consoleIdx = src.indexOf("checks.includes('console')");
  assert.ok(mirrorIdx > 0 && redTipIdx > 0 && consoleIdx > 0);
  assert.ok(mirrorIdx < redTipIdx, 'mirror must dispatch before red-tip');
  assert.ok(redTipIdx < consoleIdx, 'red-tip must dispatch before console');
});

// #820 review: sharedFetchOk alone can't distinguish "fetch ran and
// succeeded" from "fetch never ran" (it defaults to true) — a caller
// requesting red-tip without mirror/remote-prune must not silently read a
// never-refreshed local ref. Currently unreachable via FAST_CHECKS/
// BACKGROUND_CHECKS (both always pair red-tip with mirror), but the gate
// itself must hold regardless of which caller exercises it.
test('reconcile(): red-tip requested alone (no mirror/remote-prune) skips rather than reading a stale ref', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['red-tip'] });
    assert.equal(r.redTip, null, 'red-tip must never dispatch without a fetch this pass');
    assert.deepEqual(r.skipped, [{ check: 'red-tip', reason: 'no-fetch-this-pass' }]);
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
});

// --- hooks.js verb: garbage-stdin invariant + JSON shape (AC5) ---

// An isolated `pr-first` repo with no remote — every check skips as
// `no-remote`, so the verb's output shape is exercised without any live
// state being reachable.
function noRemoteFixture(slug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), slug));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  return dir;
}

test('reconcile verb: garbage stdin still exits 0 and prints valid JSON with --json', () => {
  // Always an isolated fixture cwd, never the ambient process cwd — a bare
  // `reconcile` with no cwd override would run for real against whatever
  // repo the test runner happens to be in (this project's own, under `npm
  // test`), including its real worktrees and claims-registry branch. The
  // module's own fail-safe design (isWorktreeLocked, no-PR skip) made that
  // safe when it happened once during authoring, but a test must not rely
  // on that — it must never reach live state in the first place.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-garbage-'));
  const r = runHook(['reconcile', '--json'], { input: '%%%not json%%%', cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-repo' }]);
});

test('reconcile verb: --mcp-reachable is accepted (#1558) — a no-remote fixture skips before it can matter', () => {
  const dir = noRemoteFixture('ct-recon-mcp-reachable-');
  const r = runHook(['reconcile', '--dry-run', '--json', '--mcp-reachable'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: --checks is accepted (#1543) — a no-remote fixture skips before it can matter', () => {
  const dir = noRemoteFixture('ct-recon-checks-');
  const r = runHook(['reconcile', '--dry-run', '--json', '--checks', 'mirror,release,archive'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: a missing/empty --checks value falls back to the ALL_CHECKS default (#1543)', () => {
  const dir = noRemoteFixture('ct-recon-checks-empty-');
  const r = runHook(['reconcile', '--dry-run', '--json', '--checks', ''], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: --dry-run --json is accepted and never mutates on a no-remote fixture', () => {
  const dir = noRemoteFixture('ct-recon-hook-');
  const r = runHook(['reconcile', '--dry-run', '--json'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(parsed.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: --json output is byte-for-byte JSON.stringify(out) + "\\n" (#638)', () => {
  const dir = noRemoteFixture('ct-recon-json-shape-');
  const r = runHook(['reconcile', '--dry-run', '--json'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(r.stdout, JSON.stringify(parsed) + '\n');
});

test('reconcile verb: no --json (new default) prints a compact summary, not the raw JSON census (#638)', () => {
  const dir = noRemoteFixture('ct-recon-compact-default-');
  const r = runHook(['reconcile', '--dry-run'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.throws(() => JSON.parse(r.stdout), 'default output must not be a parseable JSON object');
  assert.match(r.stdout, /^skipped: all — no-remote\n$/);
});

test('reconcile verb: compact default on a fixture with actions taken + a mix of skip reasons matches the aggregated format (#638)', () => {
  const result = {
    mirror: { state: 'behind', action: 'fast-forwarded' },
    redTip: null,
    worktrees: null,
    claims: [{ issueNumber: 1, action: 'released' }, { issueNumber: 2, action: 'released' }],
    runs: [
      { runDir: 'r1', action: 'archived' },
      { runDir: 'x1', action: 'skipped', reason: 'no-worktree' },
      { runDir: 'x2', action: 'skipped', reason: 'no-worktree' },
      { runDir: 'y1', action: 'skipped', reason: 'move-failed' },
      { runDir: 'z1', action: 'skipped', reason: 'pr-open' },
    ],
    branches: null,
    remoteBranches: null,
    console: null,
    skipped: [{ check: 'red-tip', reason: 'no-integration-ref' }],
  };
  const summary = formatSummary(result);
  assert.strictEqual(summary, [
    'mirror: fast-forwarded',
    'released: 2 claims',
    'archived: 1 run dir',
    'skipped: 4 run dirs (no-worktree 2, move-failed 1, pr-open 1)',
    'skipped: red-tip — no-integration-ref',
  ].join('\n'));
});

test('formatSummary: a skipped entry carrying names (non-canonical-run-dir, #848) lists them, not just the reason', () => {
  const result = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    branches: null, remoteBranches: null, console: null,
    skipped: [{ check: 'all', reason: 'non-canonical-run-dir', names: ['20260817T173343-spec-764'] }],
  };
  const summary = formatSummary(result);
  assert.strictEqual(summary, 'skipped: all — non-canonical-run-dir: 20260817T173343-spec-764');
});

test('reconcile verb: compact default separates branch entries from archive-branches.js\'s interleaved tag-aging entries in result.branches (#638)', () => {
  // archive-branches.js pushes both kind:'branch' and kind:'tag' entries into
  // the same result.branches array — a tag's own 'aged-out' action must not
  // be dropped (it matches neither the branch row's takenActions nor
  // skipActions), and a 'delete-failed' skip reason shared by both kinds
  // must disambiguate by unit rather than merging into one branch-labeled
  // count.
  const result = {
    mirror: null,
    redTip: null,
    worktrees: null,
    claims: null,
    runs: null,
    branches: [
      { name: 'worktree-record-1', kind: 'branch', action: 'delete', reason: 'cherry-equivalent' },
      { name: 'worktree-record-2', kind: 'branch', action: 'skip', reason: 'too-young' },
      { name: 'worktree-record-3', kind: 'branch', action: 'skip', reason: 'delete-failed' },
      { name: 'archive/worktree-record-9', kind: 'tag', action: 'aged-out', reason: '> 90d' },
      { name: 'archive/worktree-record-10', kind: 'tag', action: 'skip', reason: 'delete-failed' },
    ],
    remoteBranches: null,
    console: null,
    skipped: null,
  };
  const summary = formatSummary(result);
  assert.strictEqual(summary, [
    'archived: 1 branch',
    'aged out: 1 tag',
    'skipped: 3 items (too-young 1, delete-failed (branch) 1, delete-failed (tag) 1)',
  ].join('\n'));
});

test('reconcile(): returns a thenable (async contract) even when every check stays synchronous internally', async () => {
  const { originDir, mainDir } = pairedFixture();
  git(['remote', 'set-url', 'origin', 'https://example.invalid/nope.git'], mainDir); // no gh reachable, exercised as local-merge below is enough
  const p = reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.equal(typeof p.then, 'function', 'reconcile() must return a Promise');
  const r = await p;
  assert.equal(typeof r, 'object');
  void originDir;
});

// --- preflight (#820): one upfront gh-health check gates the whole set ---

// Writes .claude-tweaks/policy.yml via `seedDir` (commit + push), then pulls
// it into `mainDir` — so mainDir ends up both carrying the policy file AND
// clean/current with origin (classifyMirror reports 'dirty' over 'current'
// for ANY uncommitted change, tracked or not, which a direct writeFileSync
// straight into mainDir's working tree would trigger and mask mirror's real
// result under test).
function writePolicyViaSeedAndPull(seedDir, mainDir, contents) {
  fs.mkdirSync(path.join(seedDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, '.claude-tweaks', 'policy.yml'), contents);
  git(['add', '.claude-tweaks'], seedDir);
  git(['commit', '-q', '-m', 'policy'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  git(['pull', '-q', 'origin', 'main'], mainDir);
}

// #1558: reconcile() must forward its own `mcpReachable` option into
// integration-model resolution (the same deps-seam bin/resolve-policy.js's
// --mcp-reachable flag already threads into detectIntegrationModel), rather
// than resolving bare and silently downgrading to local-merge in a
// gh-absent-but-MCP-reachable sandbox. Uses the injectable
// `opts.resolveIntegrationModel` seam (test-only, mirrors the pattern
// pre-tool-use.js's own `deps.resolveIntegrationModel` override already
// uses) rather than a real gh-absent fixture, which would be fragile and
// environment-dependent.
test('reconcile(): forwards opts.mcpReachable into resolveIntegrationModel (#1558)', async () => {
  const { mainDir } = pairedFixture();
  const calls = [];
  const fakeResolveIntegrationModel = (root, opts) => {
    calls.push(opts);
    return opts && opts.mcpReachable ? 'pr-first' : 'local-merge';
  };
  await reconcile({ cwd: mainDir, resolveIntegrationModel: fakeResolveIntegrationModel, mcpReachable: true });
  await reconcile({ cwd: mainDir, resolveIntegrationModel: fakeResolveIntegrationModel });
  assert.deepStrictEqual(calls, [{ mcpReachable: true }, { mcpReachable: false }]);
});

test('reconcile(): a failing GitHub-health preflight skips every requested check in one entry, never per-check timeouts (D1)', async () => {
  const { seedDir, mainDir } = pairedFixture();
  // pairedFixture()'s origin is a bare local repo, not a GitHub remote, so
  // resolveIntegrationModel's forge-detection fallback would otherwise land
  // on local-merge (no gh-backed repo to detect) — force pr-first explicitly
  // so this test actually reaches the preflight, per the same pattern used
  // above at policy.yml: 'integration-model: pr-first\n'.
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  const originalAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: false, reason: 'github-unreachable' });
  // checks: ['mirror', 'release'] is the FAST_CHECKS shape (mirror,
  // remote-prune not requested, #872) — reconcile() runs the preflight via
  // ghHealthCheckAsync (concurrently with the shared fetch), not the sync
  // ghHealthCheck above, so both must be stubbed or the async twin would
  // reach a real `gh` call.
  preflight.ghHealthCheckAsync = async () => ({ ok: false, reason: 'github-unreachable' });
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'release'] });
    // mirror is pure git (mirror-ff.js never shells to `gh`) and is
    // deliberately excluded from the preflight gate — it still runs despite
    // a failing GitHub-health check, and pairedFixture()'s mainDir is a
    // fresh clone already current with origin (review finding: this gate
    // previously skipped mirror too).
    assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
    assert.equal(r.claims, null);
    assert.deepEqual(r.skipped, [{ check: 'release', reason: 'preflight-github-unreachable' }]);
  } finally {
    preflight.ghHealthCheck = original;
    preflight.ghHealthCheckAsync = originalAsync;
  }
});

test('reconcile(): checks: ["mirror"] alone never calls the GitHub-health preflight at all', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  let called = false;
  preflight.ghHealthCheck = () => { called = true; return { ok: false, reason: 'github-unreachable' }; };
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
    assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
    assert.deepEqual(r.skipped, []);
    assert.equal(called, false, 'a mirror-only request has no gh-dependent check, so preflight must never run');
  } finally {
    preflight.ghHealthCheck = original;
  }
});

// #873: session-start.js's inline FAST_CHECKS call and the detached
// reconcile-background child it spawns moments later each independently ran
// their own GitHub-health preflight. A recent sibling success should let a
// second reconcile() call skip re-probing.
test('reconcile(): reuses a very-recent successful health-check stamp instead of re-probing GitHub (#873)', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const { writeCache } = require('../plugin/bin/lib/reconcile/cache');
  const root = require('../plugin/bin/lib/hooks/worktree-detect').mainCheckoutRoot(mainDir);
  // Simulate a sibling process's health check having just succeeded.
  writeCache(root, { lastHealthCheckOkAt: Date.now() });

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  let called = false;
  preflight.ghHealthCheck = () => { called = true; return { ok: false, reason: 'github-unreachable' }; };
  preflight.ghHealthCheckAsync = async () => { called = true; return { ok: false, reason: 'github-unreachable' }; };
  try {
    // 'release' alone (no mirror/remote-prune) is gh-dependent but not the
    // FAST_CHECKS shape — exercises the sequential (non-Promise.all) branch.
    // releaseMerged() itself still attempts a real `gh` call downstream (this
    // fixture has no network/gh reachable), so `r.skipped` may legitimately
    // carry its own unrelated failure — only the preflight-specific skip
    // reason must never appear.
    const r = await reconcile({ cwd: mainDir, checks: ['release'] });
    assert.equal(called, false, 'a fresh health-check stamp must skip both the sync and async preflight calls');
    assert.ok(
      !r.skipped.some((s) => typeof s.reason === 'string' && s.reason.startsWith('preflight-')),
      `the reused-fresh preflight must not itself appear as a skip reason: ${JSON.stringify(r.skipped)}`,
    );
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
});

test('reconcile(): a real successful preflight stamps lastHealthCheckOkAt for a sibling process to reuse', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const { readCache } = require('../plugin/bin/lib/reconcile/cache');
  const root = require('../plugin/bin/lib/hooks/worktree-detect').mainCheckoutRoot(mainDir);
  assert.equal(readCache(root).lastHealthCheckOkAt, null, 'precondition: no prior stamp');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  const before = Date.now();
  try {
    await reconcile({ cwd: mainDir, checks: ['release'] });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  const stamped = readCache(root).lastHealthCheckOkAt;
  assert.equal(typeof stamped, 'number');
  assert.ok(stamped >= before, 'stamp must be set at (or after) this pass, not stale');
});

// #820 Task 10's exact regression shape, re-applied to this new mechanism: a
// `lastRunAt` stamp from an unrelated pass must never be misread as preflight
// freshness — the two fields are deliberately independent (cache.js's own
// `isFresh(cache, now, ttl, field)` generalization), so a stamp that only
// proves "some pass finished" can never silently starve a real health check.
test('reconcile(): a lastRunAt stamp alone (no lastHealthCheckOkAt) never substitutes for preflight freshness', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const { writeCache } = require('../plugin/bin/lib/reconcile/cache');
  const root = require('../plugin/bin/lib/hooks/worktree-detect').mainCheckoutRoot(mainDir);
  writeCache(root, { lastRunAt: Date.now() }); // no lastHealthCheckOkAt

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  let called = false;
  preflight.ghHealthCheck = () => { called = true; return { ok: true, reason: null }; };
  try {
    await reconcile({ cwd: mainDir, checks: ['release'] });
    assert.equal(called, true, 'a lastRunAt-only stamp must never be read as health-check freshness');
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
});

// --- wall-clock budget (#820): an exhausted budget skips the remainder ---

test('reconcile(): an exhausted wall-clock budget skips every remaining check in one entry (D4)', async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the preflight test above: pairedFixture()'s origin is a
  // bare local repo, not a real GitHub remote, so resolveIntegrationModel's
  // detectIntegrationModel fallback resolves to local-merge and short-
  // circuits before the budget is ever created. Force pr-first explicitly so
  // this test actually reaches the budget guards.
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  // Must clear the preflight gate before the budget guard is even reached —
  // stub it to succeed rather than depending on a real `gh` call reaching
  // GitHub, which the test environment cannot guarantee.
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  // checks: ['mirror', 'red-tip'] is the FAST_CHECKS shape (#872) —
  // reconcile() runs the preflight via ghHealthCheckAsync (concurrently
  // with the shared fetch) for this shape, not the sync ghHealthCheck
  // stubbed above, so both must be stubbed to avoid a real `gh` call.
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  budgetMod.createBudget = () => ({ exceeded: () => true, remainingMs: () => 0 });
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'] });
    assert.deepEqual(r.skipped, [{ check: 'mirror,red-tip', reason: 'budget-exceeded' }]);
  } finally {
    budgetMod.createBudget = original;
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
});

// --- shared fetch (#820 D2): mirror and remote-prune merge into one fetch ---

test('reconcile(): mirror and remote-prune share one fetch, not two (D2)', async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the preflight/budget tests above: pairedFixture()'s
  // origin is a bare local repo, not a real GitHub remote. Committed (not
  // left as an untracked file) — unlike the preflight/budget tests, THIS
  // test needs classifyMirror to actually reach its fetch call (not bail
  // out early on `state: 'dirty'`), so `git status --porcelain` in mainDir
  // must read clean.
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  // NOT counted via a `gitExec.runGit = stub` swap: classify.js,
  // prune-remote.js, and shared-fetch.js each do
  // `const { runGit } = require('../hooks/git-exec')` once at module load,
  // which copies the function VALUE into a local const at that instant.
  // Reassigning `gitExec.runGit` afterward only changes what a fresh
  // `require('../hooks/git-exec').runGit` property lookup returns — every
  // already-bound local `runGit` inside those three modules keeps pointing
  // at the original function, so a stub swap silently never fires and the
  // count would read 0 (or pass by accident), not discriminate the merge.
  // (Verified empirically with a throwaway destructure/mutate/call repro:
  // the destructured binding never observed the module.exports reassignment.)
  // Counting at the process-spawn boundary instead — a `git` executable
  // placed first on PATH — needs no assumption about any module's import
  // style and observes every real `git fetch` invocation.
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-gitwrap-'));
  const logFile = path.join(wrapperDir, 'fetch-calls.log');
  fs.writeFileSync(logFile, '');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const wrapperPath = path.join(wrapperDir, 'git');
  // git-exec.js always calls execFileSync('git', ['-C', cwd, ...args]) — the
  // real subcommand (fetch, status, rev-list, ...) is always positional $3.
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nif [ "$3" = "fetch" ]; then\n  echo x >> "${logFile}"\nfi\nexec "${realGit}" "$@"\n`,
  );
  fs.chmodSync(wrapperPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror', 'remote-prune'] });
  } finally {
    process.env.PATH = originalPath;
    preflight.ghHealthCheck = originalHealth;
  }

  assert.deepEqual(r.skipped, [], `expected no skipped entries, saw ${JSON.stringify(r.skipped)}`);
  const fetchCalls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(fetchCalls, 1, `expected exactly one fetch, saw ${fetchCalls}`);
});

// --- shared fetch: shape scoped to the requested checks (#820 final review) ---
//
// FAST_CHECKS (mirror) and BACKGROUND_CHECKS (remote-prune) are provably
// disjoint, so each process must pay only for the fetch its own checks need:
// a narrow single-ref fetch under mirror's tight hot-path cap, or the broad
// `--prune` all-refs fetch on git-exec's own env-overridable budget.

// Installs a `git` shim first on PATH that appends every `git fetch`
// invocation's full argv to a log file, then execs the real git. Counting at
// the process-spawn boundary rather than stubbing `runGit` is load-bearing
// here for the same reason the D2 test above documents: classify.js,
// prune-remote.js, and shared-fetch.js each destructure `runGit` at module
// load, so a module-property stub would never be observed.
// Async so a caller may await real work inside the PATH swap: restoring PATH
// while an in-flight reconcile() still has fetches to issue would silently
// stop logging them, and the count assertion would pass for the wrong reason.
async function withFetchArgvLog(fn) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-fetchargv-'));
  const logFile = path.join(wrapperDir, 'fetch-argv.log');
  fs.writeFileSync(logFile, '');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const wrapperPath = path.join(wrapperDir, 'git');
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nif [ "$3" = "fetch" ]; then\n  echo "$*" >> "${logFile}"\nfi\nexec "${realGit}" "$@"\n`,
  );
  fs.chmodSync(wrapperPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  try {
    await fn();
  } finally {
    process.env.PATH = originalPath;
  }
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
}

test('sharedFetch: a mirror-only pass fetches the single integration ref, never --prune all-refs', async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const calls = await withFetchArgvLog(() => {
    const r = sharedFetch(mainDir, { integration: 'main', mirror: true, remotePrune: false });
    assert.equal(r.failure, null, 'the narrow fetch must succeed against the local bare origin');
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch origin main$/, `mirror-only must fetch a single ref, saw: ${calls[0]}`);
  assert.doesNotMatch(calls[0], /--prune/, 'mirror-only must not pay for a --prune all-refs fetch');
});

// sharedFetchAsync (#872) — the mirror-only async twin dispatched
// concurrently with ghHealthCheckAsync in reconcile/index.js's FAST_CHECKS
// shape. Same fetch shape as sharedFetch's mirror-only branch above, just
// non-blocking.

test('sharedFetchAsync: fetches the single integration ref, never --prune all-refs', async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetchAsync } = require('../plugin/bin/lib/reconcile/shared-fetch');
  let r;
  const calls = await withFetchArgvLog(async () => {
    r = await sharedFetchAsync(mainDir, { integration: 'main' });
    assert.equal(r.failure, null, 'the narrow fetch must succeed against the local bare origin');
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch origin main$/, `mirror-only must fetch a single ref, saw: ${calls[0]}`);
  assert.doesNotMatch(calls[0], /--prune/, 'mirror-only must not pay for a --prune all-refs fetch');
});

test('sharedFetchAsync: pins its own tight hot-path timeout — CT_HOOKS_GIT_TIMEOUT_MS cannot shrink it', async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetchAsync } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const original = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  process.env.CT_HOOKS_GIT_TIMEOUT_MS = '1';
  try {
    const r = await sharedFetchAsync(mainDir, { integration: 'main' });
    assert.equal(r.failure, null, 'the mirror shape must carry an explicit timeoutMs, which git-exec resolves ahead of the env override');
  } finally {
    if (original === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
    else process.env.CT_HOOKS_GIT_TIMEOUT_MS = original;
  }
});

test('sharedFetch: a remote-prune pass still fetches --prune all-refs', async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const calls = await withFetchArgvLog(() => {
    sharedFetch(mainDir, { integration: 'main', mirror: false, remotePrune: true });
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch --prune origin$/, `remote-prune must keep the --prune all-refs shape, saw: ${calls[0]}`);
});

test('sharedFetch: mirror + remote-prune together fall back to the broader --prune shape (superset serves both)', async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const calls = await withFetchArgvLog(() => {
    sharedFetch(mainDir, { integration: 'main', mirror: true, remotePrune: true });
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch --prune origin$/, `both-requested must widen, never narrow, saw: ${calls[0]}`);
});

// The two timeout halves of the same fix, proven by the one observable
// difference between "explicit timeoutMs" and "git-exec's own resolveTimeout":
// only the latter honors CT_HOOKS_GIT_TIMEOUT_MS (see git-exec.js's
// resolveTimeout — an explicit opts.timeoutMs short-circuits the env var).
// A 1ms budget cannot survive even a process spawn, so an honored override
// resolves to `timeout` and an ignored one resolves to a real fetch.
function withGitTimeoutOverride(ms, fn) {
  const original = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  process.env.CT_HOOKS_GIT_TIMEOUT_MS = String(ms);
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
    else process.env.CT_HOOKS_GIT_TIMEOUT_MS = original;
  }
}

test('sharedFetch: the remote-prune shape passes no explicit timeout — CT_HOOKS_GIT_TIMEOUT_MS still applies (Task 4\'s ruling, now pinned)', () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const r = withGitTimeoutOverride(1, () => sharedFetch(mainDir, { integration: 'main', mirror: false, remotePrune: true }));
  assert.equal(r.failure, 'timeout', 'a hardcoded timeoutMs on this shape would ignore the env override and let the fetch succeed');
});

test('sharedFetch: the mirror-only shape pins its own tight hot-path budget — CT_HOOKS_GIT_TIMEOUT_MS cannot shrink it', () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const r = withGitTimeoutOverride(1, () => sharedFetch(mainDir, { integration: 'main', mirror: true, remotePrune: false }));
  assert.equal(r.failure, null, 'the mirror shape must carry an explicit timeoutMs, which git-exec resolves ahead of the env override');
});

// The finding this fix answers is about the PRODUCTION wiring, not just
// sharedFetch's own signature: session-start.js's inline pass is what was
// paying for a --prune all-refs fetch it had no use for. Pin the whole path.
test('reconcile(): a FAST_CHECKS pass (session-start\'s inline hot path) issues only the narrow single-ref fetch', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  // FAST_CHECKS is exactly the shape (#872) that runs the preflight via
  // ghHealthCheckAsync, concurrently with the shared fetch — stub both or
  // the async twin reaches a real `gh` call.
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  const { FAST_CHECKS } = require('../plugin/bin/lib/hooks/session-start');
  let calls;
  try {
    calls = await withFetchArgvLog(() => reconcile({ cwd: mainDir, checks: FAST_CHECKS }));
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
  assert.equal(calls.length, 1, `expected exactly one fetch on the fast path, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch origin main$/, `the inline hot path must not pay for --prune, saw: ${calls[0]}`);
});

// AC (#872): FAST_CHECKS runs ghHealthCheckAsync and the shared fetch
// concurrently via Promise.all, not serially. Proven by an artificially
// slow preflight: a real (fast, local) git fetch running concurrently with
// it makes total elapsed time track the SLOWER of the two (the preflight
// delay), not their sum — a regression back to the old serial order would
// add the fetch's own time on top.
test('reconcile(): FAST_CHECKS runs the preflight and the shared fetch concurrently, not serially (#872)', async () => {
  // #2499: this used to assert `elapsed < HEALTH_DELAY_MS * 2` (400ms) after
  // racing a real local `git fetch` (sharedFetchAsync) against a mocked,
  // artificially-delayed preflight — a wall-clock margin that flaked once
  // under full-suite machine load (measured 463ms) despite the isolated run
  // completing correctly. Widening the margin trades away the very
  // regression-detection power the test exists for (see the design note this
  // replaced), so instead assert overlap directly: record each call's own
  // [start, end] window and check they overlap. Concurrent dispatch always
  // overlaps; serial dispatch never does, regardless of host speed.
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  const HEALTH_DELAY_MS = 200;
  let healthStart = null;
  let healthEnd = null;
  preflight.ghHealthCheckAsync = () => {
    healthStart = Date.now();
    return new Promise((resolve) => {
      setTimeout(() => {
        healthEnd = Date.now();
        resolve({ ok: true, reason: null });
      }, HEALTH_DELAY_MS);
    });
  };

  // sharedFetchAsync (reconcile/shared-fetch.js) calls runGitAsync
  // (bin/lib/hooks/git-exec.js), which resolves `promisify(cp.execFile)`
  // fresh at call time — the same call-time-resolved property runGitAsync's
  // own timeout test already mocks — so wrapping `cp.execFile` here observes
  // the real fetch subprocess's actual start/end without faking its result.
  // The wrapper delegates to Node's real custom promisify implementation
  // (`execFile[promisify.custom]`) so the {stdout, stderr} shape runGitAsync
  // depends on is preserved exactly; only the timing is instrumented.
  const cp = require('child_process');
  const { promisify } = require('util');
  const originalExecFile = cp.execFile;
  const originalCustomPromisify = originalExecFile[promisify.custom];
  let fetchStart = null;
  let fetchEnd = null;
  function execFileWrapper(...args) {
    return originalExecFile(...args);
  }
  execFileWrapper[promisify.custom] = (...args) => {
    fetchStart = Date.now();
    return originalCustomPromisify(...args).finally(() => {
      fetchEnd = Date.now();
    });
  };
  cp.execFile = execFileWrapper;

  const { FAST_CHECKS } = require('../plugin/bin/lib/hooks/session-start');
  try {
    await reconcile({ cwd: mainDir, checks: FAST_CHECKS });
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
    cp.execFile = originalExecFile;
  }
  assert.ok(healthStart !== null && healthEnd !== null, 'the preflight health check must have run');
  assert.ok(fetchStart !== null && fetchEnd !== null, 'the shared fetch must have run');
  assert.ok(
    healthStart < fetchEnd && fetchStart < healthEnd,
    `expected the preflight window [${healthStart}, ${healthEnd}] to overlap the fetch window [${fetchStart}, ${fetchEnd}] — a serial regression would not overlap`,
  );
});

// --- session-level freshness TTL short-circuit (#820, D7) ---

test('reconcile(): skipIfFresh=true short-circuits entirely when the cache is within TTL (D7)', async () => {
  const { mainDir } = pairedFixture();
  const cache = require('../plugin/bin/lib/reconcile/cache');
  cache.writeCache(mainDir, { lastRunAt: Date.now(), claimShas: {} });
  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipIfFresh: true });
  assert.deepEqual(r.skipped, [{ check: 'all', reason: 'fresh-cache' }]);
  assert.equal(r.mirror, null);
});

test('reconcile(): skipIfFresh=true runs normally when the cache is stale (past TTL)', async () => {
  const { mainDir } = pairedFixture();
  const cache = require('../plugin/bin/lib/reconcile/cache');
  cache.writeCache(mainDir, { lastRunAt: Date.now() - (60 * 60 * 1000), claimShas: {} });
  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipIfFresh: true });
  assert.notDeepEqual(r.skipped, [{ check: 'all', reason: 'fresh-cache' }]);
});

test('reconcile(): skipIfFresh defaults to false — omitting it always runs, cache or not (back-compat for every existing caller)', async () => {
  const { mainDir } = pairedFixture();
  const cache = require('../plugin/bin/lib/reconcile/cache');
  cache.writeCache(mainDir, { lastRunAt: Date.now(), claimShas: {} });
  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.notDeepEqual(r.skipped, [{ check: 'all', reason: 'fresh-cache' }]);
});

test('reconcile(): a real (non-short-circuited) pass stamps lastRunAt for the next skipIfFresh check', async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the preflight/budget/D2 tests above: pairedFixture()'s
  // origin is a bare local repo, not a real GitHub remote, so
  // resolveIntegrationModel's forge-detection fallback would otherwise land
  // on local-merge — whose early return (index.js's model !== 'pr-first'
  // branch) exits before the end-of-function stamp this test is checking.
  // Force pr-first explicitly, and commit policy.yml so `git status
  // --porcelain` reads clean (classifyMirror bails out early on a dirty
  // tree, before ever reaching the stamp).
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const cache = require('../plugin/bin/lib/reconcile/cache');
  const before = Date.now();
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  assert.deepEqual(r.skipped, [], `expected a fully-completed pass, saw ${JSON.stringify(r.skipped)}`);
  const after = cache.readCache(mainDir);
  assert.ok(after.lastRunAt >= before, 'lastRunAt must be stamped after a real pass');
});

// #644 review fix: `opts.skipCacheStamp` — `bin/hooks.js reconcile-summary`'s
// own internal `checks: ['mirror']` probe must NOT stamp the same
// `lastRunAt` key session-start.js's FAST_CHECKS call gates its
// `skipIfFresh` short-circuit on (D7, tested above) — otherwise every
// successful `/claude-tweaks:flow` closing report would make the next
// SessionStart within DEFAULT_TTL_MS believe its own mirror/red-tip/console
// pass already ran and skip it for real, silently suppressing red-tip's
// CI-failure surfacing.
test('reconcile(): skipCacheStamp=true completes a real pass without stamping lastRunAt', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const cache = require('../plugin/bin/lib/reconcile/cache');
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipCacheStamp: true });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  assert.deepEqual(r.skipped, [], `expected a fully-completed pass, saw ${JSON.stringify(r.skipped)}`);
  assert.equal(typeof r.mirror, 'object', 'the mirror check itself must still have run');
  const after = cache.readCache(mainDir);
  assert.equal(after.lastRunAt, null, 'lastRunAt must stay unstamped when skipCacheStamp is set');
});

test('reconcile(): skipCacheStamp=true does not disturb a real pass\'s residueSummary field', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipCacheStamp: true });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  assert.equal(typeof r.residueSummary, 'string', `expected a residueSummary string even with skipCacheStamp, got: ${JSON.stringify(r)}`);
  assert.match(r.residueSummary, /^reconcile: \d+ archived, \d+ stuck.*mirror ff /);
});

// AC1: reconcile() degrades within ~2s via the preflight when GitHub is
// unreachable, instead of accumulating every check's own 5-10s timeout.
test('AC1: a preflight failure resolves in well under the old per-check-timeout sum', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: false, reason: 'github-unreachable' });
  const start = Date.now();
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror', 'release', 'remote-prune', 'console'] });
  } finally {
    preflight.ghHealthCheck = original;
  }
  const elapsed = Date.now() - start;
  // Functional assertion: preflight gate produces exactly the expected skip
  // entry — mirror is excluded (pure git, no `gh` dependency) and still runs.
  assert.deepEqual(r.skipped, [{ check: 'release,remote-prune,console', reason: 'preflight-github-unreachable' }]);
  assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
  // Secondary timing assertion: the preflight-gated failure resolves quickly
  assert.ok(elapsed < 2500, `preflight-gated failure took ${elapsed}ms, expected well under 2.5s`);
});

// AC2: total wall-clock time is bounded by the explicit budget regardless
// of how much stale state exists.
test('AC2: an exhausted budget bounds total reconcile() time regardless of remaining check count', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  // Must clear the preflight gate before the budget guard is even reached
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  budgetMod.createBudget = () => ({ exceeded: () => true, remainingMs: () => 0 });
  const start = Date.now();
  try {
    await reconcile({ cwd: mainDir, checks: require('../plugin/bin/lib/reconcile').ALL_CHECKS });
  } finally {
    budgetMod.createBudget = original;
    preflight.ghHealthCheck = originalHealth;
  }
  assert.ok(Date.now() - start < 1000, 'a pre-exhausted budget must skip every check near-instantly');
});
