# Shared Literal-Aware Comment Stripper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `plugin/bin` source-scan test strips comments through one shared, literal-aware stripper, and the exit-code scan can no longer be blinded by a `/*` inside a string.

**Architecture:** One helper, `tests/helpers/strip-comments.js`, holds the single-pass stripper #3464 shipped (now copied verbatim at `tests/git-status-optional-locks.test.js:43` and `tests/windows-hide-spawn-conformance.test.js:43`). All four scans require it, and their local copies are deleted. The helper gets its own unit suite, and the exit-code scan gets a planted go-red self-test.

**Tech Stack:** Node 18+, `node:test`, `node:assert/strict`. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T065850-spec-3536/work/3536-spec.md`

## Global Constraints

- Test-only change. Nothing under `plugin/` is modified.
- Comments are blanked, never deleted: every non-newline character of a comment becomes a space, so offsets and line numbers stay stable.
- AC1.1: `grep -rn "replace(/\\/\\*\[\\s\\S\]\*?\\*\\//g, '')" tests/` returns nothing. **No committed file may contain the old two-pass regex, including as a test control.** The go-red proof against it is done by a temporary revert, not committed.
- `tests/helpers/*.js` files are not `*.test.js`, so `npm test`'s glob does not run them. The helper's suite lives at `tests/helpers-strip-comments.test.js`, matching the existing `tests/helpers-git-fixtures.test.js` naming.
- Commit messages: `{Verb} {what} — {detail} (refs #3536)`, never a closing keyword, ending with the `Claude-Session:` trailer.

## Review Focus

1. **Offset stability.** The git-status scan reports offender line numbers via `src.slice(0, index).split('\n').length` on stripped text. Any stripper that changes length or moves a newline shifts every reported line. Pinned in Task 1: output length equals input length, and newline indices are identical.
2. **An escaped quote inside a string** (`'it\'s /* not a comment'`). The string branch must consume `\'` and keep going, or the `/*` escapes the string and blanks code. Pinned in Task 1.
3. **A multi-line template literal holding `//` or `/*`.** The template branch spans newlines; the single-quote and double-quote branches must not. Pinned in Task 1.
4. **A quote inside a regex literal** (`/'/.test(s); // note`). Regex literals are not modeled. The invariant to keep is that a mis-parse can only *keep* text (a loud false positive), never blank code. Pinned in Task 1: the code before and after the regex on that line survives.
5. **path-guard's counts after the swap.** The shared stripper keeps code after an escaped `\//` that path-guard's own stripper blanked (22 files differ textually). A probe found identical `realpathSync`/`existsSync` counts on all 22, so `ALLOWLIST` needs no edit. Task 3 runs the full path-guard suite to confirm.

---

### Task 1: Shared helper, its suite, and the two identical copies

**Files:**
- Create: `tests/helpers/strip-comments.js`
- Create: `tests/helpers-strip-comments.test.js`
- Modify: `tests/git-status-optional-locks.test.js:33-48` (delete the local `stripComments` and its comment block, add a require)
- Modify: `tests/windows-hide-spawn-conformance.test.js:34-48` (same)

**Interfaces:**
- Produces: `module.exports = { stripComments }`, where `stripComments(src: string): string`. Body copied byte-for-byte from `tests/git-status-optional-locks.test.js:43-48`. Move the explanatory comment block (lines 33-42 there) onto the helper, generalized: drop "mentions a call shape", and keep the single-pass, literal-first, `(?<!\\)` and "can only leave comment text in" sentences. Each consumer keeps one line in place of its old block: `// Comments blanked in one literal-aware pass — see tests/helpers/strip-comments.js.`

- [ ] **Step 1: Write the failing suite** `tests/helpers-strip-comments.test.js`, requiring `./helpers/strip-comments`:
  - `'blanks comments to spaces and keeps every offset and newline'`: input `"a(); // x\n/* y\nz */ b();"`. Assert `out.length === input.length`, the newline indices are equal, and `out` contains `a();` and `b();` but neither `x`, `y` nor `z`.
  - `'a /* or // inside a string, template or line comment opens no comment'`: fixture lines `"const g = '/*';"`, `'live1();'`, `'// see work/*-spec.md'`, `'live2();'`, `'const t = `${d}//x/*`;'`, `'live3();'`, `'/* end */'`. Assert `live1();`, `live2();` and `live3();` all survive.
  - `'an escaped quote does not end the string'`: `"const s = 'it\\'s /* no'; live();"`. `live();` survives and `/* no` is kept.
  - `'a multi-line template keeps its // and /*; a quoted string does not cross a newline'`: ``"const t = `a\n// b\n/* c`; live();"``. Everything survives. Then `"const s = 'x\n// gone"`: `// gone` is blanked.
  - `'a regex ending in an escaped slash is not a // comment'`: `"r.replace(/^origin\\//, ''); live();"`. `live();` survives.
  - `'a quote inside a regex literal may keep text but never blanks code'`: `"/'/.test(s); live(); // note"`. `live();` survives.

- [ ] **Step 2: Run** `node --test tests/helpers-strip-comments.test.js`. Expected: FAIL, `Cannot find module './helpers/strip-comments'`.

- [ ] **Step 3: Create** `tests/helpers/strip-comments.js` per the Interfaces block (`'use strict'`, the generalized comment, the copied function, the export). Swap both scans to `const { stripComments } = require('./helpers/strip-comments');` and delete their local copies.

- [ ] **Step 4: Run** `node --test tests/helpers-strip-comments.test.js tests/git-status-optional-locks.test.js tests/windows-hide-spawn-conformance.test.js`. Expected: all pass. The scans' existing "proves it can go red" tests already plant `/*` and escaped-slash fixtures through each scanner.

- [ ] **Step 5: Commit** the four files: `Share one literal-aware comment stripper across the source scans — tests/helpers/strip-comments.js replaces two copies (refs #3536)`.

### Task 2: Exit-code scan uses the shared stripper, plus a go-red self-test

**Files:**
- Modify: `tests/bin-lib/exit-code-conformance.test.js:49-57` (delete the "Naive comment stripping" comment and the two-pass `stripComments`, then `require('../helpers/strip-comments')`)
- Test: same file, a new test after `findDirectProcessExit`

**Interfaces:**
- Consumes: `stripComments` from Task 1.
- Uses the file's existing `guardRegionFor(content)` and `findDirectProcessExit(guardText)` unchanged.

- [ ] **Step 1: Write the self-test** `'a guard after a string holding /* is still scanned (proves the literal-aware stripper)'`. Use the fixture `["const pattern = 'work/*-spec.md';", 'if (require.main === module) process.exit(main());', '/* trailing note */'].join('\n')`, then assert `findDirectProcessExit(guardRegionFor(stripComments(fixture))).length === 1`.

- [ ] **Step 2: Run it against the OLD stripper (AC2.1, red half).** Add the test while the two-pass `stripComments` is still in the file, and run `node --test tests/bin-lib/exit-code-conformance.test.js`. Expected: the new test FAILS (`0 !== 1`). The old stripper deletes from the string's `/*` to the trailing `*/`, which takes the guard with it. Record the failing output for the handoff. Do not commit this state.

- [ ] **Step 3: Swap in the shared stripper.** Delete the local `stripComments` and its comment block, and add `const { stripComments } = require('../helpers/strip-comments');`.

- [ ] **Step 4: Run** `node --test tests/bin-lib/exit-code-conformance.test.js` (AC2.1 green half and AC3.2). Expected: all tests pass, including the unchanged "every require.main guard…" scan, which still reports zero violations, and the allowlist test.

- [ ] **Step 5: Run the AC1.1 grep:** `grep -rn "replace(/\\/\\*\[\\s\\S\]\*?\\*\\//g, '')" tests/`. Expected: no output (exit 1).

- [ ] **Step 6: Commit** `tests/bin-lib/exit-code-conformance.test.js`: `Harden exit-code-conformance's comment stripper — shared literal-aware stripper and a planted /* self-test (refs #3536)`.

### Task 3: Fold path-guard-conformance's stripper into the helper

**Files:**
- Modify: `tests/path-guard-conformance.test.js:32-53` (delete `TOKEN` and the local `stripComments`, require the helper, and narrow the comment block)

**Interfaces:**
- Consumes: `stripComments` from Task 1, a drop-in replacement for the local one (same blank-don't-delete contract, strings kept verbatim).

- [ ] **Step 1: Swap** to `const { stripComments } = require('./helpers/strip-comments');`. Keep the comment's first paragraph (why the stripper is single-pass, why strings stay verbatim) as a short pointer to the helper. Rewrite the "Regex literals are NOT modeled" paragraph to say:
  - A regex ending in an escaped slash (`/^https?:\/\//`, `/src\/*.js/`) no longer opens a comment, because both openers carry the `(?<!\\)` guard.
  - A quote inside a regex can still pair with a later quote on the same line, which can only keep comment text in, never blank code.
  - Computed member access (`fs['realpath' + 'Sync']`, `fs[name]`) is still not seen.
  - Drop the "one-time audit" sentences that applied to the old escaped-slash blind spot.

- [ ] **Step 2: Run** `node --test tests/path-guard-conformance.test.js`. Expected: all pass, including `AC3.1: passes on the current tree` with `ALLOWLIST` unedited (Review Focus 5) and the existing `/* inside a line comment` self-test.

- [ ] **Step 3: Confirm one definition:** `grep -rn "function stripComments" tests`. Expected: exactly one line, `tests/helpers/strip-comments.js`.

- [ ] **Step 4: Commit** `tests/path-guard-conformance.test.js`: `Fold path-guard-conformance's comment stripper into the shared helper — escaped-slash regexes no longer blank code (refs #3536)`.

### Final verification (AC3.1)

- [ ] `npm test > <scratchpad>/npm-test-3536.txt 2>&1; echo "exit=$?" >> <scratchpad>/npm-test-3536.txt`, then read the `# pass` / `# fail` lines and `exit=`. Expected: `# fail 0`, `exit=0`.
