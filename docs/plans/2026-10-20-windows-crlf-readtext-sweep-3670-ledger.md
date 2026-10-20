# Open Items — Windows CRLF: ten skill-prose tests read governed markdown raw before bare-\n fence extraction (#3670)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | extractAllocateLine / invocationFence helpers sit mid-file rather than with the top-of-file helpers (placement only) | accepted | Final whole-branch review triaged not must-fix: each helper sits directly above its sole consumer test, the same placement Task 2's dispatcherScript/oversightSnippet use; moving them is cosmetic and below the materiality floor |
| 2 | build | blast-radius-snippet (and four other Task 2 controls) use a pure alias `const extract = extractSnippet;` | fixed | cb946c3b0 — Common Step 3 simplify inlined all five aliases together |
| 3 | build/skill | windows-checkout-test-parity extends: an extract-and-run suite's third Windows layer can be its own expected-path pin — a `/`-literal regex over a native `path.join` result (sessionTmpPath) fails on win32; accept `[\\/]` rather than toPosix the fs path — and `execSync`'s default win32 shell is cmd.exe, so a bash snippet run through it needs `shell: 'bash'` (blast-radius-snippet) | observation | — |
