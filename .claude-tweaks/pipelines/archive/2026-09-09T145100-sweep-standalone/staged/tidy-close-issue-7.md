# Staged: Close (GitHub) — pipeline QA story scoping already shipped in #1923

**Finding:** `[gh-issue]` #1836 (feedback, plugin 6.114.1) asks that a pipeline `/claude-tweaks:test` run filter QA stories by `source_files` against the run's committed diff and skip QA with `TEST_PASSED=true` on a non-frontend surface with no affected stories. #1923 (closed 2026-09-07) delivered this: `test/SKILL.md`'s Pipeline behavior now selects stories by `source_files` ∩ `verify.js --changed-files`, and at zero matches reads the materialized `surface:` (frontend → full set, #808; otherwise Layer 3 sniff → skip with `QA: skipped — no affected stories`, `TEST_PASSED=true`, logged). `tests/test-skill-affected-conformance.test.js` pins the literal. #1923's body names #1836 as closed by it, but the record stayed open.

**Proposed:** Close #1836 as completed — implemented by #1923.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Rows:**
- #1836 — implemented by #1923 (CLOSED 2026-09-07); conformance test `tests/test-skill-affected-conformance.test.js`

**Commands:**
gh issue comment 1836 --body "Closing as implemented: #1923 (2026-09-07) rewired test's pipeline QA selection onto source_files ∩ verify.js --changed-files with the non-frontend zero-match skip (QA: skipped — no affected stories, TEST_PASSED=true), pinned by tests/test-skill-affected-conformance.test.js. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1836 --reason completed
