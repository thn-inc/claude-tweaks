# TAP Block Reuse in the Windows Regression Filer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/windows-regression/file-issue.js` builds its failure excerpts on a TAP line classifier exported from `plugin/bin/lib/verify/extract.js`, instead of re-deriving TAP boundaries with its own regexes.

**Architecture:** Factor the state machine inside extract.js's private `tapBlocks` into an exported per-line classifier, `tapLines(lines)`, and rebuild `tapBlocks` on it so every existing extract.js output is byte-identical. `excerptFor` in file-issue.js then reads line kinds, indents and block ownership from `tapLines` rather than matching `ok N` / `# Subtest:` / `...` / `not ok` itself.

**As built (architecture alignment, Beneficial):** the spec asked for a helper returning "the failing block for a file, with its YAML terminator"; the export is the lower-level per-line classifier instead, from which the consumer derives both (a block = the lines sharing an `owner`; its terminator = the owned `yamlClose`). One classifier now drives both `tapBlocks` and the filer, so the TAP boundary rules live in exactly one state machine. Because `owner` runs past the terminator (to the next test point or `# ` line, matching `tapBlocks`' `body`), the filer stops ownership at the block's `yamlClose` via `ownerAt` — a rule the plan's Task 2 Step 2 originally missed (fixed in `ac627fd68` and `72bf6c6d8`).

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183722-record-3404/work/3404-spec.md` (record #3404)

Scope keywords: tapBlocks, excerptFor

## Global Constraints

- Export the helper from `plugin/bin/lib/verify/extract.js` "without changing extract.js's existing outputs".
- Excerpt contract: "open at the file's `not ok` (or a crashed file's stderr), stop at the next sibling test line, cap 12 lines" (`EXCERPT_MAX_LINES = 12`, unchanged).
- `file-issue.js` must no longer contain its own boundary regexes for `ok N` / `# Subtest:` / `...`.
- `tests/windows-regression-file-issue.test.js` and `tests/bin-lib/verify/extract.test.js` pass with no edits to any existing test.
- `tools/` is maintainer-only; it may `require` from `plugin/` (the workflow's `file` job does a full `actions/checkout@v4`). `plugin/` must never require from `tools/`.

## Review Focus

1. **CRLF log text** — `file-issue.js` splits on `\r?\n`, but `tapLines` is also called by extract.js on `\n`-split text; a `\r`-terminated `  ...` must still close YAML. Pinned by Task 1's CRLF test.
2. **A `...` or `ok 1` line inside a failure's error text** — must stay YAML body, never a boundary (existing F1 test; Task 1 pins the classifier side).
3. **A crashed file's stderr directly after another file's YAML terminator** — excerpt opens on the first stderr line (existing F1 run-39034279077 and L21 tests).
4. **A nested `not ok` with no YAML block whose error text holds a deeper `ok N`** — excerpt ends at the same-indent sibling (existing R3 test; Task 1 pins that the deeper line classifies as `ok` at its own indent).
5. **Real Windows logs** — every excerpt the old filer produced from a real `tests.log` must come out identical (Task 2's real-input probe).

---

### Task 1: Export `tapLines` from extract.js and rebuild `tapBlocks` on it

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js` (the `tapBlocks` function and `module.exports`)
- Test: `tests/bin-lib/verify/extract.test.js` (append new tests only)
- Reviewed, no change: `docs/journeys/run-a-deterministic-verification-check.md` (cites #3153 tapBlocks behavior this plan keeps byte-identical)

**Interfaces:**
- Produces: `tapLines(lines: string[]) => Array<{ kind, indent, owner, key, keyStart }>`, one entry per input line, exported from extract.js:
  - `kind`: `'notOk'` (`^\s*not ok\b`) | `'ok'` (`^\s*ok \d`) | `'subtest'` (`^\s*# Subtest:`) | `'comment'` (any other `^\s*# ` line) | `'yamlOpen'` (a line equal to the last point's indent + `'  ---'`) | `'yaml'` (inside that block) | `'yamlClose'` (the line equal to the `---` line's indent + `'...'`) | `'other'`. Classification order and state transitions are exactly `tapBlocks`' current ones: YAML state first, then `---`, then `not ok`, then `ok N`, then `# `; a `# ` line clears the last point's indent (no `---` can open after it until the next point).
  - `indent`: length of the CR-stripped line's leading whitespace.
  - `owner`: index of the `not ok` line whose block contains this line (that `not ok` line itself, its body, its `---`, YAML lines and `...` included), else `-1`. Ownership ends exactly where `tapBlocks`' `current` is reset today (an `ok N` point at any indent, a `# ` line).
  - `key`: on `'yaml'` lines, the top-level YAML key in force (`tapBlocks`' `yamlKey`, keyPad rule unchanged: the first non-blank line after `---` sets the key indent); `null` on every other line.
  - `keyStart`: `true` on a `'yaml'` line that starts a `name:` key at the key indent (the lines `tapBlocks` pushes to `keys` today), else `false`.
- `tapBlocks(lines)` keeps its exact output (`{line, body, frames, keys}` per block, same order, raw lines) and is re-implemented as a fold over `tapLines(lines)`: a block per `notOk`; every other line with that `owner` goes to `body`; `frames` gets owned `'other'` lines plus owned `'yaml'` lines whose `key` is in `TAP_FRAME_KEYS`; `keys` gets owned lines with `keyStart`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/verify/extract.test.js`, add `tapLines` to the destructured require)

```js
const kinds = (text) => tapLines(text.split('\n')).map((e) => e.kind);
const owners = (text) => tapLines(text.split('\n')).map((e) => e.owner);

test('AC2.1: tapLines classifies a node TAP failure block, its YAML terminator, and the points around it', () => {
  const text = ['# Subtest: s', 'ok 1 - a', 'not ok 2 - b', '  ---', "  location: 'tests/a.test.js:1:1'", '  error: |-', '    boom', '  ...', '# tests 2'].join('\n');
  assert.deepStrictEqual(kinds(text), ['subtest', 'ok', 'notOk', 'yamlOpen', 'yaml', 'yaml', 'yaml', 'yamlClose', 'comment']);
  assert.deepStrictEqual(owners(text), [-1, -1, 2, 2, 2, 2, 2, 2, -1]);
  const loc = tapLines(text.split('\n'))[4];
  assert.deepStrictEqual([loc.key, loc.keyStart, loc.indent], ['location', true, 2]);
});

test('AC2.1: a deeper "..." and "not ok"/"ok 1" lines inside YAML error text stay yaml, owned by the block', () => {
  const text = ['not ok 1 - x', '  ---', '  error: |-', '    ...', '    not ok 9 - quoted', '    ok 1 - quoted', '  ...', 'ok 2 - next'].join('\n');
  assert.deepStrictEqual(kinds(text), ['notOk', 'yamlOpen', 'yaml', 'yaml', 'yaml', 'yaml', 'yamlClose', 'ok']);
  assert.deepStrictEqual(owners(text), [0, 0, 0, 0, 0, 0, 0, -1]);
});

test('AC2.1: a passing point\'s YAML is classified but owned by no block', () => {
  const text = ['ok 1 - a', '  ---', '  duration_ms: 1', '  ...'].join('\n');
  assert.deepStrictEqual(kinds(text), ['ok', 'yamlOpen', 'yaml', 'yamlClose']);
  assert.deepStrictEqual(owners(text), [-1, -1, -1, -1]);
});

test('AC2.1: a # line ends a block, and a deeper ok N with no YAML is an ok point at its own indent', () => {
  const text = ['    not ok 2 - nested', "      location: 'tests/a.test.js:5:5'", '        ok 1 - quoted', '        tail', '# Error: crashed', '  ---'].join('\n');
  const entries = tapLines(text.split('\n'));
  assert.deepStrictEqual(entries.map((e) => e.kind), ['notOk', 'other', 'ok', 'other', 'comment', 'other']);
  assert.deepStrictEqual(entries.map((e) => e.owner), [0, 0, -1, -1, -1, -1]);
  assert.deepStrictEqual([entries[0].indent, entries[2].indent], [4, 8]);
});

test('AC2.1: CRLF lines classify exactly like LF lines', () => {
  const lf = ['not ok 1 - x', '  ---', '  error: boom', '  ...', 'ok 2 - y'];
  assert.deepStrictEqual(tapLines(lf.map((l) => `${l}\r`)), tapLines(lf));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/verify/extract.test.js`
Expected: FAIL — `tapLines is not a function` on the five new tests; every pre-existing test passes.

- [ ] **Step 3: Implement `tapLines(lines)` in `plugin/bin/lib/verify/extract.js` and re-implement `tapBlocks` as a fold over it**

Move the state machine (pointPad / yamlPad / keyPad / yamlKey) out of `tapBlocks` into `tapLines` unchanged in its transitions; `tapLines` records per line what `tapBlocks` currently decides (kind, owner, key, keyStart). Keep the existing comment block describing the YAML/keyPad rules on `tapLines`. Add `tapLines` to `module.exports`. No other function changes.

- [ ] **Step 4: Run the extract suite and every other consumer of the TAP paths**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/*.test.js`
Expected: PASS, 0 failures — the pre-existing tests are the proof that `failingTestsByFile`, `countUnmatchedFailures`, `unattributedFailureCount` and `extractFailingFiles` outputs are unchanged.

- [ ] **Step 5: Real-input equivalence probe (not committed)**

Run each exported TAP-path function on a real Windows log with the base and the new extract.js and compare. Real input: `verify-logs/tests.log` from run 39042596045's `verify-report` artifact (`gh run download 39042596045 --repo thn-inc/claude-tweaks --name verify-report --dir <scratch>`). Base copy: `git show origin/main:plugin/bin/lib/verify/extract.js > <scratch>/extract-base.js`. For `family = 'tap'` and `cwd = 'D:\\a\\claude-tweaks\\claude-tweaks'` (read the real checkout prefix off a `location:` line first), print `JSON.stringify` of `extractFailingFiles`, `countUnmatchedFailures`, `unattributedFailureCount`, `[...failingTestsByFile(text, 'tap', {cwd, located: true})]` from both modules.
Expected: identical output from both; record the failing-file count in the task report next to an independent count (`grep -c '^\s*not ok' tests.log`).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/verify/extract.js tests/bin-lib/verify/extract.test.js
git commit -m "Export tapLines from verify's extract.js — tapBlocks now folds over the shared TAP line classifier (refs #3404)"
```

---

### Task 2: Rebuild `excerptFor` in file-issue.js on `tapLines`

**Files:**
- Modify: `tools/windows-regression/file-issue.js` (`excerptFor`, its comment, and `composeIssue`'s per-source precompute)
- Test: `tests/windows-regression-file-issue.test.js` (no edits — the existing F1/R3/L13/L21 tests are the contract)

**Interfaces:**
- Consumes: `tapLines` from Task 1, via `require('../../plugin/bin/lib/verify/extract.js')`.
- Produces: no new exports. `composeIssue`'s per-source object gains `tap: tapLines(lines)` beside `lines` and `normalized`, computed once per source; `excerptFor(file, source)` takes that object.

- [ ] **Step 1: Run the filer suite as the baseline**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS (all tests, including the AC1.1 excerpt families F1, R3, L13, L21). Record the pass count.

- [ ] **Step 2: Rewrite `excerptFor(file, { lines, normalized, tap })`**

Keep `namesFile`/`slashes` and `hit` (first line naming the file) unchanged. Then, all from `tap`:
- `start = tap[hit].owner` — the failure block holding the hit opens at its `not ok`.
- `owner === -1` (a crashed file's stderr): walk back from `hit - 1`; stop at the first line that is a test boundary (`kind` `ok`, `notOk`, `subtest` or `yamlClose`) or that a failure block owns (`owner !== -1`); `start` is the line after it (`hit` itself when none).
- `openIndent = tap[start].kind === 'notOk' ? tap[start].indent : 0`.
- `end` = the first `i` in `(start, start + EXCERPT_MAX_LINES)` with `kind` `ok`/`notOk` and `indent <= openIndent`, else `min(start + EXCERPT_MAX_LINES, lines.length)`.
- Return `lines.slice(start, end).join('\n')`, `null` when no line names the file.

Rewrite the function's comment to describe this in terms of `tapLines` kinds; the comment must not quote the literals `ok N`, `# Subtest:` or `...` (AC3.1's grep below reads comments too).

- [ ] **Step 3: Run the filer suite to verify AC1.1**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS with the same count as Step 1 — AC1.1: every existing excerpt test (F1, R3, L13, L21) passes unchanged.

- [ ] **Step 4: Verify AC3.1 — no boundary regexes left in file-issue.js**

Run: `grep -nF -e 'Subtest' -e 'not ok' -e 'ok \d' -e '\.\.\.' tools/windows-regression/file-issue.js`
Expected: no output (exit 1). AC3.1: `file-issue.js` no longer contains its own boundary regexes for `ok N` / `# Subtest:` / `...`.

- [ ] **Step 5: Real-input probe — old vs new excerpts on a real Windows log (not committed)**

With the same run-39042596045 `tests.log`, build a verdict naming every test file `extractFailingFiles(log, 'tap', { cwd })` returns (Task 1 Step 5's `cwd`), then call the exported `composeIssue({ report: { checks: {} }, verdict: { adjudicated: true, attributable: files, reason: null }, sha: 'a'.repeat(40), base: null, pr: null, runUrl: 'u', logText: log })` from both `git show origin/main:tools/windows-regression/file-issue.js` (saved to scratch) and the new file.
Expected: the two `body` strings are identical; record the number of excerpts compared.

- [ ] **Step 6: Commit**

```bash
git add tools/windows-regression/file-issue.js
git commit -m "Build the Windows filer's excerpts on verify's tapLines — no TAP boundary regexes of its own (refs #3404)"
```
