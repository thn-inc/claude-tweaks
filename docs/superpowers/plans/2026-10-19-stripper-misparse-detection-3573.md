# Comment-Stripper Mis-Parse Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the windows-hide, git-status and path-guard source scans fail loudly when the shared comment stripper mis-parses a file, instead of silently undercounting.

**Architecture:** Blanking a real comment to spaces never breaks JavaScript syntax; a mis-parse that blanks live code cuts a string, regex or template literal short and does. One tri-state helper, `stripperVerdict`, in `tests/helpers/strip-comments.js` compiles the raw and the stripped text as a CommonJS module body with `node:vm` and reports `'ok' | 'misparsed' | 'unparseable'`. Each of the three scans calls it inside its own per-file function, so a planted self-test exercises the same code the live-tree test runs.

**Tech Stack:** Node 18+, `node:test`, `node:vm` (no dependencies).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T092202-spec-3573/work/3573-spec.md`

## Global Constraints

- Test-only change: nothing under `plugin/` changes.
- On the current tree every scan reports the same verdicts as before: no new violations, no detector hits. Probed: all 419 `plugin/bin` `.js` files compile both raw and stripped.
- `tests/bin-lib/exit-code-conformance.test.js` and its `guardBlankedByStripper` stay untouched.
- `countGuardedTokens` in `tests/path-guard-conformance.test.js` keeps its `{ realpathSync, existsSync }` return shape (a `deepEqual` pins it).
- Test assertions compare against literal expected strings, never against the helper's exported constants.
- Commit messages use `{Verb} {what} — {detail}` with `(refs #3573)` and end with `Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH`.

## Review Focus

1. A `plugin/bin` CLI starting with `#!/usr/bin/env node` must read `'ok'`, not `'unparseable'`: the hashbang is dropped before wrapping (Task 1 test).
2. A CommonJS file with a top-level `return` must read `'ok'`: the function wrapper allows it (Task 1 test).
3. A raw file that does not compile at all must read `'unparseable'` and be reported, never passed as clean (Task 1 test, plus one scan-level case in Task 2).
4. The existing self-test fixtures in all three scans must still compile raw, or they would start reporting `'unparseable'`. Task 2 Step 4 runs them unchanged.
5. A mis-parse inside a lazily compiled inner function body must still be caught: V8's preparser reports the SyntaxError at compile time (Task 1 test).

---

### Task 1: `stripperVerdict` in the shared helper

**Files:**
- Modify: `tests/helpers/strip-comments.js` (add the function and the messages export; update the header comment at lines 10-13)
- Test: `tests/helpers-strip-comments.test.js`

**Interfaces:**
- Consumes: `stripComments(src)` (same file).
- Produces:
  - `stripperVerdict(raw: string, stripped: string = stripComments(raw)) -> 'ok' | 'misparsed' | 'unparseable'`
  - `STRIPPER_VERDICT_MESSAGES: { misparsed: string, unparseable: string }`, with exactly:
    - `misparsed`: `'the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned'`
    - `unparseable`: `'this file does not compile as a CommonJS module, so the comment-stripper check cannot judge it'`
  - `module.exports = { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES }`

- [ ] **Step 1: Write the failing tests** in `tests/helpers-strip-comments.test.js`, requiring `stripperVerdict` from `./helpers/strip-comments`:
  - `'stripperVerdict reads real comments, a hashbang and a top-level return as ok'`
    - `stripperVerdict("// a /* b\nconst s = 'x // y'; /* multi\n line */ live();")` equals `'ok'`
    - `stripperVerdict('#!/usr/bin/env node\n// x\nlive();')` equals `'ok'`
    - `stripperVerdict('if (x) return 1;\nlive();')` equals `'ok'`
  - `'stripperVerdict reports each reproducing mis-parse shape as misparsed'`, each equal to `'misparsed'`:
    - `"const x = 'a'; const a = /'/.test(x); const b = 'p//q'; fs.realpathSync(b);"`
    - `'const a = /"/; const b = "//"; live();'`
    - `` 'const a = /`/; const b = `x // y`; live();' ``
    - `'const re = /[/*]/; live(); /* c */'`
    - `'function outer() { function inner() { const re = /[/*]/; live(); } return inner; } /* c */'` (a lazily compiled body)
  - `'stripperVerdict reports raw text that does not compile as unparseable'`
    - `stripperVerdict('const a = ;')` equals `'unparseable'`
  - `'stripperVerdict judges a supplied stripped text'`
    - `stripperVerdict('live();', 'live(')` equals `'misparsed'`

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/helpers-strip-comments.test.js`
Expected: FAIL, `stripperVerdict is not a function`, while the existing 6 tests still pass.

- [ ] **Step 3: Implement `stripperVerdict` in `tests/helpers/strip-comments.js`**

`compiles(src)` returns true when `new vm.Script('(function (exports, require, module, __filename, __dirname) {' + src.replace(/^#![^\n]*/, '') + '\n})')` constructs. It returns false when the thrown error's `name` is `'SyntaxError'` and rethrows anything else. Use `e.name`, never `instanceof`.

`stripperVerdict` returns `'unparseable'` when the raw text doesn't compile, `'misparsed'` when the raw text compiles but the stripped text doesn't, and `'ok'` otherwise.

Replace the header's last two sentences ("Either can blank code after it. Nothing under plugin/bin trips this today, but nothing enforces that.") with text saying three things:
- Either can blank code after it.
- `stripperVerdict` catches that: a blanked comment never breaks syntax, but blanked code cuts a literal short. Its caveat is that a mis-parse which still compiles goes unseen.
- The windows-hide, git-status and path-guard scans call it per file.

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/helpers-strip-comments.test.js`
Expected: PASS, 10 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/strip-comments.js tests/helpers-strip-comments.test.js
git commit -m "Add stripperVerdict to the shared comment stripper — a stripped text that stops compiling is a mis-parse that blanked code (refs #3573)" -m "Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH"
```

---

### Task 2: Mis-parse detectors in the three scans

**Files:**
- Modify: `tests/windows-hide-spawn-conformance.test.js` (`unhiddenCalls`, lines 66-93; one new test after line 129)
- Modify: `tests/git-status-optional-locks.test.js` (`unflaggedStatusCalls`, lines 48-70; one new test after line 113)
- Modify: `tests/path-guard-conformance.test.js` (`evaluate`, lines 68-87; the comment at lines 41-47; one new test after line 191)

**Interfaces:**
- Consumes: `stripperVerdict(raw, stripped)` and `STRIPPER_VERDICT_MESSAGES` from `tests/helpers/strip-comments.js` (Task 1).
- Produces: no new exports. Each scan's existing per-file function now reports a non-`'ok'` verdict as a whole-file finding, in addition to any offenders it finds:
  - `unhiddenCalls(raw)` appends `{ line: 0, args: STRIPPER_VERDICT_MESSAGES[verdict] }`. Keep its early `return []` when the raw text lacks `child_process`.
  - `unflaggedStatusCalls(raw)` appends `{ line: 0, text: STRIPPER_VERDICT_MESSAGES[verdict] }` to `offenders`. Line 0 sorts first, and `matched` is unchanged by it.
  - `evaluate(files, allowlist)` pushes `` `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}` `` per file, before that file's count checks.

- [ ] **Step 1: Write the failing self-tests**, one per scan, each with a different reproducing shape:
  - windows-hide: `'a comment-stripper mis-parse is reported, not passed as a file with no calls'`
    - `unhiddenCalls(["const cp = require('child_process');", "const x = 'a'; const a = /'/.test(x); const b = 'p//q'; cp.execFileSync('git', [b], {});"].join('\n'))` deep-equals `[{ line: 0, args: 'the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned' }]`
    - `unhiddenCalls("const cp = require('child_process'); const = ;")` deep-equals `[{ line: 0, args: 'this file does not compile as a CommonJS module, so the comment-stripper check cannot judge it' }]`
  - git-status: `'a comment-stripper mis-parse is reported, not passed as a file with no status calls'`
    - `unflaggedStatusCalls("const re = /[/*]/; runGit(['status']); /* c */")` deep-equals `{ matched: 0, offenders: [{ line: 0, text: 'the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned' }] }`
  - path-guard: `'a comment-stripper mis-parse is reported, not counted as zero tokens'`
    - `evaluate({ 'lib/x.js': 'const a = /"/; const b = "//"; fs.existsSync(b);' }, {})` deep-equals `['lib/x.js: the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned']`

- [ ] **Step 2: Run them and see each fail**

Run: `node --test tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js`
Expected: the three new tests FAIL. Each scan returns no finding (`[]`, `offenders: []`, `[]`) because the planted call is blanked. Every pre-existing test still PASSES.

- [ ] **Step 3: Add the detector to each per-file function** as the Interfaces block says.

Each function computes `stripComments(raw)` once and passes it as `stripperVerdict`'s second argument.

In `tests/path-guard-conformance.test.js`, update the comment at lines 41-47. Replace "Nothing under plugin/bin trips this today, but nothing enforces that." with a sentence saying that `evaluate` now reports any file the stripper mis-parses (via `stripperVerdict`). Keep the computed-member-access sentence.

- [ ] **Step 4: Run the three files and see them pass**

Run: `node --test tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js`
Expected: PASS with 0 failures. That includes every pre-existing self-test fixture (unchanged, so they still compile raw) and the three live-tree tests (no detector hits on the current tree).

- [ ] **Step 5: Prove each self-test discriminates (revert to red)**

For each scan in turn:
1. Delete only that scan's detector line(s) in the working tree.
2. Run that one file with `node --test <file>`.
3. Confirm its new self-test FAILS with the planted call unreported.
4. Restore it with `git checkout -- <file>`.
5. Re-run the file and confirm it PASSES.

Quote the failing assertion output for each of the three in the task report.

- [ ] **Step 6: Commit**

```bash
git add tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js
git commit -m "Report comment-stripper mis-parses in the windows-hide, git-status and path-guard scans — a planted mis-parse now fails each suite instead of undercounting (refs #3573)" -m "Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH"
```
