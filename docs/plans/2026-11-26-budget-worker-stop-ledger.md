# Open Items — End a drive.js --budget run when workers cannot launch (#6118)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the branch | fixed | Caught up by the post-creation merge of origin/main (088332efb5) |
| 2 | build | the both-null api_error rule may also classify an unprobed connection-level failure as shared-cause; settling it needs a live network-outage probe | deferred | Defer-reason: blocked-external — needs a live network-outage probe; final review triaged it acceptable (a network outage is itself a cause every record would meet, bounded by the repeat cap) |
| 3 | build | SDD ruling — non-counting shared-cause launch on an open streak takes the two-record worker-stop path: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the spec's standing Decision: no record leaves the driver lane because of a cause every record would meet |
| 4 | build | SDD ruling — fail/exit counts toward two-in-a-row even for workers that ran (narrowing deferred, needs-human-decision): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build/skill | driver-step-addition enrichment: defineStep rebuilds a step result from a fixed key set, so a new step-result field run.js must read (here launchFailure) needs an explicit defineStep passthrough — the skill's site list does not name it, and #6118 Task 3 found the flag silently dropped | observation | Skill observation for wrap-up's Skills curation row |
