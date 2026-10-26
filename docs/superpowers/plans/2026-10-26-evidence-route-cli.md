# Evidence-Route CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `verification-brief.md` Step 4's screenshot-route decision (current branch vs evidence PR) out of agent-executed prose and into a pure, unit-tested module behind a CLI. Step 4 then calls the CLI and routes on its JSON.

**Architecture:** `plugin/bin/lib/wrap-up/evidence-route.js` holds two pure functions: `decideEvidenceRoute(inputs)` (the guard and per-state route rules) and `branchReadState(result)` (maps a `resolvePrState` result onto the state vocabulary). `plugin/bin/evidence-route.js` is a `run(argv, deps)` CLI that gathers the inputs: git current branch and toplevel, `run-state.json`'s `worktree`, `bin/pr-merge-state.js` run in-process (the same seam `lib/phase-exit/phase-exit.js` uses), the `resolvePrState` branch fallback, the integration branch and `console.json`'s `merge.resolution`. It then prints one JSON line. Step 4 keeps only the per-route commands.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T094237-record-4125/work/4125-spec.md` (record #4125)

Scope keywords: evidence-PR route, current-branch route

Premise-refs: plugin/bin/pr-merge-state.js
Premise-refs: plugin/bin/lib/reconcile/pr-state.js
Premise-refs: plugin/bin/lib/phase-exit/phase-exit.js
Premise-refs: plugin/bin/lib/wrap-up/engine-verify.js
Premise-refs: plugin/bin/lib/hooks/worktree-reap.js

## Global Constraints

- CLI: `plugin/bin/evidence-route.js --run {run-dir}` (run dir optional). It prints one JSON line: `{route: "current-branch"|"evidence-pr", branch, state, reason}`, where `reason` names which guard or state decided it.
- Logic lives in `plugin/bin/lib/wrap-up/evidence-route.js` as a pure function over the gathered inputs, so every rule is unit-testable without git or gh.
- The branch-name rule is the exact regex `^[A-Za-z0-9._/-]+$`.
- Worktree match: an exact toplevel match after dropping a trailing `/`.
- The commands each route runs (commit, push, scratch worktree, PR create, teardown, failure handling) stay in Step 4.
- Tests: `tests/bin-lib/wrap-up/evidence-route.test.js` (new), plus `tests/verification-brief-evidence-routing.test.js` (narrowed).
- CLI wrapper contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`):
  - `run(argv, deps)` with every side effect behind `deps`.
  - `require.main === module` sets `process.exitCode`.
  - `--help` short-circuits.
  - Every `child_process` call passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
  - No bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`): use `lib/path-guard`'s `canonicalRealpath`.
- Exit vocabulary follows `pr-merge-state.js`'s status-as-data posture: exit 0 in every route/state, 2 malformed invocation, 3 `--run` missing or not anchored under the main checkout. A read-only reader still owes the anchoring guard, through `lib/log-decision/append.js`'s `resolveTarget` (the one `pr-merge-state.js` uses).
- Hand-written commits: `{Verb} {what} — {detail}`, referencing `refs #4125` (never `closes`/`fixes`), ending with the `Claude-Session:` trailer.

## Review Focus

1. **A `--run` naming an archived run dir** (`.claude-tweaks/pipelines/archive/{run-id}/`) must still read `run-state.json`'s `worktree` and `pr`, because Step 4 runs after cleanup item 8. Pinned in Task 2 (`archived run dir is read like a live one`).
2. **The recorded worktree path vs `git rev-parse --show-toplevel`** differ in spelling (symlinked tmp, Windows forward slashes, case). The pure rule stays exact (AC1.1). The CLI canonicalizes both sides through `canonicalRealpath` before comparing, falling back to the raw value. Pinned in Task 2 (`worktree compare canonicalizes both sides`).
3. **`pr-merge-state.js` returns `pr-not-found`, an unparseable line, a non-zero exit, or throws.** Each must read as `read-failed`, never as open or `no-pr`. Pinned in Task 2 (`pr-merge-state failure shapes read as read-failed`).
4. **A multi-spec parent run dir** has a `console.json` that always says `leave-open` (members-unresolved). It must not open the unreadable-state current-branch route. Reusing `engine-verify.js`'s `consoleMergeResolution` (which returns null when `manifest.yml` is present) handles this. Pinned in Task 2 (`multi-spec parent console is not a leave-open signal`).
5. **The integration branch cannot be resolved** (no policy, no `origin/HEAD`). The guard cannot prove the session is off it, so it fails closed to `evidence-pr`. Pinned in Task 1 (`unresolved integration branch fails closed`).

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 tests `AC1.1: …` (one per guard) |
| AC2.1 | Task 1 tests `AC2.1: …` |
| AC2.2 | Task 1 test `AC2.2: …` |
| AC3.1 | Task 1 tests `AC3.1: …` |
| AC3.2 | Task 1 tests `AC3.2: …` |
| AC4.1 | Task 3 test `AC4.1: …` |
| AC4.2 | Task 3 test `AC4.2: …` |
| AC5.1 | Task 1 Step 5 rule-removal mutation run (each rule removed in turn → a named test goes red) |
| AC6.1 | Task 3 Step 6 full `npm test` |

---

### Task 1: Pure route decision module

**Files:**
- Create: `plugin/bin/lib/wrap-up/evidence-route.js`
- Test: `tests/bin-lib/wrap-up/evidence-route.test.js`

**Interfaces:**
- Produces:
  - `SAFE_BRANCH_RE` — `/^[A-Za-z0-9._/-]+$/`.
  - `STATES` — frozen `['conflicting','no-conflict','unknown','open','not-open','no-pr','gh-absent','read-failed']`. The first four are open; `gh-absent`/`read-failed` are unreadable.
  - `ROUTES` — frozen `['current-branch','evidence-pr']`.
  - `REASONS` — frozen `['no-branch','integration-branch-unresolved','integration-branch','unsafe-branch-name','not-run-worktree','run-pr-open','run-pr-not-open','no-pr','unreadable-leave-open','unreadable-state']`.
  - `decideEvidenceRoute({ currentBranch, integrationBranch, toplevel, worktree, state, inRun, leaveOpen, consoleResolution }) -> { route, branch, state, reason }`.
    - `branch` is `currentBranch || ''`.
    - `state` is the input `state` if it is in `STATES`, else `'read-failed'`.
  - `branchReadState(result) -> state`, mapping a `resolvePrState` result:
    - `null` → `no-pr`
    - `'gh-absent'` → `gh-absent`
    - `'network-failure'` and any other string → `read-failed`
    - an object with `.state` `'OPEN'` → `open`; `'MERGED'` or `'CLOSED'` → `not-open`
    - anything else → `read-failed`
  - `stripTrailingSlash(p)` — drops trailing `/` (and `\`); a non-string passes through.

Rule order inside `decideEvidenceRoute` (first match wins). This order is the contract:
1. `!currentBranch` → `evidence-pr` / `no-branch` (detached HEAD or a failed git read)
2. `!integrationBranch` → `evidence-pr` / `integration-branch-unresolved`
3. `currentBranch === integrationBranch` → `evidence-pr` / `integration-branch`
4. `!SAFE_BRANCH_RE.test(currentBranch)` → `evidence-pr` / `unsafe-branch-name`
5. `worktree` is a non-empty string and `stripTrailingSlash(toplevel) !== stripTrailingSlash(worktree)` (a null `toplevel` counts as outside) → `evidence-pr` / `not-run-worktree`. With no `worktree` recorded, skip this rule: the current branch counts as the run's own.
6. state ∈ {conflicting, no-conflict, unknown, open} → `current-branch` / `run-pr-open`
7. state `not-open` → `evidence-pr` / `run-pr-not-open`
8. state `no-pr` → `current-branch` / `no-pr`
9. unreadable (`gh-absent`, `read-failed`, normalized unknown): `inRun === true && (consoleResolution === 'leave-open' || leaveOpen === true)` → `current-branch` / `unreadable-leave-open`; otherwise `evidence-pr` / `unreadable-state`

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/wrap-up/evidence-route.test.js`. Use a `base` input on the run's own branch: `{ currentBranch: 'worktree-x', integrationBranch: 'main', toplevel: '/r/wt', worktree: '/r/wt/', state: 'no-conflict', inRun: false, leaveOpen: false, consoleResolution: null }`. Write one test per rule, each citing its clause id:
  - `AC1.1: the integration branch takes evidence-pr whatever the PR state`. Loop every `STATES` value with `currentBranch: 'main'` and assert `{route:'evidence-pr', reason:'integration-branch'}`.
  - `AC1.1: an empty current branch takes evidence-pr whatever the PR state`. Loop `STATES`, reason `no-branch`.
  - `AC1.1: a branch name outside ^[A-Za-z0-9._/-]+$ takes evidence-pr whatever the PR state`. Names `'a$b'`, `'a b'`, ``'a`b'``, `"a'b"`, reason `unsafe-branch-name`, for every state.
  - `AC1.1: a toplevel that is not the recorded worktree takes evidence-pr whatever the PR state`. Use `toplevel: '/r/main'` and `toplevel: null`, reason `not-run-worktree`, for every state.
  - `AC1.1: the worktree match is exact after dropping a trailing slash`. `/r/wt/` vs `/r/wt` passes (current-branch); `/r/wt2` vs `/r/wt` fails; `/R/wt` vs `/r/wt` fails.
  - `unresolved integration branch fails closed`. `integrationBranch: null` → `evidence-pr` / `integration-branch-unresolved`.
  - `AC2.1: an open run PR takes current-branch on the run's own branch`. For each of `conflicting`, `no-conflict`, `unknown`, `open` → `current-branch` / `run-pr-open`, `branch: 'worktree-x'`.
  - `AC2.1: no-pr takes current-branch on the run's own branch` → `current-branch` / `no-pr`.
  - `AC2.2: with no worktree recorded the current branch counts as the run's own, still under the guard`. `worktree: null`, `toplevel: '/anywhere'`, state `no-conflict` → `current-branch`. With `worktree: null` plus `currentBranch: 'main'` → `evidence-pr` / `integration-branch`.
  - `run PR not-open takes evidence-pr` → `evidence-pr` / `run-pr-not-open`.
  - `AC3.1: an unreadable state takes current-branch only for an in-run leave-open console on the run's own branch`. For `gh-absent` and `read-failed`:
    - `inRun:true` + `consoleResolution:'leave-open'` → `current-branch` / `unreadable-leave-open`
    - `inRun:true` + `leaveOpen:true` → same
  - `AC3.2: an unreadable state otherwise takes evidence-pr`. All → `evidence-pr` / `unreadable-state`:
    - `inRun:false` + leave-open
    - `inRun:true` + `consoleResolution:'merge'`
    - `inRun:true` + `consoleResolution:null`
    - an unrecognized state `'weird'`, which reports `state:'read-failed'`
  - `AC3.1: the leave-open exception never overrides the guard`. `inRun:true`, leave-open, `gh-absent`, `toplevel:'/r/main'` → `evidence-pr` / `not-run-worktree`.
  - `branchReadState maps every resolvePrState result`:
    - `null`→`no-pr`
    - `'gh-absent'`→`gh-absent`
    - `'network-failure'`→`read-failed`
    - `'invalid-arguments'`→`read-failed`
    - `{state:'OPEN',number:1}`→`open`
    - `{state:'MERGED'}`→`not-open`
    - `{state:'CLOSED'}`→`not-open`
    - `{state:'DRAFT?'}`→`read-failed`
    - `42`→`read-failed`
  - `every returned route, reason and state is in the frozen vocabularies`. Run all the inputs above and assert membership in `ROUTES`/`REASONS`/`STATES`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/evidence-route.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/wrap-up/evidence-route'`

- [ ] **Step 3: Implement `plugin/bin/lib/wrap-up/evidence-route.js`.** Export the Interfaces above, with the rule order exactly as listed. The header comment names #4125 and #4039, states that the module is pure (no git, gh or fs), and says the CLI gathers its inputs. No `existsSync`/`realpathSync` tokens, even in code.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/wrap-up/evidence-route.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Rule-removal mutation run (AC5.1).** For each of rules 1-9 in turn:
  - delete or neutralize that rule's branch in the module, for example by commenting out its `if`
  - run `node --test tests/bin-lib/wrap-up/evidence-route.test.js`
  - record the test name(s) that went red
  - restore the module (`git diff` must show the original afterwards)

  Every rule must turn at least one named test red. If one doesn't, add the discriminating case before continuing. Record the rule → red-test table in the task report, quoting raw output.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/evidence-route.js tests/bin-lib/wrap-up/evidence-route.test.js
git commit -m "Add evidence-route decision module — pure screenshot-route rules for verification-brief Step 4

refs #4125"
```

### Task 2: `bin/evidence-route.js` CLI that gathers the inputs

**Files:**
- Create: `plugin/bin/evidence-route.js`
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js`. Add `consoleMergeResolution` to `module.exports` (currently unexported, around line 1094). No behavior change.
- Modify: `docs/plugin-structure.md`:
  - Line 24's `plugin/bin/lib/wrap-up/` entry gains a family (6): `evidence-route.js`, consumed by `plugin/bin/evidence-route.js`. "Five module families" becomes "Six module families".
  - Add a command line next to the `node plugin/bin/pr-merge-state.js …` line (around line 201) for `node plugin/bin/evidence-route.js [--run <run-dir>] [--in-run] [--leave-open] [--help]`, describing the JSON line, the states, the exit codes and that it is routed by `plugin/skills/wrap-up/verification-brief.md` Step 4 (tests in `tests/bin-lib/wrap-up/evidence-route.test.js`).
  - Before writing these, grep the file for "Five module families" and for the words "five" and "(5)" near `lib/wrap-up`, so no restated count is left stale.
- Test: `tests/bin-lib/wrap-up/evidence-route.test.js` (append CLI tests)

**Interfaces:**
- Consumes: Task 1's `decideEvidenceRoute`, `branchReadState`, `STATES`, `REASONS`, `ROUTES`, `SAFE_BRANCH_RE`.
- Produces: `run(argv, deps) -> exitCode` and `parseArgs(argv)`, exported from `plugin/bin/evidence-route.js`.
- Flags:
  - `--run <dir>` (optional; a value that is missing, empty or starts with `--` is exit 2)
  - `--in-run` (boolean: this call comes from wrap-up Phase 4 execution's Acceptance-labeling bullet)
  - `--leave-open` (boolean: an attended Review Console chose "Approve all, leave PR open" this run; `console.json` records only the resolver's choice)
  - `--help`/`-h`
  - an unknown argument is exit 2 with USAGE on stderr
- `deps` seams, real defaults in `realDeps`:
  - `cwd()`
  - `mainRoot` (undefined)
  - `git(args) -> string`: `execFileSync('git', args, { cwd: deps.cwd(), encoding: 'utf8', stdio: ['ignore','pipe','ignore'], timeout: GIT_TIMEOUT_MS, windowsHide: true })`, with `GIT_TIMEOUT_MS` from `lib/shared-primitives`
  - `readRunState(runDir)`: `readRunStateWithParent(runDir, { requireRunIdParent: true }).state`, as in `pr-merge-state.js`
  - `prMergeStateRun(argv, subDeps)`: `require('./pr-merge-state').run`
  - `resolveBranchPr(repoRoot, branch)`: `lib/reconcile/pr-state.js`'s `resolvePrState`
  - `integrationBranch(repoRoot)`: `bareIntegrationName(resolveIntegrationBranch(repoRoot))` from `lib/hooks/worktree-reap.js`
  - `consoleResolution(runDir)`: `engine-verify.js`'s `consoleMergeResolution`
  - `canonical(p)`: `lib/path-guard`'s `canonicalRealpath`
  - `stdout`, `stderr`
- Gather order in `run`:
  1. Parse the args; `--help` prints USAGE and returns 0.
  2. If `--run` was given:
     - `resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot })` from `lib/log-decision/append`. Not ok → stderr naming missing or unanchored, return 3.
     - `readRunState` (a throw reads as null). `worktree` = `state.worktree` when it is a non-empty string, else null.
     - Run `prMergeStateRun(['--run', runDir, '--phase', 'wrap-up'], { cwd: deps.cwd, mainRoot: deps.mainRoot, stdout: capture, stderr: deps.stderr })` in a try. Parse the last captured line as an object, mirroring `phase-exit.js`'s `runSub`.
     - Run state = the parsed `.state` when exit is 0 and parsing succeeded, else `'read-failed'`.
     - `consoleResolution = deps.consoleResolution(runDir)`.
  3. `currentBranch = deps.git(['branch','--show-current']).trim()`; a throw gives `''`.
  4. `toplevel = deps.git(['rev-parse','--show-toplevel']).trim()`; a throw gives `null`.
  5. Canonicalize: `toplevel = deps.canonical(toplevel) || toplevel` and `worktree = deps.canonical(worktree) || worktree`, each only when non-null.
  6. When there is no `--run`, or the run state is `'no-pr'`: `state = branchReadState(deps.resolveBranchPr(deps.cwd(), currentBranch || null))`, with a throw giving `'read-failed'`.
  7. `integrationBranch = deps.integrationBranch(deps.cwd())`; a throw gives `null`.
  8. Print `JSON.stringify(decideEvidenceRoute({...}))` plus `\n` and return 0.
- USAGE lists the flags, the `route` and `reason` vocabularies (from `ROUTES`/`REASONS`), the `state` vocabulary (from `STATES`), and `exit 0 in every route; 2 malformed invocation; 3 run dir missing or not anchored`. It also says that `pr-merge-state.js` runs in-process and appends its own `decisions.md` lines (AUTO on `conflicting`, SKIP on `unknown`/`read-failed`/`gh-absent`) under `/wrap-up`.

- [ ] **Step 1: Write the failing CLI tests.** Append them to `tests/bin-lib/wrap-up/evidence-route.test.js` and require `run`/`parseArgs` from `../../../plugin/bin/evidence-route`. Use the fake-`.git` anchored fixture shape from `tests/bin-lib/pr-merge-state/cli.test.js` (main dir with a `.git` directory, run dir under `.claude-tweaks/pipelines/2026-10-26T000001-record-1`, `mainRoot` injected, tmp dirs removed in `test.after`). Every test injects every seam, so no real git or gh runs. Tests:
  - `--help prints usage naming every state and reason and exits 0`
  - `malformed invocations exit 2`: an unknown flag, a trailing bare `--run`, `--run ''`, and `--run --in-run`
  - `an unanchored --run exits 3 and prints nothing on stdout`: a run dir outside the fixture main root
  - `open run PR on the run's own branch prints current-branch`:
    - run-state `{worktree: <wt>, pr: {number: 7}}`
    - fake `prMergeStateRun` writes `{"state":"no-conflict"}` and returns 0
    - git fake: `branch --show-current` → `worktree-x\n`, `rev-parse --show-toplevel` → `<wt>\n`
    - `integrationBranch` → `main`
    - assert stdout parses to `{route:'current-branch', branch:'worktree-x', state:'no-conflict', reason:'run-pr-open'}`
    - also assert `prMergeStateRun` got argv `['--run', runDir, '--phase', 'wrap-up']` and that `resolveBranchPr` was never called
  - `run read no-pr falls back to the branch read`. `prMergeStateRun` prints `{"state":"no-pr"}`. `resolveBranchPr` returns `{state:'MERGED', number: 3}` → `evidence-pr` / `run-pr-not-open`, state `not-open`. Assert `resolveBranchPr` got `(cwd, 'worktree-x')`.
  - `no --run reads the branch only`. `prMergeStateRun` is never called, `resolveBranchPr` returns `null`, `worktree` stays null → `current-branch` / `no-pr`.
  - `pr-merge-state failure shapes read as read-failed`. Each of these → state `read-failed`, and with `inRun` false → `evidence-pr` / `unreadable-state`:
    - prints `{"state":"read-failed","reason":"unparseable"}`
    - prints a non-JSON line
    - returns 2
    - throws
  - `--in-run with a leave-open console.json on the run's own branch takes current-branch when the read is unreadable`. Fake `consoleResolution` → `'leave-open'`, `prMergeStateRun` prints `{"state":"gh-absent"}`, argv `--in-run` → `current-branch` / `unreadable-leave-open`. The same input without `--in-run` → `evidence-pr`.
  - `--leave-open stands in for an attended console choice`. `consoleResolution` → null, argv `--in-run --leave-open`, state `gh-absent` → `current-branch` / `unreadable-leave-open`.
  - `multi-spec parent console is not a leave-open signal`. Use the real `consoleMergeResolution` (do not fake `consoleResolution`). Write the fixture run dir's `manifest.yml` and `console.json` = `{"merge":{"resolution":"leave-open"}}`. Argv `--in-run`, state `gh-absent` → `evidence-pr` / `unreadable-state`. Without `manifest.yml` the same fixture → `current-branch`.
  - `worktree compare canonicalizes both sides`. Fake `canonical` maps `'/link/wt'`→`'/real/wt'` and `'/real/wt'`→`'/real/wt'`. Run-state worktree `/link/wt`, git toplevel `/real/wt` → `current-branch`. Fake `canonical` returning null for both leaves raw values `/link/wt` vs `/real/wt` → `not-run-worktree`.
  - `a failing git read for the branch reads as no-branch` (git throws on `branch`) → `evidence-pr` / `no-branch`.
  - `an unresolvable integration branch fails closed` (`integrationBranch` throws) → `evidence-pr` / `integration-branch-unresolved`.
  - `archived run dir is read like a live one`. The run dir sits at `.claude-tweaks/pipelines/archive/2026-10-26T000001-record-1` under the fixture main, with run-state carrying `worktree` and `pr` → the exit code is 0 and `prMergeStateRun` receives that archive path.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/evidence-route.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/evidence-route'`

- [ ] **Step 3: Implement `plugin/bin/evidence-route.js`** per the Interfaces and gather order above. Add the `consoleMergeResolution` export to `engine-verify.js`, then make the two `docs/plugin-structure.md` edits.

- [ ] **Step 4: Run to verify it passes, and run the bin-wide conformance scans the new file is subject to**

Run: `node --test tests/bin-lib/wrap-up/evidence-route.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/porcelain-cwd-compare-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/pr-merge-state/cli.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Real-input probe.** Run the CLI against this build's own live run dir from inside the worktree:

```bash
node plugin/bin/evidence-route.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-26T094237-record-4125"
```

Expected: `{"route":"current-branch","branch":"worktree-dispatch-record-4125","state":<conflicting|no-conflict|unknown>,"reason":"run-pr-open"}`. This run's draft PR #4393 is open, and the session is in the recorded worktree.

Run it again with no `--run` from the same cwd. Expected: `state:"open"`, `reason:"run-pr-open"`.

Independent check: `gh pr view 4393 --json state,mergeable,mergeStateStatus` must agree with the reported state. Record both raw outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/evidence-route.js plugin/bin/lib/wrap-up/engine-verify.js docs/plugin-structure.md tests/bin-lib/wrap-up/evidence-route.test.js
git commit -m "Add bin/evidence-route.js — gather verification-brief Step 4's six route inputs and print one JSON line

refs #4125"
```

### Task 3: Step 4 routes on the CLI; conformance test narrowed

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief.md`. Step 4, from `**Read the run's own PR before committing` (around line 253) through the `**State unreadable` bullet (around line 304) inclusive. Today's file is 33,221 B against `RAIL_BYTES` 52,500, and the edit shrinks it.
- Modify: `tests/verification-brief-evidence-routing.test.js`
- Modify: `docs/journeys/land-demo-evidence-after-the-pr-merged-4039.md`. Its steps 1, 2 and 4 describe the prose guard and the reads; repoint them to the CLI, and add `plugin/bin/evidence-route.js` and `plugin/bin/lib/wrap-up/evidence-route.js` to its `files:` frontmatter.
- Modify: `docs/journeys/close-out-a-parked-pr-whose-labeling-never-landed-3783.md:50`. "`verification-brief.md` Step 4's integration-branch guard takes the evidence-PR route" becomes "`verification-brief.md` Step 4's `bin/evidence-route.js` integration-branch guard takes the evidence-PR route" (Check B scope-creep add-to-plan).

**Interfaces:**
- Consumes: Task 2's CLI flags `--run`, `--in-run`, `--leave-open`, and its JSON `{route, branch, state, reason}`.

New Step 4 text replaces the paragraphs "Read the run's own PR before committing…" through the unreadable bullet. Keep everything else in Step 4 unchanged: the screenshot-commit paragraph above, the local-merge/current-branch paragraph, the log-decision call and `{text-file}` line (pinned by `tests/log-decision-text-file-sites-conformance.test.js` V1), the evidence-PR URL line, the commit fence, the embed, local-files, Branch, and the template. Write it as:

1. A paragraph headed **`Route the commit (`integration-model: pr-first`, #4039, #4125).`**. Keep the existing rationale sentences verbatim: "Step 4 never commits to or pushes `{integration-branch}`…" through "A commit on a merged branch never reaches the integration branch." Then say that `bin/evidence-route.js` makes the decision from the current branch, the worktree `run-state.json` records, the run's own PR (read through `bin/pr-merge-state.js`, which also appends its own "Post-push merge-state check" entry to `decisions.md`, which is expected), the branch's PR as the fallback, and `console.json`'s merge resolution. Its rules are in its `--help`, not restated here.
2. The command in its own fenced bash block, run as its own Bash call: `node "${CLAUDE_PLUGIN_ROOT}/bin/evidence-route.js" --run "{run-dir}"`. After it, a sentence covering:
   - `{run-dir}` is `$PIPELINE_RUN_DIR`, or `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` once cleanup item 8 archived it (`_shared/timing-render.md`'s archive-path rule)
   - drop `--run` when no run directory resolves
   - add `--in-run` only when this file was reached from Phase 4 execution's Acceptance-labeling bullet (the Routing table's first row)
   - add `--leave-open` only when an attended Review Console chose "Approve all, leave PR open" this run
3. One sentence: it prints one JSON line `{route, branch, state, reason}`. Route on `route` alone; `state` feeds the log line below. A non-zero exit, or output that does not parse as that line, takes the evidence-PR route.
4. The route bullets, which keep the existing command text:
   - **`- **`current-branch`**`** — "commit on the current branch (the fence below), then push that commit straight away, as its own Bash call: `git push origin {branch}`, with `{branch}` the JSON's `branch`". Then the existing two sentences on the later phase-exit push and on a failed push.
   - **`- **`evidence-pr`**`** — the existing "Run PR merged or closed" bullet's text from "never commit to the dead branch or the integration branch, and never switch the session's branch in place." through its last sentence, verbatim.

Delete the guard paragraph, the own-branch definition, the toplevel comparison, the branch-name rule, both read commands with their state lists, and the `No PR recorded`/`State unreadable` bullets: the CLI owns them now. The log line's `PR state {state}` reads the JSON's `state`, so the V1 pin is unchanged.

- [ ] **Step 1: Write the failing conformance changes** in `tests/verification-brief-evidence-routing.test.js`.
  - Constants: replace `OPEN`/`GONE`/`NONE`/`UNREADABLE` with:
    - `CURRENT = '- **\`current-branch\`**'`
    - `GONE = '- **\`evidence-pr\`**'`
  - Change `check`'s anchor to `"**Route the commit"`.
  - In `assertRouting`, remove:
    - Ruling 1's `pr-merge-state.js` command assertion
    - all of Ruling 2
    - all of Ruling 3
    - the `NONE`/`UNREADABLE` bullet assertions
  - Keep:
    - the local-merge exception and ordering assertions
    - the archive-path, `_shared/timing-render.md` and `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` assertions
    - the `"Post-push merge-state check" entry` sentence
    - `!s.includes('$(git')` and `!s.includes('git switch')`
    - every `gone` bullet literal (rename its constant only)
    - the open bullet's three assertions (now on `CURRENT`)
    - `mcp__github__create_pull_request`, `_shared/github-write-transport.md`, the `--section "/wrap-up"` log assertion and the evidence-PR URL assertion
  - Add:
    - `AC4.2`: the routing assertions require `s.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/evidence-route.js" --run "{run-dir}"')`, as a fenced bash block line of its own (assert the fence `\`\`\`bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/evidence-route.js" --run "{run-dir}"\n\`\`\`` is present), plus `--in-run`, `--leave-open`, `Route on \`route\` alone`, and `A non-zero exit, or output that does not parse as that line, takes the evidence-PR route`.
    - `AC4.1`: a `assertNoRuleRestatement(s)` function, called from `assertRouting`. It requires that none of these appear in Step 4: `^[A-Za-z0-9._/-]+$`, `resolvePrState`, `git rev-parse --show-toplevel`, `bin/pr-merge-state.js" --run`, `git branch --show-current`, `detached HEAD`, `merge.resolution\` reads`.
  - Tests:
    - Rename the main test to `AC4.1 AC4.2: Step 4 routes the screenshot commit on bin/evidence-route.js's JSON`.
    - Add `AC4.1 go-red control: restoring a prose rule turns the routing assertions red`. It runs `assertRouting` on Step 4 with the prose sentence ``A branch name that does not match `^[A-Za-z0-9._/-]+$` takes the evidence-PR route.`` appended, and expects a throw.
    - Add `AC4.2 go-red control: dropping the CLI invocation turns the routing assertions red`. It runs `assertRouting` on Step 4 with the invocation line replaced by `x`, and expects a throw.
    - Keep the two existing AC8.1 controls, re-pointed at the renamed `GONE`. They run the same `assertRouting`.
  - Leave the `summary-template.md` test unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/verification-brief-evidence-routing.test.js`
Expected: FAIL, the first being `missing the PR-state check paragraph` (the anchor `**Route the commit` is absent from today's Step 4).

- [ ] **Step 3: Rewrite Step 4** in `plugin/skills/wrap-up/verification-brief.md` as specified above, and update both journey docs.

- [ ] **Step 4: Run to verify it passes, plus every other suite reading this file or the moved phrases**

Run: `node --test tests/verification-brief-evidence-routing.test.js tests/log-decision-text-file-sites-conformance.test.js tests/pr-run-comments.test.js tests/try-it-contract-conformance.test.js tests/verify-expectations-writer-conformance.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/demo-full-verification-pointer.test.js tests/timing-prose-conformance.test.js tests/comment-trust-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Prose-held pin sweep.**
  - Run `git grep -n -F -e "the current-branch route is unavailable" -e "Read the run's own PR before committing" -e "State unreadable (" -e "No PR recorded (" -e "Run PR open (" -e "Run PR merged or closed" -- plugin docs tests`.
  - Expected: no hits outside `docs/superpowers/plans/` and `.claude-tweaks/`.
  - Repoint any hit in `plugin/` or `docs/journeys/` to the CLI.

- [ ] **Step 6: Full suite (AC6.1)**

Run: `npm test > "$SCRATCH/npm-test-4125.txt" 2>&1; echo "exit=$?"`, where `$SCRATCH` is the session scratchpad. Then read the tail for the `# pass`/`# fail` counts.
Expected: `exit=0`, `# fail 0`. A count that varies run-to-run means re-running the affected files in isolation before concluding (CLAUDE.md).

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/wrap-up/verification-brief.md tests/verification-brief-evidence-routing.test.js docs/journeys/land-demo-evidence-after-the-pr-merged-4039.md docs/journeys/close-out-a-parked-pr-whose-labeling-never-landed-3783.md
git commit -m "Route verification-brief Step 4 on bin/evidence-route.js — drop the prose guard and per-state route rules

refs #4125"
```
