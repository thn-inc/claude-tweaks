---
files:
  - .github/workflows/test-perf.yml
  - tools/run-tests.js
  - docs/plugin-structure.md
---

# Notice a Timing-Budget Regression From the Scheduled Perf Run

**Persona:** A claude-tweaks maintainer who merges PRs gated only by `npm test`, and who never remembers to run `npm run test:perf` by hand on an idle machine.
**Goal:** Find out within a day when a merge makes a `perf/` wall-clock budget go red (a linearity regression, a lock that stops waiting, a slow hook path), without any timing assertion ever gating or flaking a PR.
**Entry point:** Nothing to invoke. The `test-perf` workflow runs `npm run test:perf` on `main` once a day. To check on demand (after merging a perf-sensitive change, or to re-check a red run), start it from the Actions tab or with `gh workflow run test-perf.yml`.
**Success state:** The latest `test-perf` run on `main` is green. If it is red, the maintainer knows which `perf/*.test.js` budget failed and on which commit, and either fixes the regression or re-runs the workflow to rule out a one-off runner slowdown.

## Steps

### 1. Merge as usual
- **URL:** the PR's checks list.
- **Action:** Merge the PR. Its checks are unchanged: `test-perf` never runs on `pull_request` or `push`.
- **Should feel:** Invisible. There is no new check to wait for and no timing flake to re-run.
- **Should understand:** `perf/` is outside `npm test` on purpose. A timing assertion cannot be deterministic in a suite that shares the machine with sibling worktrees (`docs/plugin-structure.md`'s `perf/` entry).
- **Red flags:** A `test-perf` check appearing on a PR, or a merge waiting on it.

### 2. Read the daily run
- **URL:** Actions tab → `test-perf`, or `gh run list --workflow test-perf.yml`.
- **Action:** Look at the newest run. A failed scheduled run is also reported by GitHub's failed-workflow notification.
- **Should feel:** Like background monitoring: a run you can look at, not one you have to.
- **Should understand:** The job runs `npm run test:perf` alone on a fresh ubuntu runner with Node 20, so its tight bounds hold. Every failing budget prints as a `not ok` naming its `perf/{topic}.test.js` file and test.
- **Red flags:** No run for days, which means the schedule is disabled (GitHub turns scheduled workflows off after 60 days with no repository activity). A run that dies before any test executes.

### 3. Act on a red budget
- **URL:** the failing `perf/*.test.js` file and `git log` since the last green run.
- **Action:** Re-run the workflow once (`gh run rerun {id}` or the dispatch button). If it is red again, find the commit that slowed the path, reproduce with `npm run test:perf` locally on an otherwise idle machine, and fix the code. Never loosen the bound.
- **Should feel:** Bounded. The failing test names the behaviour, and the window of suspect commits is about one day.
- **Should understand:** A budget that is red twice on an idle runner is a regression, not noise. The functional half of each budget still runs in `npm test`. For example, `tests/bin-lib/model-profiles/session-failures.test.js` asserts the session-failures lock wait by outcome (no lost update), not by time.
- **Red flags:** Raising a bound to get green. Moving a budget back into `tests/`, which `tests/wall-clock-budget-conformance.test.js` rejects.

## Origin
- Created during build of #4067: the `test-perf` workflow (schedule + `workflow_dispatch`) and a behavioural lock-wait assertion in `npm test`. Before this, #3939 had moved the budgets to `perf/` with no automatic runner.
- Related: `act-on-a-red-wall-clock-budget-scan-3491.md` (where a budget goes in the first place) and `learn-of-a-windows-regression-after-merge.md` (the sibling post-merge, never-a-PR-gate workflow).
