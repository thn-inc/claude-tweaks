// tests/hooks-teardown-run.test.js — #594: `bin/hooks.js teardown-run --run <dir>
// [--merged|--abandoned]`, one command composing the four steps a finished /flow run needed
// hand-assembled before this (close state, remove worktree, delete local branch, delete remote
// ref). It never archives the run dir since #3490 — `archive-run` does.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teardownRun, defaultGhApiDelete, findWorktreeEntry, branchOfWorktree } = require('../plugin/bin/lib/hooks/teardown-run');
const { parseWorktreeList } = require('../plugin/bin/lib/hooks/worktree-reap');
const { readText } = require('./helpers/read-skill');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// Main checkout on `trunk` (the integration branch, via policy.yml — never "main"), a fake
// `origin` remote (repoSpecOf only reads its URL from git config, no network hit), and one
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

test('AC1 (#3490): a merged run with an unlocked worktree closes state, removes the worktree, deletes branch and remote ref — and never archives the run dir', () => {
  const { root, wt, runDir, runId } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /state: closed/);
  assert.match(result.lines.join('\n'), /archive: skipped — teardown-run does not archive/);
  assert.match(result.lines.join('\n'), /worktree: removed/);
  assert.match(result.lines.join('\n'), /branch: deleted feat-branch/);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);

  assert.ok(fs.existsSync(path.join(runDir, 'decisions.md')), 'run dir must stay in place — archival is archive-run\'s job');
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), 'no archive/{run-id} copy may appear');
  assert.doesNotMatch(git(root, 'worktree', 'list'), /feat-branch/);
  assert.strictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '');
  assert.deepStrictEqual(calls, [['repos/acme/widgets/git/refs/heads/feat-branch']]);
});

test('AC2: a locked worktree skips step 3 (skipped — worktree locked), never throws, and does not block the remaining steps', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  // Lock with the CURRENT process's own pid so isPidAlive reads it as a live session.
  git(root, 'worktree', 'lock', wt, '--reason', `claude session test (pid ${process.pid} start now)`);

  const result = teardownRun(runDir, { mode: null, sessionId: 'me' });

  assert.match(result.lines.join('\n'), /worktree: skipped — worktree locked/);
  assert.match(result.lines.join('\n'), /state: closed/);
  assert.match(result.lines.join('\n'), /branch: skipped — no --merged\/--abandoned given/);
  assert.ok(fs.existsSync(path.join(runDir, 'decisions.md')), 'run dir must stay in place — teardown-run never archives');
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

test('AC7 (#1323): --run pointed at an already-archived path (4 levels below root, not the live 3-level pipelines/{run-id} shape) resolves the root correctly — the integration-branch guard still reads policy.yml from it', () => {
  const { root } = fixtureRepo();
  // A run dir shaped like `{root}/.claude-tweaks/pipelines/archive/{run-id}` — one level deeper
  // than the live-run shape every other test in this file uses. The old fixed-depth
  // `path.resolve(runDir, '..', '..', '..')` only climbs 3 levels regardless of actual depth, so
  // given this 4-level path it landed on `{root}/.claude-tweaks` instead of `{root}`. Since #3490
  // teardown-run no longer archives, so the wrong root no longer corrupts a path; what still
  // depends on it is every root-rooted read — here `resolveIntegrationBranch(root)` loading
  // `{root}/.claude-tweaks/policy.yml` (`integration-branch: trunk`). Under the wrong root that file
  // is not found, `trunk` stops being recognized as the integration branch, and the refusal below
  // turns into a real `git branch -D trunk` plus a remote-ref delete call.
  const archivedRunId = 'already-archived-run';
  const archivedRunDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', archivedRunId);
  fs.mkdirSync(path.join(archivedRunDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(archivedRunDir, 'work', 'x.md'), '# x\n');
  git(root, 'add', path.join('.claude-tweaks', 'pipelines', 'archive', archivedRunId, 'work', 'x.md'));
  git(root, 'commit', '-q', '-m', 'pre-existing archived content');
  // Move the main checkout off `trunk` so a second worktree can legitimately check `trunk` out.
  git(root, 'checkout', '-q', '-b', 'scratch');
  const trunkWt = path.join(root, '.claude', 'worktrees', 'trunk-copy');
  git(root, 'worktree', 'add', '-q', trunkWt, 'trunk');
  writeRunState(archivedRunDir, { status: 'active', worktree: trunkWt, sessionId: 'me' });

  const calls = [];
  const result = teardownRun(archivedRunDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  const out = result.lines.join('\n');
  assert.match(out, /branch: skipped — refusing to delete the integration branch \(trunk\)/);
  assert.match(out, /remote ref: skipped — refusing to delete the integration branch \(trunk\)/);
  assert.strictEqual(calls.length, 0, 'the remote-ref delete must never be issued for the integration branch');
  assert.notStrictEqual(git(root, 'branch', '--list', 'trunk').trim(), '', 'the integration branch must survive');
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', '.claude-tweaks')), 'must not create a doubled .claude-tweaks path');
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

test('AC10 (#2747, #3023): a prunable worktree whose directory survives the prune is reported as still present, not removed — the branch delete still proceeds', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  // Half-reaped: gitdir link gone, registration still present (`prunable`). `git worktree prune`
  // clears only the registration — the directory (with b.txt) stays on disk.
  fs.rmSync(path.join(wt, '.git'), { force: true });

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  const out = result.lines.join('\n');
  assert.ok(fs.existsSync(wt), 'fixture precondition: the directory really is still on disk');
  assert.match(out, new RegExp(`worktree: registration pruned but directory still present at ${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(out, /worktree: removed/);
  assert.match(out, /branch: deleted feat-branch/);
  assert.match(out, /remote ref: deleted refs\/heads\/feat-branch/);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /feat-branch/);
  assert.strictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '');
});

test('#3023: a worktree whose directory is already gone is reported removed directly, never as still present', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  fs.rmSync(wt, { recursive: true, force: true });

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  const out = result.lines.join('\n');
  assert.match(out, /worktree: removed /);
  assert.doesNotMatch(out, /directory still present/);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /feat-branch/);
});

test('#3023: describeGitFailure keeps stderr, else falls back to exit status and stdout, else "no error text"', () => {
  const { describeGitFailure } = require('../plugin/bin/lib/hooks/teardown-run');
  assert.strictEqual(describeGitFailure({ stderr: 'fatal: boom', exitCode: 128, failureStdout: '' }), 'fatal: boom');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: 1, failureStdout: '' }), 'exit 1');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: 1, failureStdout: 'partial' }), 'exit 1; stdout: partial');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: null, failureStdout: '', failure: 'timeout' }), 'timeout');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: null, failureStdout: '' }), 'no error text');
  assert.strictEqual(describeGitFailure({ stderr: null }), 'no error text');
});

test('AC13 (#2747): a failed branch delete reports the underlying git error text, not just "skipped"', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  // Force `git branch -D feat-branch` to fail for a reason independent of worktree removal (which
  // succeeds normally here) — a stale lock file on the branch's own ref, the same failure shape a
  // crashed concurrent git process leaves behind.
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'feat-branch.lock'), '');

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /worktree: removed/);
  // The real git stderr this provokes spans multiple lines ("cannot lock ref ..." followed by a
  // blank line and "Another git process seems to be running..."), so match across them with `s`
  // rather than asserting a single-line shape.
  assert.match(result.lines.join('\n'), /branch: skipped — delete failed for feat-branch \([\s\S]+\)/);
  assert.match(result.lines.join('\n'), /cannot lock ref 'refs\/heads\/feat-branch'/);
  assert.notStrictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '', 'the branch must survive a failed delete');
});

test('AC14 (#2747): defaultGhApiDelete threads --hostname onto the gh api call for a GitHub Enterprise Server host, and omits it for plain github.com', (t) => {
  const cp = require('child_process');
  let capturedArgs = null;
  t.mock.method(cp, 'execFileSync', (bin, args) => { capturedArgs = args; return ''; });

  defaultGhApiDelete(['repos/acme/widgets/git/refs/heads/x'], 'ghe.example.com');
  assert.deepStrictEqual(
    capturedArgs,
    ['api', '--method', 'DELETE', 'repos/acme/widgets/git/refs/heads/x', '--hostname', 'ghe.example.com'],
  );

  defaultGhApiDelete(['repos/acme/widgets/git/refs/heads/x'], 'github.com');
  assert.deepStrictEqual(capturedArgs, ['api', '--method', 'DELETE', 'repos/acme/widgets/git/refs/heads/x']);

  defaultGhApiDelete(['repos/acme/widgets/git/refs/heads/x']);
  assert.deepStrictEqual(capturedArgs, ['api', '--method', 'DELETE', 'repos/acme/widgets/git/refs/heads/x']);
});

test('AC15 (#2747): teardown-run resolves the GHE host from the origin remote and threads it through to ghApiDelete, so the remote-ref delete targets the right host', () => {
  const { root, wt, runDir } = fixtureRepo();
  git(root, 'remote', 'set-url', 'origin', 'git@ghe.example.com:acme/widgets.git');
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged',
    sessionId: 'me',
    deps: { ghApiDelete: (args, host) => { calls.push({ args, host }); return { ok: true }; } },
  });

  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);
  assert.deepStrictEqual(calls, [{ args: ['repos/acme/widgets/git/refs/heads/feat-branch'], host: 'ghe.example.com' }]);
});

test('AC16 (#3088): own-worktree teardown — no worktree recorded, local branch already deleted (ExitWorktree), but run-state.json pr.branch is set -> remote ref delete is still attempted', () => {
  const { root, wt, runDir } = fixtureRepo();
  // Simulate Section C's own-worktree path having already run: close-run cleared
  // run-state.json's worktree field to null (hence writeRunState below passes
  // worktree: null, not wt), and ExitWorktree(remove) already deleted both the
  // worktree directory and its local branch.
  execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
  execFileSync('git', ['branch', '-D', 'feat-branch'], { cwd: root });
  writeRunState(runDir, {
    status: 'active',
    worktree: null,
    sessionId: 'me',
    pr: { number: 42, url: 'https://github.com/acme/widgets/pull/42', branch: 'feat-branch' },
  });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /worktree: skipped — no worktree recorded/);
  assert.match(result.lines.join('\n'), /branch: skipped — delete failed for feat-branch/);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], ['repos/acme/widgets/git/refs/heads/feat-branch']);
});

test('AC17 (#3088, #3490): --remote-ref-only is still accepted (inert) and the remote-ref delete still runs, leaving the run directory in place', () => {
  const { root, wt, runDir } = fixtureRepo();
  execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
  execFileSync('git', ['branch', '-D', 'feat-branch'], { cwd: root });
  writeRunState(runDir, {
    status: 'active',
    worktree: null,
    sessionId: 'me',
    pr: { number: 42, url: 'https://github.com/acme/widgets/pull/42', branch: 'feat-branch' },
  });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', remoteRefOnly: true,
    deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /archive: skipped — teardown-run does not archive/);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);
  assert.strictEqual(calls.length, 1);
  assert.ok(fs.existsSync(path.join(runDir, 'decisions.md')), 'run directory must NOT be archived away under --remote-ref-only');
});

test('#3490: the CLI still accepts --remote-ref-only (never refused as an unknown flag) and never archives', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  // --abandoned keeps the gh seam unreached, so no network call is attempted.
  const out = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js'), 'teardown-run', '--run', runDir, '--abandoned', '--remote-ref-only',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'me' } });

  assert.match(out, /claude-tweaks: teardown-run 2026-08-01T090000-spec-9/);
  assert.match(out, /archive: skipped — teardown-run does not archive/);
  assert.doesNotMatch(out, /claude-tweaks: usage:/);
  assert.ok(fs.existsSync(path.join(runDir, 'decisions.md')));
});

// #3695: win32 `git worktree list --porcelain` prints forward-slash paths while the run's stamped
// worktree path is native backslash; the lookup must still match them, and posix stays exact.
const PORCELAIN = [
  'worktree D:/a/x',
  'HEAD 1111111',
  'branch refs/heads/trunk',
  '',
  'worktree D:/a/x/feat',
  'HEAD 2222222',
  'branch refs/heads/feat-branch',
  'prunable gitdir file points to non-existent location',
  '',
  '',
].join('\n');
const entries = parseWorktreeList(PORCELAIN);

test('#3695 AC1: win32 — a forward-slash porcelain path resolves the backslash-stamped worktree to its branch', () => {
  assert.strictEqual(findWorktreeEntry(entries, 'D:\\a\\x\\feat', path.win32).branch, 'feat-branch');
  assert.strictEqual(findWorktreeEntry(entries, 'd:\\a\\x\\feat\\', path.win32).branch, 'feat-branch');
});

test('#3695 AC2: win32 — the prunable-retry lookup finds the prunable entry', () => {
  assert.strictEqual(findWorktreeEntry(entries, 'D:\\a\\x\\feat', path.win32).prunable, true);
});

test('#3695: posix stays case-sensitive and a falsy target never matches', () => {
  assert.strictEqual(findWorktreeEntry([{ path: '/a/X', branch: 'b' }], '/a/x', path.posix), null);
  assert.strictEqual(findWorktreeEntry(entries, null, path.win32), null);
  assert.strictEqual(findWorktreeEntry(entries, '', path.win32), null);
  // '' resolves to the cwd, so only an entry sitting exactly there shows the guard is load-bearing.
  assert.strictEqual(findWorktreeEntry([{ path: path.win32.resolve(''), branch: 'b' }], '', path.win32), null);
});

// The two call sites go through findWorktreeEntry, not just the helper: on this host a stamped path
// that differs from git's porcelain only in form (trailing separator, dot segment) must still match.
test('#3695: the --merged branch lookup matches a stamped path that differs from porcelain only in form', () => {
  const { root, wt } = fixtureRepo();
  assert.strictEqual(branchOfWorktree(root, `${wt}${path.sep}`), 'feat-branch');
  assert.strictEqual(branchOfWorktree(root, `${wt}${path.sep}..${path.sep}feat`), 'feat-branch');
});

test('#3695: the prunable retry matches a stamped path that differs from porcelain only in form', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: `${wt}${path.sep}`, sessionId: 'me' });
  fs.rmSync(path.join(wt, '.git'), { force: true });

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  const out = result.lines.join('\n');
  assert.match(out, /worktree: registration pruned but directory still present at /);
  assert.match(out, /branch: deleted feat-branch/);
  assert.strictEqual(git(root, 'branch', '--list', 'feat-branch').trim(), '');
});

test('#3695 AC3: no strict worktree-path compare remains at either call site', () => {
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'teardown-run.js'));
  assert.doesNotMatch(src, /\.path\s*[!=]==?/);
  assert.ok((src.match(/findWorktreeEntry\(/g) || []).length >= 2);
});
