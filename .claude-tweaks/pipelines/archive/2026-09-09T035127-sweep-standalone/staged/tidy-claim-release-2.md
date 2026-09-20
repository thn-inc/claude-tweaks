# Tidy staged item — release stale claim on #1537

**Proposed:** Release the stale issue claim on #1537 (claims/issue-1537.json, run 2026-09-05T132902-record-1537, claimedAt 2026-09-05T13:30:53.652Z; draft PR #1902 has had no commit or comment since) via _shared/issue-claims.md's conditional overwrite with releasePayload reason `swept: stale claim`, then remove bot:in-progress from #1537.

**Why:** blob classifies 'stale' (bin/lib/issues/claims.js classifyClaimBlob) — breaking a lock is never autonomous in /tidy (Step 4.7).

**Invariant:** at approval time re-read claims/issue-1537.json and re-classify; proceed only if still 'stale' (or the issue is closed). If it classifies 'live' (a session resumed), skip. If #1537 is closed, release as `swept: issue closed`.

**Alternative (Yours):** resume the run instead — read the Resume line in https://github.com/thomasholknielsen/claude-tweaks/pull/1902's body, per _shared/pr-early-run-lifecycle.md.
