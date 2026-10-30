# Write gate: recognise a fixed set of shapes, deny the unreadable

- **Origin:** #4475 (reflect finding from #4303)
- **Decision record:** `docs/decisions/0028-write-gate-recognises-shapes-and-denies-the-unreadable.md`
- **Date:** 2026-10-30

Calls marked *(my call)* were settled after the builder check, without a human answer. Check them
while reading.

## Intent

`plugin/bin/lib/hooks/git-command.js` (3,310 lines) is a hand-written model of bash. The
worktree-always write gate, the teardown gate, the pipeline shadow guard, post-tool-use and four
smaller git-reading gates all read Bash commands through it. Every change still finds a new way it
disagrees with real bash:

- #4149 took six review rounds, and #4303 took eight fix rounds plus a regression found in review.
- The heredoc paragraph in `_shared/policy-schema-coverage.md` is one ~1,900-word sentence chain.
- Eleven gap records are open (#4244, #4247, #4446–#4455, #4460).

ADR 0027 named a fixed-shape recogniser as the fallback "if the scanner's size or review cost
becomes the problem". Both have now happened.

The end state: the gate reads a fixed set of command shapes well, and **every other part of a
command is unreadable**. An unreadable part that could write is denied under the rule below, and
the deny message names the rewrite.

**Why the alternatives lost** (full reasoning in the ADR):

- **Keep extending the model:** this is the loop above.
- **A real parser:**
  - bash cannot output an AST, so this means vendoring a JS grammar;
  - the user's shell is often zsh (#4455);
  - the hardest gaps depend on runtime values no parser sees (#4448, #4450, #4455).

## Goals

1. Correct for the commands agents actually run, not for every possible command.
2. Every part the gate does not read is handled by one rule.
3. A spurious deny is always one cheap rewrite away, and the message names a rewrite that
   actually passes.
4. Later gap reports are triaged with one test: is this a recognised shape the gate misreads (fix
   it), or something unreadable (the rule covers it)?

## Non-goals

- Covering writes the gate never covered: `node -e "fs.writeFileSync(…)"` and `python -c`.
  Coverage stays the write shapes, redirects, `mkdir` and git (`GUARDED_PROGRAM_WORDS`). The
  opaque-program gap stays documented.
- Changing behaviour outside worktree-always sessions.

## Anti-goals (a failure even if the code works)

- **Deny loops.** An agent retries a denied command in slightly different spellings. Every deny
  names a rewrite that passes the gate, and a test proves each named rewrite passes.
- **Breaking a session.** A scanner exception or an indeterminate repo status allows, as today
  (`docs/hooks.md`). A step-budget overrun is not an exception: it is an unreadable verdict (see
  below). *(my call — the earlier draft contradicted itself here)*
- **Silent loss of coverage.** A command today's gate denies must still deny, unless the "Accepted
  changes" list below names it.
- **Breaking shipped skills.** A bash fence in `plugin/skills/**` that runs today from the main
  checkout must still run, or be rewritten in the same phase that starts denying it.
- **A runtime npm dependency, or a vendored shell grammar.**

## Constraints

- Node standard library only (ADR 0015, ADR 0019).
- `perf/heredoc-scan-linearity.test.js`'s 750 ms budget holds. Its assertions at lines 33 and 57
  expect targets inside `"$(` and a 12,000-deep `$( )` nest, so they are rewritten to assert the
  unreadable outcome, still under budget.
- A new deny gate, or a new posture in an existing one, follows the
  `pre-tool-use-gate-exemptions` project skill. Each scanner change follows
  `shell-scanner-bash-differential`.
- Event shape: `gate-denial` gains `gate: 'unreadable'` with a `kind` sub-field (`substitution`,
  `cwd`, `variable`, `zsh`, `budget`, …). Nothing reads `gate: 'lost-cwd'` today; the only hit is
  its writer at `pre-tool-use.js:1093`. So it is renamed to `gate: 'unreadable', kind: 'cwd'`
  outright, with no twin and no double count. *(my call)*

## Decided

### What the gate reads (recognised shapes)

- Top-level lists: `&&`, `||`, `;`, `|`, `&`, newline.
- Quoting: single, double, `\` escapes, and `$'…'` treated as an opaque literal word.
- Heredocs, under ADR 0027's data-reader rule (unchanged).
- Redirects as `policy-schema-coverage.md` describes them, including the exclusions for fd
  duplication and `/dev/null`-like sinks.
- **Variables assigned a literal in the same command** (`T=/x; cp a "$T"`, `G=git; $G commit`), and
  `$HOME`. These are substituted wherever they appear: program word, operand or redirect target.
  `substituteVars` stays; it is not deleted in Phase 2. *(my call — deleting it would lose today's
  `$G commit` deny, and would make the plugin's own `WT=…; git -C "$WT"` prose unreadable)*
- **cd:** a literal `cd <path>`, and bare `cd` with `$HOME` known. Its effect lasts:
  - for the rest of its and-or chain when joined by `&&`;
  - for the rest of the command when followed by `;` or a newline. A cd is assumed to succeed, as
    today.

  The cwd becomes unresolved after:
  - a `||` around a cd;
  - an and-or chain containing a cd that is followed by `;` (as in `cd x && a; b`, where `b`
    runs in x or not, depending on the cd).

  This replaces the multi-cwd set. *(my call)*
- Brace groups and subshells whose bodies are recognised shapes.
- Compound keywords used as list structure: `if/then/elif/else/fi`,
  `while/until/for … do/done`, `case … esac`.
- Prefixes stripped before the command word: `NAME=value`, `env` (non-`-S` flags), `sudo`/`doas`
  (with flags), `command`, `builtin`, `exec`, `nice`, `nohup`, `time`, `!`.
- The write shapes, `mkdir`, and git, as today.

### What is unreadable

Everything outside the recognised set. The cases that matter:

- The body of `$( … )`, a backtick, `<( … )`/`>( … )`, and `eval`. The whole body is unreadable,
  including the later commands in a `$( )` that today's model partly walks.
- The argument of `sh -c`, `bash -c` and `zsh -c`.
- A `$NAME`/`${NAME}` that is not a same-command literal assignment or `$HOME`, in any position.
- A part whose cwd is unresolved:
  - `cd -`, `cd "$X"` (X unknown), `cd -P`, `pushd`/`popd`;
  - a cd inside a loop body;
  - the cases in the cd bullet above.

  Only cwd-dependent pieces become unreadable: relative targets, and git without an absolute
  `-C`. Absolute targets are still read, as today (`pre-tool-use.js:557`). *(my call)*
- zsh-only syntax: `=(…)`, glob qualifiers, `>>|`, multios (`> a > b`), `=cmd` expansion.
- A scan pass that exhausts its step budget or nests past 32 levels. This replaces ADR 0027's
  "re-read flat" exception.

During Phase 1, "everything outside the recognised set" is reached by:

- the explicit detectors above;
- the prefix and keyword shapes from #4448 and #4244, built inside Phase 1 rather than after it.

A segment whose command word is still not a recognised word or prefix after that is also
unreadable. *(my call — the complement, not just a list; landing the prefix shapes first stops
`sudo cp …` from going unreadable for a release)*

### The unreadable rule

An unreadable part **could write** when its raw text holds any of:

- a write-shape word or `mkdir`, matched by basename;
- `git` together with one of the gate's guarded git subcommand words
  (`GATE_COVERAGE.gitActions`'s spellings), so `$(git rev-parse HEAD)` and
  `$(git remote show origin | sed …)` do not count; *(my call — without this, 12 shipped skill
  snippets deny from the main checkout)*
- a `>` that is not an fd duplication (`>&N`, `N>&M`) and does not target a `/dev/null`-like sink.
  The test is quote-agnostic, so `jq ".a>1"` inside `$( )` counts, which is an accepted spurious
  deny. *(my call — the earlier draft gave three conflicting definitions)*
- a `$NAME` that names the program (`$G …`), because the program word is then unknown.

**Where it denies** (decided by the maintainer, 2026-10-30). Only in a session whose main
checkout has worktree-always on:

- **From the main checkout:** every unreadable part that could write denies.
- **From a linked worktree,** an unreadable part that could write denies only when either:
  - the command's raw text contains the main checkout's absolute path; or
  - the part's cwd is unresolved in a way that can leave the worktree: `cd -`, `$OLDPWD`, a
    relative cd with `..` segments, `pushd`/`popd`, or a cd to an unknown variable.

  Otherwise it is allowed, since an ordinary relative write from a worktree lands in that
  worktree.

This keeps every escape the builder check found from a worktree denied:

- `x=$(true; cp a /main/f)`
- `echo $(echo hi > /main/f)`
- `cat =(ls) > /main/f`
- `echo hi > /main/a > /main/b`

`T=/main/f.js; cp a $T` stays a recognised shape, denied by target as today.

**Fail-safe:** if the main checkout's path cannot be resolved (`wtDetect.mainCheckoutRoot` returns
nothing), the worktree case falls back to the full rule. An indeterminate repo status still
allows.

**The deny message** names:

- the `kind` (substitution, unresolved cd, variable, zsh syntax, budget);
- one rewrite that passes, by kind:
  - absolute paths or `git -C <absolute path>`, for a cwd problem;
  - assigning the variable a literal in the same command, or spelling the path out, for a variable;
  - the Write/Edit tool, for a file write;
  - a scratchpad `node` script, for multi-step logic;
- the worktree route.

### Consumers

| Consumer | Kind | Unreadable posture |
|---|---|---|
| worktree-always write gate (`checkWorktreeRequired`) | gate | the rule above, logged as `gate-denial` |
| teardown gate (`checkTeardownGate`) | gate | keeps its own conditions and event (`wd-guard-refusal`): an unreadable `git worktree remove` path denies wherever a `lost` one denies today. No new `rm` coverage. *(my call — the earlier draft wrongly listed `rm`)* |
| pipeline shadow guard (`checkPipelineShadowGuard`) | gate | keeps its own conditions (it acts in linked worktrees, with no policy condition) and event: an unreadable part that could write denies wherever a `lost` one does today |
| E1 (`resolvedGitSegments`), `checkBookkeepingStampsGate`, `checkDispatchConfigGate`, `checkGitStashWarn` | git readers | see recognised targets only; an unreadable part yields no target for them. Phase 2 must keep each one's current tests green, or list the change in Accepted changes. *(my call)* |
| post-tool-use (`gitTargets`, `subjectLine`) | observer | no reading for an unreadable part; never guesses a target or subject |
| `bash-prefilter.js` | filter | keeps its contract: it must be a superset of what the handler acts on. It widens so that a redirect whose target holds `$`, and any unreadable-class token (`$(`, backtick, `eval`, `-c`, `=(`), run the full handler. Today `echo hi > "$OUT"` skips. *(my call — the earlier draft wrongly said "unchanged")* |
| PowerShell `-Command` gate | gate | unchanged; it is already the content-agnostic form of this rule |

### Accepted changes

The design makes these commands deny that pass today, from the main checkout:

- `cp a "$(pwd)/f"`;
- `cd "$DIR" && cp a b` with DIR not assigned in the command;
- `echo hi > "$OUT"`.

Each has a passing rewrite named in its message.

Two kinds of command could in principle become allowed from a linked worktree:

- an unreadable part that writes into the main checkout without spelling its path;
- one that leaves the worktree by a route other than the named escapes.

The builder check's probes found five worktree-escape commands, and all five still deny under this
rule; a test pins them. That is a sample, not a sweep. Phase 1 also runs today's gate test corpus
from a linked-worktree cwd, and lists any command that flips from deny to allow under Accepted
changes.

### Measuring it

Unreadable denies are `gate-denial` events with `gate: 'unreadable'`, which `friction-events`
already counts. ADR 0028's revisit trigger reads that count, and also covers an agent re-issuing a
denied command more than twice in one session.

## Phases

### Phase 1 — The unreadable verdict, alongside today's model

1. Add the verdict, its `kind`, the could-write test and the deny message.
2. Land #4448's prefix shapes and #4244's keyword shapes in this phase.
3. Fold `lost` into the verdict as `kind: 'cwd'`.
4. Widen the prefilter.
5. **Prose sweep:** run every bash fence in `plugin/skills/**` through the new gate, as if from the
   main checkout and from a linked worktree. Rewrite each fence that newly denies in the same PR,
   and add a conformance test so a later fence cannot reintroduce one. *(my call — required by
   the shipped-skills anti-goal)*

Today's model keeps running beside the verdict.

Exit: the superseded records close, each linked to a test showing its example's outcome.

### Phase 2 — Narrow the model to the recognised set

Delete the code that only served shapes now classed unreadable:

- substitution-body walking;
- the multi-cwd set and `CWD_SET_CAP`;
- the `BASE_VIEW`/`keepLost` dual reading, once the four git readers above no longer need it.

`substituteVars` stays. Rewrite or delete each test that pinned removed behaviour, with a reason
in the PR. Shrink `policy-schema-coverage.md`'s heredoc paragraph to the recognised set plus the
rule. Record perf timings before and after. The line count is an outcome to report, not a target.

### Phase 3 — Observer posture and docs

- post-tool-use reports no reading for unreadable parts.
- The differential skill is re-scoped to the recognised set.
- `docs/hooks.md` documents the verdict.
- ADR 0027 gains a "Superseded in part by 0028" note.

## Re-triage of the open gap records

The grants on these were pulled on 2026-10-30, pending this design.

| Record | Under this design | Action |
|---|---|---|
| #4446 substitution/backtick bodies | unreadable | close as superseded by Phase 1; draft PR #4527 closes with it |
| #4247 shared lexer for nested substitutions | unreadable | close as superseded by Phase 1 |
| #4450 cd -, $OLDPWD, bare cd, cd -P, symlink, failing cd | unresolved cwd | close as superseded by Phase 1 (bare `cd` stays recognised) |
| #4455 zsh-only and variable-built targets | unreadable | close as superseded by Phase 1 |
| #4448 NAME=value / env / sudo prefixes | recognised prefix | becomes a Phase 1 sub-issue; draft PR #4530 is re-scoped to it or closed |
| #4244 compound keywords, builtin prefixes, pushd | recognised (pushd unreadable) | keyword half becomes a Phase 1 sub-issue; prefixes join #4448 |
| #4454 and-or cd walk cost | multi-cwd walk deleted | close with Phase 2 after re-measuring |
| #4451 teardown misses git's bare-name worktree lookup | git's own name lookup, not shell | independent; re-grant now |
| #4452 shadow guard: dropped absolute cd; cp into an existing pipelines dir | cd half unreadable; cp half recognised | split: the cd half closes with Phase 1, the cp half is re-granted |
| #4453 post-tool-use misjudges a commit from a lost cwd | observer posture | absorb into Phase 3 |
| #4447 arithmetic `>` read as a redirect | recognised-shape misread | unchanged, grant kept |
| #4460 quoted `(x` target, `cd>f DIR` | recognised-shape misread | unchanged, grant kept |

A file-overlap scan during decomposition found more open shell-model records than #4475 named:

| Record | Under this design | Action |
|---|---|---|
| #4486 case arm cd hides a write | cd in a conditional → unresolved cwd | close as superseded by Phase 1 (grant pulled 2026-10-30) |
| #4487 function body walked only where defined | function call is an unrecognised word; the body is read at its definition | re-triage at Phase 1 exit; close if Phase 1's tests cover its example (grant pulled 2026-10-30) |
| #4489 deepen the and-or list walk into a case-aware model (needs:decision) | the multi-cwd walk is deleted in Phase 2 | resolve its decision as superseded by this design; close |
| #4309 substitution split by backslash-newline in an unquoted heredoc | substitution body unreadable | close as superseded by Phase 1 |
| #4248 unquoted variable holding whitespace as an ambiguous target | literal-assigned variables stay recognised | keep, narrowed to literal assignments |
| #4211 every target of chained redirects (`echo a>b>c`) | recognised redirect shape | unchanged |
| #4245 command after a backslash-newline continuation | recognised quoting shape | unchanged, grants kept |
| #4246 `<<` inside `${…}` or a same-line `$(… <<EOF)` | recognised heredoc shape | unchanged, grant kept; draft PR #4504 continues |
| #4294 escaped-blank and line-continuation redirect targets | recognised literal target | unchanged, grant kept; draft PR #4507 continues |
| #4310 heredoc reader shadowed by a shell function | recognised heredoc rule | unchanged |
| #4328 quoted, escaped and MSYS-spelled shapes | recognised quoting shapes | unchanged |
| #4329 `"$( #"` perf case 3x over budget | substitution walking deleted in Phase 2 | re-measure and close with Phase 2 |
| #4242 split the bash lexer out of git-command.js | the module shrinks in Phase 2 | Blocked by Phase 2; re-scope to what is left after it |

## Left to the builder

- Where the verdict lives in the scanner's return shape: a field on target entries, or a separate
  list.
- Exact deny wording, within the content rules above.
- PR granularity inside each phase, as long as `npm test` and `npm run test:perf` stay green.
- Which tests are rewritten and which are deleted.

## Acceptance (whole design)

- From a worktree-always main checkout:
  - `cp a "$(pwd)/f"` denies with `gate: 'unreadable', kind: 'substitution'`;
  - `echo $(date)` and `git -C /abs/wt log $(git rev-parse HEAD)` allow;
  - `cd - && cp a f` denies, while `cd - && cp a /abs/wt/f` allows;
  - `T=/main/f.js; cp a $T` and `G=git; $G commit` deny, as today.
- Outside worktree-always, none of these deny.
- A scanner exception or an indeterminate repo status allows.
- Every rewrite a deny message names passes the gate (tested).
- No shipped skill fence newly denies (the conformance test).
- `npm test` and `npm run test:perf` are green after every phase.
- The superseded records are closed, each linked to its covering test.
