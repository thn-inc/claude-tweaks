# 0026. Ledger residue on the integration branch converges in reconcile

- **Status:** accepted
- **Date:** 2026-10-22
- **Context:** #3812

## Context

A run's open-items ledger (`docs/plans/{name}-ledger.md`) is pipeline bookkeeping. The run's own
teardown deletes it, and it is not meant to land on the integration branch. #3595 moved single-spec
cleanup item 2's ledger delete ahead of `gh pr merge`. The multi-spec Shared teardown step 0 has
done the same since #3420.

Residue still lands through PRs merged outside the run's teardown. #3584 carried one for run
`2026-10-19T100244-record-3507`, and #3715 carried one for run `2026-10-20T102130-record-3564`. At
the time of writing `origin/main` held three more:

- `2026-10-20-decision-line-status-word-ledger.md`
- `2026-10-20-qa-report-json-writer-ledger.md`
- `2026-10-20-skill-description-trim-audit-ledger.md`

A delete step inside the run cannot cover a merge made by something that is not the run: a human, the
fleet, or a later session.

## Decision

Candidate (b): a `ledger-residue` check in the reconcile family
(`plugin/bin/lib/reconcile/ledger-residue.js`).

- **Residue** is any direct `docs/plans/*-ledger.md` entry at `origin/{integration}`'s tip. Only that
  tip is read. An in-flight run's branch legitimately carries its ledger until teardown, so it is
  never flagged.
- **Removable residue is what tidy would delete.** The check applies tidy's shipped orphan-ledger
  rule (`plugin/skills/tidy/scan-procedures.md`) to each candidate's blob at the tip. A candidate
  is kept, and reported as a per-path skip, when it lacks the ledger signature (`not-a-ledger`),
  has an `open` row (`ledger-has-open-rows`) or an unrecognized status
  (`ledger-status-unrecognized`), or a non-archived run directory is attributed to it
  (`run-live`). Rows are parsed by `wrap-up/pack.js`'s `parseLedger`. Without this rule, a run
  whose ledger reached main mid-run would lose its unresolved items, as would a ledger left with
  open rows. At the time of writing two of the three ledgers above had open rows.
- **PR state comes from one list, enumerated by ref prefix.** One `gh api` matching-refs call
  names every branch starting `build/ledger-residue-`, then one `gh pr list --head` per branch
  returns that branch's PRs, in any state, with their bodies. No recency window applies, so a PR
  is found however old it is:

  | Evidence | Outcome |
  |---|---|
  | `gh` absent, or network failure | every path skips, fail closed |
  | any removal PR open | every path skips `removal-pr-open` |
  | a merged removal PR's body names a path that is still present | that path skips `removal-merged-but-present` |
  | a closed-unmerged removal PR's body names the path | that path skips `removal-pr-declined`, never re-proposed |
  | ref check indeterminate | skip `ref-check-failed` |
  | dry run | skip `dry-run` |
  | otherwise | open a PR for the remaining set, pushing the branch first unless it is already on origin |

  A per-branch lookup would lose an earlier PR as soon as the residue set changed: PRs would pile
  up, and a human's close would stop counting.
- **The branch** is `build/ledger-residue-{sha1(sorted paths).slice(0, 8)}`, hashed over the
  remaining removable set only.
- **The write** is plumbing. A scratch `GIT_INDEX_FILE` reads the integration tip, removes the
  residue paths, and commits with the tip as sole parent. The commit is pushed to the new ref with
  no force and no lease. The checkout's index, HEAD and working tree are untouched, and the check
  never pushes to the integration branch.

## Alternatives considered

- **(a) A PR check that fails a non-draft PR adding its own ledger.** It would live in
  `.github/workflows/`, which is maintainer-side and never ships (decision 0015), so consumer projects
  on `pr-first` get nothing. This repo has no branch protection, so a red check would not stop a
  human or fleet merge. It would also read red during the legitimate window between a run's
  ready-flip and its own teardown delete push.
- **Deleting directly on the integration branch from reconcile.** Rejected: the family never pushes
  to the integration branch.

## Consequences

- The removal PR is not auto-armed. The `repo-wide` sweep's item 9 recognizes only the tidy and
  wrap-up housekeeping markers, so a human or the fleet merges it.
- A removal PR closed unmerged declines every path its body names, and those paths are never
  re-proposed while its branch survives. The branch stays on origin: `remote-prune` deletes only
  branches whose PR is merged, and this check deletes nothing. A human who deletes the declined
  branch by hand drops the decline.
- The same enumeration bounds `removal-merged-but-present`: a merged removal PR's branch is
  deleted after merge (by `remote-prune` or GitHub's auto-delete), so that reason fires only
  while the branch survives. After that, a ledger the merged PR deleted but that reappears is
  treated as new residue.
- A ledger with open rows or a live run stays on the integration branch until a human or
  `/claude-tweaks:tidy` resolves it. The check reports it each pass, and the background summary
  surfaces it at the next SessionStart.
- tidy's orphan-ledger scan and this check can both propose deleting the same ledger, because
  they share one rule. The duplicate is benign: whichever PR merges first removes the file, and
  the other is left with nothing to delete. If the leftover is this check's removal PR, close it.
  While it stays open, every later residue path skips `removal-pr-open`, which the background
  summary surfaces each pass.
- `gh`-absent and `local-merge` runs skip the check.
- After merge, `remote-prune` deletes the `build/` branch on its own merged-proof bar.
