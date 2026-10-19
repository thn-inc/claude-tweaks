---
name: parse-signal-discipline
description: Use when writing or reviewing a mechanized deterministic check that parses loose, real-world prose (a plan, a record body, a free-form config value) rather than a formal grammar — the check's "I could not parse this" case must be a distinguishable signal, never silently identical to "this input legitimately does not apply." Also covers a shell-out check whose tool exits non-zero for both "no match" and "could not run", and a probe in skill prose the agent runs. Keywords - parse failure, could-not-parse, deterministic check, prose heuristic, silent null, false negative, mechanized check, plan-audit, exit code, git grep, skill-prose probe, fail closed.
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
   A fuzzy text match is the same leak with no anchor at all. `plugin/bin/lib/plan-audit/checks.js`'s
   Check E (#3099) reads an acceptance-criterion clause as `covered` when the plan quotes its text.
   Its first version was a bare substring `includes()`, so the one-word clause "Last." read as
   covered by a test step about "the blast radius". Whole-branch review caught it, and `d9351cbee`
   added `quoteMatchesWholeWord`: a clause under three words is never matched by its text, and a
   longer one must match on a word boundary at both ends. Give a text-match recogniser a minimum
   length and a boundary at each end, and pin a short input hidden inside a longer word.
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
   `runVerify`. `a7790fbed` made the close keep the prior path as `worktreeAtClose` and added a
   test that builds the state through the real `closeRunState`. When a terminal transition clears
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
    `stripComments` blanks comments to spaces before the path-guard, windows-hide, git-status and
    exit-code conformance scans count tokens. It models regex literals (#3585); its residual
    ambiguity is a regex right after `)` or `}`, which it reads as division. In
    `if (b) /"/.test(b); const c = "//"; fs.existsSync(c);` the quote inside the regex pairs with a
    later string, the `//` after it opens a line comment, and the guarded call counted as zero.
    `stripperVerdict` (#3573) checks the transform with an oracle the raw input already passes: it
    compiles both the raw file and the stripped text under a CommonJS wrapper with `vm.Script`. A
    blanked comment never breaks syntax, but blanked code cuts a literal short. So "raw compiles,
    stripped does not" is `misparsed`, and a raw file that does not compile at all (an ESM file) is
    `unparseable`, its own outcome and never `ok`. Each scan reports either one as an offender.
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
