---
files:
  - plugin/skills/test/verification.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/test/SKILL.md
  - plugin/skills/test/impact-selection.md
  - plugin/skills/test/flake-handling.md
  - plugin/bin/residue.js
  - plugin/bin/lib/residue/probes/suite.js
  - .claude-tweaks/verify-scope.json
---

# Run a Pipeline That Takes the Suite from CI

**Persona:** a maintainer running several `/claude-tweaks:flow` pipelines at once on one laptop, in a project whose `.claude-tweaks/verify-scope.json` declares a `ci` source for its tests and sets `"localRuns": "on-request"`, who wants each pipeline's verification to take the whole suite from the PR's CI job instead of running it again here.
**Goal:** every pipeline verify gets its suite verdict from CI after a push, never stops on "no verdict yet", and the whole suite runs on this machine only when the maintainer asks for it by name.
**Entry point:** `/claude-tweaks:flow #{n}` in a `pr-first` worktree run; later `/claude-tweaks:test full`.
**Success state:** build's Final Verification pushes, then its scoped `verify.js` call prints `CI: tests — taken from …` and `report.json`'s `ci` entry for `tests` shows `used: true`; a call CI could not answer re-ran once with `--local` and left one `AUTO` line in `decisions.md`; the run never stopped on exit 3.

## Steps

### 1. Final Verification pushes first
- **URL:** `/claude-tweaks:build` Common Step 5, `verify.js --scope .claude-tweaks/verify-scope.json --integration-branch {branch} --baseline origin/{branch}`
- **Action:** After the pre-verification catch-up, the build pushes its branch (`git -C "{worktree}" push origin {branch}`) and runs the scoped invocation.
- **Should feel:** The build waits on CI instead of heating the machine; sibling pipelines keep their CPU.
- **Should understand:** Every pipeline verify site is scoped under a declaration, Build's included; the push happens immediately before each scoped call, after any commit or merge that moved HEAD, because CI answers only for the open PR's head.
- **Red flags:** an unscoped `verify.js` call at a pipeline site; a scoped call on an unpushed HEAD; the whole suite starting locally while the PR's CI job runs the same commit.

### 2. CI cannot answer
- **URL:** `verify.js` stderr (`no verdict yet for suite "tests" — CI could not answer ({reason})`), exit 3; `decisions.md`
- **Action:** On `head-not-pushed` the run pushes and re-runs once; on `no-open-pr-at-head` it opens or records the PR and re-runs once; on a second exit 3, or any other reason, it re-runs with `--local`.
- **Should feel:** Invisible — the pipeline keeps going and the console later shows why the suite ran here.
- **Should understand:** Exit 3 is never a test failure and adds no stop in `auto` mode. The `--local` re-run runs the impact subset, or the whole suite when selection cannot narrow — the one named exception (`test/impact-selection.md`'s Whole suite on request). It logs `AUTO {time} — Verification: no CI verdict for suite "tests" ({reason}); re-ran with --local on this machine.` Inside a dispatched subagent a call that ends on its 600 s timeout while still waiting on CI runs once more; a timeout is never exit 3 and never triggers `--local`.
- **Red flags:** a run stopped or marked failed on exit 3; a `--local` re-run with no `AUTO` line; a timed-out call treated as exit 3.

### 3. A CI red stays a CI red
- **URL:** `verify.js` check table; `test/flake-handling.md`
- **Action:** A red the runner took from CI stands as the result.
- **Should feel:** Honest — the red is CI's run on this exact head, not something to argue away locally.
- **Should understand:** Neither of the agent's re-run paths (named-file isolation, the whole-suite re-run) re-runs a CI red on this machine; the runner's own allowlisted flaky retry is unchanged.
- **Red flags:** a CI red ruled a flake after a local pass.

### 4. Ask for the whole suite here, by name
- **URL:** `/claude-tweaks:test full`
- **Action:** Run the whole suite on this machine — for a platform-specific change, or to reproduce a CI failure.
- **Should feel:** Deliberate: the one command that does it, named in the argument hint and `/help`'s reference card.
- **Should understand:** `full` runs `verify.js --local` with no `--scope` and no baseline flags, is never skipped as recent, reports every failure and never enters fix mode. A bare `/claude-tweaks:test` under the key runs scoped: with no open PR at the branch it passes `--local` first, with one it runs the scoped call, and on exit 3 it re-runs once with `--local` and prints `push the branch and re-run to take the suite from CI` — it always ends with a verdict and never pushes. `/claude-tweaks:release` runs `full` once per version before the bump.
- **Red flags:** a bare `/claude-tweaks:test` running the whole suite here under the key; a standalone run that pushes; `full` auto-fixing a failure.

### 5. Close the run
- **URL:** `residue.js` output at `/claude-tweaks:wrap-up`'s residue sweep
- **Action:** The close-time suite probe reads the declaration.
- **Should feel:** No surprise `npm test` at the very end of a run.
- **Should understand:** Under the key the probe is not run and its reason reads `not run on this machine — the declaration's localRuns "on-request" takes tests from the PR's CI job; /claude-tweaks:test full runs it here`; without the key (or with no CI job named) it runs `npm test` as before. A miss the `--local` subset let through is caught by the PR's `test` job on the same head: the merge gate parks a red PR and waits on a pending one.
- **Red flags:** `npm test` started by the probe under the key; a probe exit 0 reported as a green suite when a bare `npm test` ran a subset or nothing.

## Origin
- Created during `/claude-tweaks:build` of record #5370 (2026-11-14), from the maintainer-Mac measurement of 91 `verify` events in 38 pipeline runs in which 21 unscoped runs and 6 of 9 `head-not-pushed` fallbacks repeated whole-suite work the PR's CI job did on the same commit. Decision record: `docs/decisions/0032-whole-suite-runs-in-ci-local-runs-on-request.md`.
