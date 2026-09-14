# Staged: needs:decision — #2216 (operational alert, not a backlog spec)

**Finding:** #2216 is a dispatch headless self-report (`by:dispatch`), not a work record describing something to build. It reports that a Task-call dispatch of #1301's build/test hit `flow/claim-targets.md`'s Step 2.8 in-flight check: the claim tombstone for #1301 names a `pr-opened:` release with PR #2088 still open (confirmed live: OPEN, MERGEABLE, mergeStateStatus CLEAN, not draft). No claim was taken, no build/test ran — the dispatch correctly declined to duplicate work already in flight. The record explicitly recommends a human action ("merge PR #2088... or run `/claude-tweaks:tidy`"), not a code change.

**Proposed:** Route via `needs:decision` for a human to act on directly (merge PR #2088, closing #1301) rather than shaping it into a build spec — there is no code deliverable here, only an operational decision. The record also names a recurring systemic pattern (dispatch's queue-pull not excluding a record whose most recent tombstone names a still-open PR without `auto:merge`) already flagged by #1740/#1805/#1866 in this same drain — no new record needed for that; those already cover it.

**Why staged:** a `needs:decision` label change plus a comment is a low-stakes routing action, but the record stays open (not closed) since it isn't a duplicate to absorb — it's the current, live instance of an ongoing situation a human should see.

**Command:** merge PR #2088 (`gh pr merge 2088 --repo thomasholknielsen/claude-tweaks`), or run `/claude-tweaks:tidy` first if it needs further changes.
