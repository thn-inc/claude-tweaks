# Pre-review Integration Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before SDD's whole-branch review, `/build` merges any `origin/{integration-branch}` commits that touch files this branch changed, so the review judges the combined tree.

**Architecture:** A self-logging CLI, `plugin/bin/pre-review-catchup.js`, is a thin shell over `plugin/bin/lib/worktree/pre-review-catchup.js`. It fetches, computes the overlap between the branch's and upstream's changed files since the merge base, merges only on overlap, and appends its own `decisions.md` line. `build/dispatch.md`'s SDD invocation instruction runs it before the final whole-branch review. The procedure lives in a new `_shared/pre-review-catchup.md`, which cites and reuses `_shared/worktree-setup.md`'s Post-creation catch-up failure posture. `build/worktree-setup.md` names it beside Step 4.

**Deviation from Key Files (plan-audit composed headroom):** the spec's Key Files has the procedure reused from `_shared/worktree-setup.md`. Its natural home would be a section there. But `build/SKILL.md:181`'s composed `worktree-setup` bundle is already at 51,760 / 52,500 B (plan-audit `composedNearCeiling`), and a ~3 KB section would breach the rail. The procedure is read from `dispatch.md` at review time, not during worktree setup. So it gets its own file outside the bundle — the `_shared/worktree-adopt-freshness.md` precedent, "kept in its own file, outside the composed `worktree-setup` bundle". `_shared/worktree-setup.md` itself is not edited.

Waived plugin/skills/_shared/worktree-setup.md: read and cited by the new `_shared/pre-review-catchup.md`, never edited — composed-bundle headroom (above).

The one bundled addition is `build/worktree-setup.md` step 4's pointer sentence, which must stay ≤ 300 B so the bundle keeps ≥ 440 B of headroom.

**Tech Stack:** Node 18+ CommonJS, zero npm deps, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T060616-spec-4304/work/4304-spec.md` (record #4304)

## Global Constraints

- Code under `plugin/bin/` never uses `realpathSync`/`existsSync` tokens (`tests/path-guard-conformance.test.js`). Every `execFileSync`/`spawnSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`). Run both suites with the focused tests.
- Consumer portability: no literal `main`. The integration branch comes from `--integration-branch` (as in `bin/diff-facts.js`). The remote literal `origin` follows the existing precedent in `_shared/worktree-setup.md`'s Post-creation catch-up (`git fetch origin {integration-branch}`) and `bin/lib/blast-radius-cli.js#preferOriginRef`.
- Run dir writes go through `bin/lib/log-decision/append.js` (`resolveTarget`, `formatEntry`, `appendEntry`), under section `/build` with step `Pre-review catch-up`.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), quoted verbatim:
  - "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error — and pin both the trailing bare flag and the empty-string value with their own test cases."
  - "A CLI whose module already returns a discriminated envelope with a frozen `reason` enum may extend status-as-data to a verb that *acts*: exit 0 on every envelope, 2 on usage only." Its conditions: "(a) The `reason` enum is exported and frozen … (b) A usage error never calls `resolve()`/`run()`, so it never spawns anything … (c) The header states the posture outright."
  - "A CLI whose main work is not a run-dir write can still take `--run` for a best-effort audit line — the anchoring refusal then lands in its envelope, never its exit code."
  - "A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed. … a new self-logging CLI joins it in the same change: `tests/phase-exit-call-sites-conformance.test.js` pins that list equal to its `SELF_LOGGING_SOURCES` map … Report a failed append … as `logged: false` … plus one stderr line naming the `decisions.md` append, never through the exit code."
- Governing skill `shared-contract-extraction`, quoted verbatim: "A new `_shared/*.md` file's `docs/skill-graph.md` edge is mandatory; a `docs/plugin-structure.md` mention is a judgment call, not a given." This plan adds the CLI line to `plugin-structure.md` (CLIs are listed there) and the `_shared` edge to `skill-graph.md`.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #4304`, trailer `Claude-Session: https://claude.ai/code/session_01CcCLFrQqNAPPzfWeWz3DEh`.
- Byte headroom against `RAIL_BYTES` (52,500 B):
  - `build/dispatch.md` is 34,085 B now; the planned +~1.6 KB leaves ~16.8 KB.
  - The new `_shared/pre-review-catchup.md` is ~3 KB.
  - The composed `worktree-setup` bundle (`build/SKILL.md:181`) is at 51,760 B, so `build/worktree-setup.md` may grow by ≤ 300 B.

## Review Focus

1. **The branch has 0 commits of its own beyond the base, or upstream has 0 new commits.** Expect `no-overlap` and a `SCANNED` line, never a merge. Test AC2.1 covers this.
2. **A rename on either side** (the branch renamed a file that upstream edited at its old path). This must count as overlap: use `--no-renames` so both paths appear. Test `overlap counts a rename's old path` in Task 1.
3. **A dirty working tree when the CLI runs.** It must refuse before merging: outcome `dirty-tree`, no merge. A merge onto uncommitted edits would mix them into the merge commit. Test `dirty tree refuses` in Task 1.
4. **The review package's base after a merge.** If the package still diffs against the old base, the reviewer sees upstream's commits as branch work. Task 2's prose says to take `reviewBase` from the CLI's JSON. Task 1 tests that `reviewBase` equals `git merge-base HEAD origin/{ib}` after the merge.
5. **Running from the integration branch itself.** The prose scopes the check to the worktree strategy (the user decided Reading A at plan review). The CLI still guards this case defensively: expect `not-applicable`, no merge, and a `SKIP` line. Test in Task 1.

---

### Task 1: `pre-review-catchup` module and CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/worktree/pre-review-catchup.js`
- Create: `plugin/bin/pre-review-catchup.js`
- Test: `tests/bin-lib/pre-review-catchup/cli.test.js`

**Interfaces:**
- Produces: `bin/pre-review-catchup.js --integration-branch <b> [--run <run-dir>] [--help]`. It prints one JSON line: `{outcome, integrationBranch, before, after, mergeBase, reviewBase, upstreamCommits, branchFileCount, overlapCommits, overlapFiles, conflictFiles, reason, logged, line}`. When `--run` was passed, it also carries `logError` (string, present only when the append was refused or threw).
- Lib exports: `OUTCOMES = Object.freeze(['not-applicable','fetch-failed','windows-longpath','dirty-tree','no-overlap','merged','conflict'])`, `runCatchup({ integrationBranch }, { git }) -> body`, and `formatLine(body) -> { status, text, reversibility }`. The CLI exports `run(argv, overrides) -> exitCode` with seams `{ cwd, mainRoot, git, appendDecision, now, stdout, stderr }`.
- Exit codes: status-as-data. `0` on every `OUTCOMES` value, including `conflict` (the merge is left in progress) and `dirty-tree`. `2` for a malformed invocation, which never spawns git. `1` only for an undecided crash: a git error outside the fetch, or a failed merge with no unmerged paths. An unanchored or missing `--run` changes nothing in the exit code. It yields `logged:false`, a `logError` and one stderr line.

**Algorithm (lib)** — `git` is `(args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], windowsHide: true })`:
1. If `git branch --show-current` (trimmed) equals `integrationBranch`, return `not-applicable`.
2. Run `git fetch origin <b>`. If it throws and its stderr contains `Filename too long`, return `windows-longpath`. That case is a fixable misconfiguration, never the fail-open path (`_shared/worktree-setup.md`). Otherwise return `fetch-failed` with `reason` set to the first non-empty stderr line (≤200 chars). Step 7's merge applies the same `Filename too long` check before its conflict check.
3. If `git status --porcelain --untracked-files=no` is non-empty, return `dirty-tree` with `reason` naming the first dirty path.
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
| merged | AUTO | `worktree branch advanced from {before} to {after} ({upstreamCommits} commit(s) from origin/{b}; {overlapCommits} touching {n} file(s) this branch changed: {files}) — re-run the suite before the whole-branch review` (the existing Post-creation catch-up shape, plus the overlap clause) | `med (merge commit on top of the build's own commits)` |
| windows-longpath | SKIP | `condition: git {fetch\|merge} failed with Filename too long → fallback: none yet; apply _shared/worktree-setup-windows-longpath.md and re-run before the whole-branch review` | `n/a` |
| no-overlap | SCANNED | `origin/{b} has {upstreamCommits} commit(s) since merge base {mergeBase}, none touching the {branchFileCount} file(s) this branch changed — no merge` | `n/a` |
| conflict | SCANNED | `merging origin/{b} ({overlapCommits} overlapping commit(s)) conflicted on {files} — merge left in progress; resolve it before the whole-branch review` | `n/a` |
| fetch-failed | SKIP | `condition: git fetch origin {b} failed ({reason}) → fallback: no pre-review catch-up; the whole-branch review runs on the unchecked tree` | `n/a` |
| not-applicable | SKIP | `condition: build branch is the integration branch {b} → fallback: nothing to catch up` | `n/a` |
| dirty-tree | SKIP | `condition: uncommitted changes ({reason}) → fallback: no merge yet; commit them and re-run before the whole-branch review` | `n/a` |

The CLI always sets `line` to the formatted entry. With `--run`, it resolves the target with `resolveTarget` and appends under `/build`, setting `logged:true`. If the target is refused or the append throws, it writes one stderr line, `pre-review-catchup.js: could not append the decisions.md entry: {message}` (the phrase `_shared/auto-decision-log.md`'s roster paragraph names), sets `logged:false` and `logError`, and leaves the exit code unchanged. Without `--run`, it logs nothing and sets `logged:false`; the caller reports `line` per `_shared/worktree-catchup-no-run-dir.md`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pre-review-catchup/cli.test.js`.
  - Fixtures: `originWithTwoClones` from `tests/helpers/git-fixtures.js`. `work` checks out branch `feat` off `main`; `other` pushes upstream commits to `main`. Pass `cwd: () => work` and a `git` seam bound to `work` with the fixture `env`. For `--run`, create `<root>/.claude-tweaks/pipelines/r1/decisions.md` and pass `mainRoot: root`.
  - `AC1.1: overlapping upstream commit is merged before review` — `feat` edits `a.txt`, `other` edits `a.txt` (non-conflicting line) and pushes. Assert: `outcome === 'merged'`, exit 0, `git merge-base --is-ancestor origin/main HEAD` succeeds, `overlapFiles` deep-equals `['a.txt']`, `overlapCommits === 1`.
  - `AC1.2: the merged tree is what the review sees (reviewBase)` — same setup. Assert that `reviewBase` equals `rev-parse origin/main` after the merge and that `git diff --name-only <reviewBase> HEAD` lists only `feat`'s own files.
  - `AC2.1: no overlap runs no merge and logs the check` — `other` edits `b.txt` only. Assert: `outcome === 'no-overlap'`, HEAD unchanged, `decisions.md` contains `SCANNED`, `Pre-review catch-up:` and `none touching the 1 file(s)`.
  - `AC2.1: zero upstream commits is still a logged no-overlap` — assert `upstreamCommits === 0` and that the `SCANNED` line was written.
  - `AC3.1: conflicting catch-up stops with the merge in progress` — the two sides make conflicting edits to the same line of `a.txt`. Assert: exit 0, `outcome === 'conflict'`, `conflictFiles` deep-equals `['a.txt']`, `MERGE_HEAD` resolves (`git rev-parse -q --verify MERGE_HEAD` exit 0), and `reviewBase === null`.
  - `fetch failure fails open with a distinct SKIP line` — `git remote set-url origin <root>/missing.git`. Assert: exit 0, `outcome === 'fetch-failed'`, the line contains `SKIP` and `git fetch origin main failed`.
  - `not-applicable on the integration branch itself` — run in `work` on `main`. Assert the `SKIP` line contains `build branch is the integration branch main`.
  - `overlap counts a rename's old path` — `feat` runs `git mv a.txt c.txt`; `other` edits `a.txt`. Assert `outcome` is `merged` or `conflict`, never `no-overlap`.
  - `Filename too long is windows-longpath, not fetch-failed` — a `git` seam whose fetch throws with stderr `error: unable to create file x: Filename too long`. Assert `outcome === 'windows-longpath'` and that the `SKIP` line does not contain `fallback: no pre-review catch-up`. A second case makes the merge throw the same way, and expects the same outcome.
  - `dirty tree refuses` — an uncommitted edit to `a.txt`, with an overlapping upstream commit pushed. Assert: exit 0, `outcome === 'dirty-tree'`, HEAD unchanged, no `MERGE_HEAD`.
  - `no --run: line is returned, nothing logged` — assert `logged === false` and that `line` starts with `SCANNED`.
  - `unanchored --run keeps the outcome and reports logError` — `--run` names a worktree-local shadow dir. Assert: exit 0, the merge outcome is unchanged, `logged === false`, `logError` is set, and the shadow's `decisions.md` is byte-unchanged.
  - Usage, each exit 2 and asserting via the `git` seam that no git call ran: `--integration-branch` missing; trailing bare `--integration-branch`; `--integration-branch ''`; trailing bare `--run`; an unknown flag.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/pre-review-catchup/cli.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/pre-review-catchup.js'`.

- [ ] **Step 3: Implement the lib and the CLI shell.** Model the shell on `plugin/bin/pr-merge-state.js`: `parseArgs`, a `USAGE` that lists `OUTCOMES.join(' | ')`, a `report()` that prints JSON, a `realDeps` object, and `if (require.main === module) process.exitCode = run(...)`. Add a header comment that states the exit codes and the outcomes.

- [ ] **Step 4: Run the tests to verify they pass**
  - Run: `node --test tests/bin-lib/pre-review-catchup/cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
  - Expected: all pass.

- [ ] **Step 5: Commit** both new files and the test with `Add pre-review-catchup CLI — merge overlapping integration-branch commits before the whole-branch review`.

### Task 2: Wire the catch-up into `/build`'s prose and registries

**Role:** integration

**Files:**
- Create: `plugin/skills/_shared/pre-review-catchup.md` (the procedure; outside the composed bundle)
- Modify: `plugin/skills/build/worktree-setup.md` (Procedure step 4 at line 149 gets one sentence of ≤ 300 B)
- Modify: `plugin/skills/build/dispatch.md` (line 19: a new bold-labelled instruction, inserted immediately before `After the final code review completes — or, on the skip path, after the last task review — **stop the skill and return here**`)
- Modify: `docs/plugin-structure.md` (a CLI line after the `pr-merge-state.js` line at line 201)
- Modify: `plugin/skills/_shared/auto-decision-log.md` (in the "CLIs that log their own entries" paragraph, after `#4025's ... append the same way.` and before `A skill never re-logs`, add the sentence ``#4304's `pre-review-catchup.js` appends the same way.``, which keeps it inside the test's `#4026 moved these ones there: (.*?)\. A skill never re-logs` capture)
- Modify: `tests/phase-exit-call-sites-conformance.test.js` (add `'pre-review-catchup.js': ['plugin/bin/pre-review-catchup.js']` to `SELF_LOGGING_SOURCES`)
- Modify: `docs/skill-graph.md` (after the `bin/lib/worktree/name.js` row at line 119, add a `_shared/pre-review-catchup.md` row and a `bin/pre-review-catchup.js` row to `/build`'s table)
- Test: `tests/pre-review-catchup-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI flags, `OUTCOMES`, exit codes, and the `reviewBase` field.

**Prose content** — the dispatcher voice, addressed to `/superpowers:subagent-driven-development` like its siblings in `dispatch.md`:
- `dispatch.md`, `**Pre-review catch-up (#4304; `_shared/pre-review-catchup.md`).**` In the same invocation instruction, direct `/superpowers:subagent-driven-development` to do the following:
  - **Scope (plan review, decided by the user, Reading A):** worktree strategy only. A `current-branch` build runs no CLI and logs `SKIP {time} — Pre-review catch-up: condition: current-branch strategy → fallback: no pre-review catch-up (worktree strategy only)`, the same scope as the post-creation catch-up. A `MULTISPEC_PARALLEL_WAVE=1` member also runs no CLI and logs `SKIP … — condition: parallel-wave member (MULTISPEC_PARALLEL_WAVE=1) → fallback: the wave orchestrator merges member branches into the shared branch, whose own whole-branch review runs the catch-up`. A sequential multi-spec run in the shared worktree runs it per spec, as normal.
  - Before it builds its final whole-branch review package, run `node "${CLAUDE_PLUGIN_ROOT}/bin/pre-review-catchup.js" --integration-branch {integration-branch} --run "$PIPELINE_RUN_DIR"` from the worktree root. Resolve `{integration-branch}` at this call site through `_shared/integration-branch.md`'s canonical ladder. Never carry it from Common Step 1: a resumed build or a context-handoff continuation never ran that step in this session. Omit `--run` for a standalone `/build`. On the single-task fast-lane skip path, run it after the last task review instead, before returning here.
  - Then route on `outcome`. The controller never fixes code itself (SDD's own rule), so every repair below is one implementer dispatch at the plan's implementer tier. That dispatch gets the failing output or the conflicted files, the merge's two sides (`{before}` and `origin/{integration-branch}`), and the instruction to resolve per `_shared/git-discipline.md`'s Merge conflict resolution and commit.
    - `merged` → re-run the full suite on the merged tree. On a failure, send the failing output through that one fix dispatch and re-run the suite. Then build the review package with `reviewBase` from the CLI's JSON as its base commit, so the reviewer judges the branch's own diff against the combined tree.
    - `conflict` → stop. Send the `conflictFiles` through that one dispatch. After its commit, log `AUTO … — Pre-review catch-up: conflict on {files} resolved in {sha}` via `log-decision.js`, re-run the full suite, and only then build the package with base `git merge-base HEAD origin/{integration-branch}`. Never review the pre-merge tree, and never `git merge --abort` to get past the conflict.
    - If the fix dispatch does not leave a committed, green tree, stop SDD before the review with the merge state intact and return here. `/build` then fails the HARD-GATE: the test failure, or for a conflict, the unresolved merge, surfaced to the human with its files.
    - `windows-longpath` → not the fail-open path. Follow `_shared/worktree-setup-windows-longpath.md` (the `core.longpaths` fix), then re-run the CLI.
    - `no-overlap`, `not-applicable` or `fetch-failed` → proceed unchanged. The CLI already logged its line, and `fetch-failed` is the fail-open path.
    - `dirty-tree` → commit the named changes and re-run the CLI. A non-zero exit → read stderr, fix the cause, and re-run. Never skip the check.
  - The CLI logs its own line, so the controller adds none beyond the conflict-resolution line. Hand-log `line` with `log-decision.js` only when `logged` is `false` under a run dir. With no run dir, report `line` in the build's output.
- `_shared/pre-review-catchup.md`, titled `# Pre-review Catch-up`. The intro says when it runs (that dispatch instruction, cited by name) and why it is overlap-gated rather than unconditional: a merge commit and a suite re-run happen only when upstream touched this branch's files, citing the #4149 evidence. Then add:
  - `## Scope`: worktree strategy only (current-branch builds and parallel-wave members `SKIP`, as above). The integration branch is resolved at the call site through `_shared/integration-branch.md`'s canonical ladder, the same full ladder `_shared/worktree-setup.md`'s Post-creation catch-up uses, and never carried from Common Step 1.
  - `## Outcomes`: the CLI, each `OUTCOMES` value as a backticked token, and its posture, reusing the Post-creation catch-up's language:
    - a conflict stops for resolution per `_shared/git-discipline.md`, never reset or discarded;
    - a fetch failure fails open with its own `SKIP` line, distinct from `no-overlap`'s `SCANNED` line;
    - Windows `Filename too long` is the separate `windows-longpath` outcome, not a fetch failure. It is handled per `_shared/worktree-setup-windows-longpath.md` and never fails open;
    - a repair (suite failure or conflict) is one implementer dispatch, never a controller-side fix. A repair that does not leave a committed green tree is a HARD-GATE stop with the merge state intact.
  - `## Anti-patterns` table:
    - `Running the pre-review catch-up only when the PR shows DIRTY` | `DIRTY surfaces at merge, after the review judged a stale tree — the #4149 cost this check exists to avoid`
    - `Building the review package on the pre-merge base after a merge` | `the reviewer then reads upstream's commits as branch work`
- `build/worktree-setup.md` step 4: one closing sentence of ≤ 300 B: `Before the whole-branch review, an overlap-gated pre-review catch-up runs again (\`_shared/pre-review-catchup.md\`, \`dispatch.md\`).`

- [ ] **Step 1: Write the failing conformance test** `tests/pre-review-catchup-conformance.test.js`, using `readText` from `tests/helpers/read-skill.js`.
  - `AC1.1: dispatch.md runs the catch-up before the whole-branch review` — assert that the index of `bin/pre-review-catchup.js` is greater than the index of `Single-task fast-lane skip (#1926` and less than the index of `After the final code review completes — or, on the skip path`.
  - `AC1.2: the review package base comes from reviewBase` — `dispatch.md` contains `reviewBase`.
  - `scope: worktree only, current-branch and wave members SKIP` — `dispatch.md` contains `current-branch strategy → fallback: no pre-review catch-up` and `MULTISPEC_PARALLEL_WAVE=1`. The sentence that names `bin/pre-review-catchup.js` contains no `value Common Step 1 resolved`.
  - `AC3.1: a conflict stops before review` — `dispatch.md` contains `` `conflict` → stop `` and `Never review the pre-merge tree`. The CLI shell's source requires `log-decision/append` and calls `formatEntry(`, which the roster test checks.
  - `shared file and naming` — `_shared/pre-review-catchup.md` exists with an `## Outcomes` heading, and `build/worktree-setup.md`'s step-4 paragraph (the line starting `4. **Catch up with the integration branch**`) contains `_shared/pre-review-catchup.md`.
  - `every outcome is documented` — for each `OUTCOMES` value from `plugin/bin/lib/worktree/pre-review-catchup.js`, `_shared/pre-review-catchup.md`'s `## Outcomes` section contains it as a backticked token, and the `docs/plugin-structure.md` CLI line contains it.
  - Go-red control: run the test once with the `bin/pre-review-catchup.js` sentence absent (before Step 3), and confirm the AC1.1 assertion fails on the index comparison, not on a read error.

- [ ] **Step 2: Run it and verify that it fails**

Run: `node --test tests/pre-review-catchup-conformance.test.js`
Expected: FAIL (`bin/pre-review-catchup.js` not found in `dispatch.md`).

- [ ] **Step 3: Make the prose edits above, then run every suite that reads these files.** The suites below must pass. Also grep `tests/` for any suite that enumerates `_shared/*.md` files or skill-graph rows (`git grep -ln "_shared'" -- tests`), and run those too.

```bash
node --test tests/build-worktree-setup-dispatch-stamp.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/skill-graph-table-structure.test.js tests/integration-branch-conformance.test.js tests/phase-exit-call-sites-conformance.test.js
```

- [ ] **Step 4: Run the new test and the composed-bundle headroom check**

```bash
node --test tests/pre-review-catchup-conformance.test.js
```

Expected: PASS. Then run `node plugin/bin/plan-audit.js docs/superpowers/plans/2026-10-28-pre-review-integration-catch-up.md --repo-root . --bytes`. Expected: `headroom.breaches` is empty and the composed `worktree-setup` max is ≤ 52,500.

- [ ] **Step 5: Commit** with `Name the pre-review catch-up in /build — run pre-review-catchup.js before the whole-branch review`.
