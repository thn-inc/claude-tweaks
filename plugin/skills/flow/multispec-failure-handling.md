# Multi-Spec — Failure Handling (default vs `keep-going`)

Loaded from `multi-spec.md`'s "Failure handling" pointer whenever a multi-spec run needs to reason about a HARD-GATE failure mid-run.

## Default — stop on first HARD-GATE

A gate failure in one spec stops the remaining specs. This is the compounding-risk default: spec N+1 may build on spec N's correctness, so continuing past a known failure is risky.

```
spec 157 — passed
spec 159 — FAILED at test (3 type errors)
spec 160 — not run (previous spec failed)
```

The consolidated Review Console still runs with whatever was accumulated up to the failure; specs 158-160 appear in the **Not run** footer with status `not-run`, reason `previous spec failed (159)`.

**Call site.** That footer and `multispec-review-console.md`'s claim-release step both read this status off `manifest.yml` — neither one derives it. Immediately after the failed spec's own `spec-status --status failed` call (`multispec-progress-banner.md`'s per-spec completion summary), and before presenting the consolidated Review Console, `/flow` calls, once per remaining un-run spec `{n}` (in list order, skipping any spec that already reached `running` or a terminal status):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" spec-status --run "$MULTISPEC_PARENT_DIR" --spec {n} --status not-run --phase build
```

`--phase build` is a fixed placeholder — a spec that never started has no real phase to name, and `transitionSpec` requires a non-empty `--phase` regardless. This call emits no `summaryLine` (`not-run` isn't `complete`/`failed` — see `plugin/bin/lib/flow/manifest.js`'s `transitionSpec`), only the phase-progress banner; that's expected and does not need suppressing. Without this call, `manifest.yml` leaves each skipped spec's status at whatever it was before the run (typically `pending`), so the Review Console's footer and the claim-release step both silently miss it — the footer renders it as still-pending work instead of skipped, and the claim-release step's `not-run` branch (`multispec-review-console.md`) never fires, leaking the spec's issue claim.

## `keep-going` — continue on failure

When the user passes `/flow 157,159,160 keep-going`, HARD-GATE failures in one spec **do not** stop subsequent specs — each runs to completion (or fails on its own gate) and the consolidated console surfaces all outcomes together.

```
spec 157 — passed
spec 159 — FAILED at test (3 type errors) — continued anyway
spec 160 — passed
```

The consolidated Review Console's **Not run / Failed** footer distinguishes:

| Spec | Status | Reason |
|---|---|---|
| 159 | failed | test gate (3 type errors) — see `spec-159/decisions.md` for details |

This is **opt-in** — it inverts the compounding-risk safety. Use when:
- Specs are genuinely independent (no `blocked-by:` edges)
- You want to see all failures together rather than fix-and-retry serially
- A batch of small refactors where one failing doesn't invalidate the others

Do NOT use `keep-going` when specs have `blocked-by:` relationships — the failed spec's downstream may compound the bug. The dependency check above doesn't auto-disable it, but a warning surfaces in the Pipeline Preview footer:

```
keep-going + dependencies: spec 159 depends on 157 — if 157 fails, 159 may also fail or produce incorrect output. Consider running without keep-going.
```

## Interaction with worktree mode

The run shares **one worktree** (see "Shared worktree" in `multi-spec.md`) — no per-spec worktree to discard or preserve. A failed spec leaves its commits in the shared branch:

- **Default mode** — the shared worktree contains commits up to and including the failed spec; subsequent specs don't run. The branch is **not** finished automatically; the consolidated console notes the path for the user to inspect before merging or discarding.
- **`keep-going`** — subsequent specs keep committing into the same shared branch atop the failed spec's commits, compounding its state into later specs (same risk as current-branch mode) — why it's opt-in, meant for independent specs.

The consolidated console's **Not run / Failed** footer notes the shared worktree path:

```
| 159 | failed | test gate (3 type errors) — shared worktree at `.worktrees/flow/spec-157-159-160` preserved; inspect before finishing |
```

The user finishes or discards the single shared branch after triage (`/superpowers:finishing-a-development-branch`).

## Parallel waves (`parallel`, #2677)

A HARD-GATE failure in one wave member's build or test never cancels its wave siblings mid-flight — each finishes build and test in its own isolated worktree. A member that failed its HARD-GATE is **never merged** into the shared branch, in either mode — so unlike a sequential run, its commits never reach the specs after it.

- **Default** — the stop applies at the wave boundary: no sibling is merged back and no later wave starts.
- **`keep-going`** — the passing siblings merge back and the run continues, but every in-run record that depends on the failed member, transitively, in a later wave is **dropped from the run** (`not-run`, reason `prerequisite #{N} failed`) — exactly as the merge-state gate drops a deferred record's dependents — since it would otherwise build without its prerequisite.

Every member worktree that is not merged — the failed member, each sibling under the default stop, and a member that conflicted at merge-back and then failed its sequential re-run — is removed with `git worktree remove {worktreePath}`, and its branch is **kept**. The console's "Not run / Failed" footer names each kept branch as `(branch {name})`.
