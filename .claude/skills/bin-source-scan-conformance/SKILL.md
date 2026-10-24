---
name: bin-source-scan-conformance
description: Use when adding or changing a `node --test` suite that reads `plugin/bin/**/*.js` as text to enforce a code convention across it — a spawn option, a git flag, an exit guard, a banned API, a banned idiom. Covers importing the shared comment stripper, the stripper-verdict check that turns a mis-parse into an offender, matching every call shape, the floor on matched sites, and go-red self-tests for the matcher. Keywords - source scan, conformance scan, stripComments, stripperVerdict, comment stripper, windowsHide, no-optional-locks, exit-code conformance, path-guard, path-containment, plugin/bin lint.
---

# plugin/bin source-scan conformance

## Overview

Several conventions for `plugin/bin` code are enforced by a test that walks the tree and regex-matches its source text, not by a linter:

- `tests/windows-hide-spawn-conformance.test.js`: every `child_process` call passes `windowsHide`.
- `tests/git-status-optional-locks.test.js`: every read-only `git status` passes `--no-optional-locks`.
- `tests/bin-lib/exit-code-conformance.test.js`: an entry point (a `require.main === module` guard, or a guard-less, export-less whole-script file) sets `process.exitCode` and never calls `process.exit(`; a guard-less file that exports is a library and is skipped.
- `tests/path-guard-conformance.test.js`: no bare `realpathSync`/`existsSync` outside the per-file allowlist.
- `tests/path-containment-conformance.test.js`: no hand-rolled `startsWith(… path.sep)` containment test, nor a `startsWith(<identifier bound to a path.sep expression>)` (#3892), and no bare `startsWith('..')` on a `path.relative` result (a child named `..foo` is contained, not outside); use `isPathContained`. `visual-decide/server.js` is the one exception: it keeps a builtins-only whole-segment copy (`rel.split(path.sep)[0] === '..'`) because #1202 AC 8 bars non-builtin imports there.
- `tests/porcelain-cwd-compare-conformance.test.js`: no strict `.path` vs `cwd` compare (either operand order, `===`/`!==`/`==`/`!=`); a porcelain lookup goes through `findWorktreeEntry` (#3811).

Each one is a hand-written parser over JavaScript. The comment stripper, the call-shape regex and the file walk can each fail in the direction that hides code. When that happens, the scan reports zero offenders over less code than it claims to cover.

For a suite that pins the prose under `plugin/skills/`, use `skill-prose-conformance-tests` instead.

## Key Patterns

### Import the shared stripper, never write one

Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`. From a `tests/bin-lib/` suite the path is `../helpers/strip-comments`. `tests/helpers/strip-comments.js` is one left-to-right scanner. It models string literals, template literals (their `${…}` code is scanned recursively) and regex literals (#3585), and keeps each verbatim by default. A `/*` or `//` inside a literal therefore never opens a fake comment, and a regex ending in an escaped slash such as `/^origin\//` is not read as `//`. Three properties make it safe to scan over:

- Comments are blanked to spaces, never deleted, so offsets and line numbers still match the raw file.
- Literals are returned unchanged by default, so a token inside generated source text or a bracket-string form (`fs['realpathSync']`) still counts. An operator scan that must not read literal text as code opts in with `stripComments(src, { literals: 'blank' })` (#3491): string, template-text and regex bodies are blanked too, delimiters and offsets stay, and a `\` before a newline (a string's line continuation) stays so the string still compiles. Any other `literals` value throws a TypeError. When a scan uses blank mode, it computes the blank-mode text once and hands that same text to both `stripperVerdict(raw, stripped)` and its matcher, so the mis-parse check judges what the matcher reads.
- An unterminated construct ends at the end of its line or the input and never throws.

Fixing a stripper defect means editing the helper and adding the planted case to `tests/helpers-strip-comments.test.js`. Every scan picks the fix up. The helper's test owns the stripper's own planted cases. Some scans also keep a fixture that proves their matcher still sees code after a literal holding a comment opener (see "Self-test the matcher").

### A mis-parse must be an offender, not a clean scan

The stripper has one known ambiguity: a `/` right after `)` or `}` is read as division, so a regex there (`if (x) /re/.test(y)`, or one opening a statement after a block-closing `}`) is misread. A misread that blanks code makes the scan count zero sites in the blanked span, which reads as a clean file. The header of the helper states this limit. `parse-signal-discipline` item 15 holds the general rule: a transform in front of a scanner owes its own could-not-parse verdict. This is how this repo applies it:

- `stripperVerdict(raw, stripped)` (#3573) is a compile oracle. It compiles the raw file and the stripped text under a CommonJS wrapper. Raw compiles but stripped does not: `misparsed`. Raw does not compile (an ESM file, a syntax error): `unparseable`. Neither: `ok`.
- A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text. Five scans do this: windows-hide, git-status, path-guard, path-containment and wall-clock-budget (`tests/wall-clock-budget-conformance.test.js`, which passes the blank-mode stripped text to `stripperVerdict`). All but path-containment push it into their offender list. Path-containment asserts `verdict === 'ok'` per file.
- The exit-code scan does not call `stripperVerdict`. It calls `stripComments` and its own `guardBlankedByStripper(raw, stripped)`, which reports a file whose `require.main === module` guard the stripper blanked. Without it, a file that also exports would read as a guard-less library and be skipped silently.
- The oracle cannot see a mis-parse whose stripped text still compiles. That can keep a comment's text, or blank text inside a multi-line template literal, and it passes unseen. A scan whose matcher reads template or comment text owes a narrower detector for its own case, as the exit-code scan does for its guard.

Pin the planted mis-parse through each scan that calls the verdict, not only through the helper's own tests. The windows-hide, git-status and path-guard scans each have one. The path-containment scan only asserts `ok` over the real tree, so a new scan should add the planted case rather than copy that gap.

### Match every call shape the convention binds

A spawn can be an argv array (`execFileSync('git', [...])`, `runGit([...])`, `deps.git([...])`) or a command string (`execSync('git --no-optional-locks status --porcelain -b')`). The git-status scan matches both:

- `ARGV_STATUS` matches an array whose subcommand element is `'status'`, optionally after a `'-C', <expr>` pair and any top-level `'--…'` options. The operand may contain one level of parentheses, so `path.join(a, b)` still matches.
- `QUOTED` with `GIT_STATUS_CMD` matches a quoted `git … status` that ends the string or is followed by a flag. A message such as `` `git status failed: ${…}` `` does not count.

A scan that matches only one shape stays green when the other shape breaks the rule.

When an option can reach the call through a variable, state which forms the scan accepts and which it rejects. The windows-hide scan accepts a literal `windowsHide` in the call's own argument text, or a bare identifier as the last argument whose `const X = { … }` literal names the key. It rejects a spread (`{ ...QUIET, timeout }`). `gh-api-module-pattern` gives that rule to module authors.

When the token can appear in more forms than one call shape allows (a default `{ realpath = fs.realpathSync }`, `fs['realpathSync'](p)`, optional chaining, a destructured alias), count the identifier instead, as the path-guard scan does.

A callee can also reach the call under a name bound to it, and widening a matcher to one binding shape leaves its neighbours unseen. The windows-hide scan collects every identifier bound to a `child_process` function, the injected-runner seam (`report.js`'s `gitInfo(execImpl = execFileSync)`), and then matches it as a bare call name. #3854 first collected only `X = execFileSync` and `X = cp.execFileSync`. Its scope probe grepped that same shape and task review approved it. Review then found two unhidden spawns in neighbouring shapes: a `deps.execFileSync || execFileSync` fallback (`plugin/bin/lib/repo-resolve.js`) and a `require('child_process').spawn` parameter default (`plugin/bin/lib/verify/run.js`). The scan now also takes `||`/`??` fallbacks, the require-expression form and a semicolon-less alias. Before widening a matcher to a new shape, grep the tree for each syntactic variant of it (parameter default, alias, `||`/`??` fallback, require-expression, property value, a binding ended by a line break) and plant one self-test line per variant. The collection is per file: a property value such as `verify.js`'s `spawnImpl: spawn` hands the function to another file, and the call there is seen only through that file's own binding. A site the wider scan newly flags may also be pinned by its own suite: `tests/bin-lib/verify/run.test.js` asserts `run.js`'s spawn options with `deepStrictEqual`, so adding `windowsHide` there means updating that pin too.

A containment idiom can also reach the matcher split across lines. `plugin/bin/lib/hooks/sweep-shadow.js` once built `rootWithSep = root + path.sep` on one line and tested `runDir.startsWith(rootWithSep)` on the next, so the path-containment scan's same-line `startsWith(… path.sep)` match never saw it. A "no copy remains" claim written from that scan was false until a review lens read the file (#3642). The path-containment scan now also matches the variable-mediated form: an identifier bound (declaration, `=`, `+=`, parameter default) to an expression naming `sep`, then `.startsWith(<that identifier>)` (#3892, which routed that copy through `isPathContained`). Its recall limits, which the claim must name: a right-hand side that starts on the next line is not seen; an object-property binding (`{ rs: root + path.sep }`, then `startsWith(o.rs)`) is not collected; a helper-function return (`startsWith(pre(root))`) is not flagged, because only an identifier or dotted-identifier argument is matched. The bound-name set is file-wide, so a name bound in one function and passed to `startsWith` in another can flag (a conservative false positive). A scan keyed on one literal spelling can back a claim only about that spelling: either widen the matcher to the variable-mediated form, or word the claim as the literal idiom it scans.

### Assert a floor on matched sites

`assert.deepEqual(offenders, [])` over the walk also passes when the matcher matches nothing. For a scan that matches compliant and non-compliant sites alike, assert a lower bound on matches across the tree, and make the message say what a low count means. The git-status scan uses `assert.ok(total >= 12, …)`, and its comment says that fewer matches means the patterns stopped matching, not that the calls went away. Set the floor to the count at the time the scan lands. Raise it when sites are added. Never lower it to make the suite green.

Two scans get the same protection another way. The path-guard scan's exact per-file counts fail when a count drifts either way. The exit-code scan asserts `files.length > 50` over the walk. The windows-hide and path-containment scans have no floor. A scan whose zero-offender result is the expected one needs the planted self-test below to show its matcher can still match.

### Self-test the matcher

Each scan has a self-test that feeds hand-built lines to the matcher and asserts which ones it flags. The helper's test, `tests/helpers-strip-comments.test.js`, owns the stripper's own planted cases (a comment holding `*/`, `'/*'` in a string, a glob in a template literal, a regex ending in an escaped slash). A scan adds planted cases for what it owns: its matcher, and any mis-parse detector it adds. Four scans also keep a fixture that plants a fake comment opener and asserts the matcher still sees the call after it:

- `tests/windows-hide-spawn-conformance.test.js`: a `// see staged/** here` comment, a `'/*'` string and a regex ending in `\/`, each followed by an unhidden spawn.
- `tests/git-status-optional-locks.test.js`: the same three openers plus a template-literal glob, each followed by an unflagged `status` call.
- `tests/path-guard-conformance.test.js`: a `work/*-spec.md` line comment, with live `existsSync` and `realpathSync` calls after it that must still count ("proves the single-pass stripper").
- `tests/bin-lib/exit-code-conformance.test.js`: a guard after a string holding `/*` is still scanned. This is the exit-code scan's planted `/*` case, and it proves the guard region survives the stripper.

Keep such a fixture when the scan's result depends on code that follows a literal. A new scan need not copy all of them, since the helper's own test covers the stripper itself.

Include negative cases:

- the convention's token inside a comment
- a message string that contains the command
- a different tool using the same word, such as `execFileSync('gh', ['auth', 'status'])`

Assert the exact flagged line numbers, not just a count, because the right count can come from the wrong lines. Run each new assertion against the code it guards with the guard removed, and watch it go red.

## Decision Framework

| Situation | Do this |
|---|---|
| A new convention over `plugin/bin` code with a clean token or call-shape signature | Add a new `tests/*-conformance.test.js` scan with the walk, the shared `stripComments` helper, `stripperVerdict` as an offender, every call shape, a floor and matcher self-tests |
| The token can appear in more forms than one call shape (aliases, defaults, bracket access) | Count tokens rather than call shapes, and keep an allowlist with per-file counts (`tests/path-guard-conformance.test.js`) |
| The property depends on enclosing structure, such as code under a guard block | Extract the governed region first, then match inside it (`guardRegionFor` in `tests/bin-lib/exit-code-conformance.test.js`), and add a detector for a region the stripper blanked |
| A module cannot import the shared helper the scan enforces (a builtins-only module such as `plugin/bin/lib/visual-decide/server.js`, #1202 AC 8) | Exempt it by invariant, never silently: keep a hand-mirrored copy commented as a mirror of the helper, name it in the scan's exception list, and pin it with an agreement test that compares its accept/reject verdict to the shared primitive over a table of inputs (the `#3642` agreement case in `tests/bin-lib/path-guard/callers-characterization.test.js`) |
| Changing a stripper behavior | Edit `tests/helpers/strip-comments.js`, add the planted case to `tests/helpers-strip-comments.test.js` first, and watch it fail against the old code |
| Changing an existing scan's matcher | Add the planted case that motivated the change to its self-test first, and watch it fail against the old code |

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| A hand-rolled comment stripper in a scan | A second copy drifts from the helper, and the helper owns the stripper's planted tests. The two-pass form `replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')` is blind to literals: a `/*` inside a line comment opened a block comment that blanked live code, and four `plugin/bin` files were undercounted that way (`tests/path-guard-conformance.test.js` header) |
| Counting tokens in stripped text with no verdict check | A mis-parse blanks code and the scan reports zero sites over it, which looks like a clean tree |
| Reading `stripperVerdict` `ok` as proof the text was stripped correctly | It only catches a mis-parse that breaks compilation. A misread that still compiles passes unseen |
| Deleting comments instead of replacing them with spaces | Line numbers in offender messages no longer match the file |
| A scan with no floor on matched sites | A pattern that stops matching reports zero offenders, and that looks like a clean tree |
| Self-tests that cover only the happy path | The right count can come from the wrong lines, and a matcher can go dead without a negative case failing |
| Walking `plugin/bin` with `fs.readdirSync(dir, { recursive: true })` | Node before 18.17 ignores the option, so the walk silently covers only the top level and the scan reports zero offenders over `lib/`. The project floor is Node 18; use the manual `withFileTypes` walk (`listJs` in `tests/path-containment-conformance.test.js`) and a floor on files walked. The #3811 AC3 pin shipped with the recursive form, and the exit-code scan's `walkFilesRelative` comment already named the hazard |
| A new scan written inside a per-module suite as a raw-text regex | It skips the stripper, the verdict, the floor and the planted cases above, and matches one spelling. The #3811 AC3 pin did, passed the build's whole-branch review with a rename only, and was rebuilt in review as its own conformance file. Start from the sibling scan, not from the spec's grep line |
| Reading a green token-count scan as proof that a new call follows the convention | A count-based scan sees tokens, not call sites, so a new call through a wrapper the file already has allowlisted adds no token and passes. #3799's first fix sent `verify.js`'s new git-dir comparison through the file's own `realpathOrNull`, a JS `fs.realpathSync` wrapper holding the one allowlisted token. `tests/path-guard-conformance.test.js` went green, and review then reproduced a case-variant `--cwd` into the same checkout being refused on a case-insensitive volume. The fix resolved both sides through path-guard's `canonicalRealpath` and removed the allowlist entry. When a count scan goes red, decide what the new call must answer before restoring the count |
| Reading the path-containment scan's "use `isPathContained`" as the fix for every containment check | `isPathContained` is lexical: it compares already-resolved strings and follows no symlink. `docs/donts.md` `[IL-161]` requires path-guard's `resolveWithin` for an existing read target (or a write's existing parent). #3880 replaced a hand-rolled `startsWith(… path.sep)` in `plugin/bin/lib/reconcile/console-execute.js`'s `readInsideRunDir` with `isPathContained` (`d76e62881`), which turned the scan green. Review then reproduced a symlink planted inside the run dir being followed out of it, and the fix moved to `resolveWithin` with a symlink test that goes red without it. The scan proves the idiom is gone, not that the replacement answers the right question: when it flags a site, first ask whether the path exists and is read or written. If it is, use `resolveWithin` |

## Reference

- Instances: `tests/git-status-optional-locks.test.js`, `tests/windows-hide-spawn-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js`, `tests/path-containment-conformance.test.js`, `tests/porcelain-cwd-compare-conformance.test.js`
- Shared helper and its planted cases: `tests/helpers/strip-comments.js` and `tests/helpers-strip-comments.test.js`
- Could-not-parse principle: `.claude/skills/parse-signal-discipline/SKILL.md`, item 15
- Rule: the `--no-optional-locks` line in `docs/donts.md`
- Prose-pinning counterpart: `.claude/skills/skill-prose-conformance-tests/SKILL.md`
