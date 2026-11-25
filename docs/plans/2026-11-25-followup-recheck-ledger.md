# Open Items — 6284: Re-check open follow-ups whose Key Files a run changed and stage a close or narrowing proposal

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | approve and console-resolve.js write console.json outside the execute lock | deferred | Defer-reason: tangential — approve precedes the merge and execute follows it, so the two writers never overlap in practice; only execute (the irreversible writer) takes .console.lock |
| 2 | build | a re-check proposal re-staged after approval holds proposal-changed but its residue line shows execute, not a re-approve hint | deferred | Defer-reason: tangential — fails safe (held, never executed); the stagedHash binding is the guard |
| 3 | build | SDD ruling — rename hunks registered under both diff paths: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — trivially short judge quotes accepted: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — residual Important after fix wave fixed by one targeted dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — paste-ready command fixed in a second targeted dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — Run-head from a wrong checkout accepted as merge proof: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
