# 0034. This repository deletes each run's plan at wrap-up

- **Status:** accepted
- **Date:** 2026-11-16
- **Context:** #5562

## Context

Under the plugin's default `superpowers-plans-retention: keep-forever`, every run's plan stays on `main` after the merge. On 2026-11-15 `docs/superpowers/plans/` showed 699 files added and 641 deleted in the previous 30 days (the deletions are periodic bulk prunes, ADR-0007), and 79 plans were tracked at 2.8 MB. Each prune is a commit of its own, and between prunes the plans sit on `main`. Nothing reads a plan after its run merges: the code, the changelog and the PR hold the account, and git history keeps the plan itself. The `prune-after-wrapup` value of the retention key already exists in the plugin, and a reader audit (below) found no consumer that needs a merged run's plan on `main`.

## Decision

This repository sets `superpowers-plans-retention: prune-after-wrapup` in `.claude-tweaks/policy.yml`. The rule is: a plan exists on its run's branch only. Wrap-up's cleanup item 1 deletes the run's plan on the branch before the execution step's commit and push, so the plan never reaches `main`.

Two stated exceptions. First, cleanup item 1 applies to record-based work only: a design-mode build (brainstorm, design doc, plans, SDD, no `/specify`) has no record, so item 1 does not run and its plan is removed later by `/claude-tweaks:tidy`'s orphan-plan route. Second, cleanup item 1 keeps a plan that a tracked file cites and stages a `plan-citation-{n}` proposal instead of deleting it.

This narrows ADR-0007 for this repository. A plan is deleted by its own run; a design doc is still kept until `/claude-tweaks:specify` consumes it. The plugin's own default stays `keep-forever`, so consuming projects are unchanged.

### Readers that rely on this rule

Every reader of `docs/superpowers/plans/` found by the audit either runs before the delete on the run's own branch, or tolerates a missing plan.

- `plugin/bin/lib/plan-audit/checks.js` — plan text passed in by `bin/plan-audit.js` — audits the plan the current build just wrote on its branch, before any delete.
- `plugin/bin/lib/plan-audit/parser.js` — plan text passed in, pure with no fs — works from text it is given; fixtures pin its shapes, not live plans.
- `plugin/bin/lib/plan-retention/probe.js` — records tidy's prune decline description — fewer candidates on `main`, nothing breaks (exempt).
- `plugin/bin/lib/wrap-up/engine-verify.js` — `git status --porcelain` over the plans dir, flagging only untracked leftovers — a committed deletion is not an untracked entry, and an absent dir returns no rows.
- `plugin/bin/plan-retention.js` — each plan's first-added date and route for tidy — it reads plans that exist, so fewer candidates is harmless (exempt).
- `plugin/bin/release-local.js` — every plan on the release checkout for future-version claims — a missing dir yields no claims, and a pruned plan's work has already merged (ENOENT/ENOTDIR returns `[]`).
- `plugin/skills/backlog/overview-mode.md` — a filename-pattern check (`hasPlan`), no content — `false` is only a ranking input, and a finished run has no plan left to run.
- `plugin/skills/build/SKILL.md` — searches for and reads an existing plan for the spec, then writes one — no plan found is the normal path and writes a fresh plan.
- `plugin/skills/build/micro-plan.md` — writes a micro-plan file there — a writer, and the write creates an absent dir.
- `plugin/skills/build/plan-review.md` — the run's plan during `/build`'s plan review — reviews the plan the build just wrote, before any delete.
- `plugin/skills/help/status-scan.md` — the same `hasPlan` filename check for next-to-build ranking — `false` is a ranking input only.
- `plugin/skills/tidy/SKILL.md` — Step 4 plan scan and the Prune plan action — fewer plans to scan (exempt).
- `plugin/skills/tidy/plan-citation-check.md` — `git grep -lF` for a plan basename across tracked files — an absent plan is never a candidate (exempt).
- `plugin/skills/tidy/scan-procedures.md` — Step 4 lists the plans dir and routes would-be deletes through `plan-retention.js` — fewer plans to scan (exempt).
- `plugin/skills/tidy/step-6-auto.md` — re-verifies plan delete rows before Step 7 — a plan already gone fails re-verify and its row is skipped (exempt).
- `plugin/skills/wrap-up/SKILL.md` — Phase 1 snapshots the plan from the branch diff into the run dir; the verification brief reads that copy — it runs before cleanup item 1 and never reads `main`, and with no plan it logs one SKIP.
- `plugin/skills/wrap-up/cleanup-procedures.md` — cleanup item 1 itself resolves the retention, runs the citation check and deletes the plan — it is the deleter, and with nothing to delete it is idempotent.

## Alternatives considered

- **Keep `keep-forever` and prune periodically in bulk.** This is the status quo. Rejected: each prune is a commit of its own, and between prunes the plans sit on `main` as noise that nothing reads.
- **Change the plugin default to `prune-after-wrapup`.** Rejected: consuming projects that keep their plans would change behavior on update. The key already lets a project choose, so this repository chooses for itself.

## Consequences

- A run that closes without a wrap-up leaves its plan on its branch or `main` until `/claude-tweaks:tidy` prunes it once the record closes and no tracked file cites it.
- A design-mode build's plan is not deleted at wrap-up (no record, so no cleanup item 1); tidy's orphan-plan route removes it later.
- The `[IL-36]` rule in `docs/donts.md` and its incident entry now describe this split. ADR-0007 carries a Narrowed-by line, and its Decision text is unchanged.
- Parked record #5638 checks plan files added to and tracked on `main`.
- The claim that the plan never reaches `main` holds only for runs on the first release that ships #3813's fix (PR #4641). Runs on releases up to and including 6.170.0 delete the plan after the merge, so it lands on `main` and stays until tidy prunes it.
