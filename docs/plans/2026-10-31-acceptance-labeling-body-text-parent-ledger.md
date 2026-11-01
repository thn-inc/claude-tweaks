# Open Items — wrap-up engine-verify: acceptance-labeling body-text parent resolution (#4551)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the worktree branch at Step 2.5 | fixed | Post-creation catch-up merged origin/main — `0ccb01419` |
| 2 | flow/ops | Pre-flight branch-divergence-check (run 2026-10-31T171043): origin/main was 13 commits ahead of the worktree branch at Step 2.5 | fixed | Post-creation catch-up merged origin/main — `165ccce98` |
| 3 | build | SDD ruling — a Parent: line naming an issue with no task list stays unknown, not standalone: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — body-text dedupe upgrades an already-seen standalone target to a gated parent: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — native path keeps its pre-existing order-dependent parent flag: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — labeler applies Reading B only to a non-empty task list: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — defer a Reading B reason field on the parent-gate CLI verdict: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 8 | review | engine-verify.js:697 — body-text resolveParent accepted any JSON, so a reply without a string body read as a parentless record (false fail instead of unknown) | fixed | Malformed body reply is a gather failure (explicit null body stays parentless); test pins it — `882a771ab` |
| 9 | review | engine-verify.js:776 — body-text enumeration coerced a non-array labels reply to [] (journey contract says unknown) | fixed | Only an absent labels key is []; any other non-array is a parse failure; test updated — `882a771ab` |
| 10 | review | engine-verify.js:769 — parent-body fetch failure in enumerateBodyTextSubIssues had no isolating test (mutant stayed green) | fixed | AC5.2 test with a parent-only body throw; goes red when the catch is removed — `882a771ab` |
| 11 | review | parent-gate.js:194 / mcp-parent-gate-shape.js:181 — Reading B omission predicate copied across the two labeler transports | fixed | Shared `listOmitsSubIssue` exported from parent-gate.js and used by both — `882a771ab` |
| 12 | review | engine-verify.js:937 — task-list-wins comment gave no reason and no pointers to its twins | fixed | Comment states the reason, the labeler twins, the prose, and the deliberate empty-list difference — `882a771ab` |
| 13 | review | engine-verify.test.js — 12 acceptance-labeling fixtures faked native GraphQL but inherited the cwd policy.yml | fixed | `makeNativeRepoRoot()` pins `work-links: native` per fixture — `882a771ab` |
| 14 | review | engine-verify.js:813 — resolveWorkLinks falls back to body-text on an unreadable or invalid policy | accepted | Spec Deliverable 2 and AC7 mandate the schema default (resolveRiskFloor parity); the failure is a loud false fail, never a silent pass; tiebreak low/drop |
| 15 | review | engine-verify.js:933 — engine ignores the labeler prose's `--work-links` override | accepted | No skill passes the flag to the parent-gate CLI and the prose line predates this diff; tiebreak low/drop |
| 16 | review | engine-verify.test.js — exact parent body-read count pinned (refactor-coupled) | accepted | The count is the once-per-parent property the spec requires; fails loudly with its reason; tiebreak low/drop |
| 17 | review | superseded run-dir spec copies committed; "Reading B" label in comments | accepted | `.gitignore` tracks `work/**` repo-wide; comments state the rule in plain words; tiebreak info/refuted |
