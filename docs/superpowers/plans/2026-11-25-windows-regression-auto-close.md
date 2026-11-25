# Windows-regression auto-close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/windows-regression/file-issue.js` closes its own open `Windows regression: …` records once main's full Windows run no longer fails any of their listed test files (record #6222).

**Architecture:** Three pure helpers derive the close inputs from the verify report and an issue body (head failing set, run-level skip reason, a record's listed files). One side-effecting function, `closeFixedIssues`, lists the open regression records through the injected `gh` and closes or comments on each eligible one. `run()` calls it on `refs/heads/main` after `classify` on a pass, and after `fileOrComment` on a fail. It never touches the exit code.

**Tech Stack:** Node 20 CommonJS, `node --test`, injected `deps.gh` fake (existing `fakeDeps` in the test file).

**Spec:** `.claude-tweaks/pipelines/2026-11-25T075131-record-6222/work/6222-spec.md`

Scope keywords: windows-regression/file-issue

## Global Constraints

- Only `refs/heads/main` closes or comments. A non-main ref makes no new `gh` call.
- A run whose report is unreadable closes nothing. The existing "no verify report" filing is unchanged.
- Close with `gh issue close <n> --repo <repo> --reason completed --comment <body>`. The comment names the run URL, the head sha and the record's files.
- Exit codes are unchanged: `0` on a pass, `1` on a fail. A `gh` failure while listing, closing or commenting is one stderr line, and the run continues with the next record.
- Close only after filing or commenting, so a file failing at this head is never closed by the run that reports it.
- Maintainer-only tooling under `tools/`. Nothing under `plugin/` changes.

## Acceptance coverage

- AC1.1–AC1.7: Task 2 Step 1's `#6222 AC1` tests, one per bullet.
- AC2.1: Task 2 Step 6, the revert proof.
- AC3.1: Task 2 Step 3, which updates the header comment and the exit-code block / `USAGE`.
- AC4.1: `npm test` passes. That is `/build` Common Step 5's verification run plus each task's Step 4.

## Review Focus

1. A record body edited on github.com comes back with `\r\n` line endings. `listedFiles` must still parse it, and must not return `null` only because of `\r`.
2. A bullet carries a suffix that `composeIssue` writes: `` - `tests/a.test.js` (timed out — no evidence) `` or the possible-rename note. The path is still the backticked span.
3. The issue listing returns non-array JSON, or JSON that does not parse. Treat it as a listing failure: one stderr line, nothing closed, exit code unchanged.
4. A fail run's listing also returns the record this same run just filed or commented on. Its files are in `failingFiles`, so it stays open. The "fail run closes a stale record while filing" test pins this by listing both records.
5. Path separators. Compare after collapsing backslash runs to `/` on both sides (the file's existing `slashes()`), so a Windows-shaped path in either source still matches.

---

### Task 1: Pure close-input helpers

**Files:**
- Modify: `tools/windows-regression/file-issue.js` (new helpers next to `timedOutOf`; extend `module.exports`)
- Test: `tests/windows-regression-file-issue.test.js` (append)

**Interfaces:**
- Produces:
  - `headFailingSet(report: object) -> { files: string[] } | { unknown: string }`. Returns `files` = `baselineAdjudicated.failingFiles` (string entries only, passed through `slashes()`) when `baselineAdjudicated` is a plain object with `eligible === true` and `Array.isArray(failingFiles)`. Otherwise returns `files: []` when `report.checks.tests.exitCode === 0`. Otherwise returns `unknown`: a short reason string, `'baseline adjudication did not run and the tests check did not pass'`.
  - `closeSkipReason(report: object) -> string | null`. Returns `'not a full-suite run'` when `checks.tests.command` is not a string or has no whitespace-delimited `--full` token (`/(^|\s)--full(\s|$)/`). Returns `'a test file timed out'` when `timedOutOf(report)` is non-empty. Otherwise returns `null`.
  - `listedFiles(body: string) -> string[] | null`. Splits on `/\r?\n/` and finds the line `### Newly failing test files`. Collects every following line up to the first empty line or end of body. Each collected line must match `` /^- `([^`]+)`/ ``; any other line, or zero bullets, or no heading, returns `null`. Paths come back through `slashes()`.
  - `flakyPassedOf(report) -> string[]`, the `baselineAdjudicated.flakyPassed` string entries through `slashes()`, else `[]`.

- [ ] **Step 1: Append the failing tests**

Import the four helpers alongside `run, findMergedPr, classify`. Tests:

```js
test('#6222: headFailingSet — adjudicated failingFiles, a raw tests pass is empty, anything else unknown', () => {
  assert.deepEqual(headFailingSet({ baselineAdjudicated: { eligible: true, failingFiles: ['tests/a.test.js', 3] } }), { files: ['tests/a.test.js'] });
  assert.deepEqual(headFailingSet({ pass: true, checks: { tests: { exitCode: 0 } } }), { files: [] });
  for (const r of [{ pass: true }, { baselineAdjudicated: { eligible: false }, checks: { tests: { exitCode: 1 } } }, { checks: { tests: { exitCode: null } } }]) {
    assert.equal(typeof headFailingSet(r).unknown, 'string', JSON.stringify(r));
  }
});

test('#6222: closeSkipReason — non --full command and timed-out files skip; a clean full run does not', () => {
  const full = { checks: { tests: { command: 'npm test -- --full' } } };
  assert.equal(closeSkipReason(full), null);
  assert.equal(closeSkipReason({ checks: { tests: { command: 'npm test' } } }), 'not a full-suite run');
  assert.equal(closeSkipReason({ checks: { tests: { command: 'npm test -- --fuller' } } }), 'not a full-suite run');
  assert.equal(closeSkipReason({}), 'not a full-suite run');
  assert.equal(closeSkipReason({ ...full, baselineAdjudicated: { timedOut: ['tests/a.test.js'] } }), 'a test file timed out');
});

test('#6222: listedFiles parses composeIssue bullets (suffixes, CRLF) and rejects every other shape', () => {
  const body = 'lead\n\n### Newly failing test files\n- `tests/a.test.js`\n- `tests/b.test.js` (timed out — no evidence)\n\n### Failure excerpts';
  assert.deepEqual(listedFiles(body), ['tests/a.test.js', 'tests/b.test.js']);
  assert.deepEqual(listedFiles(body.replace(/\n/g, '\r\n')), ['tests/a.test.js', 'tests/b.test.js']);
  assert.equal(listedFiles('### Failing output (baseline adjudication did not run)\n\n```\nx\n```'), null);
  assert.equal(listedFiles('### Newly failing test files\n\n'), null);
  assert.equal(listedFiles('### Newly failing test files\n- `tests/a.test.js`\nsee also tests/b'), null);
});
```

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL after Step 1 (`headFailingSet is not a function`)

- [ ] **Step 3: Implement the four helpers in `tools/windows-regression/file-issue.js` with the signatures above and export them**

- [ ] **Step 4: Run the file to verify it passes**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS, every test

- [ ] **Step 5: Commit**

```bash
git add tools/windows-regression/file-issue.js tests/windows-regression-file-issue.test.js
git commit -m "Derive Windows-regression close inputs from the report — refs #6222"
```

### Task 2: Close or comment on fixed records from `run()`, and document it

**Files:**
- Modify: `tools/windows-regression/file-issue.js` (new `closeFixedIssues`; `run()` call sites; header comment lines 4-40; `USAGE`)
- Modify: `.github/workflows/windows-regression.yml` (header comment only: the `file` job also closes fixed records; it already runs on a passing verify via `if: always()` and holds `issues: write`)
- Modify: `docs/plugin-structure.md` (line 173's `windows-regression/file-issue.js` entry: add that on main it also closes open regression records whose files no longer fail, and comments instead on a `bot:in-progress` one)
- Test: `tests/windows-regression-file-issue.test.js` (append; add `'issue close': ''` to `GH_DEFAULTS`)

The journeys that list this file in `files:` (`docs/journeys/learn-of-a-windows-regression-after-merge.md`, `docs/journeys/prove-a-windows-fix-on-a-branch-before-merge.md`) belong to `/build` Common Step 6, not to this task.

**Interfaces:**
- Consumes: `headFailingSet`, `closeSkipReason`, `listedFiles`, `flakyPassedOf` (Task 1); `TITLE_PREFIX`, `LABEL`, `TOOL`.
- Produces: `closeFixedIssues({ report, repo, sha, runUrl }, deps) -> void`, called from `run()` only when `ref === MAIN_REF`. On a pass the call goes between `classify` and `return 0`. On a fail it goes after `fileOrComment` and before `return 1`. It is not called on the unreadable-report path.

Behaviour of `closeFixedIssues`, in order:
1. `closeSkipReason(report)` non-null → stdout `windows-regression: not closing fixed records — {reason}`, return.
2. `headFailingSet(report).unknown` → stderr `windows-regression: not closing fixed records — head failing set unknown ({reason})`, return.
3. List: `deps.gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', LABEL, '--search', 'Windows regression in:title', '--json', 'number,title,body,labels', '--limit', '200'])`. A throw, unparseable JSON or a non-array → stderr `windows-regression: fixed-record lookup failed: {message}`, return.
4. For each entry that has an integer `number`, a string `title` starting with `TITLE_PREFIX`, and a string `body`: `files = listedFiles(body)`. Skip the entry when `files` is `null`, or when any file is in the failing set or in `flakyPassedOf(report)`.
5. When `labels` (array of `{name}`) contains `bot:in-progress`: `deps.gh(['issue', 'comment', n, '--repo', repo, '--body-file', '-'], text)`, then stdout `windows-regression: #{n} files pass at {short sha} — commented (bot:in-progress)`. Otherwise call `deps.gh(['issue', 'close', n, '--repo', repo, '--reason', 'completed', '--comment', text])`, then stdout `windows-regression: closed #{n} — its files pass at {short sha}`. Each call sits in its own try/catch. A throw writes stderr `windows-regression: gh issue {close|comment} #{n} failed: {message}` and the loop continues.
6. Comment text (both cases) names `runUrl`, the full `sha`, and a `` - `file` `` bullet per file. The in-progress variant adds that the record is left open for its claimant to settle.

Header comment and `USAGE`: the exit-code `0` line no longer says "nothing filed" alone. Add a paragraph saying that on main, on every readable report, after filing, the CLI closes open regression records whose listed files are all absent from the head's failing set. Name the skip conditions (failing set unknown, not `--full`, a timed-out file, a flaky-passed listed file, no parseable list) and the `bot:in-progress` comment. Say that a `gh` failure there never changes the exit code.

- [ ] **Step 1: Append the failing tests**

Fixtures (test-file helpers):

```js
const FULL = { command: 'npm test -- --full', exitCode: 0 };
const record = (number, files, labels = []) => ({ number, title: `Windows regression: ${files.length} test file(s) newly failing after 111111111`,
  body: `lead\n\n### Newly failing test files\n${files.map((f) => `- \`${f}\``).join('\n')}\n\n_Filed by …_`, labels: labels.map((name) => ({ name })) });
const closeList = (...records) => (args) => (flag({ args }, '--json') === 'number,title,body,labels' ? JSON.stringify(records) : '[]');
const closedNums = (deps) => deps.calls.gh.filter((c) => c.args[1] === 'close').map((c) => c.args[2]);
```

Tests (names are the AC bullets; assertions as listed):
- `#6222 AC1: a pass run closes a record whose files are all absent from the failing set`. Report `{ pass: true, checks: { tests: FULL } }`, list `record(4, ['tests/a.test.js'])`. Expect exit `0`, `closedNums` = `['4']`, the close call's args include `'--reason', 'completed'`, and its `--comment` value includes `RUN_URL`, `SHA` and `` `tests/a.test.js` ``.
- `#6222 AC1: a fail run closes a stale record while filing the new one`. Report `{ pass: false, checks: { tests: { ...FULL, exitCode: 1 } }, baselineAdjudicated: { eligible: true, verdict: 'fail', attributable: ['tests/new.test.js'], failingFiles: ['tests/new.test.js', 'tests/old-still.test.js'] } }`, list `record(4, ['tests/fixed.test.js'])` and `record(5, ['tests/new.test.js'])`. Expect exit `1`, `created(deps)` truthy, `closedNums` = `['4']`, and the create call's index is lower than the close call's index in `deps.calls.gh`.
- `#6222 AC1: a record with one still-failing file stays open`. Adjudicated pass, `failingFiles: ['tests/b.test.js']`, record files `['tests/a.test.js', 'tests/b.test.js']` → `closedNums` empty, no comment.
- `#6222 AC1: a timed-out, non---full, or flaky-passed run closes nothing`. Three reports, each with a record whose files are otherwise absent. (a) `baselineAdjudicated.timedOut: ['tests/x.test.js']`. (b) `checks.tests.command: 'npm test'`. (c) `flakyPassed` containing the record's file, with `failingFiles` not containing it. Each expects `closedNums` empty. (a) and (b) expect no `--json number,title,body,labels` listing at all.
- `#6222 AC1: a (not adjudicated) record is never closed`. List one `{ number: 6, title: 'Windows regression: tests failing after 111111111 (not adjudicated)', body: '### Failing output (x)\n\n```\ny\n```', labels: [] }` → `closedNums` empty.
- `#6222 AC1: a bot:in-progress record is commented on, not closed`. `record(7, ['tests/a.test.js'], ['bot:in-progress'])` → `closedNums` empty, `commented(deps).args[2] === '7'`, and its input names `SHA` and `tests/a.test.js`.
- `#6222 AC1: a throwing gh leaves the exit code unchanged`. Pass report: the listing throws → exit `0` plus one stderr `fixed-record lookup failed` line. `issue close` throws for two records → exit `0`, two stderr `gh issue close` lines, and both close calls were attempted. Fail report with a throwing close → exit `1`.
- `#6222: an unknown head failing set skips closing with one stderr line`. Report `{ pass: false, effectivePass: true, checks: { tests: { ...FULL, exitCode: 1 } }, preExistingAdjudicated: { matched: ['tests/a.test.js'] } }` → exit `0`, no listing, exactly one stderr line matching `/head failing set unknown/`.
- `#6222: a non-main ref and an unreadable report never list for closing`. Neither run makes a `--json number,title,body,labels` call.

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL after Step 1 (no `issue close` call is made)

- [ ] **Step 3: Implement `closeFixedIssues` and wire it into `run()` as specified; update the header comment, `USAGE`, and the workflow header comment**

- [ ] **Step 4: Run the file to verify it passes**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS, every test (the pre-existing ones included: their reports carry no `--full` command, so the sweep skips with a stdout line and adds no `gh` call)

- [ ] **Step 5: Commit**

```bash
git add tools/windows-regression/file-issue.js tests/windows-regression-file-issue.test.js .github/workflows/windows-regression.yml docs/plugin-structure.md
git commit -m "Close Windows-regression records whose files pass on main — refs #6222"
```

- [ ] **Step 6: Revert proof (AC2)**

After the commit, use the Edit tool to put a bare `return;` first in the body of `closeFixedIssues`. Run `node --test tests/windows-regression-file-issue.test.js`. Confirm that each close-asserting `#6222 AC1` test (pass-closes, fail-closes-stale, bot:in-progress comment, throwing close) goes red, and quote those failing test names in the task report. Remove the line with the Edit tool. Then `git -C "{worktree}" diff --quiet -- tools/windows-regression/file-issue.js` must exit 0. Never use `git checkout`, `git stash` or `git reset` for this.
