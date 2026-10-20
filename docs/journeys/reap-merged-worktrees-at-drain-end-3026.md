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
   - **Red flags:** The call runs unscoped again (it would spend the budget on the `--prune` fetch on a large repo); the call is backgrounded or has no explicit timeout and strands the firing.

2. **The explicit subset runs to completion** — The `hooks.js reconcile` CLI sees a non-empty `--checks` list.
   - **Action:** The CLI passes an unbounded time ceiling to `reconcile()` (`opts.budgetMs = Infinity` → `createBudget(Infinity)`), so the 18 s hot-path budget that guards SessionStart never cuts the named checks short. Unscoped CLI runs, SessionStart, and the background pass keep the 18 s default.
   - **Should feel:** Predictable — a check the caller named is a check that runs.
   - **Should understand:** Runtime is now bounded by each check's own per-call timeouts and the caller's Bash timeout, not by the 18 s ceiling — which is why every scripted `reconcile --checks …` caller keeps a generous explicit timeout.
   - **Red flags:** The JSON result still lists `reap` under `skipped` with reason `budget-exceeded`; a SessionStart reconcile suddenly takes much longer (the default ceiling leaked into the unbounded path, or vice versa).

3. **Read the outcome** — The firing logs the JSON result to `decisions.md`.
   - **Action:** The maintainer (or the next session) reads the termination reconcile entry and `git worktree list`.
   - **Should feel:** Confident the firing left nothing of its own behind.
   - **Should understand:** Any remaining skip carries its own stated reason (a locked worktree with a live owner, `local-behind-merge` if the narrow fetch itself failed), never a silent budget cut.
   - **Red flags:** Merged groups' worktrees survive the firing with no skip reason; run dirs of async-merged PRs stay unarchived although their merge commit is on `origin`.

## Outcome

A drain on a large repo reaps the worktrees it merged before it exits, because an explicit `--checks` subset is never starved by the SessionStart budget and the termination call fetches just enough for `archive` to recognize late merges.

_Origin: record #3026 (reconcile's 18 s budget starved `reap` even under an explicit `--checks` subset), built 2026-10-19._
