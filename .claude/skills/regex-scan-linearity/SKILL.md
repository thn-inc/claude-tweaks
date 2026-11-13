---
name: regex-scan-linearity
description: Use when writing or changing a regex or hand-written scan in plugin/bin/ that runs over text of unbounded length — a decision-log line, a commit message, a repo source file, a Bash command — or a grammar shared between a writer and a reader. Covers probing the adversarial inputs before review, the three super-linear shapes this repo has hit and their fixes, and pinning linearity in perf/ rather than tests/. Keywords - regex, linear, quadratic, backtracking, ReDoS, lookbehind, tempered token, perf/, linearity budget, npm run test:perf, wall-clock-budget-conformance.
---

# Regex scan linearity

## Overview

Four records wrote a super-linear scan and found it only after the first implementation, in review or a fix round: #2622 (`scanScaleReadiness`, 17 s on a `////` banner), #3412 (`plugin/bin/lib/reconcile/release-merged.js`'s closing-keyword match, about 16 s on 40k newlines), #4149 (the write gate's shell scan, 12 s at 120 KB) and #4581 (`aggregateReproductionProblem`, 158 s on a 200k-character token, plus 82 s and 12 s after merging #4632's grammar). Each ran on input nobody bounds, so a pathological value stalls a session, a review or a release. Probe before review, not after.

## Key Patterns

### Probe with an input built from the regex's own alphabet

Feed the function a long run of characters its pattern accepts, without the terminator that ends a match, and time it. The inputs that exposed the four records:

- a long token of the matched class with no terminator: `'a'.repeat(200000)` against `FINDING_PATH` (no `.ext`)
- many repetitions of a separator a lazy group can stop at: `'a b:1 / '.repeat(25000)`
- a long newline run under `/m`: `'\n'.repeat(40000)`
- a long run of spaces inside one line, with a non-space after it: `` `a${' '.repeat(200000)}b` ``. The newline run above does not exercise this
- a long repeated group: `'a.'.repeat(20000)`, `'/'.repeat(200)`

Seconds at these sizes is the bug; the fixed #4581 detector takes single-digit milliseconds on the 200k-character token. `perf/aggregate-reproduction-linearity.test.js` holds the #4581 cases.

### The three shapes and their fixes

1. **An unanchored global regex restarting inside every long token.** `PATH_RE` in `plugin/bin/lib/log-decision/aggregate-reproduction.js` retried `FINDING_PATH` at each position of a dot-free token. Fix: a left-boundary lookbehind of the class, `(?<![A-Za-z0-9_./@+~%$\[\]()-])${FINDING_PATH}`, so a match starts only where a path can start. When only presence matters, test a fixed suffix instead of the whole pattern: `readsLocation` in `plugin/bin/lib/console/finding-path.js` tests `${FINDING_PATH_UNIT}\.[A-Za-z0-9]+:\d+`, which matches whenever the full pattern would.
2. **A lazy or unbounded group rescanning to the end once per split.** #4632's coincidence locations `.+?:\d+` rescanned the rest of the line once per ` / `. Fix: a tempered token that cannot cross a boundary, `(?:(?!:\d).)+:\d+` (`COINCIDENCE_LOCATION` in `plugin/bin/lib/console/finding-path.js`). #2622's `(?:seg\.)+` took a `{1,8}` cap instead.
3. **A `\s` that crosses newlines under `/m`.** `^\s*` restarts at every line and runs across blank-line runs. Fix: `[ \t]` (#3412).

Shape 1 also hides at the edge of a regex, on a whitespace or newline run rather than a token. #4611's `packet-gather.js` and `packet-render.js` had `\s*$`, `\s+#`, an unanchored leading `\s*` and `\s*[\r\n]+\s*`, and `packet-post.js` had `[\r\n]+$`. Each restarts at every character of the run and fails at its end (6 to 26 s at 100k to 200k characters). Shape 3's `[ \t]` does not help here: `[ \t]*$` times the same as `\s*$` on `a`, 60k spaces, `b`. Take the run out of the regex and handle it in code: match the run and then test it (`collapseLines` in `packet-render.js`), trim after matching (`parseHeading` in `packet-gather.js`), scan with `indexOf` (`stripYamlComment`), or walk back by hand (`stripClause`, `upsertLocalPacket`).

A scan that re-reads the input once per match is the same cost without a regex: #3903's brace tracker recounted from the start of the file for every match. Keep one persistent scan position.

#4612's `plugin/bin/lib/walkthrough/redact.js` met two more forms while it was written, each probed with its fix reverted (`perf/recording-redact-linearity.test.js`):

- **A quoted value taking a backslash run with `\\+`.** Over 30 s on `token="` followed by 200k backslashes and no closing quote: a run of the escape character has many ways to split, and an unterminated value tries them all. Fix: unroll the loop so one run has one way to match, `"[^"\\]*(?:\\[\s\S][^"\\]*)*"` (`quoted` in `redact.js`).
- **Reading the value before checking the name.** A `name=value` scan that read the value first rescanned the rest of the text once per `a=` in `a=a=a=`, about 4 s at 50k repeats. Fix: split it. `assignmentRule` matches the key alone (`ASSIGNMENT_KEY_RE`), checks the name, and only then runs a sticky value regex (`ASSIGNMENT_VALUE_RE`, flag `y`) from the key's end.

#5219's `reduceDetail` in `plugin/bin/lib/driver/settle.js` met shape 2 while keeping trailing sentence punctuation out of a path match. `\S*?(?=[),;.]*(?:\s|$))` re-ran its lookahead over the rest of the run at every lazy step: 7.3 s at 32k and 29 s at 64k characters on `'/a' + '.'.repeat(n) + 'x'`. Fix: match greedily with `\S*` and split the trailing run off by hand in the replacer (`sentenceTail`). `perf/driver-settle-reduce-detail-linearity.test.js` holds this case and nine other adversarial shapes.

#5269's `neutralize` in `plugin/bin/lib/driver/events.js` met four more, each pinned with its pre-fix time in `perf/driver-neutralize-linearity.test.js`:

- **A fixed-point removal loop that peels one layer per pass.** Removing a reference can splice its neighbours into a new one (`h#7ttps://…` becomes a URL), so the removal passes repeat until the text stops changing. Any rule that refuses a match until the previous removal has run makes that loop quadratic. A `(?<![A-Za-z0-9])` boundary on `URL_REF` refused each back-to-back URL because it followed the previous URL's digit, so one URL went per pass (`'https://g/o/r/issues/5'.repeat(9000)`, about 10.5 s). Fix: admit the boundary the renderer admits; GitHub's autolinker rewinds over letters only, so `(?<![A-Za-z])`. Plain deletion peeled one nesting layer of spliced URLs per pass (k=9000, about 12.2 s); in-loop removals now leave one space, which no pattern spans. A keyword whose removal depends on the keyword after it peels the same way: one keyword per pass (`'fix '.repeat(25000)` before `www.g/o/r/issues/5`, about 153 s). Fix: decide the chain right to left in one pass over the collected matches.
- **A per-match decision that scans to the end of a token.** The keyword rule reads the whitespace-delimited token after each keyword. A lookahead embedding `URL_REF`'s greedy tail rescanned a long non-space run from every keyword (`'a.fix:https://g/o/r/issues/1/'.repeat(8000)`, about 1.0 s), and a fresh whitespace search per keyword costs the same. Fix: collect the markers once, and move the marker pointer and the token end forward only (`removeKeywordsBeforeReferences`).
- **A left-boundary lookbehind that refuses matches a global replace relied on.** `QUALIFIED_REF` took shape 1's fix, `(?<![A-Za-z0-9_.-])` (200k `h` took about 91 s before it), but that alone refuses the second of two back-to-back references: in `a/b#1x/y#2` the replace resumes inside an identifier run. It takes a second start case right after `#\d+`, guarded by a cheap `(?!\d)` so the variable-length `(?<=#\d+)` does not scan back at every digit (`'1'.repeat(200000)` took about 158 s with the guard removed).
- **Two optional runs around an optional character.** `\s*:?\s*` splits a whitespace run two ways at every length (100k spaces, about 52 s). Fix: `(?:\s*:)?\s*`.

### A line under `m` is JS's line, not git's

This one is a wrong answer, not a slow one. A commit body's line ends at LF, but JS `^` and `$` under `m` also break on U+2028 and U+2029, so `Release-Note: A Fixes #99` read as a `Fixes #99` footer and booked #99 (#4634, a review probe, one fix wave). Split on `'\n'` and match each line without `m`, as `parseCommit` in `plugin/bin/lib/release-local/commits.js` and `extractReleaseNotes` in `plugin/bin/lib/release-notes.js` do. Three details come with the split:

- `.` stops at U+2028 and U+2029 too, so `/^N: (.*)$/` fails on a line holding one and the line silently drops. Capture with `[^\n]*`.
- `split('\n')` leaves a CRLF body's `\r` on the line. Tolerate it in the pattern (`[ \t]*\r?$`) or strip it first (`parseFixesSpan` in `plugin/bin/lib/flow/closing-links.js`).
- `\s` matches both separators and LF, so `\s*$` under `m` can run past the end of the line.

Probe a footer reader with the separator in front of the footer: `` `a Fixes #99\n\nFixes #10` `` must return `[10]`. `fixesRecords` in `plugin/bin/lib/express/sampling.js` and `parseFixesMembers` in `plugin/bin/lib/reconcile/console-execute.js` read PR bodies with `/gm` and return `[99, 10]`.

## Decision Framework

| The scan | Do |
|---|---|
| Runs on text no caller bounds | Probe it, pin it in `perf/` |
| Shares a grammar with another module (`finding-path.js`) | Re-run the other side's probe and its `perf/` file on any change to the shared pattern |
| Can be capped (nesting depth, repetitions) | Cap it, and pin the cap timing-free in `tests/` |

## Project Conventions

- Wall-clock budgets live in `perf/{name}-linearity.test.js`, run by `npm run test:perf`, never by `npm test`. `tests/wall-clock-budget-conformance.test.js` fails any `performance.now()` comparison under `tests/` (#3412, #3491). A `ms < 750` assertion in `tests/` failed `npm test` under load (`shell-scanner-bash-differential`), and #4581's timing tests failed the conformance scan until commit b2f7aa3b2 moved them.
- The file header names the record, says it is deliberately not part of `npm test`, gives `Run with: npm run test:perf`, and lists each shape found with its pre-fix time.
- Assert the verdict as well as the time, as the #3412 and #4581 files do, so a fix that changes the answer is caught.
- Assert a long output with `assert.ok(value === expected, ...)` and a length-only message: a failing `deepEqual` prints all 200k characters (`perf/packet-gather-linearity.test.js`).
- Each case goes red when its fix is reverted. Prove it once by reverting.
- A grammar shared by a writer and a reader is one source (`plugin/bin/lib/console/finding-path.js`). Its comment states what keeps the scan linear (`COINCIDENCE_LOCATION`: a location never spans a second finding).

## Common Operations

Time one input against the worktree's module:

```bash
node -e "const {aggregateReproductionProblem:f}=require('./plugin/bin/lib/log-decision/aggregate-reproduction');const t=performance.now();f({status:'STAGED',text:'Reproduction: lens \"3a\" finding a.js:1 '+'a'.repeat(200000)});console.log(Math.round(performance.now()-t),'ms')"
```

Run the perf suite: `npm run test:perf`.

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| A `ms <` assertion in `tests/` | `tests/wall-clock-budget-conformance.test.js` fails it, and it flakes under sibling-suite load |
| Probing only real-archive lines | #4581's real `decisions.md` oracle (1414 lines) never exposed the 158 s case; a 200k-character token did |
| Re-running only the changed side after a shared-grammar change | #4632's reader-side loosening, merged as-is, would have made the writer's scan quadratic (82 s, 12 s); only re-running the writer's probe caught it |
| A timing case with no verdict assertion | A fix that returns early on the long input passes the clock and changes the answer |

## Reference

- `perf/aggregate-reproduction-linearity.test.js`, `perf/closing-keyword-linearity.test.js`, `perf/heredoc-scan-linearity.test.js`, `perf/scale-readiness-linearity.test.js`
- `perf/packet-gather-linearity.test.js`, `perf/packet-render-linearity.test.js`, `perf/packet-links-post-linearity.test.js`
- `perf/recording-redact-linearity.test.js`
- `perf/driver-settle-reduce-detail-linearity.test.js`
- `perf/driver-neutralize-linearity.test.js`
- `perf/cross-repo-dependency-linearity.test.js`, `perf/ledger-row-linearity.test.js`, `perf/process-kill-linearity.test.js`
- `plugin/bin/lib/console/finding-path.js`, `plugin/bin/lib/log-decision/aggregate-reproduction.js`
- Domain detail stays in `code-health-focus-vertical` (item 6, generators) and `shell-scanner-bash-differential` (the write gate's caps)
