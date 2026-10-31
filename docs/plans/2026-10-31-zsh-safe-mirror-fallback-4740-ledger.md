# Open Items — zsh-safe-mirror-fallback-4740

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 3 commits ahead of local main at run start (local main also 2 ahead with [reconcile] archive commits) (reason-not-auto: requires-judgment — whether to sync local main is the main checkout owner's call) | fixed | Post-creation catch-up merged origin/main into the run branch — `0889dd5b1` |
| 2 | review | Low (3a Convention): the mirror fallback's lister accepted any `*-spec.md` name and any `record:` text (`record: 101 # note` → `Fixes #101 # note`), drifting from `pack.js`'s header reader | fixed | Fallback now accepts only `^\d+-spec\.md$` names and a numeric `record:`; pinned by a new non-numeric case — `0897a4d39` |
| 3 | review | Low (3f Test Quality): the CRLF fallback case could not see a leaked `\r` — `runFallback`'s regex parse stripped it | fixed | `runFallback` splits stdout on `\n` like `runBlock`; proven red against the pre-change glob loop (`'101\r'`) — `0897a4d39` |
