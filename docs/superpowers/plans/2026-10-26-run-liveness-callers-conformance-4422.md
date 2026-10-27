# Run-liveness callers conformance scan (#4422) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `node --test` source-scan suite that fails when a retired private liveness probe returns to one of the four callers #4419–#4421 migrated onto `runLiveness`.

**Architecture:** One new conformance file, `tests/run-liveness-callers-conformance.test.js`, reads the four fixed source files through `readText`, strips comments with the shared `stripComments`, and reports offenders as `{rel}:{line} {form}` strings. Task 1 adds the banned-name and banned-primitive matchers. Task 2 adds the scoped rule for `ownEventRecency`/`STALE_INTERRUPTED_TTL_MS`, located by brace-matching function boundaries, plus the site floor. Both tasks share one `scan(entries)` and one `assertNoRetiredProbes(entries)`, which every real-tree and planted test calls (go-red control rule).

**Tech Stack:** Node `node:test` + `node:assert/strict`; `tests/helpers/strip-comments.js` (`stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`); `tests/helpers/read-skill.js` (`readText`).

**Spec:** `.claude-tweaks/pipelines/2026-10-26T192308-spec-4422/work/4422-spec.md`

## Global Constraints

- No production code changes: `plugin/bin/lib/hooks/run-dir-resolve.js`, `plugin/bin/lib/hooks/resume-freshness.js`, `plugin/bin/lib/flow/consolidated-pass.js` and `plugin/bin/lib/reconcile/archive-merged.js` are scanned, not changed.
- Scanned files: exactly those four. Nothing under `plugin/bin/lib/run-liveness/`, and not `plugin/bin/lib/hooks/worktree-reap.js` (out of scope by construction, because they are not scanned).
- Banned names, all four files: `isDeadRunDir`, `lockVerdict`, `isPidAlive`, `lockInUse`, `lastCommitMs`.
- Banned primitives, all four files: `process.kill(`; a git commit-recency read, meaning an argv array or a string containing `log` together with `-1`, `-n`/`--max-count`, or a `%ct`/`%cI`/`committerdate` format; a read of a worktree entry's `.locked`/`.lockReason` field.
- Scoped rule: `ownEventRecency` and `STALE_INTERRUPTED_TTL_MS` may appear in `archive-merged.js` only inside `classifyRunDir`, `lastOwnEventMs`, the import and export lists, **and the constant's own top-level declaration `const STALE_INTERRUPTED_TTL_MS = ORPHAN_MINT_TTL_MS;` (archive-merged.js:330 — premise correction, logged to decisions.md; without it AC1.1 cannot hold)**. Neither token may appear anywhere in the other three files.
- The allowlist (`runLiveness`, `blocksResume`, the `runVerdict` hook, #4419's renamed precondition helper `unresumableState`) is documented in the suite's header comment only, never matched.
- Follow `.claude/skills/bin-source-scan-conformance/SKILL.md`. Import the shared stripper, never write one. A `stripperVerdict` other than `ok` is an offender. Assert exact flagged lines in self-tests. Node 18 floor: no `readdirSync({ recursive })`.
- The new suite is a stripper caller with stem `run-liveness-callers`. Add that stem to both lists `tests/strip-comments-callers-twin.test.js` pins: the header comment of `tests/helpers/strip-comments.js` and `.claude/skills/parse-signal-discipline/SKILL.md` item 15. Place it alphabetically, after `raw-markdown-read` and before `staged-id-producers`.
- Read source files with `readText` from `tests/helpers/read-skill.js`, never `fs.readFileSync` (the `raw-markdown-read` scan flags a raw read).
- No `plugin/bin/` file is edited, so the path-guard and windows-hide source-scan suites are not part of each task's run. Each task does run `tests/strip-comments-callers-twin.test.js` and `tests/raw-markdown-read-conformance.test.js` alongside its focused suite.

## Review Focus

1. A git argv array split across several lines (`runGit([\n 'log',\n '-1',\n '--format=%ct',\n])`) must still be flagged; the array matcher spans newlines (Task 1, `'AC2.1: a multi-line argv commit-recency read is flagged at its opening line'`).
2. A template-literal or plain-string git command (`` `git log -1 --format=%ct` ``, `'git log --max-count=1'`) must be flagged; `'log'` alone, or `-1` without `log`, must not (Task 1 self-test rows).
3. A `}` or `{` inside a string within `classifyRunDir` must not end the located span early; the span is found over `literals: 'blank'` text (Task 2, `'boundary finder ignores braces inside string literals'`).
4. An object literal key `{ locked: false }` is not a read and must not be flagged; `entry.locked` and `e.lockReason` must be (Task 1 self-test rows).
5. A banned name inside a string literal (`'lockVerdict failed'`) is flagged. The tripwire is deliberately conservative, since literals are kept in default mode. Pin it in a self-test so the choice is explicit, not accidental (Task 1).

---

### Task 1: Banned names and banned primitives in the four callers

**Files:**
- Create: `tests/run-liveness-callers-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js` (header comment's caller list only)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (item 15's caller list only)

**Interfaces:**
- Produces (file-local, used by Task 2):
  - `SCANNED`: `string[]` of the four repo-relative paths, in the order run-dir-resolve, resume-freshness, consolidated-pass, archive-merged.
  - `readEntries(): Array<{ rel: string, raw: string }>`.
  - `lineOf(src: string, index: number): number`.
  - `bannedHits(raw: string): Array<{ line: number, form: string }>`, sorted by line.
  - `scan(entries): string[]`: offender strings `${rel}:${line} ${form}`, or `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}` for a mis-parse.
  - `assertNoRetiredProbes(entries): void`: `assert.deepEqual(scan(entries), [])`.
  - Task 2 extends `scan` with the scoped hits, so it stays the single entry point.

- [ ] **Step 1: Write the failing tests** in `tests/run-liveness-callers-conformance.test.js`:
  - `test('AC1.1: no retired liveness probe in the four migrated callers', …)` calls `assertNoRetiredProbes(readEntries())`.
  - `test('floor: all four scanned files are read', …)`: `readEntries()` has length 4 and every `raw.length > 0`.
  - `test('AC3.1: a banned name only in a comment does not fail the scan', …)`: `bannedHits('// lockVerdict(x) and isPidAlive(p)\n/* process.kill(pid, 0) */\nconst ok = 1;')` deep-equals `[]`.
  - `test('matcher self-test: banned names and primitives are flagged at their lines', …)`, planted lines (one per line, in this order) with the exact expected `line:form` list:
    1. `const v = lockVerdict(entry);` → `1:lockVerdict`
    2. `isDeadRunDir(dir);` → `2:isDeadRunDir`
    3. `if (isPidAlive(pid)) {}` → `3:isPidAlive`
    4. `const l = lockInUse(wt);` → `4:lockInUse`
    5. `const t = lastCommitMs(wt);` → `5:lastCommitMs`
    6. `process.kill(pid, 0);` → `6:process.kill(`
    7. `runGit(['log', '--max-count=1', '--format=%ct']);` → `7:git commit-recency read`
    8. `` execSync(`git log -1 --format=%cI`); `` → `8:git commit-recency read`
    9. `const busy = entry.locked;` → `9:.locked`
    10. `const why = e.lockReason;` → `10:.lockReason`
    11. `const o = { locked: false };` → no hit
    12. `runGit(['rev-parse', 'HEAD']);` → no hit
    13. `const msg = 'log rotated';` → no hit
    14. `runGit(['status', '-1']);` → no hit
    15. `const m = 'lockVerdict failed';` → `15:lockVerdict` (Review Focus 5)
  - `test('AC2.1: a multi-line argv commit-recency read is flagged at its opening line', …)`: `bannedHits("x();\nrunGit([\n  'log',\n  '-n', '1',\n  '--format=%ct',\n]);")` maps to `['2:git commit-recency read']`.
  - `test('AC2.1: reintroducing a retired probe into a scratch copy names the file and the form', …)`: build scratch copies in memory from `readEntries()`, appending a line to the real text, then assert `assert.throws(() => assertNoRetiredProbes(copies), re)` for each:
    - `resume-freshness.js` + `\nlockVerdict(entry);\n` → message matches `/plugin\/bin\/lib\/hooks\/resume-freshness\.js:\d+ lockVerdict/`
    - `consolidated-pass.js` + `\nprocess.kill(pid, 0);\n` → `/plugin\/bin\/lib\/flow\/consolidated-pass\.js:\d+ process\.kill\(/`
    - `archive-merged.js` + `\nrunGit(['log', '--max-count=1', '--format=%ct']);\n` → `/plugin\/bin\/lib\/reconcile\/archive-merged\.js:\d+ git commit-recency read/`

    One copy is mutated per assertion. The positive test and this control both call `assertNoRetiredProbes`.
  - `test('a comment-stripper mis-parse is reported as an offender, not passed as a clean file', …)`: planted `{ rel: 'plugin/bin/lib/planted.js', raw: 'if (b) /"/.test(b); const c = "//"; lockVerdict(c);' }`. Assert `stripperVerdict(raw, stripComments(raw)) === 'misparsed'` and `scan([planted])` deep-equals `[\`plugin/bin/lib/planted.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}\`]`.
  - `test('a live banned call after a fake comment opener in a string is still seen', …)`: `bannedHits("const a = '/*';\nlockVerdict(x);")` lines `[2]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/run-liveness-callers-conformance.test.js`
Expected: FAIL. `bannedHits`/`scan` are not defined yet; with stub bodies, the self-test rows fail on wrong lines.

- [ ] **Step 3: Implement the matchers** in the same file.
  - The header comment states what the suite protects (#3979, #4419–#4421), the allowlist named only in comments (Global Constraints), and recall limits: a destructured `kill`, a `process['kill']` bracket form, a `{ locked }` destructure, and `rev-list`/`for-each-ref` recency reads are not matched. Code review stays the backstop (spec Gotcha 2).
  - `bannedHits(raw)` works over `stripComments(raw)`, in default literal-keeping mode, so string commands stay visible. It applies four matchers:
    - Names: `/\b(isDeadRunDir|lockVerdict|isPidAlive|lockInUse|lastCommitMs)\b/g` → form is the name.
    - `/\bprocess\s*\.\s*kill\s*\(/g` → form `process.kill(`.
    - Argv: every `[` … matching `]` with no nested `[` (`/\[[^\[\]]*\]/g`). Collect its quoted elements (`/(['"`])((?:\\.|(?!\1).)*)\1/g`). Flag when one element equals `log` and another matches `RECENCY = /^(?:-1|-n|--max-count(?:=\d+)?|.*(?:%ct|%cI|committerdate).*)$/`. Line is the `[`'s line; form `git commit-recency read`.
    - String: each quoted literal (same literal regex, run over the whole stripped text) whose body matches `/\blog\b/` and `/(?:^|\s)(?:-1|-n|--max-count)\b|%ct|%cI|committerdate/` → same form. Dedupe a literal already counted inside an argv array by line + form.
    - Field read: `/\.\s*(locked|lockReason)\b/g` → form `.locked` / `.lockReason`.
  - `scan(entries)`: per entry compute `stripped = stripComments(raw)` once. If `stripperVerdict(raw, stripped) !== 'ok'`, push the verdict message and `continue`. Otherwise push each `bannedHits` hit as `${rel}:${line} ${form}`.

- [ ] **Step 4: Add the caller stem** `run-liveness-callers` to the two lists (Global Constraints), keeping each list's existing wrapping and punctuation style.

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `node --test tests/run-liveness-callers-conformance.test.js tests/strip-comments-callers-twin.test.js tests/raw-markdown-read-conformance.test.js tests/helpers-strip-comments.test.js`
  Expected: PASS, 0 fail.

- [ ] **Step 6: Prove each new assertion goes red** (bin-source-scan-conformance "watch it go red"). Temporarily break each matcher in turn (empty the names regex; drop the argv branch; drop the field-read branch) and confirm the matching self-test fails. Restore. No commit of the broken state.

- [ ] **Step 7: Commit**

  ```bash
  git add tests/run-liveness-callers-conformance.test.js tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md
  git commit -m "Add the run-liveness callers conformance scan — bans the retired probe names and primitives in the four migrated callers (refs #4422)"
  ```

### Task 2: Scoped rule for `ownEventRecency` / `STALE_INTERRUPTED_TTL_MS`, and the site floor

**Files:**
- Modify: `tests/run-liveness-callers-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `SCANNED`, `readEntries`, `lineOf`, `scan`, `assertNoRetiredProbes`.
- Produces:
  - `functionSpan(blankText: string, name: string): { start: number, end: number } | null`: the index of the `function NAME(` keyword through its matching closing `}`.
  - `scopedHits(rel: string, raw: string): Array<{ line: number, form: string }>`.
  - `assertSiteFloor(entries): void`.
  - `scan` now also pushes the `scopedHits` offenders.

- [ ] **Step 1: Write the failing tests**
  - `test('AC1.1: no retired liveness probe in the four migrated callers', …)` already exists. It now also covers the scoped rule through `scan`.
  - `test('AC4.1: renaming classifyRunDir in a scratch copy fails the site floor, not a vacuous pass', …)`: replace `function classifyRunDir(` with `function classifyRunDirRenamed(` in a copy of archive-merged.js's real text. Assert `assert.throws(() => assertSiteFloor(copies), /classifyRunDir/)`. Same for `function lastOwnEventMs(` → `/lastOwnEventMs/`.
  - `test('floor: the scoped-token sites are located', …)` calls `assertSiteFloor(readEntries())`. It asserts:
    - both spans are found in archive-merged.js;
    - the count of allowed scoped-token sites in archive-merged.js is `>= N`, where N is the count when the suite lands. Compute it in Step 3 and write the number in with a comment: fewer means the matcher stopped matching. Never lower it.
  - `test('scoped rule self-test: allowed sites pass, a sibling helper and the other files fail', …)`, all through `scopedHits`:
    - Archive text: `"const { ownEventRecency } = require('../run-liveness/probes');\nconst STALE_INTERRUPTED_TTL_MS = ORPHAN_MINT_TTL_MS;\nfunction lastOwnEventMs(d) {\n  return ownEventRecency(d).lastOwnMs;\n}\nfunction classifyRunDir(ctx) {\n  const s = '}';\n  return ownEventRecency(ctx.dir) && STALE_INTERRUPTED_TTL_MS;\n}\nfunction newHelper(d) {\n  return ownEventRecency(d);\n}\nmodule.exports = {\n  ownEventRecency, STALE_INTERRUPTED_TTL_MS,\n};"` with `rel` set to the archive path → exactly `['11:ownEventRecency outside classifyRunDir/lastOwnEventMs']`. This covers the sibling-helper deliverable and Review Focus 3, the `'}'` string inside `classifyRunDir`.
    - Any other scanned rel, with text `const x = ownEventRecency(d);\nconst y = STALE_INTERRUPTED_TTL_MS;` → `['1:ownEventRecency outside archive-merged.js', '2:STALE_INTERRUPTED_TTL_MS outside archive-merged.js']`.
    - The comment `// ownEventRecency is the reader` in any file → `[]`.
  - `test('boundary finder ignores braces inside string literals', …)`: over `stripComments(src, { literals: 'blank' })` of `"function f() { const a = '{'; return 1; }\nconst after = 2;"`, `functionSpan(…, 'f').end` falls on line 1. Return `null` for a missing name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/run-liveness-callers-conformance.test.js`
Expected: FAIL. `scopedHits`, `functionSpan` and `assertSiteFloor` are undefined.

- [ ] **Step 3: Implement**
  - `functionSpan(blankText, name)`: find `/\bfunction\s+NAME\s*\(/`. Match parentheses from that `(` to its closing `)`, so a default-param `{}` stays inside. Take the next `{` and brace-count to its match. Return `null` when the name or a balanced close is missing.
  - `scopedHits(rel, raw)`: compute `blank = stripComments(raw, { literals: 'blank' })` once. A `stripperVerdict(raw, blank)` other than `ok` is handled by `scan`. Find tokens `/\b(ownEventRecency|STALE_INTERRUPTED_TTL_MS)\b/g` over `blank`.
    - Non-archive file: every hit → `${token} outside archive-merged.js`.
    - Archive file: a hit is allowed when its index lies in the `classifyRunDir` span, the `lastOwnEventMs` span, the `module.exports = {…}` brace span, a `const {…} = require(…)` statement span, or the declaration match `/\bconst\s+STALE_INTERRUPTED_TTL_MS\s*=/`. Otherwise → `${token} outside classifyRunDir/lastOwnEventMs`.
  - `scan`: for each entry, also run `stripperVerdict` against the blank-mode text and push its offender. Then push `scopedHits`. Keep one offender per mis-parsed file.
  - `assertSiteFloor(entries)`: assert both spans are non-null for archive-merged.js. The message names the missing function and says the scoped rule would otherwise pass vacuously. Then apply the allowed-site count floor above.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test tests/run-liveness-callers-conformance.test.js tests/strip-comments-callers-twin.test.js tests/raw-markdown-read-conformance.test.js`
  Expected: PASS, 0 fail.

- [ ] **Step 5: Prove each new assertion goes red.** Make the allowed-region check always true; the sibling-helper row must fail. Make `functionSpan` return a fake span when the name is missing; AC4.1 must fail. Restore.

- [ ] **Step 6: Commit**

  ```bash
  git add tests/run-liveness-callers-conformance.test.js
  git commit -m "Scope ownEventRecency and STALE_INTERRUPTED_TTL_MS to classifyRunDir and lastOwnEventMs, and floor the located sites (refs #4422)"
  ```

### Controller step after Task 2 (not dispatched): quote the red runs for the PR body (AC2.2)

For each of AC2's three reintroductions, do the following, each as a separate command, and run `git status` clean at the end:
1. Edit the real file in the worktree: add `lockVerdict(entry);` to `resume-freshness.js`, `process.kill(pid, 0);` to `consolidated-pass.js`, or `runGit(['log', '--max-count=1', '--format=%ct']);` to `archive-merged.js`.
2. Run `node --test tests/run-liveness-callers-conformance.test.js` with output redirected to the scratchpad.
3. Restore with `git checkout -- {file}`.

Also rename `classifyRunDir` in archive-merged.js the same way and capture the floor failure (AC4.1). Quote each failing assertion's offender line in PR #4440's body under a `### Red runs` heading (AC2.2).

Waived AC5.1 as a task step: `npm test` runs centrally at build Common Step 5 through `verify.js`, not per task.

## Self-review

- **Spec coverage:**

  | Spec item | Where it's covered |
  |---|---|
  | Deliverable 1 (suite) | Task 1 |
  | Deliverables 2–3 (names, primitives) | Task 1 |
  | Deliverable 4 (scoped rule, plus the declaration correction) | Task 2 |
  | Deliverable 5 (allowlist as comments) | Task 1 Step 3, header |
  | Deliverable 6 (go-red self-tests) | Task 1 rows; Task 2's sibling-helper row |
  | Deliverable 7 (floor on matched sites) | Task 1 file floor; Task 2 span and site floor |
  | AC1.1 | Task 1 positive test, extended by Task 2 |
  | AC2.1 | Task 1 scratch-copy test |
  | AC2.2 | Controller step |
  | AC3.1 | Task 1 |
  | AC4.1 | Task 2 |
  | AC5.1 | Common Step 5 |

- **Placeholders:** the only number left open is Task 2's site-floor N, which is measured at landing by rule.
- **Type consistency:** `scan`, `assertNoRetiredProbes`, `bannedHits`, `scopedHits`, `functionSpan` and `assertSiteFloor` are named identically in both tasks.
