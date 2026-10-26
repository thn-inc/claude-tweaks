---
name: parse-signal-discipline
description: Use when writing or reviewing a mechanized deterministic check that parses loose, real-world prose (a plan, a record body, a free-form config value) rather than a formal grammar — the check's "I could not parse this" case must be a distinguishable signal, never silently identical to "this input legitimately does not apply." Also covers a shell-out check whose tool exits non-zero for both "no match" and "could not run", and a probe in skill prose the agent runs, and a start/end snapshot guard around a run. Keywords - snapshot guard, start/end read, parse failure, could-not-parse, deterministic check, prose heuristic, silent null, false negative, mechanized check, plan-audit, exit code, git grep, skill-prose probe, fail closed.
---

# Parse-Signal Discipline — Distinguish "Couldn't Parse" From "Doesn't Apply"

A deterministic check that mechanizes a hand-run prose heuristic — grepping a plan for a
verification command, reading a record body for a metadata line, scanning free-form config for a
keyword — is not parsing a formal grammar. Real inputs vary in ways the check's author didn't
anticipate. When the check hits an input it cannot confidently parse, that outcome must be
distinguishable from "this input legitimately does not need this check" — collapsing both into one
`null`/skip return turns an unparseable input into a silent false negative: the check reports
nothing, and nothing downstream ever learns the check didn't actually run.

## The anti-pattern

A function returns the same falsy value (`null`, `undefined`, `[]`, `false`) for two genuinely
different situations:

1. **Doesn't apply.** The input correctly has nothing for this check to find — e.g. a task with no
   Step 2 sub-step at all.
2. **Couldn't parse.** The input has the shape the check is looking for, but malformed or
   incomplete — e.g. a Step 2 heading present, but with no matching `Run:`/`Expected:` pair
   underneath it.

A caller that only ever sees the merged falsy value cannot tell these apart, so it always takes the
"doesn't apply" branch — even when the real story is "this input needed checking and the checker
gave up silently."

## Worked example: `extractStep2Verification`

`plugin/bin/lib/plan-audit/parser.js`'s `extractStep2Verification` (from #903's
`plan-audit.js` Check C) is the concrete case this rule generalizes from — surfaced during #903's
own review/hindsight pass as ledger item 19, building on
ledger item 18's finding about the same function. Its own code comment states the collapse
explicitly:

> Returns null when the task carries no Step 2 (or no Run:/Expected: pair under it) — a non-code
> task, per plan-audit.md's Check C.

Both "no Step 2 at all" (doesn't apply — a documentation-only task has no verification command to
check) and "Step 2 exists but has no parseable Run:/Expected: pair" (couldn't parse — a malformed
task that *should* have a verification command) return the identical `null`. Check C's caller
(`extractVerificationChecks`) filters on that `null` and moves on either way, so a task whose
Step 2 was simply malformed silently drops out of Check C's audit with no warning — exactly a false
negative, not a caught gap.

(Note: the record that requested this skill named the function `parseStep2`, which does not exist
anywhere in this repo — the real name is `extractStep2Verification`. This citation uses the
verified name; treat any reference to `parseStep2` elsewhere as the same stale-name drift.)

## Two more worked examples, both from the composer run (#1988, #1997)

The `extractStep2Verification` case above is the anti-pattern. These two are the rule applied
correctly, in opposite directions — one refuses to merge at the parser, one refuses to merge at the
reporter.

- **Refuse at the parser: a marker-shaped line is never content.** `plugin/bin/lib/compose-context/compose.js`'s
  `CANDIDATE_RE` (`/^\s*<!--\s*(?:when:|\/when\b)/`) splits the input into "not a marker at all"
  and "starts like a marker". Only the first is text; a line matching `CANDIDATE_RE` that then
  fails `OPEN_RE`/`CLOSE_RE`, or carries a key/value outside `VOCAB`, or nests past `MAX_DEPTH`,
  throws a `MarkerError` naming the file and line rather than falling through to
  `tokens.push({type: 'text'})`. The comment above the constant states the split as the contract:
  *"A line that starts like a marker is either a valid open/close or a malformed marker — never
  content."* That is the fix shape's step 1 realized as a hard error instead of a tagged result:
  legitimate for this parser because the caller (`bin/compose-context.js`) has a real place to put
  it — exit 2 with `file:line` on stderr, nothing written, any prior bundle left untouched.
  Silently treating a typo'd `<!-- when: mdoe=auto -->` as prose would compose the wrong branch
  into a bundle a skill step then reads as authoritative.
- **Refuse at the reporter: "could not measure" is not "does not apply".** `plugin/bin/lib/plan-audit/checks.js`'s
  `composedHeadroom` has three outcomes where the pre-#1997 code had two. A row with no `sources`
  is genuine non-applicability (parsing never reached a source list) and is `continue`-d — the fix
  shape's step 3. A row that *does* carry `sources` but also an `error` (missing source, unreadable
  source, malformed marker) is a call site the plan touches that the tool could not measure, and it
  goes to a separate `composedErrors` array with its `step`/`file`/`line`. The report itself
  throwing is one `composedErrors` row with `step: null` — never an empty result that reads as
  "nothing to report" (`[IL-146]`'s silent-fallback shape). Note the reporting posture:
  `composedErrors` never gates `ok`, which stays keyed off `composed`/`breaches` — the fix shape's
  step 2 says *surface it*, not *block on it*.

## The fix shape

When mechanizing a prose heuristic into a deterministic check:

1. **Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't
   apply" — e.g. a tagged result (`{status: 'not-applicable'} | {status: 'unparseable', reason}
   | {status: 'ok', value}`), a sentinel distinct from your "doesn't apply" value, or a thrown/
   caught error the caller handles separately. Never reuse the same `null`/`undefined`/`[]` for
   both.
2. **Surface the unparseable case as a warning**, not a silent skip — the caller (or the check's own
   output) should name which input it could not confidently parse, so a human or a later pass can
   look at it, rather than the input silently vanishing from the audit's results.
3. **Reserve the merged-falsy shortcut for genuine non-applicability only** — it's fine for a check
   to return one clean "nothing here" value when the input plainly doesn't have the shape the check
   looks for at all (e.g. no Step 2 heading whatsoever). The risk is specifically when the input
   has *some* of the expected shape but not enough to parse confidently — that's the case that
   needs its own signal.
4. **An optional declaration file that was never read is the same collapse, one level up.** The rule
   is not confined to a parser's return value: any check whose allowlist, threshold, or exclusion
   set comes from an *optional* config file owes the same distinction between "no declaration was
   read at all" and "the declaration was read and lists none". `plugin/bin/verify.js`'s count-stamp
   block (#1925) passes `decl ? decl.flaky.files : null` into `nextFlakyHits` and says why in a
   comment beside it — an `[]` there would have meant "the allowlist is empty", so a run without
   `--scope` (or with `--scope` pointing at a missing file) silently wiped every accumulated
   `flakyHits` count instead of carrying them forward untouched. That defect shipped, and the
   whole-branch review caught it by running the CLI twice — once with a declaration, once without —
   and diffing the stamp. Pass `null`, or another shape the callee branches on explicitly; never the
   same empty collection the populated-but-empty case produces.
5. **A comparison between two fallibly-read values owes the "couldn't read" guard on every operand,
   not just one.** The rule reaches past parsing to any classifier that compares inputs it had to
   read, each of which comes back `null` when the read fails. An equality check turns an unread
   side into a confident verdict: `null === 'anchor text'` reports "different", and `null === null`
   would report "identical". `plugin/bin/lib/console/resolve.js`'s `classifyStagedItem` (#2773)
   compares a `.shadow-dup` copy's text against its anchor's and has three outcomes:
   `shadow-dup-duplicate`, `shadow-dup-divergent`, and the conservative `shadow-dup-collision` when
   it can't tell. The first version guarded only the anchor's `siblingText`. A shadow copy whose
   own read failed, while its anchor read fine, reached the comparison and came back
   `shadow-dup-divergent`. Whole-branch review caught it, and `116707a7a` added the guard on `text`
   too. Write the guard over every operand before the comparison, and pin the one-side-unreadable
   case with its own test assertion, because tests that only cover "both readable" and "neither
   supplied" pass with the one-sided guard.
6. **A positive recogniser owes a whole-input match, not a prefix match.** When "recognised" is the
   outcome that relaxes a safety classification, a start-anchored pattern lets a truncated or
   tail-carrying input read as recognised: the couldn't-parse case hides inside the accepted one.
   `plugin/bin/lib/log-decision/claim-log.js`'s `isClaimLogEntry` (#2861) decides whether a
   `decisions.md` line is one of Step 2.8's claim-log lines, and a file holding only those lines
   reads as a freshly minted run directory. Its first version tested the action text against a
   start-anchored pattern, so a claim line cut mid-write and a claim prefix with another decision
   behind it both classified `claim-log-only`. The build's tests covered whole-line junk and passed.
   Review caught it, and `c610df577` anchored the pattern at both ends, including the suffix the
   writer always appends. Anchor both ends against what the writer emits, and pin a truncated copy
   and a tail-carrying copy of an accepted input with their own assertions. A recogniser that
   scans a shared narrative log owes one step before the anchors: parse each line with the
   writer's own inverse and require the expected step. `plugin/bin/lib/dispatch/merge-verdict.js`
   (#2941) decides whether a merge-check pass was logged in `decisions.md`, which many skills
   narrate into. Its first version matched the marker anywhere in a line, so a review write-up
   quoting it counted as a pass and overrode a later `needs-human`. It now reads only
   `parseEntry` entries under the verdict steps, anchors the pass at both ends, and reads any
   other pass-shaped action as `unparsed`.
   Widening a writer's output shape strands the recognisers anchored to the old shape. #2869 let
   `log-decision.js --reversibility` carry a trailing ` (qualifier)`, while `claim-log.js`'s
   `ACTION_RE` (`[^.\s][^.]*`, so a qualifier containing `.` reads as unrecognised) and
   `merge-verdict.js`'s bare-tier pass pattern stay anchored to the bare tier. Both fail safe
   today because their writers still pass bare tiers. When you widen a writer, grep every
   recogniser of its lines and either widen it with the writer or record why it stays narrow.
   #3870 then widened `merge-verdict.js`'s pass pattern and `claim-log.js`'s `COMPLETE_RE`, and
   two things went wrong on the way. Widening the pass pattern to a free-text group (`\(.+\)`)
   let a tail ride behind the note (`... (x). trailing narrative`), reopening the hole its end
   anchor had closed. Exclude the group's own boundary sequence (`). `) from its content, and
   pin a tail-after-group copy. Separately, the plan's recogniser inventory cleared `claim-log.js`
   on `ACTION_RE`'s property (its writer passes a bare tier) while the same file's `COMPLETE_RE`
   reads lines the model writes with any tier. Whole-branch review caught it. Inventory
   recognisers per regex, not per file, and name each one's writer.
   A fuzzy text match is the same leak with no anchor at all. `plugin/bin/lib/plan-audit/checks.js`'s
   Check E (#3099) reads an acceptance-criterion clause as `covered` when the plan quotes its text.
   Its first version was a bare substring `includes()`, so the one-word clause "Last." read as
   covered by a test step about "the blast radius". Whole-branch review caught it, and `d9351cbee`
   added `quoteMatchesWholeWord`: a clause under three words is never matched by its text, and a
   longer one must match on a word boundary at both ends. Give a text-match recogniser a minimum
   length and a boundary at each end, and pin a short input hidden inside a longer word.
   Lifting a lenient reader's predicate to widen a recogniser imports that reader's looseness.
   #3665 let `classifyDecisions` count a model-worded claim line by calling
   `paraphrasedClaimNumbers`, which accepts a bare "claimed #N" anywhere in an `AUTO` line. A
   later-step line such as `Step 3: config.yml written; claims-registry shows #7 claimed.` then read
   as a claim, so a run directory that had moved past the claim step still classified as a fresh
   mint. Whole-branch review caught it, and `59e200225` anchored the paraphrase on the parsed
   entry's location (the head text only for a `log-decision`-located or unparseable line). When a
   fail-closed classifier needs a lenient reader's recognition, anchor on a field the writer
   controls, such as the entry's location, never on words a later line can repeat, and pin a
   later-step line that merely mentions the thing.
7. **A parsed list that feeds a pass verdict owes an independent count to reconcile against.** An
   extractor that returns N items cannot say it missed one more, so an undercount reads exactly
   like a complete list. That is the same silent false negative as a merged `null`, one level up.
   `plugin/bin/lib/verify/baseline.js`'s `adjudicate` (#3043) may turn a failing test run into a
   pass only when its extracted failing files account for the whole failure, so it checks them
   against counts the log states separately. For spec output, the `test at` entries
   (`specEntryCount`) must equal the summary's `ℹ fail N` plus `ℹ cancelled N`, since the spec
   reporter lists a cancelled test that `ℹ fail` leaves out. In spec and TAP output, every failing
   entry or `not ok` block must name a test file (`countUnmatchedFailures` returns 0). An output
   family with no such cross-check is refused outright ("has no failure-accounting guard"). Each
   mismatch returns `{eligible: false, reason}` naming both numbers, never a verdict over the
   files it did find. When no independent count exists for an input, the list cannot gate a pass.
8. **A shell-out check owes a branch on the exit code when the tool's "no result" and "could not
   run" both print nothing.** `grep` exits 1 for no match and 2 for an error; `git grep` exits 1
   for no match and 128 when it cannot run. Reading empty output as "no match" collapses the two.
   /tidy's plan citation check (#3101, `plugin/skills/tidy/scan-procedures.md`'s "Citation check
   before any plan Delete") first did exactly that on an irreversible Delete path: a `git grep`
   that could not run read as "uncited". Review caught it, and `c753dc11b` made exit 1 the only
   "no citation" result, with any other non-zero exit keeping the plan as cited-unverified.
   Branch on the exit code, not the output, and on a destructive path make the failure arm fail
   closed.
9. **A probe that skill prose tells the agent to run owes the same split, and two things break it
   that a code check never meets.** Each Bash tool call starts a fresh shell, so a variable an
   earlier call set is unset in the probe's call: the probe reads an empty path and reports the
   benign "absent". Resolve every path inside the snippet itself. And the probe can fail outright
   (non-zero exit, no output, output that does not parse), so the prose needs an explicit branch
   for that case, routed to the could-not-tell report and never left to fall through to the benign
   one. `plugin/skills/dispatch/exclusions-unreadable-report.md` (#3104) slipped on both, one
   review round each: its probe first read `$DISPATCH_EXCLUSIONS` from an earlier call
   (`aab721418` made it resolve the session-tmp path itself), and then it had no branch for a
   failed probe (`39129d212` added one that reports "exclusion reason unknown").
   `plugin/skills/reflect/SKILL.md`'s integration-branch probe (#3987) slipped on the same split
   a third way (#4069, PR #4160). Its could-not-run list named only a missing `origin` and a file
   outside the repository, so a failed `git fetch` left a stale `origin/{integration-branch}` that
   the next `git grep` or `git log -S` read as "absent", and a `git grep` exit 128 was never split
   from exit 1. A refresh step whose failure leaves old data is a could-not-run for every probe
   after it. Name each tool's own no-match signal as well: `git grep` exits 1, but `git log -S`
   exits 0 with no output, so an exit-code branch alone cannot call that one.
   `tests/reflect-integration-branch-probe.test.js` pins the clause, and removing either the fetch
   clause or the `-e` form turns it red.
10. **A helper's can't-tell answer is safe only for the caller it was written for.** A new caller
   that reads the same answer in the opposite direction has to guard the input itself.
   `plugin/bin/lib/issues/claims.js`'s `isStale` answers `false` whenever it cannot tell. An
   unparseable `claimedAt` returns `false`, and a non-finite `now` makes
   `now >= t + ttl * 3600 * 1000` false as well. For claim takeover that is the fail-closed
   direction: "not stale" means never reclaim. `/specify`'s near-duplicate refusal (#3141) reads
   the same answer the other way. To it, "not stale" means `live`, and a live claim refuses
   shaping. So with no real clock, every expired claim would have refused a record.
   `buildShapingState` in `plugin/bin/lib/issues/near-duplicate.js` now checks
   `Number.isFinite(now)` before it classifies any claim, and it reads every claim as not live
   without one. Review caught the gap (`dc802bb9d`). Before you reuse a decide-from-state helper,
   find out which way its can't-tell answer leans. If that is the unsafe direction for your
   caller, guard the input at your call site rather than flipping the shared helper's default.
   Pin each invalid input with its own assertion: `NaN`, `undefined` and `null` all slip past
   a `>=` comparison.
11. **A raw fs read's error code owes the same split as a shell-out's exit code (item 8), one level
    lower.** `fs.readdirSync` throwing `ENOENT` ("this path doesn't exist") and throwing anything
    else (`EACCES`, `ENOTDIR`, `EIO`, a transient I/O hiccup) are not the same signal: the first is
    genuine non-applicability, the second is "couldn't tell." `plugin/bin/lib/reconcile/archive-merged.js`'s
    `hasStagedItems` (#3249) — the one function the #657/#1130 protection's "don't silently archive
    a run with pending staged decisions" guarantee rests on — caught every error the same way and
    returned `false` ("nothing staged") either way, so an unreadable `staged/` directory read
    identically to a genuinely absent one and unlocked an archive path meant only for the latter.
    Review caught it (two independently-dispatched lenses, reproduced without seeing each other's
    output) and the fix branches on `err.code !== 'ENOENT'`, failing closed (`true`, "treat as
    pending") on anything else — mirroring `readConsoleState`'s own fail-closed catch two functions
    above it in the same file, which this fix's catch previously disagreed with. Pin the non-ENOENT
    case with its own fixture (a plain file sitting where a directory is expected, producing
    `ENOTDIR`), the same way item 6 pins a truncated/tail-carrying input — a fixture that only
    exercises the absent-directory case cannot discriminate this fix from the pre-fix code.
12. **A check that passes when its input is absent turns silent once an earlier transition clears
   that input.** It cannot tell "this run never had one" from "a step before me erased it".
   `plugin/bin/lib/wrap-up/engine-verify.js`'s `worktree-removed` (#3023) fails when the run's
   recorded worktree path still exists on disk, because `git worktree list` dropping the entry
   proves only that the registration went, not the directory. Its first version read that path
   from `run-state.json`'s `worktree`, which `closeRunState` nulls, and every sanctioned removal
   path closes the run first, so in the real flow the disk check never fired. Every test passed
   because each fixture hand-wrote a run state with `worktree` still set, a state `closeRunState`
   never writes. Whole-branch review caught it by running the real `closeRunState` and then
   `runVerify`. `5c8e2a2e0` (#3023) made the close keep the prior path as `worktreeAtClose` and
   added a test that builds the state through the real `closeRunState`. When a terminal transition clears
   a field your check reads, keep a copy at that transition, and produce the check's input in at
   least one test by calling the real writer, never by hand-writing its JSON.
13. **A not-found answer means "absent" only when every input to the request resolved.** A
    lookup built from an input that failed to resolve asks about a resource that cannot exist,
    and its 404 is identical to the benign one. `plugin/bin/lib/issues/claim-store.js`'s
    `readClaimBlobContentsApi` builds `` `repos/${repoSlug}/contents/…` `` and maps a 404 to
    `absent: true`. In #3278's neighbour-in-flight pass (`plugin/skills/dispatch/queue-pull-script.md`),
    a failed `gh repo view` left `slug` null behind a bare `catch {}`, the git read failed too, and
    the fallback asked GitHub for `repos/null/…`. The 404 read as `absent`, so a record holding a
    live claim counted as not in flight. Review caught it, and the reader now returns
    `{ failure: 'repo-slug-unresolved' }` for an unset slug on any answer that did not come from
    git, so the record lands in `unreadable` and the AUTO line names it. Check every interpolated
    input before trusting a not-found status, and route an unresolved one to the could-not-tell
    branch. #3393 then moved both skill heredocs (`specify/shaping-mode.md` and
    `dispatch/queue-pull-script.md`) onto `claim-store.js`'s `createClaimReader`, which owns the slug
    resolution, so a new claim read calls it rather than hand-building the chain, and
    `grep -rn 'readClaimBlob(' plugin/skills/` should stay empty. A reader copied from a sibling
    call site still carries the sibling's gap, so grep for other copies before fixing one.
    A found answer has the same hole when the unresolved input is a filter: an empty filter value
    drops the filter, so the lookup returns everything and reads as a confident match.
    `_shared/worktree-setup.md`'s merged-branch precondition (#3572) asks
    `gh pr list --head "{current-branch}" --state merged --json number --jq length` whether the
    branch's PR merged. On a detached HEAD `git branch --show-current` prints nothing, and
    `--head ""` prints `30` (the default page size) with exit 0, so a clean detached worktree read
    as merged. The task review missed it, a review lens caught it, and the fix skips the lookup when
    the branch name is empty. Check that every interpolated filter is non-empty before trusting
    a match count, and route an empty one to the could-not-tell branch or skip that check.
14. **A lenient reader in front of a strict validator turns "couldn't parse" into "not
    configured".** A free-form policy value can go wrong in two ways before it reaches the check
    that would reject it loudly. The parser can keep whitespace the writer never meant, so a
    well-formed entry matches nothing. Or a schema resolver can map an invalid value to its
    default, so a typo reads as "key unset". #3298 shipped both. `plugin/bin/lib/commit-scope.js`'s
    `parseScopePaths` split each `commit-scope-paths` entry on its first `=` without trimming, so
    `plugin/bin/ = bin` produced the prefix `plugin/bin/ `, which no changed path starts with: zero
    matches, a silent fall-through to the constant. `plugin/bin/lib/policy.js`'s `readCommitScope`
    first read `commit-scope` through `resolveValue`, which returns the key's default (unset) for a
    whitespace-bearing value, so `web app` became `null` and the merge subject went out unscoped
    with no signal. Whole-branch review caught both. `parseScopePaths` now trims both sides of the
    `=`, and `readCommitScope` returns the raw trimmed value so `composeSubject`'s token check
    rejects a bad one with exit 1. Normalize at the parser, hand the raw value to the validator
    that fails loudly, and pin each with its own test: a spaced `prefix = token` entry that must
    match, and a whitespace-bearing value that must exit non-zero. A schema resolver that falls
    back to a default on an invalid value is not the hard error "When not to use" exempts.
15. **A transform in front of a scanner owes its own could-not-parse verdict.** A scan over
    transformed text reads whatever the transform wrongly removed as "nothing here", so a
    transform that mis-parses produces a clean scan. `tests/helpers/strip-comments.js`'s
    `stripComments` blanks comments to spaces before its callers' scans count tokens. Its
    callers, by test-file stem: `backfill-cli`, `exit-code`, `git-status-optional-locks`,
    `hooks-harness-refusal`, `owner-pid-probe`, `path-containment`, `path-guard`, `phase-exit-call-sites`, `porcelain-cwd-compare`,
    `raw-markdown-read`, `run-liveness-callers`, `staged-id-producers`, `subprocess-timing`, `wall-clock-budget` and
    `windows-hide-spawn`.
    `tests/strip-comments-callers-twin.test.js` pins this list and the helper header's to the
    tree. It models regex literals (#3585); its residual
    ambiguity is a regex right after `)` or `}`, which it reads as division. In
    `if (b) /"/.test(b); const c = "//"; fs.existsSync(c);` the quote inside the regex pairs with a
    later string, the `//` after it opens a line comment, and the guarded call counted as zero.
    `stripperVerdict` (#3573) checks the transform with an oracle the raw input already passes: it
    compiles both the raw file and the stripped text under a CommonJS wrapper with `vm.Script`. A
    blanked comment never breaks syntax, but blanked code cuts a literal short. So "raw compiles,
    stripped does not" is `misparsed`, and a raw file that does not compile at all (an ESM file) is
    `unparseable`, its own outcome and never `ok`. Every scan except exit-code reports either one
    as an offender. The exit-code scan never calls `stripperVerdict`; it reports a `require.main`
    guard the stripper blanked, through its own `guardBlankedByStripper(raw, stripped)` detector.
    State what the oracle cannot see, as the helper's header does: a mis-parse whose stripped text
    still compiles passes unseen. Pin the planted mis-parse through every scan that calls the
    verdict, not only through the helper's own tests.
    To settle how accurate the heuristic transform is, measure it against an exact parser that is
    run offline from a scratch install and never added as a dependency. #3585 compared the
    stripper's output with `acorn` 8.14.0's comment ranges, byte for byte over the real corpus:
    the differing `plugin/bin` files went from 23 to 0, and 0 of the 1,275 corpus files differed.
    That turned "accurate enough" from a judgment into a count. Pair the comparison with a mutation
    check on every branch the corpus does not reach. A `${}` brace-depth mutant survived both
    every unit test and the whole corpus, so the corpus count says nothing about those branches.
    A transform that bounds its own work owes a stated answer for the pass that hits the bound.
    `plugin/bin/lib/hooks/git-command.js`'s heredoc scanner (#4149) caps nesting at
    `NEST_LEVEL_CAP` and a pass's nested scans at `NEST_STEPS_PER_CHAR` steps per input character
    plus `NEST_STEPS_FLOOR`, and its two capped outcomes lean opposite ways.
    `lineLeavesStructureOpen` reads a capped span as a line left open, so every later body stays
    visible (fail closed). `scanPass` reads a capped pass again whole in the flat, pre-#4149 quote
    reading and reports no could-not-parse verdict. The #4149 build accepted that divergence from
    this item as a tradeoff; it is not a shape to copy. The scanner's first capped version fell
    back to the flat reading partway through a pass, and a reading that switches partway pairs
    quotes unlike either reading, which can hide a separator both see (`246d40909`). Prefer the fail-closed
    verdict. Where a capped pass must fall back instead, re-read the whole pass in one reading,
    state the fallback's direction in the code comment, and pin a nest past the cap with its own
    case (`tests/hooks-gate-coverage.test.js`'s "a nest past the cap whose fallback would restart
    the nested reading").
16. **A precondition probe does not cover the main probe's own failure to run.** Some tools exit
    with one code for both "not found" and "could not run", so item 8's exit-code branch has
    nothing to split on: `git cat-file -e HEAD:<path>` exits 128 for a path missing from HEAD and
    128 again outside a repository. `plugin/bin/verify-run-bookends.js`'s `materialize` bookend
    (#2912) asks whether each target's `work/{n}-spec.md` is committed at the worktree's HEAD. Its
    first version handled the shared 128 with a second probe — `rev-parse --verify HEAD` had to
    succeed before a failed `cat-file` read as "not committed" — which guarded a broken repository.
    But its helper returned `false` for every throw, so a `cat-file` that timed out, followed by a
    `rev-parse` that succeeded, still reported the spec as not committed. Review caught it, and
    `gitProbe` now returns `null` when git never answered (`err.signal` set, or a string `err.code`
    such as `ETIMEDOUT` or `ENOENT`; a non-zero exit carries only a numeric `status`), and any
    `null` makes `isSpecCommitted` report `undetermined`. Give every probe its own could-not-run
    arm, classified by the thrown error's shape, and pin "main probe times out, precondition probe
    succeeds" with its own assertion (`tests/verify-run-bookends.test.js`'s
    `catFileTimeoutRevParseOk`).
17. **A start/end snapshot guard sees only the window between its two reads, and each value it
    records has an unsafe direction.** `plugin/bin/verify.js` (#3757) reads `gitInfo()` before the
    `--scope` selection and `runChecks` and again at the end, and writes no pass stamp when HEAD
    moved in between. Its first version took the end read straight after `runChecks`, but
    `--baseline` adjudication and declared pre-existing adjudication run later and re-run failing
    files against the tree, so a commit landing during them read as "not moved". Review caught it,
    and the fix moved the end read after both adjudications. Place the second read after the
    last phase that executes against the tree, not after the phase the record names. The same
    version recorded `dirty` from the end read alone. Clean to dirty mid-run (a check leaves an
    artifact) is safe to record, but dirty to clean (an edit reverted mid-run) stamped a clean
    tree the checks never saw, so the stamp now records start OR end. For each recorded value,
    name the direction that would wrongly vouch for the run and record it if either read shows
    it. A read that failed (`gitInfo` returns `dirty: null` when `git status` fails) counts as
    that direction too, per item 5, never as the other read's answer. Pin a commit landing during
    the last tree-executing phase, and a mid-run revert, each with its own test.
18. **A composer's validator owes its readers' skip set, and a batch producer owes the predicate,
    not the throw.** When one module writes text another module parses back, every value the
    reader silently skips must be one the writer rejects. Otherwise a value accepted when the
    record is composed vanishes when it is read, and nothing reports it.
    `plugin/bin/lib/issues/record.js`'s `specShapedBody` renders `keyFiles` (#2975) as a
    `### Key Files` list that `/build`'s micro-plan gate and `grouping.js`'s file-overlap checks
    read. Only `grouping.js` skips a trailing-slash entry (a bare directory, #1420) with no
    warning: `file.endsWith('/')` in `groupByFileOverlap`, `directOverlaps` and
    `detectCrossPRFileOverlap`'s `isSignal`. The micro-plan gate counts every listed path except
    tests and docs, so a directory entry there counts as an implementation file. The first
    `keyFilePathProblem` accepted `'tests/'`. Review caught it, and `090359172` (#2975) rejects a trailing
    slash or backslash as `'shape'`. Build the reject list from the readers' `continue` and
    `return false` branches, not from what looks malformed, and pin each one with its own
    assertion. The throw suits a hand-written caller. But the four health-sweep
    composers fill `keyFiles` from LLM judge output, one finding after another in one run, and a
    throw on one finding aborts the rest. So `record.js` exports the throw's own predicate,
    `isRepoRelativeKeyFilePath`, and each producer calls it and omits `keyFiles` on failure. The
    record still files, without the optional section. The omission leans safe in item 10's sense:
    a record with no Key Files falls through to `/build`'s full planning. Export the predicate the
    throw already uses rather than re-implementing it in the producer, where the two would drift.
    Normalize before calling it, and read what each producer does from its own code, because the
    four differ. `code-health/issue-payload.js` strips an anchor's `#symbol` suffix and trims
    (`String(anchor).split('#')[0].trim()`). `harness-health/issue-payload.js` resolves
    `finding.path` against `options.repoRoot` and rewrites it as a `/`-joined repo-relative path
    with `path.relative`, so an out-of-repo target such as a memory file fails the predicate on its
    `..` segment. `docs-health/issue-payload.js` and `journey-health/issue-payload.js` do no
    normalizing of their own: each passes a path it assembled itself
    (`` `docs/${finding.target}.md` ``, `` `docs/journeys/${finding.journey}.md` ``), so the
    LLM-supplied `target` or `journey` is checked inside a fixed prefix and suffix, and only an
    embedded `..` segment, backtick or line break can fail it. A new producer states its own
    normalization from where its path comes from.
19. **An enumerated list of failure channels reads every unlisted channel as "none"; a positive
    recogniser at the tail closes that class, but only once the legitimate endings are captured.**
    `plugin/bin/lib/verify/extract.js`'s `summaryUnattributedCount` (#3480) accounts a jest or
    vitest log by listing the channels that count as unattributed. The list was incomplete three
    times in one build, each channel found only by reading runner source or capturing a real log,
    and every miss read as a false 0, the unsafe direction for a flaky retry or a `preExisting`
    waiver. #3674 added the positive twin for jest: `endsLikeNormalJestRun` counts the log as
    unattributed unless its last line is `Ran all test suites…` or a `--silent` run's `Time:`
    line, optionally followed by a captured yarn or pnpm failure trailer. It fires only when no
    enumerated channel already counted, so one failure is never counted twice. The first version
    accepted only the trailer and over-refused every `--silent` and yarn/pnpm project. The
    whole-branch review caught it from `SummaryReporter.js`, and each accepted ending now has a
    captured fixture. Capture every real ending from the runner before shipping the guard, and keep
    the enumerated list where no stable ending exists: vitest writes its summary to stdout and its
    failure blocks to stderr, so either can end a piped log. The recogniser is a backstop behind
    the list, not a replacement for it.
20. **An all-of guard passes vacuously on an empty set, and skill prose owes the at-least-one
    clause as much as code does.** `[].every(p)` is `true`, and an agent told "every record carries
    the label" reads zero records the same way. tidy's `## Arm ready PR` acceptance-labeling guard
    (#3877, `plugin/skills/tidy/actions-github-issues.md`) first counted labeling as landed when
    "every record in the PR's `Fixes` lines carries `demo:pending`": an empty `Fixes` set satisfied
    it, a failed label or `verify.json` read had no stated outcome, and its log command left
    `{command}` and the `--run` target undefined. Review caught all of it, and the fix requires at
    least one record and every read to succeed ("an empty `Fixes` set or a failed read shows
    nothing"), holds on any failed read with an `unreadable: {…}` reason from a closed `{reason}`
    set, and defines each placeholder. When writing an all-of guard, in code or in prose, state
    the empty-set answer and make it the fail-closed one, give each read its could-not-tell arm
    (item 9), and define every placeholder the reported text interpolates. Then pin each of those
    edge clauses, not just the rule text, inside the region the suite's strip-the-guard negative
    control removes, so the control proves each pin can go red: the first version's pins named the
    rule and none of its edges (`GUARD_PINS` in
    `tests/tidy-arm-ready-pr-acceptance-guard.test.js`).
21. **A shared reader that already folded "could not ask" into its answer shape hands that fold to
    every wrapper, so a verdict built on tagged probes must distrust the readers under them.**
    `plugin/bin/lib/run-liveness/` (#3973) tags every probe positive, negative or error so that an
    unanswered question can only push the verdict toward `unknown`, and the whole-branch review
    still found three readers beneath it that answered in the wrong shape: `readRunState` returns
    `null` for an absent file and for a corrupt one alike, so a damaged `run-state.json` read as a
    legacy run and the legacy route could say `dead`; `isPidAlive` returns `false` for `ESRCH` and
    also for the `ERR_INVALID_ARG_TYPE` that `process.kill` throws on a pid above int32, so an
    unprovable pid became the death witness `gone`; and a worktree-lock lookup returned "free"
    when `git worktree list` had no entry for a directory the caller had already established
    exists. The SDD reviews had caught four siblings of the same class earlier in that build
    (`existsSync` reading `EACCES` as absent, a failed `git log` read as no commits, a `NaN` age
    read as old, a null start-time probe read as pid reuse). Before wrapping a shared reader or
    liveness primitive in a verdict whose negative branch is destructive, ask of each one whether
    its falsy answer can also mean "could not ask". Read the file directly where only `ENOENT`
    means absent (item 11), bound the domain a primitive can answer before treating its `false` as
    evidence, and throw on a lookup miss the caller's own precondition says cannot happen. Pin
    each with a fixture the pre-fix code fails (`tests/bin-lib/run-liveness/index.test.js`,
    `probes.test.js`).
    The reverse holds for a new consumer of such a verdict: a probe whose subject is a resource
    many runs share answers for all of them, so its positive evidence can hold every real input at
    `unknown`, and a sweep that acts only on `dead` then never fires and reports nothing. #4179's
    premise probe ran `runLiveness` over the 30 main-checkout ad-hoc dirs on disk and got 30/30
    `unknown`, because the `worktree-lock` and `last-commit` probes read the main checkout every
    session shares. `plugin/bin/lib/reconcile/archive-merged.js`'s `adHocSessionLiveness`
    therefore forces the `pathType` probe to `missing`, after which 19 of the 30 read `dead`.
    Before wiring a verdict to a destructive consumer, measure its distribution over real inputs,
    neutralise each probe whose subject is not the consumer's subject, and pin the production
    default with a real fixture as well as an injected stub (`tests/reconcile.test.js`'s
    production-default liveness case).
    The predicate that decides when to neutralise a probe owes the same audit, and widening its
    inputs reopens it. #4421 lifted `isMainCheckoutAdHoc`'s path comparison into
    `recordedWorktreeIsMainCheckout` so `defaultRunVerdict` could force `pathType` to `missing` for
    any run dir stamped with the main checkout. A `true` there drops the lock and commit evidence,
    the direction that leans toward `dead` and archival. Neither version rejected a relative
    `worktree`, but only ad-hoc dirs reached the old one; with any run dir in scope, the path
    resolved against the process cwd, so reconcile run from the main checkout read `.` as the main
    checkout. Review caught it, and `923539cee` returns `false` for a non-absolute path. When a
    predicate gains callers or a wider input set, re-audit its input validation against the new
    domain, and pin each newly reachable input (here a relative path under `process.chdir` to the
    root it would falsely match).
    A test that pins a caller *not* consulting the verdict, or ignoring some of its probes, goes
    red only when its fixture makes the verdict disagree with the caller's answer. #4419's
    crash-resume adoption test first built a run `runLiveness` read as `live` (a fake host blocked
    the pid witness, the worktree commit was fresh, no events.jsonl), so an `adoptionRefusal` that
    started refusing dead runs would still have passed it. The fix asserts
    `runLiveness(crashed).verdict === 'dead'` before the adoption assertions
    (`tests/hooks-run-dir-resolve.test.js`), and #4420's real-probe case asserts the heartbeat and
    owner-pid entries read `positive` before asserting the resume still goes through
    (`tests/hooks-resume-freshness.test.js`). Assert the verdict's reading of the fixture as a
    precondition, then revert to a consulting version and watch the test go red.
22. **A check that reads its input from an optional context argument owes a fail-closed answer
    when the row it gates is present and the context is not.** A pure decision function that
    takes `ctx = {}` and wraps a check in `if (ctx.x present)` reads "the caller passed nothing" as
    "nothing to check", so the row the check guards goes through. `plugin/bin/lib/reconcile/console-execute.js`'s
    `decideConsoleExecute` had two such guards. #1802's merge-grant gate left `mergeGrantGap: null`,
    which `_shared/console-execution.md` documents as "every member is granted", whenever
    `prBody` or `memberGrants` was missing. #3880's ruling gate copied that shape, so an absent
    `rulingTexts` map auto-ratified every ruling row while a map missing one id withheld it. Both
    stayed open on purpose so pre-feature tests that omit `ctx` kept passing, and two tests pinned
    the open path as "legacy call shape unchanged". The only production caller always supplied
    both, so neither was live. A review lens flagged only the ruling guard, and #4048 closed both:
    an absent context now withholds (`{ member: null, reason: 'grant-context-missing' }`, and
    `sdd-ruling-unclassified` for each ruling row), while a console with neither row kind still
    needs no `ctx`. Key the check on whether the gated row is present, never on whether its
    context arrived. Invert any test that pins the open path rather than keeping it for
    compatibility, and pin a partial context (one of two required keys) with its own assertion
    (`tests/console-execute.test.js`). When you find one guard of this shape, read every sibling
    guard in the same function, because a new guard is usually copied from the one beside it.
23. **Failing closed does not excuse folding "could not read" into "read, but unclassifiable".
    The reason a withheld item carries is what the human acts on.**
    `plugin/bin/lib/reconcile/console-execute.js`'s `readInsideRunDir` (#3880) returned one `null`
    for a missing `stagedPath`, a rejected path, a missing file and a failed read, and
    `plugin/bin/lib/console/resolve.js`'s `readSnapshot` did the same through `readText`. Both fed
    that `null` to `sddRulingDeferralReason`, which maps it to `sdd-ruling-unclassified`, the reason
    for a header with no valid `Defers:` line. Every row was still withheld, so nothing unsafe
    shipped, but a reviewer told to fix the header could be facing a missing file or a planted
    symlink escaping the run dir. A review's can't-tell finding became #4049, which added
    `sdd-ruling-unreadable`. `readInsideRunDir` now returns `{ text } | { error }` with one of four
    causes, `readRulingTexts` puts each id in exactly one of `texts` or `errors`, and `readSnapshot`
    sets `readError` only on an attempted read that threw. Each caller checks the error before it
    calls the classifier, which still sees text only (`sddRulingDeferralReason(null)` still returns
    `sdd-ruling-unclassified`). Decide a read failure in the caller that attempted the read, never
    inside the pure classifier, let a recorded read error outrank any text for the same id, and pin
    each cause on each path with its own assertion.
24. **A composer's validator owes its reader's sentinels and delimiters too, not only its skip set
    (item 18).** A value the reader reads back as a *different valid value* is worse than one it
    drops, because every misread answer is one the reader legitimately emits.
    `plugin/bin/lib/dispatch/close-out-marker.js`'s `parseConflictedFiles` (#4331) reads the
    `conflicted-files:` field as the sentinel `none` (no conflicts), the sentinel `unknown`, or a
    `, `-joined path list with each entry trimmed. The field carries untrusted text, since a
    conflicted path is attacker-nameable, and each of those reader rules is a channel a real path
    can fall through: a path named `none` reads back as "no conflicts", and a path holding a comma
    reads back as two paths. The build's tests covered awkward paths but no reserved literal, and
    review found the `none` case (lenses 3b, 3c and 3f, `918f6db19`). `plugin/bin/close-out-marker.js`'s
    `readPathsFile` now refuses a comma, a carriage return, a path equal to either sentinel, and a
    path with leading or trailing whitespace (exit 1), and each refusal names the representable
    fallback (`--conflicted-files unknown`), so the caller can still record the update. Derive the
    reject list from every branch of the reader: each sentinel comparison, each split delimiter,
    each `trim`. Then pin a write-then-read round trip per entry. The `trim` was the branch #4331
    first missed: its ledger (row 16) accepted space-edged paths as a format limit on the premise
    that `git diff --name-only` quotes such a path. But git quotes only control characters, `"`,
    `\` and (under `core.quotePath`) non-ASCII bytes. A scratch merge conflicting on `trail ` and
    ` lead` printed both bare, so the marker would have read them back as `trail` and `lead`. Probe
    a format-limit premise before accepting it, as you would any other benign-failure claim.

## When to use

- Writing a new function that parses a plan, a record body, a ledger entry, or any other loose
  prose artifact in this repo into a structured result for a deterministic (non-LLM) check to act
  on.
- Reviewing an existing parser of this kind and checking whether its "nothing found" return path
  actually merges two different situations.
- Writing a check that shells out to a tool, or a probe in skill prose the agent runs, where an
  empty result could mean either "nothing found" or "the check did not run" (fix-shape items 8-9).
- Writing a check that reads the filesystem directly (`fs.readdirSync`/`readFileSync`/`existsSync`
  and the like) where catching every error the same way conflates "genuinely absent" (`ENOENT`)
  with "couldn't tell" (`EACCES`, `ENOTDIR`, and other non-ENOENT codes) (fix-shape item 11).
- Building a verdict (live/dead, present/absent) over several probes or shared readers whose
  negative branch gates something destructive, where a reader's falsy return may also mean "could
  not ask" (fix-shape item 21).
- Adding a validated field to a shared body composer such as `specShapedBody` that another module
  parses back, or that a batch producer fills from LLM output (fix-shape item 18).

## When not to use

- The input is validated against a real grammar or schema (JSON, YAML frontmatter with a fixed key
  set) where a parse failure is already a hard error, not a silent skip — this rule targets loose
  prose heuristics specifically, not formal-grammar parsing.
- The check truly has only one kind of "not found" — no plausible reason for a caller to need to
  tell "doesn't apply" apart from "couldn't parse" for this particular input shape.

## Origin

Filed as record #1595 from `/claude-tweaks:reflect` hindsight mode during #903's review (ledger
item 19), generalizing ledger item 18's finding about `plan-audit.js` Check C's
`extractStep2Verification`.
