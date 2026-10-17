# Open Items — #2916 self-assessment watermark offset

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: watermark.js new header paragraph wraps ~100 cols vs surrounding ~75 | accepted | Final whole-branch review triaged as cosmetic, non-blocking (plugin/bin/lib/transcript-judge/watermark.js header) |
| 2 | build | SDD Task 2 minor: item-5 assertions in second AC3.1 prose test not shown red individually | accepted | Final whole-branch reviewer reverted the source spans in a scratch worktree and saw all new tests go red; item-5 checks are plain substring pins |
| 3 | build | SDD Task 2 minor: Skip-check pointer used informal 'Readers ignore…' ellipsis | fixed | dd22af04c — pointer now cites the Degradation section's Self-assessment watermark exception in full |
| 4 | build | SDD Task 2 minor: transcript-judge.md Watermark-write payload mode comment did not cite the exception | fixed | dd22af04c — plugin/skills/_shared/transcript-judge.md payload comment cites the exception |
| 5 | build | SDD final fix wave minor: plugin/skills/feedback/session-evaluation.md:63 'When false (grown, or no watermark exists)' omits the self-assessment-watermark cause that the shared contract now lists | open | — |
