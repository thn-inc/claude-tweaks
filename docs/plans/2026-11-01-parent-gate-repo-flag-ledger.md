# Open Items — 4824: Pass --repo on the parent gate prose's gh issue comment and close writes

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check (run 2026-11-03T082955-record-4824): origin/main was 18 commits ahead of the branch at flow start | fixed | Caught up by the Post-creation catch-up merge c082a8aa8 before any build task |
| 2 | build | SDD ruling — stop-rule test asserts presence, placement and order with separate messages: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — parent gate stop rule scoped to the gh path, null cases moved ahead of it: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 2 test minors fixed in the loop, not deferred: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — inventory inferred cross-spec-promise reason labeled an inference in Task 4: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | gate file Apply inline read (`gh issue view $PARENT_NUM --repo "{parent-repo}" --json comments`) is about 125 characters, wider than the paragraph's usual wrap | observation | Plan-mandated: the span must stay on one line for the brokenSpanLines guard in below-floor-parent-close-conformance; the whole-branch review agreed |
| 7 | build | Follow-up #5048 filed for the inventory's 19 needs-fix writes, the queue-pull-script.md:608 staged close, claim-targets.js bare writes and the label-bootstrap residual | observation | Filed per the spec clarification that needs-fix writes go to one named follow-up; Defer-reason: genuinely-larger |
