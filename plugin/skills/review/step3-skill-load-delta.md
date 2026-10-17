# Step 3j — Skill Load Delta (informational)

Loaded by `code-mode-steps.md`'s 3j pointer. Shows how this diff moves each skill entry point's per-invocation load:

- **floor** — the `SKILL.md`'s own bytes, paid on every invocation;
- **closure** — the floor plus every file reachable from it by a backticked `.md` citation or a `compose-context.js` source, transitively, each file once: the upper bound one invocation can load.

3j never changes the verdict, never adds a finding, and never skips silently — every path below renders one line or one table. Parent #3305 chose visibility over a gate: a load that grew is information for the reviewer, not a failure.

## When it runs

Every code-mode review, at every `review-effort` tier and every ceremony profile — it is one read-only CLI call.

## Command

From the checkout under review:

- Branch scope (the default): `node "${CLAUDE_PLUGIN_ROOT}/bin/load-delta.js"` — the base is the merge-base of `HEAD` with `origin/{integration-branch}` (`_shared/integration-branch.md`'s policy rank, else `origin/HEAD`).
- `base:{ref}` scope: `node "${CLAUDE_PLUGIN_ROOT}/bin/load-delta.js" --base {ref}`.

Plugin roots are discovered from the repository (every tracked `skills/*/SKILL.md` at the repo root or one directory down), so the same command covers this plugin's own corpus and a project's `.claude/skills/`.

## Render

Paste the CLI's output, verbatim, under the summary's `### Skill Load Delta` section (`review-summary-template.md`). It is exactly one of:

1. `Skill load delta: no skill files changed — skipped` — the diff touches nothing under any plugin root's `skills/`.
2. `Skill load delta: skill files changed, no entry point's load moved` — skill files changed, but none is in any entry point's closure (or the changes cancel out).
3. A table, headed `Skill load delta (base {sha}):`, with the columns `| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |` — one row per entry point whose floor or closure changed; `(added)`/`(removed)` mark entry points new at head or deleted.

Reading the table:

- A split that only moves text shows floor down and closure roughly unchanged (up by the pointer line) — a move, not a cut.
- A change to a `_shared/*.md` file shows on every entry point whose closure contains it.
- **New unresolved** lists backticked `.md` tokens the citation grammar could not resolve that were not unresolved at the base. Not an error — but if the reader really loads that file, its bytes are missing from the closure.

## Degrades

- `Skill load delta: no baseline (merge-base with {ref} unresolved) — skipped` — the CLI could not find the base (no `origin/{integration-branch}` ref in this checkout). Render the line as printed.
- The CLI exits non-zero (2 malformed invocation, 3 not a plugin root, 1 unexpected error): render `Skill load delta: not run — {first line of its stderr}`.
