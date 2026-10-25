# Open Items — Bound the total size of the /review shared context bundle (#4220)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | budget loop stubs a piece whose stub is larger than the piece once the budget is unreachable (build.js candidate list) — cosmetic growth below the unbudgeted size | deferred | — |
| 2 | build | unparseable-header chunks (file === null) are never budget candidates; buildContext's comment names only the headers-and-stubs floor | deferred | — |
| 3 | build | no tests for budget-elided deleted file, --files-from out-of-scope elision, below-floor budget, budget-elided markdown chunk | deferred | — |
| 4 | build | Real-input probe: a 1,479-file range (HEAD~150) stays over the 256 KB budget at 912,136 B because headers and stubs alone exceed it; a 323-file range fits (3,989,582 B → 261,804 B) | observation | Floor documented in buildContext's comment; #4028-sized reviews (129 files) fit |
