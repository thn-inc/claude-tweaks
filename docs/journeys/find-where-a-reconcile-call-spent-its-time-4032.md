---
files:
  - plugin/bin/hooks.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/timing.js
  - plugin/bin/lib/reconcile/pr-state-cache.js
  - plugin/bin/lib/reconcile/pr-state-batch.js
  - plugin/bin/lib/reconcile/background-spawn.js
  - plugin/bin/lib/reconcile/budget.js
  - plugin/skills/tidy/scan-procedures.md
  - docs/reconcile-checks.md
---

# Find Where a Reconcile Call Spent Its Time

**Persona:** A maintainer whose `/claude-tweaks:dispatch` firing just sat on its Step 2 `hooks.js reconcile --json` call for a noticeable stretch, plus the agent session that runs that call (dispatch Step 2, worktree setup's pre-creation reconcile, `/tidy`) and has to decide whether the wait was normal.
**Goal:** Read one call's own JSON and see which check and which subprocess family took the time, without re-running it under a profiler. Also know which janitorial checks this call ran inline and which it handed to the background pass.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --json`, run from any checkout or worktree of a `pr-first` repo.
**Success state:** On this repo the unscoped call finishes in single-digit seconds (p50 7.3 s over 20 live calls, down from about 52.5 s). Its output carries a `timings` block whose phases add up to `totalMs`, and a `background` block that says whether the deferred checks were handed to a background pass, and why.

## Steps

### 1. Run the unscoped call
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --json`
- **Action:** Run it the way dispatch Step 2 already does.
  - It runs `mirror`, `red-tip`, `reap`, `release`, `archive` and `console` inline.
  - PR states are resolved once per pass, through a shared resolver that batches lookups into aliased GraphQL queries.
  - A claim whose blob sha has not changed is not re-read.
- **Should feel:** Quick. The call returns in a few seconds instead of the minute-scale waits that used to background a firing (#1543).
- **Should understand:** The call no longer runs `archive-branches`, `remote-prune` or `ledger-residue` inline. They show up in `skipped` with the reason `deferred-to-background`.
- **Red flags:** A pass that takes tens of seconds while `background.reason` is `spawned` or `fresh`. That points at an inline check regressing, not at the deferred ones.

### 2. Read `timings`
- **URL:** the call's stdout, the `timings` key
- **Action:** Read `timings.phases`:
  - Each check's `ms`.
  - Each check's `subprocesses`, keyed by command family (`gh pr view`, `gh api graphql`, `git worktree`, …), with a count, total ms and max ms.
  - `setup` is the time spent outside any check.
- **Should feel:** Self-explanatory. The slow phase and its dominant subprocess family are visible at a glance.
- **Should understand:**
  - `subprocessMs` can exceed a phase's `ms` when that phase runs subprocesses concurrently.
  - `totalMs` agrees with the wall time measured from outside the call to within process start-up (58–90 ms measured).
  - The section on this in `docs/reconcile-checks.md` is `## Timing contract`.
- **Red flags:**
  - `timings: null`. Either the summary itself faulted, which is harmless but means the numbers are missing, or the call fell back to `reconcile-threw`.
  - A large subprocess count for one family. For example, dozens of `gh pr view` means a check stopped warming the shared resolver.

### 3. Read `background`
- **URL:** the call's stdout, the `background` key
- **Action:** Check `background.spawned` and `background.reason`:
  - `spawned` means a detached `reconcile-background` pass was started.
  - `fresh` means a recent background pass already ran.
  - `not-converged` means the pass itself skipped (no repo, no remote, local-merge, preflight failure, threw).
  - `dry-run` means `--dry-run` never spawns.
  - `spawn-failed` means the spawn threw.
- **Should feel:** Trustworthy. The deferred checks are clearly owned by something; they are not silently dropped.
- **Should understand:**
  - The background pass runs `release`, `archive`, `archive-branches`, `remote-prune`, `ledger-residue` and `reap` under its own 120 s ceiling, so its slow GraphQL-heavy checks are not starved by the 18 s hot-path budget.
  - Its outcome surfaces at the next session start.
  - When preflight fails, `skipped` also names the three deferred checks under the same preflight reason.
- **Red flags:** `background.reason` stuck at `not-converged` on a healthy `pr-first` repo, which means the deferral never hands work off.

### 4. Ask for full inline convergence when you need it
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --checks mirror,red-tip,reap,release,archive,archive-branches,remote-prune,ledger-residue,console --json`
- **Action:** Name every check explicitly, the way `/tidy`'s Reconcile-first step now does, when the next step audits branches or remote refs and needs them converged first.
- **Should feel:** Deliberate, and slower (tens of seconds on this repo), with a generous timeout of 150000 ms or more.
- **Should understand:** An explicit `--checks` call runs unbounded (#3026), defers nothing and carries no `background` key.
- **Red flags:** A `/tidy` branch audit that reports branches or remote refs the reconciler should already have disposed of. That suggests the call went back to the unscoped form.

## Origin
- Created during build of #4032 (Cut hooks.js reconcile from ~63 s per call).
- All steps were built in this session.
- Related specs: #1543 (earlier ~2-minute reconcile runs), #3026 (explicit `--checks` runs unbounded), #820 (the fast/background split), #4180 (follow-up: make `--dry-run` write nothing).
