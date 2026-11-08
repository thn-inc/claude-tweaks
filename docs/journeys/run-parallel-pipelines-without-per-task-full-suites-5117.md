---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/worktree-setup.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/dispatch/express-prompt.md
  - tools/upstream-drift/manifest.yml
---

# Run Parallel Pipelines Without Per-Task Full Suites

**Persona:** Developer who keeps several `/claude-tweaks:flow` or `/claude-tweaks:dispatch` sessions running at once on one laptop, often in a Go, Python or Node consumer repo. Before #5117, each session ran the whole test suite at worktree creation and again inside every plan task, each run with about one worker per core. The machine ran out of memory, and the bottleneck was test processes, not the agents.
**Goal:** Each pipeline spends local test effort where it buys evidence. Each task runs the tests its change can break, and the branch gets one suite run at the end. Running more sessions in parallel then stops multiplying full-suite runs.
**Entry point:** `/claude-tweaks:flow #N`, a dispatched `build,test` call, or `/claude-tweaks:build #N` with a pipeline run directory, in any project. With or without a `.claude-tweaks/verify-scope.json` that declares `impact`.
**Success state:** A K-task spec runs at most one per-task full suite and one Common Step 5 verification run, instead of about K+3 full runs. Common Step 5's run is full, or impact-selected when declared. Worktree creation inside the pipeline runs no baseline suite. Every instruction an agent receives names the project's test command, never a hardcoded `npm test`. The developer should feel parallel sessions are bounded by real work, not by duplicated suite runs.

## Steps

### 1. The worktree is created without a baseline suite run — `build/worktree-setup.md`
- **URL:** —
- **Action:** Common Step 1 invokes `/superpowers:using-git-worktrees` as before. Because `$PIPELINE_RUN_DIR` is set, step 2 carries "; pipeline: no baseline (step 3)". Step 3 tells the skill to skip its "Step 3: Verify Clean Baseline" run. Branch creation and dependency install still happen.
- **Should feel:** Fast: the worktree is ready as soon as dependencies install, with no 16-minute wait before the plan starts.
- **Should understand:** The baseline run would test a tree that Step 4's catch-up is about to move. Common Step 5's baseline adjudication and CI own base health. A standalone `/claude-tweaks:build` with no run directory keeps the baseline run.
- **Red flags:** A full-suite run right after `EnterWorktree` inside a `/flow` run; a standalone build that skips the baseline; the skill stopping to ask whether to proceed past baseline failures.

### 2. Each task's implementer runs the affected test set — `build/dispatch.md`
- **URL:** —
- **Action:** `/build` instructs subagent-driven development to have every per-task implementer, fix-wave and whole-branch-fix dispatch run the affected test set. This replaces superpowers' "run the full suite once before committing" and test-driven-development's "Other tests means the project's suite". When the project declares `impact`, the affected set is what `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --scope .claude-tweaks/verify-scope.json --integration-branch {integration-branch} --no-stamp` selects. `/build` fills the branch through `_shared/integration-branch.md`. Otherwise it is the tests scoped to the touched packages or paths, plus any test that reads or imports a touched file (search for its path or module/package name).
- **Should feel:** Proportionate: a one-file change runs the tests near that file, not the whole repository.
- **Should understand:** TDD's red/green runs are unchanged. `--no-stamp` keeps per-task runs from writing the pass stamp, so Common Step 5 stays the only producer. Under `batched`, the same rule covers the controller's own per-task runs and executing-plans' "run the whole suite".
- **Red flags:** An implementer report showing a full `npm test` (or `go test ./...`) per task; a per-task run that writes a pass stamp; an affected set that misses a test reading the changed file.

### 3. A full-mode selection switches later tasks to the fallback — `build/dispatch.md`
- **URL:** —
- **Action:** **The implementer** runs the impact selection and sees `Scope: full` or `Impact: full …`, or the call exits 2. The cause can be an unusable map, a full-suite rule, an unmatched path such as `package.json` or `.github/**`, or a missing `--cmd`. The implementer says so in its report. **The SDD controller** then directs every later task's dispatch to the path/package fallback.
- **Should feel:** Self-correcting: one surprise full run, then the pipeline stops paying for it.
- **Should understand:** The selection is cumulative from the merge base, so once one task touches a full-mode path, every later selection would be full too. That is why the switch is carried forward instead of re-tried. A branch therefore has at most one per-task full run.
- **Red flags:** Several tasks in a row each reporting a full-mode selection; a controller dispatch that never mentions the switch after one is reported.

### 4. The branch gets one suite run at Common Step 5 — `build/SKILL.md`, `test/verification.md`
- **URL:** —
- **Action:** After simplify, alignment, journeys and docs sync, Common Step 5 runs `verify.js` once for the branch. The run is full, or impact-selected when the declaration has `impact`. Baseline adjudication handles pre-existing failures, and the run produces the pass stamp `/test` and `/review` read. The whole-branch reviewer runs only focused tests.
- **Should feel:** Decisive: one authoritative run, with its report in the run directory.
- **Should understand:** Where the impact map applies, CI owns the full run for the PR. The batched strategy's pointer (`build/SKILL.md`'s `**batched**:` line) folds in the same rule.
- **Red flags:** A second local full run after Common Step 5 with no code change in between; the reviewer running the full suite.

### 5. Dispatched agents name the project's test command — `dispatch/task-prompt.md`, `dispatch/express-prompt.md`
- **URL:** —
- **Action:** `/claude-tweaks:dispatch`'s first-call, second-call and express prompts tell the dispatched agent to "run the project's test command and every other long-running command in the foreground of that turn". `build/dispatch.md`'s copy adds "(test/verification.md Step 1)". The handoff evidence line reads "A raw test-command log is not that artifact".
- **Should feel:** Correct in any language: a Go or Python consumer is never told to run `npm test`.
- **Should understand:** The Foreground paragraph stays identical across the prompt templates. The citation is kept out of the near-rail dispatch prompts on purpose, because `/flow`'s verification already resolves the command.
- **Red flags:** Any shipped dispatch prompt containing a literal `npm test` instruction; the express and first-call Foreground paragraphs drifting apart.

### 6. A superpowers rewording is flagged as drift — `tools/upstream-drift/manifest.yml`
- **URL:** —
- **Action:** **Maintainer** runs `node tools/upstream-drift/run.js findings --dep superpowers --offline`, or the upstream-drift skill does. Four new pins assert that the lines these rules override still exist in the installed superpowers:
  - implementer-prompt's "full suite once before committing, not after every edit."
  - test-driven-development's "means the project's suite, not just your file."
  - using-git-worktrees' "## Step 3: Verify Clean Baseline"
  - executing-plans' "make it pass, then run the whole suite."
- **Should feel:** Watched: an upstream change can't silently re-enable per-task full runs.
- **Should understand:** A finding means re-read the override against the new upstream text and re-pin (the upstream-repin skill). It does not mean the override is wrong.
- **Red flags:** A superpowers upgrade that passes the drift check while one of those lines changed; a pin whose `file:` names a file that doesn't carry the override.

## Origin
- Created during build of #5117 (cut redundant local full-suite runs in pipelines). The developer hit machine memory limits from parallel sessions' test processes.
- Steps 1-6 built in this session; step 3 came from the whole-branch review's Important finding.
- Related: `run-a-deterministic-verification-check.md` (Common Step 5's verify.js run), `declare-a-verify-scope-1924.md` (the `impact` declaration the affected set reads), `repin-an-upstream-plugin-dependency-3376.md` (what to do when a pin fires), `review-a-long-build-against-the-merged-tree-4304.md` (the pre-review catch-up that can still re-run the suite once).
