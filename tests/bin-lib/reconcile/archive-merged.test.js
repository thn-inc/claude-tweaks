'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
// Destructured at require time, so this binding is a snapshot of the REAL
// implementation — it stays callable as the pass-through inside the
// compound-failure test's `t.mock.method(cp, 'execFileSync', ...)` below.
const { execFileSync } = cp;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  archiveRunDir, listSpecDirs, decideArchive, readConsoleState, isOrphanedMint, trackArchiveResult,
  archiveMerged, lastOwnEventMs, isAbandonedInterrupted, archiveOrphanedMint, ORPHAN_MINT_TTL_MS,
  isStructurallyStuck, trackStuckSkip, STRUCTURALLY_STUCK_TTL_MS,
  isArchivedPendingTrackedMove, archivedPendingTrackedMoveCommand, compareWorkTwin,
} = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { RESIDUE_ESCALATE_THRESHOLD, listResidueFailures } = require('../../../plugin/bin/lib/reconcile/cache');

// #1892: stamps `worktree-always: true` in `.claude-tweaks/policy.yml` — the
// flat kebab-case format `bin/lib/policy.js` reads directly (no YAML dep).
function setWorktreeAlways(root, value) {
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `worktree-always: ${value}\n`);
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function trackedFiles(root) {
  return git(root, 'ls-files').split('\n').filter(Boolean);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function commitPath(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', relPath);
  git(root, 'commit', '-m', `add ${relPath}`);
}

// Forces a REAL `git commit` failure via a failing pre-commit hook — the same
// class of real-world cause named in #652's Technical Approach (gpgsign
// requirement, a failing pre-commit/commit-msg hook, a policy gate) — rather
// than mocking `runGit` (archive-merged.js destructures `runGit` at require
// time, so a `t.mock.method` on the git-exec module's exported property
// wouldn't be observed by archive-merged.js's already-bound reference).
// The compound-failure test below takes a different tack — mocking
// `child_process.execFileSync` itself, which git-exec.js's `runGit` calls via
// property access at call time (`cp.execFileSync(...)`, not a destructured
// const — see that file's own header comment) — since forcing `git reset`
// itself to fail has no equivalent real-hook mechanism (`reset` has no
// `pre-reset` hook the way `commit` does).
function installFailingPreCommitHook(root) {
  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hookPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
}

function removePreCommitHook(root) {
  fs.rmSync(path.join(root, '.git', 'hooks', 'pre-commit'), { force: true });
}

// resolvePrState (pr-state.js) shells to `gh pr list` and is bound at
// archive-merged.js's own require time, same non-injectable caveat
// reap-merged.test.js's own copy of this helper documents — intercept at the
// process-spawn boundary via a `gh` wrapper placed first on PATH.
function installGhWrapper(prsJson) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(wrapperPath, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(prsJson)}\nEOF\n`);
  fs.chmodSync(wrapperPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { restore: () => { process.env.PATH = originalPath; } };
}

// The "PR merged, worktree torn down" repo shape both fixtures below build
// on: a feature branch committed in its own worktree, merged into main, then
// the worktree removed (branch ref stays). The returned `featureSha` is that
// branch's real tip commit, which a test hands back as the PR's
// `mergeCommit.oid` — `git merge --no-edit` folds it into main, so
// `merge-base --is-ancestor` (localHasMerge) sees it as an ancestor, same as
// a genuine fast-forward/merge would. The root is realpath'd (unlike
// makeRepo()'s own return) because mainCheckoutRoot resolves through realpath
// internally (macOS's os.tmpdir() sits behind a /var -> /private/var
// symlink) — archiveMerged's `root` would otherwise differ from a fixture's
// own `runDir` string, and a plain string membership assertion against
// `result.archived` would spuriously fail.
function mergedFeatureBranchRepo(branch) {
  const root = fs.realpathSync(makeRepo());
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-featwt-'));
  git(root, 'worktree', 'add', '-q', wt, '-b', branch);
  fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wt, encoding: 'utf8' });
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], { cwd: wt, encoding: 'utf8' });
  const featureSha = execFileSync('git', ['rev-parse', branch], { cwd: root, encoding: 'utf8' }).trim();
  git(root, 'merge', '-q', '--no-edit', branch);
  git(root, 'worktree', 'remove', '--force', wt);
  return { root, featureSha };
}

// #1544: a run dir close-run already marked `{status: 'clean', worktree:
// null}` whose archive-run step never followed — the worktree is torn down
// (or was never present in this fixture), so the only way to recover a
// branch name is run-state.json's own `pr.branch` stamp (run-integrity.js's
// fallbackBranch, same source #1672's own fixture uses).
function fixtureCleanUnarchivedRun({ runId, consoleResolved = true } = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-clean-branch');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'clean', worktree: null, pr: { branch: 'feat-clean-branch' },
  }));
  if (consoleResolved) {
    fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  }
  return { root, runDir, featureSha };
}

// #1673: a torn-down, shipped, `interrupted` run — the shape
// `isAbandonedInterrupted` + `checkRunIntegrity` must recognize as
// auto-closeable. Mirrors tests/run-integrity.test.js's `fixtureTornDownRepo`
// (a merged feature branch whose worktree is later removed, `pr.branch`
// stamped on run-state.json as the #1672 fallback-evidence source) rather
// than inventing a new shape, plus this file's own `makeRepo()` for the base
// repo. `runId`'s ISO prefix (09:00:00) is before the feature commit's
// pinned date (10:00:00) so checkRunIntegrity's run-start corroboration
// passes. The one seed event is dated 2020 — far outside the 24h staleness
// window — so it satisfies checkRunIntegrity's "at least one skill_invoked,
// no wrap-up" evidence bar AND lastOwnEventMs' recency check in one line;
// `extraEventLines` lets a caller (case 3) append a second, recent,
// fallback-attributed line without disturbing that.
function fixtureAbandonedShippedRun({ runId, ownerSessionId, extraEventLines = [] } = {}) {
  // realpath'd (unlike makeRepo()'s own return) because mainCheckoutRoot
  // resolves through realpath internally (macOS's os.tmpdir() sits behind a
  // /var -> /private/var symlink) — archiveMerged's `root` would otherwise
  // differ from this fixture's own `runDir` string, and a plain string
  // membership assertion against `result.archived` would spuriously fail.
  const root = fs.realpathSync(makeRepo());
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-wt-'));
  git(root, 'worktree', 'add', '-q', wt, '-b', 'feat-branch');
  fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wt, encoding: 'utf8' });
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], {
    cwd: wt,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' },
  });
  git(root, 'merge', '-q', '--no-edit', 'feat-branch');
  git(root, 'worktree', 'remove', '--force', wt); // branch ref stays, worktree gone

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const runState = { status: 'interrupted', worktree: wt, pr: { branch: 'feat-branch' } };
  if (ownerSessionId) runState.sessionId = ownerSessionId;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  const seedEvent = '{"skill":"claude-tweaks:build","ts":"2020-01-01T09:05:00.000Z","type":"skill_invoked"}';
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [seedEvent, ...extraEventLines].join('\n') + '\n');

  return { root, wt, runDir };
}

// #593 AC: archiving a run dir with a tracked work/*-spec.md file removes the
// old pre-archive path from BOTH disk and the git index, and the archived
// copy exists and is tracked at the new path — single-spec layout.
test('archiveRunDir: single-spec run — git-tracked work/ moves via git mv, gone from disk + index at old path', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-42';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/42-spec.md`, '# spec 42\n');
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'auto-mode: true\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '{"type":"start"}\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);

  // Old path: gone from disk entirely.
  assert.equal(fs.existsSync(runDir), false, 'old run dir must not survive on disk');

  // Old path: gone from the git index (the actual defect — a plain
  // fs.renameSync leaves the tracked file registered at the old path, so a
  // later `git checkout`/merge resurrects it there).
  const tracked = trackedFiles(root);
  assert.equal(
    tracked.includes(`.claude-tweaks/pipelines/${runId}/work/42-spec.md`),
    false,
    'old path must not remain tracked in the git index',
  );

  // New path: archived copy exists on disk and is tracked.
  assert.equal(fs.existsSync(path.join(archiveDir, 'work', '42-spec.md')), true);
  assert.ok(
    tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/work/42-spec.md`),
    'archived copy must be tracked at the new path',
  );

  // Gitignored siblings moved too.
  assert.equal(fs.existsSync(path.join(archiveDir, 'config.yml')), true);
  assert.equal(fs.existsSync(path.join(archiveDir, 'decisions.md')), true);
  assert.equal(fs.existsSync(path.join(archiveDir, 'events.jsonl')), true);

  // Finalized terminal state at the archived location.
  const state = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'clean');
});

// #2241: the archive commit must be scoped to exactly the paths this call
// staged (the workMoves batch), not the whole index — a human or sibling
// session's own unrelated staged content in this shared main checkout must
// never be silently folded into a `[reconcile] archive run …` commit.
test('archiveRunDir: unrelated staged file in the main checkout is not swept into the archive commit', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-43';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/43-spec.md`, '# spec 43\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  // Something else — a human's own edit, or a sibling session's write —
  // already staged in the main checkout before archiveRunDir ever runs.
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated\n');
  git(root, 'add', 'unrelated.txt');

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  // The unrelated file must still be staged-but-uncommitted after archival.
  const status = git(root, 'status', '--short');
  assert.ok(status.includes('A  unrelated.txt'), `expected unrelated.txt still staged, got:\n${status}`);

  // The archive commit itself must touch only the work/ rename.
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const nameStatus = git(root, 'show', '--name-status', 'HEAD');
  assert.ok(
    nameStatus.includes(`.claude-tweaks/pipelines/${runId}/work/43-spec.md`)
    && nameStatus.includes(`.claude-tweaks/pipelines/archive/${runId}/work/43-spec.md`),
    `expected the work/ rename in the commit, got:\n${nameStatus}`,
  );
  assert.ok(!nameStatus.includes('unrelated.txt'), `unrelated.txt must not appear in the archive commit, got:\n${nameStatus}`);

  assert.equal(fs.existsSync(path.join(archiveDir, 'work', '43-spec.md')), true);
});

// #1493 review fix: a `*-tidy-standalone*` run's own audit files
// (`decisions.md`, `report.md`, `staged/**`) are git-tracked now (the
// `.gitignore` carve-out) — they must join `work/` in the git-mv'd class
// instead of tripping the #593 tracked-entry guard below.
test('archiveRunDir: tidy-standalone run — tracked decisions.md/report.md/staged/** move via git mv, no tracked-entry refusal', () => {
  const root = makeRepo();
  const runId = '2026-08-30T090000-tidy-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/decisions.md`, '# decisions\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/report.md`, '# report\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/staged/proposal-1.md`, '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(runDir), false, 'old run dir must not survive on disk');

  const tracked = trackedFiles(root);
  for (const rel of ['decisions.md', 'report.md', 'staged/proposal-1.md']) {
    assert.equal(
      tracked.includes(`.claude-tweaks/pipelines/${runId}/${rel}`),
      false,
      `old path for ${rel} must not remain tracked in the git index`,
    );
    assert.equal(fs.existsSync(path.join(archiveDir, rel)), true, `${rel} must exist at the archived path`);
    assert.ok(
      tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/${rel}`),
      `${rel} must be tracked at the archived path`,
    );
  }

  const state = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'clean');
});

// Regression: a standalone run's decisions.md/report.md/staged only become
// tracked once their worktree copy has merged AND this checkout has pulled
// that merge — a real, documented window (SKILL.md's pr-first Step 7.5)
// where they exist on disk but are genuinely untracked here. Before this
// fix, the code above treated `fs.existsSync` as sufficient to attempt
// `git mv`, which fails outright on an untracked source ('fatal: not under
// version control' — verified directly) and, worse, left the file wherever
// a since-then `git clean` could sweep it away with no trace. The fix must
// refuse before ever calling `git mv` on these paths, never leave the run
// half-archived, and name every offending file.
test('archiveRunDir: tidy-standalone run — untracked decisions.md/staged refuses audit-untracked before any git mv, run dir untouched', () => {
  const root = makeRepo();
  const runId = '2026-08-30T090000-tidy-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  // Exists on disk, deliberately never `git add`/committed — the exact
  // state a not-yet-synced main checkout leaves these files in.
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'proposal-1.md'), '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'audit-untracked');
  assert.deepEqual(result.untrackedAuditFiles.sort(), ['decisions.md', 'staged']);

  // Refused before anything moved — nothing in the run dir touched, and the
  // archive dir (created up front as this run's "archiving" claim, before
  // any content-specific check runs) stays empty rather than half-populated.
  assert.equal(fs.existsSync(runDir), true);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), true);
  assert.equal(fs.existsSync(path.join(runDir, 'staged', 'proposal-1.md')), true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'decisions.md')), false);
  assert.equal(fs.existsSync(path.join(archiveDir, 'staged')), false);
});

// Same window, but only one of the two is still untracked (report.md was
// never produced by this run and staged/ already merged) — decisions.md
// alone must still block the whole archival, not just itself.
test('archiveRunDir: tidy-standalone run — one untracked audit file among tracked ones still refuses audit-untracked', () => {
  const root = makeRepo();
  const runId = '2026-08-30T090000-tidy-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/staged/proposal-1.md`, '# proposal\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'audit-untracked');
  assert.deepEqual(result.untrackedAuditFiles, ['decisions.md']);
  assert.ok(trackedFiles(root).includes(`.claude-tweaks/pipelines/${runId}/staged/proposal-1.md`), 'the already-tracked file must stay exactly where it was');
});

// Regression: `git ls-files --error-unmatch <dir>` exits 0 as soon as ONE
// file under the directory is tracked, even when a sibling underneath is
// genuinely untracked (empirically verified) — so a `staged/` directory
// holding one already-merged proposal AND one still-untracked proposal must
// still refuse audit-untracked, not silently `git mv` the whole directory
// and leave the untracked file relocated-but-untracked at the archive path.
test('archiveRunDir: staged/ with one tracked and one untracked file still refuses audit-untracked', () => {
  const root = makeRepo();
  const runId = '2026-08-30T090000-tidy-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/staged/proposal-1.md`, '# proposal 1\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'proposal-2.md'), '# proposal 2\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'audit-untracked');
  assert.deepEqual(result.untrackedAuditFiles, ['staged']);

  // Refused before anything moved — the mixed directory stays exactly where
  // it was, both files still present, nothing relocated to the archive path.
  assert.equal(fs.existsSync(path.join(runDir, 'staged', 'proposal-1.md')), true);
  assert.equal(fs.existsSync(path.join(runDir, 'staged', 'proposal-2.md')), true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'staged')), false);
});

// #1493 review fix, negative case: the tidy-standalone carve-out above must
// not widen into a blanket exemption — a stray tracked file this function
// doesn't know how to move (anything other than work/, or, on a
// tidy-standalone run, decisions.md/report.md/staged/**) still refuses
// `tracked-entry`, on a NON-tidy-standalone run exactly as before #1493.
test('archiveRunDir: non-tidy run with a stray tracked file outside work/ still refuses tracked-entry', () => {
  const root = makeRepo();
  const runId = '2026-08-30T090000-record-42-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/notes.md`, '# stray tracked file\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'tracked-entry');

  // Refused before anything moved — run dir and tracked file both untouched.
  assert.equal(fs.existsSync(runDir), true);
  assert.ok(trackedFiles(root).includes(`.claude-tweaks/pipelines/${runId}/notes.md`));
});

// #593 deliverable 2/4: multi-spec parent run dirs nest per-record
// spec-{N}/work/ subtrees (multi-spec.md's Run directory layout) — every one
// of them must move via git mv too, not just a top-level work/ that a
// multi-spec parent dir never has.
test('archiveRunDir: multi-spec parent run dir — every spec-{N}/work/ subtree moves via git mv', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-10-11';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-10/work/10-spec.md`, '# spec 10\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-11/work/11-spec.md`, '# spec 11\n');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'manifest.yml'), 'specs: []\n');
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'auto-mode: true\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(runDir, 'spec-10', 'config.yml'), 'auto-mode: true\n');
  fs.writeFileSync(path.join(runDir, 'spec-10', 'decisions.md'), '# spec 10 decisions\n');
  fs.writeFileSync(path.join(runDir, 'spec-11', 'config.yml'), 'auto-mode: true\n');
  fs.writeFileSync(path.join(runDir, 'spec-11', 'decisions.md'), '# spec 11 decisions\n');

  assert.deepEqual(listSpecDirs(runDir).sort(), ['spec-10', 'spec-11']);

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const tracked = trackedFiles(root);

  for (const n of [10, 11]) {
    // Old path gone from disk and the index.
    assert.equal(fs.existsSync(path.join(runDir, `spec-${n}`)), false, `spec-${n}/ must not survive on disk`);
    assert.equal(
      tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-${n}/work/${n}-spec.md`),
      false,
      `spec-${n}/work/${n}-spec.md must not remain tracked at the old path`,
    );
    // New path exists on disk and is tracked.
    assert.equal(fs.existsSync(path.join(archiveDir, `spec-${n}`, 'work', `${n}-spec.md`)), true);
    assert.ok(
      tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/spec-${n}/work/${n}-spec.md`),
      `spec-${n}/work/${n}-spec.md must be tracked at the archived path`,
    );
    // Per-spec gitignored siblings moved too.
    assert.equal(fs.existsSync(path.join(archiveDir, `spec-${n}`, 'config.yml')), true);
    assert.equal(fs.existsSync(path.join(archiveDir, `spec-${n}`, 'decisions.md')), true);
  }

  // Parent-level gitignored files moved.
  assert.equal(fs.existsSync(path.join(archiveDir, 'manifest.yml')), true);
  assert.equal(fs.existsSync(path.join(archiveDir, 'config.yml')), true);
  assert.equal(fs.existsSync(path.join(archiveDir, 'decisions.md')), true);

  const state = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'clean');

  // Old parent dir fully gone.
  assert.equal(fs.existsSync(runDir), false);
});

test('archiveRunDir: single-spec run with no work/ (mint or pre-materialize) still archives gitignored content, no git-mv attempted', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-99';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'run-state.json')), true);
  assert.equal(fs.existsSync(runDir), false);
});

// #652 AC 1: a commit failure after a successful git mv must not leave the
// main checkout's tracked working tree dirty — the old path must be restored
// on disk AND in the index, not just left as an uncommitted rename.
test('archiveRunDir: git mv succeeds but git commit fails — reverts on disk and in the index, leaving the tree clean', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-77';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/77-spec.md`, '# spec 77\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  // No cleanup needed: the hook lives inside this test's own throwaway repo.
  installFailingPreCommitHook(root);
  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'commit-failed');

  // Old path restored on disk.
  assert.equal(
    fs.existsSync(path.join(runDir, 'work', '77-spec.md')),
    true,
    'old work/77-spec.md must be restored on disk after a commit failure',
  );
  assert.equal(
    fs.readFileSync(path.join(runDir, 'work', '77-spec.md'), 'utf8'),
    '# spec 77\n',
  );

  // Old path restored in the index — no staged rename survives the pass.
  const tracked = trackedFiles(root);
  assert.ok(
    tracked.includes(`.claude-tweaks/pipelines/${runId}/work/77-spec.md`),
    'old path must remain tracked in the index after a reverted commit failure',
  );

  // New (archive) path must not exist — the rename was fully undone.
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'work', '77-spec.md')), false);

  // The tracked working tree (staged + unstaged) is clean for the path this
  // pass touched — no leftover deletion or addition from the aborted git mv.
  // Scoped to `--` status of the tracked area only: `run-state.json` is a
  // genuine untracked sibling in this test fixture (in the real repo it's
  // gitignored) and unrelated to the revert this test is pinning.
  const statusOut = git(root, 'status', '--porcelain', '--', '.claude-tweaks/pipelines');
  const trackedStatusLines = statusOut
    .split('\n')
    .filter((line) => line && !line.startsWith('??'));
  assert.equal(
    trackedStatusLines.join('\n'),
    '',
    `expected no staged/modified tracked entries, got:\n${statusOut}`,
  );
});

// #652 AC 2: once the commit-failure cause is resolved, the next reconcile
// pass must complete the archive — proving the retry guard
// (`fs.existsSync(topWork)`) still sees the restored path and isn't
// permanently stuck skipping this run.
test('archiveRunDir: second pass after the commit-failure cause is resolved completes the archive', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-78';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/78-spec.md`, '# spec 78\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  installFailingPreCommitHook(root);
  const firstPass = archiveRunDir(root, runDir);
  assert.equal(firstPass.ok, false);
  assert.equal(firstPass.reason, 'commit-failed');
  removePreCommitHook(root);

  const secondPass = archiveRunDir(root, runDir);
  assert.equal(secondPass.ok, true, JSON.stringify(secondPass));

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'work', '78-spec.md')), true);
  assert.equal(fs.existsSync(runDir), false);
  const tracked = trackedFiles(root);
  assert.ok(tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/work/78-spec.md`));
  assert.equal(
    tracked.includes(`.claude-tweaks/pipelines/${runId}/work/78-spec.md`),
    false,
  );
});

// #652 review finding (critical, converged across 3 independent lens agents):
// revertWorkMoves ignored `git reset`'s result and unconditionally ran
// fs.renameSync next — under the same lock-contention cause that can fail
// `git commit`, `git reset` could plausibly fail too, and moving the file
// back on disk while the index still holds the old staged rename would
// desync disk from index (worse than the original bug: a coherent staged
// rename becomes an incoherent one). The fix: only move the file back when
// `git reset` actually succeeded; on reset failure, leave that pair exactly
// where `git mv` put it (still consistent — matches the original bug's
// state, not a new mismatched one) and report a distinguishable reason.
test('archiveRunDir: commit fails AND the revert reset also fails — file is not moved back (no disk/index desync), reason distinguishes partial revert', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-79';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/79-spec.md`, '# spec 79\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const failingVerb = cmd === 'git' && Array.isArray(args)
      && args.find((a) => a === 'commit' || a === 'reset');
    if (failingVerb) throw new Error(`simulated failure: git ${failingVerb}`);
    return execFileSync(cmd, args, opts);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'commit-failed-partial-revert');

  // The file stays at the archive (dest) location — NOT moved back — since
  // the reset that would have made moving it back safe also failed.
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(
    fs.existsSync(path.join(archiveDir, 'work', '79-spec.md')),
    true,
    'file must stay at the archive path when reset fails — moving it back would desync disk from the still-staged index',
  );
  assert.equal(
    fs.existsSync(path.join(runDir, 'work', '79-spec.md')),
    false,
    'old path must NOT be resurrected on disk when the index was never actually unstaged',
  );
});

// #1214 AC 2: the three commit-failure tests above only ever exercised a
// single top-level work/ pair — #652's own regression suite never proved the
// revert generalizes to a multi-pair (multi-spec parent run dir) batch,
// where every `git mv` in workMoves has already succeeded by the time the
// one covering `git commit` fails. archiveRunDir's commit-failure branch
// calls `revertWorkMoves(root, workMoves)` (the full array, not a
// succeeded-so-far prefix — unlike the git-mv-failed branch, since a commit
// only runs after every pair's mv already succeeded), so this pins that both
// spec-{N}/work/ pairs revert, not just one.
test('archiveRunDir: git mv succeeds for both spec work/ pairs but git commit fails — reverts BOTH pairs, not just one', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1211-1212';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1211/work/1211-spec.md`, '# spec 1211\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1212/work/1212-spec.md`, '# spec 1212\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  installFailingPreCommitHook(root);
  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'commit-failed');

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const tracked = trackedFiles(root);

  for (const n of [1211, 1212]) {
    // Old path restored on disk for every pair, not just the first.
    assert.equal(
      fs.existsSync(path.join(runDir, `spec-${n}`, 'work', `${n}-spec.md`)),
      true,
      `spec-${n}/work must be restored to its original path`,
    );
    assert.equal(
      fs.readFileSync(path.join(runDir, `spec-${n}`, 'work', `${n}-spec.md`), 'utf8'),
      `# spec ${n}\n`,
    );
    // Archive path must not exist for either pair — the rename was fully
    // undone, not left half-done on the second pair.
    assert.equal(fs.existsSync(path.join(archiveDir, `spec-${n}`, 'work')), false);
    // Old path restored in the index for every pair.
    assert.ok(
      tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-${n}/work/${n}-spec.md`),
      `spec-${n}/work/${n}-spec.md must remain tracked at its original path`,
    );
  }

  // No leftover staged/modified tracked entries from the aborted batch.
  const statusOut = git(root, 'status', '--porcelain', '--', '.claude-tweaks/pipelines');
  const trackedStatusLines = statusOut
    .split('\n')
    .filter((line) => line && !line.startsWith('??'));
  assert.equal(
    trackedStatusLines.join('\n'),
    '',
    `expected no staged/modified tracked entries, got:\n${statusOut}`,
  );
});

// Task 1 (#1103): a git-mv failure partway through a multi-pair workMoves
// loop (multi-spec parent run dir, two spec-{N}/work/ pairs) must not leave
// the first, already-succeeded pair stranded mid-move — it must be reverted
// the same way a commit failure already reverts everything (see the two
// tests above). Before this fix, the loop returned 'git-mv-failed'
// immediately on ANY pair's failure without ever reverting pairs that had
// already succeeded earlier in the same loop.
test('archiveRunDir: git mv fails on the SECOND of two spec work/ pairs — first pair is reverted, nothing left partially moved', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1101-1102';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1101/work/1101-spec.md`, '# spec 1101\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1102/work/1102-spec.md`, '# spec 1102\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  let mvCount = 0;
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isMv = cmd === 'git' && Array.isArray(args) && args[2] === 'mv';
    if (isMv) {
      mvCount += 1;
      if (mvCount === 2) throw new Error('simulated failure: git mv (2nd pair)');
    }
    return execFileSync(cmd, args, opts);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'git-mv-failed');

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);

  // The first pair (spec-1101), which had already been git-mv'd
  // successfully before the second pair's mv failed, must be reverted: back
  // on disk at its original path, and NOT left at the archive path.
  assert.equal(
    fs.existsSync(path.join(runDir, 'spec-1101', 'work', '1101-spec.md')),
    true,
    'spec-1101/work must be restored to its original path',
  );
  assert.equal(
    fs.readFileSync(path.join(runDir, 'spec-1101', 'work', '1101-spec.md'), 'utf8'),
    '# spec 1101\n',
  );
  assert.equal(
    fs.existsSync(path.join(archiveDir, 'spec-1101', 'work')),
    false,
    'spec-1101/work must not remain at the archive path',
  );
  const tracked = trackedFiles(root);
  assert.ok(
    tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-1101/work/1101-spec.md`),
    'spec-1101/work/1101-spec.md must be tracked again at its original path',
  );

  // The second pair (spec-1102) never actually moved — its mv call threw
  // before touching disk — so it must still be exactly where it started.
  assert.equal(
    fs.existsSync(path.join(runDir, 'spec-1102', 'work', '1102-spec.md')),
    true,
    'spec-1102/work must still be at its original path (its mv never succeeded)',
  );
});

// Review finding: the top-level gitignored-entries loop (below the
// tracked-entry guard) had no revert-on-failure — a later entry's
// fs.renameSync failure left an earlier entry stranded at the archive path
// while the run dir reported failure, the same partial-move hazard #1103
// fixed for `git mv`, just for plain filesystem moves instead.
test('archiveRunDir: a later gitignored top-level entry fails to move — the earlier one is reverted back to the run dir', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1401';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'auto-mode: true\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');

  // Only intercepts config.yml/decisions.md's own moves — run-state.json is
  // deliberately left alone: archiveRunDir's interim 'archiving' claim
  // (writeRunState) also targets archiveDir/run-state.json via its own
  // internal tmp-file rename, so asserting on that path here would be
  // testing the claim write, not the entries loop under test.
  const realRename = fs.renameSync;
  let entryRenameCount = 0;
  t.mock.method(fs, 'renameSync', (src, dest) => {
    const base = path.basename(String(src));
    if (base !== 'config.yml' && base !== 'decisions.md') return realRename(src, dest);
    entryRenameCount += 1;
    if (entryRenameCount === 2) throw new Error('simulated failure: fs.renameSync (2nd entry)');
    return realRename(src, dest);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'move-failed');
  assert.match(result.lastError, /simulated failure: fs\.renameSync \(2nd entry\)/);
  assert.equal(entryRenameCount, 3, 'first entry moved, second entry failed, first entry reverted');

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'config.yml')), false);
  assert.equal(fs.existsSync(path.join(archiveDir, 'decisions.md')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'config.yml')), true);
  assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), true);
});

// Same hazard, same fix, for the per-spec gitignored-entries loop (multi-spec
// parent layout) — a later entry within one spec dir's own pass fails, the
// earlier entry within that SAME spec dir is reverted.
test('archiveRunDir: a later gitignored spec-N entry fails to move — the earlier one in that spec dir is reverted', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1402-1403';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'spec-1402'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'spec-1402', 'a.md'), '# a\n');
  fs.writeFileSync(path.join(runDir, 'spec-1402', 'b.md'), '# b\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  // Counts only content-move renames — see the sibling test above for why
  // the interim-claim tmp-file rename is excluded.
  const realRename = fs.renameSync;
  let entryRenameCount = 0;
  t.mock.method(fs, 'renameSync', (src, dest) => {
    if (String(src).includes('.tmp-')) return realRename(src, dest);
    entryRenameCount += 1;
    // 1st content move: top-level run-state.json — let it succeed so only
    // the spec-dir loop's own pass is under test. Fail the spec dir's 2nd
    // entry (2nd content move within that spec dir = overall 3rd).
    if (entryRenameCount === 3) throw new Error('simulated failure: fs.renameSync (spec entry)');
    return realRename(src, dest);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'move-failed');
  assert.match(result.lastError, /simulated failure: fs\.renameSync \(spec entry\)/);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1402', 'a.md')), false);
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1402', 'b.md')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1402', 'a.md')), true);
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1402', 'b.md')), true);
});

// Review finding: the mid-loop revert path (test above) had no coverage for
// the case where the revert ITSELF also fails, unlike the pre-existing
// commit-failed-partial-revert path which pins that exact sibling case. The
// 1st pair's `git mv` succeeds, the 2nd pair's `git mv` fails (triggering
// the mid-loop revert), and the revert's `git reset` on the 1st pair also
// fails — the reason string must distinguish this from a clean revert.
test('archiveRunDir: git mv fails on the SECOND pair AND the revert reset for the first pair also fails — reason is git-mv-failed-partial-revert', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1103-1104';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1103/work/1103-spec.md`, '# spec 1103\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1104/work/1104-spec.md`, '# spec 1104\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  let mvCount = 0;
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isMv = cmd === 'git' && Array.isArray(args) && args[2] === 'mv';
    const isReset = cmd === 'git' && Array.isArray(args) && args[2] === 'reset';
    if (isMv) {
      mvCount += 1;
      if (mvCount === 2) throw new Error('simulated failure: git mv (2nd pair)');
    }
    if (isReset) throw new Error('simulated failure: git reset (revert)');
    return execFileSync(cmd, args, opts);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'git-mv-failed-partial-revert');

  // The first pair stays at the archive path — the reset that would make
  // moving it back safe also failed, same disk/index-consistency reasoning
  // as the commit-failed-partial-revert sibling test above.
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(
    fs.existsSync(path.join(archiveDir, 'spec-1103', 'work', '1103-spec.md')),
    true,
    'spec-1103/work must stay at the archive path when its revert reset fails',
  );
  assert.equal(
    fs.existsSync(path.join(runDir, 'spec-1103', 'work', '1103-spec.md')),
    false,
    'spec-1103/work must NOT be resurrected on disk when the index was never actually unstaged',
  );
});

// Pins that Task 1's change doesn't alter the already-correct
// first-pair-failure path: revertWorkMoves(root, []) on an empty
// succeededMoves list is a no-op (its loop never executes) and returns
// fullyReverted: true, so the reason stays the plain 'git-mv-failed' string
// exactly as before this fix.
test('archiveRunDir: git mv fails on the first pair — no revert needed, reason is plain git-mv-failed (unchanged behavior)', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1201-1202';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1201/work/1201-spec.md`, '# spec 1201\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1202/work/1202-spec.md`, '# spec 1202\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  let mvCount = 0;
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isMv = cmd === 'git' && Array.isArray(args) && args[2] === 'mv';
    if (isMv) {
      mvCount += 1;
      if (mvCount === 1) throw new Error('simulated failure: git mv (1st pair)');
    }
    return execFileSync(cmd, args, opts);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'git-mv-failed');

  // Neither pair moved — the first pair's mv is the one that failed, and the
  // loop never reaches the second pair.
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1201', 'work', '1201-spec.md')), true);
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1202', 'work', '1202-spec.md')), true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1201', 'work')), false);
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1202', 'work')), false);
});

// #1103 second-round finding: removing context.js's existence-only
// archive-twin skip widened a race between two concurrent, unlocked
// `reconcile` invocations selecting the same run dir. archiveRunDir now
// writes a content-aware 'archiving' claim the instant it mkdir's
// archiveDir — before any content moves — so a second scan's
// iterRunDirsWithState still skips this run dir for the duration of the
// call, and the claim survives (with a fresh updatedAt) even on failure, so
// a crashed/failed attempt's claim is visible until context.js's TTL
// expires it, rather than vanishing immediately and reopening the race.
test('archiveRunDir: writes an interim "archiving" claim to the archive twin before attempting any move, and it survives a failure', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1301';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/1301-spec.md`, '# spec 1301\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  let mvCount = 0;
  const before = Date.now();
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isMv = cmd === 'git' && Array.isArray(args) && args[2] === 'mv';
    if (isMv) {
      mvCount += 1;
      throw new Error('simulated failure: git mv');
    }
    return execFileSync(cmd, args, opts);
  });
  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(mvCount, 1);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const claim = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(claim.status, 'archiving');
  assert.ok(Date.parse(claim.updatedAt) >= before, 'claim must carry a fresh updatedAt for TTL staleness checks');
});

// #990: a write landing in the run dir strictly AFTER the top-level
// readdirSync snapshot but strictly BEFORE the final rmdirSync — reproduced
// live during #893's own wrap-up even with #902's dynamic-enumeration fix
// (08098fe7) already on main. Simulated here by mocking fs.readdirSync so
// that, on the exact call the top-level enumeration makes against runDir,
// a new gitignored file lands on disk immediately after the real snapshot
// is captured but before it is returned — the same one-shot gap a
// concurrent `wrap-up-engine.js record` write could hit in practice.
// Verified by reverting the archive-merged.js fix and confirming this test
// fails (the late file survives on disk, unarchived, and runDir is not
// removed) before landing the guard that makes it pass.
test('archiveRunDir: a write landing after the readdir snapshot but before the final rmdir is swept, not orphaned (regression #990)', (t) => {
  const root = makeRepo();
  const runId = '2026-08-20T044204-record-990';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'auto-mode: true\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const originalReaddirSync = fs.readdirSync.bind(fs);
  let injected = false;
  t.mock.method(fs, 'readdirSync', (p, opts) => {
    const entries = originalReaddirSync(p, opts);
    // `listSpecDirs` also calls `fs.readdirSync(runDir, { withFileTypes: true })`
    // earlier in the same archiveRunDir pass — match only the top-level
    // enumeration's own plain, no-options call (`fs.readdirSync(runDir)`) so
    // the injected write lands after THAT snapshot, not before it.
    if (!injected && p === runDir && opts === undefined) {
      injected = true;
      // Lands strictly after the snapshot the caller is about to receive —
      // `entries` above was already captured and cannot see this write.
      fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify({ version: 1 }));
    }
    return entries;
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(injected, true, 'the late-write injection must actually have fired for this test to be meaningful');

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(runDir), false, 'run dir must not survive with orphaned residue');
  assert.equal(
    fs.existsSync(path.join(archiveDir, 'engine-state.json')),
    true,
    'the late-written engine-state.json must reach the archive, not be left behind',
  );
});

test('listSpecDirs: only spec-* subdirectories, ignores files and non-matching dirs; empty for unreadable dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-spec-dirs-'));
  fs.mkdirSync(path.join(dir, 'spec-1'));
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.mkdirSync(path.join(dir, 'staged'));
  fs.writeFileSync(path.join(dir, 'spec-not-a-dir.txt'), 'x');
  assert.deepEqual(listSpecDirs(dir).sort(), ['spec-1', 'spec-2']);
  assert.deepEqual(listSpecDirs(path.join(dir, 'does-not-exist')), []);
});

// Re-pin the existing exports still resolve after the refactor above touched
// the same module — a regression here would mean the export list drifted.
test('archive-merged module still exports its pre-existing surface', () => {
  assert.equal(typeof decideArchive, 'function');
  assert.equal(typeof readConsoleState, 'function');
  assert.equal(typeof isOrphanedMint, 'function');
});

// #1446/#1447 — archiveOrphanedMint's catch site must bind and thread the
// underlying error as lastError, same as archiveRunDir's move-failed sites.
test('archiveOrphanedMint: a forced fs.renameSync throw is captured as a non-empty lastError', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-orphan-mint-'));
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-orphan');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{}');

  t.mock.method(fs, 'renameSync', () => {
    throw new Error('simulated failure: fs.renameSync (orphaned mint)');
  });

  const result = archiveOrphanedMint(root, dir);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'move-failed');
  assert.match(result.lastError, /simulated failure: fs\.renameSync \(orphaned mint\)/);
});

// #1713/#1714 — a whole-dir fs.renameSync onto a non-empty archive twin
// throws ENOTEMPTY unconditionally and permanently wedges the run dir at
// move-failed; archiveOrphanedMint must instead move each entry
// individually, which merges cleanly into a destination that already holds
// unrelated entries from a prior partial attempt.
test('archiveOrphanedMint: archives cleanly onto an archive twin that already exists non-empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-orphan-mint-preexist-'));
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-orphan');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{}');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-01-01T000000-orphan');
  // Simulate a prior partial attempt: the archive twin already exists and
  // already holds an unrelated leftover entry — the exact precondition that
  // ENOTEMPTYs a whole-directory rename.
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'leftover.txt'), 'from a prior attempt\n');

  const result = archiveOrphanedMint(root, dir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(dir), false, 'source orphaned-mint dir should be removed');
  assert.equal(fs.existsSync(path.join(archiveDir, 'leftover.txt')), true, 'pre-existing entry must survive untouched');
  assert.equal(fs.existsSync(path.join(archiveDir, 'run-state.json')), true, 'new entries must land alongside it');
  assert.equal(fs.existsSync(path.join(archiveDir, 'events.jsonl')), true);
});

// --- #2227: orphaned mints that still hold git-tracked content ---

// A state-less run dir (no config.yml, no run-state.json) can still carry a
// git-tracked work/{n}-spec.md — record #1594's shape, where the run's state
// files only ever existed in the worktree copy. The bare fs.renameSync path
// left main with an unstaged deletion nothing committed; such a dir must go
// through archiveRunDir's git mv + commit instead.
test('archiveMerged: an orphaned mint carrying a git-tracked work/ spec is archived via a commit, leaving the tracked tree clean', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-01-01T000000-record-2227';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/2227-spec.md`, '# 2227\n');
  const backdated = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();

  const result = archiveMerged({ cwd: root });

  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'source run dir must be gone');
  assert.equal(
    fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'work', '2227-spec.md')),
    true,
    'spec must land under archive/',
  );
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/2227-spec.md`),
    'archived spec must be tracked at its new path (git mv, not fs rename)',
  );
  assert.notEqual(git(root, 'rev-parse', 'HEAD').trim(), headBefore, 'archival must land as a commit');
  // Scoped to tracked status only: the archive twin's run-state.json
  // ('archiving' stamp) is a genuine untracked sibling in this fixture (in
  // the real repo it is gitignored) and unrelated to what this test pins.
  const statusOut = git(root, 'status', '--porcelain', '--', '.claude-tweaks/pipelines');
  const trackedStatusLines = statusOut.split('\n').filter((line) => line && !line.startsWith('??'));
  assert.equal(trackedStatusLines.join('\n'), '', 'no unstaged deletion or staged rename may survive the pass');
});

// The fs-only path is unchanged for a genuinely untracked mint: no git mv,
// no commit, and no `archiving` stamp (archiveRunDir's own first write).
test('archiveMerged: an orphaned mint with no tracked content still takes the fs-only path with no commit', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-01-01T000000-spec-untracked-mint';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  const backdated = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();

  const result = archiveMerged({ cwd: root });

  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'source run dir must be gone');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(path.join(archiveDir, 'events.jsonl')), true, 'untracked entry must be moved as-is');
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), headBefore, 'fs-only path must not commit');
  assert.equal(fs.existsSync(path.join(archiveDir, 'run-state.json')), false, 'fs-only path never writes archiveRunDir\'s archiving stamp');
});

// When archiveRunDir refuses the routed dir, the refusal is a visible skip
// reason — never a silent fs move of tracked content, never a silent no-op —
// and the dir is left in place with work/ back at its original path.
test('archiveMerged: a refused git-aware archival of a tracked orphaned mint surfaces in skipped and leaves the dir in place', (t) => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-01-01T000000-record-2227-refused';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/2227-spec.md`, '# 2227\n');
  const backdated = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);
  // Installed after commitPath's own commit so only archiveRunDir's commit fails.
  installFailingPreCommitHook(root);
  t.after(() => removePreCommitHook(root));

  const result = archiveMerged({ cwd: root });

  assert.ok(!result.archived.includes(runDir), 'a refused archival must not count as archived');
  assert.ok(
    result.skipped.some((s) => s.runDir === runDir && s.reason === 'commit-failed'),
    `expected a commit-failed skip for ${runDir}, got ${JSON.stringify(result.skipped)}`,
  );
  assert.equal(fs.existsSync(path.join(runDir, 'work', '2227-spec.md')), true, 'work/ must be reverted to its original path');
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/${runId}/work/2227-spec.md`),
    'the spec must still be tracked at its original path after the revert',
  );
  assert.equal(
    fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'work', '2227-spec.md')),
    false,
    'nothing may be left under archive/ after a reverted refusal',
  );
});

// #2227 review finding: an unanswered `git ls-files` probe (timeout / spawn /
// no-git — git-exec.js's isIndeterminate) must not read as "untracked". That
// conflation would route a tracked spec back to the bare fs rename under
// exactly the parallel-suite load that makes probes time out. Assume tracked
// instead: archiveRunDir runs (here it succeeds — its own ls-files probes
// are not mocked), and the archival lands as a commit, never as an unstaged
// deletion.
test('archiveMerged: an indeterminate ls-files probe on an orphaned mint assumes tracked and still archives via a commit', (t) => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-01-01T000000-record-2227-indeterminate';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/2227-spec.md`, '# 2227\n');
  const backdated = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();

  let probeCalls = 0;
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isTrackedProbe = cmd === 'git' && Array.isArray(args) && args[2] === 'ls-files' && args[3] === '--';
    if (isTrackedProbe) {
      probeCalls += 1;
      const err = new Error('simulated timeout: git ls-files');
      err.killed = true;
      err.signal = 'SIGTERM';
      throw err;
    }
    return execFileSync(cmd, args, opts);
  });

  const result = archiveMerged({ cwd: root });

  assert.equal(probeCalls, 1, 'the tracked-content probe must have been the call that timed out');
  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.notEqual(git(root, 'rev-parse', 'HEAD').trim(), headBefore, 'an indeterminate probe must still archive via a commit, never the bare fs rename');
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/2227-spec.md`),
    'archived spec must be tracked at its new path',
  );
});

// #2227 review lens 3c: a definitive `git-error` from the probe (git ran and
// exited non-zero — a corrupt index, an unreadable object store) is no more
// proof of "untracked" than a timeout is. archiveRunDir's own ls-files guard
// already refuses on ANY failure (`ls-files-failed`); this helper must not be
// the one place a probe failure quietly selects the bare fs rename.
test('archiveMerged: a git-error from the ls-files probe on an orphaned mint assumes tracked and still archives via a commit', (t) => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-01-01T000000-record-2227-git-error';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/2227-spec.md`, '# 2227\n');
  const backdated = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  fs.utimesSync(runDir, backdated, backdated);
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();

  let probeCalls = 0;
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isTrackedProbe = cmd === 'git' && Array.isArray(args) && args[2] === 'ls-files' && args[3] === '--';
    if (isTrackedProbe) {
      probeCalls += 1;
      // No killed/signal/code fields: git-exec's classify() maps this to
      // FAILURE.GIT_ERROR — the one kind isIndeterminate() does NOT cover.
      const err = new Error('simulated git-error: fatal: index file corrupt');
      err.status = 128;
      throw err;
    }
    return execFileSync(cmd, args, opts);
  });

  const result = archiveMerged({ cwd: root });

  assert.equal(probeCalls, 1, 'the tracked-content probe must have been the call that errored');
  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.notEqual(git(root, 'rev-parse', 'HEAD').trim(), headBefore, 'a git-error probe must still archive via a commit, never the bare fs rename');
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/2227-spec.md`),
    'archived spec must be tracked at its new path',
  );
});

// #644 Deliverable 2 — trackArchiveResult is archiveMerged's one choke
// point for the move-failed consecutive-failure counter and escalation.
test('trackArchiveResult: escalates exactly once at the threshold via an injected escalate, never on later still-failing calls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-track-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-stuck');

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackArchiveResult(root, 'o/r', dir, { ok: false, reason: 'move-failed' }, { escalate });
  }
  assert.equal(calls.length, 1, `expected exactly one escalation call, got ${calls.length}`);
  assert.equal(calls[0].reason, 'move-failed');
  assert.equal(calls[0].targetPath, dir);
  assert.equal(calls[0].count, RESIDUE_ESCALATE_THRESHOLD);

  trackArchiveResult(root, 'o/r', dir, { ok: false, reason: 'move-failed' }, { escalate });
  assert.equal(calls.length, 1, 'must not re-escalate on a later still-failing call');
});

// #1446/#1447 — trackArchiveResult must forward result.lastError (now
// captured at each move-failed catch site) into both the injected escalate
// call and the residue cache entry, mirroring reap-merged.js's
// trackReapResidue exactly.
test('trackArchiveResult: forwards result.lastError into escalate and the residue cache entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-track-lasterr-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-lasterr');

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackArchiveResult(
      root, 'o/r', dir,
      { ok: false, reason: 'move-failed', lastError: 'EACCES: permission denied, rename \'a\' -> \'b\'' },
      { escalate },
    );
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].lastError, /EACCES: permission denied/);

  const cached = listResidueFailures(root).find((f) => f.reason === 'move-failed' && f.path === dir);
  assert.ok(cached, 'expected a residue cache entry for this dir');
  assert.match(cached.lastError, /EACCES: permission denied/);
});

test('trackArchiveResult: only tracks move-failed — a different failure reason never enters the counter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-track2-'));
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-other');
  trackArchiveResult(root, 'o/r', dir, { ok: false, reason: 'commit-failed' });
  assert.deepEqual(listResidueFailures(root), []);
});

test('trackArchiveResult: a success clears a prior failure streak for the same dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-track3-'));
  const dir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-recovered');
  trackArchiveResult(root, 'o/r', dir, { ok: false, reason: 'move-failed' });
  assert.equal(listResidueFailures(root).length, 1);
  trackArchiveResult(root, 'o/r', dir, { ok: true, movedEntries: [] });
  assert.deepEqual(listResidueFailures(root), []);
});

// --- #1613: isStructurallyStuck / trackStuckSkip — visibility for a run dir
// stuck in no-worktree/no-branch/no-pr with no escalation path, without
// changing archiveMerged's own skip-in-place behavior ---

function mkDirWithMtime(ageMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-stuck-'));
  if (ageMs) {
    const backdated = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, backdated, backdated);
  }
  return dir;
}

test('isStructurallyStuck: false for a non-qualifying reason regardless of age', () => {
  const dir = mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS * 2);
  assert.equal(isStructurallyStuck(dir, 'console-unresolved'), false);
  assert.equal(isStructurallyStuck(dir, 'pr-open'), false);
  assert.equal(isStructurallyStuck(dir, 'local-behind-merge'), false);
});

test('isStructurallyStuck: false for no-worktree/no-branch/no-pr while still within the TTL', () => {
  const dir = mkDirWithMtime(60 * 60 * 1000);
  assert.equal(isStructurallyStuck(dir, 'no-worktree'), false);
  assert.equal(isStructurallyStuck(dir, 'no-branch'), false);
  assert.equal(isStructurallyStuck(dir, 'no-pr'), false);
});

test('isStructurallyStuck: true for no-worktree/no-branch/no-pr once the TTL has elapsed', () => {
  const dir = mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS * 2);
  assert.equal(isStructurallyStuck(dir, 'no-worktree'), true);
  assert.equal(isStructurallyStuck(dir, 'no-branch'), true);
  assert.equal(isStructurallyStuck(dir, 'no-pr'), true);
});

test('trackStuckSkip: escalates exactly once at the threshold for a genuinely stuck dir, never for a fresh one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-stuckskip-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const stuckDir = mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS * 2);

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackStuckSkip(root, 'o/r', stuckDir, 'no-branch', { escalate });
  }
  assert.equal(calls.length, 1, `expected exactly one escalation call, got ${calls.length}`);
  assert.equal(calls[0].reason, 'structurally-stuck');
  assert.equal(calls[0].targetPath, stuckDir);

  trackStuckSkip(root, 'o/r', stuckDir, 'no-branch', { escalate });
  assert.equal(calls.length, 1, 'must not re-escalate on a later still-stuck call');
});

test('trackStuckSkip: never escalates an ordinary in-flight dir, no matter how many passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-notstuck-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const freshDir = mkDirWithMtime(60 * 60 * 1000);

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD * 5; i++) {
    trackStuckSkip(root, 'o/r', freshDir, 'no-pr', { escalate });
  }
  assert.equal(calls.length, 0, 'an ordinary mid-flight dir must never be escalated by this path');
  assert.deepEqual(listResidueFailures(root), [], 'a non-stuck dir must not even enter the residue counter');
});

// One real archiveMerged() pass, well under the 3-pass escalation threshold
// (so the real, non-injectable escalateResidue is never actually invoked) —
// proves the trackStuckSkip wiring doesn't alter archiveMerged's own skip
// behavior (AC3: skip-in-place is unchanged), and that the residue cache
// correctly starts tracking a stuck-shaped dir but not a fresh one.
test('archiveMerged: still skips in place on a single pass, but only starts tracking a genuinely stuck dir (not a fresh one)', () => {
  const root = fs.realpathSync(makeRepo());

  const stuckId = '2026-01-01T000000-stuck-spec-1613';
  const stuckDir = path.join(root, '.claude-tweaks', 'pipelines', stuckId);
  fs.mkdirSync(stuckDir, { recursive: true });
  // config.yml marks this dir as adopted (flow's Manifesto ran) — without
  // it, isOrphanedMint's own 24h mtime sweep would archive this dir first,
  // before ever reaching the no-worktree skip this test means to exercise.
  fs.writeFileSync(path.join(stuckDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(stuckDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, 'long-gone-worktree'), sessionId: 'sess-1',
  }));
  const stuckBackdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(stuckDir, stuckBackdated, stuckBackdated);

  const freshId = '2026-01-01T010000-fresh-spec-1614';
  const freshDir = path.join(root, '.claude-tweaks', 'pipelines', freshId);
  fs.mkdirSync(freshDir, { recursive: true });
  fs.writeFileSync(path.join(freshDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(freshDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, 'also-gone-worktree'), sessionId: 'sess-2',
  }));

  const result = archiveMerged({ cwd: root });

  // state.worktree is set (a torn-down path), so isOrphanedMint/no-worktree
  // don't apply — worktrees.find() fails to match it against `git worktree
  // list`, landing on the no-branch skip (archive-merged.js:827-832).
  assert.ok(result.skipped.some((s) => s.runDir === stuckDir && s.reason === 'no-branch'));
  assert.ok(result.skipped.some((s) => s.runDir === freshDir && s.reason === 'no-branch'));
  assert.ok(!result.archived.includes(stuckDir));
  assert.ok(!result.archived.includes(freshDir));

  const failures = listResidueFailures(root);
  assert.ok(failures.some((f) => f.reason === 'structurally-stuck' && f.path === stuckDir), 'the stuck dir must start accumulating a residue count');
  assert.ok(!failures.some((f) => f.reason === 'structurally-stuck' && f.path === freshDir), 'the fresh (just-created) dir must not enter the counter at all');
});

// --- #1673: auto-close an abandoned `interrupted` run whose work shipped ---

// AC1: a stale interrupted run meeting the shipped-unclosed evidence bar,
// with no owning session, is auto-closed and counted in archived.
test('archiveMerged: an abandoned interrupted run whose work shipped is auto-closed via closeRunState and counted in archived', () => {
  const runId = '2026-08-01T090000-spec-1673-close';
  const { root, runDir } = fixtureAbandonedShippedRun({ runId });

  const result = archiveMerged({ cwd: root, sessionId: 'this-session' });

  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const state = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'clean');
  assert.equal(state.worktree, null);
  const events = fs.readFileSync(path.join(archiveDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(
    events.some((e) => e.type === 'close-without-wrapup'),
    `expected a close-without-wrapup event, got ${JSON.stringify(events)}`,
  );
  assert.equal(fs.existsSync(runDir), false, 'original run dir must have been archived away');
});

// AC2: a run with a live owning session is never auto-closed by this
// criterion, regardless of evidence bar — the control case that must stay
// green even before Task 2's implementation lands.
test('archiveMerged: a run owned by the calling session is never auto-closed, even when otherwise shipped-unclosed', () => {
  const runId = '2026-08-01T090000-spec-1673-live';
  const { root, runDir } = fixtureAbandonedShippedRun({ runId, ownerSessionId: 'this-session' });

  const result = archiveMerged({ cwd: root, sessionId: 'this-session' });

  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT in archived, got ${JSON.stringify(result)}`);
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'interrupted');
});

// AC3: fallback-attributed events landing in a stale run's events.jsonl must
// not make it look alive — a fallback line is another session's activity
// guessed into this run, not evidence this run is still owned by anyone.
test('archiveMerged: recent fallback-attributed events do not block auto-close — only non-fallback activity counts as recency', () => {
  const runId = '2026-08-01T090000-spec-1673-fallback';
  const recentFallback = JSON.stringify({
    skill: 'claude-tweaks:build', attribution: 'fallback', ts: new Date().toISOString(), type: 'skill_invoked',
  });
  const { root, runDir } = fixtureAbandonedShippedRun({ runId, extraEventLines: [recentFallback] });

  const result = archiveMerged({ cwd: root, sessionId: 'this-session' });

  assert.ok(
    result.archived.includes(runDir),
    `a recent fallback-attributed event must not prevent auto-close, got ${JSON.stringify(result)}`,
  );
});

// F1/F5 regression guard: under the OLD close-first ordering, this test fails
// — closeRunState would have already flipped the (pre-move) run dir's own
// run-state.json to status:'clean' before archiveRunDir ever ran, so a
// subsequent archive failure would leave the run 'clean' (and therefore
// permanently invisible to iterRunDirsWithState) instead of 'interrupted'.
// Proven by the Mandatory proof step below (old ordering restored,
// re-verified this test goes red).
test('archiveMerged: an abandoned interrupted run whose archive move fails is reported in skipped and stays interrupted, not silently closed', () => {
  const runId = '2026-08-01T090000-spec-1673-archivefail';
  const { root, runDir } = fixtureAbandonedShippedRun({ runId });
  // A git-tracked work/ subtree so archiveRunDir actually reaches `git
  // commit` — without one, the plain fs.renameSync path never touches git at
  // all and installFailingPreCommitHook has nothing to bite.
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/1673-spec.md`, '# spec 1673\n');
  installFailingPreCommitHook(root);

  const result = archiveMerged({ cwd: root, sessionId: 'this-session' });

  assert.ok(
    result.skipped.some((s) => s.runDir === runDir),
    `expected ${runDir} in skipped when the archive move fails, got ${JSON.stringify(result)}`,
  );
  assert.ok(
    !result.archived.includes(runDir),
    'a failed archive must never be counted as archived',
  );
  assert.equal(
    fs.existsSync(runDir),
    true,
    'the run dir must still exist on disk after a failed archive — nothing was actually moved',
  );
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  assert.equal(
    state.status,
    'interrupted',
    `expected the run to stay 'interrupted' (never closed) after a failed archive, got ${JSON.stringify(state)}`,
  );
});

// F3: a direct unit test for isAbandonedInterrupted's ownership-equality
// branch — same state, same run dir, only `sessionId` varies. Pins the one
// line the safety property hinges on, independent of the integration path
// (the AC2 integration test above stays green even with this branch deleted,
// since its fixture tears down the worktree and falls through to the
// pre-existing no-branch skip either way).
test('isAbandonedInterrupted: false when owner === sessionId, true when they differ (same state, same run dir)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-ownereq-'));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  // Dated well outside STALE_INTERRUPTED_TTL_MS so the recency half of the
  // criterion never masks what this test is actually pinning.
  fs.writeFileSync(
    path.join(runDir, 'events.jsonl'),
    JSON.stringify({ type: 'skill_invoked', ts: '2020-01-01T00:00:00.000Z' }) + '\n',
  );
  const state = { status: 'interrupted', sessionId: 'sess-a' };

  assert.equal(
    isAbandonedInterrupted(runDir, state, 'sess-a'),
    false,
    'the owning session must never see its own live run as abandoned',
  );
  assert.equal(
    isAbandonedInterrupted(runDir, state, 'sess-b'),
    true,
    'a different session id, with no recent self-attributed activity, is a genuine abandoned-run candidate',
  );
});

// F9: an unreadable/absent events.jsonl must fail toward not-abandoned, not
// toward stale — see hasReadableEventsLog's header comment for why this must
// not rely on checkRunIntegrity's own separate read of the same file.
test('isAbandonedInterrupted: an unreadable/absent events.jsonl is UNKNOWN evidence — never treated as abandoned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-unknownlog-'));
  const runDir = path.join(root, 'run-no-log');
  fs.mkdirSync(runDir, { recursive: true }); // events.jsonl deliberately never written
  const state = { status: 'interrupted' }; // no owner recorded either

  assert.equal(
    isAbandonedInterrupted(runDir, state, 'this-session'),
    false,
    'an unreadable/absent events log must never be treated as evidence of staleness',
  );
});

test('lastOwnEventMs: excludes fallback-attributed lines, returns the newest non-fallback timestamp', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-lastown-'));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
    JSON.stringify({ type: 'skill_invoked', ts: '2020-01-01T00:00:00.000Z' }),
    JSON.stringify({ type: 'skill_invoked', ts: '2026-01-01T00:00:00.000Z', attribution: 'fallback' }),
  ].join('\n') + '\n');
  assert.equal(lastOwnEventMs(runDir), Date.parse('2020-01-01T00:00:00.000Z'));
});

test('lastOwnEventMs: null when events.jsonl is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-lastown2-'));
  assert.equal(lastOwnEventMs(path.join(root, 'no-such-run')), null);
});

// --- #1684: a non-'clean' (active) run dir whose record-worktree stamp
// never landed — the exact shape a /flow run split across two Task-call
// sessions leaves behind when the second session's write is classified
// foreign — must still archive once its PR confirmably merges, via the same
// fallbackBranch(state.pr.branch / decisions.md) source #1544's clean-status
// sweep already uses, rather than being stuck at 'no-worktree' forever.

function fixtureActiveUnstampedMergedRun({ runId, worktreeExplicitlyNull = false } = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-unstamped-branch');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const state = { status: 'active', pr: { branch: 'feat-unstamped-branch' } };
  // record-worktree genuinely never ran — field absent OR null, both must fall back
  if (worktreeExplicitlyNull) state.worktree = null;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  return { root, runDir, featureSha };
}

test('archiveMerged: an active run dir with no worktree stamp but a merged PR is archived via fallbackBranch, not stuck at no-worktree', () => {
  const runId = '2026-08-31T090000-spec-1684-unstamped';
  const { root, runDir, featureSha } = fixtureActiveUnstampedMergedRun({ runId });
  const wrapper = installGhWrapper([{
    number: 101, state: 'MERGED', mergedAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z',
    mergeCommit: { oid: featureSha },
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.ok(!result.skipped.some((s) => s.runDir === runDir), 'must not also appear in skipped');
  assert.equal(fs.existsSync(runDir), false, 'original run dir must have been archived away');
});

test('archiveMerged: an active run dir with worktree explicitly null but a merged PR is still archived via fallbackBranch', () => {
  const runId = '2026-08-31T090000-spec-1684-nullworktree';
  const { root, runDir, featureSha } = fixtureActiveUnstampedMergedRun({ runId, worktreeExplicitlyNull: true });
  const wrapper = installGhWrapper([{
    number: 102, state: 'MERGED', mergedAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z',
    mergeCommit: { oid: featureSha },
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
});

test('archiveMerged: an active run dir with no worktree stamp AND no recoverable branch still skips no-worktree, not archive', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-31T090000-spec-1684-nobranch';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveMerged({ cwd: root });

  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'no-worktree', 'no worktree stamp and no fallback source must still read as no-worktree, unchanged');
  assert.equal(fs.existsSync(runDir), true);
});

// --- #1544: archive a status:'clean' run dir with a confirmed merged PR ---
// (previously invisible to archiveMerged — iterRunDirsWithState excludes
// every status:'clean' dir by design, so a run whose archive-run step never
// followed close-run sat in pipelines/ forever.)

test('archiveMerged: a status:clean run dir with a merged PR is archived (previously skipped)', () => {
  const runId = '2026-08-01T090000-clean-1544-merged';
  const { root, runDir, featureSha } = fixtureCleanUnarchivedRun({ runId });
  const wrapper = installGhWrapper([{
    number: 99, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'original run dir must have been archived away');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(archiveDir), true);
});

// The gotcha this issue names explicitly: clean-status alone is never
// sufficient — an OPEN (not-yet-merged) PR must leave the run dir in place.
test('archiveMerged: a status:clean run dir whose PR is still OPEN is never archived — clean status alone is not enough', () => {
  const runId = '2026-08-01T090000-clean-1544-open';
  const { root, runDir } = fixtureCleanUnarchivedRun({ runId });
  const wrapper = installGhWrapper([{
    number: 100, state: 'OPEN', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z',
  }]);
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir), `expected ${runDir} NOT archived while its PR is still open, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), true, 'a clean-status dir with an unmerged PR must stay in place');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'pr-open');
});

// A clean-status dir with no recoverable branch (no pr.branch stamp, no
// decisions.md PR-early lifecycle line) must skip on 'no-branch', never
// throw or silently archive.
test('archiveMerged: a status:clean run dir with no recoverable branch is skipped, not archived', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-clean-1544-nobranch';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: null }));

  const result = archiveMerged({ cwd: root });

  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'no-branch');
  assert.equal(fs.existsSync(runDir), true);
});

// #1962: a stamped worktree that's confirmably gone AND whose branch has
// since been deleted (no branch left for fallbackBranch to recover) used to
// skip 'no-branch' forever, even though the run's closed PR is still
// knowable by number (run-state.json's `pr.number`, stamped once and never
// cleared). The sweep now probes that PR directly and archives once its
// console is resolved.
test('archiveMerged: a run dir whose stamped worktree is gone and branch is unrecoverable is archived once its closed PR is confirmed by number', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-record-1962-nobranch-closedpr';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-1962'), // stamped, but never created here
    pr: { number: 1962, branch: 'worktree-record-1962-gone' }, // branch does not exist in this repo
  }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));

  const wrapper = installGhWrapper({ number: 1962, state: 'CLOSED', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z', mergeCommit: null });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'original run dir must have been archived away');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(archiveDir), true);
});

test('archiveMerged: same shape as above, but console is unresolved — stays in place, never archived', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-record-1962-nobranch-closedpr-unresolved';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-1962b'),
    pr: { number: 1963, branch: 'worktree-record-1962-gone-b' },
  }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: false }));

  const wrapper = installGhWrapper({ number: 1963, state: 'CLOSED', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z', mergeCommit: null });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'console-unresolved');
  assert.equal(fs.existsSync(runDir), true);
});

test('archiveMerged: same shape as above, but the PR-by-number probe reports OPEN — falls back to the ordinary no-branch skip', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-record-1962-nobranch-openpr';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-1962c'),
    pr: { number: 1964, branch: 'worktree-record-1962-gone-c' },
  }));

  const wrapper = installGhWrapper({ number: 1964, state: 'OPEN', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z', mergeCommit: null });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'no-branch');
  assert.equal(fs.existsSync(runDir), true);
});

// #2226: a stamped worktree that's confirmably gone AND whose branch has
// since been deleted used to fall through to the plain 'no-branch' skip
// forever once its by-number-probed PR came back MERGED rather than
// CLOSED (GitHub's 3-value enum never satisfies a CLOSED-only check). The
// fallback now also recognizes MERGED, gated by the same localHasMerge
// check the general merged-PR path below already applies.
test('archiveMerged: a run dir whose stamped worktree is gone and branch is unrecoverable is archived once its merged PR is confirmed by number and the merge commit is locally reachable', () => {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-1962-merged');
  git(root, 'branch', '-D', 'feat-1962-merged'); // branch ref itself is gone too — nothing left for fallbackBranch
  const runId = '2026-08-01T090000-record-1962-nobranch-mergedpr';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-1962-merged'), // stamped, but never created here
    pr: { number: 1965, branch: 'feat-1962-merged' }, // branch no longer exists
  }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));

  const wrapper = installGhWrapper({
    number: 1965, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'original run dir must have been archived away');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(archiveDir), true);
});

test('archiveMerged: same shape as above, but the merge commit is not yet locally reachable — skips local-behind-merge, never archives ahead of the local checkout', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-record-1962-nobranch-mergedpr-behind';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-1962-behind'),
    pr: { number: 1966, branch: 'feat-1962-behind-gone' }, // branch does not exist in this repo
  }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));

  // Well-formed 40-hex sha, but not actually an ancestor of (or present in)
  // this repo's history — the local checkout hasn't caught up on the merge.
  const unreachableSha = 'a'.repeat(40);
  const wrapper = installGhWrapper({
    number: 1966, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: unreachableSha },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'local-behind-merge');
  assert.equal(fs.existsSync(runDir), true);
});

// #2228: the #1962 fallback's outer gate used to require `stampedWorktree`
// truthy, so a run dir whose worktree was never stamped in the first place
// (the #1684 gap — e.g. a two-Task-call /flow run whose record-worktree
// write landed foreign) never reached the by-number probe at all, and was
// permanently stuck at 'no-worktree' even though its PR is knowable by
// number. The gate now fires whenever `state.pr.number` exists, regardless
// of whether a worktree was ever stamped.
test('archiveMerged: a run dir with no worktree stamp at all (never set) still reaches the #1962 by-number fallback and archives once its closed PR is confirmed', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-record-1962-noworktree-closedpr';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    // no `worktree` key at all — never stamped, distinct from a stamped-then-torn-down worktree
    pr: { number: 1967, branch: 'feat-1962-noworktree-gone' }, // branch does not exist in this repo
  }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));

  const wrapper = installGhWrapper({ number: 1967, state: 'CLOSED', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z', mergeCommit: null });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'original run dir must have been archived away');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.equal(fs.existsSync(archiveDir), true);
});

test('isAbandonedInterrupted: false for a non-interrupted status', () => {
  assert.equal(isAbandonedInterrupted('/x', { status: 'active' }, 'sess-1', Date.now()), false);
});

test('#1854: an auto-resolve console.json ({resolved:true, mode:"auto-resolve", …}) reads as resolved and archives, never console-never-rendered (#1932 AC6)', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-auto-resolve-'));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, mode: 'auto-resolve', at: '2026-09-06T12:00:00.000Z', ceiling: 'unattended', items: [], merge: { resolution: 'merge', reason: 'x' } }));
  assert.strictEqual(readConsoleState(runDir), 'resolved');
  const decision = decideArchive({ state: 'MERGED' }, readConsoleState(runDir));
  assert.notStrictEqual(decision.reason, 'console-never-rendered');
  assert.deepStrictEqual(decision, { action: 'archive' });
});

// --- #1892: split-state (archive twin exists, tracked work/ headers still live) ---

// AC1: an identical spec-{n}/work/{n}-spec.md at the archive twin is
// idempotent — the live copy is redundant and resolves via `git rm` (the
// twin's own copy is already tracked, the ordinary case since every prior
// archival commits it there via `git mv`), never a whole-dir `git mv` onto a
// non-empty destination (the ENOTEMPTY class #1713/#1714 already fixed one
// level up).
test('archiveRunDir: identical spec-{n}/work twin resolves via git rm, spec dir removed, archives cleanly', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-1-1336';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`, '# spec 1\n');
  // The twin already carries the identical content, tracked (a prior
  // archival's own `git mv` put it there).
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`, '# spec 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  assert.equal(fs.existsSync(path.join(runDir, 'spec-1')), false, 'live spec-1/ must be gone from disk');
  const tracked = trackedFiles(root);
  assert.equal(
    tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`),
    false,
    'old path must not remain tracked in the git index',
  );
  assert.ok(
    tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`),
    'the twin copy must stay tracked at the archive path',
  );
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1', 'work', '1-spec.md')), true);
});

// AC1 continued: a twin whose content genuinely differs must refuse rather
// than guess which copy is canonical — `work-twin-conflict`, naming both
// paths, and nothing moves.
test('archiveRunDir: differing spec-{n}/work twin returns work-twin-conflict and moves nothing', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-1-conflict';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`, '# spec 1 (live version)\n');
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`, '# spec 1 (archived version — DIFFERENT)\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'work-twin-conflict');
  assert.equal(result.conflict.src, path.join(runDir, 'spec-1', 'work'));
  assert.equal(result.conflict.dest, path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId, 'spec-1', 'work'));
  assert.deepEqual(result.conflict.differing, ['1-spec.md']);

  // Nothing moved: both copies stay exactly where they were, both tracked.
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1', 'work', '1-spec.md')), true);
  const tracked = trackedFiles(root);
  assert.ok(tracked.includes(`.claude-tweaks/pipelines/${runId}/spec-1/work/1-spec.md`));
  assert.ok(tracked.includes(`.claude-tweaks/pipelines/archive/${runId}/spec-1/work/1-spec.md`));
});

// Same idempotent-twin fix, single-spec (top-level work/) layout — the more
// common shape than the multi-spec spec-{n}/ nesting the two tests above use.
test('archiveRunDir: identical top-level work/ twin resolves via git rm, archives cleanly', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-99';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/99-spec.md`, '# spec 99\n');
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/work/99-spec.md`, '# spec 99\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(runDir), false, 'run dir must be fully cleaned up');
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/99-spec.md`),
    'the twin copy must stay tracked at the archive path',
  );
});

// The twin copy can also be genuinely untracked (content matches, but
// nothing has staged it there yet) — resolves via `git mv -f` onto the twin
// path instead of `git rm`.
test('archiveRunDir: identical work twin whose copy is untracked resolves via git mv -f', () => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-100';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/100-spec.md`, '# spec 100\n');
  fs.mkdirSync(path.join(archiveDir, 'work'), { recursive: true });
  // Same content, but never `git add`/committed at the archive path.
  fs.writeFileSync(path.join(archiveDir, 'work', '100-spec.md'), '# spec 100\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(runDir), false);
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/work/100-spec.md`),
    'the resolved copy must now be tracked at the archive path',
  );
});

// Review finding: an untracked-twin resolution (`kind: 'twin-mv'`) is a
// single `git mv -f` — a real filesystem rename, not a copy — so only ONE
// physical file survives the forward op, at destFile. Before this fix,
// `revertStagedOps` undid it with `fs.renameSync(destFile, srcFile)`, which
// restores srcFile but silently deletes destFile — even though destFile
// existed as an independent physical file (that's what made it a twin)
// BEFORE this batch touched anything. A later failure elsewhere in the same
// batch (here: a sibling spec's plain `git mv`) must revert back to that
// exact pre-op state — both files present — not trade one for the other.
test('archiveRunDir: an untracked twin-mv, reverted after a later sibling spec fails, restores BOTH the live file and the twin copy', (t) => {
  const root = makeRepo();
  const runId = '2026-08-01T090000-spec-1501-1502';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  // spec-1501: untracked archive twin, identical content — resolves via the
  // twin-mv branch of resolveIdenticalWorkTwin.
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1501/work/1501-spec.md`, '# spec 1501\n');
  fs.mkdirSync(path.join(archiveDir, 'spec-1501', 'work'), { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'spec-1501', 'work', '1501-spec.md'), '# spec 1501\n');
  // spec-1502: no twin — goes through the ordinary workMoves `git mv`, which
  // is mocked to fail, forcing revertStagedOps to undo the twin-mv above too.
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1502/work/1502-spec.md`, '# spec 1502\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    const isPlainMv = cmd === 'git' && Array.isArray(args) && args[2] === 'mv' && args[3] !== '-f';
    if (isPlainMv) throw new Error('simulated failure: git mv (spec-1502, no twin)');
    return execFileSync(cmd, args, opts);
  });

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false, JSON.stringify(result));

  // The live copy is back, with its original content.
  const srcFile = path.join(runDir, 'spec-1501', 'work', '1501-spec.md');
  assert.equal(fs.existsSync(srcFile), true, 'srcFile must be restored on revert');
  assert.equal(fs.readFileSync(srcFile, 'utf8'), '# spec 1501\n');
  // The twin's own pre-existing copy must survive the revert too — the bug
  // this test pins deleted it via a rename instead of a copy.
  const destFile = path.join(archiveDir, 'spec-1501', 'work', '1501-spec.md');
  assert.equal(fs.existsSync(destFile), true, 'the twin copy must NOT be deleted by a reverted twin-mv');
  assert.equal(fs.readFileSync(destFile, 'utf8'), '# spec 1501\n');
  // Neither copy is left staged/tracked at the wrong path.
  assert.equal(fs.existsSync(path.join(archiveDir, 'spec-1502', 'work')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'spec-1502', 'work', '1502-spec.md')), true);
});

// compareWorkTwin's own unit coverage: a file missing at the twin path
// counts as differing (it still needs to move, not be silently dropped).
test('compareWorkTwin: a file present at src but missing at the twin counts as differing', () => {
  const root = makeRepo();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-twin-src-'));
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-twin-dest-'));
  fs.writeFileSync(path.join(srcDir, '1-spec.md'), '# spec\n');
  const result = compareWorkTwin(root, srcDir, destDir);
  assert.equal(result.identical, false);
  assert.deepEqual(result.differing, ['1-spec.md']);
});

// isArchivedPendingTrackedMove: pure-predicate coverage, independent of the
// full archiveMerged loop.
test('isArchivedPendingTrackedMove: true when the twin exists and the live dir holds only tracked work/ headers', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-1296-1336';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1336/work/1336-spec.md`, '# 1336\n');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), { recursive: true });

  assert.equal(isArchivedPendingTrackedMove(root, runDir), true);
});

test('isArchivedPendingTrackedMove: false when no archive twin exists yet', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-42-no-twin';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/42-spec.md`, '# 42\n');
  assert.equal(isArchivedPendingTrackedMove(root, runDir), false);
});

test('isArchivedPendingTrackedMove: false when a gitignored entry still lives alongside the tracked header', () => {
  const root = makeRepo();
  const runId = '2026-08-29T153740-spec-42-not-split';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/42-spec.md`, '# 42\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n'); // gitignored half still live
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), { recursive: true });
  assert.equal(isArchivedPendingTrackedMove(root, runDir), false);
});

test('archivedPendingTrackedMoveCommand: a paste-ready archive-run command naming the run dir', () => {
  const command = archivedPendingTrackedMoveCommand('/x/.claude-tweaks/pipelines/2026-01-01T000000-spec-1');
  assert.match(command, /bin\/hooks\.js" archive-run --run/);
  assert.match(command, /2026-01-01T000000-spec-1/);
});

// AC2 (Deliverable 2): under `worktree-always: true`, the split state is a
// distinct, informational skip — never an in-process commit against the
// main checkout — and never counts toward move-failed escalation.
test('archiveMerged: split-state run dir under worktree-always: true reports archived-pending-tracked-move, never archives, residueFailures stays empty', () => {
  const root = fs.realpathSync(makeRepo());
  setWorktreeAlways(root, true);
  const runId = '2026-08-29T153740-spec-1296-1336';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1336/work/1336-spec.md`, '# 1336\n');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId), { recursive: true });
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();

  const result = archiveMerged({ cwd: root });

  assert.ok(!result.archived.includes(runDir), 'must never archive in-process under worktree-always');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'archived-pending-tracked-move');
  assert.match(skip.command, /archive-run --run/);
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), headBefore, 'no commit may land from this sweep under worktree-always');
  assert.equal(fs.existsSync(runDir), true, 'the live run dir is left in place — the completing command handles it');
  assert.deepEqual(listResidueFailures(root), [], 'must never count toward move-failed escalation');
});

// AC1 (Deliverable 2, non-worktree-always half): without worktree-always,
// this sweep completes the split-state archival itself, in one pass.
test('archiveMerged: split-state run dir archives cleanly on one pass when worktree-always is not set', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-29T153740-spec-1296-1336-clean';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/spec-1296/work/1296-spec.md`, '# 1296\n');

  const result = archiveMerged({ cwd: root });

  assert.ok(result.archived.includes(runDir), `expected ${runDir} in archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false);
  assert.ok(
    trackedFiles(root).includes(`.claude-tweaks/pipelines/archive/${runId}/spec-1296/work/1296-spec.md`),
  );
});
