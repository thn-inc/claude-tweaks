## Staged: Capture — acceptance-gap backstop counts NOT_PLANNED/DUPLICATE closures as gaps

Finding: [capture] tidy Step 4.8's acceptance-gap scope surfaces 581 records in a 30-day window.
Proposed: file a backlog record (bug) with the spec-shaped body below via /claude-tweaks:capture.

## Current State

`needsBackstop` (`plugin/bin/lib/issues/acceptance.js`) returns true for any CLOSED, non-sub-issue
record with no `demo:*` label, and `_shared/github-pr-scan-acceptance.md`'s acceptance-gap fetch
never reads `stateReason`. Against this repo on 2026-09-30: 653 records closed in the last 30 days,
581 classified as gaps — 392 COMPLETED, 188 NOT_PLANNED, 1 DUPLICATE. A not-planned or duplicate
closure has nothing to accept, so roughly a third of the rows are noise; the remaining 392 still
dwarf the 284 `demo:approved` records ever labelled, so the scope cannot converge and its
per-record `/claude-tweaks:demo #N` recommendation is not actionable at this volume. The fetch
also hit its `backlog-fetch-limit` (1000), so its own truncation warning fired.

## Deliverables

- Exclude `stateReason` NOT_PLANNED and DUPLICATE from `needsBackstop` (fetch `stateReason` in the
  acceptance-gap `gh issue list`), with the same change on the local-files Shape 8 path.
- Decide and document whether health-sweep (`by:*-health`) and capture-only records need a
  disposition at all, or whether the backstop should scope to records a build actually shipped.

## Acceptance Criteria

- A NOT_PLANNED closed record with no `demo:*` label is not a gap; a COMPLETED one still is.
- Unit tests in the acceptance.js suite cover both reasons.

Evidence: tidy run 2026-09-30T172538-tidy-standalone, scan/acceptance.txt.
