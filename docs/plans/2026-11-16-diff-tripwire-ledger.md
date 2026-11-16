# Open Items — Diff tripwire

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 4 commits ahead of the branch at resume | fixed | Common Step 1 catch-up merged origin/main (b34ec5264b) into the worktree branch |
| 2 | build | SDD ruling — POINTER_BYTES 560 headroom on Step 2.9 needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — glob-syntax parser/matcher alignment goes to follow-up #5806 (Defer-reason: pre-existing-outside-diff): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — final reviewer declined-to-judge items accepted as designed: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build/skill | gh-api-module-pattern git-seam.md extends: a git fetch run in the shared main checkout should retry once on a sibling session's ref lock (cannot lock ref / Unable to create .lock) through an injectable sleep before reporting failure, as accept-park.js fetchRef now does (#4619) | observation | — |
| 6 | review | failureText puts git stderr (absolute paths, the checkout path) into the public packet line; a plain Error with no stderr reads unknown error | fixed | fixed in 822a13b409: redactPaths on the stderr and message lines, message fallback |
| 7 | review | reportedFlags is a third flag set with no stated reason | fixed | fixed in 822a13b409: comment states why, spec build deviation 6 records the signature and return additions |
| 8 | review | step 1 interpolates the PR baseRefName into a Bash command unvalidated, and reads a different diff than decide | fixed | fixed in 822a13b409: {base} is the branch decide diffs against, name validated before use |
| 9 | review | no test pins that plugin/bin/lib/accept imports no flag writer | fixed | fixed in 822a13b409: writerImports scan with planted cases |
| 10 | review | the risk-categories string-or-list parse is copied from readRiskPolicy | fixed | fixed in 822a13b409: extraCategoriesOf in policy.js is the one copy |
| 11 | review | the control-mode wiring comment credits only readRiskPolicy and lists #4619 as unwired | fixed | fixed in 822a13b409: comment names decide as the second reader |
| 12 | review | the driver decide call keeps the flat 120 s bound although it runs up to nine git calls | fixed | fixed in 822a13b409: decideTimeoutMs follows the live git bound |
| 13 | review | docs/driver.md does not say driver-merged runs get the glob signal only | fixed | fixed in 822a13b409: one sentence added |
| 14 | review | the tidy sweep path writes no packet facts so its held report never carries the tripwire reason | fixed | fixed in 822a13b409: tidy's held report carries decision.tripwire.lines |
| 15 | review | the target-substring test never reads the park state its name claims | fixed | fixed in 822a13b409: park and target assertions added |
| 16 | review | the spec signature and return shape predate diffError, tripwireFlags, categories, reportedFlags, notes, removedThenCrossed | fixed | fixed in 822a13b409: spec build deviation 6 |
| 17 | review | a flag writer throw reads unknown error in the packet line | fixed | fixed in 822a13b409: failureText falls back to the redacted message (same change as the :316 row) |
| 18 | review | sleep one-liner copies Atomics.wait (plugin/bin/accept-park.js:215) | accepted | accepted: the one-liner is already a private copy in five other modules; consolidating is a repo-wide refactor, not this diff |
| 19 | review | normalizeRepoPath shares a name with plan-audit/parser.js (plugin/bin/lib/accept/tripwire.js:29) | accepted | accepted: no caller imports the wrong copy; separate domains |
| 20 | review | absent packet-facts file reads as no tripwire lines (plugin/bin/accept-park.js:690) | accepted | accepted: reaching park without the facts file needs decide run without --run, and an older in-flight decide wrote none; the lines still print in decide JSON |
| 21 | review | monotonicity scan matches names only (tests/accept-monotonic-conformance.test.js:104) | accepted | accepted: a documented recall limit, and risk-flags-writer-conformance scans the whole bin tree for any Risk-flags write |
| 22 | review | three-valued globs mapping has no comment (plugin/bin/accept-park.js:497) | accepted | accepted: readGlobs documents it, the policyDefault block above states the same rule, and AC7.1 and AC7.2 test both branches |
| 23 | review | inertEvidence leaves @name and bare URLs live in tripwire packet lines (plugin/bin/lib/issues/risk-flag-classify.js:75) | deferred | staged/review-followup-1.md (Defer-reason: blocked-external, the encoding waits on a GitHub probe comment) |
| 24 | review/hindsight | accept-park.js grew from about 665 to 933 lines: the tripwire git seam (readBranchDiff, fetchRef, appendTripwireFlags) lives in the CLI, not lib/accept | accepted | accepted: lib/accept is pure and scanned for flag writers by accept-monotonic-conformance, so the I/O stays in the CLI by design; extracting the seam into a bin/lib module is a /claude-tweaks:deepen candidate, not a defect |
