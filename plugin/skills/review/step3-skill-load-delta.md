# Step 3j — Skill Load Delta (informational)

Loaded by `code-mode-steps.md`'s 3j pointer. Shows how this diff moves each skill entry point's per-invocation load:

- **floor** — the `SKILL.md`'s own bytes, paid on every invocation;
- **closure** — the floor plus every file reachable from it by a backticked `.md` citation or a `compose-context.js` source, transitively, each file once: the upper bound one invocation can load.

3j never changes the verdict, never adds a finding, and never skips silently — every path below renders one line or one table. Parent #3305 chose visibility over a gate: a load that grew is information for the reviewer, not a failure.

## When it runs

Every code-mode review, at every `review-effort` tier and every ceremony profile — it is one read-only CLI call.

## Command

From the checkout under review:

- Branch scope (the default): `node "${CLAUDE_PLUGIN_ROOT}/bin/load-delta.js" --integration-branch {integration-branch}`, where `{integration-branch}` is the branch review Step 2 already resolved (`_shared/integration-branch.md`). Without `--integration-branch`, the CLI falls back to the shared resolver itself (`worktree-reap.js`'s `resolveIntegrationBranch`: policy `integration-branch`, else `origin/HEAD`) — never a guessed `main`.
- `base:{ref}` scope: `node "${CLAUDE_PLUGIN_ROOT}/bin/load-delta.js" --base {ref}`.

Plugin roots are discovered from the repository (every tracked `skills/*/SKILL.md` at the repo root or one directory down), so the same command covers this plugin's own corpus and a project's `.claude/skills/`.

## Render

Paste the CLI's output, verbatim, under the summary's `### Skill Load Delta` section (`review-summary-template.md`). It is exactly one of:

0. `Skill load delta: no plugin roots discovered — skipped (pass --plugin-root <dir>)` — no `skills/*/SKILL.md` root exists at the repo root or one directory down (a deeper layout, e.g. `plugins/foo/skills/s/`, does not count as a root — the depth-≤1 discovery rule also excludes tracked test fixtures). If a baseline resolved and the diff touches any path matching `(^|/)skills/[^/]+/`, the line gets the suffix `— skill files changed under {parent}`, naming the first such parent directory, so a deep layout never silently reads as "nothing changed" — pass `--plugin-root <dir>` to actually measure it.
1. `Skill load delta: no skill files changed — skipped` — the diff touches nothing under any plugin root's `skills/`.
2. `Skill load delta: skill files changed, no entry point's load moved` — skill files changed, but none is in any entry point's closure (or the changes cancel out). If a changed skill file lies under no discovered root (same deep-layout case as outcome 0, but mixed in alongside roots that *were* discovered), the line gets the suffix `(also changed outside discovered roots: {parent}; pass --plugin-root to measure)`.
3. A table, headed `Skill load delta (base {sha} = merge-base with origin/{name}):` (branch scope) or `Skill load delta (base {sha} = --base {ref}):` (`base:{ref}` scope), with the columns `| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |` — one row per entry point whose floor or closure changed, except that entry points with the same ΔFloor, ΔClosure, and New unresolved share one row, `{count} entries: {e1}, {e2}, {e3}, … +{k} more` (the first three names; the `… +{k} more` tail only past three), whose Floor and Closure cells show the `min–max` range across its members (one value when every member's is the same); `(added)`/`(removed)` mark entry points new at head or deleted.

Reading the table:

- A split that only moves text shows floor down and closure roughly unchanged (up by the pointer line) — a move, not a cut.
- A change to a `_shared/*.md` file shows on every entry point whose closure contains it. Those entries usually share one grouped row; an entry point listed on its own row moved by a different amount.
- **New unresolved** lists backticked `.md` tokens the citation grammar could not resolve that were not unresolved at the base. Not an error — but if the reader really loads that file, its bytes are missing from the closure. A placeholder or glob token (`` `skills/*/SKILL.md` ``, `` `{n}-spec.md` ``, `` `<x>.md` ``) never appears here — it is not a citation to a real file.

## Degrades

- `Skill load delta: no baseline (integration branch unresolved — pass --integration-branch) — skipped` — neither `--base` nor `--integration-branch` was given and the shared resolver found no integration branch. The CLI never guesses `main`.
- `Skill load delta: no baseline (merge-base with {ref} unresolved) — skipped` — a branch resolved (via `--integration-branch` or the shared resolver) but `origin/{ref}` has no merge-base with `HEAD` in this checkout. Render the line as printed.
- The CLI exits non-zero (2 malformed invocation, 3 not a plugin root, 1 unexpected error): render `Skill load delta: not run — {first line of its stderr}`.
