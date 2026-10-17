# Post-Merge Cleanup False-Clean Fixes (#3023) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make three post-merge cleanup checks observe the state they report: teardown's prune fallback, verify's `worktree-removed` row, and the residue release probe's CHANGELOG read.

**Architecture:** Teardown and verify both add a filesystem `existsSync` on the worktree path; teardown also recovers a failed removal's exit status when stderr is empty, using two additive fields on `git-exec.js`'s failure object. The release probe reads `CHANGELOG.md` from the integration branch's remote-tracking ref when it exists and contains the newest tag, falls back to `HEAD` otherwise, and declines (`ran: false`) when the local branch is behind and the remote CHANGELOG is unreadable.

**Tech Stack:** Node 18+, `node --test`, real git fixture repos.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T162827-spec-3023/work/3023-spec.md`

**Scope keywords:** removed via prune, worktree-removed, HEAD:CHANGELOG.md

## Global Constraints

- Teardown must never break a session: a non-clean outcome is reported as a line, never thrown (`docs/hooks.md`).
- Keep teardown's non-masking intent: prune only on the `prunable` state (`teardown-run.js` comment above the prune block).
- On Windows a directory can survive removal because a process holds a handle in it — report it, never retry-delete in a loop.
- The release probe runs in consuming projects: no remote, or no remote-tracking ref, keeps today's `HEAD` behavior instead of skipping silently.
- Resolve the integration branch through the existing resolver (`resolveRemoteRef` in `probes/branches.js`, fed by `--integration-branch`), never a hard-coded `main`.
- `verify`'s on-disk check reads the worktree path from `run-state.json`'s `worktree` field (via `readRunStateWithParent`), not from the slug.

## Review Focus

1. A run whose `run-state.json` has no `worktree` field (local-merge / current-branch run): `worktree-removed` must keep today's list-only behavior, never fail for lack of a path.
2. A multi-spec `spec-{N}/` run dir whose worktree stamp lives on the parent: the on-disk check must find the parent's path (`readRunStateWithParent` fills it).
3. An archived run dir (verify runs after teardown archived it): `run-state.json` travels with the archive, so the path is still readable from the archived `runDir`.
4. The remote-tracking ref exists but does not contain the newest tag's commit (tag cut on a local-only release commit): the probe must fall back to `HEAD`, not report the remote's missing heading.
5. A plain `git worktree remove` failure that is NOT `prunable` (e.g. dirty tree): output must stay `worktree: skipped — removal failed …` — the new directory check applies only after a successful prune.

Items 1–2 are pinned in Task 2, item 4 in Task 3; items 3 and 5 are covered by existing behavior and existing tests (`AC9`-style removal-failed cases in `tests/hooks-teardown-run.test.js`).

---

### Task 1: teardown-run — report a directory that survives the prune fallback

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (`buildFailure`, ~line 99-105)
- Modify: `plugin/bin/lib/hooks/teardown-run.js` (prune fallback, ~lines 248-267; `module.exports`, line 306)
- Test: `tests/hooks-teardown-run.test.js` (AC10 at ~line 255; new cases after it)

**Interfaces:**
- Produces: `runGit` failure objects gain two additive fields — `exitCode: number|null` (`err.status` when numeric) and `failureStdout: string` (trimmed `err.stdout`, `''` when none). Existing fields unchanged.
- Produces: `describeGitFailure(r) -> string` exported from `teardown-run.js` — returns `r.stderr` when non-empty; otherwise `exit {exitCode}` plus `; stdout: {failureStdout}` when stdout is non-empty; `'no error text'` when neither is known.

- [ ] **Step 1: Write the failing tests**

Replace AC10's body assertion block and add two tests in `tests/hooks-teardown-run.test.js`:

```js
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
});

test('#3023: a prunable worktree whose directory is already gone is reported removed via prune', () => {
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' });
  fs.rmSync(wt, { recursive: true, force: true });

  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  const out = result.lines.join('\n');
  assert.match(out, /worktree: removed via prune/);
  assert.doesNotMatch(out, /directory still present/);
  assert.doesNotMatch(git(root, 'worktree', 'list'), /feat-branch/);
});

test('#3023: describeGitFailure keeps stderr, else falls back to exit status and stdout, else "no error text"', () => {
  const { describeGitFailure } = require('../plugin/bin/lib/hooks/teardown-run');
  assert.strictEqual(describeGitFailure({ stderr: 'fatal: boom', exitCode: 128, failureStdout: '' }), 'fatal: boom');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: 1, failureStdout: '' }), 'exit 1');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: 1, failureStdout: 'partial' }), 'exit 1; stdout: partial');
  assert.strictEqual(describeGitFailure({ stderr: '', exitCode: null, failureStdout: '' }), 'no error text');
  assert.strictEqual(describeGitFailure({ stderr: null }), 'no error text');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: FAIL — AC10 fails (output reads `worktree: removed via prune …`), and the `describeGitFailure` test fails with `describeGitFailure is not a function`.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/hooks/git-exec.js` `buildFailure`, add the two additive fields:

```js
function buildFailure(err) {
  // ... existing comment ...
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
  // #3023: additive, like #1341's stderr — a removal that fails with no stderr
  // text still has an exit status (and sometimes stdout) a caller can report.
  const exitCode = typeof err.status === 'number' ? err.status : null;
  const failureStdout = typeof err.stdout === 'string' ? err.stdout.trim() : '';
  return { stdout: null, failure: classify(err), stderr, exitCode, failureStdout };
}
```

In `plugin/bin/lib/hooks/teardown-run.js`, add above `teardownRun`:

```js
// #3023: a failed git call's best available cause — stderr when git wrote any,
// else its exit status (plus stdout when present), so "no error text" only
// appears when nothing at all is known.
function describeGitFailure(r) {
  if (r && r.stderr) return r.stderr;
  if (r && typeof r.exitCode === 'number') {
    return `exit ${r.exitCode}${r.failureStdout ? `; stdout: ${r.failureStdout}` : ''}`;
  }
  return 'no error text';
}
```

Replace the prune-success branch and the two sibling failure messages:

```js
      if (entryAfter && entryAfter.prunable) {
        const prune = runGit(['worktree', 'prune'], root);
        if (!prune.failure) {
          // #3023: prune clears only the registration. Report what is actually on disk —
          // never retry-delete here (a Windows handle can hold the directory; looping on it
          // would hang teardown).
          if (fs.existsSync(effectiveWorktreePath)) {
            lines.push(`worktree: registration pruned but directory still present at ${effectiveWorktreePath} (removal had failed: ${describeGitFailure(rm)})`);
          } else {
            lines.push(`worktree: removed via prune ${effectiveWorktreePath} (removal had failed: ${describeGitFailure(rm)})`);
          }
        } else {
          lines.push(`worktree: skipped — removal failed (${describeGitFailure(rm)}); prune also failed (${describeGitFailure(prune)})`);
        }
      } else {
        lines.push(`worktree: skipped — removal failed${rm.stderr ? ` (${rm.stderr})` : ''}`);
      }
```

(Leave the non-prunable `removal failed` line as-is: Review Focus 5 — its output is pinned by existing tests.) Confirm `fs` is already required at the top of `teardown-run.js`; add `const fs = require('fs');` only if absent. Export: `module.exports = { teardownRun, branchOfWorktree, repoSpecOf, defaultGhApiDelete, describeGitFailure };`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-teardown-run.test.js tests/bin-lib/git-retry.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-exec.js plugin/bin/lib/hooks/teardown-run.js tests/hooks-teardown-run.test.js
git commit -m "Report a worktree directory that survives teardown's prune — #3023"
```

---

### Task 2: verify `worktree-removed` — fail when the worktree directory is still on disk

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (`worktree-removed` check, ~lines 328-346; imports at top)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (after the two existing `worktree-removed` tests, ~line 479)

**Interfaces:**
- Consumes: `readRunStateWithParent(runDir) -> { state, parentRunDir, filled }` from `plugin/bin/lib/hooks/context.js` (already exported; `engine-verify.js` already imports it for `resolvePrNumber` — reuse that import).

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/wrap-up/engine-verify.test.js`, after the two existing `worktree-removed` tests:

```js
test('#3023: worktree-removed fails when the run\'s worktree is unlisted but its directory still exists on disk', () => {
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-901');
  const wtDir = makeTmpDir('verify-wt-dir-');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: wtDir }));
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'fail');
  assert.ok(row.detail.includes(wtDir), `detail must name the path, got: ${row.detail}`);
});

test('#3023: worktree-removed passes when the worktree is unlisted and its directory is gone', () => {
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-902');
  const wtDir = path.join(makeTmpDir('verify-wt-gone-'), 'never-created');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: wtDir }));
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'pass');
});

test('#3023: worktree-removed keeps list-only behavior when run-state.json records no worktree', () => {
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-903');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'closed' }));
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'pass');
});

test('#3023: worktree-removed reads a multi-spec run\'s worktree path from the parent run-state.json', () => {
  const parent = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-904-905');
  const specDir = path.join(parent, 'spec-904');
  const wtDir = makeTmpDir('verify-wt-dir-');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: wtDir }));
  fs.writeFileSync(path.join(specDir, 'run-state.json'), JSON.stringify({ status: 'closed' }));
  const result = runVerify({ runDir: specDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'fail');
  assert.ok(row.detail.includes(wtDir));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL — the "directory still exists" and multi-spec tests read `pass` (the check consults only `git worktree list`).

- [ ] **Step 3: Implement**

In the `worktree-removed` check, after the existing list match returns no listed worktree:

```js
  const match = list.find((wt) => wt.path.includes(slug) || (wt.branch && wt.branch.includes(slug)));
  if (match) return { result: 'fail', detail: `worktree still listed: ${match.path}` };
  // #3023: `git worktree prune` drops the registration but can leave the
  // directory behind, so an unlisted worktree is not proof of removal. The
  // exact path comes from run-state.json's `worktree` stamp (a multi-spec
  // spec-{N}/ dir inherits the parent's), never guessed from the slug.
  const { state } = readRunStateWithParent(runDir);
  const recorded = state && typeof state.worktree === 'string' && state.worktree ? state.worktree : null;
  if (recorded && fs.existsSync(recorded)) {
    return { result: 'fail', detail: `worktree unlisted but directory still present: ${recorded}` };
  }
  return { result: 'pass', detail: '' };
```

Confirm `readRunStateWithParent` and `fs` are already imported in `engine-verify.js` (both are used elsewhere in the file); add nothing if so.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS (all, including the two pre-existing `worktree-removed` tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Fail verify worktree-removed when the directory is still on disk — #3023"
```

---

### Task 3: release probe — read CHANGELOG from the remote integration ref

**Files:**
- Modify: `plugin/bin/lib/residue/probes/release.js` (`probeRelease`, ~lines 58-110; new helper above it)
- Modify: `plugin/bin/residue.js` (`probeRelease({ scope, run })` call, ~line 140)
- Create: `tests/bin-lib/residue/probes-release-remote.test.js`

**Interfaces:**
- Consumes: `resolveRemoteRef(integrationBranch, gitRun) -> string` from `plugin/bin/lib/residue/probes/branches.js` (already exported). `gitRun` takes bare git args (`['config', ...]`); `probeRelease`'s own `run` takes full argv (`['git', ...]`) — adapt with `(args) => run(['git', ...args])`.
- Produces: `probeRelease({ scope, run, integrationBranch })` — `integrationBranch` optional; absent/empty → today's `HEAD` behavior. Finding evidence names the ref read (`CHANGELOG.md at {ref}`).

- [ ] **Step 1: Write the failing tests**

Create `tests/bin-lib/residue/probes-release-remote.test.js`:

```js
// #3023: the release probe must read CHANGELOG.md from the integration
// branch's remote-tracking ref, not a stale local HEAD — real git fixtures.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeRelease } = require('../../../plugin/bin/lib/residue/probes/release');

const SCOPE = { ran: true, reason: null, base: 'a1b2c3d', headBranch: 'main', branches: [], worktrees: [] };

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Same shape as residue.js's runner(): full argv, trimmed stdout, null on any failure.
function runner(cwd) {
  return (argv) => {
    try {
      return execFileSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
}

// c1: bootstrap manifest 1.0.0 + CHANGELOG with 1.0.0, tagged v1.0.0.
// c2: tagged v1.1.0; `remoteChangelog` decides what c2's CHANGELOG holds
// (null deletes the file). Local `main` is reset back to c1, so HEAD is behind
// c2. `withRemoteRef` points refs/remotes/origin/main at c2.
function fixture({ remoteChangelog, withRemoteRef = true }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rel-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), '{".": "1.0.0"}\n');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## v1.0.0 — first\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'c1');
  git(root, 'tag', 'v1.0.0');
  const c1 = git(root, 'rev-parse', 'HEAD');
  if (remoteChangelog === null) {
    git(root, 'rm', '-q', 'CHANGELOG.md');
  } else {
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), remoteChangelog);
    git(root, 'add', 'CHANGELOG.md');
  }
  git(root, 'commit', '-q', '--allow-empty', '-m', 'c2');
  git(root, 'tag', 'v1.1.0');
  const c2 = git(root, 'rev-parse', 'HEAD');
  if (withRemoteRef) git(root, 'update-ref', 'refs/remotes/origin/main', c2);
  git(root, 'reset', '-q', '--hard', c1);
  return root;
}

const WITH_HEADING = '# Changelog\n\n## [1.1.0](https://example.com/compare/v1.0.0...v1.1.0) (2026-10-01)\n\n## v1.0.0 — first\n';

test('#3023: a tag whose CHANGELOG heading exists only on the remote-tracking ref is not reported', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, []);
});

test('#3023: the remote-tracking ref is also used for a qualified integration branch (origin/main)', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'origin/main' });
  assert.deepStrictEqual(r.findings, []);
});

test('#3023: a heading genuinely missing on the remote-tracking ref is still reported', () => {
  const root = fixture({ remoteChangelog: '# Changelog\n\n## v1.0.0 — first\n' });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.ok(r.findings.some((f) => f.evidence.includes('v1.1.0') && f.evidence.includes('origin/main')), JSON.stringify(r.findings));
});

test('#3023: with no remote-tracking ref the probe keeps today\'s HEAD behavior', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING, withRemoteRef: false });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.ok(r.findings.some((f) => f.evidence.includes('v1.1.0') && f.evidence.includes('HEAD')), JSON.stringify(r.findings));
});

test('#3023: with no integrationBranch argument the probe keeps today\'s HEAD behavior', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  const r = probeRelease({ scope: SCOPE, run: runner(root) });
  assert.ok(r.findings.some((f) => f.evidence.includes('v1.1.0') && f.evidence.includes('HEAD')));
});

test('#3023: a remote ref that does not contain the newest tag falls back to HEAD', () => {
  const root = fixture({ remoteChangelog: WITH_HEADING });
  // Point origin/main back at c1 (contains v1.0.0 only) and tag a local-only
  // release commit whose CHANGELOG carries the 1.2.0 heading.
  const c1 = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', c1);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.0](https://example.com/c) (2026-10-02)\n\n## [1.1.0](https://example.com/c) (2026-10-01)\n\n## v1.0.0 — first\n');
  git(root, 'commit', '-q', '-am', 'local release');
  git(root, 'tag', 'v1.2.0');
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, [], 'HEAD carries every heading; the stale remote ref must not be read');
});

test('#3023: behind the remote with an unreadable remote CHANGELOG declines with a stated reason', () => {
  const root = fixture({ remoteChangelog: null });
  const r = probeRelease({ scope: SCOPE, run: runner(root), integrationBranch: 'main' });
  assert.strictEqual(r.ran, false);
  assert.strictEqual(r.reason, 'local integration branch is behind its remote — CHANGELOG check skipped');
  assert.deepStrictEqual(r.findings, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/residue/probes-release-remote.test.js`
Expected: FAIL — the "only on the remote-tracking ref" test gets a `v1.1.0` finding (probe reads `HEAD`), and the "behind … unreadable" test gets `ran: true`.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/residue/probes/release.js`, add `const { resolveRemoteRef } = require('./branches');` below the `makeFinding` require, and this helper above `probeRelease`:

```js
const BEHIND_REASON = 'local integration branch is behind its remote — CHANGELOG check skipped';

// #3023: which ref's CHANGELOG.md to read. A main checkout whose local
// integration branch lags its remote holds tags fetched from the remote whose
// headings exist only on the remote ref — reading HEAD there reports entries
// that already exist upstream. Use the remote-tracking ref when it exists and
// contains the newest checked tag; otherwise (no integration branch given, no
// remote, no remote-tracking ref, or a tag cut on a local-only commit) keep
// reading HEAD, today's behavior.
function changelogRef({ integrationBranch, run, newestTag }) {
  if (!integrationBranch) return { ref: 'HEAD', remote: false };
  const remoteRef = resolveRemoteRef(integrationBranch, (args) => run(['git', ...args]));
  const sha = run(['git', 'rev-parse', '--verify', '--quiet', '--end-of-options', `${remoteRef}^{commit}`]);
  if (!sha) return { ref: 'HEAD', remote: false };
  if (newestTag && run(['git', 'merge-base', '--is-ancestor', `v${newestTag}`, remoteRef]) === null) {
    return { ref: 'HEAD', remote: false };
  }
  return { ref: remoteRef, remote: true };
}

function newestVersion(versions) {
  return versions.reduce((best, v) => (best === null || !versionGte(best, v) ? v : best), null);
}
```

Rewrite the read section of `probeRelease` (signature becomes `function probeRelease({ scope, run, integrationBranch } = {})`): read the tag list first, then choose the ref, then read the CHANGELOG:

```js
  const tagList = run(['git', 'tag', '-l', 'v*']);
  if (tagList === null) {
    return { ran: false, reason: 'could not read CHANGELOG.md or the v* tag list at HEAD', findings: [] };
  }
  const tags = tagList.split('\n').map((t) => t.trim()).filter(Boolean)
    .map((t) => t.replace(/^v/, ''))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && versionGte(v, anchor));

  const source = changelogRef({ integrationBranch, run, newestTag: newestVersion(tags) });
  let changelogAt = source.ref;
  let changelog = run(['git', 'show', `${changelogAt}:CHANGELOG.md`]);
  if (changelog === null && source.remote) {
    const behind = run(['git', 'rev-list', '--count', `HEAD..${source.ref}`]);
    if (behind !== null && Number(behind) > 0) return { ran: false, reason: BEHIND_REASON, findings: [] };
    changelogAt = 'HEAD';
    changelog = run(['git', 'show', 'HEAD:CHANGELOG.md']);
  }
  if (changelog === null) {
    return { ran: false, reason: `could not read CHANGELOG.md or the v* tag list at ${changelogAt}`, findings: [] };
  }
```

Remove the old `const changelog = …`/`const tagList = …`/`const tags = …` lines this replaces. In both finding evidence strings, replace the literal `CHANGELOG.md at HEAD` with ``CHANGELOG.md at ${changelogAt}`` (the second finding's evidence says `CHANGELOG.md has a version heading` — change it to ``CHANGELOG.md at ${changelogAt} has a version heading``).

In `plugin/bin/residue.js`, pass the integration branch through:

```js
    probeRelease({ scope, run, integrationBranch: opts.integrationBranch }),
```

and extend the NOTE comment above `filterResultsByScope` by one line: `probeRelease adapts its own bare-args call to resolveRemoteRef internally (#3023).`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/residue/*.test.js`
Expected: PASS (new file and every existing residue suite, including `probes-observed.test.js`'s mock-runner release tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/residue/probes/release.js plugin/bin/residue.js tests/bin-lib/residue/probes-release-remote.test.js
git commit -m "Read release-probe CHANGELOG from the remote integration ref — #3023"
```

---

### Task 4: Full-suite verification

- [ ] **Step 1: Run the full suite**

Run: `npm test > /tmp/ct-3023-npm-test.log 2>&1; echo "exit=$?"`, then `tail -30` the log.
Expected: `exit=0`. Any failure: rerun only the affected file in isolation before concluding anything (CLAUDE.md's load-variance note).
