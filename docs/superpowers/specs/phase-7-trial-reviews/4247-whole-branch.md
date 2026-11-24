### Strengths
- The fix is small and stays inside `advanceNesting` (`plugin/bin/lib/hooks/git-command.js:1832-1867`), so other code is barely touched. Making a closer pop only its own opener (`}` pops only `g`; `)` pops only `c`, or `k` once every case is closed) is the right model. It fixes the bare-`}` shape (`echo "$(echo } "p>q")"`): base resolved `/r/q)`, head resolves nothing.
- I ran base and head side by side. All three acceptance-criteria commands give the required result on head: the case shape resolves `[]` (base gave the junk `/r/q;; esac)`), the unquoted heredoc gives `o.js`, and `echo $(cmd x>y)` gives `y`.
- The second commit's follow-up tests check real shapes from review: a pattern ending in `.esac`, and commands or a pipe after `esac` inside the same substitution. They call the real `fileWriteTargets` with no mocks.
- These shapes come out the same on base and head: a nested `$(case …)` inside `$(case …)`, `${y}` inside a case arm, `{ …; }` groups, `(a)`-style patterns, `a|b) … *)` patterns, a quoted `"$x"` subject, and two case substitutions in one line.

### Issues

#### Critical (Must Fix)
1. **The gate now misses writes it used to catch (fails open) when the word `case` appears as an ordinary word inside `"$(case …)"`.** File: `plugin/bin/lib/hooks/git-command.js:1848-1850`.
   - **What's wrong:** the `case`/`esac` counter adds one for any word `case` that follows whitespace, `;`, `&`, `|` or `(`. That includes an argument (`echo case`), a pattern (`in case)`), and a backtick body (`` `echo case` ``). The `k` level's open-case count then never returns to `0`, so the level never pops. The nesting stays open past the closing `"`, and every redirect after it resolves nothing. Measured, base → head:
     - `echo "$(case $x in a) echo case;; esac)" && echo y > o.js`: `["/r/o.js"]` → `[]`
     - `echo "$(case $x in case) echo hi;; esac)" && echo y > o.js`: `["/r/o.js"]` → `[]`
     - ``echo "$(case $x in a) echo `echo case`;; esac)" && echo y > o.js``: `["/r/o.js"]` → `[]`
   - **Why it matters:** these are the class the record calls "fails open": a real write to a tracked file gets past the worktree-always gate. The record requires "no write slips past it". The comment above the function ("Over-counting only leaves the state nested, which resolves no target") presents staying nested as the safe direction. Here it is the unsafe one, because the open state carries into later segments.
   - **How to fix:** count `case` only where it starts a command (at the start of the substitution, or after `;`, `&&`, `||`, `|`, a newline, `then`, `do` and so on). Do not count it in argument or pattern position. Alternatively, build the shared lexer the record asks for (Important 1). Pin all three commands above as regression tests.

#### Important (Should Fix)
1. **The record's main deliverable is not done.** The record asks to replace the two nesting walkers with one shared word-lexer and to have both the redirect scan and `stripHeredocBodies` read it. Both commits change only `advanceNesting`. `scanHeredocs`/`scanHeredocsWith` (`git-command.js:2332-2336`) and its `subs` stack are untouched, so the two walkers can still disagree. This is a narrowed scope, not a justified improvement, and the implementer should confirm whether it was intentional. The heredoc and unquoted-`$(` shapes pass only because they already passed on base (I measured both resolving correctly at `c6f7915151`).
2. **The old-versus-new corpus differential is missing.** The record asks for the old and new parsers to be run over a shared command corpus, with every changed result accounted for. Nothing in the diff does that, and it would have caught Critical 1.
3. **The shapes were not added to the prefilter differential corpus.** File: `tests/hooks-bash-prefilter.test.js:223-227`. The new test asserts `hasFileRedirection` directly. It does not add the shapes to `DIFFERENTIAL_CORPUS` (line 27), which the record names explicitly. Compare the `#4210` test just below it, which asserts membership in the corpus.
4. **A `case` that is not the first command in the substitution still closes the level early and produces a junk target.** File: `git-command.js:1843`.
   - The `k` level is detected only by `/^\(\s*case\s/`. So `echo "$(x=1; case $x in a) echo "p>q";; esac)"` and `echo "$(true && case $x in a) echo "p>q";; esac)"` still resolve `/r/q;; esac)` on head.
   - This is the same false deny as shape 1, for an equally ordinary command. Only the leading-`case` form was fixed.
5. **A pattern that follows an `echo esac` arm closes the level early.** File: `git-command.js:1848-1850`. For example, `case $x in a) echo esac;; b) echo "p>q";; esac`: the stray `esac` argument brings the count to 0, so `b)` pops the level. This is the reverse of Critical 1 and fails closed (a false deny). It needs the same command-position fix.

#### Minor (Nice to Have)
1. **Two new standalone test files break the file layout.** `tests/hooks-4247-case-esac-suffix-pattern.test.js` and `tests/hooks-4247-case-esac-tail.test.js` are the only `tests/hooks-NNNN-*` files in the repo. Their three tests belong next to the other `#4247` tests in `tests/hooks-gate-coverage.test.js`.
2. **The case counter is cramped and hard to read.** File: `git-command.js:1849`. It keeps the count as a decimal-digit string capped at 9 (`Math.min(9, …)`), which silently saturates at 10 or more nested cases (unlikely, but wrong). An array of counts would be clearer.
3. **The function's header comment is out of date.** File: `git-command.js:1822-1831`. It still describes only the `c`/`g`/`p` level kinds. It does not mention the new `k` level, the `kd` counter, or the rule that a closer pops only its own opener.
4. **The head commit's subject is mangled:** it reads "… — refs — refs #4247".
5. **The record itself has an error:** it promises "four shapes" but lists three. The bare-`}` shape appears only in the first bullet's parenthetical. That should be corrected so it is clear what "all four" means.

### Recommendations
- Build the shared lexer the record specifies. It should recognise `case`/`esac` only in command position, and both `advanceNesting` and `scanHeredocs` should use it. Then run the old-versus-new corpus differential and account for every changed result. A corpus that includes the word `case` as an argument, as a pattern, and inside backticks would have exposed Critical 1.
- For a write gate, state and test the safety direction at every point where the nesting state crosses a segment boundary. An open nesting state that outlives its closing quote suppresses every later target, which fails open, not closed.

**Declined to judge:**
- `npm test` / `npm run test:perf`, and whether the `hooks-prefilter` perf budget holds: I was told not to run the suites. The extra `raw.slice(j + 1)` regex per `$(` and per `c`/`e` character inside a `k` level looks cheap, but that is not measured.
- Whether CI is green on PR #6225: not checked, because the review is read-only and judged from the diff.

### Assessment

**Ready to merge?** No

**Reasoning:** The acceptance-criteria commands pass, but the fix lets writes past the gate that base caught: any `"$(case …)"` containing the word `case` as an ordinary word suppresses every later redirect. Separately, the record's core deliverable (one shared lexer for both walkers, plus the old-versus-new differential) was not built.

DONE_WITH_CONCERNS
