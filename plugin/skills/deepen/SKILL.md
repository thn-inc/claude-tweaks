---
name: deepen
description: Use for an architectural-depth pass on recently changed code — finds shallow modules and proposes deepening or collapsing them, ranked by leverage. Standalone, or surfaced by /review and /reflect.
argument-hint: "[<file-or-dir>...|<spec-number>] [--kind deepen|collapse]"
---

# Deepen — Architectural Depth Pass

Find shallow modules and make them deeper. `/claude-tweaks:simplify` cleans up *within* files (verbose patterns, dead code, line-level complexity); `/claude-tweaks:deepen` works at the *module* level — it asks whether each abstraction earns its keep, and proposes deepening the ones that leak or collapsing the ones that only move complexity around. Architecture entropy is the silent tax on AI-assisted development; this is the pass that catches it. Part of the workflow lifecycle:

```
/claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
                                                     │
                                          [ /claude-tweaks:deepen ]
                                       (standalone, or surfaced as a Next Action
                                        by /review and /reflect on structural signals)
```

## When to Use

- A codebase has been moving fast under agent assistance and you want to catch architectural rot before it sets — run it every few days, not every build
- `/claude-tweaks:review` lens 3e (Architecture) or `/claude-tweaks:reflect`'s structural-debt lens flagged shallow abstractions, wrong boundaries, or pass-through wrappers
- After a feature lands and you suspect the new module surface is wider than it needs to be
- You're about to build on top of a module and want to know whether to deepen it first
- The user says "is this abstraction pulling its weight?", "this feels over-engineered", or "should this module exist?"

This is **not** a code-quality or bug pass — use `/claude-tweaks:review` for correctness and `/claude-tweaks:simplify` for line-level cleanup. `/deepen` only judges module depth.

## Input

`$ARGUMENTS` controls scope.

### Standalone (invoked directly):

1. **File paths or directories** — analyze module depth across those files
2. **Spec number** (e.g., `42`) — scope to files changed for that spec
3. **No arguments** — resolve scope per `_shared/scope-resolution.md`'s deterministic fallback ladder, stating which rung resolved it in the run's opening line

```
/claude-tweaks:deepen                       → analyze recently changed modules
/claude-tweaks:deepen src/payments/         → analyze modules under that directory
/claude-tweaks:deepen 42                     → analyze modules changed for spec 42
/claude-tweaks:deepen --kind collapse       → analyze recently changed modules, but Step 3 presents only collapse candidates
```

4. **`--kind deepen|collapse`** (optional, combinable with any of the above) — scope Step 3's presented candidates to one kind. See Step 3's "Filtering by kind" note for exactly what this includes and excludes.

### Pipeline / parent context:

A parent skill (or the user) may pass a file scope and a structural seed (e.g., the architecture finding that prompted the pass). Analyze only the provided scope — never expand to the whole codebase. A whole-repo depth audit is out of scope for this skill; it reviews recent work.

## Vocabulary Contract

This skill uses a controlled vocabulary so proposals stay precise and comparable: **module, interface, implementation, depth, seam, adapter, leverage**. Do not drift into `component`, `service`, `API` (unless it literally means a network API), or `boundary`. Definitions live in `_shared/criteria-architecture-depth.md` (the shared depth criteria). `depth-analysis.md` shows how `/deepen` applies them. Inconsistent language is the failure that makes refactor proposals impossible to weigh against each other.

## Step 1: Resolve Scope and Map Modules

> **Parallel execution:** Use parallel tool calls aggressively — read all in-scope files and their call sites (Grep for importers) concurrently. Depth is judged from call sites, so gather them before analyzing.

1. Resolve the file scope (see Input). Filter to source files — skip generated files, lock files, tests, and config. Also skip any resolved path that no longer exists on disk (a deleted file) — there is no interface left to judge depth on; a module's removal is not a depth question.
2. For each in-scope module, read its interface (exports) and locate its call sites (`grep` for imports of its exports).
3. If no source files are in scope (including when every resolved path was a deletion), state: "No changed modules to analyze." and stop.

## Step 2: Find Shallow Modules

Apply the depth criteria in `_shared/criteria-architecture-depth.md`; `depth-analysis.md` (this skill's directory) shows how those criteria map onto Steps 2-4:

1. **Judge depth as leverage** — how much behavior each caller exercises per unit of interface it must learn. Not a line ratio. Make the judgment from the call sites.
2. **Run the deletion test** on each suspected-shallow module — would deleting it *concentrate* complexity (it earns its keep — not a candidate) or *just move* it (shallow — a candidate)?
3. **Classify each candidate** as a **deepen** opportunity (a real abstraction that leaks) or a **collapse** opportunity (a pass-through that only moves complexity). Report each as what it is — never dress a collapse up as a deepening.

## Step 3: Rank and Present Candidates (Stage 1 of 2)

Rank candidates by leverage per unit of churn (callers affected, interface shrink, blast radius — see `_shared/criteria-architecture-depth.md`). Present them as a numbered list. **Do not propose interfaces yet** — present *what* is shallow and *why*, then ask which to explore. Proposing concrete interfaces for every candidate up front is the runaway-rewrite this skill exists to prevent.

**Decline memory.** Before presenting, read `.claude-tweaks/deepen/declines.md` — anchored at the main checkout (resolve the repo root the same way `_shared/pipeline-run-dir.md`'s Anchoring section resolves `$RUN_ROOT`; a worktree-relative read silently misses the durable copy). A missing file is an empty memory, not an error. Each line records one previously declined candidate:

```
- {module path} | {kind} | declined {YYYY-MM-DD} | {one-line why-shallow at the time}
```

A candidate whose module path and kind match a recorded line is still presented — a decline is advisory context, never suppression (the module may have changed since) — but carries the marker `(declined {date})` appended to its "Why it's shallow" cell and its `AskUserQuestion` option description below, so the user can wave it through without re-judging it from scratch.

```
Found {N} depth opportunities in {scope}, ranked by leverage:

| # | Module | Kind | Why it's shallow | Leverage | Blast radius |
|---|--------|------|------------------|----------|--------------|
| 1 | {path} | deepen | {one line — what leaks / what callers must know} | {callers affected, interface shrink} | {files touched} |
| 2 | {path} | collapse | {one line — what it only moves} | {…} | {…} |
```

Immediately below the table, call `AskUserQuestion` with one `multiSelect` question per group of up to 4 candidates (mirrors `/claude-tweaks:init`'s routine-picklist grouping — the tool caps `options` at 4 per question but allows up to 4 questions per call, so up to 16 candidates fit in a single call; beyond 16, present the first 16, act on that selection, then offer the remainder in a follow-up call):

- `question`: `"Which candidates would you like to explore?"` (or, when there is more than one group, `"Which candidates would you like to explore? (1/{G})"`), `header`: `"Depth candidates"`, `multiSelect`: `true`, one option per candidate in this group — `label`: `"#{n} {path}"`, `description`: kind + the one-line why-it's-shallow summary
- Repeat for each subsequent group, `question`: `"Which candidates would you like to explore? ({i}/{G})"`

Selecting none across every group is the "none" path: skip Step 4 and Step 5 and go straight to Report. Any candidate shown but not selected is recorded there as declined (see Report).

If zero candidates, state: "No shallow modules found in scope — the abstractions in this change are earning their keep." and stop (skip to Report).

**Filtering by kind:** `/claude-tweaks:deepen --kind deepen|collapse` scopes this table (and the `AskUserQuestion` options built from it) to only that kind before presenting — use it for a pass focused solely on the cheap, low-ceremony collapse cleanups (or, conversely, only the real-abstraction deepen candidates). Candidates of the excluded kind still count toward "Found {N}" in the summary line but are not shown as selectable options, and are folded into the Report's "Candidates not actioned" total. Omit the flag to see the full mixed list, as today.

**Recording declines.** When the user declines a candidate — shown at Step 3 but not selected, or skipped at Step 4 — append its line to `.claude-tweaks/deepen/declines.md` in the format above (when a line for the same module path and kind already exists, update its date in place). Record only candidates the user actually saw and passed on: candidates hidden by `--kind` filtering were never judged and are not recorded, and auto mode records nothing — staging is not a decline. This file is the only cross-run memory this skill has; the ledger records resolutions, not declined candidates.

### Auto mode

Depth refactors are architectural and low-reversibility. In `auto` mode (a pipeline run directory exists), **never apply a refactor autonomously**. Stage the ranked candidate list to `{run-dir}/staged/deepen-{n}.md` and log one entry to `decisions.md` per `_shared/auto-decision-log.md`:

```
- STAGED {HH:MM:SS} — Step 3: {N} depth candidates in {scope}. Architectural — staged for Review Console. Reversibility: low.
```

**Collapse candidates additionally stage as patches.** For each collapse candidate with 3 or fewer call sites, also compose the mechanical inline — call sites rewritten to the wrapped callee, wrapper deleted — as `staged/deepen-collapse-{n}.patch` per `_shared/staged-patch.md`: a `Target:` / `Invariant:` / `Finding:` / `Staged-at:` preamble followed by the unified diff, validated with `git apply --check` from the worktree before its `STAGED` entry is written; a failing check is handled per that file's Staging-time gate. This makes the Review Console actionable for the cheap cleanups instead of advisory — the console applies (or re-derives) per that contract, always attended: that file's Unattended floor excludes `deepen-collapse-{n}.patch` from `consoleAutoResolve`'s zero-click apply. Never stage a deepen-kind candidate as a patch — interface design requires the user — and a collapse wider than 3 call sites stays list-only too: a wide mechanical diff composed mid-pipeline goes stale by console time more often than it applies.

Surface at the Wrap-Up Review Console. Do not run Steps 4-5 in auto mode — interface design requires the user. See `_shared/auto-mode-contract.md`.

## Step 4: Design the Interface (Stage 2 of 2 — interactive only)

Selected candidates split by kind here — a collapse has no interface to design, so it never pays the design conversation:

**Collapse candidates — one batch, no design conversation.** Inlining a pass-through is mechanical: rewrite each call site to the wrapped callee, delete the wrapper. Present every selected collapse candidate together as one batch table — `| # | Module | Call sites rewritten | Before → after (one representative call site) | Tested via |`, where `Tested via` is the existing caller tests, since the calls' behavior is unchanged — then one `AskUserQuestion` for the whole batch per the batch-table convention: `question`: `"Apply these {N} collapses?"`, `header`: `"Confirm"`, `multiSelect`: `false`, Option 1 `"Apply all (Recommended)"`, Option 2 `"Override specific items"` (the user's #-by-# corrections arrive as free text in the next message; items skipped that way are recorded as declined), Option 3 `"Skip all"` (all recorded as declined). If, while composing the batch, a "wrapper" turns out to carry behavior after all — a transform, a default, an error contract — reclassify it as a deepen candidate on the spot and route it through the conversation below; never inline behavior silently.

**Deepen candidates — a focused interface conversation each.** Do not jump to code. Per the adaptive section-batching convention (docs/skill-authoring.md), if the user accepts two consecutive candidates' designs without modification, batch the rest into a single approval.

1. **Propose the deepened interface** — the smallest surface that hides the most behavior. Show the before/after signature, not the implementation.
2. **Classify dependencies** for testability (pure computation / local stand-in / network boundary → port + adapter) per `_shared/criteria-architecture-depth.md`. State how the deepened module will be tested.
3. **Name the trade-off** — what the new shape makes easy, what it makes harder, and what would force revisiting it. If the trade-off is genuinely hard-to-reverse, surprising, and a real choice, flag it as an `[ADR-candidate]` so wrap-up can record it (see `_shared/decision-records.md`).
4. Confirm before implementing — call `AskUserQuestion`: `question`: `"Apply this interface change to {module}?"` (when batched per the adaptive convention, `"Apply these {N} interface changes?"`, listing each module), `header`: `"Confirm"`, `multiSelect`: `false`
   - Option 1 — `label`: `"Apply (Recommended)"`, `description`: `"Implement the proposed interface now"`
   - Option 2 — `label`: `"Skip this candidate"`, `description`: `"Leave it as-is; record it as declined in the Report"`

## Step 5: Apply and Verify

When Step 4 approved multiple candidates (a collapse batch, or deepen candidates batched per the adaptive convention), apply them **one module at a time** — implement, verify, and commit each before starting the next. This is what makes "reverted cleanly" (item 4 below) actually true at the moment it matters: if verification fails partway through a multi-candidate batch, only the in-progress module is uncommitted; every prior module in the batch already has its own clean, independently-revertible commit.

For each approved candidate, in order:

1. Implement the approved interface change within that module's scoped files. Preserve behavior — depth refactors change *structure*, not *behavior*.
2. Run the shared verification procedure from `verification.md` in the `/claude-tweaks:test` skill's directory (types, lint, tests). Apply the Working Directory Discipline rule from `_shared/subagent-dispatch-core.md` before any verification command.
3. **If verification fails** — this is a BLOCKED gate. Never silently retry or self-fix. Surface the failing check and return control:

```
BLOCKED
Reason: verification failed after a depth refactor.
Failing check: {typecheck | lint | tests}
Module: {path} ({N} of {total approved candidates})
Already-committed modules from this batch: {list, or "none"}
Next: caller decides whether to revert this module's uncommitted change (`git checkout -- <files>` / `git restore`), fix the regression, or stage for review. Prior modules in this batch are already committed and unaffected.
```

A depth refactor that breaks tests is suspect — it likely changed behavior, not just structure. Prefer reverting over patching.

4. On verification pass, commit this module's change on its own (one commit per module) before moving to the next approved candidate — this is what lets any single change be reverted cleanly without touching the others.

## Report

There are three paths into this section, and all three render it:

1. **Zero candidates found (Step 3)** — the table has no rows; "No depth changes — abstractions reviewed are earning their keep."
2. **User selected "none" at Step 3** — the table has no rows; every presented candidate is counted in "Candidates not actioned" as declined.
3. **A Step 5 BLOCKED gate fired mid-batch** — render the BLOCKED template first (Step 5, item 3) to surface the failing check and return control, **then** still render this table below it: rows for every module already committed in the batch (per "Already-committed modules from this batch"), the in-progress module counted under "Candidates not actioned" (reason: blocked, not declined), and any remaining unapplied candidates from the batch also counted there. The BLOCKED template and this table are complementary, not exclusive — BLOCKED explains *why* the batch stopped; this table is the consolidated record of what happened across the whole run.

```
### Architectural Depth Pass

| # | Module | Kind | Change | Lines | Tested via |
|---|--------|------|--------|-------|------------|
| 1 | {path} | deepen | {interface before → after} | {-N/+M} | {pure / stand-in / port+adapter} |

Verification: {pass/fail}
Candidates not actioned: {N} (staged / declined / blocked — listed for follow-up)
```

If no changes were made: "No depth changes — abstractions reviewed are earning their keep." List any candidates the user declined so they aren't silently dropped. Each decline also persists to `.claude-tweaks/deepen/declines.md` (Step 3's decline memory), so a future `/deepen` run over overlapping scope re-presents it pre-marked `(declined {date})` rather than as first-seen; the ledger still records resolutions only, never declined candidates.

## Next Actions

When invoked directly (not by a parent skill), render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:test`** — verify the refactor end-to-end (recommended)
`/claude-tweaks:review {spec}` — re-review the changed architecture
`/claude-tweaks:simplify` — line-level cleanup on the refactored files

When invoked by a parent, omit Next Actions — the parent handles flow control.

## Component-Skill Contract

When `$PIPELINE_RUN_DIR` is set, `/claude-tweaks:deepen` is running inside a pipeline (invoked by `/claude-tweaks:flow` at its Pipeline Summary, or surfaced by `/claude-tweaks:review` / `/claude-tweaks:reflect`). In that case:

- Omit the `## Next Actions` block — the parent owns the handoff.
- Run **analysis-only**: Steps 1-3 (map modules → deletion test → leverage ranking). **Do not run Step 4 (interface design) or Step 5 (apply)** — those are interactive and low-reversibility, and a hands-off pipeline must never refactor module interfaces unattended. Staging/logging mechanics are identical to Step 3's own Auto mode subsection — this section doesn't restate them.
- **Return the ranked candidate list to the caller** so it can render a recommendation block (e.g., `/flow`'s Depth Opportunities block) — the one behavior unique to this contract, beyond what Step 3's Auto mode subsection already covers.

Direct invocation may pass `--source <parent-skill>` as an explicit fallback when ambiguity exists (rare; `$PIPELINE_RUN_DIR` is the primary signal).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Measuring depth as implementation-lines ÷ interface-lines | Rewards padding, punishes simple-but-deep modules — judge leverage from call sites, not line counts |
| Proposing interfaces for every candidate up front | Runaway rewrite — Stage 1 presents *what* and *why*; interfaces only for candidates the user picks |
| Dressing a collapse up as a deepening | A pass-through failing the deletion test should be inlined, not "deepened" |
| Drifting into component / service / boundary vocabulary | Proposals become impossible to compare — use the controlled vocabulary |
| Changing behavior during a depth refactor | Structure only — behavior changes belong to a different skill; broken tests mean you changed behavior |
| Auto-applying a refactor in `auto` mode | Architecture is low-reversibility — `auto` stages candidates for the Review Console, never refactors silently |
| Staging a deepen-kind candidate as a `.patch` in `auto` mode | Interface design requires the user — auto stages interface candidates as a list; only mechanical, narrow collapses become patches |
| Suppressing a previously declined candidate | Decline memory is advisory — the module may have changed since; annotate with the decline date, never hide |
| Walking collapse candidates through the per-candidate design conversation | A pass-through has no interface to design — the ceremony `--kind collapse` promises to avoid; batch the mechanical before/afters into one confirm |
| Running a whole-repo depth audit | This skill reviews recent work — repo-wide audits are a separate deliberate exercise |
| Deepening a module by pushing a network call into previously pure code | Trades testability for a smaller surface — flag it as a risk, don't do it silently |
