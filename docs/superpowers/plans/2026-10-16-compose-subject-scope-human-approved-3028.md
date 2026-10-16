# compose-subject stderr, `--scope`, and `human-approved` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silence the handled `issueType` rejection's echoed gh stderr, add an optional commit `scope` to the merge-subject composer, and give close-out's human-confirmed merge its own `human-approved` tag that the auto-merge metric excludes.

**Architecture:** `scope` is validated and rendered inside the pure composer (`plugin/bin/lib/release/subject.js`), so every caller gets one rule; the CLI (`plugin/bin/lib/compose-subject.js`) only parses `--scope` and threads it through, the same way `tag` already flows. The stderr fix is one option on the single `realDeps.runner` seam. The tag is prose-only: registered in `pr-first-merge.md` Step 3, named at its one caller (`dispatch/close-out.md` step 5), and documented as excluded in `github-pr-scan.md`'s metric (its `jq` filter is unchanged).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T191151-record-3028/work/3028-spec.md`

**Scope keywords:** composeSubject, human-approved, --scope

## Global Constraints

- `SUBJECT_BUDGET = 72` (`plugin/bin/lib/release/subject.js`) stays unchanged; a scope is counted inside it.
- `plugin/skills/_shared/pr-first-merge.md` must stay at or under `PR_FIRST_BYTE_CEILING = 31304` (`tests/merge-subject-composer-conformance.test.js:26`); it is 30761 bytes at base `d2a26abf0` — 543 bytes of headroom. Measure with `wc -c` after editing (LF-measured).
- `plugin/skills/_shared/github-pr-scan.md` is 45,927 B at base against a 46,080 B ceiling; its composed `pr-scan` step has 135 B of headroom — the Task 3 insert there is one short line.
- `tests/bundle-fixes-reconciliation-2015.test.js` requires `the manifest's \`complete\` specs only` and `` `never-started:`/`abandoned:` reason `` within the first 1500 chars after `## Step 3: Attempt auto-merge` — insert new prose **after** those phrases, never before.
- Scope token rule: a single `[A-Za-z0-9._/-]+` token after trim; blank/whitespace-only/omitted → unscoped; `(` and `)` rejected.
- `realDeps.runner` keeps `windowsHide: true` (present at base, absent from the record's quoted diff) and adds `stdio: ['ignore', 'pipe', 'pipe']`.
- The `--scope` usage-error text contains `scope must be a single token`.
- Commits: subject `{Verb} {what} — {detail}`, body `Refs #3028`, trailer `Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG`. Never write `Fixes`/`Closes`.

## Review Focus

1. A scope plus a long title — the truncated subject must still fit 72 chars and keep `type(scope):` intact (pinned in Task 1).
2. A breaking record with a scope — the `!` goes after the scope: `feat(cli)!:` (pinned in Tasks 1 and 2).
3. `--scope` given as the last argv token or followed by another flag — a parse error, never `scope: undefined` silently unscoped (pinned in Task 2).
4. A non-string `scope` passed directly to `composeSubject` (e.g. a number from a JS caller) — treated as omitted, never thrown on `.trim()` (pinned in Task 1).
5. A genuine fatal gh failure after the stdio change — its text must still reach stderr through `err.message` (the existing `exit 3` test plus the runner-options pin in Task 2 cover it; the fatal path prints `errMessage(err)` unchanged).

---

### Task 1: Optional `scope` in `composeSubject`

**Files:**
- Modify: `plugin/bin/lib/release/subject.js` (the `composeSubject` signature comment + prefix construction, ~lines 54-75)
- Test: `tests/bin-lib/release/subject.test.js` (append at end)

**Interfaces:**
- Consumes: nothing new.
- Produces: `composeSubject({ type, title, number, scope?, breaking?, summary?, migrationNote?, releaseNote, fixes?, tag?, breakingRecords? }) -> { title, body }`. `scope` is an optional string; invalid → throws `ComposeSubjectError` whose message contains `scope must be a single token`.

- [ ] **Step 1: Write the failing test** — append to `tests/bin-lib/release/subject.test.js`:

```js
test('scope (#3028): type(scope): prefix counted inside the 72-char budget; blank, omitted, or non-string stays unscoped; non-token rejected', () => {
  assert.equal(composeSubject({ type: 'bug', title: 'Fix Y', number: 7, scope: 'api', releaseNote: 'N.' }).title, 'fix(api): Fix Y (#7)');
  assert.equal(composeSubject({ type: 'bug', title: 'Fix Y', number: 7, scope: 'ui/forms', releaseNote: 'N.' }).title, 'fix(ui/forms): Fix Y (#7)');
  assert.equal(composeSubject({ type: 'bug', title: 'Fix Y', number: 7, scope: '  ', releaseNote: 'N.' }).title, 'fix: Fix Y (#7)');
  assert.equal(composeSubject({ type: 'bug', title: 'Fix Y', number: 7, releaseNote: 'N.' }).title, 'fix: Fix Y (#7)');
  assert.equal(composeSubject({ type: 'bug', title: 'Fix Y', number: 7, scope: 42, releaseNote: 'N.' }).title, 'fix: Fix Y (#7)');
  assert.equal(
    composeSubject({ type: 'feature', title: 'Drop X', number: 8, scope: 'cli', breaking: true, migrationNote: 'Use Y.', releaseNote: 'N.' }).title,
    'feat(cli)!: Drop X (#8)',
  );
  const long = composeSubject({ type: 'feature', title: 'word '.repeat(30).trim(), number: 4321, scope: 'web-ui', releaseNote: 'N.' }).title;
  assert.ok(long.startsWith('feat(web-ui): word'), long);
  assert.ok(long.length <= SUBJECT_BUDGET, `${long.length} > ${SUBJECT_BUDGET}: ${long}`);
  assert.ok(long.endsWith(' (#4321)'), long);
  for (const bad of ['a(b)', 'two words', 'x:y']) {
    assert.throws(
      () => composeSubject({ type: 'bug', title: 'T', number: 1, scope: bad, releaseNote: 'N.' }),
      (err) => err instanceof ComposeSubjectError && /scope must be a single token/.test(err.message),
      `scope ${JSON.stringify(bad)} must be rejected`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/release/subject.test.js`
Expected: FAIL — the scope test reports `'fix: Fix Y (#7)' !== 'fix(api): Fix Y (#7)'` (scope ignored today).

- [ ] **Step 3: Write minimal implementation** — in `plugin/bin/lib/release/subject.js`, replace the signature comment and signature:

```js
// { type, title, number, scope?, breaking?, summary?, migrationNote?, releaseNote, fixes?, tag?, breakingRecords? } -> { title, body }
// `scope` is Conventional Commits' optional `type(scope):` noun (#3028) — for a
// project whose own commit convention requires one; omitted or blank, the
// subject is unscoped. One token only: `(`/`)`/whitespace would break the
// prefix grammar release-please parses back out.
function composeSubject({ type, title, number, scope, breaking = false, summary, migrationNote, releaseNote, fixes, tag, breakingRecords } = {}) {
```

and replace `const prefix = breaking ? \`${prefixBase}!\` : prefixBase;` with:

```js
  const cleanScope = typeof scope === 'string' ? scope.trim() : '';
  if (cleanScope && !/^[A-Za-z0-9._/-]+$/.test(cleanScope)) {
    throw usage(`scope must be a single token of letters, digits, . _ / -, got ${JSON.stringify(scope)} for #${number}`);
  }
  const scoped = cleanScope ? `${prefixBase}(${cleanScope})` : prefixBase;
  const prefix = breaking ? `${scoped}!` : scoped;
```

Also update the file header comment's grammar line from `` `{type}[!]: {title} (#{n})` `` to `` `{type}[(scope)][!]: {title} (#{n})` ``.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/release/subject.test.js`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/release/subject.js tests/bin-lib/release/subject.test.js
git commit -m "Add optional scope to composeSubject — type(scope)[!]: prefix inside the 72-char budget" -m "Refs #3028" -m "Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG"
```

### Task 2: `--scope` flag and piped gh stderr in the CLI

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js` (header `// Usage:` comment ~line 17; `USAGE` ~line 55; `parseArgs` ~lines 78-90; `realDeps.runner` ~line 206; the `composeSubject({...})` call ~lines 284-295)
- Modify: `docs/plugin-structure.md:173` (the compose-subject CLI usage line)
- Test: `tests/bin-lib/compose-subject.test.js` (append at end)

**Interfaces:**
- Consumes: Task 1's `composeSubject({ ..., scope })`.
- Produces: CLI flag `--scope <token>`; `parseArgs(argv)` returns `opts.scope` (string or `null`); a missing value returns `{ error: 'missing value for --scope' }`.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/compose-subject.test.js`:

```js
test('--scope (#3028): parsed, threaded into the subject, breaking keeps ! after the scope, non-token exits 1', () => {
  assert.equal(parseArgs(['2251', '--scope', 'api']).scope, 'api');
  assert.equal(parseArgs(['2251']).scope, null);
  assert.ok(parseArgs(['2251', '--scope']).error, 'trailing --scope with no value is a parse error');
  assert.ok(parseArgs(['2251', '--scope', '--shell']).error, '--scope followed by another flag is a parse error');

  const ok = fakeDeps();
  assert.equal(run(['2251', '--scope', 'web-ui'], ok.deps), 0, ok.out.stderr);
  assert.equal(JSON.parse(ok.out.stdout).title, 'feat(web-ui): Merge-time conventional subject (#2251)');

  const brk = fakeDeps();
  assert.equal(run(['2260', '--scope', 'cli'], brk.deps), 0, brk.out.stderr);
  assert.equal(JSON.parse(brk.out.stdout).title, 'feat(cli)!: Drop the legacy flag (#2260)');

  const bad = fakeDeps();
  assert.equal(run(['2251', '--scope', 'two words'], bad.deps), 1);
  assert.match(bad.out.stderr, /scope must be a single token/);
});

test('realDeps.runner (#3028) pipes gh stderr instead of inheriting it, and keeps windowsHide', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../plugin/bin/lib/compose-subject.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("runner: (args) => execFileSync('gh'"));
  assert.ok(line, 'realDeps.runner line must exist');
  assert.ok(line.includes("stdio: ['ignore', 'pipe', 'pipe']"), line);
  assert.ok(line.includes('windowsHide: true'), line);
});

test('USAGE (#3028) advertises --scope', () => {
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.match(USAGE, /\[--scope <scope>\]/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/compose-subject.test.js`
Expected: FAIL — `parseArgs(['2251', '--scope', 'api'])` returns `{ error: 'unknown argument: --scope' }` so `.scope` is `undefined`; the runner test fails on the missing `stdio`; the USAGE test fails.

- [ ] **Step 3: Write minimal implementation** in `plugin/bin/lib/compose-subject.js`:

Header comment line 17 and `USAGE` — insert ` [--scope <scope>]` after ` [--tag <tag>]` in both:

```js
// Usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--scope <scope>] [--shell] [--help]
```
```js
const USAGE = 'usage: compose-subject.js <n>[,<m>...] [<k>...] [--repo owner/name] [--tag <tag>] [--scope <scope>] [--shell] [--help]\n';
```

`parseArgs`:

```js
  const opts = { numbers: [], repo: null, tag: null, scope: null, shell: false, help: false };
```
```js
    if (a === '--repo' || a === '--tag' || a === '--scope') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `missing value for ${a}` };
      if (a === '--repo') opts.repo = v; else if (a === '--tag') opts.tag = v; else opts.scope = v;
      i++;
      continue;
    }
```

`realDeps.runner`:

```js
  // stderr piped, not inherited (#3028): execFileSync's default echoes the
  // child's stderr to ours, so the handled #2561 `Unknown JSON field:
  // "issueType"` rejection printed gh's full field list ahead of a successful
  // compose and read as a failure. err.stderr (isUnknownIssueTypeField) and
  // err.message (the fatal paths) still carry the text.
  runner: (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true }),
```

The `composeSubject({...})` call in `run()` — add `scope: opts.scope,` directly after `number: subjectRecord.number,`.

In `docs/plugin-structure.md:173`, insert ` [--scope <scope>]` after ` [--tag <tag>]` in the usage, and append `, optional type(scope): via --scope` after `[tag] body paragraph` in the same line's description.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/compose-subject.test.js tests/bin-lib/release/subject.test.js`
Expected: PASS (all, including the existing `exit 3` fatal-failure test and the #2561 retry tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/compose-subject.js tests/bin-lib/compose-subject.test.js docs/plugin-structure.md
git commit -m "Add --scope to compose-subject.js and pipe gh stderr — no echo from the handled issueType rejection" -m "Refs #3028" -m "Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG"
```

### Task 3: `human-approved` tag — register, name at close-out, exclude from the metric

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 3's `{tag}` paragraph, ~lines 283-290)
- Modify: `plugin/skills/dispatch/close-out.md` (step 5, ~lines 66-71)
- Modify: `plugin/skills/_shared/github-pr-scan.md` (`triage-queue` item 3 prose, ~lines 366-377 — NOT the `jq` filter)
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md:25` (its per-site tag list)
- Test: `tests/pr-first-merge.test.js` (append at end)

**Interfaces:**
- Consumes: Task 2's `--scope` flag (named in the Step 3 instruction).
- Produces: the tag string `human-approved` (rendered `[human-approved]` in the commit body by the existing `tag` paragraph logic).

- [ ] **Step 1: Write the failing test** — append to `tests/pr-first-merge.test.js`:

```js
test('#3028: human-approved is registered in Step 3, named at close-out step 5, and excluded from the auto-merge metric', () => {
  const step3 = MERGE.split('## Step 3: Attempt auto-merge')[1];
  assert.ok(step3, 'Step 3 must exist');
  assert.match(step3, /`human-approved`/, 'Step 3 registers the human-approved tag');
  assert.match(step3, /--scope \{scope\}/, 'Step 3 tells callers to append --scope when the convention requires it');
  const closeOut = read('plugin', 'skills', 'dispatch', 'close-out.md');
  const step5 = closeOut.split('5. **On confirmation — merge.**')[1].split('\n6. ')[0];
  assert.match(step5, /`\{tag\}` = `human-approved`/, 'close-out step 5 names its tag');
  const scan = read('plugin', 'skills', '_shared', 'github-pr-scan.md');
  const item3 = scan.split('3. **Auto-merged this week**')[1].split('```bash')[0];
  assert.match(item3, /`\[human-approved\]`[\s\S]*excluded/, 'triage-queue item 3 documents the exclusion');
  const jq = scan.split('3. **Auto-merged this week**')[1].split('```bash')[1].split('```')[0];
  assert.doesNotMatch(jq, /human-approved/, 'the metric jq filter is unchanged — human-approved is not counted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pr-first-merge.test.js`
Expected: FAIL — `Step 3 registers the human-approved tag`.

- [ ] **Step 3: Write minimal implementation**

`plugin/skills/_shared/pr-first-merge.md` — in Step 3's paragraph, replace:

```
(#2015; rest release via their own `never-started:`/`abandoned:` reason). The composer writes
```

with:

```
(#2015; rest release via their own `never-started:`/`abandoned:` reason). `human-approved`:
`dispatch/close-out.md`'s human-confirmed merge (that metric excludes it). Append `--scope
{scope}` when the project's commit convention requires `type(scope):`. The composer writes
```

`plugin/skills/dispatch/close-out.md` step 5 — replace:

```
   on any other failure) rather than reimplementing it. Report the outcome (`armed`/`merged`) using
   that same vocabulary.
```

with:

```
   on any other failure) rather than reimplementing it, with `{tag}` = `human-approved` (that
   step's tag paragraph). Report the outcome (`armed`/`merged`) using that same vocabulary.
```

`plugin/skills/_shared/github-pr-scan.md` `triage-queue` item 3 — after the line ending `` `confirm`/`hybrid` override, the same interactive precondition as `[fast-lane]`. `` insert:

```
   `[human-approved]` (close-out's confirmed merge) is excluded — a human decided it.
```

Keep this to the one line above: `github-pr-scan.md` is 45,927 B at base, 153 B under its 46,080 B ceiling, and its composed `pr-scan` step (`tidy/scan-procedures.md:256`) has only 135 B of headroom.

`docs/journeys/merge-a-record-with-a-conventional-subject-2251.md:25` — change `` `fast-lane`, or `manifesto-authorized` per site `` to `` `fast-lane`, `manifesto-authorized`, or `human-approved` per site ``.

- [ ] **Step 4: Run tests and measure the ceiling**

Run: `node --test tests/bin-lib/compose-subject.test.js tests/bin-lib/release/subject.test.js tests/pr-first-merge.test.js tests/merge-subject-composer-conformance.test.js tests/bundle-fixes-reconciliation-2015.test.js`
Expected: PASS.

Run: `wc -c plugin/skills/_shared/pr-first-merge.md`
Expected: a byte count ≤ 31304 (about 30941).

Run: `wc -c plugin/skills/_shared/github-pr-scan.md`
Expected: a byte count ≤ 46010 (base 45927 + the ~84-byte line; keeps the composed `pr-scan` step under 46080).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/dispatch/close-out.md plugin/skills/_shared/github-pr-scan.md docs/journeys/merge-a-record-with-a-conventional-subject-2251.md tests/pr-first-merge.test.js
git commit -m "Register the human-approved tag for close-out merges — excluded from the auto-merged-this-week metric" -m "Refs #3028" -m "Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG"
```
