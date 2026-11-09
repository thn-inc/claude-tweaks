---
files:
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/operational-checklist.md
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
- **URL:** `plugin/skills/build/SKILL.md` Common Step 5; `plugin/skills/build/operational-checklist.md` Category A; `plugin/skills/test/verification.md`
- **Action:** Common Step 5 first applies any Category A operational fix the diff calls for (schema push, `.env.example` entry, test-literal rewrite, exports build) and commits it with `Category A` in the commit subject (#3489), then runs the full verification once, after Steps 6 and 6.5, and forwards `VERIFICATION_PASSED=true` with `VERIFICATION_SHA` from `report.json`.
- **Should feel:** One full-suite wait per build, not two.
- **Should understand:** Test-pinned docs like `docs/plugin-structure.md` are verified in the same run as the code they describe, because the doc edit is already in the tree. If a Step 5 failure needs a behavior-changing fix, re-check any journey or doc Steps 6/6.5 wrote that the fix contradicts *before* re-running verification, so the last green run still covers the final tree. A Step 5 fix commit is re-checked against the Category A triggers before verification re-runs, so a fix that adds a new env read or schema edit gets its operational fix in the same verified tree. A Category A action that fails or cannot complete (a rejected schema push, a broken `exports` build) is not `fixed`: it is resolved like any other Step 5 failure, or left `open` for Step 5.5's ledger row.
- **Red flags:** a fix that edits a journey after the green re-run (HEAD moves past `VERIFICATION_SHA` again); verification starting before the journeys commit lands. A commit landing while Common Step 5's suite is still running shows as `tree moved during the run (HEAD {start} -> {end}); no pass stamp written` under the results (#3757): `VERIFICATION_SHA` is the start commit, no pass stamp covers either commit, and `/test` re-verifies through the runner instead of skipping, against an anchor older than this build's pass.

### 3. /test trusts the forwarded result
- **URL:** `plugin/skills/test/verification.md` skip-if-recent
- **Action:** `/claude-tweaks:test` compares `VERIFICATION_SHA` to HEAD.
- **Should feel:** Instant on the types/lint/tests half — the remaining time is QA only.
- **Should understand:** Steps 5.5 (ledger rows) and 7 (run-state under `.claude-tweaks/pipelines/**`) still run after verification. They write only bookkeeping paths, which `.claude-tweaks/verify-scope.json` classifies as `suites: []`, so they do not force a re-run. Category A operational fixes no longer run there: they land in Common Step 5, before its verification run (#3489), so Step 5.5 writes the Category B ledger rows and one row per earlier Category A finding (`fixed` once its action completed; `open` for a schema change with no documented push command, or for an action that did not complete). Step 5.5 runs when the diff matches its triggers or `git log` since build start holds a `Category A` commit, so it never depends on remembering what Step 5 fixed. When HEAD has moved (#3284), `/test` does not skip by hand: it runs the scoped runner invocation, which reads a bookkeeping-only delta as `none` (`still-verified: bookkeeping-only delta (…)`, no suite spawned) and re-stamps HEAD. That re-stamp is what lets a dispatched group's second call read `verify.js --stamp-status` → `verifiedHead: true` at review Step 1.5 instead of re-running `/claude-tweaks:test`.
- **Red flags:** `/test` re-running the full suite on a build whose only post-verify commits are ledger/run-state bookkeeping; `/test` skipping a moved HEAD without invoking the runner, leaving the pass stamp at `VERIFICATION_SHA` so the second call's `--stamp-status` reads `verifiedHead: false`; a Category A fix commit (schema, env-example, test-literal, exports) appearing after the commit `report.json`'s `sha` names.

## Origin
- Created during `/claude-tweaks:build` of record #3060 (2026-10-17): Common Steps 6 and 6.5 moved ahead of Common Step 5 (numbers kept), order pinned by `tests/build-verify-after-doc-steps.test.js`. Prompted by #3043's build, where a full-suite launch was aborted and re-run after Steps 6/6.5 moved HEAD.
- Step 3 updated during `/claude-tweaks:build` of record #3284 (2026-10-19): the moved-HEAD case now re-stamps through the runner instead of a hand-classified skip.
- Step 2's red flags extended after #3757 (`verify.js` withholds the pass stamp when HEAD moved during the run, and `report.json`'s `sha` is the start commit): a commit landing mid-verification now shows as the `tree moved during the run` line instead of a stamp crediting it.
- Step 2 revisited after #4024: under an `impact` declaration, Common Step 5's single run is the impact-selected subset when the build is scoped-eligible (a run dir or `--source`), and the full suite otherwise; the run-once rule and the `report.json` `sha` = `VERIFICATION_SHA` link are unchanged. See `docs/journeys/verify-only-the-tests-a-change-can-affect-4024.md`.
- Steps 2 and 3 updated during `/claude-tweaks:build` of record #3489 (2026-10-28): Category A operational fixes moved into Common Step 5, ahead of its verification run, closing the last tracked-file write after verification.
- Related: `docs/journeys/run-a-deterministic-verification-check.md` (the `report.json` / pass-stamp evidence this journey relies on), `docs/journeys/declare-a-verify-scope-1924.md` (the bookkeeping classification in Step 3).
