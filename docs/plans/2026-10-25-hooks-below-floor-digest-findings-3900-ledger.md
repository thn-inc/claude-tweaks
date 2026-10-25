# Open Items — hooks: resolve 3 accumulated below-floor digest findings (#3900)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `runGitAsync` ignores `opts.env` (only `runGit` forwards it to the spawn) — pre-existing, `plugin/bin/lib/hooks/git-exec.js`; surfaced by Task 3's implementer and the whole-branch review | open | — |
| 2 | build | `plugin/skills/_shared/pr-first-merge-post-merge.md:149` says the worktree-always gate denies `git push origin --delete {branch}` in the main checkout — untrue since #658 (and the `-C` form since #3900); the instruction stands, only its stated reason is stale | open | — |
| 3 | build | The `-C` deny behavior tests (content push, compound) in `tests/hooks-policy-exemption.test.js` pass on pre-fix code too — characterization pins; the regex table test and the `-C` allow test carry the go-red | observation | Accepted by task review and whole-branch review; revert-red verified on the table + allow tests |
| 4 | build | `isContentIdentical` in `plugin/bin/lib/hooks/worktree-reap.js` keeps `stdout.trim() === ''`, now redundant on `raw: true` output — harmless, left for surgical scope | observation | Whole-branch review: harmless |
| 5 | build | `findUnrawRunGitZ` in `tests/git-path-read-conformance.test.js` is line-based: an argv array built from a variable or split across lines is invisible to it (no such `-z` caller exists today; the contract's "Not covered yet" section already names the multi-line limit) | observation | Re-review grepped the variable-argv callers; none pass `-z` |
