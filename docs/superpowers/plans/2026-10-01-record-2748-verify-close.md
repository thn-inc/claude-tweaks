# Fix failing skill-md doc-consistency tests on PR #2535 (#1728) (#2748) Implementation Plan

**Goal:** Confirm PR #2535 is merged with a green `test` workflow, so this record can be closed as already-resolved.

**Spec:** `.claude-tweaks/pipelines/2026-10-01T201921-record-2748/work/2748-spec.md` (materialized from GitHub issue #2748)

---

### Task 1: Re-verify PR #2535's merge/workflow state

**Files:**
- None — no code change. PR #2535's merge/workflow state is the only thing to re-verify.

- [x] **Step 1: Re-check** — `gh pr view 2535 --json state,mergeable,statusCheckRollup` confirms `state: MERGED`, and the `test` workflow run (`https://github.com/thn-inc/claude-tweaks/actions/runs/35537132207`) shows `conclusion: SUCCESS`. Re-verified at build time on 2026-10-01: still MERGED, still SUCCESS — no change since shaping.
- [x] **Step 2: Implement** — no code change needed (the spec's own Deliverables confirm this); nothing to implement.
- [x] **Step 3: Run** `npm test` on the current `main` branch (Acceptance Criteria's regression check) — see Common Step 5 (Final Verification) for the run and result.
- [ ] **Step 4: Commit / close** — closing this record with an explanatory comment is a `/claude-tweaks:wrap-up` action, out of scope for this `build,test`-only pipeline run; left for the review/polish/wrap-up phase.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item is covered — PR state re-confirmed (Step 1), no code change required (Step 2), `npm test` regression check deferred to Common Step 5, record-closing comment deferred to wrap-up (out of this run's scope per dispatch instructions).
- **Placeholders:** none.
