### Strengths
- The fix sits in the right place. The keyword skip lives inside `commandWord` (plugin/bin/lib/hooks/git-command.js:970-975), the #4448 helper the record says to extend. So `findGitLead`, the `fileWriteTargets` write-shape lead and `mkdirTargets` all pick it up from one change, without a second helper.
- The gotchas were followed:
  - `in` is in the exported `COMPOUND_KEYWORDS` (line 827) but is not skipped. Only `COMMAND_LEAD_KEYWORDS` (line 828), the words a command follows, are skipped.
  - The skip needs a bare, unquoted spelling (`raw[i] === word && spanKinds[i] === 'bbb…'`), so `"then" cp …` stays a command name. A test pins this (tests/hooks-gate-coverage.test.js:2328).
  - The cd lead (`shellOnly`) is left alone, as ADR 0028 moves cd-in-body to #4572.
- I probed head against base (`git archive` of 8d21732 into the scratchpad, same script). Head catches every record case, plus these variants:
  - nested `if`, a brace group and a subshell around an `if`
  - `if ! cp`, `while ! cp`, `select … do`, `for ((…)) do`
  - `then time cp`, `do sudo cp`, `then X=1 cp`, `then >o cp`
  - `mkdir` in a body, and `gitTargets` for `if true; then git -C /M commit …; fi`

  Base reports `[]` for all of these.
- Every extra target the skip can add falls on the fail-closed side. In `env then cp …` and `X=1 then cp …`, bash runs a program called `then`, and the gate now also reports cp's target.
- The pin test (2316-2320) checks the exported set against the record's list and checks that it is frozen, as the criteria ask.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **plugin/skills/_shared/policy-schema-coverage.md:30 and docs/journeys/get-a-disguised-main-checkout-write-denied-4303.md:96 are now stale.**
   - What's wrong: the coverage contract's "Known gaps, where a `cd` or a write is not yet followed" still lists "the body of an `if`, `while`, `until`, `for` or `case` (#4244), including a `case` inside such a body and a `cd` after `then` or `do`". The journey's gap table still lists "Compound-command bodies … | #4244".
   - Why it matters: after this change a write, `git` call or `mkdir` in such a body is followed. Only the cd half is still a gap, and that half now belongs to #4572 (per ADR 0028 and the record's "Moved to #4572"). Once the record closes, both files tell readers a closed gap is open and point to the wrong record. Earlier records (#4448's plan, Task 1) updated exactly these two places in the same PR.
   - How to fix: rewrite the clause as "a `cd` in the body of an `if`/`while`/`until`/`for`/`case` (#4572)". Add a sentence saying a command after `if`/`then`/`elif`/`else`/`while`/`until`/`do` is now read. Update the journey row to match.

2. **No test covers the `while` and `until` entries in `COMMAND_LEAD_KEYWORDS` (git-command.js:828; tests/hooks-gate-coverage.test.js:2322-2325).**
   - What's wrong: the only `while`/`until` cases are `while false; do :; done; cp x /main/f.js` and `until true; do :; done; cp …`. In both, the cp is its own segment after `done`, and both already report the target at base (I ran them). No `while` or `until` case has the command right after the keyword, and grep finds none in tests/. So removing `'while'` or `'until'` from the array leaves every test green, even though `while cp x /M/b; do :; done` and `until git -C /M commit -m x; do :; done` then fail open again.
   - Why it matters: this is the worktree-always gate. The record's technical approach and gotchas ask for a mutant proof and a go-red case for every rule.
   - How to fix: add `while cp x /main/f.js; do :; done` and `until cp x /main/f.js; do :; done`, plus a `gitTargets` case for one of them.

3. **The two halves of the scanner still have separate keyword lists (git-command.js:828 vs `COMMAND_PREFIX_WORDS` at :2195).**
   - What's wrong: `COMMAND_LEAD_KEYWORDS` is a new hand-typed copy of the seven keywords `groupEvents`' `COMMAND_PREFIX_WORDS` already holds (that set minus `!` and `time`). Nothing derives one from the other, and nothing pins them equal. The new array is also not checked against the exported `COMPOUND_KEYWORDS`.
   - Why it matters: the record's technical approach says to extend the helper "so the lexer half and the target half share a single definition of command position". The record was filed because these two halves disagreed. With two literals, a keyword added on one side brings the disagreement back without any test noticing.
   - How to fix: define `COMMAND_PREFIX_WORDS` as `new Set([...COMMAND_LEAD_KEYWORDS, '!', 'time'])`, or derive both from one source. Add a pin that `COMMAND_LEAD_KEYWORDS` is a subset of `COMPOUND_KEYWORDS`.

#### Minor (Nice to Have)
1. **Some acceptance criteria were wrong in the record itself (tests/hooks-gate-coverage.test.js:2322-2325).** The criterion "Each new case goes red against the current lead check" cannot hold for `while false; do :; done; cp x /M/b`, `until … done; cp …` or `case x in x) cp a /M/b;; esac`. All three report the target at base, because the segment split already puts the cp first. They are regression pins, not go-red cases. The test sits in one `includesFor` call with real go-red cases, so the test as a whole goes red, but a reader cannot tell which entries prove the change. Record this deviation in the PR, or split the base-passing entries into their own labelled test.
2. **The doc comment for `commandWord` (git-command.js:895-921) does not mention the new skip.** It still lists only assignment words, redirections and `STRIPPED_PREFIX_WORDS`. A later recogniser reusing the exported helper (#4572) should know it also skips leading compound keywords, except under `shellOnly`.
3. **The deliverable named tests/hooks-git-command.test.js for the git-target probes**, and none were added there. The single `gitTargets` assertion lives in hooks-gate-coverage.test.js instead. This is acceptable because the deliverable says "/", but a second `git` case (for example `do git -C /M commit`) would round out coverage.

### Recommendations
- Update the coverage doc and the journey in this PR, because these files track gate coverage.
- Add the `while`/`until` go-red cases. Then mutate each keyword out of the list one at a time and confirm a test goes red each time.
- Declined to judge (for the executor to rule on):
  - `if cd /M; then : > zz; fi` still resolves `zz` to `/r/zz`, though bash writes `/M/zz`. The cd is in the condition, which always runs in the current shell, not in a body. Base behaves the same, and ADR 0028 hands every unresolved cwd from a cd in a conditional to #4572. I set it aside as #4572's, but the condition position is not literally "a body", so the executor should confirm #4572's scope covers it.
  - `pushd`/`popd` and the prefixes `!`/`time`/`builtin`/`command` were set aside: the record's ADR 0028 scope moved them to #4572 and #4448. (`!` and `time` already strip through #4448, which my probes confirmed.)
  - Keywords after an external prefix or an assignment (`env then cp`, `X=1 then cp`) now produce an extra, spurious target. I set this aside as fail-closed and harmless.
  - I did not run the test suite or check against real bash 3.2 and 5, as instructed. My verdicts rest on reading the code plus one scratch probe script run against head and base (/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/7681df63-8b80-4414-9874-ef1bf1dd6ced/scratchpad/probe4244.js).

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The code change is correct, narrow and fail-closed, and it closes every in-scope probe case. But the user-facing coverage contract and the journey now describe the gap wrongly, two of the seven skipped keywords have no go-red test, and the "one definition of command position" the record asks for is still two literals.

DONE_WITH_CONCERNS
