# EnterWorktree Bookkeeping Backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap where `teardown-run` reports "no worktree recorded" and leaves a worktree/branch/remote-ref stranded when `run-state.json` never got a `worktree` field written into it, and let a standalone (no-worktree) wrap-up run create/resolve/delete its own ledger without a worktree write.

**Architecture:** Deliverable 1 is a pure backstop, not a new stamping path — `EnterWorktree` is a harness-native tool this plugin cannot modify, and the two proactive stamping paths that already exist (`build/worktree-setup.md` Step 4.5's unconditional restamp, and `post-tool-use.js`'s `stampAdHocRunDir`) are left exactly as they are. This plan adds a read-only recovery step inside `teardownRun` itself: when `run-state.json` carries no `worktree` field, recover the branch name from the same durable artifacts `run-integrity.js`'s `fallbackBranch` already uses for shipped-unclosed detection (`state.pr.branch`, or the PR-early-lifecycle log lines in `decisions.md`), then look up a live worktree for that branch via `git worktree list --porcelain` — never inventing a match, never touching the main checkout. Deliverable 2 adds a second, run-dir-scoped ledger location for the one case that has no worktree to write into at all, alongside the existing `docs/plans/` location, and updates every reader of the ledger-format contract to pick the right one.

**Tech Stack:** Node.js (`plugin/bin/lib/hooks/*.js`), `node --test`, Markdown skill contracts (`plugin/skills/_shared/*.md`, `plugin/skills/ledger/SKILL.md`, `plugin/skills/wrap-up/residue-sweep.md`).

**Spec:** GitHub issue #2362 (materialized at `.claude-tweaks/pipelines/2026-09-14T061110-record-2362/work/2362-spec.md`).

## Global Constraints

- Reuse existing, already-tested primitives — do not duplicate `parseWorktreeList`/`fallbackBranch`/`realpathOrSelf` logic (CLAUDE.md's Working Approach: "Read before you write").
- `teardownRun` must never throw past its own boundary and must never set a non-zero exit — every step stays try/skip/report (its own header comment, unchanged invariant).
- Never remove, rename, or force anything — the fallback only *finds* a worktree that already exists; it never guesses when no branch or no matching worktree can be recovered.
- The ledger's existing `docs/plans/YYYY-MM-DD-{feature}-ledger.md` location and its `docs/plans/*-ledger.md` glob-based lookups (Find/Update/Query/Resolve) are unchanged for every run that has a worktree — this plan adds an alternate location for the no-worktree case only, it does not migrate the default.

---

### Task 1: Add a branch → worktree-path lookup to `run-integrity.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/run-integrity.js` (add `worktreePathForBranch`, export it)
- Test: `tests/run-integrity.test.js` (add unit tests)

**Interfaces:**
- Consumes: `parseWorktreeList` (already imported in this file from `./worktree-reap`), `realpathOrSelf` (already defined in this file), `runGit` (already imported).
- Produces: `worktreePathForBranch(root, branch, cache)` — `(rootDir: string, branch: string|null, cache?: {worktreeList: Map}) => string|null`. Returns the live linked worktree path whose checked-out branch equals `branch`, or `null` when `branch` is falsy, the `git worktree list` call fails, no entry matches, the only match is the main checkout, or the matched entry is dangling (its `.git` file no longer resolves — the same liveness check `deriveBranch` already applies). Never returns the main checkout's own path. Task 2 imports and calls this.

- [ ] **Step 1: Write the failing tests**

Add to `tests/run-integrity.test.js` (near the existing `deriveBranch`-adjacent tests, after the `#1672` block):

```js
const { checkRunIntegrity, repoRootOf, worktreePathForBranch } = require('../plugin/bin/lib/hooks/run-integrity');
```

(Update the existing `require` line at the top of the file to add `worktreePathForBranch` to the destructure — do not add a second `require` line.)

```js
test('worktreePathForBranch: finds the live linked worktree checked out on the given branch', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wpfb-')));
  execFileSync('git', ['init', '-q', '-b', 'trunk'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });
  const wt = path.join(root, '.claude', 'worktrees', 'feat');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat-branch', wt], { cwd: root });

  assert.strictEqual(worktreePathForBranch(root, 'feat-branch'), wt);
});

test('worktreePathForBranch: never returns the main checkout even when its branch is asked for', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wpfb-')));
  execFileSync('git', ['init', '-q', '-b', 'trunk'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });

  assert.strictEqual(worktreePathForBranch(root, 'trunk'), null);
});

test('worktreePathForBranch: no matching branch -> null', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wpfb-')));
  execFileSync('git', ['init', '-q', '-b', 'trunk'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: root });

  assert.strictEqual(worktreePathForBranch(root, 'no-such-branch'), null);
});

test('worktreePathForBranch: null/empty branch -> null without spawning git', () => {
  assert.strictEqual(worktreePathForBranch('/nonexistent-root-never-touched', null), null);
  assert.strictEqual(worktreePathForBranch('/nonexistent-root-never-touched', ''), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/run-integrity.test.js`
Expected: FAIL — `worktreePathForBranch is not a function` (or `undefined` destructure), since it doesn't exist yet.

- [ ] **Step 3: Implement `worktreePathForBranch`**

In `plugin/bin/lib/hooks/run-integrity.js`, add the function immediately after `deriveBranch` (which it mirrors — path→branch there, branch→path here):

```js
// The reverse of deriveBranch() above (branch -> live worktree path, instead
// of path -> branch). Used by teardown-run.js as a fallback lookup (#2362)
// when run-state.json carries no `worktree` field at all — never the main
// checkout, never a dangling (prunable) entry, matching deriveBranch's own
// liveness rule exactly.
function worktreePathForBranch(root, branch, cache) {
  if (!branch) return null;
  let stdout;
  if (cache && cache.worktreeList.has(root)) {
    stdout = cache.worktreeList.get(root);
  } else {
    const list = runGit(['worktree', 'list', '--porcelain'], root);
    stdout = list.failure || list.stdout === null ? null : list.stdout;
    if (cache) cache.worktreeList.set(root, stdout);
  }
  if (stdout === null) return null;
  const realRoot = realpathOrSelf(root);
  for (const entry of parseWorktreeList(stdout)) {
    if (entry.bare) continue;
    if (entry.branch !== branch) continue;
    const entryReal = realpathOrSelf(entry.path);
    if (entryReal === realRoot) continue; // never the main checkout
    if (!fs.existsSync(path.join(entry.path, '.git'))) return null; // dangling — prunable, not live
    return entry.path;
  }
  return null;
}
```

Add `worktreePathForBranch` to the `module.exports` object at the bottom of the file (alongside `fallbackBranch`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/run-integrity.test.js`
Expected: PASS (all tests in the file, including the four new ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/run-integrity.js tests/run-integrity.test.js
git commit -m "Add worktreePathForBranch to run-integrity.js — branch-to-worktree lookup for teardown-run's fallback (refs #2362)"
```

---

### Task 2: Wire the fallback into `teardownRun`

**Files:**
- Modify: `plugin/bin/lib/hooks/teardown-run.js`
- Test: `tests/hooks-teardown-run.test.js`

**Interfaces:**
- Consumes: `worktreePathForBranch(root, branch, cache)` and `fallbackBranch(root, runDir, state)` from Task 1 / `./run-integrity` (both already exported; `fallbackBranch` already exists and is unmodified by this task).
- Produces: no new exports — `teardownRun`'s existing `{ lines }` return shape is unchanged; only its `worktree:`/`branch:`/`remote ref:` line content changes for the no-worktree-recorded case.

- [ ] **Step 1: Write the failing test**

Add to `tests/hooks-teardown-run.test.js`, after AC7:

```js
test('AC8 (#2362): no worktree recorded, but a PR-early decisions.md line names the branch -> recovers and removes the live worktree via fallback', () => {
  const { root, wt, runDir } = fixtureRepo();
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
  const { root, wt, runDir } = fixtureRepo();
  writeRunState(runDir, { status: 'active', worktree: null, sessionId: 'me' });
  // decisions.md carries no PR-early lifecycle line and state.pr is absent —
  // fallbackBranch has nothing to recover.
  const result = teardownRun(runDir, { mode: 'merged', sessionId: 'me' });

  assert.match(result.lines.join('\n'), /worktree: skipped — no worktree recorded/);
  assert.match(git(root, 'worktree', 'list'), /feat-branch/, 'the unrelated live worktree must survive untouched');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: AC8 FAILs (`worktree: skipped — no worktree recorded`, not `removed`); AC8b already passes today (documents current behavior, kept as a regression guard for the next step).

- [ ] **Step 3: Implement the fallback in `teardownRun`**

In `plugin/bin/lib/hooks/teardown-run.js`:

1. Add `worktreePathForBranch` to the existing `run-integrity`-adjacent... — this file does not currently import `run-integrity.js` at all; add a new require line near the top (after the `worktree-reap` import):

```js
const { fallbackBranch, worktreePathForBranch } = require('./run-integrity');
```

2. Replace the branch-derivation line and the Step 3/4/5 block. Current code (for reference, do not leave both versions in the file):

```js
  const branch = (root ? branchOfWorktree(root, worktreePath) : null) || (prevState && prevState.branch) || null;
```

becomes:

```js
  // `worktreePath` is null exactly when #2362's gap fires — run-state.json never
  // got a `worktree` field written (EnterWorktree entered the worktree, but the
  // formal record-worktree stamp never landed). Recover the branch the same way
  // run-integrity.js's shipped-unclosed check already does for a torn-down
  // worktree: state.pr.branch first, then the PR-early-lifecycle log lines in
  // decisions.md. `prevState.branch` is kept as a defensive first check even
  // though nothing in this codebase writes that top-level field today — it
  // costs nothing and protects a future writer that might.
  const branch = (root ? branchOfWorktree(root, worktreePath) : null)
    || (prevState && prevState.branch)
    || (root ? fallbackBranch(root, runDir, prevState) : null)
    || null;
  // Fallback worktree-path recovery (#2362): only attempted when nothing was
  // recorded at all. Never overrides a recorded (even if now-stale) worktree
  // path — a caller that explicitly recorded one gets exactly that one's own
  // skip/lock/removal handling, unchanged.
  const recoveredWorktreePath = (!worktreePath && root && branch) ? worktreePathForBranch(root, branch) : null;
  const effectiveWorktreePath = worktreePath || recoveredWorktreePath;
```

3. Replace the Step 3 (worktree removal) block:

```js
  // Step 3 (worktree removal) — never forced; a locked worktree means either a live session
  // (including this session's own ground, per [IL-58] — that removal path is ExitWorktree only)
  // or an unresolvable state, and worktree-reap.js's predicates fail CLOSED either way.
  if (!worktreePath) {
    lines.push('worktree: skipped — no worktree recorded');
  } else if (isWorktreeLocked(worktreePath, { cwd: root })) {
    lines.push('worktree: skipped — worktree locked');
  } else {
    const rm = runGit(['worktree', 'remove', worktreePath], root);
    if (rm.failure) lines.push('worktree: skipped — removal failed');
    else lines.push(`worktree: removed ${worktreePath}`);
  }
```

with:

```js
  // Step 3 (worktree removal) — never forced; a locked worktree means either a live session
  // (including this session's own ground, per [IL-58] — that removal path is ExitWorktree only)
  // or an unresolvable state, and worktree-reap.js's predicates fail CLOSED either way.
  if (!effectiveWorktreePath) {
    lines.push('worktree: skipped — no worktree recorded');
  } else if (isWorktreeLocked(effectiveWorktreePath, { cwd: root })) {
    lines.push('worktree: skipped — worktree locked');
  } else {
    const rm = runGit(['worktree', 'remove', effectiveWorktreePath], root);
    if (rm.failure) lines.push('worktree: skipped — removal failed');
    else {
      lines.push(`worktree: removed ${effectiveWorktreePath}${recoveredWorktreePath ? ' (resolved via branch-name fallback — no worktree recorded in run-state.json)' : ''}`);
    }
  }
```

(Steps 4 and 5 already key on `branch`, which now already carries the recovered value — no further change needed there.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: PASS (all 9 tests in the file, including AC8/AC8b).

- [ ] **Step 5: Run the full suite once for this pair of files**

Run: `node --test tests/run-integrity.test.js tests/hooks-teardown-run.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/teardown-run.js tests/hooks-teardown-run.test.js
git commit -m "Recover a missing worktree/branch association in teardown-run via branch-name fallback (refs #2362)"
```

---

### Task 3: Standalone ledger location for a no-worktree wrap-up run

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md`
- Modify: `plugin/skills/ledger/SKILL.md`
- Modify: `plugin/skills/wrap-up/residue-sweep.md`

**Interfaces:**
- Consumes: nothing code-level — this task is a shared-contract prose change, cited by `/build`, `/test`, `/review`, `/wrap-up`, `/flow`, and `/ledger` per `_shared/ledger-format.md`'s own header.
- Produces: a second documented ledger location, `{run-dir}/ledger.md`, used only when the run has no worktree (`run-state.json` carries no `worktree` field, or there is no `run-state.json` at all — a standalone run). Every consumer of "the ledger file" now resolves one of two locations by that one condition, stated once in `_shared/ledger-format.md` and cited (not restated) everywhere else.

- [ ] **Step 1: Update `_shared/ledger-format.md`'s Location section**

Read the current section first (`plugin/skills/_shared/ledger-format.md`, the `### Location` subsection near the top, currently a single fenced block: `docs/plans/YYYY-MM-DD-{feature}-ledger.md`). Replace it with:

```markdown
### Location

```
docs/plans/YYYY-MM-DD-{feature}-ledger.md
```

The `{feature}` name matches the execution plan or spec topic. One ledger per pipeline run.

**Standalone (no-worktree) exception.** A run with no worktree at all — `run-state.json` carries no `worktree` field, or no `run-state.json` exists yet — has nowhere to commit a `docs/plans/` write: under `worktree-always: true` the mechanical PreToolUse gate denies any tracked-path write from the main checkout, worktree or not. This is exactly the shape `wrap-up/residue-sweep.md`'s preamble runs in (a single-spec or final-spec wrap-up finding nothing left to build, so no build/test/review step ever created a worktree for this run). For that case only, create the ledger at:

```
{run-dir}/ledger.md
```

— inside this run's own pipeline directory (`.claude-tweaks/pipelines/{run-id}/`), which is already gitignored and commit-exempt (CLAUDE.md's `_shared/pipeline-run-dir.md` Anchoring section) and already this run's own audit-trail home. Never committed, never a `docs/plans/*-ledger.md` glob match — a caller resolving "the active ledger for this run" checks whether the run has a worktree first (the same `run-state.json.worktree` presence check above) and reads the matching location; a caller with no run dir at all (no `$PIPELINE_RUN_DIR` resolves) always uses `docs/plans/`, since there is no run-dir-scoped alternative available.
```

- [ ] **Step 2: Update `ledger/SKILL.md`'s Create/Find/Update/Query/Resolve operations**

Read `plugin/skills/ledger/SKILL.md`'s `### Create` section (currently `File: docs/plans/YYYY-MM-DD-{feature}-ledger.md`). Change it to:

```markdown
### Create

Create a new ledger file. Called by `/claude-tweaks:flow` Step 1 or `/claude-tweaks:build` on first item — or, for a run with no worktree at all, by `wrap-up/residue-sweep.md`'s preamble on its first finding.

File: `docs/plans/YYYY-MM-DD-{feature}-ledger.md` — or, when this run has no worktree (`run-state.json` carries no `worktree` field, or no `run-state.json` exists), `{run-dir}/ledger.md`. See `_shared/ledger-format.md`'s Location section for the full condition; this file cites it rather than restating it.
```

Then find every other operation in this file (`Find`, `Update`, `Query`, `Resolve` — the four occurrences of `docs/plans/*-ledger.md` glob lookups found at lines ~114/124/131 before this edit) and add one clause to each: after the `docs/plans/*-ledger.md` glob step, add "when this run has a worktree; otherwise read `{run-dir}/ledger.md` directly — there is nothing to glob for a run-dir-scoped file, since the caller already knows its own `$PIPELINE_RUN_DIR`." Do not duplicate the full condition text in all four places — phrase each as a one-clause pointer back to Create's own wording above, matching this file's existing citation style (it already says "see `_shared/ledger-format.md`" rather than restating the format).

- [ ] **Step 3: Update `wrap-up/residue-sweep.md`'s ledger-creation line**

Read `plugin/skills/wrap-up/residue-sweep.md`'s "Writing findings to the ledger" section (currently: "If no ledger file exists yet for this run (the standalone case this preamble exists for), create it now via the ledger's own Create operation before adding the first item."). No wording change is needed here — "the ledger's own Create operation" already now resolves to the run-dir-scoped location for exactly this standalone case, per Task 3 Step 2's edit. Add one clarifying sentence immediately after the existing one:

```markdown
Under `worktree-always: true` this "standalone case" always means no worktree exists for this run — Create resolves to `{run-dir}/ledger.md`, never `docs/plans/`, so this step never hits the write-outside-worktree gate.
```

- [ ] **Step 4: Verify no other file hardcodes the old single-location assumption**

Run:

```bash
grep -rn "docs/plans/.*ledger" plugin/skills/ --include='*.md' | grep -v 'plugin/skills/_shared/ledger-format.md\|plugin/skills/ledger/SKILL.md\|plugin/skills/wrap-up/residue-sweep.md'
```

Expected: no output (every other citer points at `_shared/ledger-format.md` by reference, per that file's own header, rather than restating the path). If any line appears, read that file's context and add the same one-clause pointer used in Task 3 Step 2 rather than restating the full condition.

- [ ] **Step 5: Run the full test suite once**

Run: `npm test`
Expected: PASS. (This task edits only Markdown prose in `plugin/skills/`; if a `tests/skill-prose-*` or `tests/plugin-structure*` conformance test asserts the literal old single-location line, update that test's fixture string to match the new prose in the same commit — do not weaken the test's assertion.)

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/wrap-up/residue-sweep.md
git commit -m "Let a no-worktree standalone wrap-up run create its ledger under the run dir instead of docs/plans/ (refs #2362)"
```

---

## Acceptance Criteria Trace

- "A worktree entered via `EnterWorktree` during a dispatch/wrap-up run is torn down by `teardown-run`/`archive-run` without a 'no worktree recorded' failure and without any manual `git worktree remove`/`git branch -D`/`gh api DELETE` fallback." → Task 1 + Task 2 (AC8).
- "A standalone wrap-up run with at least one ledger item can create, resolve, and delete its ledger without needing a worktree, a commit, or a PR." → Task 3 (`{run-dir}/ledger.md` is gitignored and commit-exempt by construction — nothing to commit or push to resolve/delete it).
