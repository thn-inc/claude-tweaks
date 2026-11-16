# Archive Stranded Spec-Shell Run Dirs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reconcile report live run dirs that hold only tracked `work/` headers next to a clean archive twin, ship `plugin/bin/archive-tracked-shells.js` that archives all of them through one housekeeping PR cut in a scratch worktree, and make `archiveRunDir` commit with an explicit pathspec in every case.

**Architecture:** `context.js` gains a shape predicate (`isTrackedShellDir`) and an opt-in `includeTrackedShells` iterator option; only reconcile's archive check passes it. The new CLI enumerates shells read-only in the main checkout, then runs the existing `archiveRunDir` per shell inside a scratch worktree on the deterministic branch `housekeeping/archive-tracked-shells`, pushes once and opens (or reuses) one PR. Reconcile prints that CLI as the `archived-pending-tracked-move` completion.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git and gh CLIs through injectable runners.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T063345-record-3975/work/3975-spec.md` (record #3975)

Scope keywords: archivedPendingTrackedMoveCommand, archived-pending-tracked-move

Referenced, unchanged: `plugin/bin/sweep-stray-run-dirs.js` (its mechanics are reused through `archiveRunDir`, which it already calls), `tests/archive-run-verb.test.js` (its no-`run-state.json` refusal pin must stay green), `plugin/skills/_shared/scratch-worktree.md` (scratch worktrees live under `.worktrees/`, never `.claude/worktrees/`). The spec's `tests/bin-lib/reconcile/archive-merged.test.js` is stale: the split-state tests live in `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`. Every other `iterRunDirsWithState` caller keeps the default call and is not edited.

## Global Constraints

- Default `iterRunDirsWithState` behavior is unchanged; only reconcile's archive check passes the new option (spec Deliverable 1, AC10).
- `archive-run`'s refusal of a dir with no `run-state.json` stays (`tests/archive-run-verb.test.js` pins it) — do not touch `hooks.js archive-run`.
- The CLI never commits on the main checkout and never runs `git stash`; it never force-pushes.
- Exit codes: 0 success (including nothing to do), 1 any shell left behind (twin differs or archival refused), 2 malformed call or unsupported environment.
- Branch name is exactly `housekeeping/archive-tracked-shells`.
- Every `git`/`gh` spawn goes through an injectable runner (`gh-api-module-pattern` skill, its `cli-wrapper-contract.md`), so tests inject fakes for `gh` and use real git repos with a bare `origin`.
- Windows: path assertions follow the `windows-checkout-test-parity` skill (build expected paths with `path.join`, compare `toPosix` only on display ids).
- Without `worktree-always`, reconcile completes at most one shell in place per pass; every other split-state dir that pass is skipped with the CLI command (maintainer decision, 2026-10-22).
- Any reading the spec leaves open: keep previous-release runs working, put the rule in code, stay in Key Files; state the choice in the PR body.

## Review Focus

1. A shell dir whose twin's `run-state.json` is `archiving` (fresh claim) — must still be skipped by the iterator even with `includeTrackedShells` (Task 1 test `AC10.x: fresh archiving claim still skipped`).
2. The scratch worktree path already exists from a crashed earlier run — the CLI removes and recreates it rather than failing (Task 4 test `AC3.4`).
3. A live work-only dir that is untracked (never committed) — not a shell, not untwinned; ignored (Task 3 test `untracked work-only dir is ignored`).
4. A twin whose `work/` is partially present (one file missing) — `compareWorkTwin` reports differing, the shell is a conflict, never deleted (Task 4 test `AC4.2`).
5. `--dry-run` in a `local-merge` project — allowed (it changes nothing); only a real run refuses (Task 3 test `AC7.1`).

---

### Task 1: `isTrackedShellDir` and the `includeTrackedShells` iterator option

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js` (`iterRunDirsWithState`, exports)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`isArchivedPendingTrackedMove` body only — reuse the shared predicate)
- Test: `tests/hooks-context.test.js`, `tests/hooks-session-start.test.js`

**Interfaces:**
- Produces: `isTrackedShellDir(dir: string): boolean` exported from `context.js` — true when `dir` is readable, non-empty, and every entry is either `work` or a directory whose name starts with `spec-` and whose own entries are non-empty and all exactly `work`. No git calls (the "tracked" half is the caller's check). `archive-merged.js`'s `isArchivedPendingTrackedMove(root, dir)` becomes `fs.existsSync(archiveDir) && isTrackedShellDir(dir)` with identical behavior.
- Produces: `iterRunDirsWithState(cwd, { includeTrackedShells: true })` — the `archiveState.status === 'clean'` skip is bypassed when `isTrackedShellDir(dir)`; the fresh-`archiving`-claim skip still applies. Composes with `status` (default yields non-clean only, as today; a shell has no own run-state so it reads non-clean).

- [ ] **Step 1: Write failing tests in `tests/hooks-context.test.js`** (use the file's `tmpProject`/`mkRun` helpers; create `work/1-spec.md` files with `fs.writeFileSync`):
  - `AC1.1: includeTrackedShells yields a work-only dir whose archive twin is clean` — live `{id}/work/1-spec.md`, `archive/{id}` with `{status:'clean'}`; `ctx.listRunDirs(project, { includeTrackedShells: true })` deep-equals `[liveDir]`.
  - `AC1.2: includeTrackedShells yields a spec-N/work-only multi-spec shell` — `{id}/spec-7/work/7-spec.md` + clean twin → yielded.
  - `AC10.1: default call still skips the clean-twin shell` — same fixture, `ctx.listRunDirs(project)` → `[]` and `ctx.resolveRunDir(project, {})` → `null`.
  - `AC10.x: fresh archiving claim still skipped` — twin `{status:'archiving', updatedAt: new Date().toISOString()}` (`isStaleClaim` reads `updatedAt`) → `[]` even with the option.
  - `includeTrackedShells does not resurrect a clean-twin dir that holds a gitignored entry` — live dir has `work/` and `decisions.md` → `[]` with the option.
  - `isTrackedShellDir: false for empty dir, for spec-N holding a non-work entry, for an empty spec-N dir; true for work-only and spec-N/work-only`.
- [ ] **Step 2: Add the AC10 session-start test in `tests/hooks-session-start.test.js`** named `AC10.2: unfinished-run report does not list a clean-twin work-only shell`, following that file's existing fixture/spawn pattern for the `unfinished pipeline run(s) detected` line: with only a clean-twin shell present, the stdout must not contain the shell's run id.
- [ ] **Step 3: Run** `node --test tests/hooks-context.test.js tests/hooks-session-start.test.js` — Expected: the AC1.x and isTrackedShellDir tests FAIL (function/option missing); AC10.x pass already (that is fine — they pin unchanged behavior).
- [ ] **Step 4: Implement** `isTrackedShellDir` and the option in `context.js`; switch `isArchivedPendingTrackedMove` to it (import from `../hooks/context`, already imported module).
- [ ] **Step 5: Run** `node --test tests/hooks-context.test.js tests/hooks-session-start.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js` — Expected: all pass.
- [ ] **Step 6: Commit** `git add` the three files, message `Add isTrackedShellDir and includeTrackedShells iterator option — refs #3975`.

### Task 2: `archiveRunDir` commits with an explicit pathspec in the twin-only case

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveRunDir`, the `commitPaths` line)
- Test: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`

**Interfaces:**
- Produces: `archiveRunDir` behavior unchanged except `commitPaths` = every `workMoves` src/dest pair plus, for each `stagedOps` entry of kind `twin-rm`, its `srcFile`, and of kind `twin-mv`, its `srcFile` and `destFile`. `commitPaths` is never empty when a commit runs.

- [ ] **Step 1: Write the failing test** `AC6.1: twin-only archival commits only its own paths, never an unrelated staged file` — using this file's `makeRepo`/`commitPath`/`git` helpers: commit `{id}/work/1-spec.md` and an identical `archive/{id}/work/1-spec.md` (so `workMoves` is empty and `twinPlan` non-empty); write and `git add` an unrelated `unrelated.txt`; call `archiveRunDir(root, runDir, { env })` where `env` wraps `process.env` with a `PATH`-preserving git that records argv — simplest: assert on git state instead: after the call, `git show --name-only --format= HEAD` must not list `unrelated.txt`, and `git diff --cached --name-only` must still list `unrelated.txt`. Also assert `result.ok === true`. Second assertion for the argv clause: spy by wrapping — if the module exposes no runner seam for `commitGit`, assert the pathspec effect only (the HEAD-commit file list) and state in the test comment that the argv form is proven by that effect.
- [ ] **Step 2: Run** `node --test tests/bin-lib/reconcile/archive-merged-record-guards.test.js --test-name-pattern "AC6.1"` — Expected: FAIL (`unrelated.txt` is in the commit).
- [ ] **Step 3: Implement** the `commitPaths` change; collect twin paths from `stagedOps` before the commit.
- [ ] **Step 4: Run** the whole file plus `tests/archive-run-verb.test.js` — Expected: PASS.
- [ ] **Step 5: Revert-prove (AC6.2: run against the old code the test fails):** temporarily restore the old `commitPaths` line, re-run AC6.1, see it fail, restore.
- [ ] **Step 6: Commit** `Scope archiveRunDir's commit to its own paths in the twin-only case — refs #3975`.

### Task 3: `archive-tracked-shells.js` — enumeration, dry run, environment refusal, local branch

**Files:**
- Create: `plugin/bin/archive-tracked-shells.js`
- Test: `tests/archive-tracked-shells.test.js`

Load the `gh-api-module-pattern` skill (and its `cli-wrapper-contract.md`) and `windows-checkout-test-parity` before writing. Reuse: `runGit`/`repoPinnedEnv` from `lib/hooks/git-exec`, `splitNul` from `lib/git-z`, `mainCheckoutRoot` from `lib/hooks/worktree-detect`, `readRunState`/`isTrackedShellDir` from `lib/hooks/context`, `archiveRunDir`/`listSpecDirs` from `lib/reconcile/archive-merged`, `resolvePolicy`/`callerDeps` from `resolve-policy.js` (the in-process core).

**Interfaces:**
- Produces: `module.exports = { run, realDeps, findShells, BRANCH }`, `BRANCH = 'housekeeping/archive-tracked-shells'`; `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps)`.
- `run(argv: string[], deps): 0|1|2` — `deps`: `cwd()`, `env`, `stdout(s)`, `stderr(s)`, `git(args, { cwd, input? }) -> { stdout, stderr, failure, exitCode }`, `gh(args, { cwd, input? }) -> same`, `ghAvailable(): boolean`, `policy(root, keys: string[]) -> Record<string,string>` (string values, `''` for unset), `worktreePath(root) -> string` (default `path.join(root, '.worktrees', 'archive-tracked-shells')`).
- Args: `--root <dir>`, `--dry-run`, `--no-pr`; anything else → stderr usage, exit 2. Root = `--root` resolved against `deps.cwd()`, else `mainCheckoutRoot(cwd) || cwd`.
- `findShells(root, deps) -> { shells: Array<{ runId, dir }>, untwinned: string[] }` — candidates are directories under `{root}/.claude-tweaks/pipelines` except `archive`, sorted by name, that pass `isTrackedShellDir` and have at least one git-tracked file (one `git ls-files -z -- .claude-tweaks/pipelines` call, keyed by the path's run-id segment). With `readRunState(archive/{runId}).status === 'clean'` → `shells`; otherwise → `untwinned` (run ids).
- Stdout: one JSON line, the envelope `{ moved: [{runId, commit}], deleted: [{runId, commit}], conflicts: [{runId, reason, differing}], untwinned: string[], branch: string|null, pr: {number, url, armed, armError?}|null, notes: string[] , dryRun?: true }`.

- [ ] **Step 1: Write failing tests** (fixture helper in the test file: `makeFixture()` creates a bare repo as `origin`, a clone as the main checkout with `.gitignore` copied from this repo's root (so archive paths behave as in production), an initial commit pushed to `origin/main`, and `.claude-tweaks/policy.yml` writers for `integration-model`/`worktree-always`/`housekeeping-auto-merge`; `addShell(root, id, { twin: 'identical'|'absent'|'differs', clean: true })` commits the live `work/{n}-spec.md` (and the archive twin's `work/` when `twin !== 'absent'`), pushes, and writes the gitignored `archive/{id}/run-state.json` `{status:'clean'}`). Inject `gh` as a recording fake; `policy` reads from a map; real git via `runGit`.
  - `findShells: clean-twin work-only dir is a shell; twin-less one is untwinned; untracked work-only dir is ignored; dir with run-state.json is ignored`.
  - `AC7.1: --dry-run makes no change and opens no PR` — two shells; `run(['--root', root, '--dry-run'])` exits 0, envelope `dryRun: true`, lists both run ids across `moved`/`deleted` (identical twin → `deleted`, absent twin → `moved`, classified by whether the archive twin's `work/` exists in the main checkout), `pr: null`; `git rev-parse HEAD` and `git branch --list housekeeping/*` unchanged; fake `gh` saw no calls. Also passes under `integration-model: local-merge`.
  - `AC7.2: local-merge without --no-pr refuses with exit 2 naming --no-pr`; `AC7.3: gh absent (ghAvailable false) without --no-pr refuses with exit 2 naming --no-pr`; both leave no `.worktrees/archive-tracked-shells` and no branch.
  - `AC7.4: --no-pr makes the branch and commits locally, pushes nothing, prints the branch name` — under `local-merge`: exit 0, envelope `branch === BRANCH`, `pr: null`; `git log main..housekeeping/archive-tracked-shells --format=%s` has one `[reconcile] archive run {id}` subject per shell; `git ls-remote origin refs/heads/housekeeping/archive-tracked-shells` empty; main checkout `HEAD` unchanged; scratch worktree removed (`git worktree list` does not name it).
  - `AC4.1: identical twin → deleted, absent twin → moved` (via `--no-pr`): the branch tree no longer has `.claude-tweaks/pipelines/{id}/work/*` and has `archive/{id}/work/{n}-spec.md`.
  - `AC4.2: differing twin is left in place, named with its differing path, exit 1` (via `--no-pr`): one identical + one differing shell → `conflicts[0]` = `{ runId, reason: 'work-twin-conflict', differing: ['{n}-spec.md'] }`, the identical one still `deleted`, exit 1.
- [ ] **Step 2: Run** `node --test tests/archive-tracked-shells.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** parse, root, policy read (`integration-model`, `integration-branch`, `housekeeping-auto-merge`), refusal (skipped under `--dry-run`), `findShells`, dry run, and the scratch-worktree loop for `--no-pr`: fetch `origin {integration}` (failure → note, continue on last-fetched ref); base = local `BRANCH` if it exists, else `origin/{integration}`; if the worktree path exists, `git worktree remove --force` it and `git worktree prune`; `git worktree add -B BRANCH <wt> <base>`; require `git -C <wt> status --porcelain` empty; per shell, skip when `<wt>/.claude-tweaks/pipelines/{id}` has no `work`/`spec-*` content (already done on this branch); classify by whether `<wt>/.claude-tweaks/pipelines/archive/{id}/work` (or a `spec-*/work` twin) exists; call `archiveRunDir(<wt>, <wt-run-dir>, { env })`; `ok` → `moved`/`deleted` with `commit: result.commit && result.commit.sha`; refusal → `conflicts` with `reason` and `differing` (from `result.conflict`, else `[]`). Remove the worktree in a `finally`; keep the branch. Integration branch: policy value, else `git symbolic-ref --short refs/remotes/origin/HEAD` minus `origin/`, else exit 2.
- [ ] **Step 4: Run** the test file — Expected: PASS. Then run `node --test tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js` and any `tests/*bin*listing*`/`exit-code` conformance suite that walks `plugin/bin/*.js` (`git grep -l "plugin/bin" tests | xargs grep -l readdirSync` to find them) — Expected: PASS or a listing failure that Task 6 fixes (note which).
- [ ] **Step 5: Commit** `Add archive-tracked-shells CLI — enumeration, dry run and local branch — refs #3975`.

### Task 4: `archive-tracked-shells.js` — push, one PR, reuse, arming, resume, failure cleanup

**Files:**
- Modify: `plugin/bin/archive-tracked-shells.js`
- Test: `tests/archive-tracked-shells.test.js`

**Interfaces:**
- Consumes: Task 3's `run`, `findShells`, `BRANCH`, deps shape.
- Produces: the non-`--no-pr` path. Base selection before `worktree add`: `git ls-remote --heads origin refs/heads/BRANCH`; when present, `gh pr list --head BRANCH --state all --json number,url,state`: an OPEN PR → base `origin/BRANCH` (fetched), reuse that PR; no PR at all → base `origin/BRANCH` (crash between push and create); only MERGED PR(s) → delete the stale remote branch (`git push origin :refs/heads/BRANCH`), base `origin/{integration}`; a CLOSED PR and no open one → exit 2 naming the PR. When absent remotely: local `BRANCH` if it exists, else `origin/{integration}`.
- After the loop: no new commits (`git rev-list --count <base>..HEAD` in the worktree is 0) → no push; envelope reports the reused open PR if any, else `pr: null`. Otherwise `git push origin BRANCH` (never `--force`); then reuse the open PR or `gh pr create --base {integration} --head BRANCH --title "Archive {N} stranded run spec headers" --body-file -` (body: one line per moved/deleted run id, one per conflict with its differing paths, and the untwinned list under a heading `Untwinned (classify by hand)`), then re-read with `gh pr list --head BRANCH --state open --json number,url`. A create or read-back failure → delete the remote branch only if this call created it, exit 1. Arming: `housekeeping-auto-merge` `'true'` → `gh pr merge {number} --auto --squash`; failure → `armed: false, armError: <first stderr line>`, not an error exit; `'false'` → `armed: false` and a note `housekeeping-auto-merge is false — PR left unarmed`.

- [ ] **Step 1: Write failing tests** (fake `gh` keeps an in-memory PR table: `pr create` adds `{number, url, state:'OPEN'}`, `pr list` filters it, `pr merge` records argv or fails on demand):
  - `AC2.1: under worktree-always the emitted command exits 0, creates the branch, moves the shell, opens one PR, main checkout HEAD unchanged` — `pr-first`, `worktree-always: true`; one shell; exit 0; `git ls-remote` shows the branch; `origin`'s branch tree has the archive path; fake gh saw exactly one `pr create`; main checkout `HEAD` unchanged.
  - `AC3.1: three shells → exactly one PR, branch carries every move`.
  - `AC3.2: re-run after simulated merge is a no-op exiting 0 with moved empty` — merge `origin/BRANCH` into `origin/main` (fast-forward push in the bare repo), mark the fake PR `MERGED`, delete the live dirs in the main checkout as a pull would; re-run → exit 0, `moved` and `deleted` empty, no new `pr create`.
  - `AC3.3: re-run while the PR is open reuses the branch and PR and prints its URL` — add a fourth shell, re-run → no second `pr create`, envelope `pr.url` equals the first; remote branch fast-forwarded with the new move.
  - `AC3.4: re-run after a crash resumes from the branch's current state` — leave a stale worktree dir at `worktreePath(root)` and a local `BRANCH` with one shell already moved (no push); re-run → exit 0, every shell archived exactly once on the branch, one PR.
  - `AC5.1: housekeeping-auto-merge true arms with gh pr merge --auto --squash`; `AC5.2: false leaves it unarmed and says so`; `AC5.3/AC5.4: a rejected arming call leaves the PR unarmed, reports the rejection, and is not an error exit (exit 0)`.
  - `AC4.3: with one differing and one clean shell the PR still opens for the clean one and the CLI exits 1`.
  - `AC7.5: a failure after the scratch worktree exists removes it and leaves no branch on the remote` — fake `gh pr create` and the read-back fail → exit 1, no `.worktrees/archive-tracked-shells`, `git ls-remote` empty for BRANCH.
- [ ] **Step 2: Run** the test file — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the test file — Expected: PASS. Revert-prove AC7.5 by removing the remote-branch deletion and seeing it fail.
- [ ] **Step 5: Commit** `Open one housekeeping PR from archive-tracked-shells, reuse and arm it — refs #3975`.

### Task 5: Reconcile reports shells and prints the CLI as the completion

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archivedPendingTrackedMoveCommand`, `archiveMerged` main loop)
- Modify: `plugin/bin/lib/reconcile/index.js` (runs mapping: pass `command` through)
- Modify: `plugin/bin/lib/reconcile/format-summary.js` (one line for the batch)
- Test: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`, a new test in `tests/archive-tracked-shells.test.js` or `tests/hooks-dispatcher.test.js` for the CLI-level AC1

**Interfaces:**
- Produces: `archivedPendingTrackedMoveCommand(root: string): string` returns exactly `node "${CLAUDE_PLUGIN_ROOT}/bin/archive-tracked-shells.js" --root "<root>"` (the `${CLAUDE_PLUGIN_ROOT}` placeholder literal, as today).
- `archiveMerged`'s main loop iterates `iterRunDirsWithState(root, { includeTrackedShells: true })`. In the split-state branch: under `worktree-always` every such dir → `skipped` `{ runDir, reason: 'archived-pending-tracked-move', command: archivedPendingTrackedMoveCommand(root) }`; without it, the first such dir of the pass goes through `finishArchiveAttempt` (as today) and every later one is skipped with the same entry. Only this loop passes the option.
- `index.js` adds `...(s.command !== undefined ? { command: s.command } : {})` to each skipped run entry.
- `format-summary.js`: when any `result.runs` entry has reason `archived-pending-tracked-move` and a `command`, push one line `archive stranded shells: {command}` (once, first command seen) right after the aggregated `skipped:` line.

- [ ] **Step 1: Write failing tests:**
  - `AC1.3: reconcile --dry-run --json --checks archive lists a clean-twin shell as archived-pending-tracked-move` — real git repo fixture under `worktree-always: true` with a committed live `work/` and a clean twin `run-state.json`; spawn `node plugin/bin/hooks.js reconcile --dry-run --json --checks archive` with `cwd` the fixture (copy how `tests/hooks-dispatcher.test.js` spawns reconcile); parse stdout, find the `runs` entry for the dir: `reason === 'archived-pending-tracked-move'` and `command` matches `/archive-tracked-shells\.js" --root /`. Revert-prove: drop `includeTrackedShells` from the loop → the entry is absent.
  - `AC1.4: without worktree-always only one shell is archived in place per pass` (archiveMerged level) — two clean-twin shells, no worktree-always → `archived.length === 1`, the other in `skipped` with the reason and command.
  - `format-summary prints one archive-stranded-shells line for several shells` (unit test on `formatSummary` with two such entries → exactly one line).
  - Update the existing pins at the `archivedPendingTrackedMoveCommand` test (now takes a root, asserts `archive-tracked-shells.js" --root`) and `split-state run dir under worktree-always` (`skip.command` matches `/archive-tracked-shells\.js/`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/archive-tracked-shells.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those files plus `tests/bin-lib/reconcile/*.test.js`, `tests/hooks-dispatcher.test.js`, `tests/archive-run-verb.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `Report clean-twin spec shells in reconcile and print archive-tracked-shells as their completion — refs #3975`.

### Task 6: Docs

**Files:**
- Modify: `docs/plugin-structure.md` (CLI listing next to `sweep-stray-run-dirs.js`, line ~392)
- Modify: `docs/reconcile-checks.md` (the `archived-pending-tracked-move` bullet, ~line 189)

- [ ] **Step 1:** Add `node plugin/bin/archive-tracked-shells.js [--root <dir>] [--dry-run] [--no-pr]   # Archive stranded spec-shell run dirs (#3975): moves each live work/-only dir with a clean archive twin into archive/ through one housekeeping PR (exit 0 ok, 1 shell left behind, 2 bad call or unsupported env)`.
- [ ] **Step 2:** Rewrite the `archived-pending-tracked-move` bullet: detection now includes a twin whose `run-state.json` is `clean` (reconcile alone opts into it via `includeTrackedShells`); under `worktree-always` the completion is `node "${CLAUDE_PLUGIN_ROOT}/bin/archive-tracked-shells.js" --root "<root>"`, printed once per pass; without it reconcile completes at most one in place per pass and delegates the rest to the CLI. Grep the repo for other prose naming `archive-run` as this skip's completion (`git grep -n "archived-pending-tracked-move" -- plugin docs`) and update each.
- [ ] **Step 3: Run (AC8.1, AC8.2)** `node --test tests/docs-health-doc-path-prose.test.js` and any suite failing from Task 3 Step 4's listing check, plus `git grep -n "archive-tracked-shells" -- docs/plugin-structure.md docs/reconcile-checks.md` (both files must hit) — Expected: PASS, two hits.
- [ ] **Step 4: Commit** `Document archive-tracked-shells and its reconcile completion — refs #3975`.

### Task 7 (orchestrator, not an implementer): one-time run on this repository

Run by the build session after Task 6 against the main checkout, from this worktree's plugin copy: `node plugin/bin/archive-tracked-shells.js --root "<main checkout>" --dry-run`, record the envelope to the run dir (`archive-tracked-shells-dry-run.json`), then the real run; classify each `untwinned` dir in the housekeeping PR body (archive, keep or delete, with a reason). AC9.1: compare the PR's file list with the dry run's `moved`/`deleted` ids. AC9.2/AC9.3 (post-merge: `git ls-tree origin/main .claude-tweaks/pipelines/` lists no live tracked dir with a clean twin, "keep" dirs excepted) are filed as one parked measurement record via `/claude-tweaks:capture`.
