# Open Items — resolve-run-dir mis-resolves a stale, never-closed standalone run directory as current (#2870)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | run-dir-resolve.js newestMatch header (lines 74-77) and file header (14-16) still say the module mirrors the find\|sort\|tail reference snippet; add one sentence noting the canonical-name filter divergence | fixed | Common Step 3: newestMatch header now names the RUN_ID_RE filter as a deliberate divergence from the snippet (#2870) |
| 2 | build | RUN_ID_RE rationale comment duplicated in run-dir-resolve.js:55-59 and context.js:24-27; shorten context.js copy to a pointer | fixed | Common Step 3 (code-simplifier): context.js comment replaced with a pointer to run-dir-resolve.js |
| 3 | ops | Two other non-canonical top-level run dirs remain under the main checkout's .claude-tweaks/pipelines/: 20260817T165609-record-763-standalone (status clean, also has an archive/ copy) and 20260911T215029-specify-standalone (no run-state.json, last written 2026-09-12). Now never adopted (newestMatch filter) but still reported by reconcile's findNonCanonicalRunDirs; dispose (mv to archive/) or leave (reason-not-auto: shared main-checkout state outside the record's named scope) | open | — |
