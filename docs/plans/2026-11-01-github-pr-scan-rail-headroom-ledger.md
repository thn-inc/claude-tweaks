# Open Items — Restore Read-rail headroom in _shared/github-pr-scan.md by splitting item 10's resume procedure

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — keep the "step 1's output" reword in the moved resume procedure: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — keep byte-saving shortenings in tidy Step 4.8's paragraph: ratify or reverse at the Review Console (staged/sdd-ruling-2.md); review restored the "named" phrase in 4f9a133eb, so only the other two shortenings remain to rule on | open | — |
| 3 | review/convention | Step 4.8 compose-fallback sentence lost "named", breaking the verbatim-sentence rule (plugin/skills/tidy/scan-procedures.md:294) | fixed | Restored in 4f9a133eb (+6 bytes, file 52,413 B under the 52,500 rail). |
| 4 | review/docs | Stale item 10 caller pointers and a missing consumer-roster entry (plugin/bin/pr-resume-line.js:4, docs/plugin-structure.md, plugin/skills/_shared/session-tmp-root.md:137) | fixed | Repointed / added in 4f9a133eb. |
| 5 | review/test-quality | Item 10 pins read a slice running through item 11, covered only two moved literals, no pin on the print line the resume file cites, and a stale test title (tests/sweep-backstop.test.js:275) | fixed | ITEM10_OWN slice, four literals, print-line pin and renamed title in 4f9a133eb. |
