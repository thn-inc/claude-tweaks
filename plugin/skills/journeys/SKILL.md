---
name: journeys
description: Use when you want to create or update user journey documentation for recently built features. Works standalone or as a step within /claude-tweaks:build.
argument-hint: "[<spec-number>|<file-path>...|--journey <name>]"
---

# Journeys — User Journey Documentation

Create or update journey files for features that have been built. Journeys document how personas interact with the system — they're what visual review tests against and what QA stories are generated from. Part of the workflow lifecycle:

```
/claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
       │
[ /claude-tweaks:journeys ]
 (after implementation)
```

## When to Use

- After building a feature — document the user flow it enables
- After modifying existing flows — update affected journeys
- When journey files are missing for existing features
- When `/claude-tweaks:review` flags missing journey coverage
- During `/claude-tweaks:build` Common Step 6 — invoked automatically

## Input

`$ARGUMENTS` controls scope.

### Standalone (invoked directly):

1. **Spec number** (e.g., `42`) — analyze files changed for that spec
2. **File paths** — analyze those specific files for journey impact
3. **`--journey <name>`** — target one existing (or new) journey directly by name, bypassing Step 1's scope resolution entirely — routes straight to Step 3 (Update Existing Journey Files) against `docs/journeys/{name}.md` if it exists, or Step 2 (Create New Journey Files) using `{name}` if it doesn't. This is the form `/claude-tweaks:journey-health` uses when recommending a re-run against a specific journey slug.
4. **No arguments** — resolve scope per `_shared/scope-resolution.md`'s deterministic fallback ladder

```
/claude-tweaks:journeys                       → analyze recent changes for journey impact
/claude-tweaks:journeys 42                    → journeys for spec 42's changes
/claude-tweaks:journeys src/app/checkout/     → journeys for checkout-related files
/claude-tweaks:journeys --journey checkout-flow → update the checkout-flow journey directly
```

### Pipeline context (invoked by parent skill):

The parent skill passes:
- **Changed files** — files modified during the build
- **Spec or design doc context** — what was built and why

## Step 1: Determine Affected Journeys

> **Parallel execution:** Use parallel tool calls aggressively — all Read operations on journey files and changed source files are independent and should run concurrently.

**`--journey <name>` exception:** skip this step entirely. Check whether `docs/journeys/{name}.md` exists — if it does, go straight to Step 3 (Update Existing Journey Files); if it doesn't, go straight to Step 2 (Create New Journey Files) using `{name}` as the journey-name. No scope resolution, existing-journey scan, or "no interaction surface" check applies — the caller already named the target.

Otherwise, analyze what was built and identify journeys it enables or modifies — for any persona (end users, admins, developers, internal tooling users):

1. **Resolve scope** — from arguments, parent context, or git diff
2. **Scan existing journeys** — read `docs/journeys/*.md` to see if any existing journey includes pages, flows, features, CLI commands, or APIs that were just built or changed
3. **Identify new journeys** — if the work introduces a new flow for any persona that doesn't map to an existing journey, a new journey file is needed
4. **Evidence checklist before concluding "no interaction surface"** — before reporting "No user-facing journeys affected" and stopping, check the diff against these 3 signals. Any single hit (OR, not AND across all three) disqualifies that conclusion:
   - **Signal 1 — Direct invocation surface:** does the diff touch a route/page/API endpoint/CLI command/exported function directly invoked by an end user, admin, or developer-user?
   - **Signal 2 — Observable output:** does the diff change any user-observable output (new field, error message, flag, response shape)?
   - **Signal 3 — Reachable capability:** does the diff add/remove/rename a capability reachable without reading source (a slash command, a CLI subcommand, a UI element)?

   **No signal fires** → report "No user-facing journeys affected" and stop.

   **Any signal fires** → the "no interaction surface" conclusion is disqualified. Re-examine items 2-3 above (the existing-journey scan and new-journey-need assessment) specifically in light of the fired signal(s) — don't let their earlier pass stand unquestioned. If that re-examination still concludes no journey update is warranted, log a one-line rationale citing which signal(s) fired and why the resulting change genuinely has no persona-visible effect worth documenting (e.g. "signal 1 fired — touches CLI command X, but X's behavior is unchanged, only an internal refactor of its implementation") before reporting "No user-facing journeys affected" — a disqualified case still needs its own evidence-anchored conclusion, not a silent return to the old unanchored judgment call.

## Step 2: Create New Journey Files

**Existing-convention check, before writing.** Read `doc-convention-journey` via the canonical read path (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" doc-convention-journey` — `_shared/policy-schema.md`) and branch on the JSON envelope, the same pattern `wrap-up/adr-curation.md` Step 3 uses for the `adr` genre: `source: "policy"` means the key is set, so use the recorded value and skip detection entirely; `source: "default"` means it is unset, so read `_shared/existing-convention-detection.md` and run its procedure for the `journey` genre against `docs/journeys/` (its declared alias in `_shared/diataxis-genre-templates.md`'s Genre declarations table). A `plugin` outcome (no existing convention, or fewer than 3 files) proceeds silently — this is the common case, since journeys are plugin-native and prior art is unlikely.

On a `conflict` outcome, this **is** the approval gate `/claude-tweaks:journeys` previously lacked — but a naming-convention question is not a HARD-GATE, so it must not become a new mid-flow stop under `auto` mode (`_shared/auto-mode-contract.md`). Route by whether a pipeline run directory is active, the same split Step 3.5 below already uses for self-review issues:

- **Auto mode (`$PIPELINE_RUN_DIR` set)** — stage the conflict to `staged/journeys-convention.md` (one file per run; a genre-generic `[journey-convention]` row per `wrap-up/console-template.md`'s render template) and continue this run using the plugin's default path — do not block the write. Append to the auto-decision log under the `## /journeys` heading in `{run-dir}/decisions.md` (per `_shared/auto-decision-log.md`):

  ```
  - STAGED {HH:MM:SS} — Step 2: journey naming convention conflict ({plugin form} vs {found form}, {N} existing). Stage path: staged/journeys-convention.md. Reversibility: high.
  ```

  The Wrap-Up Review Console picks this row up alongside any other `[{genre}-convention]` rows from the same run, resolves it via the same three-way prompt `adr-curation.md` uses, and writes `doc-convention-journey: {plugin|project}` to `.claude-tweaks/policy.yml` (`wrap-up/execution-and-verification.md`'s Genre convention resolution step) — including, on a `Migrate` answer, renaming this run's own newly-created journey files as part of that batch.
- **Interactive mode, or invoked standalone with no `$PIPELINE_RUN_DIR`** — there is no Review Console downstream to route through, so ask directly via `AskUserQuestion` (per this skill's own Interaction style, above) before writing anything: `question`: `"This repo's existing journey files disagree with the plugin's naming convention. Which form should new journeys use?"`, options `Conform forward (Recommended)` (`doc-convention-journey: plugin`), `Keep project form` (`doc-convention-journey: project`, resolve the actual filename from the found grammar per `_shared/existing-convention-detection.md`'s evidence-split table), `Migrate` (rename existing journey files to the plugin's form as one itemized batch, same procedure as `wrap-up/execution-and-verification.md`'s Genre convention resolution step). Record the answer directly to `.claude-tweaks/policy.yml` as `doc-convention-journey: {plugin|project}`.

For each new journey identified, create a file at the resolved path (`docs/journeys/{journey-name}.md` under the plugin form, or the resolved project-form filename once known — the plugin form for this run when a conflict was staged rather than resolved) using the template + key principles in `journey-template.md` in this skill's directory. The template covers frontmatter, persona/goal/entry-point/success-state framing, the per-step structure (URL / Action / Should feel / Should understand / Red flags), and the Origin trailer.

**Multi-spec shared worktree (#786):** when this invocation is running inside a multi-spec `/flow` run's shared worktree (`MULTISPEC_SHARED_WORKTREE=1` is set, or `$PIPELINE_RUN_DIR`'s basename is `spec-{N}`), suffix `{journey-name}` with `-{N}` before writing — `docs/journeys/{journey-name}-{N}.md` — so two specs whose generated journey names collide (or one spec that happens to reuse another's slug) never overwrite each other's file. `{N}` is the record id, same as `flow/multi-spec.md`'s `spec-{N}/` subdirectory keying. Outside a multi-spec shared worktree, write the unsuffixed `docs/journeys/{journey-name}.md` exactly as before — this rule changes nothing for a single-spec `/flow` run.

## Step 3: Update Existing Journey Files

If the work modifies or extends an existing journey:

1. Read the existing journey file
2. Add, update, or reorder steps to reflect what was built
3. Update the `files:` frontmatter — add new source files, remove files that are no longer relevant
4. Update the Origin section to reference the current build
5. Preserve existing "Should feel" and "Red flags" for steps that weren't changed — those are tested expectations

## Step 3.5: Journey Self-Review

Before committing, look at the journey file(s) with fresh eyes. Fix issues inline — no subagent.

Apply the four checks and the structural-validity check in `_shared/journey-self-review.md` (shared with `/claude-tweaks:journey-health`'s audit-time check and `/claude-tweaks:wrap-up`'s Journeys curation row).

**Decision gate:** make one fix attempt per issue. Issues that remain after one fix attempt route by mode:

**Auto mode** (pipeline run directory exists): stage unresolved issues to `staged/journeys-{journey-slug}.md` (one file per journey, using the journey's kebab-case slug) and continue — journey files are documentation, not code, so a stale persona or vague success state must not block the pipeline. The Wrap-Up Review Console surfaces the staged file for batch approval. Append to the auto-decision log under the `## /journeys` heading in `{run-dir}/decisions.md` (per `_shared/auto-decision-log.md`):

```
- STAGED {HH:MM:SS} — Step 3.5: {N} journey self-review issues remain after one fix attempt. Stage path: staged/journeys-{journey-slug}.md. Reversibility: high.
```

Only BLOCK when the journey file is structurally invalid (missing required frontmatter, missing `## Steps` heading, no steps at all) — those are degraded output the caller must address before continuing.

**Interactive mode:** return control to the caller with status `BLOCKED` and the unresolved issues:

```
BLOCKED
Reason: journey self-review issues remain after one fix attempt.
Unresolved:
- {issue 1, file:line if applicable}
- {issue 2, ...}
Next: caller decides whether to escalate, defer, or accept.
```

> The `BLOCKED` status word here matches the Subagent Contract's `BLOCKED` (one of `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`). When `/claude-tweaks:journeys` is invoked from a parent skill (e.g., `/claude-tweaks:build`), the parent treats `BLOCKED` exactly like any other subagent BLOCKED — diagnose and re-dispatch with more context, or escalate. When invoked directly by a user, render the same block — the user is the "caller" who decides next steps.

Do NOT loop on fix attempts or silently ship a journey with known self-review issues.

## Step 3.6: Diagram Suggestion

Read the `diagram-suggestions` flag from CLAUDE.md (written by `/claude-tweaks:init` Step 12). When the flag is `disabled` or missing, skip this step silently.

When the flag is `enabled`, scan the journey file(s) just written/updated and detect the strongest signal:

| Journey contains | Signal | Suggested type |
|------------------|--------|-----------------|
| 2+ named personas or roles handing off between steps | `multi-persona` | `swimlane` |
| 3+ branches with named conditions (`If …`, "When the user is …", success-vs-error paths) | `decision-tree` | `flowchart` |
| 2+ external services / APIs the user passes through in sequence | `multi-actor` | `sequence` |
| None of the above | — | Skip — emit no recommendation |

Emit at most one recommendation per journey. Place the block above the "Step 4: Commit" output, prefixed `### Diagram suggestion`:

```
### Diagram suggestion

**Diagram suggestion:** This journey (`checkout-flow`) crosses 2 personas
(shopper → support agent). Consider a swimlane diagram:
`/claude-tweaks:visualize swimlane checkout-flow --source journeys`
```

The user decides whether to act — this is advisory, not automatic.

## Step 4: Commit

Commit journey files separately from implementation code. When a single invocation touches multiple journeys (see Step 5's Report table), commit each journey file separately — one commit per journey, using that journey's own name in the message — rather than one combined commit; this keeps `git log` traceable to a single journey per entry and matches the "separately from implementation code" rule at the file-granularity level, not just the code/docs boundary.

### Working Directory Discipline

Apply the Working Directory Discipline rule from `_shared/subagent-dispatch-core.md` before any `git` command. On mismatch, return **BLOCKED** to the caller; do not commit from the wrong directory. Also follow `_shared/git-discipline.md` for the Git Rules.

### Commit commands

```
# Preferred when $WORKTREE is set:
git -C "$WORKTREE" add docs/journeys/{journey-name}.md
git -C "$WORKTREE" commit -m "Add/update {journey name} journey"

# Otherwise (after pwd verification above):
git add docs/journeys/{journey-name}.md
git commit -m "Add/update {journey name} journey"
```

## Step 5: Report

```
### User Journeys

| # | Journey | Action | Steps | Persona |
|---|---------|--------|-------|---------|
| 1 | {name} | Created | {N} steps | {persona} |
| 2 | {name} | Updated | +{N} steps, {M} modified | {persona} |
```

(or: "No user-facing journeys affected.")

## Next Actions

When invoked directly (not by a parent skill), render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:stories`** — generate QA stories from journeys (recommended)
`/claude-tweaks:visual-review journey:{name}` — visual review of a journey
`/claude-tweaks:test {spec}` — verify implementation

When invoked by a parent, omit Next Actions — the parent handles flow control.

## Component-Skill Contract

This skill is a **component skill** — invoked by `/claude-tweaks:build` (Common Step 6). Parent invocation is signaled by `$PIPELINE_RUN_DIR` being set (the parent is running inside an active pipeline run). When invoked by a parent, omit the `## Next Actions` block — the parent owns the handoff. When invoked directly by a user (no `$PIPELINE_RUN_DIR`), render Next Actions as shown above.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Skipping journey capture for features with an interaction surface | No journey, no QA anchor for visual review. Every persona counts: end users, admins, developers, internal tooling users. |
| Concluding "no interaction surface" without checking the 3-signal evidence checklist | Unanchored judgment scored zero true positives here (`docs/journeys/` never existed) — Step 1 item 4's checklist keeps the call evidence-anchored |
| Writing journeys with vague "should feel" | "Good" and "intuitive" are not testable. "Low commitment" and "like an accomplishment" are. |
| Writing a journey with no `## Steps` heading | Step 3.5 self-review BLOCKs on structurally-invalid files, and missing `## Steps` is the top cause — always render it, even for a short step list. |
| Asking the user whether to create a journey | Capture is automatic — the user didn't know they needed the spec either. |
| Listing every source file in `files:` | Only files whose changes affect the journey's behavior — key components, API routes, pages. |
| One journey per feature instead of per goal | A journey may span multiple specs — organize by user goal, not implementation boundary. |
| Skipping update of existing journeys | A build that modifies a flow must update its journey — stale journeys give false regression signals. |
