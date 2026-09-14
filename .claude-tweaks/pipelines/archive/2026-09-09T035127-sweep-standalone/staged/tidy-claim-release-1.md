# Tidy staged item — release stale claim on #1135

**Proposed:** Release the stale issue claim on #1135 (claims/issue-1135.json, run 2026-09-05T101737-record-1135, claimedAt 2026-09-05T10:19:02.959Z; draft PR #1895 has had no commit or comment since) via _shared/issue-claims.md's conditional overwrite with releasePayload reason `swept: stale claim`, then remove bot:in-progress from #1135.

**Why:** blob classifies 'stale' (bin/lib/issues/claims.js classifyClaimBlob) — breaking a lock is never autonomous in /tidy (Step 4.7).

**Invariant:** at approval time re-read claims/issue-1135.json and re-classify; proceed only if still 'stale' (or the issue is closed). If it classifies 'live' (a session resumed), skip. If #1135 is closed, release as `swept: issue closed`.

**Alternative (Yours):** resume the run instead — read the Resume line in https://github.com/thomasholknielsen/claude-tweaks/pull/1895's body, per _shared/pr-early-run-lifecycle.md.
