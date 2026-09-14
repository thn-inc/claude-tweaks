---
name: ledger
description: Use when you need to create, update, query, or resolve open items in a pipeline ledger file, or standalone for ledger inspection. A knowledge dependency read by build/test/review/wrap-up/flow, never invoked via the Skill tool.
argument-hint: "[resolve [<feature-name>]|<feature-name>]"
---

# Ledger — Open Items Tracking

Manage the open items ledger that tracks findings, operational tasks, and observations across pipeline phases. The ledger is a markdown file that carries state between skills and survives context window compression. Utility skill — no fixed lifecycle position; called from build / test / review / wrap-up / flow, or standalone for inspection.

```
/claude-tweaks:capture → ... → /claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
                                       │                     │                       │                       │
                                       └─ creates/appends ───┴─ appends ─────────────┴─ appends ─────────────┴─ resolves all
                                                                       ▼
                                                          [ /claude-tweaks:ledger ] ← manages the file
                                                          ^^^^ YOU ARE HERE (called from above; standalone for inspection) ^^^^
```

## When to Use

- Called by other skills to create, append, update, query, or resolve ledger items
- Standalone: inspect the current ledger (`/claude-tweaks:ledger`)
- Standalone: trigger the nothing-left-behind gate (`/claude-tweaks:ledger resolve`)
- When you want to check for unresolved items outside the automatic resolve gates (`/claude-tweaks:wrap-up`'s Phase 3 ledger gate, `/claude-tweaks:flow` Step 5) — `/claude-tweaks:help` does not scan ledger files itself

## Input

`$ARGUMENTS` controls the operation:

| Argument | Behavior |
|----------|----------|
| *(none)* | Show current ledger status — counts by phase and status |
| `resolve` | Run the nothing-left-behind gate on the most recent ledger |
| `resolve {feature-name}` | Run the nothing-left-behind gate on the ledger matching `{feature-name}`, instead of defaulting to the most recent one |
| `{feature-name}` | Show ledger for a specific feature |

## Ledger File Format

Location, entry table format, and item-numbering rules: `_shared/ledger-format.md`'s Ledger File Format section.

## Status Lifecycle

Full state machine and terminal-status rules: `_shared/ledger-format.md`'s Status Lifecycle section.

## Phase Taxonomy

Phase schema, the full phase table, and the `reason-not-auto` qualifier rules for `ops`-phase items: `_shared/ledger-format.md`'s Phase Taxonomy section.

## Operations

### Create

Create a new ledger file. Called by `/claude-tweaks:flow` Step 1 or `/claude-tweaks:build` on first item.

```
File: docs/plans/YYYY-MM-DD-{feature}-ledger.md

# Open Items — {spec title or design topic}

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
```

If the file already exists (resuming a pipeline), read it and continue from the last item number.

### Add Item

Append a row to the ledger table.

**Required fields:**
- **Phase** — from the phase taxonomy above
- **Item** — description of the finding or task
- **Status** — typically `open` for new items, `observation` for informational QA caveats

**Optional:**
- **Resolution** — pre-filled for `observation` items, `—` for `open` items

**De-duplication:** per `_shared/ledger-format.md`'s De-duplication on Append rule — same phase + substantially similar description = skip the add and say so, never silently.

### Update Item

Change an item's status and/or resolution. Legal transitions, terminality, and the per-status resolution-text requirements: `_shared/ledger-format.md`'s Status Lifecycle section (Resolution-text requirements).

### Query

Read the ledger and filter by criteria:

| Query | Returns |
|-------|---------|
| By phase | All items matching a phase prefix (e.g., `review` matches `review`, `review/skill`, `review/hindsight`) |
| By status | All items with a specific status (e.g., all `open` items) |
| Open count | Number of items with status `open` |
| Summary | Counts by status: `Open: N | Fixed: N | Deferred: N | Accepted: N | Acknowledged: N | Observation: N` |

### Resolve Gate (Nothing-Left-Behind)

The critical gate that prevents dropped work — three phases (Phase 1 fix-exhaust → Phase 2 per-item user input → Phase 3 apply). Phase 1 opens with a re-check: an `open` item whose own cited reference (a commit, PR, or issue) already shows it resolved outside this run skips straight to a terminal status instead of spending a fresh fix attempt or a Phase 2 drill question on it — the mechanism for a low-confidence finding that was deliberately left open for human attention and got fixed in a later, separate PR. Full procedure: `_shared/ledger-format.md`'s Resolve Gate section. Phase 2 is on the "What `auto` does NOT silence" list in `_shared/auto-mode-contract.md`. Called by `/claude-tweaks:wrap-up`'s Phase 3 ledger gate and `/claude-tweaks:flow` Step 5.

### Delete

Delete the ledger file after all items are resolved. Called at `/claude-tweaks:wrap-up`'s Phase 4 execution step (planned in that phase's cleanup-planning step).

Only delete when the resolve gate has passed — all items must have terminal statuses.

## Standalone Usage

### `/claude-tweaks:ledger` (no arguments)

> **Parallel execution:** Use parallel tool calls aggressively — all `Glob`/`Read` operations across the matched ledger files are independent and should run concurrently.

1. Find active ledger files: glob `docs/plans/*-ledger.md`
2. For each ledger, show:
   ```
   ## {ledger name}
   Open: {N} | Fixed: {N} | Deferred: {N} | Accepted: {N} | Acknowledged: {N} | Observation: {N}
   ```
3. If open items exist, highlight them

### `/claude-tweaks:ledger {feature-name}`

1. Glob `docs/plans/*-ledger.md` and match `{feature-name}` against each file's `{feature}` slug (case-insensitive substring match — e.g. `auth` matches `2026-01-15-auth-refactor-ledger.md`)
2. If exactly one file matches, show its full item table
3. If multiple files match, list all matches (with their dates) and ask the user which one they mean
4. If no file matches, report `No ledger found for "{feature-name}"` and list the currently active ledgers (same glob as the no-arguments form) so the user can retry with a correct name

### `/claude-tweaks:ledger resolve`

1. Find the active ledger: if a `{feature-name}` is given (`resolve {feature-name}`), match it against `docs/plans/*-ledger.md` the same way the `{feature-name}` form does above — if no match, report `No ledger found for "{feature-name}"` and list the currently active ledgers instead of guessing. Otherwise, default to the most recent `docs/plans/*-ledger.md`.
2. Run the resolve gate procedure
3. Present results

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:wrap-up {spec}`** — wrap up the current work once all items are resolved (recommended)
`/claude-tweaks:ledger resolve` — re-run the nothing-left-behind gate if items remain open
`/claude-tweaks:help` — check overall pipeline status

## Invocation Model

`/ledger` is consumed as a **knowledge dependency** by `/build`, `/test`, `/review`, `/wrap-up`, and `/flow` — they read `_shared/ledger-format.md` (not this file) to learn the ledger file format and resolve-gate procedure, then write to `docs/plans/YYYY-MM-DD-{feature}-ledger.md` directly using file operations. There is no programmatic invocation API, so the standard Component-Skill Contract (which suppresses `## Next Actions` when a parent skill is driving the interaction via `$PIPELINE_RUN_DIR`) does not apply here: no parent skill ever invokes `/claude-tweaks:ledger` through the Skill tool, so every actual run of this skill's own procedure is a direct, standalone invocation — `## Next Actions` always renders. The format contract itself (entry schema, statuses, phase taxonomy, resolve-gate procedure) lives in `_shared/ledger-format.md` — this file covers only the two standalone human commands and the mutation operations (Create/Add/Update/Query/Delete).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Silently dropping open items | The resolve gate catches it — every item resolves explicitly |
| Bulk-resolving open items without per-item user input | Phase 2 requires an explicit per-item response — even for items that "obviously" belong parked, the user decides |
| Skipping Phase 1 (fix-exhaustion) and jumping straight to the user table | Items the agent could have fixed waste user attention and bias toward defer |
| Staging a work record proposal (`backlog` or `parked`) without per-item user confirmation | Each needs an explicit user choice on that item — not the agent's classification, not a bulk default, not `auto` mode |
| Using "out of scope of this plan" as a defer reason | If the file is in the build's diff, it's in scope. Pre-existing baseline failures use `accepted` with proof, not `deferred` |
| Deferring plan-prescribed routing as a ledger item | "X moves to P6" is plan documentation, not a ledger event — remove it, don't defer it; double-tracking is noise |
| Bundling small items into one umbrella ledger entry | Each item needs its own classification — bundles let items hide behind one decision |
| Resolving as "accepted" without a reason | Acceptance requires a stated rationale — "it's fine" is not one |
| Deferring items introduced by the current build | Fix what you introduced — defer is for pre-existing or genuinely larger scope |
| Creating duplicate ledger entries | Check semantic duplicates before adding — same phase + similar description = skip |
| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item |
| Modifying the ledger file format | Multiple skills parse the table — structural changes break them |
| Using the ledger for feature tracking | The ledger covers one pipeline run. Cross-spec/cross-run tracking belongs on the decomposition's parent record's `## Cross-Spec Promises` section (`_shared/work-record.md`). |
| Skipping the resolve gate | Non-negotiable — no pipeline completes with open items |
| Treating `auto` mode as authorization to bypass the resolve gate | Phase 2 always requires per-item user input; `auto` never silences it — see `_shared/auto-mode-card.md` |
