# Pre-review Integration Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before SDD's whole-branch review, `/build` merges any `origin/{integration-branch}` commits that touch files this branch changed, so the review judges the combined tree.

**Architecture:** A self-logging CLI, `plugin/bin/pre-review-catchup.js`, is a thin shell over `plugin/bin/lib/worktree/pre-review-catchup.js`. It fetches, computes the overlap between the branch's and upstream's changed files since the merge base, merges only on overlap, and appends its own `decisions.md` line. `build/dispatch.md`'s SDD invocation instruction runs it before the final whole-branch review. `_shared/worktree-setup.md` gains a `## Pre-review catch-up` section that reuses the Post-creation catch-up's failure posture, and `build/worktree-setup.md` names it beside Step 4.

**Tech Stack:** Node 18+ CommonJS, zero npm deps, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T060616-spec-4304/work/4304-spec.md` (record #4304)

## Global Constraints

- Code under `plugin/bin/` never uses `realpathSync`/`existsSync` tokens (`tests/path-guard-conformance.test.js`). Every `execFileSync`/`spawnSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`). Run both suites with the focused tests.
- Consumer portability: no literal `main`. The integration branch comes from `--integration-branch` (as in `bin/diff-facts.js`). The remote literal `origin` follows the existing precedent in `_shared/worktree-setup.md`'s Post-creation catch-up (`git fetch origin {integration-branch}`) and `bin/lib/blast-radius-cli.js#preferOriginRef`.
- Run dir writes go through `bin/lib/log-decision/append.js` (`resolveTarget`, `formatEntry`, `appendEntry`), under section `/build` with step `Pre-review catch-up`. An unanchored `--run` exits 3, as in `bin/pr-merge-state.js`.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #4304`, trailer `Claude-Session: https://claude.ai/code/session_01CcCLFrQqNAPPzfWeWz3DEh`.
- Byte headroom against `RAIL_BYTES` (52,500 B):
  - `build/dispatch.md` is 34,085 B now; the planned +~1.6 KB leaves ~16.8 KB.
  - `_shared/worktree-setup.md` is 25,546 B; +~3 KB leaves ~24 KB.
  - `build/worktree-setup.md` is 26,075 B; +~0.4 KB.

## Review Focus

1. **The branch has 0 commits of its own beyond the base, or upstream has 0 new commits.** Expect `no-overlap` and a `SCANNED` line, never a merge. Test AC2.1 covers this.
2. **A rename on either side** (the branch renamed a file that upstream edited at its old path). This must count as overlap: use `--no-renames` so both paths appear. Test `overlap counts a rename's old path` in Task 1.
3. **A dirty working tree when the CLI runs.** It must refuse before merging: exit 1 with a stderr line, no merge. A merge onto uncommitted edits would mix them into the merge commit. Test `dirty tree refuses` in Task 1.
4. **The review package's base after a merge.** If the package still diffs against the old base, the reviewer sees upstream's commits as branch work. Task 2's prose says to take `reviewBase` from the CLI's JSON. Task 1 tests that `reviewBase` equals `git merge-base HEAD origin/{ib}` after the merge.
5. **Running from the integration branch itself** (`current-branch` mode on `{ib}`). Expect `not-applicable`, no fetch-dependent merge, and a `SKIP` line. Test in Task 1.

---

### Task 1: `pre-review-catchup` module and CLI

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/worktree/pre-review-catchup.js`
- Create: `plugin/bin/pre-review-catchup.js`
- Test: `tests/bin-lib/pre-review-catchup/cli.test.js`

**Interfaces:**
- Produces: `bin/pre-review-catchup.js --integration-branch <b> [--run <run-dir>] [--help]`. It prints one JSON line: `{outcome, integrationBranch, before, after, mergeBase, reviewBase, upstreamCommits, overlapCommits, overlapFiles, conflictFiles, reason, logged, line}`.
- Lib exports: `OUTCOMES = Object.freeze(['not-applicable','fetch-failed','no-overlap','merged','conflict'])`, `runCatchup({ integrationBranch, cwd }, { git }) -> body`, and `formatLine(body) -> { status, text, reversibility }`. The CLI exports `run(argv, overrides) -> exitCode` with seams `{ cwd, mainRoot, git, appendDecision, now, stdout, stderr }`.
- Exit codes: `0` for not-applicable, fetch-failed, no-overlap and merged; `4` for conflict (the merge is left in progress); `2` for a malformed invocation; `3` when the run dir is missing or unanchored; `1` for a dirty tree or a git error other than the fetch.

**Algorithm (lib)** — `git` is `(args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], windowsHide: true })`:
1. If `git branch --show-current` (trimmed) equals `integrationBranch`, return `not-applicable`.
2. Run `git fetch origin <b>`. If it throws, return `fetch-failed` with `reason` set to the first non-empty stderr line (≤200 chars).
3. If `git status --porcelain --untracked-files=no` is non-empty, throw a `DirtyTreeError`.
4. Set:
   - `before = rev-parse HEAD`
   - `mergeBase = merge-base HEAD origin/<b>`
   - `upstreamCommits = rev-list --count <mergeBase>..origin/<b>`
   - branch files: `diff --name-only -z --no-renames <mergeBase> HEAD`
   - upstream files: `diff --name-only -z --no-renames <mergeBase> origin/<b>`
   - `overlapFiles` = the sorted intersection of the two file lists
5. If `overlapFiles` is empty, return `no-overlap` with `reviewBase = mergeBase`.
6. Set `overlapCommits = rev-list --count <mergeBase>..origin/<b> -- ...overlapFiles`.
7. Run `git merge --no-edit origin/<b>`. On success, return `merged` with `after = rev-parse HEAD` and `reviewBase = merge-base HEAD origin/<b>`. If it throws and `diff --name-only -z --diff-filter=U` is non-empty, return `conflict` with those `conflictFiles`. Otherwise rethrow.

**Log lines** (`formatLine`; files are listed up to 5, then `, …`; shas are 9 chars):

| outcome | status | text | reversibility |
|---|---|---|---|
| merged | AUTO | `worktree branch advanced from {before} to {after} ({overlapCommits} overlapping commit(s) from origin/{b} on {n} file(s) this branch changed: {files}) — re-run the suite before the whole-branch review` | `med (merge commit on top of the build's own commits)` |
| no-overlap | SCANNED | `origin/{b} has {upstreamCommits} commit(s) since merge base {mergeBase}, none touching the {branchFileCount} file(s) this branch changed — no merge` | `n/a` |
| conflict | SCANNED | `merging origin/{b} ({overlapCommits} overlapping commit(s)) conflicted on {files} — merge left in progress; resolve it before the whole-branch review` | `n/a` |
| fetch-failed | SKIP | `condition: git fetch origin {b} failed ({reason}) → fallback: no pre-review catch-up; the whole-branch review runs on the unchecked tree` | `n/a` |
| not-applicable | SKIP | `condition: build branch is the integration branch {b} → fallback: nothing to catch up` | `n/a` |

The CLI always sets `line` to the formatted entry. With `--run`, it appends under `/build` and sets `logged:true`. If the append throws, it writes one stderr line and sets `logged:false`; the exit code does not change. Without `--run`, it logs nothing and sets `logged:false`; the caller reports `line` per `_shared/worktree-catchup-no-run-dir.md`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pre-review-catchup/cli.test.js`.
  - Fixtures: `originWithTwoClones` from `tests/helpers/git-fixtures.js`. `work` checks out branch `feat` off `main`; `other` pushes upstream commits to `main`. Pass `cwd: () => work` and a `git` seam bound to `work` with the fixture `env`. For `--run`, create `<root>/.claude-tweaks/pipelines/r1/decisions.md` and pass `mainRoot: root`.
  - `AC1.1: overlapping upstream commit is merged before review` — `feat` edits `a.txt`, `other` edits `a.txt` (non-conflicting line) and pushes. Assert: `outcome === 'merged'`, exit 0, `git merge-base --is-ancestor origin/main HEAD` succeeds, `overlapFiles` deep-equals `['a.txt']`, `overlapCommits === 1`.
  - `AC1.2: the merged tree is what the review sees (reviewBase)` — same setup. Assert that `reviewBase` equals `rev-parse origin/main` after the merge and that `git diff --name-only <reviewBase> HEAD` lists only `feat`'s own files.
  - `AC2.1: no overlap runs no merge and logs the check` — `other` edits `b.txt` only. Assert: `outcome === 'no-overlap'`, HEAD unchanged, `decisions.md` contains `SCANNED`, `Pre-review catch-up:` and `none touching the 1 file(s)`.
  - `AC2.1: zero upstream commits is still a logged no-overlap` — assert `upstreamCommits === 0` and that the `SCANNED` line was written.
  - `AC3.1: conflicting catch-up stops with the merge in progress` — the two sides make conflicting edits to the same line of `a.txt`. Assert: exit 4, `outcome === 'conflict'`, `conflictFiles` deep-equals `['a.txt']`, `MERGE_HEAD` resolves (`git rev-parse -q --verify MERGE_HEAD` exit 0).
  - `fetch failure fails open with a distinct SKIP line` — `git remote set-url origin <root>/missing.git`. Assert: exit 0, `outcome === 'fetch-failed'`, the line contains `SKIP` and `git fetch origin main failed`.
  - `not-applicable on the integration branch itself` — run in `work` on `main`. Assert the `SKIP` line contains `build branch is the integration branch main`.
  - `overlap counts a rename's old path` — `feat` runs `git mv a.txt c.txt`; `other` edits `a.txt`. Assert `outcome` is `merged` or `conflict`, never `no-overlap`.
  - `dirty tree refuses` — an uncommitted edit to `a.txt`. Assert: exit 1, stderr names uncommitted changes, HEAD unchanged.
  - `no --run: line is returned, nothing logged` — assert `logged === false` and that `line` starts with `SCANNED`.
  - Usage: `--integration-branch` missing → exit 2. `--run` pointing at a dir outside `mainRoot` → exit 3.

- [ ] **Step 2: Run the tests to verify they fail**
  - Run: `node --test tests/bin-lib/pre-review-catchup/cli.test.js`
  - Expected: FAIL with `Cannot find module '../../../plugin/bin/pre-review-catchup.js'`.

- [ ] **Step 3: Implement the lib and the CLI shell.** Model the shell on `plugin/bin/pr-merge-state.js`: `parseArgs`, a `USAGE` that lists `OUTCOMES.join(' | ')`, a `report()` that prints JSON, a `realDeps` object, and `if (require.main === module) process.exitCode = run(...)`. Add a header comment that states the exit codes and the outcomes.

- [ ] **Step 4: Run the tests to verify they pass**
  - Run: `node --test tests/bin-lib/pre-review-catchup/cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
  - Expected: all pass.

- [ ] **Step 5: Commit** both new files and the test with `Add pre-review-catchup CLI — merge overlapping integration-branch commits before the whole-branch review`.

### Task 2: Wire the catch-up into `/build`'s prose and registries

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/worktree-setup.md` (line 3 intro, the `## Resolving {integration-branch}` section at lines 12–27, a new `## Pre-review catch-up` section between Post-creation catch-up, which ends at line 258, and `## Pre-flight divergence check`, and one Anti-patterns row)
- Modify: `plugin/skills/build/worktree-setup.md` (Procedure step 4 at line 149 gets one sentence)
- Modify: `plugin/skills/build/dispatch.md` (line 19: a new bold-labelled instruction, inserted immediately before `After the final code review completes — or, on the skip path, after the last task review — **stop the skill and return here**`)
- Modify: `docs/plugin-structure.md` (a CLI line after the `pr-merge-state.js` line at line 201)
- Modify: `docs/skill-graph.md` (a `bin/pre-review-catchup.js` row after the `bin/lib/worktree/name.js` row at line 119; line 120's section list gains "Pre-review catch-up")
- Test: `tests/pre-review-catchup-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI flags, `OUTCOMES`, exit codes, and the `reviewBase` field.

**Prose content** — the dispatcher voice, addressed to `/superpowers:subagent-driven-development` like its siblings in `dispatch.md`:
- `dispatch.md`, `**Pre-review catch-up (#4304; `_shared/worktree-setup.md`).**` In the same invocation instruction, direct `/superpowers:subagent-driven-development` to do the following:
  - Before it builds its final whole-branch review package, run `node "${CLAUDE_PLUGIN_ROOT}/bin/pre-review-catchup.js" --integration-branch {integration-branch} --run "$PIPELINE_RUN_DIR"` from the worktree root. `{integration-branch}` is the value Common Step 1 resolved. Omit `--run` for a standalone `/build`. On the single-task fast-lane skip path, run it after the last task review instead, before returning here.
  - Then route on `outcome`:
    - `merged` → re-run the full suite on the merged tree, and fix any failure before review. Build the review package with `reviewBase` from the CLI's JSON as its base commit, so the reviewer judges the branch's own diff against the combined tree.
    - `conflict` (exit 4) → stop. Resolve the in-progress merge per `_shared/git-discipline.md`'s Merge conflict resolution, then commit. Log `AUTO … — Pre-review catch-up: conflict on {files} resolved in {sha}` via `log-decision.js`, re-run the full suite, and only then build the package with base `git merge-base HEAD origin/{integration-branch}`. Never review the pre-merge tree, and never `git merge --abort` to get past the conflict.
    - `no-overlap`, `not-applicable` or `fetch-failed` → proceed unchanged. The CLI already logged its line, and `fetch-failed` is the fail-open path.
    - Exit 1 (dirty tree, git error) → commit or resolve the named state and re-run the CLI. Never skip it.
  - The CLI logs its own line, so the controller adds none beyond the conflict-resolution line. With no run dir, report `line` in the build's output.
- `_shared/worktree-setup.md` `## Pre-review catch-up`: say when it runs (that dispatch instruction, cited by name), and why it is overlap-gated rather than unconditional (a merge commit and a suite re-run only when upstream touched this branch's files). Name the CLI, its outcomes, and each outcome's posture, reusing the Post-creation catch-up's language:
  - a conflict stops for resolution per `_shared/git-discipline.md`, never reset or discarded;
  - a fetch failure fails open with its own `SKIP` line, distinct from `no-overlap`'s `SCANNED` line;
  - the Windows `Filename too long` exception points to the same `_shared/worktree-setup-windows-longpath.md`.

  Also make these edits:
  - Intro line 3: "three" → "four", naming the pre-review catch-up.
  - The Resolving section: one sentence saying the pre-review catch-up reuses the value Post-creation catch-up's full ladder resolved.
  - Anti-patterns row: `Running the pre-review catch-up only when the PR shows DIRTY` | `DIRTY surfaces at merge, after the review judged a stale tree — the #4149 cost this check exists to avoid`.
- `build/worktree-setup.md` step 4: one closing sentence saying the same catch-up runs again, overlap-gated, before the whole-branch review (`dispatch.md`'s Pre-review catch-up instruction, `_shared/worktree-setup.md`'s `## Pre-review catch-up`).

- [ ] **Step 1: Write the failing conformance test** `tests/pre-review-catchup-conformance.test.js`, using `readText` from `tests/helpers/read-skill.js`.
  - `AC1.1: dispatch.md runs the catch-up before the whole-branch review` — assert that the index of `bin/pre-review-catchup.js` is greater than the index of `Single-task fast-lane skip (#1926` and less than the index of `After the final code review completes — or, on the skip path`.
  - `AC1.2: the review package base comes from reviewBase` — `dispatch.md` contains `reviewBase`.
  - `AC3.1: a conflict stops before review` — `dispatch.md` contains `exit 4` and `Never review the pre-merge tree`.
  - `shared section and naming` — `_shared/worktree-setup.md` has a `## Pre-review catch-up` heading, and `build/worktree-setup.md`'s step-4 paragraph contains `## Pre-review catch-up`.
  - `every outcome is documented` — for each `OUTCOMES` value from `plugin/bin/lib/worktree/pre-review-catchup.js`, `_shared/worktree-setup.md`'s new section contains it as a backticked token, and the `docs/plugin-structure.md` CLI line contains it.
  - Go-red control: run the test once with the `bin/pre-review-catchup.js` sentence absent (before Step 3), and confirm the AC1.1 assertion fails on the index comparison, not on a read error.

- [ ] **Step 2: Run it and verify that it fails**
  - Run: `node --test tests/pre-review-catchup-conformance.test.js`
  - Expected: FAIL (`bin/pre-review-catchup.js` not found in `dispatch.md`).

- [ ] **Step 3: Make the prose edits above.** Then check what else pins this prose:
  - Run `git grep -n -F 'three staleness-protection' -- tests plugin docs`. Expected: only the line just edited, which is now "four".
  - Run every suite that reads these files: `node --test tests/worktree-adopt-or-create-consolidation.test.js tests/integration-branch-conformance.test.js tests/build-worktree-setup-dispatch-stamp.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/skill-graph-table-structure.test.js`. Expected: pass.

- [ ] **Step 4: Run the new test and the byte check**
  - Run: `node --test tests/pre-review-catchup-conformance.test.js`. Expected: PASS.
  - Run: `wc -c plugin/skills/build/dispatch.md plugin/skills/_shared/worktree-setup.md plugin/skills/build/worktree-setup.md`. Expected: each file under 52,500.

- [ ] **Step 5: Commit** with `Name the pre-review catch-up in /build — run pre-review-catchup.js before the whole-branch review`.
