---
record: 193
origin: human
risk: low
size: medium
ceremony: standard
grants: []
surface: infra
---
# 193: integration-branch conformance test checks citation but not which ladder ranks a consumer uses

Surface: infra

## Current State

`tests/integration-branch-conformance.test.js` enforces that a file resolving the GitHub default branch cites `_shared/integration-branch.md`. It does not, and cannot as written, enforce which ranks of the ladder that consumer actually uses. Rank selection is prose-only across three consumers, each narrowing differently: `flow/validation.md` step 2.5 and `build/worktree-setup.md` step 1 both exclude rank 5 (git inference) in a byte-identical inline paragraph, since rank 5 would shadow the `@{upstream}` fallback; `routine/record-freshness.md`'s F1 check excludes ranks 1-2 (`--branch`, `template.branch`) and pins rank 5 to the GitHub-default side, since ranks 1-2 name the branch a routine audits, a different question from where records are committed.

Each narrowing exists because using the full ladder would produce a wrong branch silently. Widening a narrowing today is invisible: adding a rank back to any of the three consumers passes the conformance test (the citation is still present) and the full suite, and only produces a wrong branch on the `dev` to staging to `main` repo models that motivated the ladder in the first place, exactly the repos that reported #61, #132, and #190. This is a near-miss, not an observed failure: the first draft of `routine/record-freshness.md`'s F1 used the full ladder, and the error was caught by reasoning about a `dev`-auditing routine in a `main`-recording project, not by any test.

## Deliverables

Make each consumer declare its rank set in a machine-readable way the conformance test can assert: an integration-branch-ranks HTML comment marker beside the citation, with the test failing when a consumer cites the fragment but declares no rank set, or when a declared set changes without the test's own expectation changing (the same ratchet shape bin/lib/skill-audit/tests/anti-patterns.test.js uses for row counts).

Before implementing: measure the premise (per IL-71) - confirm the three narrowings above are still worded as quoted in the live tree, and check whether a fourth consumer has appeared since this record was filed.

## Acceptance Criteria

- Every consumer of `_shared/integration-branch.md` (currently `flow/validation.md`, `build/worktree-setup.md`, `routine/record-freshness.md`) carries an integration-branch-ranks marker matching its own documented narrowing.
- `tests/integration-branch-conformance.test.js` fails when a consumer cites the fragment with no rank-set marker.
- `tests/integration-branch-conformance.test.js` fails when a declared rank set changes without a corresponding test-expectation update (the ratchet).
- A regression test reproducing the #190-class defect (a consumer silently widening its rank set to include a rank it deliberately excluded, e.g. `routine/record-freshness.md` regaining ranks 1-2) fails before this fix and passes after.
- `npm test` passes.

## Technical Approach

Add the rank-set marker convention beside each consumer's existing citation of `_shared/integration-branch.md`, then extend `tests/integration-branch-conformance.test.js` to require the marker wherever the citation appears, parse the declared rank set, and ratchet it - comparing the current declared set against a pinned expected set per consumer, the same shape `bin/lib/skill-audit/tests/anti-patterns.test.js` already uses for row-count pinning, so a rank-set change requires a deliberate, reviewable test-file edit rather than silently passing. `flow/validation.md` and `build/worktree-setup.md` share a byte-identical exclusion paragraph - consider whether their rank-set markers should also be extracted to one shared value the test reads twice, rather than two independently-maintained lists that could drift apart.

### Key Files

- `plugin/skills/flow/validation.md` - add the rank-set marker (excludes rank 5)
- `plugin/skills/build/worktree-setup.md` - add the same marker (identical exclusion)
- `plugin/skills/routine/record-freshness.md` - add the rank-set marker (excludes ranks 1-2, pins rank 5 to GitHub-default)
- `tests/integration-branch-conformance.test.js` - extend to require and ratchet the rank-set marker

## Gotchas

- Measure the premise before implementing (IL-71): re-confirm the three narrowings above are still worded as quoted, and check whether a fourth consumer of `_shared/integration-branch.md` has appeared since this record was filed - this record was written against the tree at PR #191.
- The `flow/validation.md` and `build/worktree-setup.md` pair are byte-identical today and separately worth extracting to a shared fragment - a companion record was filed alongside this one for that extraction; don't fold that scope into this record.
- A wrong rank-set marker is worse than no marker at all if the test doesn't actually validate the declared set against real consumer behavior - make sure the ratchet test exercises the #190-class regression concretely, not just that a marker string is present.

## Original request

integration-branch conformance test checks citation but not which ladder ranks a consumer uses

**Trigger:** the next edit to any consumer of `skills/_shared/integration-branch.md`, or the next `#132`/`#190`-class report of a skill resolving the wrong branch.

**Origin:** `/claude-tweaks:wrap-up` reflection on #190 (PR #191). A near-miss, not an observed failure — recorded while the reasoning is still available.

**Summary:** `tests/integration-branch-conformance.test.js` enforces that a file resolving the GitHub default branch **cites** `_shared/integration-branch.md`. It does not, and cannot as written, enforce **which ranks of the ladder that consumer actually uses**. Rank selection is prose-only across three consumers, each narrowing differently:

| Consumer | Narrowing | Stated where |
|---|---|---|
| `flow/validation.md` 2.5 | excludes rank 5 (git inference) — it would shadow the `@{upstream}` fallback | inline paragraph |
| `build/worktree-setup.md` step 1 | same exclusion, byte-identical paragraph | inline paragraph |
| `routine/record-freshness.md` F1 (new, #190) | excludes ranks 1-2 (`--branch`, `template.branch`) and pins rank 5 to the GitHub-default side | inline paragraph |

**Why it matters:** each narrowing exists because using the full ladder would produce a *wrong branch*, silently. For `/flow` and `/build`, rank 5 resolves in nearly every repo and would make them warn about a divergence that isn't there. For `/routine`'s freshness check, ranks 1-2 name the branch a routine **audits** — a different question from where records are committed — so honoring them would compare records against the wrong tree and reintroduce the #190 defect inside its own fix.

I nearly shipped exactly that. The first draft used the full ladder; the error was caught by reasoning about a `dev`-auditing routine in a `main`-recording project, not by any test. Nothing in the suite would have failed.

**The gap:** widening a narrowing is invisible. Adding a rank back to any of the three passes the conformance test (the citation is still present), passes the full suite, and produces a wrong branch only on the repos that motivated the ladder in the first place — `dev`→`staging`→`main` models, which are exactly the repos that reported #61, #132, and #190.

**Suggested direction:** make each consumer declare its rank set in a machine-readable way the conformance test can assert — e.g. a `<!-- integration-branch-ranks: 3,4,5 -->` marker beside the citation, with the test failing when a consumer cites the fragment but declares no rank set, or when a declared set changes without the test's own expectation changing (the same ratchet shape `bin/lib/skill-audit/tests/anti-patterns.test.js` uses for row counts).

Measure the premise before implementing, per `[IL-71]`: confirm the three narrowings above are still worded as quoted, and check whether a fourth consumer has appeared. This record was written against the tree at PR #191.

**Related:** the two `/flow` + `/build` copies are byte-identical and separately worth extracting — see the companion record filed alongside this one.

---
Filed via `/claude-tweaks:wrap-up` Step 3 reflection (Defer routing).


