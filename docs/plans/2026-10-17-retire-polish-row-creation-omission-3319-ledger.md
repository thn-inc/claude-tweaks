# Open Items — PR-early polish-row omission for all-backend runs: retire the creation rule (#3319)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Step 2.5 pre-flight branch-divergence-check: origin/main was 3 commits ahead of local main at run start | observation | Post-creation catch-up merged origin/main into the worktree branch before any work; no divergence remains on this branch |
| 2 | build | SDD Task 1 minor (deferred): test comment cited #3028/#2877 as surface: backend without verification | fixed | Final review confirmed it false (#3028 is infra, #2877 has no Surface:); comment and record numbers neutralized in 88ff9a9c9 |
| 3 | build | SDD Task 2 minor (deferred): steps-and-gates.md:197 and pr-early-run-lifecycle.md:298-307 both enumerate the non-frontend examples and the would-be-exit/pre-merge split | deferred | Final review: accept — AC4 requires steps-and-gates.md to state the split itself; it cites the lifecycle file for the composition rule. Below the materiality floor, so no work record staged |
| 4 | build | Branch carries ride-along reconcile commit 7ce867152 (archive renames of 2026-10-16T172750-spec-2775-2733-2677) from the unpushed local main it was cut from | observation | Benign archival move; final review found no conflict risk with origin/main. Lands with this PR |
| 5 | build | Pre-existing red on origin/main: multi-spec.md read-budget pins (run-dir-timestamp-utc.test.js ×2, timing-prose-conformance.test.js) — file 20,903 B > 20,480 B limit | observation | Fails at merge-base too; this branch shrinks the file to ~20,888 B. Not this record's fix — check Common Step 5 baseline adjudication |
