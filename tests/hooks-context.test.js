// tests/hooks-context.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ctx = require('../plugin/bin/lib/hooks/context');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hooks-'));
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines'), { recursive: true });
  return dir;
}
function mkRun(project, name, state) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  if (state) fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return run;
}

test('parseInput returns {} on garbage and non-objects', () => {
  assert.deepStrictEqual(ctx.parseInput('not json'), {});
  assert.deepStrictEqual(ctx.parseInput('42'), {});
  assert.deepStrictEqual(ctx.parseInput(''), {});
  assert.deepStrictEqual(ctx.parseInput('[1,2,3]'), {});
  assert.deepStrictEqual(ctx.parseInput('{"a":1}'), { a: 1 });
});

test('resolveRunDir prefers PIPELINE_RUN_DIR when it exists on disk', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  assert.strictEqual(ctx.resolveRunDir(project, { PIPELINE_RUN_DIR: run }), run);
  assert.strictEqual(ctx.resolveRunDir(project, { PIPELINE_RUN_DIR: '/nope' }), run);
});

test('resolveRunDir picks newest non-terminal, skips clean runs', () => {
  const project = tmpProject();
  const oldRun = mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  const cleanRun = mkRun(project, '2026-07-02T090000-spec-2', { status: 'clean' });
  assert.strictEqual(ctx.resolveRunDir(project, {}), oldRun);
  assert.ok(cleanRun); // silences unused warning; clean run must NOT be returned
});

test('resolveRunDir returns null with no pipelines dir', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bare-'));
  assert.strictEqual(ctx.resolveRunDir(bare, {}), null);
});

test('resolveRunDir falls through to the scan when PIPELINE_RUN_DIR points at a file, not a directory', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  const notADir = path.join(project, 'not-a-dir.txt');
  fs.writeFileSync(notADir, 'x');
  assert.strictEqual(ctx.resolveRunDir(project, { PIPELINE_RUN_DIR: notADir }), run);
});

test('listRunDirs returns non-terminal newest first', () => {
  const project = tmpProject();
  const a = mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  const b = mkRun(project, '2026-07-02T090000-spec-2');
  mkRun(project, '2026-07-03T090000-spec-3', { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project), [b, a]);
});

test('listRunDirs excludes the archive/ sibling (and other non-run-id-shaped dirs); resolveRunDir never resolves it', () => {
  const project = tmpProject();
  const live = mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  mkRun(project, 'archive'); // wrap-up archival destination; sorts AFTER ISO names lexically
  assert.deepStrictEqual(ctx.listRunDirs(project), [live]);
  assert.strictEqual(ctx.resolveRunDir(project, {}), live);
});

test('listRunDirs and resolveRunDir return empty/null when only archive/ exists', () => {
  const project = tmpProject();
  mkRun(project, 'archive');
  assert.deepStrictEqual(ctx.listRunDirs(project), []);
  assert.strictEqual(ctx.resolveRunDir(project, {}), null);
});

// #848: a dash-less mint (`date -u +%Y%m%dT%H%M%S` instead of the canonical
// `+%Y-%m-%dT%H%M%S`) is invisible to RUN_ID_RE — findNonCanonicalRunDirs is
// the surfacing half, so a caller (reconcile) can report it instead of
// silently omitting the run from every enumeration forever.
test('findNonCanonicalRunDirs finds a dash-less run-dir name', () => {
  const project = tmpProject();
  mkRun(project, '20260817T173343-spec-764');
  assert.deepStrictEqual(ctx.findNonCanonicalRunDirs(project), ['20260817T173343-spec-764']);
});

test('findNonCanonicalRunDirs ignores canonical run-dirs, archive/, and unrelated directories', () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  mkRun(project, 'archive');
  fs.mkdirSync(path.join(project, '.claude-tweaks', 'pipelines', 'not-a-run-dir'), { recursive: true });
  assert.deepStrictEqual(ctx.findNonCanonicalRunDirs(project), []);
});

test('findNonCanonicalRunDirs returns [] when the pipelines dir does not exist', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bare-'));
  assert.deepStrictEqual(ctx.findNonCanonicalRunDirs(bare), []);
});

test('listRunDirsWithState returns each non-terminal dir paired with its already-read state', () => {
  const project = tmpProject();
  const a = mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted', worktree: '/wt/a' });
  const b = mkRun(project, '2026-07-02T090000-spec-2'); // no run-state.json at all
  mkRun(project, '2026-07-03T090000-spec-3', { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirsWithState(project), [
    { dir: b, state: null },
    { dir: a, state: { status: 'interrupted', worktree: '/wt/a' } },
  ]);
});

// #1738: iterRunDirsWithState's opt-in `{ status: 'clean' }` filter — a
// widened yield the default output must not change at all (session-start.js's
// #1493 AC5 staged-proposals scan and archive-merged.js's #1544 clean-status
// sweep both share this instead of hand-rolling their own directory walks).
test('iterRunDirsWithState: default (no opts) excludes clean-status runs, unchanged', () => {
  const project = tmpProject();
  const active = mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  mkRun(project, '2026-07-02T090000-spec-2', { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project), [active]);
  assert.deepStrictEqual(ctx.listRunDirs(project, {}), [active]);
});

test("iterRunDirsWithState: { status: 'clean' } yields only clean-status runs", () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' });
  const clean = mkRun(project, '2026-07-02T090000-spec-2', { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project, { status: 'clean' }), [clean]);
});

test("iterRunDirsWithState: { status: 'clean' } excludes a dir with no run-state.json at all (state is null, not clean)", () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1'); // no run-state.json — readRunState returns null
  const clean = mkRun(project, '2026-07-02T090000-spec-2', { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project, { status: 'clean' }), [clean]);
});

// Both shapes must honor the archive-twin skip below the status check — a
// clean run whose archive twin is itself already 'clean' (fully archived)
// must not be double-reported by the { status: 'clean' } shape either.
test("iterRunDirsWithState: { status: 'clean' } honors the archive-twin skip (a fully-archived clean run is not re-yielded)", () => {
  const project = tmpProject();
  const runId = '2026-07-03T090000-spec-3';
  mkRun(project, runId, { status: 'clean' });
  mkRun(project, path.join('archive', runId), { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project, { status: 'clean' }), []);
});

test("iterRunDirsWithState: default shape also honors the archive-twin skip (unchanged)", () => {
  const project = tmpProject();
  const runId = '2026-07-04T090000-spec-4';
  mkRun(project, runId, { status: 'active' });
  mkRun(project, path.join('archive', runId), { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project), []);
});

// #593: defense in depth — a stray top-level dir whose archive twin already
// carries a terminal run-state.json (a filesystem-only, non-git-aware
// archival move, or a tracked work/ file resurrected by `git checkout`) must
// not be reported as unfinished/`status: unknown` forever. Checked at the
// shared iterator so every caller (resolveRun's fallback scan, session-
// start's report, the reconciler) benefits, not just session-start.js.
test('iterRunDirsWithState: stray dir with no local run-state.json is skipped when its archive/{name}/ twin is terminal', () => {
  const project = tmpProject();
  const runId = '2026-07-01T090000-spec-1';
  const stray = mkRun(project, runId); // no run-state.json — readRunState returns null
  const archiveTwin = mkRun(project, path.join('archive', runId), { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project), []);
  assert.strictEqual(ctx.resolveRunDir(project, {}), null);
  assert.ok(fs.existsSync(stray));
  assert.ok(fs.existsSync(archiveTwin));
});

test('iterRunDirsWithState: stray dir with a stale non-terminal run-state.json is still skipped when its archive twin is terminal', () => {
  const project = tmpProject();
  const runId = '2026-07-01T090000-spec-1';
  mkRun(project, runId, { status: 'active' }); // resurrected/stale local state
  mkRun(project, path.join('archive', runId), { status: 'clean' });
  assert.deepStrictEqual(ctx.listRunDirs(project), []);
});

test('iterRunDirsWithState: stray dir is still yielded when it has no archive twin at all', () => {
  const project = tmpProject();
  const genuinelyOpen = mkRun(project, '2026-07-01T090000-spec-1', { status: 'active' }); // no archive twin at all
  assert.deepStrictEqual(ctx.listRunDirs(project), [genuinelyOpen]);
});

// #1103 fix-wave-1: the existence-only check that used to make this pass
// (`isArchivedRunId`, an fs.existsSync/statSync check with no read of the
// twin's own run-state.json) is removed — it stranded ANY incomplete archive
// attempt (archiveRunDir creates archive/{run-id}/ via fs.mkdirSync as its
// very first action, before any content actually moves) as permanently
// "already archived" the instant that mkdirSync ran, even when the real
// content never moved — the literal double-nesting bug #1103 reports.
// Supersedes the #208 test this replaces: a non-terminal (or absent) archive
// twin state is no longer authoritative on its own — only a twin whose own
// run-state.json genuinely reads status: 'clean' (the content-aware check a
// few lines below in iterRunDirsWithState) hides the live run dir.
test('iterRunDirsWithState: a run-id present under archive/ with a non-terminal twin state is now yielded — the existence-only #208 skip was removed by #1103\'s fix-wave-1', () => {
  const project = tmpProject();
  const live = mkRun(project, '2026-07-02T090000-spec-2'); // stray active-side dir, no local run-state.json
  mkRun(project, path.join('archive', '2026-07-02T090000-spec-2'), { status: 'active' }); // resurrected/corrupted twin state
  assert.deepStrictEqual(ctx.listRunDirs(project), [live]);
});

// #1103 fix-wave-1 regression test: archiveRunDir's very first action is
// `fs.mkdirSync(archiveDir)` — before any content actually moves. If
// archival then fails for any reason, that empty archive/{run-id}/
// directory is left behind with no run-state.json of its own. This proves
// the run is NOT considered done just because an archive directory happens
// to exist — only a twin that genuinely reads status: 'clean' does that.
test('iterRunDirsWithState: an incomplete archive twin (exists but not status:clean) does not hide the live run dir', () => {
  const project = tmpProject();
  const runId = '2026-07-03T090000-spec-7';
  const live = mkRun(project, runId, { status: 'active' }); // real, still-open run
  mkRun(project, path.join('archive', runId)); // archiveRunDir's mkdirSync ran, then failed before any move — no run-state.json at all
  assert.deepStrictEqual(ctx.listRunDirs(project), [live]);
});

// #1103 second-round finding: removing the existence-only archive-twin skip
// (test above) widened a race — two concurrent, unlocked `reconcile`
// invocations (dispatch/tidy's own pre-step; only `reconcile-background`
// holds a lock) could both select the same merged run dir for archival
// before either's status:'clean' write lands. archiveRunDir now writes a
// content-aware 'archiving' claim the instant it mkdir's archiveDir — this
// proves a fresh claim still hides the run dir from a second scan.
test('iterRunDirsWithState: a fresh archiving claim on the archive twin hides the live run dir (concurrent-archival protection)', () => {
  const project = tmpProject();
  const runId = '2026-07-04T090000-spec-9';
  mkRun(project, runId, { status: 'active' });
  mkRun(project, path.join('archive', runId), { status: 'archiving', updatedAt: new Date().toISOString() });
  assert.deepStrictEqual(ctx.listRunDirs(project), []);
});

// The claim must expire — unlike the removed existence-only check, a claim
// left behind by a crashed or failed archival attempt must not strand the
// run dir forever. A 10-minute-old claim is well past the 5-minute TTL.
test('iterRunDirsWithState: a stale archiving claim (crashed attempt) does not hide the live run dir', () => {
  const project = tmpProject();
  const runId = '2026-07-04T090000-spec-10';
  const live = mkRun(project, runId, { status: 'active' });
  const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  mkRun(project, path.join('archive', runId), { status: 'archiving', updatedAt: staleTs });
  assert.deepStrictEqual(ctx.listRunDirs(project), [live]);
});

test('listRunDirs is derived from listRunDirsWithState (same dirs, same order)', () => {
  const project = tmpProject();
  const a = mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  const b = mkRun(project, '2026-07-02T090000-spec-2');
  assert.deepStrictEqual(ctx.listRunDirs(project), ctx.listRunDirsWithState(project).map((r) => r.dir));
  assert.deepStrictEqual(ctx.listRunDirs(project), [b, a]);
});

test('findRunsByWorktreePath returns every non-terminal run assigned to the worktree, newest first', () => {
  const project = tmpProject();
  const older = mkRun(project, '2026-07-01T090000-record-500-adhoc-standalone', { status: 'active', worktree: '/tmp/wt-a' });
  const newer = mkRun(project, '2026-07-02T090000-record-500-adhoc-standalone', { status: 'active', worktree: '/tmp/wt-a' });
  mkRun(project, '2026-07-03T090000-other-adhoc-standalone', { status: 'active', worktree: '/tmp/wt-b' });
  const result = ctx.findRunsByWorktreePath(project, '/tmp/wt-a');
  assert.deepStrictEqual(result.map((r) => r.runDir), [newer, older]);
});

test('findRunsByWorktreePath excludes excludeDir (the caller\'s own primary run dir)', () => {
  const project = tmpProject();
  const primary = mkRun(project, '2026-07-01T090000-spec-500', { status: 'active', worktree: '/tmp/wt-a' });
  const adhoc = mkRun(project, '2026-07-02T060000-adhoc-standalone', { status: 'active', worktree: '/tmp/wt-a' });
  const result = ctx.findRunsByWorktreePath(project, '/tmp/wt-a', primary);
  assert.deepStrictEqual(result.map((r) => r.runDir), [adhoc]);
});

// #1175: excludeDir was compared with a plain path.resolve() while `dir`
// (built from the already-realpath'd main-checkout root) is canonical — a
// symlink-spelled --run (macOS /tmp -> /private/tmp, or any symlinked repo
// parent) never matched, so the primary run's own events were never
// excluded and got re-emitted tagged `_source: 'adhoc'`.
test('#1175 findRunsByWorktreePath excludes excludeDir even when passed through a symlinked spelling', () => {
  const project = fs.realpathSync(tmpProject());
  const primary = mkRun(project, '2026-07-01T090000-spec-500', { status: 'active', worktree: '/tmp/wt-a' });
  const adhoc = mkRun(project, '2026-07-02T060000-adhoc-standalone', { status: 'active', worktree: '/tmp/wt-a' });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hooks-symlink-'));
  const alias = path.join(parent, 'alias');
  fs.symlinkSync(project, alias, 'dir');
  const excludeDirViaSymlink = path.join(alias, '.claude-tweaks', 'pipelines', path.basename(primary));
  const result = ctx.findRunsByWorktreePath(project, '/tmp/wt-a', excludeDirViaSymlink);
  assert.deepStrictEqual(result.map((r) => r.runDir), [adhoc]);
});

test('findRunsByWorktreePath returns [] when nothing matches or the path is empty', () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-record-1-adhoc-standalone', { status: 'active', worktree: '/tmp/wt-a' });
  assert.deepStrictEqual(ctx.findRunsByWorktreePath(project, '/tmp/no-match'), []);
  assert.deepStrictEqual(ctx.findRunsByWorktreePath(project, ''), []);
  assert.deepStrictEqual(ctx.findRunsByWorktreePath(project, null), []);
});

// #1177: rollbackMint was extracted from post-tool-use.js's inline
// staged/decisions.md/dir-removal sequence — pin its own behavior directly
// here rather than only transitively via post-tool-use's test suite.
test('rollbackMint: removes staged/, decisions.md, and the directory itself', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-record-500-adhoc-standalone');
  fs.mkdirSync(path.join(run, 'staged'));
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  ctx.rollbackMint(run);
  assert.ok(!fs.existsSync(run), 'the mint directory must be gone');
});

test('rollbackMint: each step is independently best-effort — a partial mint (no staged/) still removes decisions.md and the directory', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-02T090000-record-501-adhoc-standalone');
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  ctx.rollbackMint(run);
  assert.ok(!fs.existsSync(run), 'the mint directory must still be removed despite no staged/ subdirectory');
});

test('rollbackMint: never throws on a directory that does not exist at all', () => {
  const project = tmpProject();
  const missing = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-03T090000-record-502-adhoc-standalone');
  assert.doesNotThrow(() => ctx.rollbackMint(missing));
});

test('writeRunState merges, stamps updatedAt; readRunState round-trips', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1');
  ctx.writeRunState(run, { status: 'active', worktree: '/tmp/wt' });
  const next = ctx.writeRunState(run, { status: 'interrupted' });
  assert.strictEqual(next.status, 'interrupted');
  assert.strictEqual(next.worktree, '/tmp/wt');
  assert.ok(next.updatedAt);
  assert.strictEqual(ctx.readRunState(run).status, 'interrupted');
});

test('writeRunState with a function patch that returns null writes nothing', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-fn1');
  ctx.writeRunState(run, { status: 'active' });
  const file = path.join(run, 'run-state.json');
  const before = fs.readFileSync(file);
  const existing = ctx.readRunState(run);
  assert.deepStrictEqual(ctx.writeRunState(run, () => null), existing);
  assert.deepStrictEqual(ctx.writeRunState(run, () => undefined), existing);
  assert.ok(fs.readFileSync(file).equals(before));
});

test('writeRunState with a function patch sees the existing state', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-fn2', { a: 1 });
  let seen;
  const next = ctx.writeRunState(run, (existing) => { seen = existing; return { b: 2 }; });
  assert.deepStrictEqual(seen, { a: 1 });
  assert.strictEqual(next.a, 1);
  assert.strictEqual(next.b, 2);
  assert.ok(next.updatedAt);
  assert.deepStrictEqual(ctx.readRunState(run), next);
});

test('writeRunState with a function patch sees {} when no state exists', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-fn3');
  let seen;
  ctx.writeRunState(run, (existing) => { seen = existing; return { b: 2 }; });
  assert.deepStrictEqual(seen, {});
});

test('ownerBlock builds the owner block from injected deps', () => {
  const block = ctx.ownerBlock({
    sessionId: 's',
    env: {},
    now: Date.parse('2026-10-24T06:00:00Z'),
    deps: {
      hostname: () => 'h',
      resolveOwnerPid: () => ({ pid: 9, pidSource: 'env' }),
      pidStartTime: () => 'Sat Oct 24 08:08:15 2026',
    },
  });
  assert.deepStrictEqual(block, {
    sessionId: 's', host: 'h', pid: 9, pidSource: 'env',
    pidStartedAt: 'Sat Oct 24 08:08:15 2026', heartbeatAt: '2026-10-24T06:00:00.000Z',
  });
});

test('ownerBlock with an unknown pid has pidStartedAt null and never probes the start time', () => {
  let probed = false;
  const block = ctx.ownerBlock({
    sessionId: 's',
    env: {},
    now: Date.parse('2026-10-24T06:00:00Z'),
    deps: {
      hostname: () => 'h',
      resolveOwnerPid: () => ({ pid: null, pidSource: null }),
      pidStartTime: () => { probed = true; return 'x'; },
    },
  });
  assert.strictEqual(block.pid, null);
  assert.strictEqual(block.pidStartedAt, null);
  assert.strictEqual(probed, false);
});

test('AC2.4: ownerStampPatch never replaces another session\'s owner block', () => {
  const block = { sessionId: 'b', pid: 1 };
  const existing = { owner: { sessionId: 'a' } };
  assert.deepStrictEqual(ctx.ownerStampPatch(existing, 'b', block, { replacesSessionId: false }), {});
  assert.deepStrictEqual(ctx.ownerStampPatch(existing, 'b', block, { replacesSessionId: true }), { owner: block });
  assert.deepStrictEqual(ctx.ownerStampPatch(existing, 'a', { sessionId: 'a' }, { replacesSessionId: false }), { owner: { sessionId: 'a' } });
  assert.deepStrictEqual(ctx.ownerStampPatch(existing, undefined, block, { replacesSessionId: true }), {});
  assert.deepStrictEqual(ctx.ownerStampPatch(existing, '', block, { replacesSessionId: true }), {});
  assert.deepStrictEqual(ctx.ownerStampPatch({}, 'b', block, { replacesSessionId: false }), { owner: block });
});

test('patchWithOwnerBlock: no session id returns the bare patch; a session id returns a function that adds the block', () => {
  const patch = { worktree: '/w', status: 'active' };
  assert.strictEqual(ctx.patchWithOwnerBlock(patch, undefined), patch);
  assert.strictEqual(ctx.patchWithOwnerBlock(patch, ''), patch);
  const fn = ctx.patchWithOwnerBlock(patch, 'b');
  assert.strictEqual(typeof fn, 'function');
  const fresh = fn({});
  assert.strictEqual(fresh.worktree, '/w');
  assert.strictEqual(fresh.owner.sessionId, 'b');
  // Another session's block is left alone unless the caller is the adoption path.
  const foreign = { owner: { sessionId: 'a', pid: 1 } };
  assert.ok(!('owner' in fn(foreign)), 'a stamp from another session never takes over the block');
  assert.strictEqual(ctx.patchWithOwnerBlock(patch, 'b', { replacesSessionId: true })(foreign).owner.sessionId, 'b');
});

test('patchWithOwnerBlock: a failure building the owner block degrades to the bare patch, never costing the stamp', () => {
  const os = require('os');
  const real = os.hostname;
  os.hostname = () => { throw new Error('hostname exploded'); };
  try {
    const patch = { worktree: '/w', status: 'active' };
    assert.strictEqual(ctx.patchWithOwnerBlock(patch, 'b'), patch);
  } finally {
    os.hostname = real;
  }
});

// #3973: refreshOwnerBlock — heartbeat and re-stamp from the owner's own hooks.
const RT0 = Date.parse('2026-10-24T06:00:00Z');
const RT0_ISO = new Date(RT0).toISOString();
function refreshFixture(ownerOver = {}, { attribution = 'session', noOwner = false } = {}) {
  const project = tmpProject();
  const state = { sessionId: 's' };
  if (!noOwner) {
    state.owner = { sessionId: 's', host: 'h', pid: 100, pidSource: 'env', pidStartedAt: 'T100', heartbeatAt: RT0_ISO, ...ownerOver };
  }
  const dir = mkRun(project, '2026-07-01T090000-spec-1', state);
  return { dir, ownedRun: { dir, attribution } };
}
// Probes injected so no test depends on a real process: pid 100 / 200 start at 'T100' / 'T200'.
function refreshDeps({ cur = 100, alive = true, startOf = { 100: 'T100', 200: 'T200' } } = {}) {
  return {
    resolveOwnerPid: () => ({ pid: cur, pidSource: cur === null ? null : 'env' }),
    pidStartTime: (pid) => startOf[pid] ?? null,
    isPidAlive: () => alive,
    hostname: () => 'h',
  };
}
const refresh = (fx, { sessionId = 's', now = RT0, deps = refreshDeps(), restampWhileFresh } = {}) =>
  ctx.refreshOwnerBlock({ input: { session_id: sessionId }, ownedRun: fx.ownedRun }, { now, env: {}, deps, restampWhileFresh });
const ownerOf = (fx) => ctx.readRunState(fx.dir).owner;

test('AC2.1: a second owner event 30 s later leaves heartbeatAt unchanged', () => {
  const fx = refreshFixture();
  refresh(fx, { now: RT0 });
  assert.strictEqual(refresh(fx, { now: RT0 + 30_000 }), null);
  assert.strictEqual(ownerOf(fx).heartbeatAt, RT0_ISO);
});

test('#4150: inside the heartbeat window the owner block is never probed', () => {
  for (const cur of [100, 200]) {
    const fx = refreshFixture();
    const base = refreshDeps({ cur, alive: false });
    const counts = { resolveOwnerPid: 0, pidStartTime: 0, isPidAlive: 0 };
    const deps = {
      ...base,
      resolveOwnerPid: (env) => { counts.resolveOwnerPid++; return base.resolveOwnerPid(env); },
      pidStartTime: (pid) => { counts.pidStartTime++; return base.pidStartTime(pid); },
      isPidAlive: (pid) => { counts.isPidAlive++; return base.isPidAlive(pid); },
    };
    assert.strictEqual(refresh(fx, { now: RT0 + 30_000, deps }), null, `cur=${cur}`);
    assert.deepStrictEqual(counts, { resolveOwnerPid: 0, pidStartTime: 0, isPidAlive: 0 }, `cur=${cur}`);
    assert.deepStrictEqual(ownerOf(fx), { sessionId: 's', host: 'h', pid: 100, pidSource: 'env', pidStartedAt: 'T100', heartbeatAt: RT0_ISO }, `cur=${cur}`);
  }
});

test('#4150: outside the heartbeat window a dead different-pid owner is still re-stamped by default', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000, deps: refreshDeps({ cur: 200, alive: false }) }), 'restamp');
  assert.strictEqual(ownerOf(fx).pid, 200);
  assert.strictEqual(ownerOf(fx).pidStartedAt, 'T200');
});

test('#4150: restampWhileFresh keeps the in-window re-stamp of a resumed session', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 + 5_000, restampWhileFresh: true, deps: refreshDeps({ cur: 200, alive: false }) }), 'restamp');
  assert.strictEqual(ownerOf(fx).pid, 200);
});

test('#4150: a heartbeat stamped in the future (clock skew) is not fresh — the default path re-stamps a dead owner', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 - 30_000, deps: refreshDeps({ cur: 200, alive: false }) }), 'restamp');
  assert.strictEqual(ownerOf(fx).pid, 200);
  assert.strictEqual(ownerOf(fx).heartbeatAt, new Date(RT0 - 30_000).toISOString());
});

test('#4150: a heartbeat stamped in the future (clock skew) is rewritten by the same owner rather than left stuck', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 - 30_000 }), 'heartbeat');
  assert.strictEqual(ownerOf(fx).heartbeatAt, new Date(RT0 - 30_000).toISOString());
});

test('AC2.2: an owner event 61 s after the first advances heartbeatAt', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000 }), 'heartbeat');
  const owner = ownerOf(fx);
  assert.strictEqual(owner.heartbeatAt, new Date(RT0 + 61_000).toISOString());
  assert.strictEqual(owner.pid, 100, 'a heartbeat leaves the rest of the block alone');
  assert.strictEqual(owner.pidStartedAt, 'T100');
});

test('a heartbeat whose stored heartbeatAt does not parse is rewritten', () => {
  const fx = refreshFixture({ heartbeatAt: 'garbage' });
  assert.strictEqual(refresh(fx, { now: RT0 }), 'heartbeat');
  assert.strictEqual(ownerOf(fx).heartbeatAt, RT0_ISO);
});

test('AC2.3: a fallback-attributed event never changes the owner block', () => {
  const fx = refreshFixture({}, { attribution: 'fallback' });
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000 }), null);
  assert.strictEqual(ownerOf(fx).heartbeatAt, RT0_ISO);
});

test('AC2.4: a hook from another session id never changes the owner block', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { sessionId: 'other', now: RT0 + 61_000 }), null);
  assert.strictEqual(ownerOf(fx).heartbeatAt, RT0_ISO);
});

test('nested claude -p sharing the session id does not re-stamp or heartbeat', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000, deps: refreshDeps({ cur: 200, alive: true }) }), null);
  assert.deepStrictEqual(ownerOf(fx), { sessionId: 's', host: 'h', pid: 100, pidSource: 'env', pidStartedAt: 'T100', heartbeatAt: RT0_ISO });
});

test('AC3.1: a resumed session re-stamps pid and pidStartedAt together', () => {
  const fx = refreshFixture();
  const realRename = fs.renameSync;
  let runStateRenames = 0;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith('run-state.json')) runStateRenames++;
    return realRename(from, to);
  };
  let result;
  try {
    result = refresh(fx, { now: RT0 + 5_000, restampWhileFresh: true, deps: refreshDeps({ cur: 200, alive: false }) });
  } finally {
    fs.renameSync = realRename;
  }
  assert.strictEqual(result, 'restamp');
  const owner = ownerOf(fx);
  assert.strictEqual(owner.pid, 200);
  assert.strictEqual(owner.pidStartedAt, 'T200');
  assert.strictEqual(owner.pidSource, 'env');
  assert.strictEqual(owner.host, 'h');
  assert.strictEqual(owner.heartbeatAt, new Date(RT0 + 5_000).toISOString());
  assert.strictEqual(runStateRenames, 1, 'pid and pidStartedAt land in one write');
});

test('a pid-reused owner (alive, different start time) is re-stamped', () => {
  const fx = refreshFixture();
  const deps = refreshDeps({ cur: 200, alive: true, startOf: { 100: 'other', 200: 'T200' } });
  assert.strictEqual(refresh(fx, { deps, restampWhileFresh: true }), 'restamp');
  assert.strictEqual(ownerOf(fx).pid, 200);
  assert.strictEqual(ownerOf(fx).pidStartedAt, 'T200');
});

test('a failed start-time probe on a live owner is unknown, never dead — a nested claude -p does not take over', () => {
  const fx = refreshFixture();
  const deps = refreshDeps({ cur: 200, alive: true, startOf: { 200: 'T200' } }); // pidStartTime(100) -> null
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000, deps }), null);
  assert.deepStrictEqual(ownerOf(fx), { sessionId: 's', host: 'h', pid: 100, pidSource: 'env', pidStartedAt: 'T100', heartbeatAt: RT0_ISO });
});

test('an owner stamped on another host is re-stamped (its pid proves nothing here)', () => {
  const fx = refreshFixture({ host: 'elsewhere' });
  assert.strictEqual(refresh(fx, { deps: refreshDeps({ cur: 200, alive: true }), restampWhileFresh: true }), 'restamp');
  assert.strictEqual(ownerOf(fx).host, 'h');
});

test('a throwing liveness probe counts as alive — no re-stamp', () => {
  const fx = refreshFixture();
  const deps = { ...refreshDeps({ cur: 200 }), isPidAlive: () => { throw new Error('probe'); } };
  assert.strictEqual(refresh(fx, { deps, restampWhileFresh: true }), null);
  assert.strictEqual(ownerOf(fx).pid, 100);
});

test('a missing CLAUDE_PID never re-stamps', () => {
  const fx = refreshFixture();
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000, deps: refreshDeps({ cur: null, alive: false }) }), null);
  assert.strictEqual(ownerOf(fx).pid, 100);
  assert.strictEqual(ownerOf(fx).heartbeatAt, RT0_ISO);
});

test('a legacy run (no owner block) is never given one by a heartbeat', () => {
  const fx = refreshFixture({}, { noOwner: true });
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000 }), null);
  assert.ok(!('owner' in ctx.readRunState(fx.dir)));
});

test('refreshOwnerBlock never throws', () => {
  const fx = refreshFixture();
  const deps = { ...refreshDeps(), resolveOwnerPid: () => { throw new Error('probe'); } };
  assert.strictEqual(refresh(fx, { now: RT0 + 61_000, deps }), null);
  assert.strictEqual(ctx.refreshOwnerBlock(undefined), null);
  assert.strictEqual(ctx.refreshOwnerBlock({ input: null, ownedRun: null }), null);
});

// #4153: one judge — refreshOwnerBlock's takeover decision reads the same owner-pid
// probe runLiveness reports. Each row: owner-block override, probes, the owner-pid
// evidence entry, and whether a different current pid re-stamps the block.
test('AC1.1: refreshOwnerBlock and runLiveness give the same answer on the stamped owner pid, an unreadable start time included', () => {
  const { gatherEvidence } = require('../plugin/bin/lib/run-liveness');
  // The invalid-start-time ('stored start time is not a ps string') and no-pid ('stored pid is not a usable pid')
  // rows prove the routing through probeOwnerPid — the old inline check passed the rest — so do not prune them.
  const rows = [
    { name: 'start time cannot be read', startOf: { 200: 'T200' }, entry: ['error', 'start-time-unavailable'], restamp: false },
    { name: 'stored start time is not a ps string', over: { pidStartedAt: 12345 }, entry: ['error', 'invalid-start-time'], restamp: false },
    { name: 'alive, start time matches', entry: ['positive', 'alive'], restamp: false },
    { name: 'alive, no stored start time', over: { pidStartedAt: null }, entry: ['negative', 'alive-no-start-time'], restamp: false },
    { name: 'pid reused', startOf: { 100: 'other', 200: 'T200' }, entry: ['negative', 'pid-reused'], restamp: true },
    { name: 'gone', alive: false, entry: ['negative', 'gone'], restamp: true },
    { name: 'stamped on another host', over: { host: 'elsewhere' }, entry: ['negative', 'other-host'], restamp: true },
    { name: 'stored pid is not a usable pid', over: { pid: 0 }, entry: ['negative', 'no-pid'], restamp: true },
  ];
  for (const row of rows) {
    const fx = refreshFixture(row.over || {});
    const deps = refreshDeps({ cur: 200, alive: row.alive ?? true, startOf: row.startOf });
    const probes = {
      hostname: deps.hostname, pidAlive: deps.isPidAlive, pidStartTime: deps.pidStartTime,
      lockInUse: () => false, lastCommitAt: () => null, ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: null }),
    };
    const e = gatherEvidence(fx.dir, { now: RT0, probes }).evidence.find((x) => x.probe === 'owner-pid');
    assert.deepStrictEqual([e.result, e.detail], row.entry, row.name);
    // restampWhileFresh: the fixture's heartbeat is fresh at RT0, and #4150 returns before the probe inside the window
    assert.strictEqual(refresh(fx, { deps, restampWhileFresh: true }) === 'restamp', row.restamp, row.name);
  }
});

test('appendEvent writes one JSON line per call, never throws on bad dir', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1');
  ctx.appendEvent(run, 'commit', { hash: 'abc123' });
  ctx.appendEvent(run, 'session-end', {});
  const lines = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.strictEqual(first.type, 'commit');
  assert.strictEqual(first.hash, 'abc123');
  assert.ok(first.ts);
  assert.doesNotThrow(() => ctx.appendEvent('/nonexistent/run', 'x', {}));
});

test('appendEvent: derived ts/type always win over same-named keys in caller-supplied data (finding regression)', () => {
  // CLAUDE.md: "Don't spread parsed external JSON after derived/trusted
  // fields" — spreading `data` AFTER `ts`/`type` would let a caller-supplied
  // object silently override this event's own classification/timestamp.
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1');
  ctx.appendEvent(run, 'wd-deny', { type: 'spoofed-type', ts: 'spoofed-ts', reason: 'real-reason' });
  const line = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim();
  const entry = JSON.parse(line);
  assert.strictEqual(entry.type, 'wd-deny', 'the derived type must win over a same-named key in data');
  assert.notStrictEqual(entry.ts, 'spoofed-ts', 'the derived ts must win over a same-named key in data');
  assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/, 'ts must be a real ISO timestamp, not the spoofed value');
  assert.strictEqual(entry.reason, 'real-reason', 'non-colliding data fields are still preserved');
});

test('scanWrapupEvents: missing events.jsonl returns null', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090000-spec-1', { status: 'active' });
  assert.strictEqual(ctx.scanWrapupEvents(run), null);
});

test('scanWrapupEvents: unreadable dir returns null', () => {
  assert.strictEqual(ctx.scanWrapupEvents('/nonexistent/run'), null);
});

test('scanWrapupEvents: no skill_invoked events returns any:false, wrapup:false', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090001-spec-1', { status: 'active' });
  fs.writeFileSync(path.join(run, 'events.jsonl'), JSON.stringify({ type: 'other', ts: '2026-08-01T09:00:00Z' }) + '\n');
  assert.deepStrictEqual(ctx.scanWrapupEvents(run), { any: false, wrapup: false });
});

test('scanWrapupEvents: skill_invoked for a different skill returns any:true, wrapup:false', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090002-spec-1', { status: 'active' });
  const line = JSON.stringify({ type: 'skill_invoked', skill: 'claude-tweaks:build', ts: '2026-08-01T09:00:00Z' });
  fs.writeFileSync(path.join(run, 'events.jsonl'), line + '\n');
  assert.deepStrictEqual(ctx.scanWrapupEvents(run), { any: true, wrapup: false });
});

test('scanWrapupEvents: skill_invoked for claude-tweaks:wrap-up returns any:true, wrapup:true', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090003-spec-1', { status: 'active' });
  const line = JSON.stringify({ type: 'skill_invoked', skill: 'claude-tweaks:wrap-up', ts: '2026-08-01T09:00:00Z' });
  fs.writeFileSync(path.join(run, 'events.jsonl'), line + '\n');
  assert.deepStrictEqual(ctx.scanWrapupEvents(run), { any: true, wrapup: true });
});

test('scanWrapupEvents: malformed JSON lines are skipped, not fatal', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090004-spec-1', { status: 'active' });
  const wrapupLine = JSON.stringify({ type: 'skill_invoked', skill: 'claude-tweaks:wrap-up', ts: '2026-08-01T09:00:00Z' });
  fs.writeFileSync(path.join(run, 'events.jsonl'), 'not json\n' + wrapupLine + '\n\n');
  assert.deepStrictEqual(ctx.scanWrapupEvents(run), { any: true, wrapup: true });
});

// #1737: readEventLines — the shared raw reader underneath scanWrapupEvents
// (above) and run-liveness/probes.js's ownEventRecency. `null` (absent/unreadable)
// and `[]` (readable but nothing parseable) must stay distinguishable, since
// both of those callers rely on telling "we don't know" from "we know it's
// empty."
test('readEventLines: missing events.jsonl returns null', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090005-spec-1', { status: 'active' });
  assert.strictEqual(ctx.readEventLines(run), null);
});

test('readEventLines: unreadable dir returns null', () => {
  assert.strictEqual(ctx.readEventLines('/nonexistent/run'), null);
});

test('readEventLines: an empty file returns []', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090006-spec-1', { status: 'active' });
  fs.writeFileSync(path.join(run, 'events.jsonl'), '');
  assert.deepStrictEqual(ctx.readEventLines(run), []);
});

test('readEventLines: mixed valid/invalid lines returns only the parsed valid ones, in order', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-08-20T090007-spec-1', { status: 'active' });
  const first = { type: 'skill_invoked', skill: 'claude-tweaks:build', ts: '2026-08-01T09:00:00Z' };
  const second = { type: 'skill_invoked', skill: 'claude-tweaks:wrap-up', ts: '2026-08-01T09:05:00Z' };
  fs.writeFileSync(
    path.join(run, 'events.jsonl'),
    [JSON.stringify(first), 'not json', '', JSON.stringify(second), ''].join('\n'),
  );
  assert.deepStrictEqual(ctx.readEventLines(run), [first, second]);
});

test('writeRunState serializes concurrent writers under an effectively-unbounded lock budget — no lost updates under real cross-process concurrency (finding regression)', async () => {
  // Reproduces the exact shape the finding describes: many real OS
  // processes racing a read-modify-write against the same run-state.json,
  // each patching its OWN field. Without a lock, a writer's stale-snapshot
  // write (taken before another writer's update landed) silently reverts
  // that other writer's field when it overwrites the whole file.
  //
  // Contract (#254): production's lock is best-effort/fail-open by design —
  // LOCK_WAIT_MS caps total wait, after which a writer proceeds unlocked
  // rather than hang a hook. That default budget can race under contention
  // (observed on a CI runner: a worker exhausted the 500ms budget and lost a
  // field). This test pins CLAUDE_TWEAKS_LOCK_WAIT_MS to a large ceiling to
  // remove that race and test the LOCK MECHANISM itself deterministically —
  // it is a ceiling on lock-wait, not a sleep, and no assertion below
  // depends on its value (IL-62). The production default's fail-open
  // behavior under contention is covered separately below.
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1');
  ctx.writeRunState(run, { seed: true });

  const WORKERS = 8;
  const ITERATIONS = 40;
  const contextPath = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'context.js');
  const workerScript = (i) => `
    const ctx = require(${JSON.stringify(contextPath)});
    for (let n = 0; n < ${ITERATIONS}; n++) {
      ctx.writeRunState(${JSON.stringify(run)}, { w${i}: n + 1 });
    }
  `;

  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    procs.push(new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', workerScript(i)], {
        env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '60000' },
      });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      // 'close', not 'exit': only 'close' guarantees stdio has flushed, so a failing worker's stderr is complete.
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
      p.on('error', reject);
    }));
  }
  await Promise.all(procs);

  const final = ctx.readRunState(run);
  assert.strictEqual(final.seed, true, 'the pre-existing seed field must survive every concurrent writer');
  for (let i = 0; i < WORKERS; i++) {
    assert.strictEqual(final[`w${i}`], ITERATIONS,
      `worker ${i}'s field must reflect its LAST write, not be lost to a concurrent writer's stale snapshot`);
  }
});

test('writeRunState under the fail-open path (budget=0) — every worker still exits cleanly and the file never tears', async () => {
  // Contract (#254): production is best-effort/fail-open — a writer that
  // cannot acquire the lock in time proceeds unlocked rather than hang a
  // hook. Pinning CLAUDE_TWEAKS_LOCK_WAIT_MS to 0 forces every writer down
  // that unlocked path (deterministically, not by chance), reproducing the
  // documented posture. Under that posture, individual field updates CAN be
  // lost to a racing stale-snapshot write — that's the fail-open trade-off,
  // not a defect — so this test does NOT assert every field's final value
  // (nondeterministic). What the atomic temp-file + rename write in
  // writeRunState DOES guarantee even fully unlocked: no worker ever
  // crashes, and the file is never left torn/partially-written — a reader
  // can always parse it.
  const project = tmpProject();
  const run = mkRun(project, '2026-07-01T090000-spec-1');
  ctx.writeRunState(run, { seed: true });

  const WORKERS = 8;
  const ITERATIONS = 40;
  const contextPath = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'context.js');
  const workerScript = (i) => `
    const ctx = require(${JSON.stringify(contextPath)});
    for (let n = 0; n < ${ITERATIONS}; n++) {
      ctx.writeRunState(${JSON.stringify(run)}, { w${i}: n + 1 });
    }
  `;

  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    procs.push(new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', workerScript(i)], {
        env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' },
      });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      // 'close', not 'exit': only 'close' guarantees stdio has flushed, so a failing worker's stderr is complete.
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
      p.on('error', reject);
    }));
  }
  await Promise.all(procs);

  const raw = fs.readFileSync(path.join(run, 'run-state.json'), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'run-state.json must always be valid JSON, even under a fully unlocked race');
});

// #2858: the one multi-spec parent fallback (per-field fill of worktree/pr/prExempt).
function mkSpecChild(parentState, childState, parentName = '2026-07-01T090000-spec-7-8') {
  const project = tmpProject();
  const parent = mkRun(project, parentName, parentState);
  const child = path.join(parent, 'spec-7');
  fs.mkdirSync(child, { recursive: true });
  if (childState !== undefined) fs.writeFileSync(path.join(child, 'run-state.json'), typeof childState === 'string' ? childState : JSON.stringify(childState));
  return { parent, child };
}

test('readRunStateWithParent: a status-only per-spec state is filled per field from the parent', () => {
  const { parent, child } = mkSpecChild({ worktree: '/w/tree', pr: { number: 12, url: 'u' }, prExempt: 'initial-publish' }, { status: 'active' });
  const r = ctx.readRunStateWithParent(child);
  assert.deepStrictEqual(r.state, { status: 'active', worktree: '/w/tree', pr: { number: 12, url: 'u' }, prExempt: 'initial-publish' });
  assert.strictEqual(r.parentRunDir, parent);
  assert.deepStrictEqual(r.filled, ['worktree', 'pr', 'prExempt']);
});

test('readRunStateWithParent: a usable per-spec value wins over the parent (precedence)', () => {
  const { child } = mkSpecChild({ worktree: '/parent/tree', pr: { number: 12 }, prExempt: 'p' }, { worktree: '/own/tree', pr: { number: 99 }, prExempt: 'own' });
  const r = ctx.readRunStateWithParent(child);
  assert.deepStrictEqual(r.state, { worktree: '/own/tree', pr: { number: 99 }, prExempt: 'own' });
  assert.deepStrictEqual(r.filled, []);
});

test('readRunStateWithParent: a present-but-unusable per-spec value (pr null, pr {}, a string pr.number, worktree "", a non-string worktree) is filled from the parent', () => {
  for (const own of [{ pr: null, worktree: '' }, { pr: {}, worktree: '' }, { pr: { number: '12' }, worktree: 5 }]) {
    const { child } = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, own);
    const r = ctx.readRunStateWithParent(child);
    assert.strictEqual(r.state.worktree, '/w/tree');
    assert.deepStrictEqual(r.state.pr, { number: 12 });
    assert.deepStrictEqual(r.filled, ['worktree', 'pr']);
  }
});

test('readRunStateWithParent: a non-spec run dir never borrows from a parent directory that happens to hold a run-state.json', () => {
  const project = tmpProject();
  const parent = mkRun(project, '2026-07-01T090000-spec-1', { worktree: '/w/tree', pr: { number: 12 } });
  const child = path.join(parent, 'not-a-spec');
  fs.mkdirSync(child);
  assert.deepStrictEqual(ctx.readRunStateWithParent(child), { state: null, parentRunDir: null, filled: [] });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.deepStrictEqual(ctx.readRunStateWithParent(child), { state: { status: 'active' }, parentRunDir: null, filled: [] });
});

test('readRunStateWithParent: requireRunIdParent refuses a spec-* dir whose parent is not run-id-shaped, and still borrows under a run-id-shaped parent', () => {
  const loose = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, { status: 'active' }, 'not-a-run');
  assert.deepStrictEqual(ctx.readRunStateWithParent(loose.child, { requireRunIdParent: true }), { state: { status: 'active' }, parentRunDir: null, filled: [] });
  assert.deepStrictEqual(ctx.readRunStateWithParent(loose.child).filled, ['worktree', 'pr']);
  const strict = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, { status: 'active' });
  assert.deepStrictEqual(ctx.readRunStateWithParent(strict.child, { requireRunIdParent: true }).filled, ['worktree', 'pr']);
});

test('readRunStateWithParent: missing, malformed, and non-object files never throw', () => {
  const neither = mkSpecChild(undefined, undefined);
  assert.deepStrictEqual(ctx.readRunStateWithParent(neither.child), { state: null, parentRunDir: neither.parent, filled: [] });

  const badChild = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, '{not json');
  assert.deepStrictEqual(ctx.readRunStateWithParent(badChild.child).state, { worktree: '/w/tree', pr: { number: 12 } });

  const badParent = mkSpecChild(undefined, { status: 'active' });
  fs.writeFileSync(path.join(badParent.parent, 'run-state.json'), '{not json');
  assert.deepStrictEqual(ctx.readRunStateWithParent(badParent.child), { state: { status: 'active' }, parentRunDir: badParent.parent, filled: [] });

  const arrays = mkSpecChild(undefined, '[1,2]');
  fs.writeFileSync(path.join(arrays.parent, 'run-state.json'), '"a string"');
  assert.deepStrictEqual(ctx.readRunStateWithParent(arrays.child).state, null);

  for (const bad of [undefined, null, 42, '']) {
    assert.deepStrictEqual(ctx.readRunStateWithParent(bad), { state: null, parentRunDir: null, filled: [] });
  }
});

test('readRunStateWithParent: reads through the injected reader, and a throwing reader degrades to null', () => {
  const seen = [];
  const read = (dir) => { seen.push(dir); return path.basename(dir) === 'spec-7' ? { status: 'active' } : { pr: { number: 5 } }; };
  const r = ctx.readRunStateWithParent(path.join('/runs/2026-07-01T090000-spec-7-8', 'spec-7'), { read });
  assert.deepStrictEqual(r.state, { status: 'active', pr: { number: 5 } });
  assert.deepStrictEqual(seen, [path.join('/runs/2026-07-01T090000-spec-7-8', 'spec-7'), '/runs/2026-07-01T090000-spec-7-8']);
  const thrown = ctx.readRunStateWithParent('/runs/x/spec-7', { read: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(thrown, { state: null, parentRunDir: '/runs/x', filled: [] });
});

test('readRunStateWithParent: a truthy but malformed parent stamp is passed through as written, an empty one is not', () => {
  const corrupt = mkSpecChild({ worktree: 5, pr: {} }, { status: 'active' });
  const r = ctx.readRunStateWithParent(corrupt.child);
  assert.deepStrictEqual(r.state, { status: 'active', worktree: 5, pr: {} });
  assert.deepStrictEqual(r.filled, ['worktree', 'pr']);
  const empty = mkSpecChild({ worktree: '', pr: null }, { status: 'active' });
  assert.deepStrictEqual(ctx.readRunStateWithParent(empty.child), { state: { status: 'active' }, parentRunDir: empty.parent, filled: [] });
});
