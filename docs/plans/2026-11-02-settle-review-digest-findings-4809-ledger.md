# Open Items — Settle 7 digest findings in review (#4809)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — both task-1 review Minors are accurate-as-written observations, not defects (reviewer: name is "cosmetic" and brief-mandated; the skip comment is "still accurate"): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — both plan-mandated task-2 review Minors are fixed now, not deferred (fix-now: cheap, in scope): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — task-3 review Minor 1 (code-mode-steps.md:74 prose still says proceed unless red) is fixed now; Minors 2 and 3 are not defects: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — the task-3 re-review Minor (line-74 prose does not restate row 3 caveat/AUTO duty) is a non-defect: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — both task-4 review Minors fixed now (fix-now: cheap, in scope): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | the listRunDirsFailClosed \|\| start fallback (cwd undefined outside any repo) survives a mutant | observation | Parked by SDD: below Minor per the re-reviewer; no production caller reaches it (callers always pass ctx.mainRoot or a cwd) |
| 7 | build/skill | gh-api-module-pattern's cli-wrapper-contract.md gained this build's rule (a fail-closed branch around an injected dependency needs a test of the real dependency's failure shape, citing dispatch-resume's run-dir listing) — an in-build enrichment for wrap-up's Skills curation to confirm | observation | Applied in d666f825b/4eeaf0fe5 |
| 8 | review/error | dispatch-resume.js:33 header lists two fail-open reads but a corrupt run-state.json is a third (boundRunConflict skips it) | fixed | Header now names the third exception (cf9d622c9) |
| 9 | review/test | review-step1-5-verifiedhead-gate.test.js:57 test name claims to match pr-check-gate.md without reading it | fixed | Renamed; the shared red bullet is pinned by merge-verification-gate-conformance (cf9d622c9) |
| 10 | review/test | brokenSpanLines line-ending gh regex misses trailing whitespace | fixed | Regex widened to `\s*$`, self-test case added; mutant went red (cf9d622c9) |
| 11 | review/test | dispatch-resume-cli.test.js:148/1422 the listing stub and the new closures drop the cwd the call sites pass | fixed | Both new tests record the root and assert it is MAIN; mutant went red (cf9d622c9) |
| 12 | review/test | dispatch-resume-cli.test.js:1410 assert.throws without an error matcher | fixed | Matches `{ code: 'ENOTDIR' }` (cf9d622c9) |
| 13 | review/convention | dispatch-resume.js:119 re-derives the pipelines-dir anchor context.js already builds (third copy) | accepted | Below the materiality floor; digested (Defer-reason genuinely-larger): https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6568865115 |
| 14 | review/error | hooks/context.js:254 the shared listing still reads any readdir failure as no runs for its other callers | accepted | Below the materiality floor; digested (Defer-reason pre-existing-outside-diff): https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6568865115 |
| 15 | review/test | dispatch-resume.js:522 verdict-mode sibling check with the real listing has no test | accepted | Verdict mode still exits 4 at the later boundRunConflict scan on the same listing; the --bound-run test covers the sibling path |
| 16 | review/test | artifact-overwrite-check.test.js:387 the t.skip has no pin | accepted | The branch only runs on shallow clones; every CI workflow checks out full history |
| 17 | review/convention | cli-wrapper-contract.md:4 the new rule is not mechanically enforced (info) | accepted | An advisory rule no script can check; sibling bullets are unenforced prose too |
