# Windows null-device and host-path test fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three tests that fail only on a Windows checkout after #5628, and add a scan that fails on Linux when a test hands `os.devNull` to git as a config path.

**Architecture:** One new `node --test` suite walks every `.js` file under `tests/` and `tools/`, matches lines where `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` is given `os.devNull`, and reports file and line. Four one-line test edits make the tree clean (three named tests plus the `skill-gate/cli.test.js` line the scan also catches).

**Tech Stack:** Node `node:test`, `node:assert/strict`; no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T094524-record-5666/work/5666-spec.md`

## Acceptance coverage

- Waived AC1.1: proved by Task 3's Windows run (an observation of CI, not a committed test step).
- Waived AC1.2: Task 3 names the run in the PR body.
- Waived AC1.3: Task 3's per-file read of `tests.log` applies the timed-out rule.
- Waived AC5.1: Task 2 adds no skip or platform guard; checked by reading the diff (`git diff origin/main -- tests | grep -n -i "win32\|skip"` prints nothing new).
- Waived AC6.1: Common Step 5's full verification and PR CI on the same head.
- Waived AC7.1: no task touches `plugin/`; checked with `gh pr view --json files` at handoff.
- Waived tests/raw-markdown-read-conformance.test.js: read as the house shape for Task 1 only; unchanged.
- Waived plugin/bin/lib/run-header.js: Gotchas say leave it as is; read only.
- Waived plugin/bin/lib/staged-patch/stack-check.js: shipped code, out of scope; read only.
- Waived tools/run-tests.js: discovers the new suite by walking `tests/`; read only.

## Global Constraints

- No file under `plugin/` changes (AC7).
- `GIT_CONFIG_NOSYSTEM: '1'` stays in the two git-env tests.
- No test in `tests/bin-lib/flow/preflight.test.js`, `tests/run-header.test.js`, `tests/verify-run-bookends.test.js` is skipped or narrowed on `win32` (AC5).
- Do not change `archivedRunDir` in `plugin/bin/lib/run-header.js`; its filesystem-facing functions return native paths by design. Leave the other default-path-module tests in `tests/run-header.test.js` as they are.
- Quoted from `.claude/skills/windows-checkout-test-parity/SKILL.md` (row "Passing `os.devNull` to git as a config path"): "On win32 `os.devNull` is `\\.\nul`, which Git for Windows rejects on every call (`fatal: unable to access '\\.\nul': Invalid argument`) … Use the literal `/dev/null`, which Git for Windows maps to `nul`".
- Quoted from `.claude/skills/bin-source-scan-conformance/SKILL.md` (applies by analogy; that skill governs `plugin/bin` scans): "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`: `raw-markdown-read` flags the raw read." and "Walking … with `fs.readdirSync(dir, { recursive: true })` … use the manual `withFileTypes` walk … and a floor on files walked." and "Assert the exact flagged line numbers, not just a count".
- Decision (spec's decision rule — stay inside Key Files): the new suite does **not** import the shared comment stripper. Importing it would require adding the suite's stem to `tests/helpers/strip-comments.js`'s header and `parse-signal-discipline` item 15 (both outside Key Files). The scan is a raw line match, as the spec's Technical Approach says ("a line-level match over test sources, not a parser"); a comment holding the pattern is therefore flagged too (a conservative false positive), stated in the header. State this choice in the PR body.

## Review Focus

1. A quoted key or bracket form (`'GIT_CONFIG_GLOBAL': os.devNull`, `env['GIT_CONFIG_SYSTEM'] = os.devNull`) — expected flagged. Pinned in Task 1's self-test.
2. A comparison (`env.GIT_CONFIG_GLOBAL === os.devNull`) — expected not flagged (not an assignment). Pinned in Task 1's self-test.
3. The scan reporting its own planted text — expected not: it skips its own file by name. Pinned by Task 1's live-tree test passing after Task 2.
4. A CRLF source — expected same line numbers (readText normalizes; self-test runs the matcher on a CRLF copy).
5. `os.devNull` used as a stdio target or file to read — expected not flagged. Pinned in Task 1's self-test (AC3.4).

---

### Task 1: Null-device conformance scan

**Role:** integration

**Files:**
- Create: `tests/git-config-null-device-conformance.test.js`

**Interfaces:**
- Produces (module-local, not exported): `findNullDeviceConfig(text: string) => number[]` (1-based line numbers of offending lines), `listJs(dir: string) => string[]` (manual `withFileTypes` walk, skips `node_modules`), `assertFloor(count: number) => void` (throws `AssertionError` when `count < FILE_FLOOR`), `const FILE_FLOOR = 1382`.

Shape: header comment (what it guards, #5666, #3696; recall limits: a destructured `devNull` (`const { devNull } = require('os')`), a value held in a variable (`const NUL = os.devNull; … GIT_CONFIG_GLOBAL: NUL`), a key and value split across lines; that it matches raw lines so a comment holding the pattern is flagged; that it skips its own file by name because its planted offenders are text). Matcher, one regex applied per line of `readText` output split on `\n`:
`/(?<![\w$])GIT_CONFIG_(?:GLOBAL|SYSTEM)['"]?\]?\s*(?::|=(?!=))\s*os\s*\.\s*devNull(?![\w$])/`.
Walk `path.join(ROOT, 'tests')` and `path.join(ROOT, 'tools')`; read each file with `readText` from `./helpers/read-skill`; skip `path.basename(__filename)` at `tests/` root. Report rows as `${rel}:${line}` with `rel` POSIX-separated (`path.relative(ROOT, f).split(path.sep).join('/')`).

- [ ] **Step 1: Write the tests**

```js
test('AC3.1 AC3.2 a planted object-literal and assignment offender are each reported with its line', () => {
  const planted = [
    "const env = { GIT_CONFIG_GLOBAL: os.devNull };",
    "const x = 1;",
    "process.env.GIT_CONFIG_SYSTEM = os.devNull;",
    "const y = { 'GIT_CONFIG_GLOBAL': os.devNull, a: 1 };",
    "env['GIT_CONFIG_SYSTEM'] = os.devNull;",
  ].join('\n');
  assert.deepEqual(findNullDeviceConfig(planted), [1, 3, 4, 5]);
  assert.deepEqual(findNullDeviceConfig(planted.replace(/\n/g, '\r\n')), [1, 3, 4, 5]);
});

test("AC3.3 AC3.4 the literal '/dev/null', a stdio os.devNull and a comparison are not reported", () => {
  const clean = [
    "const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };",
    "spawnSync('git', ['status'], { stdio: ['ignore', fs.openSync(os.devNull, 'w'), 'pipe'] });",
    "const fd = fs.openSync(os.devNull, 'r');",
    "if (env.GIT_CONFIG_GLOBAL === os.devNull) {}",
  ].join('\n');
  assert.deepEqual(findNullDeviceConfig(clean), []);
});

test('AC4.1 the suite fails when it reads fewer files than its floor', () => {
  assert.throws(() => assertFloor(FILE_FLOOR - 1), /floor/);
  assert.doesNotThrow(() => assertFloor(FILE_FLOOR));
});

test('AC4.2 the walk reads at least the files it read when it landed (floor on files walked)', () => {
  assertFloor(corpus().length);
});

test('AC2.1 no test or tool source gives GIT_CONFIG_GLOBAL or GIT_CONFIG_SYSTEM the value os.devNull (use the literal /dev/null)', () => {
  const offenders = corpus().flatMap(({ rel, text }) => findNullDeviceConfig(text).map((line) => `${rel}:${line}`));
  assert.deepEqual(offenders, []);
});
```

`corpus()` memoizes `[{ rel, text }]` over both walks. `FILE_FLOOR` is 1382: the count the walk reads at landing (`tests/` + `tools/` `.js` files excluding this suite; independently `git ls-files tests tools | grep -c '\.js$'` printed 1382 before this file existed). After creating the file, print the walk's count once (scratch, not committed: `node -e` requiring nothing, or a temporary `console.log(corpus().length)` removed before commit) and require it to equal `git ls-files tests tools | grep -c '\.js$'` minus 1 (this suite). If the two differ, an untracked `.js` file is in the tree: investigate, and pin the tracked count, never the larger walk count. The floor is not re-pinned at merge (spec's Plan Review Clarifications).

- [ ] **Step 2: Run the suite; the live-tree test fails naming the three lines**

Run: `node --test tests/git-config-null-device-conformance.test.js`
Expected: FAIL — only `AC2.1` fails, listing exactly `tests/bin-lib/flow/preflight.test.js:795`, `tests/bin-lib/skill-gate/cli.test.js:23`, `tests/verify-run-bookends.test.js:520`. All other tests pass.

- [ ] **Step 3: Go-red check of the matcher**

Temporarily change the regex's `GLOBAL|SYSTEM` to `GLOBAL` only, rerun, confirm `AC3.1 AC3.2` fails; restore. Not committed.

- [ ] **Step 4: Commit**

```bash
git add tests/git-config-null-device-conformance.test.js
git commit -m "Add null-device git-config conformance scan over tests and tools — refs #5666"
```

### Task 2: Fix the four offending lines and the host-path test

**Role:** transcription

**Files:**
- Modify: `tests/bin-lib/flow/preflight.test.js:795` — `GIT_CONFIG_GLOBAL: os.devNull` → `GIT_CONFIG_GLOBAL: '/dev/null'`
- Modify: `tests/verify-run-bookends.test.js:520` — same replacement
- Modify: `tests/bin-lib/skill-gate/cli.test.js:23` — same replacement (Deliverable 4: still holds `os.devNull` on `8fef7722b`; say so in the PR body)
- Modify: `tests/run-header.test.js:63-72` — pass `path.posix` as the second argument of both `archivedRunDir(...)` calls; expected strings unchanged

**Interfaces:**
- Consumes: Task 1's suite (its `AC2.1` test turns green).

Leave any `os` import in place if the file still uses `os` elsewhere (all three do: `os.tmpdir()`).

- [ ] **Step 1: Apply the four edits**

- [ ] **Step 2: Run the touched suites**

Run: `node --test tests/git-config-null-device-conformance.test.js tests/bin-lib/flow/preflight.test.js tests/verify-run-bookends.test.js tests/run-header.test.js tests/bin-lib/skill-gate/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 3: AC2 absence check**

Run: `git grep -n -F "os.devNull" -- tests tools`
Expected: lines only in `tests/git-config-null-device-conformance.test.js`. (Control: `git grep -n -F "os.devNull" 8fef7722b -- tests tools` printed the three offending lines before this change.)

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/flow/preflight.test.js tests/verify-run-bookends.test.js tests/bin-lib/skill-gate/cli.test.js tests/run-header.test.js
git commit -m "Pass literal /dev/null as GIT_CONFIG_GLOBAL and pin POSIX archivedRunDir — refs #5666"
```

### Task 3: Windows proof (Deliverable 5, AC1)

**Role:** integration

**Files:**
- Waived tests/bin-lib/flow/preflight.test.js: read only through the Windows run's `tests.log` in this task.

After the branch is pushed (phase exit), dispatch `windows-regression` on the PR branch: `gh workflow run windows-regression.yml --ref {branch}`. Identify the run with `gh run list --workflow windows-regression.yml --branch {branch} --event workflow_dispatch --limit 5 --json databaseId,headSha,createdAt`, and accept only a run whose `headSha` equals `git rev-parse HEAD` of the pushed branch and whose `createdAt` is after the dispatch call; re-poll until one appears, never take the newest run on trust. Once it completes, download the `verify-report` artifact and normalize `tests.log` before matching: replace every run of backslashes with `/` (the TAP log doubles every backslash in `location:`, `tools/windows-regression/file-issue.js:129`). Then (a) no `not ok` entry has a normalized `location:` containing `tests/bin-lib/flow/preflight.test.js`, `tests/run-header.test.js` or `tests/verify-run-bookends.test.js`; (b) each file ran: each of the three named test titles (`AC3.1 specOnBranch on a real repo branch whose last commit git-mv'd the header`, `archivedRunDir: run dir and per-spec child dir under pipelines`, `AC3.1 isSpecCommitted on a real repo whose last commit git-mv'd the header to the archive path`) appears on an `ok` line. Control: run the same normalize-and-match over failing run 43816922522's `tests.log` (if its artifact is still retained) and confirm it finds the three known `not ok` entries; if the artifact has expired, log the control as not run. If one of the three named tests fails further on, fix it in this PR (in scope). Record the run id and result in `decisions.md` as an `AC evidence` entry (AC1.1) and name the run in the PR body. A run still pending when the build/test call ends is left to the review call, which re-dispatches after any later code change.

- [ ] **Step 1: Dispatch and record the run id**
- [ ] **Step 2: Read the per-file result and log the AC evidence**
