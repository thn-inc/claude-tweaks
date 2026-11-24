## Review: #4191 — reconcile: isClosedSlugStuck should also cover state-less spec-{n}-… dirs whose named records are all CLOSED (PR #6219)

**Review effort:** low (derived from record labels: risk:low × size:medium; the diff heuristic agrees: 2 files, 9 lines, internal lib, no merge-sensitive paths. No `review-effort-floor` is set.)

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| 1. Widen `RECORD_SLUG_RE` (or add a sibling) so `isClosedSlugStuck` also matches `spec-{n}[-{n}…]` slugs | done |
| 2. Archive such a dir when every named record is CLOSED | done |

| Acceptance Criterion | Status |
|---------------------|--------|
| A fixture `spec-11-12` dir with `config.yml`, no `run-state.json`, and both records CLOSED is archived by a reconcile pass | met. As built, the branch proved this only at the predicate level (`isClosedSlugStuck` returns true). The review added a pass-level test: `archiveMerged` archives a config-only `spec-9005-9006` dir through a stubbed `gh issue view`. |
| The same dir with one record OPEN is left in place | met (predicate test) |
| The new test fails against the pre-change code | met. I verified this by reverting in an archive extract. Against `origin/main`'s `archive-merged.js`, both the build's new predicate test and the review's new pass-level and `recordNumbersFromSlug` assertions fail. |

- Risk markers: none. The record has no Gotchas or Open Questions.
- Non-goals: none declared.
- Current-State outcome: reached. The `archiveMerged` main-loop call site now reaches the predicate for `spec-` slugs. The two named instances (`2026-08-17T125939-spec-783-784-781`, `2026-08-30T105718-spec-1703-1704`) were already closed by hand under #2724.
- Cherry-pick provenance: no duplicate open PR. Merge provenance: no merge commits in range.

### Verification (from /test)
- Type check: n/a (no type-check command configured)
- Lint: n/a (no lint command configured; the scope reported `static: yes`)
- Tests: pass. Before the review, the runner stamp `57b7b0e` (scoped) verified HEAD. After the review's fix wave, the re-verify was scoped with `--local`: 150 of 1432 test files impact-selected, `tests 6296, pass 6284, fail 0`, and the stamp `360c235742` verifies HEAD. PR CI was all green on `57b7b0e` (shards 1-4, test); the new head `360c235742` was pushed, and its CI was still running when this summary was written.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)

Lenses 3b and 3c each ran as a single read, as `low` tier specifies. Both independently reported the same two defects, and every finding went to the Step 3.7 tiebreak. This standalone review applied the recommended "Fix now" routes without an `AskUserQuestion` round, because the invocation asked the review to apply, commit and push its own fixes.

| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| error | The widened `RECORD_SLUG_RE` sends every `-spec-{digits}` slug to `resolveIssueStateByNumber` (`gh issue view N`) with no work-backend gate, though the same file turns off its #3503 record check under `work-backend: local-files`, where a record number is not a GitHub issue. A stale config-only `spec-{n}` dir in a local-files repo with a GitHub remote would be archived whenever an unrelated issue #n is CLOSED. (`plugin/bin/lib/reconcile/archive-merged.js:1138`) | medium | fixed in `360c235742`: the call site now reads `recordCheckApplies && isClosedSlugStuck(...)`. A pass-level test leaves a `spec-9007` dir in place under `local-files` even with #9007 CLOSED. A revert proof showed this test red without the gate. |
| convention | The comment at `archive-merged.js:1162` said `RUN_RECORD_SLUG_RE` stays separate "on purpose" because `RECORD_SLUG_RE` is record-only. After the change the two regexes were byte-identical. The `recordNumbersFromSlug` header (1140-1143), the 1127 header, `docs/reconcile-checks.md:412` and a test title all still described the slug as record-only. | low (3b mirror: info) | fixed in `360c235742`: collapsed into a single `RECORD_SLUG_RE`, which `runRecordSet` now uses too. Comments, `docs/reconcile-checks.md` and the test title were corrected, and a `spec-783-784-781` parse assertion was added. |
| security | The archival identity is a basename-only match. A topic-named run whose slug happens to end in `-spec-N` (e.g. `…-fix-the-spec-12`) qualifies once issue #N is CLOSED, with no cross-check against `config.yml`. (`archive-merged.js:1138`) | low | accepted (see Tradeoffs Accepted) |

### Tiebreak

**Verdicts:** 3 confirmed · 0 dropped · 1 digest · 0 console

- `AUTO 18:47:04 — Reproduction: lens "3b" finding plugin/bin/lib/reconcile/archive-merged.js:1162 confirmed by tiebreak:159c31cbdce6. Confirmed. Reversibility: high.`
- `AUTO 18:48:14 — Reproduction: lens "3c" finding plugin/bin/lib/reconcile/archive-merged.js:1138 confirmed by tiebreak:b1532c7ea1aa. Confirmed. Reversibility: high.`
- `AUTO 18:48:14 — Tiebreak tiebreak:0c4150574152: lens "3c" finding plugin/bin/lib/reconcile/archive-merged.js:1162 digested: evidence-unverified. Severity: low. Reversibility: high.`
- `AUTO 18:48:14 — Reproduction: lens "3b" finding plugin/bin/lib/reconcile/archive-merged.js:1138 confirmed by tiebreak:208de0950b41. Confirmed. Reversibility: high.`

The `0c4150574152` digest is an artifact of the order I worked in, not a judge disagreement. The judge returned `confirmed`, but I had already applied the comment fix before running `resolve-tiebreak` on that chunk. Its quoted line (`// Separate from RECORD_SLUG_RE on purpose…`) no longer existed in the live file, so evidence verification failed. The same claim was confirmed independently as `159c31cbdce6` before the edit, and it is fixed. No can't-tell findings of medium or higher.

### Fan-out leftovers
None. No untracked files and nothing left under agent scratch. No new listeners since the pre-dispatch snapshot.

### Implementation Hindsight
No changes needed. The approach is sound. The two approach gaps hindsight would have raised were already fixed in Step 3 Routing: the backend gate on the identity probe, and the stale duplicate regex. No skill-worthy pattern emerged.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| Under `work-backend: github-issues`, a state-less, config-only, past-TTL run dir whose topic slug happens to end in `-spec-N` or `-record-N` is archived once issue #N is CLOSED, with no identity cross-check. The same applies to a legacy dir whose spec number was a spec-file number. | Slug-as-identity is #1811's deliberate design for this shape, and the `record-` slug has always had this property. The only dirs that qualify have no `run-state.json` past the TTL. That is dead residue whose correct end state is archival, so a mis-match archives it sooner but loses nothing: archiving is a move, a `git mv` plus commit for tracked content. I checked every name under `.claude-tweaks/pipelines/` and `archive/` (396 archived `spec-` dirs plus every topic-named dir): none ends in `-spec-N` or `-record-N` except real run slugs. Today no live `spec-` dir is config-only without state. A `config.yml` cross-check is not viable, because `spec:` is written inconsistently (`5304` for a 14-spec run, `1703-1704`, `783,784,781`). |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: "no frontend surface (no surface declared) and no UI trigger file in the diff". Journeys overlapping the diff (`files:` on `archive-merged.js`): archive-a-merged-run-only-after-main-catches-up-4387, archive-a-stateless-run-dir-that-still-holds-its-spec, archive-stranded-spec-shells-in-one-pr-3975, clear-an-archive-refusal-for-an-untiebroken-finding-3945, keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416, keep-a-run-dir-until-every-record-its-merged-pr-left-open-ships-3503, keep-cant-tell-findings-through-a-console-less-auto-merge-4171, learn-a-merged-run-needs-you-3297, preview-reconcile-and-see-why-an-escalation-failed-4180, read-where-a-pipeline-run-spent-its-minutes-1928, recover-a-queue-write-the-unattended-console-could-not-file-4170, recover-a-run-stranded-by-a-stale-pr-number-3543, run-a-pipeline-on-a-ghe-origin-without-gh-host-4505, see-an-ad-hoc-sessions-friction-at-wrap-up-2783, see-the-commit-an-archival-made-3721, session-start-fast-background-reconcile, settle-every-review-finding-at-the-console-3949, shape-the-stuck-runs-record-without-reconcile-erasing-it-2724

### Code Simplification
| # | File | Change | Lines |
|---|------|--------|-------|
| 1 | plugin/bin/lib/reconcile/archive-merged.js | Reflowed an overlong comment line in the #3503 `recordCheckApplies` comment block, inside the review's own hunk. No behavior change. | -2/+3 |

Verification: pass (included in the `360c235742` re-verify above).

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

Design Quality was skipped: design integration is not configured (run /claude-tweaks:init to enable). The Security Hardening, Agent Trust Scope and App Store Readiness passes were all skipped at their pre-checks, because no client/route, agent-config or mobile-app files are in scope. Lens 3i (docs freshness) matched `docs/reconcile-checks.md` for `plugin/bin/lib/reconcile/**`, and the stale `isClosedSlugStuck` slug wording it would have flagged was corrected in `360c235742`.

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Gate `isClosedSlugStuck`'s issue-state probe on `recordCheckApplies` (off under `work-backend: local-files`) — `plugin/bin/lib/reconcile/archive-merged.js` | `360c235742` |
| Convention fix | Collapse the byte-identical `RUN_RECORD_SLUG_RE` into `RECORD_SLUG_RE`; correct the stale record-only comments — `plugin/bin/lib/reconcile/archive-merged.js`, `docs/reconcile-checks.md` | `360c235742` |
| Tests added | Pass-level `archiveMerged` tests (spec-slug archive; local-files left in place) and a `spec-` parse assertion; both new pass-level tests shown red on the relevant pre-fix code — `tests/bin-lib/reconcile/archive-merged-record-guards.test.js` | `360c235742` |
| Simplified | Comment reflow — `plugin/bin/lib/reconcile/archive-merged.js` | `360c235742` |
| Pushed | `drive-record-4191` `57b7b0e33a..360c235742` to origin (PR #6219 stays draft; not merged, closed or marked ready) | `360c235742` |

### Key Learnings
1. Widening a slug regex that feeds `gh issue view` must inherit the file's existing work-backend gate. The #3503 `recordCheckApplies` guard was about 1,300 lines away from the regex, and the build missed it. Any change to what counts as a record number in `archive-merged.js` should grep for `recordCheckApplies` first.
2. Settle the tiebreak before applying fixes. `resolve-tiebreak` checks the judge's quoted line against the live file, so a fix applied first turns a confirmed finding into `evidence-unverified` (`0c4150574152` here).
3. A predicate-level test does not prove an acceptance criterion phrased "archived by a reconcile pass". `archive-merged-record-guards.test.js` already has a pass-level harness for this (`installGhIssueStateWrapper` plus `archiveMerged({ cwd })`), and the build should have used it.

### Next Actions

**`/claude-tweaks:wrap-up 4191`** — capture learnings and clean up (recommended)
