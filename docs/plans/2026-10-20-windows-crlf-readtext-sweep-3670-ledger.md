# Open Items — Windows CRLF: ten skill-prose tests read governed markdown raw before bare-\n fence extraction (#3670)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | extractAllocateLine / invocationFence helpers sit mid-file rather than with the top-of-file helpers (placement only) | deferred | Final whole-branch review triaged not must-fix: each helper sits directly above its sole consumer, consistent with Task 2's helpers |
| 2 | build | blast-radius-snippet (and four other Task 2 controls) use a pure alias `const extract = extractSnippet;` | deferred | Final whole-branch review triaged not must-fix: harmless template residue; inline all five together if ever changed |
