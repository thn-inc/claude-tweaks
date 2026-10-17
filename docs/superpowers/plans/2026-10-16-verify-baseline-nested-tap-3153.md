# verify.js --baseline: nested-TAP phantom failing files (#3153) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The baseline adjudicator's failing-file extraction never reports a path from a TAP document a test spawned, and no path absent from the checkout ever reaches an `attributable` entry.

**Architecture:** `extract.js`'s `tapBlocks` additionally records each `not ok` block's `frames` — every body line outside its YAML block, and inside it only the block's own top-level `location:`/`stack:` keys — and every TAP path read (`tapBlockFiles`, the `failingTestsByFile` location lookup) uses `frames`, never the whole body (an `error: |-` value can quote a child's whole TAP document). The four path-collecting exports take an optional `exists(rel)` predicate. `baseline.js` gains a `git.inCheckout(dir, rel)` seam and reads every log through `at(dir) = { cwd: dir, exists: rel => git.inCheckout(dir, rel) }`.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172700-spec-3153-3156/spec-3153/work/3153-spec.md` (record #3153)

## Global Constraints

- Fail closed: a failure whose only named paths are absent from the checkout must be *unclassified* (adjudication not eligible, a named reason), never silently dropped to `pass` and never `attributable`.
- Callers that pass no `exists` predicate (`run.js`'s flaky retry, `flaky.js`) keep today's behavior exactly — `exists` is opt-in.
- Real nested subtests (an indented `not ok` with its *own* YAML block) must still be read — the gotcha in the spec: "a naive ignore-indented-lines rule would also drop legitimate nested subtest failures".
- Commit style: `{Verb} {what} — {detail}`, body `refs #3153`, trailer `Claude-Session: https://claude.ai/code/session_01Unyb1LbHkiQXsa1Mqtz769`.

## Review Focus

1. A `not ok` block with no `---` YAML block at all (bare `  at path:L:C` / `  location: '…'` lines) — still read as before (non-YAML body lines are frames). Pinned by the existing `C1: a TAP not ok block whose frames name no test file…` and the new `exists` test.
2. A nested subtest's own indented YAML block — its `location:` is still read. Pinned by Task 1's `NESTED_TAP` regression test.
3. A single-line `stack: at Object.<anonymous>` value (no `|-`) — the key line itself is a frame line. Covered by the existing `TAP_FIXTURE` tests (unchanged results).
4. A Windows drive path (`C:/…`) or `..`-climbing path handed to `inCheckout` — never inside. Pinned by Task 2's `realGit().inCheckout` test.
5. A spec-reporter log naming a since-deleted test file — dropped under `exists`, and alone it makes the failure unmatched. Pinned by Task 1's `exists` test (spec half).

## Real-input probe (done at plan time)

A real node 22 run of a meta-test that spawns `node --test` on a failing fixture and asserts with the child's stdout as its message (`scratchpad/probe repo/tests/meta.test.js`) produced exactly the #3153 shape: the child's `not ok 1 - env` / `location: '/private/var/folders/…/verify-cli-test-…/tests/env.test.js:1:40'` sit inside the outer point's `error: |-` value at indent 4. Current `extractFailingFiles` returns `['tests/meta.test.js', '/private/var/folders/…/tests/env.test.js']`; the prototype below returns `['tests/meta.test.js']`. Task 1's `NESTED_CHILD_TAP` fixture is that recorded log with paths shortened. The full new code below was run against the full existing `extract.test.js` + `baseline.test.js` (146/146 pass) and the 5 new #3153 tests fail against the unchanged modules.

---

### Task 1: extract.js — read a TAP block's own frames only; optional `exists` predicate

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js` (`isRetryableFile` ~213, `failingTestsByFile` ~268-295, `fileLevelFailures` ~418-424, `tapBlocks` ~430-461, `tapBlockFiles` ~468-478, `countUnmatchedFailures` ~485-491, `extractFailingFiles` ~523-543)
- Test: `tests/bin-lib/verify/extract.test.js` (append at end of file)

**Interfaces:**
- Produces: `extractFailingFiles(text, family, { cwd, exists })`, `countUnmatchedFailures(text, family, { cwd, exists })`, `failingTestsByFile(text, family, { cwd, located, conclusiveOnly, exists })`, `fileLevelFailures(text, family, { cwd, exists })` — `exists` is an optional `(rel: string) => boolean` over the relativized forward-slash path; omitted means no filtering.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/verify/extract.test.js`:

```js

// #3153: a meta-test that spawns its own `node --test` run and fails with the
// child's stdout as its assertion message. node quotes that whole child TAP
// document inside the outer point's `error: |-` YAML value — its `not ok`,
// `location:` and stack lines name the child's temp-dir fixture, never a
// file of this run. Shape recorded from a real node 22 run.
const NESTED_CHILD_TAP = [
  'TAP version 13',
  '# Subtest: meta: a spawned fixture run must pass',
  'not ok 1 - meta: a spawned fixture run must pass',
  '  ---',
  '  duration_ms: 149.780209',
  "  type: 'test'",
  "  location: '/repo/tests/meta.test.js:9:1'",
  "  failureType: 'testCodeFailure'",
  '  error: |-',
  '    TAP version 13',
  '    # Subtest: env',
  '    not ok 1 - env',
  '      ---',
  '      duration_ms: 0.391208',
  "      type: 'test'",
  "      location: '/private/var/folders/3_/x/T/verify-cli-test-vUXbeY/tests/env.test.js:1:40'",
  "      failureType: 'testCodeFailure'",
  "      error: 'nope'",
  "      code: 'ERR_TEST_FAILURE'",
  '      stack: |-',
  '        TestContext.<anonymous> (/private/var/folders/3_/x/T/verify-cli-test-vUXbeY/tests/env.test.js:1:66)',
  '        Test.runInAsyncScope (node:async_hooks:214:14)',
  '      ...',
  '    1..1',
  '    # tests 1',
  '    # pass 0',
  '    # fail 1',
  '    ',
  '    1 !== 0',
  '    ',
  "  code: 'ERR_ASSERTION'",
  "  name: 'AssertionError'",
  '  expected: 0',
  '  actual: 1',
  "  operator: 'strictEqual'",
  '  stack: |-',
  '    TestContext.<anonymous> (/repo/tests/meta.test.js:17:10)',
  '    Test.runInAsyncScope (node:async_hooks:214:14)',
  '  ...',
  '1..1',
  '# tests 1',
  '# suites 0',
  '# pass 0',
  '# fail 1',
  '# cancelled 0',
].join('\n');

test('#3153: a child TAP document quoted inside a failing point\'s error text names no failing file — only the point\'s own location/stack do', () => {
  assert.deepStrictEqual(extractFailingFiles(NESTED_CHILD_TAP, 'tap', { cwd: '/repo' }), ['tests/meta.test.js']);
  assert.deepStrictEqual([...failingTestsByFile(NESTED_CHILD_TAP, 'tap', { cwd: '/repo', located: true })],
    [['tests/meta.test.js', ['meta: a spawned fixture run must pass@9:1']]]);
  assert.strictEqual(countUnmatchedFailures(NESTED_CHILD_TAP, 'tap', { cwd: '/repo' }), 0);
  assert.strictEqual(unattributedFailureCount(NESTED_CHILD_TAP, 'tap', { cwd: '/repo' }), 0);
});

test('#3153: a nested subtest\'s own YAML location is still read — only quoted message text is skipped', () => {
  assert.deepStrictEqual(extractFailingFiles(NESTED_TAP, 'tap', { cwd: '/repo' }), ['tests/nested.test.js']);
  assert.deepStrictEqual([...failingTestsByFile(NESTED_TAP, 'tap', { cwd: '/repo', located: true })],
    [['tests/nested.test.js', ['inner@2:25', 'grp@2:1']]]);
});

test('#3153: an `exists` predicate drops a path absent from the checkout; a failure naming only such a path is unmatched, never a file', () => {
  const tap = ['not ok 1 - real', "  location: '/repo/tests/a.test.js:1:1'", '  at /tmp/elsewhere/tests/ghost.test.js:2:1',
    'not ok 2 - phantom only', '  at tests/ghost.test.js:3:1', '# tests 2', '# pass 0', '# fail 2'].join('\n');
  const exists = (rel) => rel === 'tests/a.test.js';
  assert.deepStrictEqual(extractFailingFiles(tap, 'tap', { cwd: '/repo', exists }), ['tests/a.test.js']);
  assert.strictEqual(countUnmatchedFailures(tap, 'tap', { cwd: '/repo', exists }), 1);
  assert.deepStrictEqual([...failingTestsByFile(tap, 'tap', { cwd: '/repo', exists }).keys()], ['tests/a.test.js']);
  const spec = ['ℹ tests 2', 'ℹ pass 0', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at /repo/tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at /repo/tests/gone.test.js:1:1', '✖ y (1ms)'].join('\n');
  assert.deepStrictEqual(extractFailingFiles(spec, 'spec', { cwd: '/repo', exists }), ['tests/a.test.js']);
  assert.strictEqual(countUnmatchedFailures(spec, 'spec', { cwd: '/repo', exists }), 1);
  // No predicate: the pre-#3153 behavior, unchanged.
  assert.deepStrictEqual(extractFailingFiles(tap, 'tap', { cwd: '/repo' }), ['tests/a.test.js', '/tmp/elsewhere/tests/ghost.test.js', 'tests/ghost.test.js']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/extract.test.js`
Expected: FAIL — exactly 2 failing: `#3153: a child TAP document quoted…` (extracts the `/private/var/folders/…/env.test.js` path too) and `#3153: an exists predicate drops…` (predicate ignored). The `nested subtest's own YAML location` test passes before and after (regression guard).

- [ ] **Step 3: Implement** — in `plugin/bin/lib/verify/extract.js`:

Replace `isRetryableFile`:

```js
// A path extractFailingFiles would keep: a test file, never a node: internal
// — and, when the caller passes an `exists` predicate, one present in the
// checkout under test (#3153: a path absent there was never a real failing
// file of this run).
function isRetryableFile(rel, exists) {
  return TEST_FILE_RE.test(rel) && !rel.startsWith('node:') && (!exists || exists(rel));
}
```

In `failingTestsByFile`: signature becomes `function failingTestsByFile(text, family, { cwd = process.cwd(), located = false, conclusiveOnly = false, exists } = {}) {`; the spec branch's `if (!isRetryableFile(rel)) continue;` becomes `if (!isRetryableFile(rel, exists)) continue;`; the tap branch's two lines become:

```js
      const locLine = block.frames.map((l) => l.match(TAP_LOCATION_RE)).find(Boolean);
      tapBlockFiles(block, cwd, exists).forEach((rel) => add(rel, name, locLine ? locLine[1] : null, block.body));
```

`fileLevelFailures` becomes:

```js
function fileLevelFailures(text, family, { cwd = process.cwd(), exists } = {}) {
  const fileLevel = new Set();
  failingTestsByFile(text, family, { cwd, exists }).forEach((names, rel) => {
```

Replace the `tapBlocks` comment + function with:

```js
// The YAML keys whose values are the failing point's own site: its
// `location:` and its `stack:`. Every other key (`error:`, `expected:`,
// `actual:`) is message text, which can quote a whole TAP document a test
// spawned (#3153) — its paths are that child's, never this point's.
const TAP_FRAME_KEYS = new Set(['location', 'stack']);

// Every TAP `not ok` block, at any indentation (a failing subtest nests under
// its suite), in log order: {line: the `not ok` line, body: the lines after
// it up to the next test point or `# ` line at any indentation, frames: the
// body lines that can name this point's own file — every line outside its
// YAML block, and inside it only the `location:`/`stack:` keys}.
function tapBlocks(lines) {
  const blocks = [];
  let current = null;
  let pointPad = null;
  let yamlPad = null;
  let yamlKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // A point's YAML block (`---` … `...`, two spaces deeper) is its body,
    // never a new point — an assertion's expected/actual text can hold
    // `not ok …` lines. A line at exactly the block's indent starts a key;
    // deeper lines continue the current key's value.
    if (yamlPad !== null) {
      if (current) current.body.push(raw);
      if (line === `${yamlPad}...`) { yamlPad = null; continue; }
      if (line.startsWith(yamlPad) && line.length > yamlPad.length && line[yamlPad.length] !== ' ') {
        const key = line.slice(yamlPad.length).match(/^([A-Za-z_]+):/);
        yamlKey = key ? key[1] : null;
      }
      if (current && TAP_FRAME_KEYS.has(yamlKey)) current.frames.push(raw);
      continue;
    }
    if (pointPad !== null && line === `${pointPad}  ---`) {
      yamlPad = `${pointPad}  `;
      yamlKey = null;
      if (current) current.body.push(raw);
      continue;
    }
    const notOk = line.match(/^(\s*)not ok\b/);
    if (notOk) { current = { line: raw, body: [], frames: [] }; blocks.push(current); pointPad = notOk[1]; continue; }
    const ok = line.match(/^(\s*)ok \d/);
    if (ok) { current = null; pointPad = ok[1]; continue; }
    if (/^\s*# /.test(line)) { current = null; pointPad = null; continue; }
    if (current) { current.body.push(raw); current.frames.push(raw); }
  }
  return blocks;
}
```

Replace `tapBlockFiles`:

```js
// The relativized test files one TAP block's own frames name, deduped.
function tapBlockFiles(block, cwd, exists) {
  const files = [];
  for (const line of block.frames) {
    for (const m of line.matchAll(TAP_FRAME_RE)) {
      const rel = relativize(m[1] ?? m[2] ?? m[3], cwd);
      if (isRetryableFile(rel, exists) && !files.includes(rel)) files.push(rel);
    }
  }
  return files;
}
```

Replace `countUnmatchedFailures`:

```js
function countUnmatchedFailures(text, family, { cwd = process.cwd(), exists } = {}) {
  const lines = stripAnsi(text).split('\n');
  if (family === 'tap') return tapBlocks(lines).filter((b) => tapBlockFiles(b, cwd, exists).length === 0).length;
  if (family !== 'spec') return 0;
  return specEntries(lines)
    .filter(({ file }) => !isRetryableFile(relativize(file, cwd), exists)).length;
}
```

In `extractFailingFiles`: signature `function extractFailingFiles(text, family, { cwd = process.cwd(), exists } = {}) {`; inside `push`, `if (isRetryableFile(rel, exists) && !found.includes(rel)) found.push(rel);`; the tap branch `tapBlocks(lines).forEach((b) => tapBlockFiles(b, cwd, exists).forEach(push));`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/run.test.js`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/extract.js tests/bin-lib/verify/extract.test.js
git commit -m "Read a TAP failure's own location/stack only — a quoted child TAP document no longer names failing files" -m "refs #3153" -m "Claude-Session: https://claude.ai/code/session_01Unyb1LbHkiQXsa1Mqtz769"
```

---

### Task 2: baseline.js — read every log against the checkout it ran in (`inCheckout`)

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js` (`realGit` ~52-58, `accountedFamily` ~157-166, `adjudicate` ~205-375)
- Test: `tests/bin-lib/verify/baseline.test.js` (`fakes` at lines 30-39; append at end of file)

**Interfaces:**
- Consumes: Task 1's `exists` option on `extractFailingFiles` / `countUnmatchedFailures` / `failingTestsByFile` / `fileLevelFailures`.
- Produces: `realGit(cwd).inCheckout(dir: string, rel: string) => boolean`; `accountedFamily(text, scope)` where `scope = { cwd, exists }`.

- [ ] **Step 1: Write the failing tests**

In `fakes` (line 30), add the parameter and the seam:

```js
function fakes({ outcomes, existsAtBase = () => true, sameAtBase = () => true, inCheckout = () => true, throwOn = null, logs = {}, repoRoot = '/repo' }) {
  const calls = { runs: [], added: [], removed: [] };
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-fake-runs-'));
  const git = {
    repoRoot: () => repoRoot,
    fileExistsAt: (sha, f) => existsAtBase(f),
    sameAtBase: (sha, f) => sameAtBase(f),
    inCheckout: (dir, rel) => inCheckout(rel, dir),
```

Append at end of file:

```js

// #3153: the full-run failure of a meta-test that quotes its spawned child's
// TAP (temp-dir paths and all) in its assertion message.
const META_TAP = (root) => ['TAP version 13', 'not ok 1 - meta', '  ---', `  location: '${root}/tests/meta.test.js:9:1'`, '  error: |-',
  '    not ok 1 - env', '      ---', "      location: '/private/var/folders/x/T/verify-cli-test-abc/tests/env.test.js:1:40'", '      ...',
  '  stack: |-', `    TestContext.<anonymous> (${root}/tests/meta.test.js:17:10)`, '  ...', '1..1', '# tests 1', '# pass 0', '# fail 1', '# cancelled 0'].join('\n');

test('#3153 AC1: a meta-test quoting its child\'s temp-dir TAP adjudicates on its own file only — baseline, never a phantom attributable', async () => {
  const { p, dir } = logFile(META_TAP('/repo'));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/meta.test.js': 1, 'isolated:tests/meta.test.js': 1 },
    logs: { 'baseline:tests/meta.test.js': META_TAP('/scratch'), 'isolated:tests/meta.test.js': META_TAP('/repo') },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.failingFiles, ['tests/meta.test.js']);
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(r.baselineFailing, ['tests/meta.test.js']);
  assert.strictEqual(r.verdict, 'pass');
});

test('#3153 AC3: a failing-file path absent from the checkout never reaches attributable — dropped beside a real file, unclassified alone', async () => {
  const present = (rel) => rel === 'tests/a.test.js';
  const beside = ['not ok 1 - a', "  location: '/repo/tests/a.test.js:1:1'", '  at /tmp/sandbox/tests/env.test.js:2:1',
    '# tests 1', '# pass 0', '# fail 1', '# cancelled 0'].join('\n');
  const { p, dir } = logFile(beside);
  const one = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 0 }, inCheckout: present });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne: one.runOne, git: one.git });
  assert.deepStrictEqual(r.failingFiles, ['tests/a.test.js']);
  assert.ok(!r.attributable.some((f) => f !== 'tests/a.test.js'), JSON.stringify(r.attributable));

  const alone = ['not ok 1 - env', '  at tests/env.test.js:2:1', '# tests 1', '# pass 0', '# fail 1', '# cancelled 0'].join('\n');
  const { p: p2, dir: dir2 } = logFile(alone);
  const two = fakes({ outcomes: {}, inCheckout: present });
  const r2 = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p2 }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir2, runOne: two.runOne, git: two.git });
  assert.strictEqual(r2.eligible, false);
  assert.match(r2.reason, /^no-parse: no failing test file extractable from tests$/);
  assert.deepStrictEqual(two.calls.runs, []);
});

test('#3153: realGit().inCheckout is true only for a relative path present under the given directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-incheckout-'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests', 'a.test.js'), '');
  const g = realGit(root);
  assert.strictEqual(g.inCheckout(root, 'tests/a.test.js'), true);
  assert.strictEqual(g.inCheckout(root, 'tests/gone.test.js'), false);
  assert.strictEqual(g.inCheckout(root, `${root.replace(/\\/g, '/')}/tests/a.test.js`), false, 'an absolute path is never inside');
  assert.strictEqual(g.inCheckout(path.join(root, 'tests'), '../tests/a.test.js'), false, 'a path climbing out is never inside');
  assert.strictEqual(g.inCheckout(root, 'C:/repo/tests/a.test.js'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "const { realGit } = require('./plugin/bin/lib/verify/baseline.js'); process.exit(typeof realGit('.').inCheckout === 'function' ? 0 : 1)"`
Expected: FAIL (exit 1 — the seam does not exist yet).

Then run `node --test tests/bin-lib/verify/baseline.test.js` (after Step 1's append) — exactly 2 failing: `#3153 AC3: …` (no `inCheckout` consulted, `/tmp/sandbox/tests/env.test.js` and `tests/env.test.js` survive) and `#3153: realGit().inCheckout …` (`g.inCheckout is not a function`). `#3153 AC1` already passes after Task 1 (its fix is Task 1's frames scoping; it stays as the adjudicator-level regression pin).

- [ ] **Step 3: Implement** — in `plugin/bin/lib/verify/baseline.js`:

In `realGit`'s returned object, between `sameAtBase` and `addWorktree`, add:

```js
    // Whether `rel` (a relativized, forward-slash path from a log) names a
    // file inside the checkout at `dir` (#3153). A path that relativize()
    // left absolute, or one climbing out with `..`, is never inside it.
    inCheckout: (dir, rel) => !path.posix.isAbsolute(rel) && !/^[A-Za-z]:/.test(rel)
      && rel.split('/')[0] !== '..' && fs.existsSync(path.join(dir, ...rel.split('/'))),
```

`accountedFamily` takes the scope instead of a bare cwd:

```js
function accountedFamily(text, scope) {
  const family = sniffFamily(text);
  if (family !== 'spec' && family !== 'tap') return null;
  if (RUNNER_ERROR_RE.test(text)) return null;
  const counts = parseCounts(text, family);
  if (counts === null || cancelledCount(text, family) !== 0) return null;
  if (countUnmatchedFailures(text, family, scope) > 0) return null;
  if (family === 'spec' && specEntryCount(text) !== counts.fail) return null;
  return family;
}
```

In `adjudicate`, directly after `const headDir = tryRealpath(cwd || process.cwd());` add:

```js
  // Every log is read against the checkout it ran in, and only a path present
  // there names a failing file (#3153).
  const at = (dir) => ({ cwd: dir, exists: (rel) => git.inCheckout(dir, rel) });
```

Then replace every extraction option object in `adjudicate` (14 sites — confirm with `grep -n "cwd: headDir\|cwd: baseDir\|accountedFamily(text," plugin/bin/lib/verify/baseline.js` returning only the `at` definition afterwards):
- `{ cwd: headDir }` → `at(headDir)`; `{ cwd: headDir, located: true }` → `{ ...at(headDir), located: true }`
- `{ cwd: baseDir }` → `at(baseDir)`; `{ cwd: baseDir, located: true }` → `{ ...at(baseDir), located: true }`; `{ cwd: baseDir, conclusiveOnly: true }` → `{ ...at(baseDir), conclusiveOnly: true }`
- `accountedFamily(text, headDir)` → `accountedFamily(text, at(headDir))`; `accountedFamily(text, baseDir)` → `accountedFamily(text, at(baseDir))`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/*.test.js`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js
git commit -m "Read every baseline log against its own checkout — a path absent there never reaches attributable" -m "refs #3153" -m "Claude-Session: https://claude.ai/code/session_01Unyb1LbHkiQXsa1Mqtz769"
```

---

### Task 3: Confirm the two meta-test files are deterministic (no code unless they flake)

The spec's second deliverable (fix or allowlist the nondeterminism in `engine-verify.test.js`'s `AC1 (live git)` and `cli.test.js`'s `--baseline` scenarios) was addressed upstream after the record was filed: #3168 (closed) fixed the AC1 mtime ordering (`busyWaitMs(10)` + run dir created first, `tests/bin-lib/wrap-up/engine-verify.test.js:772-777`), and #3155 (PR #3172) / #3167 fixed the space-in-path and symlinked-tmpdir mis-relativization that made `cli.test.js`'s `--baseline` scenarios fail on this checkout. The batch pre-flight sweep (base `c223eca06`, full `npm test` under heavy load) passed both files.

**Files:**
- Modify (only if Step 1 shows a failure): `.claude-tweaks/verify-scope.json` (`flaky.files`)

- [ ] **Step 1: Run each file three times in isolation (verification only — no Expected: FAIL step in this task)**

Run (three separate invocations, each its own command): `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: `# fail 0` all three times. Quote each run's `# tests`/`# pass`/`# fail` lines in the task report.

- [ ] **Step 2: Only if a run failed** — add the failing file to `.claude-tweaks/verify-scope.json`'s `flaky.files` with the failing sub-test name and its race as the reason, and commit `Allowlist {file} as flaky — {race}` (`refs #3153`). If all three runs were clean, make no change and report "deterministic — no allowlist entry".
