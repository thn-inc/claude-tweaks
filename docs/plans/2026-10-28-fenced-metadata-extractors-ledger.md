# Open Items — 4368: Read a record's Premise-check, Verified-as-of and Template lines only outside fenced blocks

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | a stray 1-3-space-indented ``` line in an existing record body now opens a fence that, unclosed, hides every later heading/metadata line to EOF | observation | SDD parked (Task 2): intended conservative over-approximation of CommonMark (an unclosed fence runs to end of body, not end of containing block); hiding more means nothing runs and the shape gate refuses; whole-branch review corpus scan found 0 affected of 2,810 issue + 1,690 PR bodies |
| 2 | build | SDD ruling — unfencedText runs once per extractor call (3x per materialize), code stands: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — unclosed (indented) fence hides the rest of the body, kept as a conservative over-approximation of CommonMark: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — residual NBSP-literal test fixture fixed via one targeted dispatch (ee0193470): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
