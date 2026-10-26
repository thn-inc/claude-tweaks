---
files:
  - plugin/skills/dispatch/SKILL.md
  - plugin/bin/hooks.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/budget.js
---

# Reap Merged Worktrees at the End of a Drain

**Persona:** A maintainer of a large claude-tweaks-managed repo (dozens of worktrees, run dirs, and local/remote branches) who fires a bare `/claude-tweaks:dispatch --budget {n}` drain, or has a Routine fire it, and expects the firing to clean up after the groups it merged.
**Goal:** When the drain ends, every worktree whose PR merged during this firing is reaped and its run dir archived by the firing itself — not left for a future session's SessionStart hook.
**Entry point:** The drain loop in `plugin/skills/dispatch/SKILL.md` Step 3 reaches termination (`{budget}` attempts spent, or the ranking returns `null`).
**Success state:** The termination reconcile's JSON result, logged to `decisions.md`, shows `reap` (and `release`/`archive`) ran — no `budget-exceeded` skip naming `reap` — and the merged groups' worktrees are gone from `git worktree list`.

## Steps

1. **Drain reaches termination** — The firing has dispatched its groups; some PRs merged immediately, some were armed and merged later on GitHub.
   - **Action:** Dispatch closes its own minted run dir (`close-run`), then runs `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --checks mirror,release,archive,reap` with the same 150000ms+ timeout as Step 2's first reconcile call.
   - **Should feel:** Like housekeeping that simply happens — no prompt, no extra wait beyond a narrow fetch and the three cleanup checks.
   - **Should understand:** The call is scoped on purpose: `mirror` fetches the integration branch (single ref) so `archive` can see a PR GitHub merged asynchronously; the `--prune` all-refs fetch, `archive-branches`, and `remote-prune` are left out.
   - **Red flags:** The call runs unscoped again (an unscoped call runs `reap` last under the 18 s hot-path budget, so a slow pass on a large repo can still skip it as `budget-exceeded`; since #4032 it also hands `archive-branches`, `remote-prune` and `ledger-residue` to a detached background pass instead of running them); the call is backgrounded or has no explicit timeout and strands the firing.

2. **The explicit subset runs to completion** — The `hooks.js reconcile` CLI sees a non-empty `--checks` list.
   - **Action:** `reconcile()` first expands the subset with its prerequisites (`expandChecks`, #3630). A list naming `archive` or `red-tip` but neither `mirror` nor `remote-prune` gains `mirror` just ahead of it, so `--checks release,archive,reap` expands to `release,mirror,archive,reap` and executes as `mirror,release,archive,reap`. Nothing else is widened, and `DISPATCH_ORDER` sets the run order. The CLI then passes an unbounded time ceiling to `reconcile()` (`opts.budgetMs = Infinity` → `createBudget(Infinity)`), so the 18 s hot-path budget that guards SessionStart never cuts the named checks short. Unscoped CLI runs and SessionStart keep the 18 s default. The detached background pass runs under its own 120 s ceiling (`BACKGROUND_BUDGET_MS`, #4032).
   - **Should feel:** Predictable. A check the caller named runs, and so does the fetch it depends on, even when the caller forgot to name `mirror`.
   - **Should understand:** Runtime is now bounded by each check's own per-call timeouts and the caller's Bash timeout, not by the 18 s ceiling. That is why every scripted `reconcile --checks …` caller keeps a generous explicit timeout. The JSON result carries a `mirror` entry whenever the subset was expanded, even though the caller never named `mirror`. That entry is the prerequisite, not a widened sweep.
   - **Red flags:**
     - The JSON result still lists `reap` under `skipped` with reason `budget-exceeded`.
     - A SessionStart reconcile suddenly takes much longer, because the default ceiling leaked into the unbounded path, or the reverse.
     - `--checks reap` alone starts fetching.
     - A subset that already names `remote-prune` gains a second fetch.

3. **Read the outcome** — The firing logs the JSON result to `decisions.md`.
   - **Action:** The maintainer (or the next session) reads the termination reconcile entry and `git worktree list`.
   - **Should feel:** Confident the firing left nothing of its own behind.
   - **Should understand:** Any remaining skip carries its own stated reason (a locked worktree with a live owner, `local-behind-merge` if the narrow fetch itself failed), never a silent budget cut.
   - **Red flags:** Merged groups' worktrees survive the firing with no skip reason; run dirs of async-merged PRs stay unarchived although their merge commit is on `origin`.

## Outcome

A drain on a large repo reaps the worktrees it merged before it exits, because an explicit `--checks` subset is never starved by the SessionStart budget and the termination call fetches just enough for `archive` to recognize late merges.

_Origin: record #3026 (reconcile's 18 s budget starved `reap` even under an explicit `--checks` subset), built 2026-10-19. Updated by record #3630, built 2026-10-22: an explicit subset is now expanded with its prerequisites, so naming `archive` without `mirror` no longer skips async-merged PRs as `local-behind-merge`. Updated by record #4032, built 2026-10-24: the unscoped call defers three janitorial checks to the background pass, which gained its own 120 s ceiling._
