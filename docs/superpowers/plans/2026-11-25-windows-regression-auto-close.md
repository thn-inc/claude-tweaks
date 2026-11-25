# Windows-regression auto-close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/windows-regression/file-issue.js` closes its own open `Windows regression: …` records once main's full Windows run no longer fails any of their listed test files (record #6222).

**Architecture:** Pure helpers derive the close inputs from the verify report and from one listed record (head failing set, run-level skip reason, a record's listed files, the commit it was filed against). One side-effecting function, `closeFixedIssues`, lists the open regression records through the injected `gh`, checks each eligible record's filing commit is an ancestor of (or identical to) the head through the compare API, and closes it, or comments once on a `bot:in-progress` one. `run()` calls it on `refs/heads/main` after `classify` on a pass, and after `fileOrComment` on a fail. It never touches the exit code.

**Tech Stack:** Node 20 CommonJS, `node --test`, injected `deps.gh` fake (existing `fakeDeps` in the test file).

**Spec:** `.claude-tweaks/pipelines/2026-11-25T080509-record-6222/work/6222-spec.md`

Scope keywords: windows-regression/file-issue

## Global Constraints

- Only `refs/heads/main` closes or comments. A non-main ref makes no new `gh` call.
- A run whose report is unreadable closes nothing. The existing "no verify report" filing is unchanged.
- Close with `gh issue close <n> --repo <repo> --reason completed --comment <body>`. The comment names the run URL, the head sha and the record's files.
- Exit codes are unchanged: `0` on a pass, `1` on a fail. A `gh` failure while listing, comparing, closing or commenting is one stderr line, and the run continues with the next record.
- Close only after filing or commenting, so a file failing at this head is never closed by the run that reports it.
- Ancestry (spec Decision 1): close or comment only when `gh api repos/{repo}/compare/{record-sha}...{head} --jq .status` prints `ahead` or `identical`. `{record-sha}` is the sha from the record's latest re-comment when one exists, else the short sha in its title. Unparseable, unresolvable, a failing compare, or `behind`/`diverged` → left open with one stderr line naming the record.
- `bot:in-progress` (spec Decision 2): the "files now pass" comment starts with the literal marker `<!-- windows-regression-files-pass -->`; a record that already has a comment containing it gets no further comment. The listing requests `comments` in `--json`.
- Unknown failing set (spec Decision 3): its one stderr line prints whatever else holds, including on a non-`--full` run.
- Family rule (spec Decision 4): any further ambiguity resolves fail-closed (fewer closes/comments, record left open), each skip one stderr line, exit code unchanged.
- `gh` argv entries are strings: issue numbers go through `String(n)`.
- Maintainer-only tooling under `tools/`. Nothing under `plugin/` changes.

## Acceptance coverage

- AC1.1–AC1.10: Task 2 Step 1's tests, one per bullet, each named `AC1.{k}: …`.
- AC2.1: Task 2 Step 6, the revert proof.
- AC3.1: Task 2 Step 3, which updates the header comment and the exit-code block / `USAGE`.
- AC4.1: `npm test` passes. That is `/build` Common Step 5's verification run plus each task's Step 4.

## Review Focus

1. A record body edited on github.com comes back with `\r\n` line endings. `listedFiles` must still parse it, and must not return `null` only because of `\r`. (Task 1 test.)
2. A bullet carries a suffix that `composeIssue` writes: `` - `tests/a.test.js` (timed out — no evidence) `` or the possible-rename note. The path is still the backticked span. (Task 1 test.)
3. The issue listing returns non-array JSON, or JSON that does not parse. Treat it as a listing failure: one stderr line, nothing closed, exit code unchanged. (Task 2 AC1.7 test.)
4. A fail run's listing also returns the record this same run just filed or commented on. Its files are in `failingFiles`, so it stays open. (Task 2 AC1.2 test lists both records.)
5. Path separators. Compare after collapsing backslash runs to `/` on both sides (the file's existing `slashes()`), so a Windows-shaped path in either source still matches.

---

### Task 1: Pure close-input helpers

**Role:** integration

**Files:**
- Modify: `tools/windows-regression/file-issue.js` (new helpers next to `timedOutOf`; extend `module.exports`)
- Test: `tests/windows-regression-file-issue.test.js` (append)

**Interfaces:**
- Produces:
  - `headFailingSet(report: object) -> { files: string[] } | { unknown: string }`. Returns `files` = `baselineAdjudicated.failingFiles` (string entries only, through `slashes()`) when `baselineAdjudicated` is a plain object with `eligible === true` and `Array.isArray(failingFiles)`. Otherwise returns `files: []` when `report.checks.tests.exitCode === 0`. Otherwise returns `{ unknown: 'baseline adjudication did not run and the tests check did not pass' }`.
  - `closeSkipReason(report: object) -> string | null`. `'not a full-suite run'` when `checks.tests.command` is not a string or has no whitespace-delimited `--full` token (`/(^|\s)--full(\s|$)/`). `'a test file timed out'` when `timedOutOf(report)` is non-empty. Otherwise `null`.
  - `listedFiles(body: string) -> string[] | null`. Splits on `/\r?\n/`, finds the line `### Newly failing test files`, collects every following line up to the first empty line or end of body. Each collected line must match `` /^- `([^`]+)`/ ``; any other line, zero bullets, or no heading returns `null`. Paths come back through `slashes()`.
  - `flakyPassedOf(report) -> string[]`: `baselineAdjudicated.flakyPassed` string entries through `slashes()`, else `[]`.
  - `recordShaOf(issue: { title, comments }) -> string | null`. The latest entry of `comments` (array of `{ body }`, in listing order — oldest first) whose `body` matches `/^The post-merge Windows check failed on commit ([0-9a-f]{7,40})\b/` gives its group 1. Else `issue.title` matching `/ after ([0-9a-f]{7,40})\b/` gives its group 1. Else `null`. Non-array `comments` or non-string bodies count as no re-comment.

- [ ] **Step 1: Append the failing tests**

Import the five helpers alongside `run, findMergedPr, classify`. Tests:

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

test('#6222: recordShaOf — latest re-comment sha, else the title short sha, else null', () => {
  const title = 'Windows regression: 1 test file(s) newly failing after 111111111';
  assert.equal(recordShaOf({ title, comments: [] }), '111111111');
  assert.equal(recordShaOf({ title, comments: [
    { body: 'The post-merge Windows check failed on commit 2222222222222222222222222222222222222222 (compared against x).' },
    { body: 'unrelated' },
    { body: 'The post-merge Windows check failed on commit 3333333333333333333333333333333333333333.' },
  ] }), '3333333333333333333333333333333333333333');
  assert.equal(recordShaOf({ title: 'Windows regression: something else', comments: 'x' }), null);
});
```

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL after Step 1 (`headFailingSet is not a function`)

- [ ] **Step 3: Implement the five helpers in `tools/windows-regression/file-issue.js` with the signatures above and export them**

- [ ] **Step 4: Run the file to verify it passes**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS, every test

- [ ] **Step 5: Real-input probe (Review Focus 1-2)**

Run `listedFiles` and `recordShaOf` over real records with a scratch script (never committed): `gh issue view {n} --repo thn-inc/claude-tweaks --json title,body,comments` for #3995 (shaped, open), #6181 (shaped, `bot:in-progress`), #6244 (unshaped) and #6077 (no file list). Expected: #3995 → `['tests/bin-lib/issues/comment-trust.test.js']`; #6181 → `['tests/bin-lib/driver/review-lens-workers-cli.test.js']`; #6244 → a non-empty list; #6077 → `null`; each of the first three gets a non-null `recordShaOf`. Quote the printed values in the task report. A mismatch stops the task.

- [ ] **Step 6: Commit**

```bash
git add tools/windows-regression/file-issue.js tests/windows-regression-file-issue.test.js
git commit -m "Derive Windows-regression close inputs from the report — refs #6222"
```

### Task 2: Close or comment on fixed records from `run()`, and document it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/windows-regression/file-issue.js` (new `closeFixedIssues`; `run()` call sites; header comment lines 4-40; `USAGE`)
- Modify: `.github/workflows/windows-regression.yml` (header comment only, lines 18-22: the `file` job also closes fixed records on main; it already runs on a passing verify via `if: always()`, holds `issues: write`, and `contents: read` covers the compare API)
- Modify: `docs/plugin-structure.md` (line 173's `windows-regression/file-issue.js` entry: add that on main it also closes open regression records whose files no longer fail and whose filing commit is an ancestor of the head, and comments once instead on a `bot:in-progress` one)
- Test: `tests/windows-regression-file-issue.test.js` (append; add `'issue close': ''` to `GH_DEFAULTS`)

The journeys that list this file in `files:` (`docs/journeys/learn-of-a-windows-regression-after-merge.md`, `docs/journeys/prove-a-windows-fix-on-a-branch-before-merge.md`) belong to `/build` Common Step 6, not to this task.

**Interfaces:**
- Consumes: `headFailingSet`, `closeSkipReason`, `listedFiles`, `flakyPassedOf`, `recordShaOf` (Task 1); `TITLE_PREFIX`, `LABEL`, `TOOL`.
- Produces: `closeFixedIssues({ report, repo, sha, runUrl }, deps) -> void`, called from `run()` only when `ref === MAIN_REF`. On a pass the call goes between `classify` and `return 0`. On a fail it goes after `fileOrComment` and before `return 1`. It is not called on the unreadable-report path. Exported constant `FILES_PASS_MARKER = '<!-- windows-regression-files-pass -->'`.

Behaviour of `closeFixedIssues`, in order:
1. `headFailingSet(report).unknown` → stderr `windows-regression: not closing fixed records — head failing set unknown ({reason})`, return. (Checked first, so it prints on a non-`--full` run too.)
2. `closeSkipReason(report)` non-null → stdout `windows-regression: not closing fixed records — {reason}`, return.
3. List: `deps.gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', LABEL, '--search', 'Windows regression in:title', '--json', 'number,title,body,labels,comments', '--limit', '200'])`. A throw, unparseable JSON or a non-array → stderr `windows-regression: fixed-record lookup failed: {message}`, return.
4. For each entry with an integer `number`, a string `title` starting with `TITLE_PREFIX`, and a string `body`: `files = listedFiles(body)`. `null` → stderr `windows-regression: #{n} left open — no parseable file list`, next. Any file in the failing set or in `flakyPassedOf(report)` → next, silently (normal case).
5. `recordSha = recordShaOf(entry)`. `null` → stderr `windows-regression: #{n} left open — filing commit unknown`, next. Else `status = String(deps.gh(['api', `repos/${repo}/compare/${recordSha}...${sha}`, '--jq', '.status'])).trim()` in try/catch; a throw → stderr `windows-regression: #{n} left open — compare {recordSha}...{short} failed: {message}`; a status other than `ahead`/`identical` → stderr `windows-regression: #{n} left open — {recordSha} is {status} relative to {short}`; either way next.
6. `labels` (array of `{name}`) contains `bot:in-progress`: when any `comments[].body` (string) includes `FILES_PASS_MARKER` → stdout `windows-regression: #{n} files pass — already commented (bot:in-progress)`, next. Else `deps.gh(['issue', 'comment', String(n), '--repo', repo, '--body-file', '-'], text)` and stdout `windows-regression: #{n} files pass at {short} — commented (bot:in-progress)`. Otherwise `deps.gh(['issue', 'close', String(n), '--repo', repo, '--reason', 'completed', '--comment', text])` and stdout `windows-regression: closed #{n} — its files pass at {short}`. Each call in its own try/catch; a throw → stderr `windows-regression: gh issue {close|comment} #{n} failed: {message}`, loop continues.
7. Comment text names `runUrl`, the full `sha`, and a `` - `file` `` bullet per file. The in-progress variant starts with `FILES_PASS_MARKER` on its own line and adds that the record is left open for its claimant to settle.

Header comment and `USAGE`: the exit-code `0` line no longer says "nothing filed" alone. Add a paragraph: on main, on every readable report, after filing, the CLI closes open regression records whose listed files are all absent from the head's failing set and whose filing commit is an ancestor of or identical to the head. Name the skip conditions (failing set unknown, not `--full`, a timed-out file, a flaky-passed listed file, no parseable list, filing commit unknown or not an ancestor) and the once-only `bot:in-progress` comment. Say a `gh` failure there never changes the exit code.

- [ ] **Step 1: Append the failing tests**

Fixtures (test-file helpers):

```js
const FULL = { command: 'npm test -- --full', exitCode: 0 };
const record = (number, files, labels = [], comments = []) => ({ number, title: `Windows regression: ${files.length} test file(s) newly failing after 111111111`,
  body: `lead\n\n### Newly failing test files\n${files.map((f) => `- \`${f}\``).join('\n')}\n\n_Filed by …_`, labels: labels.map((name) => ({ name })), comments });
const CLOSE_JSON = 'number,title,body,labels,comments';
const closeList = (...records) => (args) => (flag({ args }, '--json') === CLOSE_JSON ? JSON.stringify(records) : '[]');
const compareAs = (status) => (args) => (args[1].includes('/compare/') ? `${status}\n` : '[]');
const closedNums = (deps) => deps.calls.gh.filter((c) => c.args[0] === 'issue' && c.args[1] === 'close').map((c) => c.args[2]);
const closeListed = (deps) => deps.calls.gh.some((c) => c.args[1] === 'list' && flag(c, '--json') === CLOSE_JSON);
```

Tests (each passes `{ 'issue list': closeList(...), api: compareAs('ahead') }` unless stated):
- `AC1.1: a pass run closes a record whose files are all absent from the failing set`. Report `{ pass: true, checks: { tests: FULL } }`, list `record(4, ['tests/a.test.js'])`. Expect exit `0`, `closedNums` = `['4']`, the close call includes `'--reason', 'completed'`, its `--comment` includes `RUN_URL`, `SHA` and `` `tests/a.test.js` ``, and the compare call's path is `repos/o/r/compare/111111111...${SHA}`.
- `AC1.2: a fail run closes a stale record while filing the new one`. Report `{ pass: false, checks: { tests: { ...FULL, exitCode: 1 } }, baselineAdjudicated: { eligible: true, verdict: 'fail', attributable: ['tests/new.test.js'], failingFiles: ['tests/new.test.js', 'tests/old-still.test.js'] } }`, list `record(4, ['tests/fixed.test.js'])` and `record(5, ['tests/new.test.js'])`. Expect exit `1`, `created(deps)` truthy, `closedNums` = `['4']`, and the create call's index in `deps.calls.gh` is lower than the close call's.
- `AC1.3: a record with one still-failing file stays open`. Adjudicated pass (`effectivePass: true`, `eligible: true`, `failingFiles: ['tests/b.test.js']`), record files `['tests/a.test.js', 'tests/b.test.js']` → `closedNums` empty, no comment, no compare call.
- `AC1.4: a timed-out, non---full, or flaky-passed run closes nothing`. Three reports, each with a record whose files are otherwise absent. (a) `baselineAdjudicated: { eligible: true, failingFiles: [], timedOut: ['tests/x.test.js'] }`. (b) `checks.tests.command: 'npm test'` with `exitCode: 0`. (c) `flakyPassed` containing the record's file, `failingFiles` not. Each: `closedNums` empty. (a) and (b): `closeListed(deps)` false.
- `AC1.5: a (not adjudicated) record is never closed`. List `{ number: 6, title: 'Windows regression: tests failing after 111111111 (not adjudicated)', body: '### Failing output (x)\n\n```\ny\n```', labels: [], comments: [] }` → `closedNums` empty, one stderr line matching `/#6 left open — no parseable file list/`.
- `AC1.6: a bot:in-progress record is commented on, not closed`. `record(7, ['tests/a.test.js'], ['bot:in-progress'])` → `closedNums` empty, `commented(deps).args[2] === '7'`, its input starts with `FILES_PASS_MARKER` and names `SHA` and `tests/a.test.js`.
- `AC1.7: a throwing gh leaves the exit code unchanged`. Pass report: the listing throws → exit `0`, one stderr `fixed-record lookup failed` line; the listing returns `'{}'` → exit `0`, one such line. `issue close` throws for two records → exit `0`, two stderr `gh issue close` lines, both close calls attempted. Fail report with a throwing close → exit `1`.
- `AC1.8: a record whose filing commit is not an ancestor of the head, or cannot be resolved, stays open with one stderr line`. Four runs with `record(4, ['tests/a.test.js'])`: `compareAs('behind')`, `compareAs('diverged')`, an `api` handler throwing for `/compare/`, and a record titled `Windows regression: 1 test file(s) newly failing after somewhere` (no sha; no compare call made). Each: `closedNums` empty, no comment, exactly one stderr line naming `#4` and `left open`. Plus: a record with a re-comment `{ body: 'The post-merge Windows check failed on commit 2222222222222222222222222222222222222222.' }` compares `2222222222222222222222222222222222222222...${SHA}`.
- `AC1.9: a bot:in-progress record already carrying the files-pass marker gets no second comment`. `record(7, ['tests/a.test.js'], ['bot:in-progress'], [{ body: `${FILES_PASS_MARKER}\nearlier` }])` → no comment call, `closedNums` empty, one stdout line matching `/#7 files pass — already commented/`.
- `AC1.10: an unknown failing set prints its stderr line even on a non---full run`. Two reports: `{ pass: false, effectivePass: true, checks: { tests: { ...FULL, exitCode: 1 } } }` and `{ pass: false, effectivePass: true, checks: { tests: { command: 'npm test', exitCode: 1 } } }` → each exit `0`, `closeListed(deps)` false, exactly one stderr line matching `/head failing set unknown/`.
- `#6222: a non-main ref and an unreadable report never list for closing`. Neither run has `closeListed(deps)` true.

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL after Step 1 (no `issue close` call is made)

- [ ] **Step 3: Implement `closeFixedIssues` and wire it into `run()` as specified; update the header comment, `USAGE`, the workflow header comment, and `docs/plugin-structure.md`**

- [ ] **Step 4: Run the file to verify it passes**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS, every test. Pre-existing tests included: their reports carry no `--full` command or no adjudicated failing set, so the sweep returns before listing; a pre-existing test that asserts on the exact stderr line set may now see the unknown-set line — adjust such an assertion only to tolerate that one line, never weaken what it checks.

- [ ] **Step 5: Commit**

```bash
git add tools/windows-regression/file-issue.js tests/windows-regression-file-issue.test.js .github/workflows/windows-regression.yml docs/plugin-structure.md
git commit -m "Close Windows-regression records whose files pass on main — refs #6222"
```

- [ ] **Step 6: Revert proof (AC2.1)**

After the commit, use the Edit tool to put a bare `return;` first in the body of `closeFixedIssues`. Run `node --test tests/windows-regression-file-issue.test.js`. Confirm each close/comment-asserting test (AC1.1, AC1.2, AC1.6, AC1.7's throwing-close case, AC1.8's re-comment compare case, AC1.10) goes red, and quote those failing test names in the task report. Remove the line with the Edit tool. Then `git -C "{worktree}" diff --quiet -- tools/windows-regression/file-issue.js` must exit 0. Never use `git checkout`, `git stash` or `git reset` for this.
