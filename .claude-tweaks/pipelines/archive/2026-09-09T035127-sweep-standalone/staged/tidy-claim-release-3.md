# Tidy staged item — release stale claim on #1570

**Proposed:** Release the stale issue claim on #1570 (claims/issue-1570.json, run 2026-09-05T143054-record-1570, claimedAt 2026-09-05T14:32:33.403Z; draft PR #1905 has had no commit or comment since) via _shared/issue-claims.md's conditional overwrite with releasePayload reason `swept: stale claim`, then remove bot:in-progress from #1570.

**Why:** blob classifies 'stale' (bin/lib/issues/claims.js classifyClaimBlob) — breaking a lock is never autonomous in /tidy (Step 4.7).

**Invariant:** at approval time re-read claims/issue-1570.json and re-classify; proceed only if still 'stale' (or the issue is closed). If it classifies 'live' (a session resumed), skip. If #1570 is closed, release as `swept: issue closed`.

**Alternative (Yours):** resume the run instead — read the Resume line in https://github.com/thomasholknielsen/claude-tweaks/pull/1905's body, per _shared/pr-early-run-lifecycle.md.
