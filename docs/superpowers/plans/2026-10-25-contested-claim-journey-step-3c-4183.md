# Update act-on-a-contested-claim.md step 3c for #2329 read-back retry and release-on-abort (#4183) Implementation Plan

**Goal:** Bring step 3c of `docs/journeys/act-on-a-contested-claim.md` in line with `claim-targets.js`'s post-#2329 behavior — the bounded contents-API read-back retry and the abort-path release of the unverified target's own write — and re-anchor the journey's Origin (changelog) entry against the current file.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T115142-record-4183/work/4183-spec.md` (materialized from GitHub issue #4183)

---

### Task 1: Rewrite step 3c's Should-understand and Red-flags lines and add the #2329 Origin entry

**Files:**
- Modify: `docs/journeys/act-on-a-contested-claim.md`

- [ ] **Step 1: Failing test** — scratch check (not committed; the repo keeps no tests for journey prose): `grep -c "never releases the target itself" docs/journeys/act-on-a-contested-claim.md` prints `1` today, and step 3c's Red-flags line still contains "releasing the unverified target on its own". Expected: FAIL (stale text present).
- [ ] **Step 2: Implement** —
  - Rewrite step 3c's **Should understand** line: the read-back is retried a bounded number of times with backoff on the contents-API path only (the git-CAS path reads at the exact commit it pushed and is not retried); the card renders only after that window expires; on the default all-or-abort path the run also attempts to release this target's own write (tombstoned if a fresh read confirms it landed, named in `releaseFailed` otherwise), so a landed-but-unconfirmed claim never silently rides out its TTL; under `--keep-going` the per-target skip does not attempt that release. Keep the `Next:` clause.
  - Rewrite step 3c's **Red flags** line: drop "the run silently reclaiming or releasing the unverified target on its own"; flag instead the abort path leaving this target's write neither released nor named in `releaseFailed`. Keep the `holder`-line and no-escalation-path flags.
  - Under `## Origin`, append an "Extended during build of #4183 …" entry after the #3131 entry (re-anchored against the current file — the #2329 staged diff's hunk predates the #3131 entry), and add `#2329` to the Related specs line.
  - Verified against `plugin/bin/lib/claim-targets/claim-targets.js` (`VERIFY_MAX_ATTEMPTS`, `verifyClaimLandedWithRetry`, `stopOrSkip(..., releaseThisIssue)`, `abort()`) and `plugin/skills/_shared/issue-claims.md`'s "Post-write verification" paragraph.
- [ ] **Step 3: Run** the Step 1 scratch check — PASS (`0` matches for both stale phrases), and the journey still has its frontmatter `files:` block, the `## Steps` heading, and every step's Action/Should-feel/Should-understand/Red-flags shape (`_shared/journey-self-review.md`'s structural check).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4183`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (step 3c Should-understand + Red-flags) and Deliverable 2 (re-anchored Origin/changelog entry) are covered by Task 1 Step 2; both Acceptance Criteria (no "never released" / no release-on-abort red flag; journey passes the structural check) are covered by Task 1 Step 3.
- **Placeholders:** none.
