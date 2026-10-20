---
files:
  - plugin/skills/build/SKILL.md
  - plugin/skills/test/verification.md
  - tests/build-verify-after-doc-steps.test.js
---

# Get One Full-Suite Run on a Docs-Touching Build

**Persona:** a maintainer running `/claude-tweaks:flow #N` (or `/claude-tweaks:dispatch` handing off `build,test`) on a record whose build writes a journey under `docs/journeys/` or updates a registered doc such as `docs/plugin-structure.md`, on a checkout where the full suite takes many minutes.
**Goal:** `/claude-tweaks:build` runs the full suite exactly once, against the tree it hands to `/claude-tweaks:test`, so `/test`'s skip-if-recent check reads that run as current instead of re-running everything.
**Entry point:** `/claude-tweaks:build` after implementation, simplification (Common Step 3) and alignment (Common Step 4.5).
**Success state:** journey and doc-sync commits land before Common Step 5; `report.json`'s `sha` / `VERIFICATION_SHA` equals the HEAD `/test` sees; `/test` skips types/lint/tests (still running QA when stories exist).

## Steps

### 1. Journeys and docs sync run right after simplification and alignment
- **URL:** `plugin/skills/build/SKILL.md` Common Step 6, then Common Step 6.5 (both now sit between Common Step 4.5 and Common Step 5; the Workflow diagram's note says "6 and 6.5 precede 5"); the order is pinned by `tests/build-verify-after-doc-steps.test.js`
- **Action:** `/claude-tweaks:journeys` creates or updates journey files and commits them; when `docs/REGISTRY.md` exists, Step 6.5 updates the registered docs the change touched.
- **Should feel:** Like the build is finishing its own paperwork before it signs off — no extra prompt, no extra suite launch.
- **Should understand:** Step numbers did not change — 6 and 6.5 still carry their old numbers, and every `Common Step 6.5 (skipped)` trace keeps its old wording. Only their position moved. A skipped Step 6.5 (no `docs/REGISTRY.md`) still writes its `SKIP` entry.
- **Red flags:** a journey or doc commit appearing in `git log` after the commit `report.json`'s `sha` names; the "After verification passes" wording back in Step 6.

### 2. Final verification covers the final tree
- **URL:** `plugin/skills/build/SKILL.md` Common Step 5; `plugin/skills/test/verification.md`
- **Action:** Common Step 5 runs the full verification once, after Steps 6 and 6.5, and forwards `VERIFICATION_PASSED=true` with `VERIFICATION_SHA` from `report.json`.
- **Should feel:** One full-suite wait per build, not two.
- **Should understand:** Test-pinned docs like `docs/plugin-structure.md` are verified in the same run as the code they describe, because the doc edit is already in the tree. If a Step 5 failure needs a behavior-changing fix, re-check any journey or doc Steps 6/6.5 wrote that the fix contradicts *before* re-running verification, so the last green run still covers the final tree.
- **Red flags:** a fix that edits a journey after the green re-run (HEAD moves past `VERIFICATION_SHA` again); verification starting before the journeys commit lands.

### 3. /test trusts the forwarded result
- **URL:** `plugin/skills/test/verification.md` skip-if-recent
- **Action:** `/claude-tweaks:test` compares `VERIFICATION_SHA` to HEAD.
- **Should feel:** Instant on the types/lint/tests half — the remaining time is QA only.
- **Should understand:** Steps 5.5 (ledger rows) and 7 (run-state under `.claude-tweaks/pipelines/**`) still run after verification. In the common case they write only bookkeeping paths, which `.claude-tweaks/verify-scope.json` classifies as `suites: []`, so they do not force a re-run. The exception is a Step 5.5 Category A operational fix (schema push, env-example entry), which edits tracked files and moves HEAD past `VERIFICATION_SHA`. When HEAD has moved (#3284), `/test` does not skip by hand: it runs the scoped runner invocation, which reads a bookkeeping-only delta as `none` (`still-verified: bookkeeping-only delta (…)`, no suite spawned) and re-stamps HEAD. That re-stamp is what lets a dispatched group's second call read `verify.js --stamp-status` → `verifiedHead: true` at review Step 1.5 instead of re-running `/claude-tweaks:test`.
- **Red flags:** `/test` re-running the full suite on a build whose only post-verify commits are ledger/run-state bookkeeping; `/test` skipping a moved HEAD without invoking the runner, leaving the pass stamp at `VERIFICATION_SHA` so the second call's `--stamp-status` reads `verifiedHead: false`.

## Origin
- Created during `/claude-tweaks:build` of record #3060 (2026-10-17): Common Steps 6 and 6.5 moved ahead of Common Step 5 (numbers kept), order pinned by `tests/build-verify-after-doc-steps.test.js`. Prompted by #3043's build, where a full-suite launch was aborted and re-run after Steps 6/6.5 moved HEAD.
- Step 3 updated during `/claude-tweaks:build` of record #3284 (2026-10-19): the moved-HEAD case now re-stamps through the runner instead of a hand-classified skip.
- Related: `docs/journeys/run-a-deterministic-verification-check.md` (the `report.json` / pass-stamp evidence this journey relies on), `docs/journeys/declare-a-verify-scope-1924.md` (the bookkeeping classification in Step 3).
