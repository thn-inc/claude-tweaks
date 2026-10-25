# Reflect — staged finding 1

**Category:** observation
**Severity:** low
**Reversibility:** high
**Source:** full mode, all lenses (wrap-up, `--source wrap-up`, staged instead of asked)
**Files:** general

## Finding

### Reflection Insights

| # | Insight | Causal | Recommended Destination |
|---|---------|--------|------------------------|
| 1 | A prose guard that must fail closed shipped with fail-open edges (a vacuous "every record carries `demo:pending`" over an empty set, no stated read-failure branch, undefined `{command}`/`{run-dir}` placeholders, run-id validation only implicit). The plan's ACs pinned that the rule text exists, not its failure branches, so only review caught them. | systemic | Capture — tangential (staged as `reflect-2`) |
| 2 | Surprises: reproduction pairs on this prose diff confirmed 5 of ~28 findings; the Direct-verification override did the work, as `step3-lens-dispatch.md` already predicts. | — | No action — already documented |
| 3 | Friction: 9 `wd-guard-refusal` events (harness worktree isolation) hit compound, heredoc and escaped-space Bash shapes across build and review, plus one from this wrap-up. | — | Don't capture — harness behavior already documented in `docs/hooks.md` ("Observed here, not enforced") and the worktree-guard memory; not a claude-tweaks gate defect |
| 4 | Tradeoff accepted: the landed predicate is restated in tidy, pr-first-merge Step 1 and close-out instead of one helper (spec AC1 and Key Files require the restatement; Deliverable 4 declined at build). Drift cost this run: two review fixes (the stale skill-graph row, the implicit run-id validation) were restatement drift. | — | Already tracked: ledger row 13 / `staged/review-unconfirmed-2.md` |

## Suggested resolution

Approve insight 1's backlog candidate (`staged/reflect-2.md`). Insights 2-4 need no further action.

## Decision-log reference

STAGED — Step 3: reflection insights table staged for the Review Console (see `decisions.md` `## /wrap-up`).
