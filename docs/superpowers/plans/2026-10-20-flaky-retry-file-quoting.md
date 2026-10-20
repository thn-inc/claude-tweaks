# Flaky-Retry File Quoting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runner-printed failing test file path never reaches the shell as syntax when it is substituted into a `{file}` retry template, and a vitest multi-project `|project|` prefix no longer pollutes the captured path.

**Architecture:** One new pure helper, `substituteFile(template, file, { platform })` in `plugin/bin/lib/verify/file-template.js`, owns `{file}` substitution for both template consumers: `flaky.js`'s `planRetry` and `baseline.js`'s `adjudicate`. It substitutes a plain path byte-for-byte, quotes any other path for the platform's shell (POSIX `sh` single quotes, win32 `cmd.exe` double quotes), and refuses with a named reason whatever it cannot quote safely. `extract.js`'s `SUMMARY_FAIL_RE` gains an optional vitest `|project|` prefix group outside its capture.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T134253-record-3676/work/3676-spec.md`

Scope keywords: {file}, SUMMARY_FAIL_RE

## Global Constraints

- The CLI keeps running each command under `spawn(cmd, { shell: true })` (`run.js`, unchanged). The fix lives entirely in how the command string is composed.
- A plain path — every character in `[A-Za-z0-9_@+:./-]` — substitutes byte-for-byte, so every existing template, command string, log name and test fixture for an ordinary path stays identical.
- Platform is a parameter (`platform = process.platform`), never read inside the helper body, per this repo's `windows-checkout-test-parity` convention. Tests pass `'linux'`/`'win32'` explicitly.
- Substitution must not interpret `$&`, `` $` ``, `$'` or `$$` in the path. That rules out `String.prototype.replace` with a string replacement; use `template.split('{file}').join(value)`.

## Review Focus

1. A path containing `'` on POSIX: it must close and reopen the quote (`'\''`), never end the quoting early. Task 1 pins `tests/it's.test.js`.
2. A retry template that already quotes `{file}` (`node --test "{file}"`): nesting our quotes inside the template's would make `$(…)` live again inside the template's double quotes. Such a template refuses for any non-plain path (`template-quotes`), but still substitutes a plain path byte-for-byte. Pinned in Task 1 and Task 3.
3. win32 `%VAR%` and `"`: cmd.exe expands `%…%` even inside double quotes, so a path holding `%`, `"` or `!` refuses on win32 (`cmd-unquotable`). Pinned in Task 1 and Task 2.
4. `$&` in a path must substitute literally (the current `template.replace(/\{file\}/g, file)` would expand it to the match). Pinned in Task 1.
5. Two vitest projects failing the same file (`|unit| a.test.ts` and `|browser| a.test.ts`): after the prefix strip both name one file, so `Test Files 2 failed` against 1 named file refuses as `unattributed-failures: 1`, which is fail-safe. The existing accounting already does this; it needs no new code, and Task 4 adds no test for it.

## Consumers (sole-site grep, recorded)

`grep -rn 'replace(/\\{file\\}' plugin/bin` prints exactly two sites, and both migrate here:
- `plugin/bin/lib/verify/flaky.js:30` (Task 2)
- `plugin/bin/lib/verify/baseline.js:331` (Task 3)

`grep -n 'SUMMARY_FAIL_RE' plugin/bin/lib/verify/extract.js` prints the definition (203) and two readers: `summaryUnattributedCount` (640) and `extractFailingFiles` (720). Both read capture group 1, and the prefix group is non-capturing, so neither changes (Task 4).

---

### Task 1: `substituteFile` helper

**Files:**
- Create: `plugin/bin/lib/verify/file-template.js`
- Test: `tests/bin-lib/verify/file-template.test.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/verify/` row: add a `file-template.js (#3676 — substituteFile …)` clause next to `flaky.js`)

**Interfaces:**
- Produces: `substituteFile(template: string, file: string, { platform = process.platform } = {}) -> { ok: true, command: string } | { ok: false, reason: 'control-character' | 'cmd-unquotable' | 'template-quotes' }`

Rules, checked in this order:
1. `file` matches `/^[A-Za-z0-9_@+:./-]+$/` → `{ ok: true, command: template.split('{file}').join(file) }` (the template is never inspected).
2. `file` contains `/[\x00-\x1f\x7f]/` → `control-character`.
3. win32: `file` contains `/["%!]/` → `cmd-unquotable`; template contains `/["^]/` → `template-quotes`; otherwise the value is `"${file}"`.
4. POSIX: template contains `/["'`\\]/` or `${file}` → `template-quotes`; otherwise the value is `'` + `file.replace(/'/g, "'\\''")` + `'`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/file-template.test.js`:
  - `substituteFile: a plain path substitutes byte-for-byte on both platforms`: `('node --test {file}', 'tests/a.test.js')` → `node --test tests/a.test.js`, for both `linux` and `win32`; `('node --test "{file}"', 'tests/a.test.js', linux)` → `node --test "tests/a.test.js"`.
  - `substituteFile: a $(…) path is single-quoted on POSIX and double-quoted on win32`: `'tests/$(touch PWNED).test.js'` → `node --test 'tests/$(touch PWNED).test.js'` (linux) and `node --test "tests/$(touch PWNED).test.js"` (win32).
  - `substituteFile: an embedded single quote closes and reopens the POSIX quote`: `tests/it's.test.js` → `node --test 'tests/it'\''s.test.js'`.
  - `substituteFile: $& in the path substitutes literally`: `tests/a$&b.test.js` (linux) → `node --test 'tests/a$&b.test.js'`.
  - `substituteFile: refusals are named`: `tests/%PATH%.test.js` on win32 → `cmd-unquotable`; `'tests/a b.test.js'` with template `node --test "{file}"` on linux → `template-quotes`; `'tests/a\tb.test.js'` → `control-character`.
  - `substituteFile: the quoted command runs as one literal word under a real sh` (skipped on `process.platform === 'win32'`): in a `fs.mkdtempSync` dir, `execSync(command, { cwd, shell: '/bin/sh', encoding: 'utf8' })` for `substituteFile('printf %s {file}', 'tests/$(touch PWNED).test.js', { platform: process.platform }).command` prints exactly `tests/$(touch PWNED).test.js`, and `fs.existsSync(path.join(cwd, 'PWNED'))` is `false`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/file-template.test.js`
Expected: FAIL with `Cannot find module` for `file-template.js`

- [ ] **Step 3: Implement `substituteFile` in `plugin/bin/lib/verify/file-template.js`** per the rules above. Add a header comment naming why each rule exists: cmd.exe `%` expansion inside quotes, and a template's own quotes nesting ours. Then add the `docs/plugin-structure.md` clause.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/verify/file-template.test.js`
Expected: PASS, 6 tests (the real-sh test is skipped only on win32)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/file-template.js tests/bin-lib/verify/file-template.test.js docs/plugin-structure.md
git commit -m "Add substituteFile for retry templates — quote or refuse a runner-printed path, refs #3676"
```

### Task 2: `planRetry` uses `substituteFile`

**Files:**
- Modify: `plugin/bin/lib/verify/flaky.js:12-31`
- Modify: `plugin/skills/test/verification.md` (line 212's refusal list: after "an unreadable log", add "or a failing path the shell cannot be handed safely (`unsafe-path: [{files}]` — a non-plain path is quoted for the platform's shell, and a template that quotes `{file}` itself, a control character, or on win32 a `%`/`"`/`!` refuses)". The file is 48742 bytes against the 52500 rail, so the addition must stay under ~250 bytes.)
- Test: `tests/bin-lib/verify/flaky.test.js`

**Interfaces:**
- Consumes: `substituteFile` (Task 1)
- Produces: `planRetry({ ..., platform = process.platform })`. On a refusal it returns `{ retry: false, reason: 'unsafe-path: [f1, f2]', unsafe: [{ file, reason }] }`. That check runs last, after `max-retries-0`, so every existing reason keeps its precedence. On success it returns the same `{ retry, files, command: [{ file, cmd }] }` shape as before.

- [ ] **Step 1: Write the failing tests** in `flaky.test.js`:
  - `planRetry: a $(…) failing path is quoted, never shell syntax (#3676)`: `failingFiles: ['tests/$(touch PWNED).test.js']`, `flaky: { files: ['tests/**'], maxRetries: 1 }`, `retry: RETRY`, `platform: 'linux'` → `plan.retry === true`, `plan.command` deep-equals `[{ file: 'tests/$(touch PWNED).test.js', cmd: "node --test 'tests/$(touch PWNED).test.js'" }]`.
  - `planRetry: a path cmd.exe cannot quote refuses with unsafe-path (#3676)`: `failingFiles: ['tests/%PATH%.test.js']`, same flaky/retry, `platform: 'win32'` → deep-equals `{ retry: false, reason: 'unsafe-path: [tests/%PATH%.test.js]', unsafe: [{ file: 'tests/%PATH%.test.js', reason: 'cmd-unquotable' }] }`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/flaky.test.js`
Expected: FAIL. The first new test's cmd is unquoted; the second returns `retry: true`.

- [ ] **Step 3: Replace the `template.replace` composition in `planRetry`** with one `substituteFile` call per file, and collect the refusals. Edit the verification.md sentence.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS (every existing plain-path assertion unchanged)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/flaky.js tests/bin-lib/verify/flaky.test.js plugin/skills/test/verification.md
git commit -m "Quote the flaky-retry file path through substituteFile — refuse unsafe paths by name, refs #3676"
```

### Task 3: baseline adjudication uses `substituteFile`

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js:261-264` (add `platform = process.platform` to `adjudicate`'s parameters) and `:329-334`
- Test: `tests/bin-lib/verify/baseline.test.js`

**Interfaces:**
- Consumes: `substituteFile` (Task 1)
- Produces: when a file refuses, `adjudicate` returns `ineligible(\`${c.name} failing file ${file} cannot be handed to the shell safely (${reason})\`)` before any worktree is created.

- [ ] **Step 1: Write the failing test** `a failing path the retry template cannot quote is ineligible, never run (#3676)`. Use the `logFile` + `fakes` helpers with log `SPEC(['tests/a b.test.js'])`, `baselineCmds: new Map([['tests', 'node --test "{file}"']])` and `platform: 'linux'`. Assert `r.eligible === false`, that `r.reason` equals `tests failing file tests/a b.test.js cannot be handed to the shell safely (template-quotes)`, that `calls.runs.length === 0`, and that `calls.added.length === 0`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/baseline.test.js`
Expected: FAIL (the adjudication runs the file)

- [ ] **Step 3: Replace `template.replace(/\{file\}/g, file)`** with a `substituteFile(template, file, { platform })` call. Return the `ineligible` result on `ok: false`; otherwise use `command`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/verify/baseline.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js
git commit -m "Route baseline-cmd file substitution through substituteFile, refs #3676"
```

### Task 4: strip vitest's `|project|` prefix

**Files:**
- Create: `tests/fixtures/verify-dialects/vitest-multi-project.txt`. Copy `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/219601ae-9f7d-49b8-a5ef-447a363e15e0/scratchpad/vitest-ws/out.txt` byte-for-byte: real vitest 1.6.0 output, run with `NO_COLOR=1` against a one-project workspace named `unit`. The only normalizations are the `RUN  v1.6.0 {abs path}` path → `/repo` and `Start at` → `12:00:00`, matching the sibling fixtures.
- Modify: `plugin/bin/lib/verify/extract.js:193-203`
- Test: `tests/bin-lib/verify/extract.test.js` (`DIALECT_ROWS`), `tests/bin-lib/verify/flaky.test.js`

**Interfaces:**
- Produces: `SUMMARY_FAIL_RE = /^\s*(?:FAIL|❯|FAILED)\s+(?:\|[^|]+\|\s+)?(.+?)(?=\s>\s|\s\(|\s\[|::|\r?$)/`. Group 1 is unchanged in meaning: the path alone.

- [ ] **Step 1: Write the failing tests**
  - Add `['vitest-multi-project.txt', 0, ['tests/flaky.test.js']]` to `DIALECT_ROWS` in `extract.test.js`.
  - In `flaky.test.js`: `planRetry: a vitest multi-project log retries the real test file, not the |unit| label (#3676)`. Read `vitest-multi-project.txt` via `readDialect`, run `sniffFamily`/`extractFailingFiles`/`unattributedFailureCount`, then call `planRetry({ failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: { tests: 'npx vitest run {file}' }, suite: 'tests', unattributedCount, family, platform: 'linux' })`. Assert `failingFiles` deep-equals `['tests/flaky.test.js']`, `unattributedCount === 0`, and `plan.command` deep-equals `[{ file: 'tests/flaky.test.js', cmd: 'npx vitest run tests/flaky.test.js' }]`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js`
Expected: FAIL. `extractFailingFiles` returns `['|unit| tests/flaky.test.js']`.

- [ ] **Step 3: Add the optional `(?:\|[^|]+\|\s+)?` group** after the marker's `\s+` in `SUMMARY_FAIL_RE`, and extend its comment block with one line on vitest's multi-project label (`FAIL  |unit| tests/a.test.ts > …`, #3676).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js`
Expected: PASS (all existing `DIALECT_ROWS` unchanged)

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/verify-dialects/vitest-multi-project.txt plugin/bin/lib/verify/extract.js tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js
git commit -m "Strip vitest's |project| prefix from captured summary paths, refs #3676"
```

## Go-red (AC3)

After all four tasks, revert each fix on its own and run that fix's new tests. Restore with `git checkout -- <file>`. Never use stash.
- Revert `flaky.js` → Task 2's `$(…)` test fails.
- Revert `baseline.js` → Task 3's test fails.
- Revert `extract.js` → Task 4's dialect row and `planRetry` test fail.
- `file-template.js` is a new module, so Task 1's tests are red by construction (Step 2).
