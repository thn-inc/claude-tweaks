---
files:
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/test/SKILL.md
  - plugin/skills/test/verification.md
---

# Pass the Review Test Gate After a Ledger Commit

**Persona:** a maintainer running `/claude-tweaks:flow #N` or `/claude-tweaks:dispatch`, whose build commits a bookkeeping-only change (a run-ledger row recording AC results) after `/build` Common Step 5's full verify, so HEAD moves past `VERIFICATION_SHA` before `/test` and `/review` run.
**Goal:** reach `/claude-tweaks:review` Step 2 without hand-running `verify.js` and without the test gate re-running `/test` in a loop — and, when the gate cannot pass, learn exactly why.
**Entry point:** `/claude-tweaks:test` invoked by `/flow` with `VERIFICATION_PASSED=true VERIFICATION_SHA={sha}`, then `/claude-tweaks:review` Step 1.5's pipeline branch reading `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status`.
**Success state:** a bookkeeping-only delta since the last full pass leaves a `scope: none` stamp at the new HEAD (after a scoped build pass, a `scoped` stamp instead — see step 1), so review Step 1.5 reads `verifiedHead: true` and proceeds; a project with no verification commands proceeds on one logged `AUTO` line; a stamp still unverified after one re-trigger stops the review with a named cause, never a second re-trigger.

## Steps

### 1. `/test` sees HEAD has moved past `VERIFICATION_SHA`
- **URL:** `plugin/skills/test/SKILL.md` Pipeline Context Awareness (the paragraph above **Pipeline behavior:**); `plugin/skills/test/verification.md` Skip-if-recent **Mismatch** bullet
- **Action:** `/test` compares `VERIFICATION_SHA` to `HEAD`. They differ, so it does not take the `VERIFICATION_PASSED=true` skip. It runs `verification.md`'s Mismatch branch instead: the scoped `verify.js` invocation classifies the delta against `.claude-tweaks/verify-scope.json`. A delta that is only bookkeeping paths (`docs/plans/*-ledger.md`, `.claude-tweaks/pipelines/**`) resolves to `none`: no suite runs, the runner prints `still-verified: bookkeeping-only delta ({paths})`, and it re-stamps HEAD. The rest of the bullet then applies as written (QA selection, `skip-qa`, `TEST_PASSED=true`).
- **Should feel:** Fast — no suite re-run for a ledger row, and no prompt.
- **Should understand:** The skip is honored only when the SHA matches. Any non-bookkeeping path in the delta runs the suites its paths map to (or the full procedure when the project has no scope declaration), with the note "Verification re-run — tree changed since build's pass", which then replaces a "passed in build" report. The delta is measured from the stamp's `fullSha` (the last full pass), not from `VERIFICATION_SHA`: when build's own verify was scoped, build's changes are still in that delta, so a ledger-only commit re-runs their mapped suites instead of resolving to `none`, and the resulting `scoped` stamp still verifies HEAD.
- **Red flags:** `/test` reporting "passed in build" while HEAD differs from `VERIFICATION_SHA`; a moved HEAD that never reaches the runner, leaving the stamp at `VERIFICATION_SHA`; a code change in the delta skipped as bookkeeping.

### 2. Review Step 1.5 reads a stamp that verifies HEAD
- **URL:** `plugin/skills/review/code-mode-steps.md` Step 1.5 "In `/claude-tweaks:flow` pipeline" and its Gate table
- **Action:** With `TEST_PASSED=true`, review runs `verify.js --stamp-status`. The `none` stamp from step 1 reads `verifiedHead: true`, so review runs the `pr-checks.js` read and proceeds to Step 2.
- **Should feel:** Invisible — the gate passes on the runner's own artifact.
- **Should understand:** `verifiedHead: true` covers a full pass, a passing scoped run anchored on a still-valid `fullSha`, complete per-suite records, or a tree dirty only in declared `generated` paths.
- **Red flags:** Review re-triggering `/test` after a bookkeeping-only commit; a hand-run `verify.js` needed to get past the gate.

### 3. A project with no verification commands
- **URL:** `plugin/skills/review/code-mode-steps.md` Step 1.5 Gate table, the zero-test row
- **Action:** When `--stamp-status` reports `present: false` and no verification commands are configured (none in CLAUDE.md, the stack manifests, or `verify-scope.json` `checks`), and `scopeError` is null (an unreadable `verify-scope.json` never counts as "no checks" — it takes the re-trigger and STOP path), review does not re-trigger. It logs to `decisions.md` through `log-decision.js --section "/review"` the line `AUTO {time} — review Step 1.5: no verification commands configured; zero-test pass accepted without a runner stamp. Reversibility: high.`, runs the `pr-checks.js` read, and proceeds.
- **Should feel:** Unblocked but recorded — the run continues, and the audit trail says why it had no stamp.
- **Should understand:** `verify.js` refuses to run without a command, so a zero-test project can never get a stamp. The row keys only on commands being absent; QA stories, if any, are still governed by the QA Ledger Check.
- **Red flags:** A zero-test project re-triggering `/test` or stopping at the gate; the zero-test pass taken while commands are configured; no `AUTO` line in `decisions.md`.

### 4. The stamp still does not verify HEAD after one re-trigger
- **URL:** `plugin/skills/review/code-mode-steps.md` Step 1.5 Gate table, the re-trigger row and the "That re-check still reads `verifiedHead: false`" row
- **Action:** Any other `verifiedHead: false` is reported ("TEST_PASSED set but the runner stamp does not verify HEAD…"), and review re-triggers `/claude-tweaks:test` once and re-checks. If the re-check still reads `verifiedHead: false`, review **STOPs** and names the cause: `dirty: true` with the dirty paths, a `scopeError`, `{sha} ({scope}) ≠ {head}`, `present: false` with commands configured, or otherwise the stamp as read (`sha`, `scope`, `fullSha`).
- **Should feel:** Like any other gate stop — one clear reason, nothing to dig out of `verify.js`.
- **Should understand:** There is no second re-trigger, and no exemption for a tree dirty only with bookkeeping paths: commit or clean the tree, then re-run `/claude-tweaks:test`. The standalone branch's "triggered (standalone) and passes" row does not apply inside a pipeline.
- **Red flags:** A second `/test` re-trigger; a STOP that names no cause; a dirty tree passing the gate.

## Origin
- Created during `/claude-tweaks:build` of record #4395 (2026-11-03): `/test`'s `VERIFICATION_PASSED` skip now applies only when `VERIFICATION_SHA` equals `HEAD`, and review Step 1.5 gained a zero-test row and a terminal STOP naming the cause after one re-trigger.
- Related: `docs/journeys/run-a-deterministic-verification-check.md` (the runner and its stamp), `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md` (the `pr-checks.js` read both passing paths run)
