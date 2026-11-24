## Review: #4108 — closingRecords is array-or-null (PR #6173, branch drive-record-4108)

**Review effort:** medium (derived from record labels: risk:medium × size:medium; the diff heuristic agrees: 9 files, +104/−13, no merge-sensitive paths)

**Scope:** `origin/main...HEAD`, base `8d217321dd`, reviewed HEAD `7584a149ef`. No merge commits and no cherry-pick provenance. Standalone review: no `$PIPELINE_RUN_DIR`, so code mode runs every step. The driver run dir `2026-11-23T191557-drive-4108` (fast-lane, express lane) was read for context only.

### Spec Compliance

| Deliverable | Status |
|-------------|--------|
| 1. `pack.js` `closingRecords` returns `null` on `unavailable` and keeps `records` / `[]`; comment and documented field shape updated | partial → done after review fix (the journey doc's field shape and Section C's definition did not name `null`; fixed in `694a96e1e4`) |
| 2. `execution-and-verification.md` current-branch `Fixes` sentence: an array (even empty) is the set; only `null` or a missing pack falls back; cites Section C, names no rung | done |
| 3. `review-console.md` step 11 `issues` sourcing follows the same rule | done |
| 4. `engine-verify.js` `resolvedIssueNumbers` returns any array, empty included, and falls through only on `null` | partial → done after review fix (the driver's review commit `7584a149ef` added a `resolved.source !== 'config'` fall-through; removed in `694a96e1e4`) |
| 5. Update the conformance pin; add the cases | done |

| Acceptance Criterion | Status |
|---------------------|--------|
| `closingRecords` manifest → `[]`, unavailable → `null`, header rungs → records (pack.test.js) | met |
| `resolvedIssueNumbers` manifest fixture → `[]`, unavailable fixture → `[41]` (engine-verify.test.js) | met |
| Prose test pins empty-array-stamps-nothing and null-or-missing-pack-only fallback in both files | met |
| `assertNoGateRestatement` still passes for both files | met |
| Revert each change and show which new test fails | met (build evidence in the PR body; this review re-proved its own two new assertions: config-rung test red at `[41]` vs `[]` against the pre-fix engine-verify; the end-to-end `null` assertion red at `[]` vs `null` with pack.js's unavailable line removed) |
| `npm test` passes | met (PR CI, full suite, 4/4 shards + `test` green on head `888fb91927`) |

Current-State outcome reach: met. The three readers named in Current State now read the array/null distinction. Section C's bash was already correct, and a new fixture test pins it. Gotchas readers: `two-call-gate.md` and `cleanup-procedures.md` item 4 both route through Section C, so neither needs a change (tiebreak-confirmed, below).

### Verification (from /test)
- Runner stamp: `verifiedHead: true` on `7584a149ef` (scoped run anchored on `fullSha` `8d217321dd`)
- Review-fix re-verify: the 4 covering files through `tools/run-tests.js` passed 527/527, 0 failed; engine-verify.test.js after simplify passed 243/243, 0 failed
- PR CI on head `888fb91927`: shard 1/4 to 4/4 pass, `test` pass, `label-fix-branch` pass

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
Lenses dispatched as reproduction pairs: 3a Convention, 3c Error handling, 3f Test quality. 3b Security was not dispatched because it has nothing to act on (no input boundary, shell, path or auth surface). Both 3c agents returned "No findings."

| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| convention | `engine-verify.js:468`: `resolvedIssueNumbers` re-decided the config rung (`resolved.source !== 'config'`) instead of reading `closingRecords`. That contradicted Deliverable 4 and Ruling R1's "decided once in pack.js". It also had no effect: review-console step 11 is the only writer of `verify-expectations.json` `issues`, and it records nothing for `[]`, so only a hand-seeded fixture reached the branch. | medium (severity contested: medium vs high) | fixed `694a96e1e4` |
| docs | `docs/journeys/gather-the-wrap-up-fact-pack-1930.md:37`: field shape documented `closingRecords` as `records` / `[]` only, with no `null` on `unavailable` | low | fixed `694a96e1e4` |
| test | `tests/wrap-up-record-resolution-conformance.test.js:183`: source-shape pins tied to the local name `resolved` and the `RECORD_DEPS` call shape | low | fixed `694a96e1e4` (single-expression `closingRecords(resolveRecords(` pin restored) |
| test | `tests/bin-lib/wrap-up/engine-verify-config-rung-4108.test.js`: one-test file beside the module's own suite | low | fixed `694a96e1e4` (file deleted; config case moved into engine-verify.test.js, now asserting `[]`) |
| docs | `plugin/skills/wrap-up/cleanup-procedures-execution.md:72`: Section C step 2, the one definition, never named `null` / `unavailable`, while the readers say "only when that field is `null`" | low | fixed `694a96e1e4` |
| test | `tests/bin-lib/wrap-up/pack.test.js:357`: end-to-end `unavailable` `resolveInputs` case did not assert `inputs.closingRecords === null` | low | fixed `694a96e1e4` |
| test | `tests/wrap-up-pack-conformance.test.js:231`: assertion loosened to accept `null` on a header-rung-only fixture | low | fixed `694a96e1e4` (`Array.isArray` restored) |
| docs | `plugin/skills/dispatch/two-call-gate.md:39`: "when the pack could not be produced" never names `null` | info | accepted: the outcome is unchanged (`null` arises only once the mirror glob is also empty), and the Section C definition fix covers it |
| convention | `plugin/skills/wrap-up/review-console.md:26`: tests for a header with "non-empty" | info | accepted: "non-empty" is the correct "has a materialized header" predicate |

### Tiebreak

**Verdicts:** 5 confirmed · 1 dropped · 0 digest · 0 console (plus 1 chunk-2 info verdict confirmed / recommend drop, counted above)
- AUTO 05:33:21 — Reproduction: lens "3a" finding plugin/skills/wrap-up/cleanup-procedures-execution.md:72 confirmed by tiebreak:4c5ed01f677e. Confirmed. Reversibility: high.
- AUTO 05:33:21 — Reproduction: lens "3a" finding plugin/skills/dispatch/two-call-gate.md:39 confirmed by tiebreak:5ca298bd003d. Confirmed. Reversibility: high.
- AUTO 05:33:21 — Reproduction: lens "3f" finding tests/wrap-up-pack-conformance.test.js:231 confirmed by tiebreak:7c8c28af616b. Confirmed. Reversibility: high.
- AUTO 05:33:21 — Reproduction: lens "3f" finding tests/bin-lib/wrap-up/pack.test.js:357 confirmed by tiebreak:65311b9a5fad. Confirmed. Reversibility: high.
- AUTO 05:33:21 — Tiebreak tiebreak:cbc0acb2a74a: lens "3f" finding plugin/skills/dispatch/two-call-gate.md:39 dropped: refuted by tiebreak (neither reader makes its own `null` decision; both route through Section C, whose snippet is pinned). Severity: low. Reversibility: high.
- AUTO 05:32:04 — Reproduction: lens "3a" finding plugin/skills/wrap-up/review-console.md:26 confirmed by tiebreak:30cc185c6abe. Confirmed. Reversibility: high.
- Not sent to tiebreak: two lens-3a unconfirmed entries about the config-rung test file's placement, because the same finding was already confirmed by lens 3f's pair (cross-lens de-dup). Cross-lens corroboration (medium tier) promoted nothing.

### Fan-out leftovers
No untracked files and no files left under agent-scratch. Nine new local listener command:port pairs since the pre-dispatch snapshot, reported only (not killed; ownership unattributed): Claude Code session ports `2.1.325` on 127.0.0.1:50797/50860/50923/50991/51073/60694, `node` on :20300, and `rapportd` on :62240/62241/64305 (macOS system service).

### Implementation Hindsight
No changes needed — approach is sound. Array-or-null fixes the manifest-rung bug at its source, and with the config exception removed, every rung follows the one decision in pack.js. Observation only, outside the diff: the driver composed two malformed commit subjects (`… the Phase 1 record () — refs #4108` and `… — refs — refs #4108`). Fixing them would mean rewriting history on a pushed PR, so they were left as they are.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| On the config rung (express runs), wrap-up's `carrier-commit` and `acceptance-labeling` verify rows now skip instead of checking the record | Ruling R1 already says the config rung carries no closing intent, and this PR's step 11 wording records no `issues` for `[]`. The removed engine-verify exception could not restore the check, because no writer feeds it. Verifying an express run's PR-body `Fixes` would need its own producer, which is outside this record's scope. |
| `two-call-gate.md:39` and `review-console.md:26` wording left as is | No behavior difference; each defers to Section C or tests a different, correct predicate |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: "no frontend surface (surface: backend) and no UI trigger file in the diff". Journeys whose `files:` overlap the diff include gather-the-wrap-up-fact-pack-1930, verify-wrap-ups-closure-checklist-900, settle-every-review-finding-at-the-console-3949, plus 33 others from the gate's list.

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable). Security Hardening, Agent Trust Scope and App Store Readiness passes were skipped by their pre-checks: no client or route files, neither trust-scope config file touched, no mobile-app signal.

### Code Simplification
| # | File | Change | Lines |
|---|------|--------|-------|
| 1 | tests/bin-lib/wrap-up/engine-verify.test.js | Replaced the duplicated fs-backed `deps` object in the two #4108 tests with one test-local `FS_RECORD_DEPS` | -2/+3 |

Verification: pass (243/243)

### Skill Load Delta
Skill load delta (base 8d21732 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 41 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +38 more | 1,944–52,101 | 0 | 7,443,939–7,484,541 | +384 | — |

(Re-run on the final head `888fb91927`. The pre-fix head measured ΔClosure +215; the review's Section C edit adds the other 169 bytes.)

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Drop `resolvedIssueNumbers`' config-rung exception; `closingRecords`' array is the decision on every rung — `plugin/bin/lib/wrap-up/engine-verify.js` | `694a96e1e4` |
| Bug fix | Config-rung case moved into `engine-verify.test.js` asserting `[]`; `engine-verify-config-rung-4108.test.js` deleted; conformance pin restored — `tests/` | `694a96e1e4` |
| Bug fix | Section C step 2 names `null` (unavailable, no decision) and falls back on it — `plugin/skills/wrap-up/cleanup-procedures-execution.md` | `694a96e1e4` |
| Bug fix | Journey doc documents array-or-null — `docs/journeys/gather-the-wrap-up-fact-pack-1930.md` | `694a96e1e4` |
| Bug fix | End-to-end `null` pin on the unavailable rung; `Array.isArray` restored on the header-rung conformance fixture — `tests/bin-lib/wrap-up/pack.test.js`, `tests/wrap-up-pack-conformance.test.js` | `694a96e1e4` |
| Simplified | Shared `FS_RECORD_DEPS` in the #4108 tests — `tests/bin-lib/wrap-up/engine-verify.test.js` | `888fb91927` |

Both commits are pushed to `drive-record-4108`. The PR was not merged, closed, or marked ready, and wrap-up was not run.

### Key Learnings
1. A reader-side carve-out keyed on the producer's internal source enum (`resolved.source !== 'config'`) quietly re-decides a "decided once" rule. The existing guard (`assertNoGateRestatement`, the engine-verify `HEADER_SOURCES` scan) only lists the header-rung tokens, so `'config'` slipped through. When a fix adds a fallback, check that the fallback has a real writer, not just a hand-seeded fixture.
2. A pipeline review fix can undo the record's own decision. The driver's in-run review "restored" behavior on the config rung, but the restored path had no producer. Re-judging prior review fixes against the spec's Decision text, not only against the code, caught it.
3. Changing what a value means (array-or-null) has to reach the one definition sentence the readers cite (Section C), not only the readers. Otherwise the definition and its readers drift apart while every test stays green.

### Next Actions

**`/claude-tweaks:wrap-up 4108`** — capture learnings and clean up (recommended)
