### Reflection Insights

Run: 2026-10-21T220136-record-3810 (#3810). Mode: full, auto, `--source wrap-up` (staged, not applied).

| # | Insight | Causal | Recommended Destination |
|---|---------|--------|------------------------|
| 1 | Friction: the canonical `verify.js` invocation (`--cmd-env ... CT_HOOKS_GIT_TIMEOUT_MS`, `--baseline origin/main`) was refused by the worktree-isolation guard in this dispatched session and had to be run through a scratchpad script (events.jsonl `wd-guard-refusal` 22:46:54Z; cost: one refused call plus a 12-line wrapper). Harness behavior, already catalogued in the user's memory. | — | Don't capture — harness-owned behavior already catalogued in memory; no plugin change available |
| 2 | Near-miss: the table Status cell `vs {baseRef}` was unasserted wherever baseRef equals the merge-base sha (all pre-existing fixtures are linear), so reverting it stayed green until review lens 3f flagged it. Fixed in `4ee1a47c9` with a forked-branch assertion; reverting verify.js:976 turns it red. Terminal: one fixture gap, no shared helper to change. | terminal | No action — fixed in review |
| 3 | Surprise/Approach: nothing beyond what the build and review already encoded (git merge-base exits 1 only for no common ancestor, so other statuses rethrow into the adjudication-error path; a depth-limited clone test needs a `file://` URL). Both are pinned by comments and tests. | — | No action — already documented in code and tests |

Lenses with no finding: Fresh start (verify.js resolving the ref is the single resolution site; verification.md changed to describe it, not to prescribe a different flag), Tradeoff review (review accepted no tradeoffs; the `base`/`baseRef` split is already the staged SDD ruling).
