# Open Items — Windows: tests pin POSIX-literal absolute fixture paths that the code resolves to D:\…

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review/test-quality | server.test.js:107 pinned the trailing separator, dropping the old tolerance (reproduced by both 3f agents) | fixed | Compared through path.resolve on both sides — d41da1c01 |
| 2 | review/test-quality | json-store.test.js:50 title said distinct tmp paths while the assertion pins equality (tiebreak confirmed, in a file this diff touches) | fixed | Retitled to what it pins, no assertion change — d41da1c01 |
| 3 | review/convention | hooks-context.test.js:932 one-argument path.join without a comment (tiebreak confirmed at info) | accepted | Style only: the win32 dirname equality holds under both spellings, so nothing fails |
| 4 | review/convention | friction-events-cli.test.js:24 MAIN is resolved though the code passes it through verbatim (tiebreak confirmed at info) | accepted | Both sides of the compared value carry MAIN on every platform, so nothing fails, and the comment at lines 21-22 states the choice |
