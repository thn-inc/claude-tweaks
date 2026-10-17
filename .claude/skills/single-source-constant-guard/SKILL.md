---
name: single-source-constant-guard
description: Use when writing or reviewing a `node --test` guard that keeps one kind of constant defined in exactly one file — it scans `tests/` and `plugin/bin/` for any other file that declares or compares against such a number. Covers the two rules, seeding and propagating taint line by line, the `unclassified` bucket, the per-entry allowlist, and proving recall against the real pre-change tree as well as synthetic fixtures. Keywords - single source, anti-scatter guard, taint scanner, scanText, unclassified, allowlist, budgets.js, decision 0024, skill-size-single-source, recall.
---

# Single-source constant guard

## Overview

Decision 0024 makes `plugin/bin/lib/skill-audit/budgets.js` the only file under `tests/` or `plugin/bin/` that may define a skill-size number. `tests/skill-size-single-source.test.js` (#3311) enforces it with a line-based taint scanner, `scanText(text) -> { violations, unclassified }`. Use the same shape for the next "only X may define Y" rule. Line-based scanning is a choice: it is cheap and has no dependencies, and its blind spots are listed rather than solved.

## Key Patterns

### Two rules: a declaration rule and a comparison rule

- **Rule (a), declaration by name.** A `const`/`let`/`var` whose name says it is a limit (`*CEILING*`/`*BUDGET*` plus a `_BYTES`/`_CHARS` suffix, in either order) and whose value contains a digit. A value from `require(...)` is clean, so the single source can still be imported.
- **Rule (b), comparison by taint.** A line that references a tainted value, contains a size measure (`Buffer.byteLength`, `.bytes`, `.size`, `.length`, `measuredBytes`, or a bare size-named identifier such as `size`, `fileSize`, `skillBytes`) and compares it (`<`, `<=`, `>`, `>=`) against a literal of 1024 or more, or against `N * 1024`.

Match the rules against code only. Replace string and template contents with `""` first, so a message like `'expected < 8000 bytes'` never fires. Read the taint seed from the line before that stripping, though: the path being guarded usually is a string.

### Seed taint, then propagate it forward

- **Seeds:** a path token (`plugin/skills`, `'skills/'`, a bare `'skills'` argument to `path.join`), or a call to a measurement export (`MEASURE_API`: `composedBytesReport(`, `measureSkills(`, …). The second catches a size read through the API with no path in sight.
- **Propagation:** a declaration whose right-hand side references a tainted name taints the new name. So does every entry of a multi-line object or array literal that is still open, and the bindings of a `for (const [p, budget] of …)` over a tainted value.
- **Laundered literals:** a plain identifier declared with a large numeric literal (`const maxBytes = 40960;`) resolves as that number when it later appears as a comparison operand. A lowercase name then cannot slip a limit past rule (b).

### `unclassified` is its own outcome

A size comparison whose operand the scanner cannot resolve (an UPPER_CASE constant, or a name containing ceiling/budget/cap) goes into `unclassified`, not `violations`, and the test fails on either list. This is `parse-signal-discipline` applied to code. Never fold "could not tell" into "clean". The rail's own names (`RAIL_BYTES`, `RAIL_LINES`, `RAIL_TOKENS`, `DESCRIPTION_MAX_CHARS`) are exempt by name.

### The allowlist is named, reasoned and checked for existence

`ALLOWLIST` is a `Map` from path to reason. A second test asserts that every entry still exists and that its reason is more than 20 characters. Each entry must name a number that is about something other than the guarded artifact: `tests/claude-md-budget.test.js` (CLAUDE.md's budget), and a 35 KB fixture-discrimination check. Entries cover whole files. That is a deliberate design (#3311 final review), so do not allowlist a file that also holds real pins.

## Decision Framework

| Question | Answer |
|---|---|
| Can the scanner resolve the operand to a number? | Large literal or laundered literal: violation. Rail name: clean. Unresolvable named constant: `unclassified`. |
| Is the number about the guarded artifact? | Yes: delete it, or move it into the single source. No: allowlist the file with its reason. |
| Is the miss a cheap single-line shape (a tainted `.length`, a lowercase literal variable, a bare `size` variable)? | Fix the scanner in the same change, with a go-red self-test of the exact shape, as #3311 did for all three. |
| Does catching the miss need a parser (multi-line comparisons, helper-returned taint, destructuring)? | Record it as a known limit. Do not grow the regex into a parser. |

## Project Conventions

- The scope is `*.js` under `tests/` and `plugin/bin/`, skipping `node_modules` and dot-directories. A file outside that scope gets an explicit verdict in the record: `plugin/skills/design-wrapper/compare-shell/seed-compare.mjs`'s `SIZE_WARNING_BYTES` is an output-size warning, not a skill size (#3311 final review).
- Ship go-red self-tests with the guard: one fixture per rule, one per propagation path (chained variables, a multi-line literal with `for…of`, a call to the measurement API), and a must-not-flag block (a fixture path, a comparison inside a string, a rail comparison, a small literal).
- `scanText` is exported from the test file. Move it to `tests/helpers/` when a second guard first reuses it, because `require`-ing a test file runs its tests (#3311 final review).

## Common Operations

```bash
node --test tests/skill-size-single-source.test.js
# Recall check: scan one pre-change file with the live scanner (repeat for each file the change edits).
git show {base}:tests/{file}.test.js > "$TMPDIR/base.js"
node -e "const {scanText}=require('./tests/skill-size-single-source.test.js'); console.log(JSON.stringify(scanText(require('fs').readFileSync(process.env.TMPDIR+'/base.js','utf8'))))"
```

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Proving the guard only with synthetic fixtures | The fixtures prove that the rules fire on the shapes their author pictured. They say nothing about recall over the real tree. #3311's guard first reported `tests/release-lifecycle-byte-budget.test.js` clean while that file still pinned `wrap-up/SKILL.md` and `tidy/scan-procedures.md`. Its measure sat in a bare `size` variable, which `SIZE_MEASURE` then did not match (it needed `.size`, `bytes`, `.length`, …), so neither comparison was examined, even though the scanner had already resolved `SCAN_PROCEDURES_BASELINE = 42466` as a laundered literal. `WRAP_UP_CEILING` has no `_BYTES` suffix, so rule (a) missed it too. Only a wrap-up curation read caught it; the file was then deleted and `SIZE_MEASURE` widened. Run the scanner over each pre-change file the change deletes pins from (`git show <base>:<file>`), and confirm that every deleted pin would have been flagged. |
| Seeding rule (a) from one naming vocabulary | A limit can be named `WRAP_UP_CEILING`, `SCAN_PROCEDURES_BASELINE` or `MAX_SKILL_BYTES` (#3311 final review). A name rule needs the comparison rule behind it. |
| Asserting the AC's "no literal remains" grep over the whole tree | The guard's own self-test fixtures match it. Add `':!tests/skill-size-single-source.test.js'` to the sweep, and list the fixture lines in the PR body (spec decision 2, #3311). |
| Matching `MEASURE_API` by method name alone | `x.totalBytes(...)` on any receiver seeds taint. It is a false positive that fails loud, so it is tolerable, but it is not a true positive (#3311 final review). |

## Reference

- Guard: `tests/skill-size-single-source.test.js`. Single source: `plugin/bin/lib/skill-audit/budgets.js`. Decision: `docs/decisions/0024-skill-size-limits-guard-platform-limits-only.md`.
- Known line-based limits (accepted at #3311's final review): multi-line comparisons, left-side literals, equality pins, `40 * 1000`/`4e4` spellings, destructured/reassigned/helper-returned taint, relative `../skills/` paths, multi-line or object-property constant declarations, `MAX_SKILL_BYTES`-style names, `//` inside strings, a `MEASURE_API` name matching a same-named method on any receiver, and whole-file allowlist entries.
- Related skills: `parse-signal-discipline` (the `unclassified` outcome), `skill-prose-conformance-tests` (go-red proofs, and the whole-file-sweep-with-allowlist instances over skill prose).
- Origin: #3311.
