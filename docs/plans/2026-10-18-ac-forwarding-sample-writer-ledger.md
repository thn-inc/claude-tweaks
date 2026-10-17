# Open Items — Give build's AC-forwarding sample a sanctioned writer reachable from a worktree session (#3044)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Ruling: AC-forwarding sample for this run persisted via a plain Bash `cp` into the run dir — the installed 6.144.0 dispatch.md still names the raw write this worktree session's harness refuses (the defect #3044 fixes) | observation | Diagnostic-only; the sample was read back and verified at Common Step 2 |
| 2 | build | Task 1 minor: run-artifact/write.js missing-runDir throw not pinned by a module test | accepted | Covered by tests/bin-lib/run-artifact/cli.test.js "a missing run dir exits 3" |
| 3 | build | Task 1 minor: write.test.js mkdtemp dirs not cleaned up | fixed | Commit 4cfe9a0fa (t.after cleanup) |
| 4 | build | Task 1 minor: write.js header cites cli-wrapper-contract without its .claude/skills path | accepted | Cosmetic comment; the contract is findable by name under .claude/skills/gh-api-module-pattern/ |
| 5 | build | Task 2 minor: write-run-artifact.js exit-3-on-write/delete-throw path untested | fixed | Commit 4cfe9a0fa (directory-at-target CLI test, discrimination proven) |
| 6 | build | Task 2 minor: cli-wrapper-contract.md "A fifth writer" ambiguous | fixed | Commit 4cfe9a0fa ("A further writer" in both files) |
| 7 | build | Task 2 minor / final Ruling: parseArgs next() consumes a following flag as a value (`--run --delete` exits 3 not 2) | accepted | Ruled: parity with the four sibling writers; malformed corner case still exits non-zero |
| 8 | build | Task 3 Ruling: eval'd $SDD_SAMPLE does not survive into the persist Bash call — replaced with literal {sample-path} placeholder and inline {run-id} definition | observation | Applied in commit dac1c819b; re-review ADDRESSED |
| 9 | build | #3386 sdd-final-review.md sentence in dispatch.md still directs a direct run-dir write (same worktree-refusal hazard) | deferred | Filed #3496 (Defer-reason: pre-existing-outside-diff) |
