# Write gate: zsh redirect forms and variable-built targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worktree-always write gate reports every file target that the shell the Bash tool actually runs (bash or zsh) writes for a redirect, and fails closed on a redirect target built from an unquoted variable it cannot see.

**Architecture:** `plugin/bin/lib/hooks/git-command.js`'s redirect scan (`redirectRawTargets`, `matchRedirectOperator`, `leadingRedirectOpEnd`/`gluedRedirectOpEnd`, `dropRedirections`) and its segment splitter learn zsh's redirect grammar. They read each form as the **union** of bash and zsh: a target either shell writes is reported. The walk's pipeline end joins the last element's cwd, as zsh runs that element in the current shell. A new `unknown` marker, emitted only when the caller opts in, lets `pre-tool-use.js`'s `checkWorktreeRequired` deny an unquoted-`$VAR` redirect target in a session whose repo has worktree-always on. `bash-prefilter.js` sends such commands to the full handler.

**Tech Stack:** Node 18+ standard library, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T123403-record-4455/work/4455-spec.md` (record #4455)

Scope keywords: redirectRawTargets, matchRedirectOperator, isFdDupTarget, dropRedirections, REDIRECTION_TOKEN_RE, hasFileRedirection, bashRedirections

## Decision (Deliverable 1)

**The Bash tool runs the user's login shell.** Probe, run through the Bash tool on this host:

```bash
echo "zsh=[$ZSH_VERSION] bash=[$BASH_VERSION] SHELL=[$SHELL]"; ps -o comm= -p $$
```

It printed `zsh=[5.9] bash=[] SHELL=[/bin/zsh]` and `/bin/zsh`. On another machine the same probe can print bash. The hook cannot know which shell a given session runs, so the scanner models **both**. For each form, any target bash 3.2, bash 5 or zsh writes is reported. This is the scanner's existing tie-break ("side with whichever shell writes"), with zsh added as a third oracle. A spurious deny is acceptable; a leak is not.

Scope of the decision in this record: redirect operators, and a pipeline's last element (carried into #4455 by its 2026-10-28 comment). The other zsh divergence that comment names stays a known gap and goes to a follow-up record: a bare `}` after an argument closes a `{` group in zsh. Two further follow-ups do the same: pathname expansion of a redirect or write word (bash and zsh both write `../f9` for `> ../f*`), and the `<>` read-write redirect.

**Relation to ADR 0028 (#4571/#4572).** That design lists #4455 as superseded by #4572's unreadable verdict. The grant was pulled on 2026-10-30 and re-added by the user on 2026-10-31. This build keeps to that direction: an unreadable variable fails closed in worktree-always sessions, logged as `gate: 'unreadable', kind: 'variable'`, the event shape #4572 specifies. The PR body names the overlap for #4572's builder.

## Oracle verdicts (recorded 2026-10-31; /bin/bash 3.2, /opt/homebrew/bin/bash 5, /bin/zsh 5.9)

Every expected target below comes from this table. Do not re-derive it from the bash manual. Re-run a shape under all three shells (the `shell-scanner-bash-differential` skill's bounded driver) only when you add a shape the table lacks. `f` is a relative file in the cwd.

| Shape | bash 3.2 / 5 | zsh 5.9 | Union (reported) |
|---|---|---|---|
| `2>&f`, `0>&f`, `3>&f`, `2>& f` | ambiguous redirect, nothing | `f` | `f` |
| `>>&f`, `2>>&f`, `1>>&f`, `>>& f` | syntax error | `f` | `f` |
| `>>&2`, `2>>&1`, `>>&p` | syntax error | file `2` / `1` / `p` | that file |
| `>>&-` | syntax error | file `-` | `./-` |
| `>&3-`, `2>&3-` | nothing (3.2 error, 5 moves fd) | file `3-` | `3-` |
| `>&2`, `2>&1`, `>&-`, `2>&-`, `>&12`, `2>& 1` | nothing | nothing | nothing |
| `>&p` | file `p` | nothing (coprocess) | `p` |
| `2>&p` | nothing | nothing | nothing |
| `&>&f` | syntax error | error | nothing |
| `>>| f`, `&>| f`, `&>>| f`, `>&| f`, `>&|f`, `2>&| f`, `>>&| f` | syntax error | `f` | `f` |
| `>&|2`, `>&!2` | syntax error / file `!2` | file `2` | `2` (and `!2`) |
| `>!f`, `>>!f`, `&>!f`, `2>!f` (glued) | file `!f` | `f` | `!f` and `f` |
| `>! f`, `>&! f` (separate word) | file `!`, `f` is an argument | `f` | `!` and `f` |
| `>&!f` | file `!f` | `f` | `!f` and `f` |
| `echo x >&|f1; echo y >g1` | syntax error, nothing runs | `f1`, `g1` | `f1`, `g1` |
| `cp a b >>& c` | syntax error | cp writes `b`, redirect `c` | copy `b`, write `c` |
| `cp a b >! c` | cp a b c (fails), redirect `!` | cp writes `b`, redirect `c` | copy `b`, write `c`, write `!` |
| `echo x \| tee a >>\| b` | syntax error | `a`, `b` | `a`, `b` |
| `V='&2'; echo x >$V`, `> $V`, `>"$V"` | file `&2` | file `&2` | `&2` |
| `V=f1; echo x 2>&$V` | nothing | `f1` | `f1` |
| `V=f1; echo x >&$V` | `f1` | `f1` | `f1` |
| `V=2; echo x >&$V` | nothing | nothing | nothing |
| `true \| cd ../m; echo x > f`, `true \| cd ../m && echo x > f` | `r/f` | `m/f` | `r/f` and `m/f` |
| `cd ../m \| true; echo x > f` | `r/f` | `r/f` | `r/f` |
| `true \| cd ../m & echo x > f` | `r/f` | `r/f` | `r/f` |

## Global Constraints

- Node standard library only; no new dependency.
- Test titles name the record and behavior (`#4455: …`). Test comments state what bash 3.2, bash 5 and zsh 5.9 do, from the table above. No `Fix round N` or review-round labels.
- Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32.
- Never run `git stash`. Run targeted suites only. The full `npm test` runs centrally at Common Step 5. Quote raw `node --test` output (the `ℹ pass`/`ℹ fail` lines) in your report; never summarize counts.
- `shell-scanner-bash-differential` (governs `git-command.js`), quoted verbatim:
  - "When the versions disagree, note it ("bash 3.2 cannot parse the odd-quote heredoc one") and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual."
  - "Every rule earns a mutant that turns a test red … In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it)."
  - "A change to what an operator means re-opens every place the splitter cuts at it … list every context in which the splitter cuts at that character and the old meaning was harmless … Pin each against bash 3.2 and 5 in the same change."
  - "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js` … The prefilter and the five guard parsers must agree on every command in it."
  - "Judging a case only under bash 3.2 and 5 … Run zsh as a third oracle".
- `pre-tool-use-gate-exemptions` (governs `checkWorktreeRequired`), quoted verbatim:
  - "A gate that reads the shell scanner's targets decides what a `lost` target means for its own concern, and records that choice where the others are stated. … Pin the choice with a case past the cap, and add the gate's reading to `_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph, the one place a gate's reading is recorded." (applies to the new `unknown` marker the same way)
  - "Every unprovable answer fails CLOSED" for exemptions. The indeterminate repo status still allows with a warning, as for every target (`docs/hooks.md`'s never-break-a-session rule).
  - "Every new exemption needs a regression test proven to go red on revert."
- `policy-schema-coverage.md`'s rule: "do not add a `fileWriteTargets` branch without the matching prefilter word (or, for redirection, without going through `hasFileRedirection`)". Every new target this plan adds must make `shouldRunFull('pre-tool-use', …)` return `true`.
- Scope and edit discipline (quoted from CLAUDE.md): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4455`, then a blank line and `Claude-Session: https://claude.ai/code/session_01JHXvgXTHUwbzXf1vhYCKXp`. Never `closes`/`fixes`.
- Before each commit run `pwd` and `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4455" rev-parse --show-toplevel` as two plain commands. Both must print the worktree; commit with `git -C "<worktree>"`.

## Review Focus

1. The common descriptor idioms must still resolve no target and take the prefilter's skip path: `cmd 2>&1`, `cmd >&2`, `cmd 2>/dev/null`, `cmd >/dev/null 2>&1`, `cmd &>/dev/null`, `cmd 2>&1 | tee out.txt` (only `out.txt`). Pinned in Task 1 (targets) and Task 4 (prefilter).
2. A quoted `"$VAR"` target stays unguarded, as documented: `echo x > "$OUT"` and `printf x > "$RUN_DIR/x"` resolve no target and are allowed from a worktree-always main checkout. Pinned in Task 4.
3. The `>&|` splitter change keeps every other `|` a pipe: `cmd 2>&1|cat`, `cmd >&2 | cat`, `a && b|c`. Pinned in Task 2.
4. The unknown-variable rule must not fire on a `$( … )`, a backtick, a `$` inside quotes or escaped, or a variable assigned a literal in the same command. Pinned in Task 4.
5. The pipeline join must not move the cwd for a backgrounded pipeline, a pipeline whose last element runs no `cd`, or a first-element `cd`. Pinned in Task 3.

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 the shell the Bash tool runs is documented, with a probe | Task 1 Step 1 (`AC1.1 #4455: …` doc pin) |
| AC2.1 each shape denied from a worktree of a worktree-always repo wherever that shell writes into the main checkout | Task 5 (`AC2.1 #4455: …` e2e rows) |
| AC3.1 the four scanner suites pass | Task 5 Step 4 |

Scope-keyword hits with no task (classified no-change): `docs/plans/2026-10-25-4303-write-gate-fail-opens-ledger.md` and `docs/superpowers/plans/2026-10-25-write-gate-fail-opens-4303.md` are history. The journeys `run-a-heredoc-node-script-from-the-main-checkout-3989.md`, `run-shell-loops-without-a-hook-storm-3074.md`, `write-a-glued-redirect-from-the-main-checkout-4015.md` and `get-a-disguised-main-checkout-write-denied-4303.md` (its `#4455` follow-up row) go to `/build`'s Common Step 6 journey capture, not to a plan task.

---

### Task 1: zsh's `N>&word` and `N>>&word` forms report their file

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`isFdDupTarget` ~1242, `REDIRECT_OP_RE`/`matchRedirectOperator` ~1254-1262, `redirectRawTargets` ~2836-2910, `REDIRECTION_TOKEN_RE`/`dropRedirections` ~3097-3125, and the header comments at ~1236-1253 and ~2785-2813 that state the bash-only rule)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`GATE_COVERAGE.bashRedirections` ~153 and its comment ~145-152: add `'>>&'`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (gate-coverage block line `- Bash redirections:` adds `` `>>&` ``; the "Bare shell redirection is covered (#3080)" paragraph's `>&` sentences, which say `N>&file` for N other than 1 "is a bash error … so none of them is a file target"; a new short paragraph stating the shell decision and its probe, placed right after the "What the gate can see at all" paragraph)
- Test: `tests/hooks-gate-coverage.test.js` (the #4303 rows at ~436-485 that pin `2>&`, `0>&`, `>>&`, `>&3-` as no target flip to the union verdict; new `#4455` rows)

**Interfaces:**
- Produces: `redirectRawTargets(t, quoting) -> string[]`, the same contract as today, now with the union targets. `matchRedirectOperator(tok) -> { plainFd: string|null, append: boolean, target: string } | null` (the internal no-quoting reader; `append` is true for `>>`). Task 2 extends the same operator readers with the clobber suffix.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-gate-coverage.test.js`, beside the #4303 `>&` block:
  - `AC1.1 #4455: the coverage doc names the shell the Bash tool runs, with its probe`: read `plugin/skills/_shared/policy-schema-coverage.md`; assert it contains the literal ``ps -o comm= -p $$`` and `$ZSH_VERSION`, and matches `/the Bash tool runs the user's (login )?shell/i`.
  - `#4455: zsh's N>&file and N>>&file forms resolve the file`: for each of `echo x 2>&/main/f.js`, `echo x 0>&/main/f.js`, `echo x 3>&/main/f.js`, `echo x 2>& /main/f.js`, `echo x>>&/main/f.js`, `echo x >>&/main/f.js`, `echo x 2>>&/main/f.js`, `echo x 1>>&/main/f.js`, `echo x >>& /main/f.js`, assert `fileWriteTargets(cmd, '/r')` deep-equals `[{ action: 'write', file: MAIN_F }]`.
  - `#4455: an append >>& reads every word as a file, and >&N- is a file in zsh`: `fileWriteTargets(cmd, '/r').map(t => t.file)` equals `[path.resolve('/r', name)]` for `['echo x >>&2', '2']`, `['echo x 2>>&1', '1']`, `['echo x >>&p', 'p']`, `['echo x >>&-', '-']`, `['echo x >&3-', '3-']`, `['echo x 2>&3-', '3-']`.
  - `#4455: descriptor dups, closes and the zsh coprocess resolve no target`: `[]` for `echo x >&2`, `echo x >& 2`, `echo x 2>&1`, `echo x >&-`, `echo x 2>&-`, `echo x >&12`, `echo x 2>& 1`, `echo x 2>&p`, `echo x &>&f`, `cmd 2>/dev/null`, `cmd >/dev/null 2>&1`, `cmd &>/dev/null`; and `echo x >&p` resolves `[path.resolve('/r/p')]` (bash writes it).
  - `#4455: a standalone >>& operator takes the next word, so a write shape keeps its own destination`: `fileWriteTargets('cp a b >>& c', '/r')` deep-equals `[{ action: 'write', file: path.resolve('/r/c') }, { action: 'copy', file: path.resolve('/r/b') }]` (order as emitted: redirects first). Also `fileWriteTargets('echo x 2>&1 | tee out.txt', '/r').map(t => t.file)` equals `[path.resolve('/r/out.txt')]`.
  - Rewrite the two #4303 tests at ~450 and ~479 (and their comments) so that `2>&/main/f.js`, `0>&/main/f.js`, `>>&/main/f.js` and `>&3-` move out of the no-target list. Their new verdict comes from the table. `redirectWriteTargets(['echo','x','2>&','/main/f.js'], '/r')` and `(['echo','x','>>&/main/f.js'], '/r')` now equal `[MAIN_F]`.
  - Update the gate-coverage pin's expectation only through the block and constant edits in Step 3. The existing pin compares them, so no new assertion is needed there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "4455|4303" tests/hooks-gate-coverage.test.js`
Expected: FAIL — the `#4455` rows return `[]` for `2>&/main/f.js` and the `>>&` rows; the AC1.1 doc pin finds no probe.

- [ ] **Step 3: Implement the union `&` reading**
  - In `redirectRawTargets`, record per operator whether it is an append (`>>`) and its fd prefix. For an `&` that is the operator's own bare character (`ampOp`, unchanged rule), the word after it decides the outcome:
    - after `>` with any fd prefix, a whole word of digits, or `-`, is a descriptor (no target). `p` is a file only when the prefix is empty or `1` (bash), and a coprocess otherwise. Any other word is a file, including `N-`.
    - after `>>` with any fd prefix, every word is a file. A word of `-` is reported as `./-`, because `resolveWriteTarget` drops a bare `-` as a flag (the `dashSafe` convention in `fileWriteTargets`).
    - after `&>`/`&>>`: no target (unchanged).
  - Replace `isFdDupTarget` with that rule rather than keeping a second copy. Update `matchRedirectOperator`/`REDIRECT_OP_RE` so the no-quoting path reads the same rule (return `append`).
  - `REDIRECTION_TOKEN_RE`: add `>>&` before `>>`, so a standalone `>>&` (or `2>>&`) token drops the word after it.
  - Add `'>>&'` to `GATE_COVERAGE.bashRedirections` and to the gate-coverage block. Rewrite the `>&` sentences in the "Bare shell redirection is covered" paragraph to state the union rule and cite the table's verdicts. Add the shell-decision paragraph with the probe command and its output.
  - Rewrite the header comments at ~1236-1253 and ~2890-2894 to the union rule (bash, zsh).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js`
Expected: PASS, with no other row changed. If an unrelated row fails, it was pinning a bash-only reading of these operators: update it only when the table gives a verdict for it, and otherwise stop and report.

- [ ] **Step 5: Mutants.** In a scratch copy of the edited `git-command.js` (scratchpad, `require`d by a scratch node script, or a temporary WIP commit reverted with `git revert --no-edit`), one at a time: (a) make `>>&` honour descriptor words again, (b) drop `p`'s stdout condition, (c) remove `>>&` from `REDIRECTION_TOKEN_RE`. Each must turn at least one Step 1 row red. Report the red test name per mutant.

- [ ] **Step 6: Commit** `git-command.js`, `pre-tool-use.js`, `policy-schema-coverage.md` and the test file: `Read zsh's N>&word and N>>&word redirect forms as file targets — union of bash and zsh, refs #4455`.

### Task 2: zsh's clobber suffixes (`|`, `!`) on every redirect operator

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`segmentSpansWith` ~121-124: keep a `|` glued after `>&`, as it already keeps one after `>`; `leadingRedirectOpEnd`/`gluedRedirectOpEnd` ~1311-1343; `redirectRawTargets`; `REDIRECTION_TOKEN_RE`/`dropRedirections`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (gate-coverage block's `Bash redirections` line gains a clause that each operator also takes zsh's clobber suffix `|`/`!`, worded so the block-vs-constant pin still compares the operator list; the redirect paragraph gains one sentence for the suffix rule)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` only if the gate-coverage pin needs the constant changed. Prefer stating the suffix in prose, so the constant lists base operators.
- Test: `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Consumes: Task 1's operator reading (`append`, fd prefix, the `&` word rule).
- Produces: no new export. `redirectRawTargets` returns both readings for a `!` suffix.

Rules (from the oracle table):
- A bare `|` right after an operator (`>|`, `>>|`, `&>|`, `&>>|`, `>&|`, `N>&|`, `>>&|`) is part of the operator in zsh. bash either agrees (`>|`, `N>|`) or refuses the command. One reading: the word after the `|`.
- A bare `!` right after an operator is part of it in zsh only. bash reads it as the first character of the word. Two readings, both reported: zsh's word without the `!`, and bash's word with the `!` (glued: `!f`; standalone `>!`: the file `!`, with the next token left as an argument). In bash, `>&!w` is the csh form only for an empty or `1` prefix, and `>>&!` is a syntax error.
- An `&`-form with a clobber suffix (`>&|`, `>&!`, `>>&|`, `>>&!`) is always a file in zsh, digits included (`>&|2` writes `2`).
- `dropRedirections` follows zsh's reading: a standalone clobber operator drops the next word. bash's reading of that word as a write-shape argument (`cp a b >! c` copying to `c`) stays covered, because the same word is reported as zsh's redirect target.

- [ ] **Step 1: Write the failing tests**, appended to `tests/hooks-gate-coverage.test.js` (`#4455:` titles):
  - `>| f` family: `fileWriteTargets(cmd, '/r').map(t => t.file)` equals `[MAIN_F]` for `echo x >>| /main/f.js`, `echo x &>| /main/f.js`, `echo x &>>| /main/f.js`, `echo x >&| /main/f.js`, `echo x >&|/main/f.js`, `echo x 2>&| /main/f.js`, `echo x >>&| /main/f.js`, `echo x >>|/main/f.js`.
  - `!` family, as sets (sort both sides): `echo x >! /main/f.js` → `[path.resolve('/r/!'), MAIN_F]`; `echo x >!/main/f.js` → `[path.resolve('/r/!/main/f.js'), MAIN_F]`; `echo x 2>!/main/f.js` → same two; `echo x >&! /main/f.js` → `[path.resolve('/r/!'), MAIN_F]`; `echo x >&!2` → `[path.resolve('/r/!2'), path.resolve('/r/2')]`; `echo x >&|2` → `[path.resolve('/r/2')]`.
  - Write shapes after a clobber operator: `fileWriteTargets('cp a b >! c', '/r')` contains a `copy` of `/r/b` and `write`s of `/r/c` and `/r/!`; `fileWriteTargets('echo x | tee a >>| b', '/r').map(t => t.file)` contains `/r/a` and `/r/b`.
  - Splitter: `fileWriteTargets('echo x >&|f1; echo y >g1', '/r').map(t => t.file)` equals `[path.resolve('/r/f1'), path.resolve('/r/g1')]`; `splitSegments('cmd >&|f')` has one segment. Review Focus 3, with pipes kept: `splitSegments('cmd 2>&1|cat')`, `splitSegments('cmd >&2 | cat')` and `splitSegments('a && b|c')` keep their existing segment counts (assert 2, 2 and 3).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "4455" tests/hooks-gate-coverage.test.js`
Expected: FAIL — the `>>|`/`&>|` rows return `/r/|`, the `>&|` rows return `[]`, the `!` rows lack `MAIN_F`.

- [ ] **Step 3: Implement.** Extend the operator end (`leadingRedirectOpEnd`/`gluedRedirectOpEnd`, and `REDIRECT_OP_RE` for the no-quoting path) to accept the optional bare `&` (no `&` prefix) and then an optional bare `|` or `!`. Emit the readings above from `redirectRawTargets`. Change `segmentSpansWith`'s `>|` exception (`current.endsWith('>')`) to also keep a `|` that follows `>&`. Grep every other site that treats `|` as a separator (`lineLeavesStructureOpen`, `groupEventsWith`, `splitOnLoneAmpersandWith`, `checkReaderCommand`/`lineFeedsOnlyDataReaders`, `separatorOp`). List each in your report as already consuming the `>&|` run or as changed. Extend `REDIRECTION_TOKEN_RE` so every standalone clobber operator drops its word. Add the suffix sentence to the coverage doc.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/teardown-gate.test.js`
Expected: PASS.

- [ ] **Step 5: Mutants** (as in Task 1 Step 5): (a) drop the `!` bash reading, (b) drop the `!` zsh reading, (c) revert the splitter change, (d) remove the clobber suffix from `REDIRECTION_TOKEN_RE`. Each must turn a Step 1 row red.

- [ ] **Step 6: Commit**: `Read zsh's clobber redirect suffixes | and ! — both shells' targets reported, refs #4455`.

### Task 3: a pipeline's last element keeps its cwd (zsh)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`walkShellChunk`'s `endCommand`, ~2530-2535: at a pipeline's end, join `L.pipeStart` with `at`, the cwd the last element left, instead of `L.pipeStart` alone; update the comment above `endCommand` and the one at ~2531)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` ("Where a relative target resolves": the sentence "In bash, each element of a pipeline runs in a subshell … (zsh runs a pipeline's last element in the current shell: a known gap, below)" becomes the union rule; remove "zsh's pipeline last element (`true | cd x` moves zsh's shell)" from the known-gaps list; add zsh's `}`-closes-a-group shape to the known gaps)
- Test: `tests/hooks-gate-coverage.test.js` (and any existing pin of the bash-only pipeline reading the suite turns red; update its expectation and comment from the oracle table)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: no API change. `fileWriteTargets`/`gitTargets`/`mkdirTargets` may return an extra cwd's target after a pipeline whose last element runs a `cd`.

- [ ] **Step 1: Write the failing tests**, appended to `tests/hooks-gate-coverage.test.js` (`#4455:` titles; `files = (cmd) => fileWriteTargets(cmd, '/r').map(t => t.file).sort()`):
  - `true | cd /main; echo x > f.js` → `[MAIN_F, path.resolve('/r/f.js')].sort()`; `true | cd /main && echo x > f.js` → the same; `gitTargets('true | cd /main; git commit -m x', '/r').map(t => t.dir).sort()` → `[path.resolve('/main'), path.resolve('/r')].sort()`.
  - Review Focus 5 controls: `cd /main | true; echo x > f.js` → `[path.resolve('/r/f.js')]`; `true | cd /main & echo x > f.js` → `[path.resolve('/r/f.js')]`; `cd /main | cat; echo x > f.js` → `[path.resolve('/r/f.js')]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "4455" tests/hooks-gate-coverage.test.js`
Expected: FAIL — the first rows lack `MAIN_F`.

- [ ] **Step 3: Implement** the join (one expression), and update the comments and the coverage doc as listed.

- [ ] **Step 4: Run the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS. A pre-existing row that pinned `r/…` only for a pipeline whose last element runs a `cd` is updated to the union, with its comment citing zsh. Report every such row.

- [ ] **Step 5: Mutant:** restore `at = L.pipeKeep ? joinCwds(…) : L.pipeStart`. The first Step 1 row must go red.

- [ ] **Step 6: Commit**: `Keep a pipeline's last-element cwd in the walk — zsh runs it in the current shell, refs #4455`.

### Task 4: variable-built redirect targets

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js`:
  - `redirectRawTargets` (~2884-2886): when the target is the next token, an `&` counts as the operator's own only when `quoting.raw[i][0] === '&'` and it is bare. Today only its kind is checked, so `V='&2'; echo x > $V` reads the substituted `&2` as a descriptor.
  - New exported `redirectWords(t, quoting) -> Array<{ raw: string, unknown: boolean }>`, holding the scan's body. `redirectRawTargets(t, quoting)` becomes `redirectWords(t, quoting).map((w) => w.raw)`, the same return contract (plan-authoring return-shape check: callers are `redirectWriteTargets`, `fileWriteTargets`, `bash-prefilter.js`'s `hasFileRedirection`, and tests that call it).
  - `unknown` is true when the word's pre-substitution text (the raw token or raw tail and its span kinds) holds a bare (`b`) `$` followed by a parameter-name start (`[A-Za-z_{0-9@*#?!$-]`), and the reported word still contains `$` (no same-command literal substituted it). A `$(`, a backtick, a `$` with kind `d`/`s`/`e`, and a substituted variable are never `unknown`. Without `quoting.spanKinds`, `unknown` is false.
  - `fileWriteTargets(command, cwd, opts)`: when `opts.unknownRedirects === true`, each unknown word adds one entry `{ action: 'write', file: null, unknown: true, word }`. The entry is deduplicated by `word`, and the `reading` second walk never re-adds a word already reported. Without the option, output is unchanged.
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` `hasFileRedirection`: count a segment when any `redirectWords` entry is `unknown` or resolves (`resolveWriteTarget(anchorFor(w.raw), w.raw, pathImpl)`). Update its header comment.
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` `checkWorktreeRequired` (~1048-1100): call `fileWriteTargets(command, ctx.cwd, { ...walkOptions(ctx.cwd), unknownRedirects: true })` and map `unknown`/`word` through. In the target loop, handle `unknown` **before** the `lost` branch and before anything reads `targetPath`, which is null for it:
  - `sessionWorktreeAlways()` `'indeterminate'` → `indeterminateTargets.push(word)`; continue.
  - Not `'on'` → continue (allow, base behavior).
  - `'on'` → `ctxLib.appendEvent(denialRunDir, 'gate-denial', { tool: toolName, path: word, gate: 'unreadable', kind: 'variable', ...testTag }, denialAttribution)` (same run-dir resolution as the lost branch), then `denyResult(...)`. The message must contain the word and the policy file name, and name this rewrite: "spell the target out as a literal path, or assign the variable a literal in the same command (`OUT=/abs/path; cmd > $OUT`)".
  - Update the comment block above the loop (~1073-1083) to state the reading.
- Modify: `plugin/skills/_shared/policy-schema-coverage.md`: the "A shell-variable path is unresolvable by construction, and unresolvable means unguarded, not denied" paragraph gains the exception. A redirect target built from an **unquoted** `$VAR` that the command does not assign is denied, failing closed, in a session whose repo has worktree-always on. Quoted `"$VAR"` targets and every non-redirect shape keep the unguarded posture. Record the gate's reading in "Where a relative target resolves": only `checkWorktreeRequired` asks for `unknown` entries; every other consumer never sees them.
- Modify: `docs/hooks.md` (the "Bash prefilter (#3074)" bullet: after "keeping `2>&1`/`> /dev/null` on the skip path …", add one sentence saying a redirect target built from an unquoted `$VAR` the command does not assign also runs the full handler, where `checkWorktreeRequired` denies it in a worktree-always session).
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (~123-125): make the sentence citing "unresolvable means unguarded, not denied" for a quoted `"$RUN_DIR/config.yml"` `sed -i` target say the exception covers only an unquoted redirect target.
- Test: `tests/hooks-gate-coverage.test.js`
- Test: `tests/hooks-bash-prefilter.test.js`
- Test: `tests/hooks-pre-tool-use.test.js`

**Interfaces:**
- Consumes: Tasks 1-2's `redirectRawTargets` rules (its body moves into `redirectWords`).
- Produces: `redirectWords(t, quoting)` (exported from `git-command.js`); `fileWriteTargets` option `unknownRedirects`; entry shape `{ action: 'write', file: null, unknown: true, word: string }`. Task 5 relies on the deny's message and on `shouldRunFull` returning true.

- [ ] **Step 1: Write the failing tests**, appended to `tests/hooks-gate-coverage.test.js`, `tests/hooks-bash-prefilter.test.js` and `tests/hooks-pre-tool-use.test.js` (`#4455:` titles):
  - Gate-coverage, known variable: `fileWriteTargets("V='&2'; echo x > $V", '/r')` and `fileWriteTargets("V='&2'; echo x >$V", '/r')` each deep-equal `[{ action: 'write', file: path.resolve('/r/&2') }]`; `fileWriteTargets('V=/main/f.js; echo x 2>&$V', '/r')` → `[{ action: 'write', file: MAIN_F }]`; `fileWriteTargets('V=2; echo x >&$V', '/r')` → `[]`.
  - Gate-coverage, unknown: with `{ unknownRedirects: true }`, `fileWriteTargets('echo x > $OUT', '/r', opts)` deep-equals `[{ action: 'write', file: null, unknown: true, word: '$OUT' }]`. So do `echo x >$OUT`, `echo x 2>>${LOG}` (word `${LOG}`), `echo x >&$FD` (word `$FD`), `echo x >>& $OUT/f` (word `$OUT/f`), and `cd /tmp; echo x > $OUT` (one entry, not one per cwd).
  - Review Focus 4: with the option, no `unknown` entry for `echo x > "$OUT"`, `echo x > '$OUT'`, `echo x > \$OUT`, `echo x > $(mktemp)`, ``echo x > `mktemp` ``, `OUT=/main/f.js; echo x > $OUT` (→ `[{ action: 'write', file: MAIN_F }]`); and without the option `fileWriteTargets('echo x > $OUT', '/r')` → `[]` (consumers that never asked are unchanged).
  - Prefilter (`tests/hooks-bash-prefilter.test.js`): add `'echo x > $OUT'`, `'echo x 2>&f.txt'` and `'echo x >>& f.txt'` to `DIFFERENTIAL_CORPUS`. Make its `fileWriteTargets` parser call `fileWriteTargets(c, CWD, { unknownRedirects: true })`, as the gate does. Add `#4455: an unquoted-variable redirect target takes the full-handler path`: `shouldRunFull('pre-tool-use', bash('echo x > $OUT'))` is `true`, and so is `hasFileRedirection('echo x 2>>${LOG}')`. Review Focus 1: `shouldRunFull` stays `false` for `cmd 2>&1`, `cmd >&2`, `cmd 2>/dev/null`, `cmd >/dev/null 2>&1`, `cmd &>/dev/null`.
  - Gate (`tests/hooks-pre-tool-use.test.js`, reusing `gitRepoWithCommit`, `withPolicy`, `linkedWorktreeOf`, `bashInput`, `pre.run`; commit the policy as the existing worktree tests do):
    - `#4455: an unquoted-variable redirect target denies in a worktree-always session, from the main checkout and from a linked worktree`: `echo x > $OUT` with `cwd` the main checkout, then with `cwd` the linked worktree. Both give `permissionDecision === 'deny'`, a reason matching `/\$OUT/` and `/policy\.yml/`, and a `gate-denial` event with `gate: 'unreadable'` and `kind: 'variable'` (read it back as the lost-cwd tests do, or pass a runDir).
    - `#4455: the rewrite the deny names passes`: from the linked worktree, `OUT=${wt}/f.txt; echo x > $OUT` is allowed (`{}` or no deny).
    - `#4455: a quoted variable target stays unguarded (Review Focus 2)`: from the main checkout, `echo x > "$OUT"` and `printf x > "$RUN_DIR/x"` are not denied.
    - `#4455: an unknown redirect variable with the policy off allows`: a repo with no policy file → not denied.
    - `#4455: an unknown redirect variable with an indeterminate repo status allows and warns`: stub `wtDetect.repoInfo`/`mainCheckoutRoot` as the #4303 indeterminate test does → not denied, `systemMessage` matches `/could not determine/i`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "4455" tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js tests/hooks-pre-tool-use.test.js`
Expected: FAIL. The separate-token `$V` row returns `[]`. `unknownRedirects` emits nothing. `shouldRunFull` is `false` for `echo x > $OUT`. The gate allows.

- [ ] **Step 3: Implement** the four code changes and the two doc edits listed under Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS.

- [ ] **Step 5: Mutants:** (a) revert the separate-token `&` check, (b) treat a `d`-kind `$` as unknown, (c) drop the `unknown` clause from `hasFileRedirection`, (d) move the `unknown` branch after `if (!wtDetect.findPolicyFile(targetPath)) continue` (a null path), (e) skip the `sessionWorktreeAlways() === 'on'` check (deny always). Each must turn a named Step 1 row red, (d) by a throw or allow on the main-checkout row and (e) by the policy-off row.

- [ ] **Step 6: Commit**: `Fail closed on an unquoted-variable redirect target under worktree-always — read a substituted & as text, refs #4455`.

### Task 5: end-to-end matrix from a worktree, the skill fence sweep, and the governing skill

**Role:** integration

**Files:**
- Test: `tests/hooks-pre-tool-use.test.js` (one table-driven `AC2.1` test)
- Modify: `.claude/skills/shell-scanner-bash-differential/SKILL.md`. Rewrite its last Anti-Patterns row ("Whether the scanner should follow zsh is still an open decision (#4455) …") to state the decision: the scanner reads redirect operators and a pipeline's last element as the union of bash and zsh. Add zsh 5.9 (`/bin/zsh`) as the third oracle in the "Real bash is the oracle, in both versions" pattern, and keep that pattern's heading.

**Interfaces:**
- Consumes: Tasks 1-4 behavior. The deny reason for an ordinary main-checkout target is the existing worktree-always message.

- [ ] **Step 1: Write the test** `AC2.1 #4455: each zsh and variable-built shape is denied from a worktree when the shell writes into the main checkout`. Build a worktree-always repo with the policy committed, and its linked worktree `wt`, `cwd: wt`. Assert `deny` for each command, where `M` is the main checkout's absolute path:
  `echo x 2>&${M}/f.txt`, `echo x 0>&${M}/f.txt`, `echo x >>&${M}/f.txt`, `echo x 2>>& ${M}/f.txt`, `echo x >&| ${M}/f.txt`, `echo x >>| ${M}/f.txt`, `echo x >! ${M}/f.txt`, `true | cd ${M}; echo x > f.txt`, `cd ${M} && V='&2'; echo x > $V`, `echo x > $OUT`.
  Assert not-deny for each control: `echo x 2>&f.txt`, `echo x >>&f.txt`, `echo x >! f.txt`, `echo x 2>&1`, `V='&2'; echo x > $V`.
  In the same test, assert `shouldRunFull('pre-tool-use', { tool_name: 'Bash', tool_input: { command } })` is `true` for every denied command (the Reachability check: the deny is reachable through the prefilter). Name each row's command in the assertion message.

- [ ] **Step 2: Run it**

Run: `node --test --test-name-pattern "AC2.1" tests/hooks-pre-tool-use.test.js`
Expected: PASS. Tasks 1-4 already built the behavior, so any failing row is a defect in its owning task: fix it there and report which task.

- [ ] **Step 3: Skill fence sweep.** Write a scratchpad node script that `require`s `tools/guard-refusals/fences.js` (`walkMarkdown`, `shellFences`) and `plugin/bin/lib/hooks/git-command.js`. Run every shell fence under `plugin/skills/` through `fileWriteTargets(fence, '/r', { unknownRedirects: true })` and print each fence holding an `unknown` entry, with its file and line. Expected: none (a 2026-10-31 grep found no unquoted `$VAR` redirect target in `plugin/skills/`). If any fence prints, rewrite that fence in this task to quote the variable or assign it in the fence, and list it in the report. Paste the script's raw output into the report.

- [ ] **Step 4: Run the four scanner suites plus the gate suites (AC3.1)**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS. Quote the `ℹ tests`, `ℹ pass` and `ℹ fail` lines verbatim.

- [ ] **Step 5: Edit the skill file** as listed, then commit the test and the skill file: `Pin zsh and variable-built shapes end to end from a worktree — record the shell decision in the scanner skill, refs #4455`.
