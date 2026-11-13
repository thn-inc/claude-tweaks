# Open Items — Write the queue-pull parity oracle's gh, git and mktemp shims as sh scripts (#5366)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — in every task, the commit (last step) happens before the mutant-proof step's scratch-ch...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — fix both now (build deferral gate: fix-now criteria met, cheap, in this task's files) o...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — fix all now (build deferral gate: cheap, same guard family, file under change; pre-exis...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — fix all now (build deferral gate fix-now): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — the oracle.js:281 re-wrap is carried into Task 4, which edits that file's comments: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — fix all now; remove the sourced-answer path (no measured gain at fixture sizes, max 9.7...: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — fix wave applies all 3, the env item as the reviewer's narrow fork-free extension (refu...: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — residual meets fix-now (same escape class, cheap) → one targeted fix + one scoped re-re...: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build/skill | Skill observation: generating fork-free POSIX sh PATH shims extends .claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md; its dash-vs-macOS-sh pitfalls (cd empty arg, OLDPWD on cd -, a failed redirect on the colon builtin exits dash, leading zeros in arithmetic, shift past argc) are not written down there | fixed | Fixed in 1f6fcd5ac by review Step 3 Routing: the pitfalls are rule 7 of whole-fence-parity-oracle.md |
| 10 | review | Test Quality (medium): the git shim's GIT_WORK_TREE refusal had no test (queue-pull-oracle.js:493) | fixed | Fixed in 59bdfa888: shims test pins an exported GIT_WORK_TREE refused; mutant dropping the disjunct went red |
| 11 | review | Convention (low): sh shim tests were gated on a bash 4 oracle they do not need (queue-pull-shims.test.js:85) | fixed | Fixed in 59bdfa888: shimSkip skips on win32 only |
| 12 | review | Convention (low): the 300-byte refused-argv cut was recorded only in a code comment, not the spec's As-built deviations (queue-pull-oracle.js:395) | fixed | Fixed in 1f6fcd5ac: spec As-built deviations gain the 300-byte cut bullet |
| 13 | review | Convention (low): two comments still said every PATH shim re-enters the module (queue-pull-fixtures.js:739, queue-pull-oracle.js:853) | fixed | Fixed in 59bdfa888: both comments now name the gh fallback |
| 14 | review | Test Quality (low): no test drove an awkward argv through the sh git shim's NUL-framed log writer (queue-pull-oracle.js:432) | fixed | Fixed in 59bdfa888: shims test round-trips newline, quotes, dollar, backtick, backslash and empty elements; unquoted-argv mutant went red |
| 15 | review | Test Quality (low): the as-built refusal of a -C into a regular file had no test (queue-pull-oracle.js:552) | fixed | Fixed in 59bdfa888: shims test pins the refusal; a delegate-the-file mutant went red (128 vs 97) |
| 16 | review | Test Quality (low): the 15-digit mktemp counter limit was pinned only on the refused side (queue-pull-oracle.js:335) | fixed | Fixed in 59bdfa888: a 15-digit counter is asserted accepted; a 14-digit-limit mutant went red |
| 17 | review | Convention (low): the sh shims' dash vs macOS sh pitfalls were not in the parity-oracle skill (whole-fence-parity-oracle.md:10) | fixed | Fixed in 1f6fcd5ac: rule 7 added to whole-fence-parity-oracle.md, SKILL.md pointer updated |
| 18 | wrap-up | Reflect: context-gauge.js writes a stale handoff.json for a one-step --next-steps on a non-dispatched run | deferred | → backlog; staged/reflect-1.md (Queue writes). Defer-reason: tangential |
| 19 | wrap-up | Reflect: one linked-PR gh graphql call in the queue-pull oracle starts the gh shim twice and logs once | deferred | → backlog; staged/reflect-2.md (Queue writes). Defer-reason: tangential |
