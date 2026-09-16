# Open Items — escalate-residue.js shared control-flow refactor (#2504)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | `escalateResidue` (escalate-residue.js:246-248) now calls `residueBody(...)` — which can throw `RangeError` from `new Date(firstFailedAt).toISOString()` on a malformed `firstFailedAt` — before `findOrCreateIssue`'s internal `!repo` guard runs. Pre-refactor, the `!repo` check ran first and short-circuited before `residueBody` was ever called, so this violates the function's own documented "Never throws" contract for the no-repo + malformed-timestamp combination. | fixed | Restored the `if (!repo) return { status: 'escalation-failed', reason: 'no-repo-slug' };` guard before the `residueBody(...)` call, matching pre-refactor order. 19/19 targeted + 9139/9139 full suite green. |
