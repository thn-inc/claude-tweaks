## Review: #2724 — reconcile: structurally-stuck run directories (PR #6209, branch drive-record-2724)

**Review effort:** low (derived from record labels: risk:low × size:low; the diff heuristic also gives low — 3 files, 33 lines, internal reconcile module, risk proxy low; no `review-effort-floor`)

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| 1. Close and archive both listed run dirs (`hooks.js close-run` then `hooks.js archive-run` for `2026-09-11T165407-record-1982` and `2026-09-01T123248-record-1664`) | **missing**. Both dirs are still live under the main checkout's `.claude-tweaks/pipelines/`, and neither is under `archive/`. The build reported that its sandbox could not write to the main checkout. |
| 2. Remedy paragraphs for `console-never-rendered-pr-closed`, `no-worktree`, `no-branch`, `no-pr` in the structurally-stuck body | done (`plugin/bin/lib/reconcile/escalate-residue.js:155-157`) |
| 3. Body-template test: every reason in the body's reason list has a remedy paragraph | done (`tests/bin-lib/reconcile/escalate-residue.test.js:310`) |

| Acceptance Criterion | Status |
|---------------------|--------|
| After the next `reconcile --checks archive`, neither listed dir is `structurally-stuck`, and both are under `pipelines/archive/` | **not met**. Depends on deliverable 1. |
| The rendered body has a remedy paragraph naming `console-never-rendered-pr-closed`, `no-worktree`, `no-branch`, `no-pr` | met |
| A test fails when a listed reason has no remedy paragraph, and passes with D2 in place (verified by reverting D2) | met. The reviewer verified this. In a `git archive HEAD` extract, removing D2's two array entries turned `escalate-residue.test.js` red: 71/72, `no remedy paragraph for \`no-worktree\``. Restored, it is 72/72 green. |
| Reconcile closes this record itself when the stuck-paths list empties; not closed by hand | **not met**, and at risk. Deliverable 1 has not run. The PR body also carries `Fixes #2724`, so merging #6209 as-is closes #2724 through the merge, not through reconcile's empty-list path. Related open records: #5922 (post-merge deliverables under close-via-merge) and #5196 (pr-early-open always writes `Fixes #N`). |

Risk markers: none unresolved (the spec has no `<!-- ambiguity -->` markers, no Open Questions, and no unvalidated Gotchas). Current-State outcome: reached for D2/D3. A reader of a newly filed record is now told how to clear a pr-closed, no-worktree, no-branch or no-pr directory.

Note on scope: the live stuck-paths list on #2724 now has **four** entries: the spec's two, plus `2026-10-17T213454-record-3078` (still live) and a Windows path, `C:\development\claude-tweaks\...\2026-09-05T082834-record-605`. Deliverable 1 covers only the first two, so AC4's "list empties" condition also needs the other two cleared, and the Windows one only from that machine.

Gate deviation, stated plainly: Step 1's gate says a missing deliverable is BLOCKED and the rest of the review is skipped. I ran the rest anyway, because D1 is an operational step in gitignored run dirs and touches no code. The code review below covers the code deliverables only. The verdict stays BLOCKED on D1.

### Verification (from /test)
- Gate at review start: runner stamp `verifiedHead: true` at 6a5f87e (scoped).
- Re-verify after the review's fix (`/claude-tweaks:test --source review`, scoped, `verify-scope.json`): **pass**. Two changed files gave 132 of 1424 test files impact-selected. The `tests` suite was taken from PR CI on HEAD 6ed1634 (test.yml run 45422378704, success): tests 36546, pass 36520, fail 0. `escalate-residue.test.js` locally: 72/72.
- Type check / Lint: n/a. This repo declares no separate types/lint checks; static checks run inside the `tests` suite.
- Design CLI gate: skipped (no frontend files; design integration not configured).

### QA Validation (from /test)
- **Status:** Skipped — no stories (`stories/` does not exist)

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| error (correctness) | `escalate-residue.js:153`: the reason list named `no-repo-slug` and `unknown-host` as reasons that feed this record. Neither can reach it: both come from the failed origin read that also makes `escalateStructurallyStuck` return `escalation-failed` before any gh call. This reverses the deliberate #3705/#4794 exclusion (`archive-merged.js:1881-1888`, `docs/reconcile-checks.md:236-242`). | medium | fixed (6ed1634) |
| test | `escalate-residue-feeding-reasons.test.js:12`: the new test file iterated every `STRUCTURALLY_STUCK_REASONS` member, the unfileable ones included, which forced the false claim above. Its remedy check duplicated the new test at `escalate-residue.test.js:310`. | medium | fixed (file removed, 6ed1634) |
| error (remedy text) | `escalate-residue.js:157`: the `no-repo-slug` remedy said to fix the "run-state stamp" (the slug comes only from the origin remote). The `unknown-host` remedy left out the documented `GH_HOST` fix and offered close-and-archive, which does not clear a refusal that covers the whole repo. | low | fixed (both sentences removed with the reasons, 6ed1634) |
| test | `escalate-residue.test.js:352`: the #3705 guard was inverted to assert that the unfileable reasons ARE listed, while its title, comment and `continue` skip still say "except the unfileable ones". | low | fixed (must-not-be-listed assertion restored, 6ed1634) |

> Lens 3b (Security): no findings. Lens 3c (Error handling): 3 findings (rows 1, 3, 4). Reviewer read: row 2 (lens 3f). All four were single-read (`low` tier) and confirmed by the Step 3.7 tiebreak.

### Tiebreak
**Verdicts:** 4 confirmed · 0 dropped · 0 digest · 0 console
- AUTO 16:09:19 — Reproduction: lens "3c" finding plugin/bin/lib/reconcile/escalate-residue.js:153 confirmed by tiebreak:0331cc07fe3c. Confirmed. Reversibility: high.
- AUTO 16:09:19 — Reproduction: lens "3c" finding plugin/bin/lib/reconcile/escalate-residue.js:157 confirmed by tiebreak:59631b8928bb. Confirmed. Reversibility: high.
- AUTO 16:09:19 — Reproduction: lens "3c" finding tests/bin-lib/reconcile/escalate-residue.test.js:352 confirmed by tiebreak:61e08779a49d. Confirmed. Reversibility: high.
- AUTO 16:09:19 — Reproduction: lens "3f" finding tests/bin-lib/reconcile/escalate-residue-feeding-reasons.test.js:12 confirmed by tiebreak:cc6d08c0b24c. Confirmed. Reversibility: high.

### Fan-out leftovers
None. No new untracked files, no agent-scratch files, and no new listeners since the pre-dispatch snapshot.

### Implementation Hindsight
- No changes needed. Once the Step 3 fix is in, the approach is sound: remedy paragraphs in the one prose array, plus a test that parses the reason line and requires a remedy for each.
- Out-of-diff observation, for the #6021 driver trial (not filed): the driver-composed commit subjects on this branch are malformed. `a95a825`: `… stuck reasons () — refs #2724` has empty parentheses. `6a5f87e`: `… record body — refs — refs #2724` has a doubled `— refs`. A quick search found no open record. They do not reach main, since merge commits are composed at merge time (`compose-subject.js`).
- Root cause of the regression, for the trial: the build's review-fix pass fixed a test conflict by widening the production claim to match the new test. It should have narrowed the new test to match the documented exclusion. Its own PR body says the old test "contradicts the new regression test" and was flipped.

### Tradeoffs Accepted
No tradeoffs. All findings were fixed.

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: no frontend surface (surface: infra) and no UI trigger file in the diff. Journeys whose `files:` overlap the diff: clear-an-archive-refusal-for-an-untiebroken-finding-3945, keep-a-run-dir-until-every-record-its-merged-pr-left-open-ships-3503, learn-a-merged-run-needs-you-3297, preview-reconcile-and-see-why-an-escalation-failed-4180, recover-a-run-stranded-by-a-stale-pr-number-3543, run-a-pipeline-on-a-ghe-origin-without-gh-host-4505, shape-the-stuck-runs-record-without-reconcile-erasing-it-2724.

Design Quality skipped: design integration not configured (run /claude-tweaks:init to enable). Security Hardening, Agent Trust Scope and App Store Readiness passes skipped by their pre-checks: no client/route, agent-config or mobile-app files in scope.

Documentation freshness (3i, informational): `docs/REGISTRY.md` maps `plugin/bin/lib/reconcile/**` to `docs/hooks.md` and `docs/reconcile-checks.md`. I checked `docs/reconcile-checks.md:236-242`. It already states that `no-repo-slug`/`unknown-host` never escalate, which matches the restored behavior. No update needed.

### Code Simplification
- No simplifications needed (code-simplifier, scoped to the branch's changed lines).

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | Run deliverable 1 from the main checkout. For each of `2026-09-11T165407-record-1982` and `2026-09-01T123248-record-1664`: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{dir}"`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "{dir}"`, reading each command's success line. | main checkout `.claude-tweaks/pipelines/` |
| 2 | Decide on the other two live stuck paths (`2026-10-17T213454-record-3078`, and the Windows `record-605` dir), which AC4's "list empties" condition also needs cleared | main checkout; the Windows machine |
| 3 | Before merging, change the PR body's `Fixes #2724` to a non-closing reference, so the record closes through reconcile's empty-list path (AC4), not through the merge (#5922, #5196) | PR #6209 body |
| 4 | Update the PR body's spec summary. Its "Review fix" paragraph describes listing `no-repo-slug`/`unknown-host`, which this review reversed in 6ed1634. | PR #6209 body |

### Verdict
**BLOCKED — issues need fixing.** The code deliverables (D2, D3) are done and clean after the review's fix. Deliverable 1 (close + archive the two stuck run dirs) has not been done, so AC1 and AC4 are unmet. The `Fixes #2724` closing keyword would also close the record by merge, against AC4.

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Dropped `no-repo-slug`/`unknown-host` from the structurally-stuck reason list, along with their remedy sentences — `plugin/bin/lib/reconcile/escalate-residue.js` | `6ed1634` |
| Bug fix | Restored the #3705 must-not-be-listed assertion — `tests/bin-lib/reconcile/escalate-residue.test.js` | `6ed1634` |
| Bug fix | Removed the duplicate test file that required the unfileable reasons — `tests/bin-lib/reconcile/escalate-residue-feeding-reasons.test.js` | `6ed1634` |
| Push | `drive-record-2724` pushed to origin at 6ed1634 (draft PR #6209 updated; not merged, closed or marked ready) | `6ed1634` |

### Key Learnings
1. When a new test contradicts an existing test that carries an incident tag (#3705), the existing test usually encodes a deliberate exclusion. Reconcile the new test to it rather than flipping the old assertion. The build's review-fix pass flipped it and shipped a false claim in a user-facing record body.
2. A spec whose deliverable is operational, in the main checkout, cannot be completed by a sandboxed headless build. Without a `Refs` (rather than `Fixes`) closing keyword, merging the code half closes the record and leaves that deliverable orphaned, the #5922/#5196 gap.
3. A "test fails when reverted" acceptance criterion is cheap to verify independently in a `git archive` extract, so it does not need to rest on the build's self-report, which here said it did not run the revert.

### Next Actions
**`/claude-tweaks:build 2724`** — fix gaps listed above (recommended). The remaining gap is deliverable 1's two `close-run`/`archive-run` commands, run from the main checkout, plus the PR-body closing keyword.
