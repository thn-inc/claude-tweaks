---
name: node-test-output-evidence
description: Use when writing or reviewing code that reads `node --test` spec or TAP reporter output as evidence for a verdict, not just as a summary to display. Covers which test a failure belongs to, which failures are a parent's own, counting a log's failures against its summary, YAML diagnostic blocks, and the runner-level diagnostics Node never counts. The shipped consumers are `plugin/bin/lib/verify/`'s baseline adjudicator and its flaky-retry hook. Keywords - node --test, spec reporter, TAP, test identity, suite path, failing tests, ℹ fail, failureType, subtestsFailed, YAML block, ℹ Error, baseline adjudication, flaky retry, unattributed failures, testTree.
---

# Reading `node --test` output as evidence

## Overview

`plugin/bin/verify.js --baseline <ref>` (#3043) turns a failing test run into a pass when every failure also fails at the base commit. That verdict is only as sound as the parser behind it: `testTree`, `failingTestsByFile`, `specEntryCount`, `cancelledCount` and `countUnmatchedFailures` in `plugin/bin/lib/verify/extract.js`, consumed by `plugin/bin/lib/verify/baseline.js`. The flaky-retry hook (#3066) trusts the same failing-file list: `plugin/bin/verify.js` re-runs only the named files, so `unattributedFailureCount` must report 0 before `plugin/bin/lib/verify/flaky.js`'s `planRetry` will retry (spec, TAP, and jest and vitest logs that fully account can, #3480; pytest and every other family report `null` and `planRetry` refuses it). Each rule below was a fail-open hole in that parser, reproduced by a reviewer with a real Node v24 log before it was closed. A display-only reader can afford a misread. A reader whose output gates a pass cannot.

The general principle — a parse that cannot be trusted must say so — is `parse-signal-discipline`. This skill holds the Node-specific facts that principle needs.

## Key Patterns

### A failing test's identity is its suite path

Key a failure by the full path of names from the outermost suite down, never by the leaf name alone and never by its `test at <path>:L:C` site. Two `it('works')` tests in different `describe` blocks share a leaf name. Tests generated in a loop share one call site. `testTree` keys each point as `JSON.stringify([...openSuites, name])`, so a name cannot fake a nesting boundary.

Read names byte-for-byte on both the opener line (`▶ name` in spec output, `# Subtest: name` in TAP output) and the point line, and never trim them. A whitespace-only or trailing-space name left on the nesting stack otherwise closes the wrong suite.

### A tree whose nesting does not close is no evidence

A spec test name containing a newline prints across several lines, so the tree no longer nests. `testTree` sets `wellFormed: false` when a point sits at an open suite's indent without being its closer, sits shallower than an open suite, or a suite is still open at the end of the log. A caller treats an ill-formed tree as "cannot classify", never as a partial answer.

### A parent fails in its own right only on its own evidence

A suite, or a test with subtests, shows `✖` whenever a child fails. Count that parent as failing only when the failure is its own, such as a hook failure:

- **Spec.** The parent has its own entry in the `✖ failing tests:` section. Failing leaves take their own listings first. A name still listed after that vouches for the parents carrying that name. With none left, every such parent's failure is inherited. With exactly one per parent, each parent's failure is its own. Any other number is ambiguous, and the tree is no evidence.
- **TAP.** Read only the point's own top-level `failureType` key inside its YAML block. `failureType: 'subtestsFailed'` means the failure is inherited.

### A TAP point's YAML block is data

The lines between a point's `---` and `...`, indented two spaces deeper than the point, belong to that point. An assertion's expected or actual text can contain `not ok …` or `failureType:` lines. Skip the block when reading test points, and read only the one top-level key you need from it.

Inside the block, only the point's own top-level `location:` and `stack:` keys name its file (`tapBlocks`' `frames`); lines outside the block still can. Every other key is message text. A meta-test that spawns its own `node --test` run and fails with the child's output carries that child's whole TAP document — `not ok` lines, `location:` keys and temp-dir stack frames — inside its `error: |-` value, and those paths are the child's, never this run's (#3153). Take the key indent from the first non-blank line after `---`, not from the `---` line: Node puts keys at the `---` indent, but a tape-style producer indents them deeper. Diagnostics follow the same scoping: `conclusiveOnly` tests `INCONCLUSIVE_RE` only against the block's own top-level key lines (`keys`), so a quoted child timeout cannot make its parent inconclusive. A spec entry has no such boundary between its own `failureType:` and quoted child output, so the spec path still reads the whole entry body.

`tapLines` (#3404) is the one classifier for these rules: it labels every line `notOk`, `ok`, `subtest`, `comment`, `yamlOpen`, `yaml`, `yamlClose` or `other`, with the `owner` block each line belongs to, and `tapBlocks` is built on it. A block's ownership deliberately runs past its `yamlClose` to the next test point or `# ` line, because `tapBlocks`' `body` and `frames` include those lines. A consumer that means "inside this failure" must stop at the block's own `yamlClose`. `tools/windows-regression/file-issue.js`'s `ownerAt` does. The first implementation of its `excerptFor` did not, and reopened a crashed file's stderr at the previous test's `not ok`.

### A path the log names is untrusted input

A log can name any path: a quoted child's temp dir, another checkout, `tests/../../x` verbatim. `adjudicate` reads each log against the checkout it ran in — the HEAD log against the real checkout, the base log against the scratch worktree — through `at(dir)`, which passes `git.inCheckout` to the extractors as their `exists` predicate. A path absent from that checkout never names a failing file. A failure whose entries name only such paths refuses with `absent-from-checkout: …`, kept distinct from `unclassified failure(s)` (an entry naming no test file at all). `realGit().inCheckout` rejects an absolute path, a drive-letter path, and a `..` segment anywhere in the path. `relativize()` never produces an embedded `..`, but the guard answers to what the log says, not to what the producer emits (#3153, `626ec972b`).

### Reconcile the failing list against an independent count

An extracted list of failures cannot report that it missed one. `adjudicate` refuses to classify the full run unless:

- the spec `test at` entries (`specEntryCount`) add up to the summary's `ℹ fail N` plus its `ℹ cancelled` count;
- every failing entry or TAP `not ok` block names a test file (`countUnmatchedFailures` returns 0);
- the summary counts parse at all, because a truncated log has none.

The listing and `ℹ fail` do not count the same things — a cancelled test, for example one that timed out, is listed but not counted, so the full run's entries must reconcile against `ℹ fail` plus `ℹ cancelled`, not `ℹ fail` alone. A cancelled test does not by itself block adjudication of the full run: it is held to the usual per-file evidence (it fails at base, or shows its own pass in isolation). Only each isolated single-file run — the per-file base run and the isolated HEAD rerun — must itself show `ℹ cancelled`/`# cancelled` at 0 (`accountedFamily`) to count as evidence. A single-file run that times out or cancels proves nothing, so it cannot make the file baseline or flaky. Once the full run is adjudicated there is no "unclassified" outcome: every failing file lands in `baselineFailing`, `flakyPassed`, or `attributable`. If only the base run did not finish, a clean isolated HEAD run still makes the file flaky. If the isolated HEAD run did not finish, the base run cannot rescue the file, because both baseline paths (`failsToLoadAtBase`, `baselineInIsolation`) also read the isolated HEAD log. Without that rescue the file is `attributable` and the verdict is `fail`. In the per-file base run, a failure whose diagnostic says the test timed out or was cancelled (`INCONCLUSIVE_RE`, read through `failingTestsByFile`'s `conclusiveOnly`) means the test did not finish, which proves nothing about whether it fails, so that base log is no evidence.

The flaky-retry hook applies this accounting too, through `unattributedFailureCount` (#3066). A retry re-runs only the named files, so an undercounted list would let a retried pass clear a failure nothing re-ran. A positive count makes `planRetry` refuse with `unattributed-failures: {N}`. Its checks differ from `adjudicate`'s in two ways:

- TAP gets an entry check as well: `tapBlockCount` must equal `# fail` + `# cancelled`, as spec entries must equal `ℹ fail` + `ℹ cancelled`.
- The summary family is accounted per dialect (#3480), by the runner behind the log's own summary block (`summaryDialect`: jest prints `Test Suites:`/`Tests:`, vitest a colon-free `Test Files  N`). jest compares the distinct test files on its `FAIL` lines against `Test Suites: N failed`, and a missing `Test Suites:` line is unattributed (1). vitest compares them against `Test Files N failed`. Any unattributed signal makes the count positive, because a failing check no `FAIL` line names would otherwise clear on a retry of the named files. For either dialect that is a `FAIL` line naming no test file, a coverage-failure line (`Jest: … coverage threshold for … not met`, `Jest: Uncovered count for … exceeds …`, `Jest: Coverage data for … was not found`, vitest's `ERROR: Coverage for … does not meet … threshold`), a global setup/teardown failure line (jest's `Error: Jest: Got error running globalTeardown …` under any error name, vitest's `error during global teardown of …` and `Error during global setup` banner), Node's `Node.js v…` crash trailer, or more than one summary line (a concatenated multi-run log). For jest it is also a `Snapshots:` line naming `obsolete` (jest fails the run on an obsolete snapshot or snapshot file unless `-u` was passed) or an interrupted `N of M total` run (fewer than M suites reported once skipped ones count, since a skipped suite alone prints the same `N of M` form). A jest log whose last non-empty line is not the `Ran all test suites…` trailer is a positive-recognition backstop, counted only when no other unattributed signal already fired (#3674). A `--silent` run's `Time:` line and a yarn/pnpm failure trailer also end a run normally; other text after the trailer (jest's open-handle warning, another wrapper's lines) still refuses. For vitest it is also its `Errors` block (the larger of the `Errors  N error(s)` count and the `Unhandled Errors`/`Unhandled Rejection`/`Source Errors` banner, never their sum) or any skipped test file (vitest 1.6 prints no bail marker, so a `describe.skip` file over-refuses to the whole-suite re-run). Vitest has no stable closing line (stdout summary, stderr failure blocks), so it has no such guard. The line signals live in `UNATTRIBUTED_LINE_RES`, the interrupted-run test in `interruptedRun`.

pytest returns `null`, as does a summary log carrying more than one runner's markers (a jest or vitest summary beside pytest's `=== … in 0.02s ===` banner, or both dialects') or none, and every other family (#3204) — no accounting guard exists (pytest's collection `ERROR`s sit outside every `FAILED` line), so a caller must never read it as accounted. `planRetry` refuses with `no-accounting-guard: {family}` (`baseline.js`'s `adjudicate` refuses every family but spec and tap, so it never reads the jest/vitest count).

The declared `preExisting` allowlist (#3129) is a third consumer of the same count (#3481). It waives a failing run without re-running anything, so a named-file list that undercounts clears a failure nothing checked. `plugin/bin/verify.js` therefore asks `unattributedFailureCount` for every non-skipped failing check and refuses with `no-parse`, then `no-accounting-guard: {family}` (any one check whose count is `null`), then `unattributed-failures: {N}` (the counts summed across checks, so types and lint failing together add up), before `matchPreExisting` ever sees the file list. Without `--baseline` that is the only reachable multi-check case: `runChecks` fail-fast skips `tests` once a stage-1 check (`types`, `lint`) fails. A `--baseline` run (#3511) keeps running the suite tier after a suite fails, so `tests` and a declared suite can both be failing checks when baseline adjudication declines and this block runs — the same summed-count rule applies. `unattributedFailureCount` does not read `RUNNER_ERROR_RE`, so the block tests that pattern on each failing log itself and refuses with `runner-error` after the count checks, as `accountedFamily` does. A flaky retry needs no such check because it re-runs the files and trusts the exit code.

### A runner's failure signals come from its source, not from the shapes a spec names

Accounting a jest or vitest log against the failure shapes a record names leaves every other exit channel reading as accounted, which is the unsafe direction. #3480 found obsolete snapshots, global setup and teardown errors, bail, coverage thresholds, and vitest's `Unhandled Rejection` and `Source Errors` banners only by reading each runner's exit-code path and capturing a real log for each, never from the spec. Enumerate the channels from the runner's source, pin each with a captured log under `tests/fixtures/verify-dialects/`, and expect an unenumerated channel to be the next fix.

### Node's runner-level diagnostics are visible only in the log

An uncaught error from async work that outlived its test is reported as a separate file-level failure only when no test in the file failed. Beside a failing test it appears only as an `ℹ Error:` line, or as text containing `generated asynchronous activity after the test ended`. `baseline.js`'s `RUNNER_ERROR_RE` treats a log carrying either as no evidence. A bare `# Error:` line in TAP output is the test's own console output, not Node's.

### A report-only list inferred from absence owes `null`, never `[]`

Both adjudications report `new` and `fixed` (#3313). Neither feeds the verdict, but a reader acts on `fixed`: its `FIXED:` lines suggest dropping a `preExisting` entry. "Did not fail" is not an observed pass, so a case the run cannot prove is `fixed: null` plus a `fixedReason`. An `[]` there would read as "nothing got fixed".

- **Baseline `fixed`** (`adjudicate`): per-file adjudication never runs a HEAD-passing file at base, so each failing check gets one extra full-command run in the scratch worktree. That log is evidence only when `accountedFamily` accepts it and `parseCounts(...).tests > 0`. Its file-level load failures are dropped when HEAD resolves dependencies (or the check sets `NODE_PATH`), because an uninstalled scratch worktree fails to load the same way. One check whose base run proves nothing makes `fixed` null for the whole run, because a partial union reads as complete.
- **`preExisting` `fixed`** (`newAndFixed`): absence counts only for test files (`TEST_FILE_RE`, never a fixture an allowlist glob also covers), on a `full` scope run with no fail-fast skip, and when `git ls-files` answered (`trackedFiles` returns `null` on failure).

The baseline base run adds one whole-suite run per failing check. Before adding runtime to the `verify.js --baseline` path, check its CI callers. `.github/workflows/windows-regression.yml` runs that path inside a 90-minute job budget and reads nothing from `fixed`, so it passes `--no-baseline-fixed`. The field contract is `plugin/skills/test/verification.md`'s Baseline adjudication and Declared pre-existing failures sections.

## Decision Framework

| The log shows | Read it as |
|---|---|
| A family other than spec or tap (baseline adjudication), or pytest and an ambiguous summary log (flaky retry, `preExisting`) | No failure-accounting guard. Refuse to classify |
| A jest/vitest log whose `FAIL` test files ≠ the summary's failed-suite count, or that carries any other unattributed signal (a coverage or global-hook failure line, a crash trailer, an obsolete snapshot, an interrupted or concatenated run, vitest's `Errors` block or a skipped file, a jest log ending in none of a normal run's closing lines — the `Ran all test suites…` trailer, or a `--silent` run's `Time:` line, either optionally followed by a yarn/pnpm failure trailer) | An undercount. Refuse with `unattributed-failures: {N}` (#3480) |
| Spec entries ≠ `ℹ fail N` + `ℹ cancelled N`, or a failing entry naming no test file | An undercount. Refuse |
| A failing entry or TAP block naming only paths absent from the checkout its log ran in | Not a file of this run. Refuse with `absent-from-checkout` |
| A non-zero cancelled count in the full run | Not a refusal by itself. Each cancelled test is held to the per-file evidence: it fails at base, or shows its own pass in isolation |
| In an isolated single-file run (the per-file base run or the isolated HEAD rerun): a non-zero cancelled count or a runner-level `ℹ Error:`. In the base run, also a failure whose diagnostic says it timed out or was cancelled (`INCONCLUSIVE_RE`) | Did not finish, or failed outside any test. That run is no evidence: it cannot make the file baseline or flaky. The file is `attributable` unless only the base run failed this way and the isolated HEAD run is clean (flaky); a base run never rescues an isolated HEAD run that did not finish |
| Nesting that does not close | No evidence |
| A parent `✖` with no listing left for it (spec), or `failureType: 'subtestsFailed'` (TAP) | Inherited from a child. Not the parent's own failure |
| A full-run failure that is absent from an isolated run | Not a pass. Only the test's own `✔` in that run counts |

## Project Conventions

- Reproduce a suspected parser hole with a real Node reporter log (spec and TAP) before fixing it, and keep that log's shape in the test. Every hole above was confirmed that way, and a hand-typed log tends to omit the line that caused the hole.
- When a change narrows which lines a parser reads, re-prove every existing fixture that runs through the narrowed path: assert the fixture still yields the entity under test without the option before asserting the option filters it. #3153 scoped a TAP block's file to its own `location:`/`stack:` keys; the #3043 `conclusiveOnly` fixture named its timed-out file on a bare `at` YAML line, so that block named no file and the test passed whether or not `conclusiveOnly` worked. Green runs, task reviews and the whole-branch review all missed it (repaired in `5b9338e0d` with a no-option assertion that the block names the file).
- The comparison is by test identity, not by failure reason. A test that already fails at base covers any failure of the same test at HEAD. `plugin/skills/test/verification.md`'s "What it cannot see" states this limit, and the hosted CI check stays the authoritative gate.
- A wholly file-level load failure counts as baseline only when its normalized isolated HEAD log equals the base log (`normalizeLog` strips roots and durations), not merely when it fails at the same `1:1` site.
- `verify.js --stamp-status` exposes three related but distinct booleans: `match` (an unconditional full clean pass — deliberately `false` whenever `baselineAdjudicated` is `true`, even when `sha === head`), `verifiedHead` (HEAD is actually verified, by either path — this is the field Skip-if-recent and `/review` Step 1.5 read), and `baselineAdjudicated` (this pass relied on baseline adjudication). A reader checking only `match` can misread a legitimate baseline-adjudicated pass as "doesn't match HEAD, re-run" — check `verifiedHead` for pass/fail and `baselineAdjudicated` for which path produced it.
- `verifiedHead` has one more path, and only `--stamp-status --scope <declaration>` computes it (#3002): `suiteComposed.complete`, true when every check the declaration names has its own passing per-suite record (written by chunked `--stamp-suite` runs) at this clean HEAD. Bare `--stamp-status` reports `suiteComposed: null` and never takes that path, so a chunked project reads `verifiedHead: false` there even after every chunk passed. Name the declaration before concluding a chunked project is unverified. `plugin/skills/test/stamp-composition.md` documents the composed fields.
- Pass both `unattributedCount` and `family` from any new `planRetry` caller. Its default `unattributedCount = 0` reads an omitted count as accounted, so a caller that forgets it retries with no accounting guard. `plugin/bin/verify.js` is the only caller today and passes both.

## Common Operations

```bash
node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/baseline.test.js
node --test --test-reporter=tap tests/bin-lib/verify/extract.test.js   # capture the TAP shape of a real run
```

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Matching base and HEAD failures by leaf name or by `file@line:col` | A same-named test in another suite, or a loop-generated test sharing one site, covers a new failure |
| Trimming test names | A whitespace-only or trailing-space suite name stays on the nesting stack and misnests everything after it |
| Counting every `✖` parent as failing | An inherited failure at base then covers a real new failure at HEAD in that parent |
| Scanning every TAP line for `not ok` or `failureType:` | An assertion's expected text inside a YAML block invents test points or flips a parent's own failure to inherited |
| Reading a file path from any line of a TAP block's YAML | An `error:` value can quote a spawned child's whole TAP document, so its temp-dir paths come back as phantom `ATTRIBUTABLE:` files (#3153) |
| Rejecting only a leading `..` when checking that a log-named path is inside the checkout | The log can name `tests/../../x` verbatim. `relativize()` never makes one, but the input is the log, not the producer (#3153) |
| Treating an extracted failing-file list as complete | A failure whose entry names no file drops out, and the rest classify as a pass over a failure nothing checked |
| Reading a test's absence from a re-run as a pass | A child killed mid-file, a skip, or a filter produces the same absence |
| Applying an accounting check to spec output only when a new consumer reuses it | #3066's first TAP branch returned before checking that the summary counts parsed, so a truncated TAP log read as fully accounted. Carry every check over for spec and TAP alike, and test each family's truncated-log case |
| Returning the "accounted" value for a family the accounting cannot check | #3066's `unattributedFailureCount` returned 0 for every family but spec/tap, so `planRetry` retried a jest/pytest/vitest log's named files unguarded. It now returns `null` and `planRetry` refuses with `no-accounting-guard: {family}` (#3204); jest and vitest have since gained real accounting (#3480), so only pytest and an ambiguous summary log still return `null`. Give "cannot check" its own value |
| Reading `tapLines`' `owner` as "this line is inside the failure" | Ownership outlives the YAML terminator so `tapBlocks` stays byte-identical. A stderr line after one test's closed block then reads as that test's, and an excerpt opens at the wrong `not ok` (#3404) |
| Normalizing or matching only the spec form of a run-specific line (`ℹ duration_ms`) | Node writes TAP whenever stdout is not a TTY, so every child run `verify.js` spawns is TAP. `normalizeLog` stripped spec's `ℹ duration_ms` and the YAML `duration_ms:` key but not TAP's `# duration_ms` summary line, so a whole-file failure never matched its base log, on any platform, and came back attributable (#3316, `7a49b742f`). Give every reporter-specific rule its TAP twin and a TAP fixture |

## Reference

- Code: `plugin/bin/lib/verify/extract.js` (`testTree`, `failingTestsByFile`, `specEntryCount`, `cancelledCount`, `countUnmatchedFailures`, `fileLevelFailures`, `unattributedFailureCount`, `tapBlockCount`, `tapLines`), `tools/windows-regression/file-issue.js` (`excerptFor`, `ownerAt`), `plugin/bin/lib/verify/baseline.js` (`adjudicate`, `accountedFamily`, `RUNNER_ERROR_RE`, `normalizeLog`), `plugin/bin/lib/verify/flaky.js` (`planRetry`)
- Tests: `tests/bin-lib/verify/extract.test.js`, `tests/bin-lib/verify/baseline.test.js`, `tests/bin-lib/verify/cli.test.js`, `tests/bin-lib/verify/flaky.test.js`
- Contract: `plugin/skills/test/verification.md`'s Baseline adjudication and Flake handling
- Related skills: `parse-signal-discipline` (couldn't parse versus doesn't apply; reconciling a list against an independent count), `windows-checkout-test-parity` (the Windows failure baseline this adjudicator exists for)
- Origin: #3043; the flaky-retry consumer: #3066; the `preExisting` consumer: #3481; the shared `tapLines` classifier and the Windows filer's reuse of it: #3404
