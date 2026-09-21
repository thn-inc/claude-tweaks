---
record: 374
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build, merge]
surface: backend
---
# 374: Pin run-integrity repoRootOf's run-dir-layout coupling with a test

Surface: backend

## Current State

`bin/lib/hooks/run-integrity.js`'s `repoRootOf(runDir)` derives the repo root by three-levels-up path arithmetic, assuming the `{root}/.claude-tweaks/pipelines/{run-id}` anchoring layout from `_shared/pipeline-run-dir.md`. Nothing test-pins that coupling: a future layout change would degrade silently to fail-open (`in-progress` verdicts everywhere — detection quietly dead) instead of failing a test.

## Deliverables

- One assertion tying `repoRootOf` to the `{root}/.claude-tweaks/pipelines/{run-id}` anchoring layout — either in `tests/run-integrity.test.js` or the anchoring suite (`tests/hooks-context-anchoring.test.js`), whichever reads better as the coupling's home.

## Acceptance Criteria

- [ ] A test asserts `repoRootOf(runDir)` returns the correct repo root for a run dir anchored at `{root}/.claude-tweaks/pipelines/{run-id}`, and fails if the three-levels-up arithmetic no longer matches that layout.
- [ ] `npm test` passes.

## Technical Approach

Add a targeted unit test to `tests/run-integrity.test.js` (or `tests/hooks-context-anchoring.test.js`, whichever already covers this layout's other invariants) constructing a run dir at the documented anchoring depth and asserting `repoRootOf` resolves the correct root. The test should fail if the three-levels-up arithmetic and `_shared/pipeline-run-dir.md`'s documented layout ever diverge, rather than silently degrading to a fail-open `in-progress` verdict.

### Key Files

- `plugin/bin/lib/hooks/run-integrity.js` — `repoRootOf(runDir)`, the function being pinned
- `tests/run-integrity.test.js` or `tests/hooks-context-anchoring.test.js` — new assertion

## Gotchas

- The failure mode being guarded against is silent (fail-open, `in-progress` verdicts everywhere) rather than a crash — the value of this record is entirely in making a future layout drift loud via a failing test, not in changing current behavior.

## Original request

Pin run-integrity repoRootOf's run-dir-layout coupling with a test

From spec #372's whole-branch review (minor), approved as a backlog record at the 2026-08-13 multi-spec flow run's consolidated Review Console.

## Problem

`bin/lib/hooks/run-integrity.js`'s `repoRootOf(runDir)` derives the repo root by three-levels-up path arithmetic, assuming the `{root}/.claude-tweaks/pipelines/{run-id}` anchoring layout from `_shared/pipeline-run-dir.md`. Nothing test-pins that coupling: a future layout change would degrade silently to fail-open (`in-progress` verdicts everywhere — detection quietly dead) instead of failing a test.

## Deliverable

One assertion tying `repoRootOf` to the anchoring layout — either in `tests/run-integrity.test.js` or the anchoring suite (`tests/hooks-context-anchoring.test.js`), whichever reads better as the coupling's home.

Refs #372.

