# Open Items — #3823 Trusted-author jq in skill prose keys on authorAssociation only and fails closed on MCP transport

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | comment-trust.js header paragraph rewrap leaves one long line (cosmetic) | deferred | SDD Task 1 minor; whole-branch review triaged "leave — cosmetic, no gate" |
| 2 | build | trustedJqPredicate map/join line ~125 chars (no line-length gate) | deferred | SDD Task 1 minor; whole-branch review triaged "leave — no line-length gate" |
| 3 | build | pre-existing untrustedSkipNote JS `\|\|` vs jq `//` divergence on empty-string url/login (out of scope; not a GitHub output) | deferred | SDD Task 1 minor; whole-branch review triaged "leave — only changes which ref/login a skip note prints, never trust" |
| 4 | build | sweepJqTrustCopies count depends on note-before-select deletion order (correct, commented, pinned by 6/5 totals) | deferred | SDD Task 2 minor; whole-branch review triaged "leave — correct, commented, pinned" |
