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
- **The branch** is `build/ledger-residue-{sha1(sorted paths).slice(0, 8)}`. It is a function of the
  residue set alone, so a rerun finds its own earlier PR.
- **PR-state table**, keyed on the governing PR for that branch (`preferOpen`):

  | State | Outcome |
  |---|---|
  | `gh` absent, or network failure | skip, fail closed |
  | PR open | skip `removal-pr-open` |
  | PR closed unmerged | skip `removal-pr-declined` |
  | PR merged | skip `removal-pr-merged` |
  | no PR, ref check indeterminate | skip `ref-check-failed` |
  | no PR, dry run | skip `dry-run` |
  | no PR | open a PR, pushing the branch first unless it is already on origin |

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
- A removal PR closed unmerged reads as declined, and that residue set is never re-proposed. A
  changed set gets a new branch.
- `gh`-absent and `local-merge` runs skip the check.
- After merge, `remote-prune` deletes the `build/` branch on its own merged-proof bar.
