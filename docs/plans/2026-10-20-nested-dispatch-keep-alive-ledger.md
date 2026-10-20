# Open Items — #3078: review/step3-lens-dispatch: medium+ lens dispatch has no rule for a reviewer running as a dispatched subagent

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/review | Follow-up: `review/step3-lens-dispatch.md:94`'s partner-died treatment is pair-shaped ("retry that one agent once", "surviving partner", a session-limit-only log line); since #3078 routes unavailable / timed-out lens agents there too, widen its trigger and add a log line for those causes | open | |
| 2 | build/review | Follow-up: `review/step3-lens-dispatch.md:52`'s hung single-read rule (2-3 min wait, then a `SendMessage` nudge) sits beside the core keep-alive bound with a second, shorter bound, and a nested agent may have no `SendMessage` — reconcile with `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline | open | |
| 3 | build/review | Follow-up: `plugin/bin/lib/hooks/subagent-stop.js:182-184` code comment still says a nested dispatcher "must yield control across several of its own turns" — stale after #3078 (the file was frozen by #3078's spec, so not edited there) | open | |
