---
name: node-test-output-evidence
description: Use when writing or reviewing code that reads `node --test` spec or TAP reporter output as evidence for a verdict, not just as a summary to display. Covers which test a failure belongs to, which failures are a parent's own, counting a log's failures against its summary, YAML diagnostic blocks, and the runner-level diagnostics Node never counts. The shipped consumer is `plugin/bin/lib/verify/`'s baseline adjudicator. Keywords - node --test, spec reporter, TAP, test identity, suite path, failing tests, ℹ fail, failureType, subtestsFailed, YAML block, ℹ Error, baseline adjudication, testTree.
---

# Reading `node --test` output as evidence

## Overview

`plugin/bin/verify.js --baseline <ref>` (#3043) turns a failing test run into a pass when every failure also fails at the base commit. That verdict is only as sound as the parser behind it: `testTree`, `failingTestsByFile`, `specEntryCount`, `cancelledCount` and `countUnmatchedFailures` in `plugin/bin/lib/verify/extract.js`, consumed by `plugin/bin/lib/verify/baseline.js`. Each rule below was a fail-open hole in that parser, reproduced by a reviewer with a real Node v24 log before it was closed. A display-only reader can afford a misread. A reader whose output gates a pass cannot.

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

### Reconcile the failing list against an independent count

An extracted list of failures cannot report that it missed one. `adjudicate` refuses to classify unless:

- the spec `test at` entries (`specEntryCount`) add up to the summary's `ℹ fail N`;
- every failing entry or TAP `not ok` block names a test file (`countUnmatchedFailures` returns 0);
- the summary counts parse at all, because a truncated log has none;
- `ℹ cancelled` (spec) or `# cancelled` (TAP) reads 0 in a single-file log.

The listing and `ℹ fail` do not count the same things. A cancelled test, for example one that timed out, is listed but not counted, so a full run containing one is never adjudicated. That outcome is fail-closed, and a pass is never reached. A diagnostic that says the test timed out or was cancelled (`INCONCLUSIVE_RE`) means the test did not finish, which proves nothing about whether it fails.

### Node's runner-level diagnostics are visible only in the log

An uncaught error from async work that outlived its test is reported as a separate file-level failure only when no test in the file failed. Beside a failing test it appears only as an `ℹ Error:` line, or as text containing `generated asynchronous activity after the test ended`. `baseline.js`'s `RUNNER_ERROR_RE` treats a log carrying either as no evidence. A bare `# Error:` line in TAP output is the test's own console output, not Node's.

## Decision Framework

| The log shows | Read it as |
|---|---|
| A family other than spec or tap | No failure-accounting guard. Refuse to classify |
| Spec entries ≠ `ℹ fail N`, or a failing entry naming no test file | An undercount. Refuse |
| A non-zero cancelled count, a timeout diagnostic, or a runner-level `ℹ Error:` | Did not finish, or failed outside any test. No evidence |
| Nesting that does not close | No evidence |
| A parent `✖` with no listing left for it (spec), or `failureType: 'subtestsFailed'` (TAP) | Inherited from a child. Not the parent's own failure |
| A full-run failure that is absent from an isolated run | Not a pass. Only the test's own `✔` in that run counts |

## Project Conventions

- Reproduce a suspected parser hole with a real Node reporter log (spec and TAP) before fixing it, and keep that log's shape in the test. Every hole above was confirmed that way, and a hand-typed log tends to omit the line that caused the hole.
- The comparison is by test identity, not by failure reason. A test that already fails at base covers any failure of the same test at HEAD. `plugin/skills/test/verification.md`'s "What it cannot see" states this limit, and the hosted CI check stays the authoritative gate.
- A wholly file-level load failure counts as baseline only when its normalized isolated HEAD log equals the base log (`normalizeLog` strips roots and durations), not merely when it fails at the same `1:1` site.

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
| Treating an extracted failing-file list as complete | A failure whose entry names no file drops out, and the rest classify as a pass over a failure nothing checked |
| Reading a test's absence from a re-run as a pass | A child killed mid-file, a skip, or a filter produces the same absence |

## Reference

- Code: `plugin/bin/lib/verify/extract.js` (`testTree`, `failingTestsByFile`, `specEntryCount`, `cancelledCount`, `countUnmatchedFailures`, `fileLevelFailures`), `plugin/bin/lib/verify/baseline.js` (`adjudicate`, `accountedFamily`, `RUNNER_ERROR_RE`, `normalizeLog`)
- Tests: `tests/bin-lib/verify/extract.test.js`, `tests/bin-lib/verify/baseline.test.js`, `tests/bin-lib/verify/cli.test.js`
- Contract: `plugin/skills/test/verification.md`'s Baseline adjudication
- Related skills: `parse-signal-discipline` (couldn't parse versus doesn't apply; reconciling a list against an independent count), `windows-checkout-test-parity` (the Windows failure baseline this adjudicator exists for)
- Origin: #3043
