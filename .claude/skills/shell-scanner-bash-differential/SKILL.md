---
name: shell-scanner-bash-differential
description: Use when changing or reviewing the write gate's shell scanner in `plugin/bin/lib/hooks/git-command.js` (heredoc stripping, quoting and nesting spans, the segment and cwd walk, `fileWriteTargets`/`gitTargets`/`mkdirTargets`) or the prefilter that shares it — judge each case against real bash 3.2 and 5, check base for regressions, fuzz differentially, time adversarial shapes through the real hook, and prove every rule with a mutant. Keywords - shell scanner, heredoc, stripHeredocBodies, forEachShellSegment, bash 3.2, bash 5, differential, fuzz, mutant, fail closed, spurious deny, leak, step budget, cwd cap, routine table.
---

# Shell scanner: judge it against real bash

## Overview

`git-command.js` decides what a Bash command writes, and where, without running it. It is a hand-written model of bash. A gap in that model is a leak: the gate allows a write into the main checkout. #4149 spent six review rounds on this module, and each round found a new divergence. Reasoning about bash by hand converges slowly. What converged was checking each case against a real shell and proving each rule mechanically. The rules below are that method.

## Key Patterns

### Real bash is the oracle, in both versions

Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here). Use a scratch directory, a logging `git` stub first on `PATH`, and real `cp`/`mkdir`/redirect targets, then record what each shell actually wrote and where. Write the verdict into the test comment, the way `tests/hooks-gate-coverage.test.js` does ("bash 3.2 and 5 write /main/f.js for each"). When the versions disagree, note it ("bash 3.2 cannot parse the odd-quote heredoc one") and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual.

### Bias every unknown toward a visible body or a reported target

The gate's tradeoff is that a spurious deny is acceptable and a leak is not. A shape the scanner cannot place keeps its heredoc body visible, or resolves a relative target in the overflow cwd (`walkOptions` in `pre-tool-use.js` passes the main checkout). That is how the reader allowlist works: a non-reader on the opener line keeps the body, and `while read l; do …; done <<EOF` keeps it by design. Pin each fail-closed tradeoff as deliberate, so a later "fix" cannot quietly reopen it (`#4149: a shell loop on the opener line keeps its body (deliberate fail-closed tradeoff)`).

### Compare against base before calling a change a fix

Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base and at earlier revisions of the branch, in a scratch `git worktree add --detach`. Diff the targets. Anything that moves from denied to allowed needs its own bash verdict. The common shapes that must keep stripping live in the `#4149 routine` table in `tests/hooks-gate-coverage.test.js`. Add a shape there whenever a rule touches its neighbourhood.

When the change threads a `pathImpl` through the resolvers, run that base comparison with `path.win32` injected on both sides too. HEAD under `path.win32` against HEAD under POSIX shows only where the platforms differ, not what the change moved: #4281's cross-drive drive-root regression passed that check, and the final review caught it.

### Fuzz differentially, then turn each divergence into a case

Hand-picked cases find the bugs you already imagined. Generate commands from a small alphabet of the constructs the scanner models (quotes, `$( )`, backticks, `${ }`, `$(( ))`, groups, `&`, `|`, `&&`, `cd`, heredoc openers, redirects), run each one under both shells, and compare with the scanner's targets. A shell that writes where the scanner reports nothing is a leak: fix it and pin it. A target bash never wrote is a spurious deny: accept it only when it is the fail-closed side of a stated tradeoff.

### Time adversarial shapes through the real hook, and keep wall clock out of tests/

The scanner runs on every Bash call, so a super-linear shape stalls the session. Time repeated nests, unterminated `"$(` chains and many distinct `cd`s through `hooks.js pre-tool-use` itself, not just the function. #4149 found 12 s at 120 KB and 24 to 49 s at 40 KB that way. Bound them with a cap (`NEST_LEVEL_CAP`, the per-pass step budget, the 16-entry cwd cap), and pin each cap in `tests/` with a timing-free case (a budget-spending line that must leave the next body kept). Wall-clock budgets go in `perf/heredoc-scan-linearity.test.js`. A `ms < 750` assertion in `tests/` failed `npm test` under load.

### Every rule earns a mutant that turns a test red

In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it). #4149 dropped six rules this way (`5f8729589`, `9ba9e4d4a`). Mutate the checks downstream of a rule too: a rule that is only reachable through another rule's branch can look pinned when it is not.

### A change to what a word means re-opens every rule keyed on its spelling

When the tokenizer's word changes meaning (#4281 turned it from typed text into the bash value, quotes and escapes removed), every rule that compares a word's spelling gains spellings bash reads differently: the `cd` lead in `visitSegment`, `REDIRECTION_TOKEN_RE` in `dropRedirections`, assignment detection (`isAssignmentWord`). `\cd sub > f`, `tee 2\> f` and a backslash-newline before `A=x>f` each leaked that way, past the differential fuzz and the whole-branch review, until real bash ran them at base and HEAD. List every spelling-keyed rule in the same change, pin each with an escaped and a quoted spelling, and add escapes inside operators (`2\>`), keywords (`\cd`, `c\d`) and before assignments to the fuzz alphabet. A normalization added to the parsers (the backslash-newline join) gets the same reading in `bash-prefilter.js`'s `shouldRunFull` in that change, with bash's parity rule: a backslash-newline joins only after an odd run of backslashes.

## Decision Framework

| Situation | Do |
|---|---|
| A new shape the scanner misreads | Get a bash 3.2 and 5 verdict, write the case, then fix |
| Bash versions disagree | Side with the version that writes; note the split in the comment |
| The fix widens what strips or allows | Run the base comparison and the routine table before anything else |
| A mutant survives every suite | Add a discriminating case, or delete the rule as dead |
| A shape is slow through the hook | Cap it, pin the cap timing-free in tests/, time it in perf/ |
| Each round keeps finding a new divergence class | Stop modelling more bash; recognise a fixed set of shapes and keep every other body visible |

## Project Conventions

- A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js` (`docs/hooks.md`, #3092). The prefilter and the five guard parsers must agree on every command in it.
- The fail-closed cases are stated once, in `plugin/skills/_shared/policy-schema-coverage.md`'s coverage block. Its reader lists are pinned to `DATA_READER_WORDS`, `READER_WRAPPER_WORDS`, `GIT_DATA_SUBCOMMANDS` and `INERT_NEIGHBOUR_WORDS`, so changing a list means editing the prose in the same change.
- Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N).
- Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32.
- A marker the scanner plants in a word value (`STRAY`, a NUL, in `settleStrayBackslash`) needs every typed copy stripped from the input before the walk, or a typed one reads as the marker. `forEachShellSegment` and `shouldRunFull` both drop every NUL first, as bash does with one it reads (#4281).

## Common Operations

This session's Bash guard refuses heredocs, `cd` chains and any argument containing a `git` token. Write the drivers as scratchpad node scripts and run them with `node <script>`:
- bash verdict: `spawnSync('/bin/bash', ['-c', cmd], { cwd: scratch, env: { ...process.env, PATH: stubDir + ':' + process.env.PATH } })`, then read the stub's log and the files it wrote. Repeat with `/opt/homebrew/bin/bash`.
- base comparison: `git worktree add --detach <scratch> <base>`, then `require(<scratch>/plugin/bin/lib/hooks/git-command.js)` beside the branch copy and diff `fileWriteTargets(cmd, cwd)`.
- mutant: edit a copy in a scratch worktree and run `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js` there.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Writing the expected target from what bash "should" do | Six #4149 rounds found divergences reasoning had missed: `$((cmd) )` is a substitution, a lone `&` inside `$( )` resets the sub run, and a substitution after `<<` runs with the body on stdin |
| Accepting a fix whose tests all pass without a base comparison | A new strip rule can let a write through that base denied, and no case pins the old denial |
| Keeping a rule because it reads as necessary | #4149 found six rules whose mutants no test killed; three were dead and three were equivalent to other code |
| Timing a shape by calling the function only | The hook adds the prefilter and three walks per call (worktree-required, E1, teardown); time `hooks.js pre-tool-use` |
| Asserting wall clock in tests/ | It flakes under sibling-suite load; the timing-free cap pin goes in tests/, the clock in perf/ |
| Re-checking main only at setup on a long scanner run | #4015 landed mid-run on the same functions and needed a semantic merge at review |
| Fuzzing only the shapes the change targets | #4281's fuzz missed three escaped-spelling leaks (`\cd`, `2\>`, an escaped newline before an assignment) in rules the change never edited but whose input it redefined |

## Reference

- `plugin/bin/lib/hooks/git-command.js` — the scanner (`stripHeredocBodies`, `scanPass`, `topLevelSpans`, `forEachShellSegment`, `fileWriteTargets`)
- `plugin/bin/lib/hooks/pre-tool-use.js` — `walkOptions`, the overflow cwd
- `tests/hooks-gate-coverage.test.js` — write-target cases, the `#4149 routine` table, the prose pins
- `perf/heredoc-scan-linearity.test.js` — linearity budgets
- `docs/hooks.md` — the Bash prefilter section
