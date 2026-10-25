# Open Items — hooks: resolve 3 accumulated below-floor digest findings (#3900)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `runGitAsync` ignores `opts.env` (only `runGit` forwards it to the spawn) — pre-existing, `plugin/bin/lib/hooks/git-exec.js`; surfaced by Task 3's implementer and the whole-branch review | fixed | Fixed in `6e2f6fb99`: runGitAsync forwards opts.env; the new test goes red without the line |
| 2 | build | `plugin/skills/_shared/pr-first-merge-post-merge.md:149` says the worktree-always gate denies `git push origin --delete {branch}` in the main checkout — untrue since #658 (and the `-C` form since #3900); the instruction stands, only its stated reason is stale | fixed | Fixed in `2da930bdd`: the stated reason now matches the gate (exempt since #658, `git -C` since #3900) |
| 3 | build | The `-C` deny behavior tests (content push, compound) in `tests/hooks-policy-exemption.test.js` pass on pre-fix code too — characterization pins; the regex table test and the `-C` allow test carry the go-red | observation | Accepted by task review and whole-branch review; revert-red verified on the table + allow tests |
| 4 | build | `isContentIdentical` in `plugin/bin/lib/hooks/worktree-reap.js` keeps `stdout.trim() === ''`, now redundant on `raw: true` output — harmless, left for surgical scope | observation | Whole-branch review: harmless |
| 5 | build | `findUnrawRunGitZ` in `tests/git-path-read-conformance.test.js` is line-based: an argv array built from a variable or split across lines is invisible to it (no such `-z` caller exists today; the contract's "Not covered yet" section already names the multi-line limit) | observation | Re-review grepped the variable-argv callers; none pass `-z` |
| 6 | wrap-up | pr — PR #4334 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 7 | wrap-up | residue suite probe did not run (skipped via --no-suite) — suite state comes from the runner stamp (full pass at fa394fbd2, 0 failures) | observation | — |
