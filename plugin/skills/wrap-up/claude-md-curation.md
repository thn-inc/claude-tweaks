# CLAUDE.md & Rules Curation — judge file

Judge file for the `claude-md` registry row (`CLAUDE.md & rules`). The gate, the scope, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only. The row's disposition is `stage-only`: **every** finding it emits carries `"action": "staged"`, with no exception. Nothing here is written directly; findings surface at the Review Console for approval.

Why this row exists at wrap-up rather than only in rotation: the end of a piece of work is when a convention changed, a command was renamed, or an incident happened — the moment CLAUDE.md is most likely to have gone stale, and the moment the context explaining why is still available. Rotation finds the same drift weeks later, cold. (A closed gate renders `n/a`, never `Clean` — "the audit never ran" and "the audit found nothing" are different facts, and keeping them distinct is the engine's job, not this file's.)

## What opened this row

The gate is already evaluated when you read this. The signals mean:

| Signal | What it means |
|---|---|
| `dontCandidate` | `/claude-tweaks:reflect` or the ledger produced a Don't candidate — a `[claude-md: …]`-tagged ledger entry, or a reflection insight naming a pattern that should not be repeated |
| `contradictedConvention` | A convention asserted in CLAUDE.md's `## Conventions` section is contradicted by this work's diff |
| `incidentRecorded` | An incident account was recorded for this work |
| `claudeMdCommandRenamed` (fact) | A command listed in CLAUDE.md's `## Commands` section was renamed or removed in this work's diff |
| `claudeMdOverBudget` (fact) | `CLAUDE.md` or an in-scope `.claude/rules/*.md` file exceeds its tier's line budget (`harness-health-always-loaded-budget` / `harness-health-scoped-rule-budget`) — opens the row on any single in-scope target's own size, each checked independently against its own tier's budget — see the paragraph below |

Unlike the other four signals above, `claudeMdOverBudget` is not diff-scoped — it is a static check of the file's current size, not something introduced by this specific piece of work. This is intentional: once `CLAUDE.md` or a rule file goes over its tier's budget, this row's gate stays open on every subsequent wrap-up run until the file is trimmed back under budget, the same persistent-until-fixed treatment `harness-health-analysis.md` check 4 already gives an over-budget file. It is not a bug if this row keeps reopening across many runs on an over-budget project — that is the pressure the record exists to apply.

**Stamping an over-budget filing (#1829).** A `claudeMdOverBudget`-triggered queue write — like every other queue write this row's `stagePath`/`action: "staged"` shape produces — is composed via `specShapedBody`, but this signal's finding names a **measured, mechanical claim** ("N lines vs the M-line budget"), and that claim can go stale between filing and the record's eventual build. Read `plugin/bin/lib/wrap-up/facts.js`'s `claudeMdBudgetTargets` (the sibling fact beside the `claudeMdOverBudget` boolean — `[{path, lines, budget}]` for every in-scope target) rather than re-measuring by hand, and compose the filing with:

- `verifiedAsOf`: the current HEAD sha (`git rev-parse HEAD`) — the same freshness stamp the four health-sweep skills already thread through `specShapedBody`, so `flow/materialize.md`'s drift check has something to compare when this record is eventually built.
- One Current State line per over-budget target, in the form `` `{path}`: {lines} lines vs the {budget}-line budget (`wc -l {path}` at {sha}) `` — `{lines}`/`{budget}` from `claudeMdBudgetTargets`, `{sha}` the same `verifiedAsOf` value.
- `premiseCheck` (rendered as the body's `Premise-check: {command}` line — `extractPremiseCheck`'s own convention, same as `verifiedAsOf`/`Verified-as-of:`): for a single over-budget target, `test $(wc -l < {path}) -gt {budget}` — a command that exits 0 while the file is still over budget, non-zero once it no longer is. For multiple over-budget targets in one filing, join each target's own check with `&&` so the combined command exits 0 only while every named target is still over its own budget.

This is the complementary mechanical case to #1769's `ASSUMPTION — verify at build` marker (for a claim the composer cannot settle): here the claim *is* a command, so `materialize.js` can re-run it directly (`flow/materialize.md`'s "Premise check" paragraph) instead of asking a build-time reader to re-derive it by eye.

Do not re-evaluate them. They are context for what to look at first, not a gate to re-run.

## Step 1: Classify before collecting

**Classify before collecting.** Run each candidate through `skills/_shared/learning-routing.md` first. Only a **D1** outcome belongs here. A candidate resolving to D4 or D5 is *not* a CLAUDE.md rule — hand it to the `Memory` or `Upstream feedback` row and do not collect it, or those rows' unclaimed-learnings scope will skip it permanently.

CLAUDE.md describes **how to work in this codebase** — patterns to follow, commands to run, conventions to respect, mistakes to avoid. Every update must describe something that exists and is actively used, not aspirational improvements.

## Step 2: Check what the work introduced

Check if the work introduced project-wide conventions:

1. New commands or scripts (verify they exist and work)
2. New naming conventions or patterns (observed, not aspirational)
3. New don'ts — anti-patterns discovered during this build that are guardrails for existing patterns, not wishes for missing infrastructure
4. Stack changes (new dependencies actually added)
5. Path-scoped rules for `.claude/rules/`

Before adding to CLAUDE.md, check the size budget — keep it concise. Move detailed content to skills or rules. Route improvement ideas to a new backlog record (no stage label — the unified taxonomy's equivalent of the pre-migration "inbox" destination; per `_shared/work-record.md`), not CLAUDE.md — subject to the same per-item work-record-creation approval as any other new record (`_shared/auto-mode-card.md`).

**For a new Don't, write the incident account before the rule.** Put the specifics — which build, how it was caught, what it cost — wherever this project keeps that evidence (an incident log if it has one, otherwise the work record or the commit message), then compress to what lands in CLAUDE.md: one sentence of rule, one clause of why. The order is the whole point. Write the rule first and the vivid detail leaks into it clause by clause, and CLAUDE.md is paid for by every session *and* every dispatched subagent, so that leak is charged per agent. Length here is not a style preference.

## Step 3: Apply the harness-health procedure

Read `_shared/harness-health-analysis.md` and apply it with `assetType: claude-md` against the project's `CLAUDE.md` — the same procedure the `Skills` row applies to skills. Its findings **stage**; they never auto-apply, per that file's standing CLAUDE.md exception, which is also why `intent: "remove"` is scoped to this asset type. `.claude/rules/*.md` files in scope take `assetType: rule` and stage identically here, since this row is stage-only regardless of what the shared procedure would otherwise permit.

## Step 4: Collect

→ Collect each needed update as: `[claude.md] {section} — {what to add/change}` or `[rule] {path scope} — {convention}`

Each collected item becomes one payload finding: `kind` is the harness-health finding kind (`patch`), `targetPath` is `CLAUDE.md` or the rule file, `summary` is the `— {…}` half written as a reader would say it, `stagePath` is the `staged/` file holding the full proposal, and `action` is `staged`.
