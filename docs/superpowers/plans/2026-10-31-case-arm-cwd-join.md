# Case arms that may not run (#4486) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the write gate's cd walk stop assuming a `case` arm always runs: every arm starts where the case began, and the commands after `esac` resolve under every arm's end, plus the case's start when no catch-all pattern guarantees an arm runs.

**Architecture:** `groupEventsWith` (the tokenizer) learns three facts about each case: where its subject ends (`in`), whether a pattern of bare `*`s makes it catch-all, and where each arm opens (a new `{ arm }` event). `walkShellChunk` keeps them on the per-case record #4481 already creates: an arm terminator (`;;`, `;&`, `;;&`) banks the arm's end cwd and restarts the next arm at the case's start, and closing the case (at its next separator, or at an enclosing group's close) joins the banked ends, the open last arm and, without a catch-all, the case's start.

**Tech Stack:** Node 18+ CommonJS, `node --test`; real bash 3.2 (`/bin/bash`) and bash 5 (`/opt/homebrew/bin/bash`) as the oracle.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101424-record-4486/work/4486-spec.md` (GitHub issue #4486)

## Global Constraints

- Every expected target in a new or changed test comes from a real bash 3.2 and bash 5 run. The verdicts below were recorded with the `shell-scanner-bash-differential` skill's bounded driver from a scratch tree. Verbatim from that skill: "Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here)." and "Never derive an expected target from the scanner's own output or from memory of the bash manual."
- Verbatim from that skill: "The gate's tradeoff is that a spurious deny is acceptable and a leak is not." and "Pin each fail-closed tradeoff as deliberate, so a later 'fix' cannot quietly reopen it".
- Verbatim from that skill: "Anything that moves from denied to allowed needs its own bash verdict." This change drops exactly two base targets, both with verdicts: `case $x in a) cd /wt;; b) echo y > g;; esac` no longer reports `/wt/g` (bash: nothing for x=a, r/g for x=b), and `case $x in a) cd wt;; *) cd q;; esac; echo x > f` reports `/r/wt/f` and `/r/q/f` instead of base's `/r/wt/q/f` (bash: wt/f for x=a, q/f for x=b).
- Verbatim from that skill: "Every rule earns a mutant that turns a test red" and "Run the mutant rather than predicting which rows it turns red."
- Verbatim from that skill's Project Conventions: "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N). Test comments state what bash and the scanner do now, citing the record that set it" and "Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32."
- Verbatim from that skill: "The fail-closed cases are stated once, in `plugin/skills/_shared/policy-schema-coverage.md`'s coverage block."
- `plugin/skills/_shared/policy-schema-coverage.md` is 36,737 bytes against the 52,500-byte `RAIL_BYTES` rail. This change is a net few hundred bytes, which leaves ample headroom.
- Never run `git stash`. Commit only in the worktree `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4486`. Write commit messages as `refs #4486`, never `closes`/`fixes`.

## Review Focus

- **A multi-line case** (`case $x in\n  a) cd /wt ;;\n  *) cd /q ;;\nesac\necho x > f`). The newline after `;;` is an empty segment that must not reopen the arm. Expected: wt/f and q/f, no ./f. Pinned in Task 1 (row O).
- **A last arm with no `;;`**, ending in `;` or a group closer (`*) true; esac`, `*) { cd /q; } esac`). Its cwd must still reach the commands after `esac`, which is why the arm event exists. Pinned (rows T, I).
- **`{ case … esac }`**: the group's `}` closes the case with no separator after `esac`. Expected: the arm's cwd survives. Pinned (row J), along with the existing `#4481 case: { case a in a) cd /wt;; esac }; echo y > g` row.
- **A redirect on the compound after the reset** (`function f { case a in a) cd /wt;; esac > k; }; f; f`). `caseBegan` must join the banked arm ends, or `/wt/k` is lost. This is pinned by the existing #4481 test, so the full hook suite run is its check.
- **A subject or pattern that looks like a catch-all but is not**: `case * in`, `case *\nin`, `"*")`, `\*)`, `*(a))`. Each must keep the start cwd. Pinned (rows SUBJ, SUBJNL, G, H, EXTG).

---

### Task 1: Case arms start where the case began and end under every arm, plus the start without a catch-all

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`groupEventsWith` ~2024-2273, `walkShellChunk` ~2448-2758)
- Test: `tests/hooks-gate-coverage.test.js` (the `#4303`/`#4481` case block ~1872-2261)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (line 30, the "Where a relative target resolves" paragraph)

**Interfaces:**
- Consumes: none (single task).
- Produces: no new exports. `fileWriteTargets`, `gitTargets`, `mkdirTargets` and `forEachShellSegment` keep their signatures and return shapes. Only the targets change.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-gate-coverage.test.js`, inside the block that defines `const files = (cmd) => fileWriteTargets(cmd, '/r').map((t) => t.file).sort();` (~1877), add a `#4486` section before the block's closing `}` (~2261). Each row is `[label, cmd, includes, excludes]`. The test asserts every `includes` path (through `path.resolve`) is in `files(cmd)` and no `excludes` path is. Put the bash verdicts in the row comments, as recorded:

| Row | cmd | includes | excludes | bash 3.2 / 5 verdict |
|---|---|---|---|---|
| A (AC1.1) | `case $x in a) cd /wt;; esac; echo x > f` | `/r/f`, `/wt/f` | — | x=a wt/f, x=b r/f (both) |
| B | `case $x in a) cd /wt;; *) cd /q;; esac; echo x > f` | `/wt/f`, `/q/f` | `/r/f` | x=a wt/f, x=b q/f |
| C | `case $x in a) cd /wt;; b) echo y > g;; esac` | `/r/g` | `/wt/g` | x=a none, x=b r/g |
| D | `case $x in a) cd /wt;; *) true;; esac; echo x > f` | `/r/f`, `/wt/f` | — | x=a wt/f, x=b r/f |
| E | `case $x in a\|*) cd /wt;; esac; echo x > f` | `/wt/f` | `/r/f` | x=b wt/f |
| F | `case $x in (*) cd /wt;; esac; echo x > f` | `/wt/f` | `/r/f` | x=b wt/f |
| G | `case $x in "*") cd /wt;; esac; echo x > f` | `/r/f` | — | x=b r/f |
| H | `case $x in \*) cd /wt;; esac; echo x > f` (JS `'\\*'`) | `/r/f` | — | x=b r/f |
| I | `case $x in a) cd /wt;; *) { cd /q; } esac; echo x > f` | `/wt/f`, `/q/f` | — | x=a wt/f, x=b q/f |
| J | `{ case $x in a) cd /wt;; esac }; echo x > f` | `/wt/f`, `/r/f` | — | x=a wt/f, x=b r/f |
| N | `case $x in a) cd /wt;; b) cd /q;; esac; echo x > f` | `/wt/f`, `/q/f`, `/r/f` | — | x=a wt/f, x=b q/f, x=c r/f |
| O | `case $x in\n  a) cd /wt ;;\n  *) cd /q ;;\nesac\necho x > f` | `/wt/f`, `/q/f` | `/r/f` | x=a wt/f, x=b q/f |
| Q | `case $x in a) cd /wt;; esac && echo x > f` | `/r/f`, `/wt/f` | — | x=a wt/f, x=b r/f |
| R | `case $x in a) case $y in b) cd /q;; esac;; esac; echo x > f` | `/r/f`, `/q/f` | — | x=a y=c r/f (y=b: q/f) |
| T | `case $x in a) cd /wt;; *) true; esac; echo x > f` | `/r/f`, `/wt/f` | — | x=a wt/f, x=b r/f |
| U | `case $x in a) cd wt;; *) cd q;; esac; echo x > f` | `/r/wt/f`, `/r/q/f` | `/r/wt/q/f`, `/r/f` | x=a wt/f, x=b q/f |
| X | `cd /m && case $x in a) cd /wt;; esac; echo x > f` | `/m/f`, `/wt/f` | — | x=a wt/f, x=b m/f (and r/f if the cd fails) |
| SUBJ | `case * in a) cd /wt;; esac; echo x > f` | `/r/f` | — | r/f |
| SUBJNL | `case *\nin a) cd /wt;; esac; echo x > f` | `/r/f` | — | r/f |
| EXTG | `shopt -s extglob\ncase $x in *(a)) cd /wt;; esac; echo x > f` | `/r/f`, `/wt/f` | — | x=a wt/f, x=b r/f |
| FALL | `case $x in a) cd /wt;& b) echo y > g;; esac` | `/wt/g`, `/r/g` | — | bash 5: x=a wt/g, x=b r/g (3.2 cannot parse `;&`) |
| FALL3 | `case $x in a) cd /wt;;& *) cd /q;; esac; echo x > f` | `/q/f` | `/r/f` | bash 5: q/f for x=a and b |
| SUBST | `echo $(case $x in a) cd /wt;; esac; echo x > f)` | `/r/f`, `/wt/f` | — | bash 5: x=a wt/f, x=b r/f (3.2 cannot parse) |
| SUBC | `echo $(case $x in a) cd /wt;; b) echo y > g;; esac)` | `/r/g` | — | bash 5: x=b r/g |
| SUBT | `echo $(case $x in a) cd /wt;; *) true; esac; echo x > f)` | `/r/f`, `/wt/f` | — | bash 5: x=a wt/f, x=b r/f |
| SUBJ2 | `echo $({ case $x in a) cd /wt;; esac }; echo x > f)` | `/r/f`, `/wt/f` | — | bash 5: x=a wt/f, x=b r/f |

Title each test `#4486 case: \`${cmd}\` ends under every arm and the start without a catch-all`. Give row A its own named test, `AC1.1: fileWriteTargets('case $x in a) cd /wt;; esac; echo x > f', '/r') includes /r/f and /wt/f`, which calls `fileWriteTargets` exactly as the spec words it.

Add one prose test, `AC2.3: policy-schema-coverage.md no longer lists an unmatched case arm as a known gap`. It reads `SCHEMA` (already defined at line 34) and asserts that the text does not include `a case arm whose pattern does not match` and does include `a pattern of bare \`*\`s`, the phrase Step 5 adds.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4486|AC1.1|AC2.3" tests/hooks-gate-coverage.test.js`
Expected: FAIL. The probe on base failed rows A, B, C, D, G, H, N, O, Q, R, T, U, X, SUBJ, SUBJNL, EXTG, FALL, SUBST, SUBC and SUBT, plus AC1.1 and AC2.3. Rows E, F, I, J, FALL3 and SUBJ2 pass on base by design: they pin what the change must keep (a catch-all keeps no start, a group-closed or last-group arm keeps its cwd). Step 7 kills each of them with a mutant.

- [ ] **Step 3: Tokenizer — subject end, catch-all, arm events (`groupEventsWith`)**

- At the `case` word, create `info = { depth: g.stack.length, level: t.caseDepth, inSeen: false, catchAll: false }` (after the existing `setCaseDepth`). Push `info` to `g.casesOpened` in place of today's `{ depth, level }`, and append it to the frame's `caseInfos` array (a new frame field, replaced with a new array rather than mutated). Journal every new field write through the existing `undo` journal, so a second (flat) `scanPass` starts clean: add `const setField = (obj, key, v) => { const was = obj[key]; obj[key] = v; undo.push(() => { obj[key] = was; }); };`.
- At both `esac` sites (the armless `case x in esac` branch and the general `esac` branch), drop the frame's last `caseInfos` entry through `setField`.
- `patternCase()` returns the innermost case info whose pattern list is open where the scan stands, or `null`. Use `top()`. If it is a leading-paren frame (`leadParen`, not itself `casePattern`), use the frame under it. Return its last `caseInfos` entry when that frame has `caseDepth > 0` and `casePattern`.
- Right after `lastWord = plain ? w : '';`, before the `fnName` check: when `patternCase()` returns `pc` and the word is `plain`:
  - Before `pc.inSeen`, a word `in` sets `inSeen`. The subject is never a pattern.
  - After `pc.inSeen`, a word matching `/^\*+$/` sets `catchAll` only when the next non-blank character in `seg` is `)` or the segment ends there (a `|` cut it, as in `*|x)`). An extglob `*(a)` is not a catch-all.
  Quoted `"*"`, escaped `\*` and `$p` are not `plain`, so they never count.
- Emit `{ arm: <the case frame's caseDepth>, sub: g.nesting > 0, nesting: g.nesting }` at each of the three `)` sites that end a pattern list, right after that site's `cut(...)`:
  - the leading-paren `p`-frame `)` (when `t.leadParen`);
  - the leading-paren `(`-frame `)` (when `t.leadParen`, after its `{ close }` event);
  - the plain case-frame `)` (only when `t.caseDepth > 0 && t.casePattern` held before the `setCasePattern(t, false)`).

  Read `caseDepth` from `top()` after the pop.

- [ ] **Step 4: Walk — bank arm ends, restart arms, close cases (`walkShellChunk`)**

- **Case records.** `opened` now carries the info objects: `casePending.filter((c) => c.depth === sepDepth)`, with no `.map`. Each record that `endCommand` pushes becomes `{ level: info.level, info, from, listStart, skipOk, skipFail, pipeStart, ends: [], armOpen: true }`.
- **`closeCases(L, openCases, popped = [])`.** Also pushes every record it pops onto `popped`, innermost first. Its return value and its `listStart` join are unchanged, so `background()` is unaffected.
- **`afterCases(popped, at)`.** Returns the cwds after the closed cases' `esac`, innermost first:

  ```js
  popped.reduce((cw, R) => {
    const ends = R.armOpen ? joinCwds(R.ends, cw, overflow) : R.ends;
    return R.info.catchAll ? ends : joinCwds(ends, R.from, overflow);
  }, at)
  ```

  In `endCommand`, right after `closeCases`, add `if (closed) at = afterCases(popped, at);` before the `|` handling.
- **`endArm(L, at, openCases, fall)`.** Let `R` be `L`'s last record. If there is none, or `R.level !== openCases`, return `at` unchanged. Otherwise:
  - set `R.ends = joinCwds(R.ends, at, overflow)` and `R.armOpen = false`;
  - set `start` to `fall ? joinCwds(R.from, at, overflow) : R.from`;
  - set `L.listStart` and `L.spanStart` to `start`, and return `start`.
- **`openArm(L, level)`.** Sets `armOpen = true` on `L`'s last record whose `level` matches. With no such record (a first arm before any separator), it does nothing.
- **`settleCases(L, at)`.** Pops every record left in `L` (`closeCases(L, 0, popped)`) and returns `afterCases(popped, at)`, or `at` when nothing was popped.
- **`caseBegan`.** Joins the record's `ends` too: `joinCwds(joinCwds(from, ends), at)`. The redirect on `esac > k` then keeps an arm cwd the reset dropped.
- **In the span loop.**
  - Route an `ev.arm` event like `ev.bg`. Inside a sub run, call `openArm(subLevelAt(ev.nesting + inBacktick).list, ev.arm)` and `continue`. Outside one, add an `else if (ev.arm) openArm(list, ev.arm);` branch before `ev.bg`, so it falls through to `subCur = null` as the other outer events do.
  - At each `{ }` group close (both the sub-run branch and the outer branch, `kind !== '('` only), join `saved` with `settleCases(<the group's own list>, <cwd>)` instead of the bare cwd. The group's own list is `at.list` and `subCur` in the sub branch, and `list` and `cur` in the outer one.
- **Arm terminator.** In the separator block's non-backtick branch, where `frame.casePattern = true` is set today, compute `armEnd`:
  - `null` for the second `;` of a `;;` (`span.text === ''` and `outer[span.end - 1] === ';'`);
  - `'fall'` when `outer[span.end + 1] === '&'` or `outer[span.end + 2] === '&'` (that is `;&` or `;;&`);
  - `'end'` otherwise.

  After each `endCommand` call (the `level > 0` branch on `at.list`/`subCur` and the outer one on `list`/`cur`), apply `endArm(<that list>, <that cwd>, openCases, armEnd === 'fall')` when `armEnd` is set.
- **Comments.** Rewrite `endCommand`'s docblock sentence "The arm's own `;;` resets `caseSeen` and moves the list on to the arm's post-`cd` cwd". The arm's `;;` resets `caseSeen`, banks the arm's cwd in the case's record and restarts the next arm where the case began (#4486). State each new helper's rule in one comment that cites #4486. No review-round labels.

- [ ] **Step 5: Update the coverage prose**

In `plugin/skills/_shared/policy-schema-coverage.md` line 30:

- Delete the known-gap clause `a case arm whose pattern does not match (the walk takes an arm to run); ` from the "Known gaps" list.
- After the sentence ending "…resolves under the case's start and, failing closed, the arm's cwd.", add: "Each arm of a case starts where the case began, so the commands after `esac` resolve under every arm's end and, unless a pattern of bare `*`s (`*)`, `a|*)`, `(*)`) makes some arm run, under the case's start too, failing closed (#4486); a `;&` or `;;&` arm carries its cwd into the next arm as well."

- [ ] **Step 6: Update the exact-set rows that now carry the start, and run the hook suites**

Fourteen existing `deepStrictEqual` rows expect only the arm's cwd for a case with a literal subject and no catch-all. The walk does not evaluate a literal subject against its patterns, so each one now also carries the pre-case cwd. This was probed: each gains exactly `here` (`/r/f.js`) or `/r/f` and loses nothing.

- **In the `#4303 case:` table (~1880-1896)**, change the expected value of these rows to `[MAIN_F, here].sort()`:
  - `case x in a|x) cd /main;; esac; echo x > f.js`
  - `case x in x|a) cd /main;; *) true;; esac; echo x > f.js`
  - the `for i in 1; do …` row
  - the `if true; then …` row
  - the `cd /main\n;; esac` row
  - the `case $(echo a | cat) in a|x)` row
  - the nested `case x in a|x) case y in b|y)` row
  - the `( case x in a|x) … )` row
  - the `a) true;; b|x)` row
  - the `a) true;& b|x)` row
  - the `a) true;;& b|x)` row
  - the `x=$(case x in a|x) …)` row

  Keep `case x in *|x)` at `[MAIN_F]`, since its `*` is a catch-all.
- **Elsewhere:**
  - The `#4481 characterization` row `case a in a) cd /wt;; esac; echo x > f` becomes `[path.resolve('/r/f'), path.resolve('/wt/f')].sort()`.
  - The `gitTargets` row becomes `[path.resolve('/main'), path.resolve('/r')]`, in the order the walk returns.
- **Comment.** Add one line to the `#4303` table's header comment: "A case with no catch-all pattern also ends where it began, since the walk does not evaluate a literal subject against its patterns (#4486): `./f` on those rows is that fail-closed superset; bash writes M/f only."

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures.

Then run every `tests/hooks-*.test.js` file (AC2.2) in one `node --test` invocation, listed by name from the directory. Expected: PASS, 0 failures.

- [ ] **Step 7: Prove each rule with a mutant and each new test against base (AC2.1)**

- **Base run (AC2.1).** Run the new `#4486`/`AC1.1`/`AC2.3` tests against the pre-change `git-command.js` and coverage prose, loaded from `git show HEAD~1:<path>` into a scratch copy (never `git stash`). Each test must fail there, except the rows Step 2 names as base-passing. Those rows instead must each fail under at least one mutant below.
- **Mutants.** In a scratch copy, apply each mutant and confirm at least one listed row turns red:

  | Mutant | Killed by |
  |---|---|
  | drop the catch-all `setField` | B, E, F, O, FALL3 |
  | drop the `inSeen` branch (every plain word is a pattern) | SUBJNL |
  | drop the `)`-follows check | EXTG |
  | `afterCases` never joins `R.from` | A, G, SUBJ, X |
  | `endArm` restarts at `at` instead of `R.from` | C, T, SUBC, SUBT |
  | `endArm` ignores `fall` | FALL |
  | `endArm` leaves `armOpen` true | B, E, O |
  | outer `openArm` removed | I, T |
  | outer `settleCases` removed | J |
  | sub-run `endArm` removed | SUBC, SUBT |
  | sub-run `openArm` removed | SUBT |
  | sub-run `settleCases` removed | SUBJ2 |
  | the second-`;` guard removed | FALL3 |
  | `caseBegan` without `ends` | the existing `#4481 case: \`function f { case a in a) cd /wt;; esac > k; }; f; f\`` test |

- **Evidence.** Write the full output of both runs to `$PIPELINE_RUN_DIR/evidence/4486-ac2-1.txt` with a plain Bash redirect, after `mkdir -p` on the absolute run-dir path `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T101424-record-4486/evidence`. Log one `AC evidence` decision, `log-decision.js --run "<run dir>" --section "/build" --status AUTO --step "AC evidence" --text-file <file>`, naming AC2.1, the command shapes and the pass/fail counts.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js plugin/skills/_shared/policy-schema-coverage.md
git commit -m "Follow case arms that may not run in the write gate — refs #4486"
```

---

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Step 1's named `AC1.1:` test (row A) |
| AC2.1 | Step 7's base run and mutant table |
| AC2.2 | Step 6's four-suite run, then the full `tests/hooks-*.test.js` run |
| AC2.3 | Step 5's prose edit plus Step 1's `AC2.3:` test |

## Self-review

- **Spec coverage:** Deliverable 1 (carry the pre-case cwd and each arm's cwd past `esac` when there is no catch-all, failing closed) is Steps 3-4. Deliverable 2 (pin both shapes with bash verdicts) is rows A and B. AC1.1 is the named test. AC2.1 is Step 7. AC2.2 is Step 6. AC2.3 is Step 5 plus the prose test.
- **Placeholders:** none.
- **Consistency:** `afterCases`, `endArm`, `openArm`, `settleCases`, `patternCase`, `setField`, `info.inSeen`, `info.catchAll`, `R.ends` and `R.armOpen` are named identically in Steps 3, 4 and 7.
