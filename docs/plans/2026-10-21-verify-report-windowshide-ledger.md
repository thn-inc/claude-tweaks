# Open Items — #3854 verify report.js git calls omit windowsHide

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at pre-flight | observation | Caught up — worktree branch includes origin/main (0ac46ab14); it also carries one local-only ride-along `[reconcile] archive run` commit (5a4293816) from local main |
| 2 | ops | #3854 file-overlaps open #2987 on plugin/bin/lib/verify/report.js | observation | Warning only (Step 2.8) — built #3854 alone as named; #2987 touches the pass-stamp path, not the git-call options |
| 3 | build | SDD task review minor: tests/windows-hide-spawn-conformance.test.js header comment does not describe the injected-runner shape the scanner now matches | fixed | Header paragraph added in Common Step 3's simplification pass (comment-only; focused suites 27/27) |
| 4 | build | SDD task review minor: scanner identifier collection is file-scoped — a same-named unrelated call in one file would be flagged | accepted | Zero instances in plugin/bin (reviewer grep); a false positive fails the repo-wide test loudly, so it can never pass silently — it surfaces as a red test naming file:line |
| 5 | build | SDD task review minor: a direct-require default (`x = require('child_process').execFileSync`) is not captured | fixed | Superseded by #7 — the reviewer's "zero instances" grep was wrong (plugin/bin/lib/verify/run.js:143 had one); review fix fb2636837 now collects the require-form default |
| 6 | review | Lens 3c (medium): scanner binding regex missed logical-OR fallbacks (`deps.execFileSync OR execFileSync`) — plugin/bin/lib/repo-resolve.js:38 `gh --version` spawn was unhidden and invisible | fixed | fb2636837 — regex collects logical-OR and nullish fallbacks; spawn hidden; self-test added (RED before, GREEN after) |
| 7 | review | Lens 3c (low): require-form default `spawnImpl = require('child_process').spawn` not collected — plugin/bin/lib/verify/run.js:91 check-runner spawn unhidden | fixed | fb2636837 — require-form default collected; opts carry windowsHide; run.test.js pin updated |
| 8 | review | Lens 3c (low): a semicolon-less alias binding was not collected | fixed | fb2636837 — a line end now terminates a binding; self-test added |
| 9 | wrap-up | Reflect near-miss: widening a structural matcher to one binding shape left neighbouring shapes unseen — enumerate every syntactic variant before planning (staged/reflect-1.md) | fixed | Absorbed by the Skills curation row — 788201dce adds the rule to .claude/skills/bin-source-scan-conformance/SKILL.md |
| 10 | wrap-up | Reflect friction: log-decision.js rejects the `enum (note)` reversibility ~75 skill templates prescribe — backlog candidate (staged/reflect-2.md) | open | — |
| 11 | wrap-up | Skills curation: .claude/skills/gh-api-module-pattern/SKILL.md is 58459 bytes, over the 52500-byte Read rail — split proposal (staged/skills-2.patch) | open | — |
