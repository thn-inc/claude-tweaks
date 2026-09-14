---
files:
  - plugin/bin/lib/hooks/teardown-run.js
  - plugin/bin/lib/hooks/run-integrity.js
---

# Recover a Teardown With No Recorded Worktree

**Persona:** a build agent (human or automated) running `bin/hooks.js teardown-run` against a run whose worktree was entered via the harness-native `EnterWorktree` tool (dispatch's own sequential-execution path) but whose `record-worktree` stamp never landed in `run-state.json` — the gap #2362 describes.
**Goal:** get the stranded worktree, its branch, and its remote ref torn down by one `teardown-run` call, without falling back to a manual `git merge-base --is-ancestor` proof + `git worktree remove --force` + `git branch -D` + `gh api DELETE` sequence.
**Entry point:** `node bin/hooks.js teardown-run --run <run-dir> --merged`, run against a `run-state.json` that carries no `worktree` field (or `worktree: null`) at all.
**Success state:** the worktree is removed, its branch is deleted, and its remote ref is deleted — the CLI's own output names the recovery explicitly (`worktree: removed {path} (resolved via branch-name fallback — no worktree recorded in run-state.json)`) so the operator can tell an automatic recovery from an already-correct stamp.

## Steps

### 1. `teardown-run` reads the run's durable artifacts, not just `run-state.json`
- **Action:** `teardownRun` derives a branch name via `fallbackBranch(root, runDir, prevState)` — reading `state.pr.branch` (recorded by `record-pr`, independent of `record-worktree`) first, then falling back to the PR-early-lifecycle log lines already mandatory in `decisions.md` (`_shared/pr-early-run-lifecycle.md`'s Steps 2-3). This fallback only ever activates when `run-state.json` carries **no** `worktree` field at all — a run whose worktree WAS recorded but has since been removed (a reap, a manual `git worktree remove`) is deliberately left alone, skipping as "no branch recorded" exactly as it always has.
- **Should feel:** Automatic — the operator never has to know which of the two artifacts happened to survive.
- **Should understand:** This is a read-only recovery lookup, not a new stamping path — `EnterWorktree` itself is a harness-native tool this plugin cannot modify to call `record-worktree` inline; the proactive fix stays `build/worktree-setup.md`'s own unconditional Step 4.5 restamp, and this is the backstop for whatever crash or interrupt gets past it.
- **Red flags:** The fallback firing for a run whose worktree path is still recorded and simply stale — that would widen a previously-safe skip into a destructive delete (the exact regression AC9 in `tests/hooks-teardown-run.test.js` pins).

### 2. The recovered branch resolves the live worktree by name, never by guessing
- **Action:** `worktreePathForBranch(root, branch)` — the reverse of the existing `deriveBranch` (path → branch) — walks `git worktree list --porcelain` for the entry checked out on the recovered branch, excluding the main checkout and any dangling (prunable) entry by the same liveness rule `deriveBranch` already applies.
- **Should feel:** Precise, not probabilistic — a branch match is structurally unambiguous (git enforces one worktree per branch), so there is no "closest match" heuristic to distrust.
- **Should understand:** A recovered worktree is still subject to every existing safety check — `isWorktreeLocked` (a live session's own ground is never removed, `[IL-58]`), and `git worktree remove` without `--force` (a genuinely dirty stranded worktree still reports "removal failed", now with the git error text attached, rather than being forced away).
- **Red flags:** Any code path that would remove a worktree the lock check didn't clear, or that force-removes over uncommitted work.

### 3. Branch and remote-ref cleanup follow the same recovered name
- **Action:** Under `--merged`, `git branch -D {branch}` and the `gh api` refs-delete both key off the same recovered `branch` value Step 1 derived — no separate re-derivation, so the three cleanup actions (worktree, branch, remote ref) can never disagree about which branch they're acting on.
- **Should feel:** Complete in one call — the operator never has to run a second command to finish what the first one started.
- **Should understand:** `--abandoned` (or no mode flag) still skips branch/remote-ref deletion even when the branch was recovered — recovery only ever *finds* the target, it never changes the mode-gated decision to delete it.

## Origin
- Created during build of #2362 (EnterWorktree bookkeeping backstop)
- Steps 1-3 built in this session
- Related journeys: `recover-from-a-bookkeeping-stamp-deny.md` (the proactive-stamp side of the same worktree-association problem), `archive-a-stateless-run-dir-that-still-holds-its-spec.md` (a related but distinct run-dir-without-state recovery path)
