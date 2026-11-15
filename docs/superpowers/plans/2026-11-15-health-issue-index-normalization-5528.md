# Health Issue Index Normalization (#5528) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every health sweep read one issue-index shape — lowercase `state`, label-name strings — whatever shape the session wrote into the `--issues` file, so a closed match reopens and a `wontfix` label suppresses.

**Architecture:** Normalize once in the shared loader (`loadIssueIndex`), the single producer of the index for all four health CLIs (and for `tools/upstream-drift/run.js`, a fifth caller that goes through the same loader and `health-core`'s `decide`). Keep a one-line case-insensitive compare in code-health's forked `decide()` as a second guard for callers that hand-build an index.

**Tech Stack:** Node (CommonJS), `node --test`, no dependencies. CI runs Node 20.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T210059-spec-5528-5529/spec-5528/work/5528-spec.md` (materialized from GitHub issue #5528)

## Global Constraints

- Normalization lives in the loader, never in a dedup module: `tests/bin-lib/health-core/purity.test.js` asserts the dedup module does no I/O.
- `loadIssueIndex`'s three existing stderr lines (`could not read or parse --issues file`, `must contain a JSON array`, `skipping malformed issue entry`) are asserted by existing tests. Do not reword them.
- The new stderr line is exactly `[{toolName}] loadIssueIndex: ignored {n} label entries with no name` plus a newline, printed at most once per `loadIssueIndex` call, and never when nothing was dropped. The wording is fixed for every `n`, including `n = 1`.
- Label names are matched exactly. No case folding: `Wontfix` is not `wontfix`.
- Do not change the order of the dedup decisions, the loader's return value for an unreadable or non-array file, `plugin/bin/lib/code-health/pull-issues.js`, or any skill's `gh issue list` command.
- Existing test cases in `tests/bin-lib/health-core/issue-index.test.js`, `tests/bin-lib/health-core/dedup.test.js`, `tests/bin-lib/code-health/dedup.test.js` and `tests/bin-lib/health-core/purity.test.js` are not edited. New cases are appended.
- Every new test is run against the unmodified source first and seen failing, except where a step says the case is green at base by design and says why.
- Commit messages: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix, with a `refs #5528` line.
- Commit tests only where the task asks for them, sized like the neighboring test files. Touch only what the task requires. Do not reformat adjacent code.
- Governing project skills (`.claude/skills/`): none name these modules with a rule that applies. `gh-api-module-pattern/cli-wrapper-contract.md` names `plugin/bin/lib/health-core/*.js` only for its no-`process.exit()` rule, and this change adds no exit.

## Review Focus

Inputs the spec is silent on. Each has a test in Task 1.

1. `labels` present but not an array (a bare string such as `"wontfix"`): stored as `[]` and counted as one ignored entry. It must never reach `.includes('wontfix')` as a string, where it would substring-match.
2. Nameless labels spread over several issues: one stderr line carrying the file-wide total, not one line per issue.
3. A label object whose `name` is not a string (`{ "name": 5 }`, `{ "name": null }`): dropped and counted, same as an object with no `name`.
4. A mixed-case `state` (`Closed`): stored `closed`.
5. An entry with no `fingerprint`: not stored, so its labels are not normalized and add nothing to the ignored count.

## Decisions recorded at plan time

- **Consumers of the loader's output** (grep `loadIssueIndex` over `plugin tests tools`): `plugin/bin/code-health.js:218` → code-health `decide`; `plugin/bin/docs-health.js:184`, `plugin/bin/lib/health-core/validate-findings-dispatch.js:46`, `tools/upstream-drift/run.js:612` → `health-core` `decide`. All are pick-one lookups through a `decide()`; none lists entries or reads `state`/`labels` any other way. No consumer needs a change.
- **Prose describing the old shape:** `plugin/bin/lib/health-core/issue-index.js:5-7` (header comment) and `plugin/bin/lib/code-health/dedup.js:15` (`state ∈ 'open' | 'closed'`) are updated in the tasks below. The four skills' `{ number, state, labels, fingerprint }` mentions, `health-filing-digest.md` and `digest.js`'s comments describe the file the session writes, which does not change (spec Non-Goals) — no edit.
- **Size:** `plugin/skills/_shared/health-issue-index.md` is 6,983 B against the 52,500 B rail. No test reads this file (`git grep health-issue-index -- tests` is empty).
- **Spec assumptions (`ASSUMPTION — verify at build`):** probed and logged at Spec Step 3 in the run's `decisions.md`. `gh` returns `CLOSED` and label objects (seen on #1633). The MCP projection could not be probed in this session. Neither changes the plan: the fix is correct for both shapes.
- **Full-suite gotcha:** implementers run only the files their task names. The controller's Common Step 5 verification and the `test` job on PR #5532 are the full-suite proof, and the build is not called done before that job is green on the head commit.
- **Plan review (spec `## Plan Review Clarifications`):** the user decided both open questions. A non-array `labels` value is dropped and reported (Review Focus item 1 as written), and the doc sentence in Task 1 Step 4 gets no prose-conformance test.
- **Pull request note (spec Gotchas):** the PR summary already says a code-health sweep will now reopen matched closed issues it used to skip.

---

### Task 1: Normalize `state` and `labels` in `loadIssueIndex`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/health-core/issue-index.js`
- Modify: `plugin/skills/_shared/health-issue-index.md`
- Test: `tests/bin-lib/health-core/issue-index.test.js`
- Test: `tests/bin-lib/code-health/cli-validate-findings.test.js`
- Test: `tests/bin-lib/harness-health/cli-validate-findings.test.js`

**Interfaces:**
- Consumes: nothing from another task.
- Produces: `loadIssueIndex(file, toolName, { stderr, cwd })` unchanged in signature. Each stored entry is `{ number, state, labels }` with `state` a lowercase string (`''` when the input had none or a non-string) and `labels` a `string[]` of label names.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/health-core/issue-index.test.js`:

```js
const { decide: coreDecide } = require('../../../plugin/bin/lib/health-core/dedup');
const { decide: codeHealthDecide } = require('../../../plugin/bin/lib/code-health/dedup');

function load(entries, toolName = 'code-health') {
  let err = '';
  const index = loadIssueIndex(tmpFile(JSON.stringify(entries)), toolName, { stderr: (t) => { err += t; } });
  return { index, err };
}

test('AC1.1: gh raw shape — uppercase state and label objects normalize, stderr stays quiet', () => {
  const { index, err } = load([{ number: 7, state: 'CLOSED', labels: [{ name: 'wontfix' }, { name: 'by:code-health' }], fingerprint: 'fp' }]);
  assert.deepStrictEqual(index, { fp: { number: 7, state: 'closed', labels: ['wontfix', 'by:code-health'] } });
  assert.strictEqual(err, '');
});

test('AC2.1: nameless label elements are dropped, the issue is kept, one stderr line reports the count', () => {
  const { index, err } = load([{ number: 3, state: 'open', labels: ['bug', null, { id: 1 }, 42, { name: 'wontfix' }], fingerprint: 'fp' }]);
  assert.deepStrictEqual(index, { fp: { number: 3, state: 'open', labels: ['bug', 'wontfix'] } });
  assert.strictEqual(err, '[code-health] loadIssueIndex: ignored 3 label entries with no name\n');
});

const STATELESS = [{ number: 1, fingerprint: 'no-state' }, { number: 2, state: 5, fingerprint: 'num-state' }];

test('AC3.1: a missing or non-string state is stored as the empty string', () => {
  const { index, err } = load(STATELESS);
  assert.strictEqual(index['no-state'].state, '');
  assert.strictEqual(index['num-state'].state, '');
  assert.strictEqual(err, '');
});

test('AC3.2: both decide() functions skip an entry whose state normalized to the empty string', () => {
  const { index } = load(STATELESS);
  for (const fp of ['no-state', 'num-state']) {
    assert.deepStrictEqual(coreDecide({ id: fp }, index, {}), { action: 'skip', issue: index[fp].number });
    assert.deepStrictEqual(codeHealthDecide({ id: fp, risk: 'high' }, index, {}), { action: 'skip', issue: index[fp].number });
  }
});

test('a mixed-case state is lowercased', () => {
  const { index } = load([{ number: 4, state: 'Closed', fingerprint: 'fp' }]);
  assert.strictEqual(index.fp.state, 'closed');
});

test('nameless labels across several issues are totalled in one stderr line, under the caller\'s tool name', () => {
  const { index, err } = load([
    { number: 1, state: 'open', labels: [null, 'x'], fingerprint: 'a' },
    { number: 2, state: 'open', labels: [{}, 7, { name: 'y' }], fingerprint: 'b' },
  ], 'docs-health');
  assert.deepStrictEqual(index.a.labels, ['x']);
  assert.deepStrictEqual(index.b.labels, ['y']);
  assert.strictEqual(err, '[docs-health] loadIssueIndex: ignored 3 label entries with no name\n');
});

test('a label object whose name is not a string is dropped and counted', () => {
  const { index, err } = load([{ number: 1, state: 'open', labels: [{ name: 5 }, { name: null }, { name: 'ok' }], fingerprint: 'fp' }]);
  assert.deepStrictEqual(index.fp.labels, ['ok']);
  assert.strictEqual(err, '[code-health] loadIssueIndex: ignored 2 label entries with no name\n');
});

test('a non-array labels value is stored as [] and counted once; a null one is stored as [] quietly', () => {
  const { index, err } = load([
    { number: 1, state: 'open', labels: 'wontfix', fingerprint: 'str' },
    { number: 2, state: 'open', labels: null, fingerprint: 'nul' },
  ]);
  assert.deepStrictEqual(index.str.labels, []);
  assert.deepStrictEqual(index.nul.labels, []);
  assert.strictEqual(err, '[code-health] loadIssueIndex: ignored 1 label entries with no name\n');
  assert.deepStrictEqual(coreDecide({ id: 'str' }, index, {}), { action: 'skip', issue: 1 });
});

test('an entry with no fingerprint adds nothing to the ignored count', () => {
  const { index, err } = load([
    { number: 1, state: 'open', labels: [null] },
    { number: 2, state: 'open', labels: ['a'], fingerprint: 'fp' },
  ]);
  assert.deepStrictEqual(Object.keys(index), ['fp']);
  assert.strictEqual(err, '');
});
```

Append to `tests/bin-lib/code-health/cli-validate-findings.test.js`, using the file's own `tmp`, `validFinding` and `runValidateFindings` helpers and the fingerprint-learning first run the neighboring dedup tests use:

```js
test('AC5.1: an --issues file in gh\'s raw shape — a CLOSED match with no wontfix label reopens and is cached as regressed', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));
  const first = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-raw-reopen-1']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{
    number: 8, state: 'CLOSED', fingerprint: fp,
    labels: [{ id: 'LA_1', name: 'by:code-health', color: 'ededed', description: '' }],
  }]));
  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-raw-reopen-2']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(JSON.parse(second.stdout).length, 1, 'a closed non-wontfix match must emit a reopen payload');
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'regressed');
  assert.strictEqual(cache[fp].issue, 8);
});

test('AC5.2: an --issues file in gh\'s raw shape — a wontfix label object suppresses and is cached as wontfix', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding({ severity: 'high' })]));
  const first = runValidateFindings(root, findingsFile, ['--slice', 'src/api', '--run-id', 'r-raw-wontfix-1']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{
    number: 7, state: 'CLOSED', fingerprint: fp,
    labels: [{ id: 'LA_1', name: 'by:code-health' }, { id: 'LA_2', name: 'wontfix' }],
  }]));
  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--slice', 'src/api', '--run-id', 'r-raw-wontfix-2']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(JSON.parse(second.stdout).length, 0, 'a wontfix label object must suppress');
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), 'utf8'));
  assert.strictEqual(cache[fp].status, 'wontfix');
  assert.strictEqual(cache[fp].issue, 7);
});
```

Append to `tests/bin-lib/harness-health/cli-validate-findings.test.js`, using that file's own helpers. The fixture's state is `CLOSED` on purpose: at base the object label is not recognised, so the closed match reopens and emits a payload. With an `OPEN` state the finding is skipped before and after, and the test cannot fail.

```js
test('AC6.1: an --issues file whose matching issue carries the label object {name: "wontfix"} suppresses the finding', () => {
  const root = tmp();
  const findingsFile = path.join(root, 'findings.json');
  fs.writeFileSync(findingsFile, JSON.stringify([validFinding()]));
  const first = runValidateFindings(root, findingsFile, ['--target', 'auth', '--kind', 'skill']);
  const fp = JSON.parse(first.stdout)[0].body.match(/<!--\s*work-fingerprint:\s*(harnesshealth-[0-9a-f]{8})\s*-->/)[1];

  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([{
    number: 9, state: 'CLOSED', fingerprint: fp,
    labels: [{ id: 'LA_1', name: 'by:harness-health' }, { id: 'LA_2', name: 'wontfix' }],
  }]));
  const second = runValidateFindings(root, findingsFile, ['--issues', issuesFile, '--target', 'auth', '--kind', 'skill']);
  assert.strictEqual(second.status, 0, `stderr: ${second.stderr}`);
  assert.strictEqual(JSON.parse(second.stdout).length, 0, 'a wontfix label object must suppress, not reopen');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/health-core/issue-index.test.js tests/bin-lib/code-health/cli-validate-findings.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js`
Expected: FAIL. Red at base: AC1.1, AC2.1, AC3.1, AC5.1, AC5.2, AC6.1, and the mixed-case, totalled, non-string-name and non-array cases. Green at base by design, as pins on behavior the change must keep: AC3.2 (a missing state already skips in both `decide()` functions; the fix must not turn `''` into a reopen) and the no-fingerprint case (nothing is printed today either). Every pre-existing case stays green. Quote the runner's failing test names in the report.

- [ ] **Step 3: Implement the normalization in `plugin/bin/lib/health-core/issue-index.js`**

Inside `loadIssueIndex`, for each entry it stores (the existing `if (issue.fingerprint)` branch only):

- `state`: `issue.state.toLowerCase()` when `typeof issue.state === 'string'`, else `''`.
- `labels`: a nullish value becomes `[]` with nothing counted. An array is reduced element by element: a string is kept; an object with a string `name` contributes that name; anything else is dropped and counted. Any other non-array value becomes `[]` and counts as one dropped entry.
- After the loop, when the file-wide dropped total is above zero, print once through the injected `stderr`: `` `[${toolName}] loadIssueIndex: ignored ${n} label entries with no name\n` ``.

A module-private helper `normalizeLabels(labels) → { names: string[], dropped: number }` is the suggested shape; it is not exported. Update the header comment (lines 5-7) to say the stored entry's `state` is lowercased and `labels` reduced to label names.

- [ ] **Step 4: State the accepted input shapes in `plugin/skills/_shared/health-issue-index.md`**

In `## Transport`, insert this paragraph directly after the `gh` absent paragraph (the one that names the `{ number, state, labels, fingerprint }` shape and ends "…and has caused real duplicate-filing incidents (see that file).") and before "A missing `gh` is a reason to **change transport…":

```markdown
Neither field needs cleaning before the file is written, on either transport. `state` may be in
either case (`gh` returns `OPEN`/`CLOSED`), and each `labels` element may be a label name or
`gh`'s label object: `loadIssueIndex` (`bin/lib/health-core/issue-index.js`) lowercases `state`
and reduces `labels` to label names. A label element with no string `name` is dropped, and the
load reports the total once on stderr (`ignored {n} label entries with no name`).
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/health-core/issue-index.test.js tests/bin-lib/code-health/cli-validate-findings.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/health-core/dedup.test.js tests/bin-lib/health-core/purity.test.js tests/bin-lib/health-core/validate-findings-dispatch.test.js`
Expected: PASS, 0 failures. Quote the runner's summary lines.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/health-core/issue-index.js plugin/skills/_shared/health-issue-index.md tests/bin-lib/health-core/issue-index.test.js tests/bin-lib/code-health/cli-validate-findings.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js
git commit -m "Normalize issue state and labels in the health issue index — closed matches reopen and wontfix label objects suppress" -m "refs #5528"
```

---

### Task 2: Compare the state case-insensitively in code-health's `decide()`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/code-health/dedup.js`
- Test: `tests/bin-lib/code-health/dedup.test.js`
- Waived `tests/bin-lib/health-core/purity.test.js`: read only, never edited — Task 1 Step 5 and this task's Step 4 run it

**Interfaces:**
- Consumes: nothing from Task 1. This test hand-builds its index, so the loader is not involved.
- Produces: `decide(finding, issueIndex, cache, opts)` unchanged in signature and in every existing outcome.

- [ ] **Step 1: Write the failing test**

Append to `tests/bin-lib/code-health/dedup.test.js`:

```js
test('AC4.1: an uppercase CLOSED state with no wontfix label -> reopen', () => {
  const index = { 'codehealth-upper': { number: 8, state: 'CLOSED', labels: [] } };
  const result = decide(F('codehealth-upper'), index, {});
  assert.strictEqual(result.action, 'reopen');
  assert.strictEqual(result.issue, 8);
});
```

- [ ] **Step 2: Run the test to verify it fails (AC4.2)**

Run: `node --test tests/bin-lib/code-health/dedup.test.js`
Expected: FAIL on `AC4.1` only — `'skip' !== 'reopen'`. AC4.2 is this red run: the test fails on the code as it stands. Quote the failing assertion.

- [ ] **Step 3: Make the compare case-insensitive in `plugin/bin/lib/code-health/dedup.js`**

Line 61 becomes the same compare `plugin/bin/lib/health-core/dedup.js:65` uses: `String(match.state).toLowerCase() === 'closed'`. Replace the header comment's `state ∈ 'open' | 'closed'` line (line 15) with one saying the loader stores `state` lowercase and that the compare is case-insensitive so a hand-built index carrying `gh`'s `OPEN`/`CLOSED` gets the same answer. No other line changes.

- [ ] **Step 4: Run the tests to verify they pass (AC7.1)**

Run: `node --test tests/bin-lib/code-health/dedup.test.js tests/bin-lib/health-core/issue-index.test.js tests/bin-lib/health-core/dedup.test.js tests/bin-lib/health-core/purity.test.js`
Expected: PASS, 0 failures. AC7.1: these four files pass with no edit to their pre-existing cases — confirm with `git diff --stat` that the only changes to them are appended cases. Quote the runner's summary lines.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/dedup.js tests/bin-lib/code-health/dedup.test.js
git commit -m "Compare issue state case-insensitively in code-health dedup — a hand-built index with CLOSED reopens" -m "refs #5528"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (state) and 2 (labels) and 3 (stderr line) → Task 1 Step 3; Deliverable 4 (code-health compare) → Task 2; Deliverable 5 (doc sentence) → Task 1 Step 4; Deliverable 6 (tests seen failing) → each task's Step 2. AC1.1, AC2.1, AC3.1, AC3.2, AC5.1, AC5.2, AC6.1 → Task 1; AC4.1, AC4.2, AC7.1 → Task 2.
- **Placeholders:** none.
- **Types:** `loadIssueIndex`'s stored entry `{ number, state: string, labels: string[] }` is the only shape both tasks and all five callers read.
