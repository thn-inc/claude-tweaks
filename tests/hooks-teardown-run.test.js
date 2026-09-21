// tests/hooks-teardown-run.test.js — #594: `bin/hooks.js teardown-run --run <dir>
// [--merged|--abandoned]`, one command composing the 5 steps a finished /flow run needed
// hand-assembled before this (close state, archive, remove worktree, delete local branch,
// delete remote ref).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teardownRun, defaultGhApiDelete } = require('../plugin/bin/lib/hooks/teardown-run');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// Main checkout on `trunk` (the integration branch, via policy.yml — never "main"), a fake
// `origin` remote (repoSlugOf only reads its URL from git config, no network hit), and one
// linked worktree on `feat-branch` recorded as the run's own worktree.
function fixtureRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-td-')));
  git(root, 'init', '-q', '-b', 'trunk');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'base');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: trunk\n');

  const wt = path.join(root, '.claude', 'worktrees', 'feat');
  git(root, 'worktree', 'add', '-q', '-b', 'feat-branch', wt);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'feature\n');
  git(wt, 'add', 'b.txt');
  git(wt, 'commit', '-q', '-m', 'feature work');

  const runId = '2026-08-01T090000-spec-9';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '9-spec.md'), '# 9\n');
  git(root, 'add', path.join('.claude-tweaks', 'pipelines', runId, 'work', '9-spec.md'));
  git(root, 'commit', '-q', '-m', 'materialize #9');
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# log\n');
  return { root, wt, runDir, runId };
}

function writeRunState(runDir, state) {
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
}

function fakeGhApiDelete(calls, result) {
  return (args) => { calls.push(args); return result; };
}

test('AC1: a merged run with an unlocked worktree performs all 5 steps and exits archived, worktree gone, branch gone, ref-delete called', () => {
  const { root, wt, runDir, runId } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /state: closed/);
  assert.match(result.lines.join('\n'), /archive: moved to archive/);
  assert.match(result.lines.join('\n'), /worktree: removed/);
  assert.match(result.lines.join('\n'), /branch: deleted feat-branch/);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'work', '9-spec.md')));
  assert.ok(!fs.existsSync(runDir));
  assert.doesNotMatch(git(root, 'worktree', 'list'), /feat-branch/);
  assert.strictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '');
  assert.deepStrictEqual(calls, [['repos/acme/widgets/git/refs/heads/feat-branch']]);
});

test('AC2: a locked worktree skips step 3 (skipped — worktree locked), never throws, and does not block archival', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  // Lock with the CURRENT process's own pid so isPidAlive reads it as a live session.
  git(root, 'worktree', 'lock', wt, '--reason', `claude session test (pid ${process.pid} start now)`);

  const result = teardownRun(runDir, { mode: null, sessionId: 'me' });

  assert.match(result.lines.join('\n'), /worktree: skipped — worktree locked/);
  assert.match(result.lines.join('\n'), /archive: moved to archive/);
  assert.match(git(root, 'worktree', 'list'), /feat-branch/);
});

test('AC3: --abandoned skips branch (step 4) and remote ref (step 5) deletion even though the branch still exists', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'abandoned', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /branch: skipped — abandoned/);
  assert.match(result.lines.join('\n'), /remote ref: skipped — abandoned/);
  assert.strictEqual(calls.length, 0, 'gh api delete must never be called under --abandoned');
  assert.notStrictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '', 'local branch must survive --abandoned');
});

test('AC4: defaultGhApiDelete reports a "reference does not exist" gh failure as success, not an error', (t) => {
  const cp = require('child_process');
  const err = new Error('gh: HTTP 422');
  err.stderr = 'gh: Reference does not exist (HTTP 422)';
  t.mock.method(cp, 'execFileSync', () => { throw err; });

  const result = defaultGhApiDelete(['repos/acme/widgets/git/refs/heads/gone-branch']);
  assert.deepStrictEqual(result, { ok: true, alreadyGone: true });
});

test('AC4b: defaultGhApiDelete reports a genuine gh failure as not-ok', (t) => {
  const cp = require('child_process');
  const err = new Error('gh: HTTP 403');
  err.stderr = 'gh: must have admin rights (HTTP 403)';
  t.mock.method(cp, 'execFileSync', () => { throw err; });

  const result = defaultGhApiDelete(['repos/acme/widgets/git/refs/heads/x']);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /admin rights/);
});

test('AC5: an explicit --run pointing at a foreign-session-owned run refuses the WHOLE teardown (mirrors close-run\'s foreignOwner refusal)', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'someone-else' });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.strictEqual(result.lines.length, 1);
  assert.match(result.lines[0], /refused .* another session/);
  assert.ok(fs.existsSync(runDir), 'run dir must not be archived when refused');
  assert.match(git(root, 'worktree', 'list'), /feat-branch/, 'worktree must not be removed when refused');
  assert.notStrictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '');
  assert.strictEqual(calls.length, 0);
});

test('AC6: refuses to delete the integration branch itself when the run\'s recorded worktree sits on it — never issues the delete call', () => {
  const { root, runDir } = fixtureRepo();
  // Move the main checkout off `trunk` so a second worktree can legitimately check `trunk` out.
  git(root, 'checkout', '-q', '-b', 'scratch');
  const trunkWt = path.join(root, '.claude', 'worktrees', 'trunk-copy');
  git(root, 'worktree', 'add', '-q', trunkWt, 'trunk');
  writeRunState(runDir, { status: 'active', worktree: trunkWt, sessionId: 'me' });

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /branch: skipped — refusing to delete the integration branch \(trunk\)/);
  assert.match(result.lines.join('\n'), /remote ref: skipped — refusing to delete the integration branch \(trunk\)/);
  assert.strictEqual(calls.length, 0);
  assert.notStrictEqual(git(root, 'branch', '--list', 'trunk').trim(), '', 'the integration branch must survive');
});

test('AC7 (#1323): --run pointed at an already-archived path (4 levels below root, not the live 3-level pipelines/{run-id} shape) resolves root correctly and never doubles .claude-tweaks', () => {
  const { root } = fixtureRepo();
  // A run dir shaped like `{root}/.claude-tweaks/pipelines/archive/{run-id}` — one level deeper
  // than the live-run shape every other test in this file uses. The old fixed-depth
  // `path.resolve(runDir, '..', '..', '..')` only climbs 3 levels regardless of actual depth, so
  // given this 4-level path it landed on `{root}/.claude-tweaks` instead of `{root}` and then
  // re-joined `.claude-tweaks/pipelines/archive/{run-id}` onto that wrong root — producing
  // `{root}/.claude-tweaks/.claude-tweaks/pipelines/archive/{run-id}`.
  const archivedRunId = 'already-archived-run';
  const archivedRunDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', archivedRunId);
  fs.mkdirSync(path.join(archivedRunDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(archivedRunDir, 'work', 'x.md'), '# x\n');
  git(root, 'add', path.join('.claude-tweaks', 'pipelines', 'archive', archivedRunId, 'work', 'x.md'));
  git(root, 'commit', '-q', '-m', 'pre-existing archived content');
  writeRunState(archivedRunDir, { status: 'clean', worktree: null });

  const result = teardownRun(archivedRunDir, { mode: null, sessionId: 'me' });

  const doubledDir = path.join(root, '.claude-tweaks', '.claude-tweaks');
  assert.ok(!fs.existsSync(doubledDir), `must not create a doubled .claude-tweaks path: ${doubledDir}`);
  // With root correctly resolved, `archiveDir` computed from an already-archived `runDir` lands
  // on `runDir` itself (same basename, same parent) — a same-path collision that `git mv` refuses
  // ("can not move directory into itself"), so archival correctly no-ops rather than corrupting
  // anything; content stays exactly where it was, not lost and not duplicated.
  assert.match(result.lines.join('\n'), /archive: skipped —/);
  assert.ok(fs.existsSync(path.join(archivedRunDir, 'work', 'x.md')), 'original content must survive untouched');
});

test('AC8 (#2362): no worktree recorded, but a PR-early decisions.md line names the branch -> recovers and removes the live worktree via fallback', () => {
  const { root, runDir } = fixtureRepo();
  // Simulate the exact gap #2362 describes: EnterWorktree entered `wt` on
  // `feat-branch`, but run-state.json never got a `worktree` field written.
  writeRunState(runDir, { status: 'active', worktree: null, sessionId: 'me' });
  fs.writeFileSync(
    path.join(runDir, 'decisions.md'),
    '# log\n- AUTO 08:17:11 — Spec Step 1: PR-early run lifecycle: pushed feat-branch to origin. Reversibility: high.\n',
  );
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /worktree: removed .*\(resolved via branch-name fallback/);
  assert.match(result.lines.join('\n'), /branch: deleted feat-branch/);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /feat-branch/);
  assert.strictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '');
});

test('AC8b (#2362): no worktree recorded and no recoverable branch -> unchanged "no worktree recorded" message, nothing removed', () => {
  const { root, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: null, sessionId: 'me' });
  // decisions.md carries no PR-early lifecycle line and state.pr is absent —
  // fallbackBranch has nothing to recover.
  const result = teardownRun(runDir, { mode: 'merged', sessionId: 'me' });

  assert.match(result.lines.join('\n'), /worktree: skipped — no worktree recorded/);
  assert.match(git(root, 'worktree', 'list'), /feat-branch/, 'the unrelated live worktree must survive untouched');
});

test('AC9 (#2362): a recorded worktree that no longer exists must NOT trigger the branch-name fallback, even when decisions.md could recover a branch', () => {
  const { root, wt, runDir } = fixtureRepo();
  // run-state.json DOES have a recorded worktree — but it was removed after
  // recording (a reap, a manual `git worktree remove`, or a prior partial
  // teardown). This must behave exactly as it did before #2362's fix: the
  // fallback must never fire just because decisions.md happens to name a
  // branch — only a run-state.json with NO worktree field at all may use it.
  execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  fs.writeFileSync(
    path.join(runDir, 'decisions.md'),
    '# log\n- AUTO 08:17:11 — Spec Step 1: PR-early run lifecycle: pushed feat-branch to origin. Reversibility: high.\n',
  );
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  // Step 3 (worktree removal) is orthogonal to this fix: `worktreePath` is the
  // recorded (now-stale) path, so `effectiveWorktreePath` stays that value and
  // Step 3 correctly attempts (and fails) removal of it — "removal failed",
  // not "no worktree recorded" (that message only fires when nothing at all
  // was recorded). The discriminating assertions for this fix are the
  // branch/remote-ref lines below, which must fall back to "no branch
  // recorded" rather than recovering `feat-branch` from decisions.md.
  assert.match(result.lines.join('\n'), /worktree: skipped — removal failed/);
  assert.match(result.lines.join('\n'), /branch: skipped — no branch recorded/);
  assert.match(result.lines.join('\n'), /remote ref: skipped — no branch recorded/);
  assert.strictEqual(calls.length, 0, 'gh api delete must never be called — the branch must not be recovered for a recorded-but-gone worktree');
  assert.notStrictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '', 'the local branch must survive — it was never a target for deletion');
});
