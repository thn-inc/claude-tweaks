# Parse-Signal Discipline — fix shape, items 17-26

Lazy-loaded from `SKILL.md`'s "The fix shape" section; the numbering continues that list.

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
25. **An unanchored extractor with a narrow character class truncates instead of failing, so an
    out-of-class input yields a confident wrong value, not "no match".** `plugin/bin/lib/console/resolve.js`'s
    `findingKey` (#4582) searched with `[A-Za-z0-9_./-]+\.[A-Za-z0-9]+`, so `packages/@scope/x.ts:4`
    keyed `scope/x.ts:4`, and `app/[id]/page.tsx:9` and `blog/[id]/page.tsx:9` both keyed
    `/page.tsx:9`: a verdict on one settled the other. The record called this "yields no key, fails
    safe", and its settle-behaviour criterion passed at base, because both sides of the comparison
    truncate alike. Run the extractor on an out-of-class input before stating its failure direction.
    Assert the extracted value directly, and pin two inputs that differ only in the part it would
    drop (`tests/bin-lib/console/resolve.test.js`).
    Widening the class also moves every stored id hashed from the extracted value. #4582 left
    `plugin/bin/lib/console/backfill.js`'s copy of the narrow class alone for that reason, since
    `backfillItemId` hashes the finding key and a re-run could file a re-id'd item twice. #4631
    split the two: the reported path comes from `FINDING_PATH` (exported by `resolve.js`), while
    `findingKeyOf` keys the id on the `LEGACY_LOCATION_RE` (old class) match ending at the same
    offset. When a fix widens an extractor whose value feeds a stored id, keep the old extraction
    for the key, and pin a stored legacy-keyed item surviving a re-run without a second filing
    (`tests/bin-lib/console/backfill.test.js`'s AC2 cases).
26. **A recogniser that must ignore a marker shown as code owes a rule the host format
    guarantees, not a home-made model of that format.** A model that drifts from the real parser
    fails toward accepting the marker. `plugin/bin/lib/issues/accept-verdict.js`'s
    `parseVerdictMarker` (#4610) reads a verdict marker from a GitHub comment, and a marker inside
    a code block must never count. Its first version masked inline code spans and tracked fences
    line by line. Review found the tracker drifting from GitHub's renderer on list items, HTML
    blocks and a leading BOM. The blanking could also create an opener that defeated the
    one-marker count, so fenced bodies parsed as verdicts. `1ff12329a` replaced the model with two
    rules by position: the marker sits alone on its line at column 0, and no run of three or more
    backticks or tildes comes before it. A fence cannot enclose a marker without opening earlier,
    and column 0 excludes indented code, inline spans, blockquotes and list items. The cost is
    some false rejections: a closed code block before the marker rejects too. So the contract
    (`_shared/pr-run-comments.md`) states the rule, and the module header tells writers to put the
    marker first. Check such a rule against the real renderer, never against your own model.
    The writer closes the delimiter channel item 24 names: `renderVerdictMarker` escapes `<`
    and `>` in the JSON as `\u003c` and `\u003e`, so a note can never carry the `-->`
    that ends the comment, and the parser rejects a raw `<` or `>`. Pin each hiding place with its
    own case (`tests/bin-lib/issues/accept-verdict.test.js`: a block that does not own its line,
    fence text before the block, and a note holding `-->`).
