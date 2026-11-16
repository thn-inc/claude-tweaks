# Archive the Spec Header on the Run Branch Before Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap-up `git mv`s a run's tracked spec header (`work/`, `spec-{N}/work/`) to `.claude-tweaks/pipelines/archive/{run-id}/…` as one commit on the run branch before the merge, so a merged run leaves no live tracked directory on `main` and needs no post-merge `[reconcile] archive run` commit; `.gitignore` narrows its `work/**` un-ignore to `work/*-spec.md`.

**Architecture:** A lib module (`plugin/bin/lib/run-header-archive.js`) does the move against a worktree with an injected git runner and returns its outcome as data. A self-logging CLI (`plugin/bin/archive-run-header.js`) resolves the worktree and run id from `--run`, calls it, optionally pushes, and appends its own `decisions.md` line. Skill prose calls the CLI at the wrap-up Phase 4 merge paths, before each path's existing push or local merge. `archiveRunDir` (reconcile) is unchanged and stays the fallback for any run merged without the move.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real-git fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T105924-record-3976/work/3976-spec.md` (record #3976)

**Scope keywords:** archive-run-header, run-header-archive, work/**, audit trail

## Global Constraints

- Release gate: ships in the same release as #3974 or later (already merged: `0905c172dd`). No reader changes — readers go through `plugin/bin/lib/run-header.js` (#3974).
- The move commits with an explicit pathspec naming every source and destination path it staged — never an empty pathspec (an empty pathspec after `--` commits the whole index; `archiveRunDir`'s #3975 hazard).
- The move never blocks the merge and never adds a stop in `auto` mode: every refusal logs one `decisions.md` line (per `_shared/auto-decision-log.md`) and the caller proceeds.
- Untracked files under `work/` stay where they are; only `git ls-files`-tracked files move (per-file `git mv`, never a whole-directory `git mv`, which takes untracked siblings with it — probed: per-file `git mv` leaves them, and needs the destination directory to exist first).
- Commit subject is exactly `Archive run {run-id} spec header — moved to archive/ before merge` (no issue number: the CLI runs in consumer repos; must not start with `[reconcile] archive run`).
- Exit codes (CLI): `0` every outcome as data (`moved`, `noop`, `refused`); `2` malformed invocation (unknown flag, missing/empty/flag-shaped `--run`/`--worktree` value, run id not derivable from `--run`); `3` `--run` missing or not anchored under the main checkout (stage-item/append `resolveTarget` refusal). Self-logging; a failed append is `logged: false` in the envelope plus one stderr line, never an exit code.
- `.gitignore` and `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md` carry byte-identical `pipelines` lines.
- Rail: `RAIL_BYTES` = 52,500. Headroom before this change: `cleanup-procedures-execution.md` 48,436 (4,064 left), `execution-and-verification.md` 25,922, `auto-merge-short-circuit.md` 33,161, `materialize.md` 41,373, `pipeline-run-dir.md` 23,681, `step-04-gitignore-suggestions.md` 11,226. **Do not edit** `_shared/pr-first-merge.md` (its composed `merge` bundle measures 52,498 B in the `unresolved` combination — 2 B left) or `dispatch/settle-and-merge.md` (51,143 B). `flow/multispec-review-console.md` (52,496 B) takes exactly Task 3's three replacements, measured at plan time to 52,457 B; no other edit to it.
- Multi-spec runs (plan review, settled under the spec's Decision rule, keeping AC3 as written): the move runs **once**, at `flow/multispec-review-console.md`'s Shared teardown step 0 — after the batch pass, the consolidated console and the header capture (the last header readers), before step 2's shared branch finish, under both integration models — moving every `spec-{N}/work/` header in one commit. Per-spec wrap-ups skip it under `MULTISPEC_REVIEW_DEFER=1`.
- Accepted degrade: a multi-spec Shared teardown resumed after step 0 already moved the headers finds no header at its capture paths (worktree mirror, then the live parent path), takes its existing `SKIP` + manifest-id fallback, and skips the `parked` restore for that spec. A reader change is a Non-Goal (#3974 owns readers); the capture runs before step 0 on every non-resumed teardown.
- Out of scope: a header re-materialized at the live path after the move (a `/build` re-run on the run branch after wrap-up). `materialize.js` does not consult the archived path; such a run relies on the `archiveRunDir` fallback.
- Governing project skills, quoted verbatim:
  - `gh-api-module-pattern/cli-wrapper-contract.md`: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract".
  - same file: "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code … The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`" and "A relative path is resolved against `deps.cwd()`" and "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment".
  - same file: "Tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), passing an absolute `cliPath` … each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code. The helper's `env` defaults to `{}` and is the whole environment the CLI sees, so a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes."
  - same file: "A git child that runs under `repoPinnedEnv()` cannot be proved by the `GIT_DIR` fixture above; prove its injected env with a variable git honours … `GIT_AUTHOR_NAME` checked as the new commit's `%an`".
  - same file: "A value-taking flag given as the last argv element reads `undefined` … pin both the trailing bare flag and the empty-string value with their own test cases." and "A value the CLI forwards into a child's argv as a positional (a remote, a ref) rejects any leading `-`".
  - same file: "An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` — `tests/path-guard-conformance.test.js` (AC3.1) flags the token in any new `plugin/bin/lib/` file. A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent", never checked for existence first".
  - same file: "A CLI that reports a decision as data logs that entry itself … a new self-logging CLI joins it in the same change: `tests/phase-exit-call-sites-conformance.test.js` pins that list equal to its `SELF_LOGGING_SOURCES` map and checks that each CLI's comment-stripped source requires `log-decision/append` and calls `formatEntry(`."
  - `gh-api-module-pattern/run-dir-boundary-guards.md`: "Import the copy that sits beside the writer you call … `claim-targets.js` (#2775) imports append.js's together with `appendEntry` — and pin the refusal with a fixture carrying both a real main-checkout run dir and a worktree-local shadow of it, asserting the shadow's file is byte-unchanged after the exit 3."
  - `git-ground-truth-test-env`: "A git child that supplies ground truth about refusal or trust runs hermetic. Set `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` to the null device" (applies to the `git check-ignore` ground-truth test: a global `core.excludesFile` would otherwise change the answer).
  - `skill-prose-conformance-tests`: "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
  - `windows-checkout-test-parity`: "`toPosix` at the display-ID producer with native fs paths left alone" — the lib's `moved` list holds git's POSIX repo-relative paths; fs operations use `path.join(worktree, rel)`.
- Behavior-change prose sweep (classified no-change): comments saying the header "reaches the main checkout by merge" in `plugin/bin/lib/hooks/sweep-shadow.js:21`, `plugin/bin/lib/reconcile/archive-merged.js:212`, `plugin/bin/lib/wrap-up/engine-verify.js:440`, `plugin/skills/wrap-up/cleanup-procedures-execution.md:76`, `plugin/skills/wrap-up/curation-engine.md:152` stay true (it still lives in the worktree during the run and reaches `main` by merge, now at the archived path); `help/context-flow.md:87,140` ("stays committed as audit trail") stays true.
- Premise departure (logged in `decisions.md`): the spec's candidate seam is `_shared/pr-first-merge.md` before its Step 2. That file cannot grow (rail above), so the move runs at each wrap-up Phase 4 merge path before that path's own push or local merge — `execution-and-verification.md` (before Phase exit), `auto-merge-short-circuit.md` (after the ledger commit, before its push / local-merge branch), `cleanup-procedures-execution.md` Section C step 3 (before the local-merge finish), and `flow/multispec-review-console.md` Shared teardown step 0 for multi-spec runs. Non-wrap-up merge sites keep the `archiveRunDir` fallback (listed in the PR body by the controller, see the end).

## Review Focus

1. A destination file already present and byte-identical to the live copy (a resumed wrap-up after a partial earlier move, or `archiveRunDir`/`archive-tracked-shells` left an identical twin) — expect: the live copy is removed with `git rm` in the move commit, no refusal. Test in Task 1 (`identical archived twin is resolved by git rm, not refused`).
2. A tracked non-spec file under `work/` (e.g. `prompt-audit-probe.txt`) while the narrowed `.gitignore` ignores its destination — expect: it still moves (git mv onto an ignored path is allowed; probed). Test in Task 1 (`moves every tracked file, not only *-spec.md`), run against the repo's real `.gitignore`.
3. A `--run` naming a `spec-{N}/` per-spec dir or an already-archived `archive/{run-id}/` dir — expect: the run id resolves to the top-level `{run-id}` and the worktree resolves from the parent's run-state (or `worktreeAtClose`); a `spec-{N}` `--run` moves only that spec's `spec-{N}/work/` (never a sibling's header, which its own wrap-up may still read), a parent or archived `--run` moves every header of the run. Test in Task 2.
4. A git failure mid-batch (second `git mv` fails, or the commit fails via a failing pre-commit hook) — expect: every staged op is reverted, no commit, `refused` with `reason: 'git-mv-failed'`/`'commit-failed'`, live files back in place. Test in Task 1 (`a failing pre-commit hook reverts the move and refuses`).
5. `--push` when `origin` rejects (diverged remote branch) — expect: `outcome: 'moved'`, `push.pushed: false`, one `SKIP` line, exit 0. Test in Task 2.

---

### Task 1: The move library

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/run-header-archive.js`
- Modify: `plugin/bin/lib/run-header.js` (header comment only: name `run-header-archive.js` as the wrap-up writer beside `archiveRunDir`)
- Test: `tests/run-header-archive.test.js`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (append the AC1/AC4 reconcile cases)

**Interfaces:**
- Consumes: `runRelDirs(runId)` from `plugin/bin/lib/run-header.js` (`[live, archived]` POSIX repo-relative dirs); `runGit(args, cwd, { env, raw })` from `plugin/bin/lib/hooks/git-exec.js` (returns `{ stdout, failure, stderr }`); `lstatType` from `plugin/bin/lib/path-guard`; `splitNul` from `plugin/bin/lib/git-z`.
- Produces:
  - `ARCHIVE_HEADER_SUBJECT(runId) -> string` — the exact commit subject in Global Constraints.
  - `archiveRunHeader({ worktree, runId, specDir = null, env, git = runGit }) -> { outcome: 'moved'|'noop'|'refused', reason?: string, detail?: string, commit?: string, moved: string[] }` — `moved` lists POSIX repo-relative live paths moved (or removed as identical twins), in `git ls-files` order. `specDir` (`'spec-{N}'`) limits the move to `{live}/{specDir}/work`; `null` moves `{live}/work` and every `{live}/spec-*/work`. Refusal `reason` enum: `missing-worktree`, `dirty-index`, `archived-copy-differs`, `git-mv-failed`, `commit-failed`, `git-mv-failed-partial-revert`, `commit-failed-partial-revert`, `git-failed` (the two `-partial-revert` reasons mean the unwind itself partly failed; `detail` lists what is left). `dirty-index` also covers an unstaged edit to any path the commit would carry (a source, or an `rm`-op destination). An invalid `runId`/`specDir` throws `TypeError` (the CLI validates first).
  - `pushRunBranch({ worktree, env, git = runGit }) -> { pushed: boolean, branch?: string, reason?: 'detached-head'|'invalid-branch'|'push-failed', detail?: string }` — pushes `refs/heads/{branch}:refs/heads/{branch}` to `origin`; a branch name starting with `-` is `invalid-branch`.

- [ ] **Step 1: Write the failing tests** in `tests/run-header-archive.test.js`, each on a real repo built per test (`committedRepo` / `fixtureGit` from `tests/helpers/git-fixtures.js`, the repo's real `.gitignore` copied in and committed, `RUN = '2026-11-16T000000-record-7'`):
  - `AC2.3/AC2.4 moves a live flat header to archive/{run}/work in one commit with the fixed subject` — after `archiveRunHeader`, `git ls-tree -r --name-only HEAD .claude-tweaks/pipelines/${RUN}/` is empty, `archive/${RUN}/work/7-spec.md` is tracked, `git log -1 --format=%s` equals `ARCHIVE_HEADER_SUBJECT(RUN)`, result `{ outcome: 'moved', commit: <HEAD sha>, moved: ['.claude-tweaks/pipelines/${RUN}/work/7-spec.md'] }`.
  - `AC2.5 re-entry: a second call on a branch where the move already happened is a no-op with no new commit` — `outcome: 'noop'`, HEAD unchanged.
  - `noop when the run never materialized (no tracked work/)` — `outcome: 'noop'`, HEAD unchanged.
  - `AC2.6 refusal: an archived copy that differs makes no commit and leaves both copies` — archived `7-spec.md` committed with different bytes; result `{ outcome: 'refused', reason: 'archived-copy-differs' }`, HEAD unchanged, index clean (`git diff --cached --quiet` exits 0), live file still tracked.
  - `identical archived twin is resolved by git rm, not refused` — archived copy byte-identical and tracked; `outcome: 'moved'`, live path gone from HEAD's tree, archived path tracked.
  - `an untracked destination file: identical is taken over, different is refused` — destination present on disk but untracked: byte-identical → `outcome: 'moved'` via `git mv -f`, destination now tracked; different bytes → `{ outcome: 'refused', reason: 'archived-copy-differs' }` with the untracked file's bytes unchanged.
  - `specDir limits the move to that spec's header` — tracked `spec-8/work/8-spec.md` and `spec-9/work/9-spec.md`; `archiveRunHeader({ ..., specDir: 'spec-8' })` moves only the first; `spec-9`'s header is still tracked at its live path.
  - `AC3.1/AC3.2 multi-spec: one move commit relocates work/ and every spec-{N}/work/ header` — tracked `work/7-spec.md`, `spec-8/work/8-spec.md`, `spec-9/work/9-spec.md`; after the call, exactly one new commit; `git ls-tree -r --name-only HEAD .claude-tweaks/pipelines/archive/${RUN}/` lists all three under the same layout; the live tree lists none.
  - `moves every tracked file, not only *-spec.md; untracked files stay` — tracked (forced) `work/prompt-audit-probe.txt` moves to `archive/${RUN}/work/prompt-audit-probe.txt` (tracked there); an untracked `work/scratch.md` still exists at its live path afterwards.
  - `AC2.7 a commit made after the move leaves no live work/ path` — after the move, merge a branch that touches an unrelated file (and commit a ledger file); `git ls-tree -r HEAD -- .claude-tweaks/pipelines/${RUN}/` is empty.
  - `dirty index refuses before any mutation` — an unrelated staged file; `{ outcome: 'refused', reason: 'dirty-index' }`, HEAD unchanged, the unrelated file still staged.
  - `a failing pre-commit hook reverts the move and refuses` — install `.git/hooks/pre-commit` exiting 1 (shape of `installFailingPreCommitHook` in `tests/bin-lib/reconcile/archive-merged.test.js`); `{ outcome: 'refused', reason: 'commit-failed' }`, live file tracked at its live path, archived path absent from the index, `git status --porcelain` shows nothing staged.
  - `missing worktree refuses` — `worktree` is a non-existent path → `{ outcome: 'refused', reason: 'missing-worktree' }`.
  - `the commit takes the injected env` — `env` carries `GIT_AUTHOR_NAME=ArchiveEnvProbe` (absent from the test process env); `git log -1 --format=%an` equals it.
  - `AC7.1 the gh-absent bookends check reads the archived-only header as materialized` — after the move, `require('../plugin/bin/verify-run-bookends.js').realDeps.isSpecCommitted({ worktree, runDir: <main-checkout-shaped run dir path for RUN>, issue: 7, multiTarget: false })` returns `true` (read `isSpecCommitted`'s argument shape in `plugin/bin/verify-run-bookends.js` lines 123-163 and match it).
  - `pushRunBranch pushes the current branch; a detached HEAD is refused` — with a bare `origin` (`originWithTwoClones` from `tests/helpers/git-fixtures.js`): branch `feat-x` pushed → `git ls-remote origin refs/heads/feat-x` names HEAD; detached → `{ pushed: false, reason: 'detached-head' }`; a remote branch diverged from local → `{ pushed: false, reason: 'push-failed' }`.

  Append to `tests/bin-lib/reconcile/archive-merged.test.js`:
  - `AC1.1/AC1.2 a squash-merged branch carrying the move lands no live dir on main` — fixture: `main` repo; branch with `work/7-spec.md` committed, then `archiveRunHeader` on that branch; `git merge --squash` + commit onto `main`. Assert `git ls-tree --name-only main .claude-tweaks/pipelines/` lists `archive` and no `${RUN}` entry.
  - `AC1.3/AC1.4 archiveMerged archives that merged run with no [reconcile] archive run commit and without a live header` — on the squash-merged main from the case above, seed the main checkout's live run dir with only the gitignored half (`run-state.json` carrying `pr.number`, resolved `console.json`, `decisions.md`) the way this suite's existing merged-run cases do, inject a PR-state resolver reporting `MERGED` with `mergeCommit.oid` = the squash commit (the `createPrStateResolver({ root, deps: { byNumber, byBranch } })` shape in `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`), call `archiveMerged({ cwd: root, prStates, ... })`. Assert the run is in `archived`, `archiveCommits[runDir]` is undefined, `git log --format=%s main` has no line starting `[reconcile] archive run`, and the live header was never available to the detection: `git ls-tree -r main -- .claude-tweaks/pipelines/${RUN}/` is empty before and after the call and no `work/` directory exists under the main checkout's live run dir.
  - `AC4.1 a local-merge run that went through the move gets no post-merge archive commit` — same fixture with `git merge --no-ff` instead of a squash; `archiveRunDir(root, runDir)` returns `ok: true` and no `commit`.
  - `AC4.2 fallback: a local-merge run merged without the move is still archived by archiveRunDir` — `--no-ff` merge of a branch whose header is still live; `archiveRunDir` returns `ok: true` with a `commit` whose subject starts `[reconcile] archive run`, and the header is tracked under `archive/${RUN}/work/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/run-header-archive.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL — `Cannot find module '../plugin/bin/lib/run-header-archive'`.

- [ ] **Step 3: Implement `archiveRunHeader` and `pushRunBranch` in `plugin/bin/lib/run-header-archive.js`**

Order, all through `git(args, worktree, { env })`: (1) `lstatType(worktree)` not a directory → `missing-worktree`; (2) `git ls-files -z -- {live}/work {live}/spec-*/work/*` (`raw: true`, `splitNul`) — empty → `noop`; (3) `git diff --cached --quiet` (exit 1 → `dirty-index`, other failure → `git-failed`); (4) plan every pair `live → archived + live.slice(liveDir.length)`: a destination in the index → compare `git rev-parse :{live}` with `git rev-parse :{dest}`: equal → `rm` op, else `archived-copy-differs`; a destination only on disk (`lstatType`, untracked) → compare with `git hash-object -- {dest}`: equal → `mv-force` op, else `archived-copy-differs`; every refusal returns before any mutation; (5) `fs.mkdirSync(dirname(dest), { recursive: true })`, then `git mv -- {live} {dest}` / `git mv -f -- {live} {dest}` / `git rm -q -- {live}` per pair, recording each op; (6) `git commit -q -m {subject} -- {every live and dest path}`; (7) on any failure in 5-6 revert ops LIFO (`git mv -- {dest} {live}`; for `mv-force` the same, then rewrite the identical bytes back to `{dest}` untracked; for `rm`: `git reset -q -- {live}` then `git checkout -- {live}`) and refuse; (8) `git rev-parse HEAD` → `commit`; remove now-empty live `work/` and `spec-*/work/` dirs best-effort (a dir still holding untracked files stays). Header comment states the contract, the refusal enum and that `archiveRunDir` stays the post-merge fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/run-header-archive.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/path-guard-conformance.test.js tests/run-header.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove discrimination** — revert one guard at a time in a scratch copy (dirty-index check; the differs comparison; the revert-on-commit-failure) and confirm the matching test goes red; record each red run's failing test name in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/run-header-archive.js plugin/bin/lib/run-header.js tests/run-header-archive.test.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Add the run-header archive move — git mv a run's tracked work/ headers to archive/ in one commit (refs #3976)"
```

---

### Task 2: The `archive-run-header.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/archive-run-header.js`
- Modify: `plugin/skills/_shared/auto-decision-log.md` (roster paragraph "CLIs that log their own entries": add `#3976's \`archive-run-header.js\` appends the same way.` after the `post-merge-run.js` sentence)
- Modify: `tests/phase-exit-call-sites-conformance.test.js` (`SELF_LOGGING_SOURCES`: append `'archive-run-header.js': ['plugin/bin/archive-run-header.js']` last)
- Modify: `docs/plugin-structure.md` (CLI list near line 408: one line for the new CLI with its flags and exit codes)
- Test: `tests/archive-run-header-cli.test.js`

**Interfaces:**
- Consumes: `archiveRunHeader`, `pushRunBranch` (Task 1); `resolveTarget`, `formatEntry`, `appendEntry` from `plugin/bin/lib/log-decision/append.js`; `readRunStateWithParent`, `readRunState` from `plugin/bin/lib/hooks/context.js`; `mainCheckoutRoot` from `plugin/bin/lib/hooks/worktree-detect.js`; `RUN_ID_RE` from `plugin/bin/lib/hooks/run-dir-resolve.js`.
- Produces: `node plugin/bin/archive-run-header.js --run <run-dir> [--worktree <path>] [--push] [--section </skill>]`; `module.exports = { run, realDeps }`; stdout one JSON line `{ outcome, reason?, commit?, moved, push?: { pushed, reason? }, logged }`. Section default `/wrap-up`.

- [ ] **Step 1: Write the failing tests** in `tests/archive-run-header-cli.test.js` via `runCliSync` (absolute `cliPath`, injected `cwd`, `env` = `cleanGitEnv()` plus `PATH`), fixture: a main repo with a harness worktree (`harnessWorktreeOf`), the run dir under the main checkout's `.claude-tweaks/pipelines/${RUN}/` holding `run-state.json` `{ worktree: <wt> }` written through the real writer (`hooks.js record-worktree` via `spawnCli`, or `plugin/bin/lib/hooks/context.js`'s writer), the header committed in the worktree:
  - `moves, prints the envelope and logs one AUTO line` — exit 0; JSON `outcome: 'moved'`, `logged: true`; `decisions.md` gains exactly one line matching `/^- AUTO \d\d:\d\d:\d\d — Archive spec header: moved 1 file\(s\) to archive\/2026-11-16T000000-record-7\/ in [0-9a-f]{7}/`.
  - `a second call is a no-op and logs nothing` — exit 0, `outcome: 'noop'`, `decisions.md` byte-unchanged.
  - `a refusal logs one SKIP line naming the fallback` — archived copy differs; exit 0; one line matching `/^- SKIP .* — Archive spec header: condition: archived-copy-differs .*→ fallback: header left live; reconcile's archiveRunDir archives it after the merge/`.
  - `no worktree recorded refuses with no-worktree` — run-state without `worktree`/`worktreeAtClose`, no `--worktree`; `outcome: 'refused', reason: 'no-worktree'`.
  - `a worktree equal to the main checkout refuses with not-a-linked-worktree`.
  - `--worktree overrides run-state; worktreeAtClose is the fallback after close-run` — run closed through the real `hooks.js close-run`; still moves.
  - `a spec-{N} run dir moves only its own header; an archived run dir resolves the top-level run id` — Review Focus 3: with `spec-8` and `spec-9` headers committed, `--run {parent}/spec-8` moves only `spec-8/work/8-spec.md`; `--run {main}/.claude-tweaks/pipelines/archive/${RUN}` resolves run id `${RUN}`.
  - `--push pushes the move; a rejected push is a SKIP and outcome stays moved` — Review Focus 5; `push.pushed` true/false accordingly.
  - `an unanchored worktree-local shadow --run exits 3 and leaves the shadow byte-unchanged` — fixture carries the real run dir and a shadow copy under the worktree.
  - `malformed invocations exit 2` — trailing bare `--run`; `--run ""`; `--run --push`; `--worktree -x`; unknown flag; `--run` whose basename is not a run id (`RUN_ID_RE`).
  - `a relative --run resolves against the injected cwd`.
  - `a failed decisions.md append reports logged: false and one stderr line` — make `decisions.md` a directory.
  - `spawnCli smoke: script entry exits 0 on a noop`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/archive-run-header-cli.test.js`
Expected: FAIL — `Cannot find module` for `plugin/bin/archive-run-header.js`. (The `SELF_LOGGING_SOURCES` edit in Step 4 is pinned by `tests/phase-exit-call-sites-conformance.test.js` in Step 5.)

- [ ] **Step 3: Implement `run(argv, deps)` in `plugin/bin/archive-run-header.js`**

`realDeps`: `{ stdout, stderr, cwd, env, mainRoot: (cwd) => mainCheckoutRoot(cwd), now: () => new Date() }`. Order: parse (exit 2 on any malformed case above); resolve `--run` against `deps.cwd()`; `resolveTarget({ runDir, cwd, mainRoot })` not ok → stderr + exit 3 (before any git call); run id = the path segment after `.claude-tweaks/pipelines/` (skipping one `archive` segment), must pass `RUN_ID_RE` else exit 2; a following `spec-{N}` segment becomes `specDir`; worktree = `--worktree` (resolved against `deps.cwd()`), else `readRunStateWithParent(runDir)` state `worktree || worktreeAtClose`, else the parent's `worktreeAtClose`; none → `refused`/`no-worktree`; realpath-equal to `mainRoot` → `refused`/`not-a-linked-worktree`; else `archiveRunHeader({ worktree, runId, specDir, env: deps.env })`; on `moved` with `--push` → `pushRunBranch`. Log via `formatEntry` + `appendEntry({ runDir, section, entry })`: `moved` → `AUTO`, step `Archive spec header`, text `moved {n} file(s) to archive/{run-id}/ in {short sha}{, pushed | , not pushed}`, reversibility `high (git revert)`; `refused` → `SKIP` text `condition: {reason}{ ({detail})} → fallback: header left live; reconcile's archiveRunDir archives it after the merge`; push failure → a second `SKIP` `condition: push failed ({reason}) → fallback: the merge proceeds without the move; archiveRunDir archives the header after the merge`; `noop` → nothing. Header comment: purpose, flags, exit-code family (status-as-data 0 / 2 malformed / 3 unanchored `--run`), self-logging roster membership.

- [ ] **Step 4: Update the roster, the conformance map and `docs/plugin-structure.md`** (Files above).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/archive-run-header-cli.test.js tests/phase-exit-call-sites-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/archive-run-header.js plugin/skills/_shared/auto-decision-log.md tests/phase-exit-call-sites-conformance.test.js docs/plugin-structure.md tests/archive-run-header-cli.test.js
git commit -m "Add archive-run-header.js — self-logging CLI for the pre-merge header move (refs #3976)"
```

---

### Task 3: Wire the move into wrap-up's merge paths, with an ordering test

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (new paragraph between the `worktree`-mode `Fixes` paragraph and `**Phase exit (any run with a run dir`)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (new paragraph between the ledger-deletion commit fence and `**\`integration-model: pr-first\` only — push this commit now**`; the push sentence says it carries "these commits")
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C step 3, the `**\`integration-model: local-merge\`:**` paragraph: one sentence before "verify the feature branch reached an outcome")
- Modify: `plugin/skills/flow/multispec-review-console.md` — exactly these three replacements, nothing else (measured: 52,496 → 52,457 B; no test pins the trimmed phrases — `git grep -n -F` over `tests plugin` returned only this file):
  1. `(\`--ledger\` stays required: it names the exact path the run's creation line logged, and the bare verb would return \`ambiguous\` if the shared branch owned more than one ledger, or \`unattributable\` with no merge base)` → `(\`--ledger\` stays required: the bare verb can return \`ambiguous\` or \`unattributable\`)`
  2. `Why here: the header is committed only on the run's branch, so the main-checkout parent run dir holds no \`spec-{id}/work/\` file until merge; and from step 2 on a merged PR makes the worktree a reap candidate (\`bin/lib/reconcile/reap-merged.js\`), and step 6 removes it — nothing after this point re-reads a header.` → `Why here: the header lives only on the run's branch until step 0 archives it there, and step 6 removes the worktree — nothing after this point re-reads a header.`
  3. append to step 0's last sentence (`… even when the ledger was not deleted (#3813).`): ` Last, archive the spec headers in one commit: \`node "${CLAUDE_PLUGIN_ROOT}/bin/archive-run-header.js" --run "$MULTISPEC_PARENT_DIR"\`, plus \`--push\` under \`pr-first\` (#3976). Never a stop: on \`logged: false\` or a non-zero exit, log one \`SKIP\`.`
- Waived `plugin/skills/_shared/pr-first-merge.md`: not edited — composed `merge` bundle at 52,498 of 52,500 B (Global Constraints); read to place the move before every caller's merge call.
- Waived `plugin/skills/dispatch/task-prompt.md`, `plugin/skills/dispatch/two-call-gate.md`: read only, for the ordering test's bookends/first-call anchors.
- Waived `plugin/skills/wrap-up/merge-mode.md`: read only — a parked (leave-open) PR it merges already carries the move, because the Branch-finish paragraph runs before Phase exit whatever the merge decision; listed in the PR body's Merge sites section.
- Test: `tests/archive-run-header-ordering.test.js`

**Interfaces:**
- Consumes: the CLI command shape from Task 2.
- Produces: anchor strings the ordering test pins (exact): `**Archive the spec header (#3976).**` (in all three files), `bin/archive-run-header.js`.

Paragraph text (execution-and-verification.md; the other two use the same first two sentences with their own placement clause):

> **Archive the spec header (#3976).** `worktree` mode under `integration-model: pr-first`, after the commit above and before the Phase exit call below, as its own Bash call: `node "${CLAUDE_PLUGIN_ROOT}/bin/archive-run-header.js" --run "{run-dir}"`. It `git mv`s the run's tracked `work/` and `spec-{N}/work/` files to `archive/{run-id}/` in one commit on the run branch, so the Phase exit push carries it and the merge lands the header already archived. It never stops wrap-up: on exit 0 (`moved`, `noop` or `refused`) it has logged its own line — hand-log it via `log-decision.js --text-file` only when the envelope says `logged: false`; on any other exit, log one `SKIP` and continue — reconcile's `archiveRunDir` archives the header after the merge. Skip it under `MULTISPEC_REVIEW_DEFER=1`: `flow/multispec-review-console.md`'s Shared teardown step 0 moves every spec's header in one commit.

Short-circuit placement clause: "After the ledger commit above and before the push below, under either `integration-model`"; Section C: "`integration-model: local-merge`, before either finish path below, from inside the worktree". Both keep the exit-0/`logged: false`/other-exit sentence; neither needs the `MULTISPEC_REVIEW_DEFER` sentence (the short-circuit is single-record; Section C is deferred under it).

- [ ] **Step 1: Write the failing test** `tests/archive-run-header-ordering.test.js`. One helper `assertOrder(text, anchors, label)` asserts each anchor occurs and indexes increase; every positive case is paired with a frozen pre-change excerpt (the bytes this task replaces, copied from the live file at plan time) on which the same helper throws:
  - `AC2.1 wrap-up consumes the pack in Phase 3 before Phase 4 executes` — `wrap-up/SKILL.md`: `### Nothing left behind` (containing `wrap-up-pack.js`) < `### Execute approved actions`.
  - `AC2.2 the first-call bookends and the first-call artifact check precede the second call` — `dispatch/task-prompt.md`: `## First call — build,test` < `verify-run-bookends.js` < `## Second call — review,polish,wrap-up`; `dispatch/two-call-gate.md`'s `## 2. The gate` section contains `first-call-artifact-check.js` and `before dispatching the second call`.
  - `AC2.1 pr-first: the move precedes the Phase exit push and the Branch finish merge` — `execution-and-verification.md`: `**Archive the spec header (#3976).**` < `**Phase exit (any run with a run dir` < `**Branch finish (`.
  - `AC2.1 short-circuit: the move precedes the push and both merge branches` — `auto-merge-short-circuit.md`: `delete-ledger` < `**Archive the spec header (#3976).**` < `push these commits now` < `_shared/pr-first-merge.md`'s` (the merge call) and < `_shared/local-merge-sequence.md` with this branch's bindings`.
  - `AC2.1 local-merge: the move precedes the finish in Section C step 3` — `cleanup-procedures-execution.md`: `**Archive the spec header (#3976).**` < `local-merge-auto-finish.md` < `finishing-a-development-branch\` now`; and the move anchor is after `## C. Git Worktree` and before `3.6. **Close the pipeline run`.
  - `AC2.1 the move precedes Section B's archival` — in `execution-and-verification.md`, the move anchor precedes `then run cleanup items 4, 6,` (items 4/8 run after the Branch finish).
  - `AC3.3 multi-spec: one move at Shared teardown step 0, after the header capture, before the shared branch finish` — `flow/multispec-review-console.md`: `**Before any step below — capture each spec's header fields.**` < `0. **Delete the shared open-items ledger` < `bin/archive-run-header.js` < `2. **Finish the shared branch.**`; and the `execution-and-verification.md` paragraph contains `Skip it under \`MULTISPEC_REVIEW_DEFER=1\``.
  - go-red controls: each frozen excerpt (anchor absent, or the move pasted after the merge text) makes `assertOrder` throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/archive-run-header-ordering.test.js`
Expected: FAIL — `**Archive the spec header (#3976).**` not found.

- [ ] **Step 3: Insert the three paragraphs and apply the three multispec-review-console.md replacements** at the positions above; update the short-circuit push sentence to "push these commits now" covering the ledger and header commits.

- [ ] **Step 4: Run tests to verify they pass, and measure bytes**

Run: `node --test tests/archive-run-header-ordering.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-size-single-source.test.js` and `wc -c plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/wrap-up/execution-and-verification.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/flow/multispec-review-console.md`
Expected: PASS; every file under 52,500 B (record the four byte counts in the task report).

- [ ] **Step 5: Moved-prose pin sweep** — `git grep -n -F -e 'push this commit now' -e 'verify the feature branch reached an outcome' -e "creation line logged, and the bare verb" -e 'reap candidate' -- tests plugin`; every test hit is re-run and still passes.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/wrap-up/execution-and-verification.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/flow/multispec-review-console.md tests/archive-run-header-ordering.test.js
git commit -m "Run the header move before every wrap-up merge path — pr-first push, short-circuit, local-merge finish, multi-spec teardown (refs #3976)"
```

---

### Task 4: Contract text — materialize.md and pipeline-run-dir.md

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/materialize.md` (line 98's "committed as audit trail, never gitignored"; the `## Committed as audit trail, never gitignored` heading and its first paragraph)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (the `**\`work/{n}-spec.md\` is the first of two exceptions**` bullet)
- Test: `tests/run-header-archive-contract-prose.test.js`

**Interfaces:**
- Consumes: the CLI name from Task 2.
- Produces: exact phrases pinned by the test:
  - materialize.md heading: `## Committed during the run, archived on the branch at wrap-up`
  - materialize.md line 98 tail: `committed during the run and archived on the branch at wrap-up, never gitignored.`
  - materialize.md section adds: `` At wrap-up, before the merge, `bin/archive-run-header.js` `git mv`s every tracked file under `work/` and `spec-{N}/work/` to `archive/{run-id}/` in one commit on the run branch (#3976), so the merge lands the header already archived; reconcile's `archiveRunDir` moves it after the merge only for a run merged without that step. `.gitignore` tracks `*-spec.md` only under each `work/`. ``
  - pipeline-run-dir.md bullet replaces "it reaches the main checkout by merge." with: `` it is committed on the feature branch during the run and, at wrap-up before the merge, `git mv`'d to `archive/{run-id}/` on the branch (`bin/archive-run-header.js`, #3976), so it reaches the main checkout already archived. After wrap-up no consumer reads the header from the live path directly: every header read goes through `bin/lib/run-header.js`'s resolver (#3974). ``

- [ ] **Step 1: Write the failing test** — `AC6.1 materialize.md no longer says "as audit trail"` (live text has no `committed as audit trail`; the frozen pre-change heading+line excerpt does), `AC6.2 materialize.md states commit during the run and archive at wrap-up` (both phrases above; frozen excerpt lacks them), `AC6.3 pipeline-run-dir.md's anchoring-exception text matches` (the bullet phrase and the invariant sentence; frozen excerpt lacks them). This file is the AC6.4 prose conformance test pinning both files; each assertion runs through one helper against the live text and, expecting a throw, against the frozen excerpt.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/run-header-archive-contract-prose.test.js`
Expected: FAIL on AC6.1, AC6.2 and AC6.3.

- [ ] **Step 3: Edit both files** with the exact phrases above.

- [ ] **Step 4: Run tests** — Run: `node --test tests/run-header-archive-contract-prose.test.js` and `git grep -l -F -e 'Committed as audit trail' -e 'reaches the main checkout by merge.' -- tests` (re-run each hit) — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/materialize.md plugin/skills/_shared/pipeline-run-dir.md tests/run-header-archive-contract-prose.test.js
git commit -m "State the header contract — committed during the run, archived on the branch at wrap-up (refs #3976)"
```

---

### Task 5: Narrow the `.gitignore` un-ignore to spec headers

**Role:** integration

**Files:**
- Modify: `.gitignore` (lines 13, 17, 34, 38)
- Modify: `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md` (fenced block lines 15, 19, 23, 27; prose line 50's "committed audit trail" and "identical 17-line pattern")
- Test: `tests/gitignore-spec-header-narrowing.test.js`
- Test: `tests/tidy-residue-markers.test.js` (re-run; its `.gitignore` pins keep passing — the new narrowing pins live in the sibling file above, per AC5.3's "or a sibling")
- Test: `tests/init-port-isolation-conformance.test.js` (re-run after the step-04 edit, per the spec's Gotchas)
- Test: `tests/feedback-watermark-prose.test.js` (re-run after the step-04 edit, per the spec's Gotchas)

**Interfaces:**
- Produces: each `!…/work/**` line becomes two lines, `…/work/*` then `!…/work/*-spec.md`, for the four variants: `.claude-tweaks/pipelines/*/work`, `.claude-tweaks/pipelines/*/spec-*/work`, `.claude-tweaks/pipelines/archive/*/work`, `.claude-tweaks/pipelines/archive/*/spec-*/work` (the preceding `!…/work/` directory line stays). Line 50 then reads "a materialized spec header (`{n}-spec.md`) under … is committed — every other file under `work/` stays ignored — never a blanket" and "the identical 21-line pattern".

- [ ] **Step 1: Write the failing test** `tests/gitignore-spec-header-narrowing.test.js`:
  - `AC5.1 .gitignore un-ignores work/*-spec.md and no other file under work/` — `LINES` includes the eight new lines exactly and no line ending `/work/**`.
  - `AC5.2 git check-ignore: work/prompt-audit-probe.txt ignored, work/3056-spec.md not` — temp repo, the repo's `.gitignore` copied in, hermetic env (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` = null device); for each of the four variants (`R/work/`, `R/spec-3056/work/`, `archive/R/work/`, `archive/R/spec-3056/work/`) `git check-ignore -q` exits 0 for `prompt-audit-probe.txt` and 1 for `3056-spec.md`; also `R/work/sub/3056-spec.md` exits 0 (one level deeper stays ignored).
  - `AC5.3 step-04's fenced block carries the identical pipelines lines` — the ordered list of lines starting `.claude-tweaks/pipelines` or `!.claude-tweaks/pipelines` in the step-04 fence, excluding none, equals the same filter over `.gitignore` minus its `*-tidy-standalone*`/`*-sweep-standalone*` lines.
  - go-red control: the same AC5.2 assertion function run against the pre-change `work/**` lines (frozen constant) throws (`prompt-audit-probe.txt` is not ignored there).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gitignore-spec-header-narrowing.test.js`
Expected: FAIL on AC5.1 and AC5.2.

- [ ] **Step 3: Producer scan (Deliverable 5), before the narrowing commit** — run `git grep -n -E "'work'|/work/" -- plugin/bin` and `git grep -n -E "work/[^ \`]*\.(json|log|txt|md)" -- plugin/skills`; confirm the only writer into `work/` is `plugin/bin/materialize.js` (writes `{n}-spec.md`, lines 641-642). Write the output to `$PIPELINE_RUN_DIR/evidence/producer-scan.txt` (plain Bash redirect, after `mkdir -p`) and log one `AC evidence` `AUTO` line via `log-decision.js --text-file` naming the file and the writer count.

- [ ] **Step 4: Edit `.gitignore` and step-04** (Interfaces).

- [ ] **Step 5: Run tests**

Run: `node --test tests/gitignore-spec-header-narrowing.test.js tests/tidy-residue-markers.test.js tests/init-port-isolation-conformance.test.js tests/feedback-watermark-prose.test.js tests/run-header-archive.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add .gitignore plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md tests/gitignore-spec-header-narrowing.test.js
git commit -m "Narrow the work/ un-ignore to *-spec.md — ad hoc agent files stop being committed (refs #3976)"
```

---

## Controller notes (not implementer tasks)

Waived AC8.1: the full suite is Common Step 5's `verify.js` run, not a task step.
- After the final review, add a `### Merge sites` section to the PR body (above the fixes block, session link kept last): the move runs at wrap-up's Branch finish (`execution-and-verification.md`, before Phase exit — also covers leave-open PRs later merged by `wrap-up merge`, and dispatch's single-record second call, whose wrap-up runs it before the dispatch gate merges), the auto-merge short-circuit (both models), Section C's local-merge finish, and a multi-spec run's Shared teardown step 0 (one commit for every spec, both models; per-spec wrap-ups skip it). Sites that keep the `archiveRunDir` fallback: `flow/worktree-merge.md` reconciliation, `release/execute.md` (no header), and any run merged outside wrap-up. Include the producer-scan result and the premise departure (pr-first-merge.md untouched, rail).
- `Proof(...)` lines for spec risk flags, if `plan-audit.js --risk-proofs` names any, are added below this line.
