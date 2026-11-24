## Review: #3788 — Reconcile the never-run rule with the console-residue SessionStart banner (draft PR #6210)

**Review effort:** low (derived from record labels: risk:low × size:low; the diff heuristic agrees: 3 files, 10 lines, no sensitive paths → low)

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| Bring the console-residue banner under the #3419 rule: trailer says relay each item with its command and never run `--ack`/`--ack-all`; act on an item or mark a run reviewed only when the user asks in this session | done (`plugin/bin/lib/hooks/session-start.js:260-261`) |
| Reword "act on it … and mark the run reviewed" into a relay instruction, keeping "no human has reviewed" as the reason | done |
| Pin the trailer's `never run it yourself` clause in `tests/hooks-session-start.test.js` beside the two existing banner pins, with a go-red control | done (`tests/hooks-session-start.test.js:166-168`: an `includes` pin plus a `doesNotMatch` on the old "mark the run reviewed with its own command above" wording) |
| No carve-out added to `docs/hooks.md` | done |

| Acceptance Criterion | Status |
|---------------------|--------|
| The banner's trailer contains the `never run it yourself` clause and no instruction to run `--ack` or act on items unprompted | met |
| The test asserts the clause, and reverting the trailer turns that assertion red | met. Checked by restoring `origin/main`'s `session-start.js` in a `git archive` copy of HEAD: `#3370: an archived run with unreviewed console items gets its own banner naming both items` failed with `AssertionError: console-residue banner says never run it yourself`, and the other three #3370 tests stayed green |
| `docs/hooks.md`'s #3419 bullet is unchanged (no carve-out), and its list of compliant banners names the console-residue banner | met, with a reading. The #3419 bullet (`docs/hooks.md:42`) is untouched. That bullet has no list of compliant banners, so the build recorded compliance in the console-residue banner's own bullet (`docs/hooks.md:47`: "the trailer closes with `never run it yourself` (#3788), because `--ack` records that a human reviewed items…"). #3475 recorded the staged-proposals banner the same way (`:46`) |
| `npm test` passes | met: runner stamp `verifiedHead: true` at 59f1e622; PR CI green (shards 1-4, test); re-run after the review's simplification gave 4862 tests, 0 fail |

Current-State outcome: reached. The diff changes the banner the record names, and the record's other surfaces are left alone as its Gotchas require: `consoleAckAllLine`'s wording, and its `hooks.js` `check-session-residue` consumer. Non-Goals: none violated. Risk markers: none in the record. PR-body deliverables: none.

### Verification (from /test)
- Type check: n/a (no type checker configured)
- Lint: n/a
- Tests: pass. Stamp `verifiedHead: true` (scoped, fullSha 88cdbe82f) at 59f1e622. PR #6210 checks all green. After the Step 5 edit, `npm test` impact-selected 127 of 1431 files and got 4862 tests, 4850 pass, 0 fail, 12 skipped.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
No findings — code is clean. The low tier ran single-read lenses 3b (Security) and 3c (Error handling); both returned "No findings.", `STATUS: DONE`.

### Fan-out leftovers
None. No new untracked files, no new listeners, and `agent-scratch/` is empty.

### Implementation Hindsight
No changes needed — approach is sound. The record's decision holds: `--ack` asserts that a human reviewed the items, so a carve-out letting the model run it would defeat the banner's purpose. The change follows the per-banner clause, test pin and `docs/hooks.md` bullet pattern #3475 set for the staged-proposals banner.

### Tradeoffs Accepted
No tradeoffs — all findings were addressed or trivial.

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: "no frontend surface (surface: infra) and no UI trigger file in the diff"
- Journeys whose `files:` overlap the diff (from the gate): block-on-a-child-agent-ci-or-process-5602, call-a-plugin-bin-cli-in-process-from-a-test-5374, close-a-below-floor-decomposition-parent-4466, finish-a-multispec-run-after-the-parent-session-ended, get-a-disguised-main-checkout-write-denied-4303, keep-a-dispatching-sessions-worktree-through-a-siblings-reconcile-4960, keep-hooks-running-when-node-is-not-on-path-5392, key-a-test-database-on-the-port-lease-1927, merge-a-pipeline-pr-only-after-its-run-finishes-6143, notice-a-stale-superpowers-install-3380, preview-reconcile-and-see-why-an-escalation-failed-4180, residue-ledger-removal-pr, review-what-an-unattended-console-left-open-3370, run-a-github-only-skill-without-a-worktree-2727, run-a-hook-event-in-process-from-a-test-5377, run-integrity-lifecycle, session-start-fast-background-reconcile, write-a-quoted-windows-path-from-a-session-4281. Of these, `review-what-an-unattended-console-left-open-3370` describes this banner. It already has the model relay the banner (step 2) and the human maintainer run `--ack` (step 4), so it agrees with the change.

### Design Quality
Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- `plugin/bin/lib/hooks/session-start.js`: the reworded trailer string now uses double quotes, which drops the `\'` escape in "user's". The text is byte-identical. This matches the file's other apostrophe-carrying strings (`:512`). Verified: 4862 tests, 0 fail.

### Documentation Freshness (3i, informational)
- `docs/hooks.md` covers `plugin/bin/lib/hooks/**` and was updated in this diff.
- `docs/donts.md` and `docs/plugin-structure.md` match the registry's Auto-detect patterns but were not updated. Neither has any text about the banner's trailer, so neither is stale. Nothing to do.

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Simplified | Trailer string switched to double quotes, `\'` escape dropped (text unchanged) — `plugin/bin/lib/hooks/session-start.js` | `cfe57cdc36` (pushed to `drive-record-3788`) |

Footer: Step 6.6 (Security Hardening), 6.65 (Agent Trust Scope) and 6.66 (App Store Readiness) were skipped at their pre-checks: no client/route files, no `.claude/settings.json` or `.claude-tweaks/policy.yml`, and no mobile-app files in the diff. Step 6.7 did not run because no late findings came up. Lens 3g-cov was skipped because there is no `stories/` directory. Standalone review with no run dir, so no ledger writes, no PR verdict comment and no phase-exit.

### Key Learnings
1. The installed plugin build that ran this session's own SessionStart hook (6.178.0) still printed the old "mark the run reviewed with its own command above" trailer. The record's Gotcha that installed builds lag `origin/main` held here too, so check banner wording against the worktree's own `session-start.js`, never against what the session was shown.
2. A banner pin is stronger as an `includes` for the new clause plus a `doesNotMatch` for the retired wording. The negative assertion is what stops a later edit from adding the clause while leaving the contradicting old instruction in place.

### Next Actions
**`/claude-tweaks:wrap-up 3788`** — capture learnings and clean up (recommended)
