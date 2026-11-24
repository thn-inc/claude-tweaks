## Review: #4259 — Share one test:true denial predicate across friction-events, calibration, and phase-timing (PR #6227)

**Review effort:** low (derived from record labels: risk:low × size:low; the diff heuristic agreed — risk proxy low, 4 files / 20 lines → low)

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| Add one shared predicate beside `FRICTION_EVENT_TYPES` in `plugin/bin/lib/friction-lens-vocab.js` and use it from `friction-events.js`, `calibration/events-reader.js`, and `timing/derive.js` | done — `isTestTaggedEvent` (`friction-lens-vocab.js:31`), imported by all three readers |
| Decide whether calibration drops every `test: true` event regardless of type, and apply it in the shared predicate | done — decided type-scoped: `TEST_TAGGED_TYPES` = `gate-denial`, `wd-guard-refusal`, `gate-exempt-gitignored`. That matches every `CT_HOOKS_TEST_MODE` tag site under `plugin/bin/lib/hooks/`, and keeps #1337's pinned rule that untagged-type events carrying `test: true` (e.g. `wd-deny`, `commit`) still count |

| Acceptance Criterion | Status |
|---------------------|--------|
| A fixture `events.jsonl` holding one `test: true` and one real `gate-denial` yields the same real-only count from `friction-events.js`, `calibration-report.js`, and `phase-timing.js`'s guard-cost figure | met — the code satisfied it at review start but no fixture test existed (partially met); the review added `tests/test-tagged-event-exclusion-parity.test.js` (`b321654`) |
| Grepping `plugin/bin` for the `parsed.test === true` denial predicate finds it in exactly one place | met — only `plugin/bin/lib/friction-lens-vocab.js:32` |

Risk markers: none in the record. Current-State outcome: reached — `countGuardEvents` (the phase-timing guard-cost gate the record named) now applies the shared exclusion.

### Verification (from /test)
- Type check: n/a — none configured
- Lint: n/a — none configured
- Tests: pass. At review start, the runner stamp verified HEAD `53a6846`. After the review's fixes, the scoped re-verify at HEAD `971d440` took the `tests` suite from PR CI run 45468549129 (shards 1–4 and `test`, all success; https://github.com/thn-inc/claude-tweaks/actions/runs/45468549129). That CI-sourced pass does not cover macOS, Node 22 or Windows.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| test | `countGuardEvents` (`plugin/bin/lib/timing/derive.js:462`) now drops `test: true` gate-denials, but no test pinned it — reverting the guard left the suite green — and AC1's cross-reader parity fixture was absent | medium | fixed — `b321654` (new parity test; proven red with the derive.js guard reverted in a scratch copy, control red, unmutated green) |
| test | Calibration's new `test: true` `gate-exempt-gitignored` exclusion (`plugin/bin/lib/calibration/events-reader.js:23`) had no test, so narrowing `TEST_TAGGED_TYPES` back to two types would go unnoticed | low | fixed — `b321654` (proven red with `gate-exempt-gitignored` removed from `TEST_TAGGED_TYPES` in a scratch copy) |

> Low tier: lenses 3b (Security) and 3c (Error Handling) ran as single reads. 3b: No findings. 3c: the two findings above, both `unconfirmed` until Step 3.7's tiebreak confirmed them.

### Tiebreak
**Verdicts:** 2 confirmed · 0 dropped · 0 digest · 0 console
- AUTO 20:14:13 — Reproduction: lens "3c" finding plugin/bin/lib/timing/derive.js:462 confirmed by tiebreak:ff91c6e778b1. Confirmed. Reversibility: high.
- AUTO 20:14:13 — Reproduction: lens "3c" finding plugin/bin/lib/calibration/events-reader.js:23 confirmed by tiebreak:7a0c5575a014. Confirmed. Reversibility: high.

### Fan-out leftovers
0 untracked file(s) left by the review fan-out; agent-scratch empty. 1 new local listener since the pre-dispatch snapshot, reported (not killed; ownership unattributed): 2.1.325:64486

### Implementation Hindsight
- The comments beside the two pre-existing call sites (`plugin/bin/friction-events.js` readEvents header, `plugin/bin/lib/calibration/events-reader.js:20`) still restated the type list ("gate-denial or wd-guard-refusal") and named friction-events as the rule's home — a second copy of the list that had already drifted from the shared predicate's three types → change now — both comments now cite `isTestTaggedEvent` (`3bc8d92`)
- Approach, structure, consolidation and skill-worthy patterns: no further changes — the type-scoped predicate in one module is the right shape.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| The shared predicate is type-scoped (three listed types), not "every `test: true` event" | Existing tests (#1337 `friction-events-cli.test.js`, #4186 `readers.test.js`) deliberately pin that a `test: true` event of another type still counts; every current tag site's type is in the list (lens 3c checked each `CT_HOOKS_TEST_MODE` site). A future tag site on a new type must add its type to `TEST_TAGGED_TYPES` — now one place, not three |
| Step 3 Routing fixes applied without the interactive batch `AskUserQuestion` | The invoking instructions authorized the review to commit and push its own fixes; both findings were Fix-now test additions with no alternative route |
| Verification at the fixed HEAD rests on the PR's Linux CI run, not a local whole-suite run | The project's declared `localRuns: on-request` scoped path; the CI run covered the full 4-shard suite on HEAD `971d440` |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: "no frontend surface (no surface declared) and no UI trigger file in the diff"; journeys overlapping the diff: attribute-agent-cost-to-dispatches-3375, count-dispatched-agents-isolation-refusals-3819, count-skill-file-reads-per-file-4359, keep-test-suite-denials-out-of-the-friction-counts-4186, read-what-each-step-of-a-run-produced-5556, read-where-a-pipeline-run-spent-its-minutes-1928, see-a-runs-friction-east-of-utc-3442, see-an-ad-hoc-sessions-friction-at-wrap-up-2783, see-where-a-runs-turns-went-and-catch-budget-regressions-4029, see-which-phase-spent-the-tokens-1929

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- `plugin/bin/friction-events.js` — added the missing space in `} =require(` and re-wrapped the readEvents comment block (`971d440`)

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | AC1 cross-reader parity test plus calibration `gate-exempt-gitignored` coverage — `tests/test-tagged-event-exclusion-parity.test.js` | `b321654` |
| Bug fix | Hindsight: test:true exclusion comments point at the shared predicate — `plugin/bin/friction-events.js`, `plugin/bin/lib/calibration/events-reader.js` | `3bc8d92` |
| Simplified | Import spacing and comment wrap — `plugin/bin/friction-events.js` | `971d440` |

All three commits pushed to `drive-record-4259` (PR #6227, still draft; not merged, closed or marked ready).

### Key Learnings
1. A refactor that moves a rule into a shared predicate leaves the old call sites' explanatory comments restating the rule — sweep consumer comments in the same change, or the "one place" claim fails in prose — the comments had already drifted from three types to two within the same commit.
2. An AC phrased as "a fixture yields the same count from N readers" needs a test that drives all N readers from one fixture; per-reader tests from earlier records pinned two of the three, and the newly-wired third reader (phase-timing) was the one left unguarded.

### Next Actions
**`/claude-tweaks:wrap-up 4259`** — capture learnings and clean up (recommended)
