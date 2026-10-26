# Impact-Map Drift Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select every test file that differs between the impact map's commit and HEAD as untraced, so a test whose reads changed after the map was traced is never deselected.

**Architecture:** `loadImpactContext` (already lazy, already holds the map commit) gains one more git read — the test files whose content differs between the map's commit and HEAD — exposed as `driftTests` on the context. `selectImpactTests` takes that list and selects each drifted test that the map knows and that is present at HEAD, the same way it already selects tests the map does not know. `scope.js` carries the list and its count into `scope.impact`, which `verify.js` already spreads into `report.json`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI through the existing injectable `execImpl`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T063441-record-4132/work/4132-spec.md`

## Global Constraints

- The fallback reasons for a missing, stale or non-ancestor map stay byte-identical: `map-missing`, `map-stale: {n} commits > {max}`, `map-not-ancestor`.
- A run with the map at the base selects exactly what it selects today.
- Selection fails closed: a drift read git cannot answer never selects fewer tests — it runs the suite full with a named fallback (`map-drift-unreadable`), added to the doc's fallback table in the same change.
- The drift read happens inside `loadImpactContext`, so it stays behind `lazyImpactContext` (a delta no impact rule matches never pays for it).
- Every git call goes through `execImpl` with `--end-of-options` before revisions, matching the file's existing calls.

## Review Focus

- The map's commit is NOT an ancestor of the base (a map traced on main after the branch's merge-base, which the branch later merged): the drift set is a tree diff `map-commit` vs `HEAD`, so it is defined whenever `map-not-ancestor` did not already fire. Pinned by Task 1's `listDriftTests` arg test (two-revision tree diff, not a `..` range).
- A drifted test that was deleted by HEAD: must not be selected (cannot run). Pinned in Task 1's selection test.
- A drifted test the map does not know: already in `untracedTests`; must not be double-reported in `driftTests`. Pinned in Task 1's selection test.
- The map fetch reloads the map (a new commit): drift must be computed against the final map's commit, after the reload. Pinned in Task 1's fetch test assertion.
- A renamed test file: `--no-renames` reports the new path as differing, so a renamed-and-edited test whose new path the map knows is selected. Covered by the arg assertion (`--no-renames`) in Task 1.

---

### Task 1: Drift set in the impact context and selection

**Files:**
- Modify: `plugin/bin/lib/verify/impact.js`
- Test: `tests/bin-lib/verify/impact.test.js`

**Interfaces:**
- Produces: `selectImpactTests({ map, changed, headTests, isTestFile, driftTests = [] })` → on success `{ ok: true, tests, matched, changedTests, untracedTests, driftTests }`, where `driftTests` is the sorted subset of the input `driftTests` that is present in `headTests` AND is a key of `map.tests`; `tests` is the sorted unique union of `matched`, `changedTests`, `untracedTests` and `driftTests`. Failure shape `{ ok: false, reason }` unchanged.
- Produces: `loadImpactContext(...)` return gains `driftTests: string[]` (empty when the map has a problem). `lazyImpactContext` gains a `driftTests` getter.
- Produces: a new fallback reason `map-drift-unreadable`, set as the context's `problem` when the map is otherwise usable but the drift diff cannot be read.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/verify/impact.test.js`; also widen the existing shapes)

First widen every existing `deepStrictEqual` against a successful `selectImpactTests` result to include `driftTests: []` (lines asserting `{ ok: true, tests: ..., untracedTests: ... }` — 122, 167, 170, 182, 188, 192, 214, 230, 235-241). Add a default `'diff': () => ''` handler to `fakeGit`'s `handlers`.

New tests:

```js
test('drifted tests the map knows and HEAD still has are selected as untraced (#4132)', () => {
  const head = ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js'];
  const r = selectImpactTests({
    map: mapOf(XMAP), changed: [{ path: 'src/x.js', status: 'M' }], headTests: head, isTestFile,
    driftTests: ['tests/b.test.js', 'tests/new.test.js', 'tests/gone.test.js'],
  });
  // b: known + at HEAD → drift. new: unknown → untraced only. gone: absent at HEAD → never selected.
  assert.deepStrictEqual(r, {
    ok: true, tests: ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js'], matched: ['tests/a.test.js'],
    changedTests: [], untracedTests: ['tests/new.test.js'], driftTests: ['tests/b.test.js'],
  });
  // Go-red control: without the drift input b is not selected.
  assert.deepStrictEqual(
    selectImpactTests({ map: mapOf(XMAP), changed: [{ path: 'src/x.js', status: 'M' }], headTests: head, isTestFile }).tests,
    ['tests/a.test.js', 'tests/new.test.js'],
  );
});

test('loadImpactContext: driftTests are the test-glob files differing between the map commit and HEAD (#4132)', () => {
  const { execImpl, calls } = fakeGit({ diff: () => 'tests/b.test.js\0src/x.js\0tests/a.test.js\0' });
  const ctx = loadImpactContext({ decl: declOf(), repoRoot: ROOT, commonDir: COMMON, execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }) });
  assert.strictEqual(ctx.problem, null);
  assert.deepStrictEqual(ctx.driftTests, ['tests/a.test.js', 'tests/b.test.js']);
  const diff = calls.find((c) => c.args[0] === 'diff');
  assert.deepStrictEqual(diff.args, ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', SHA, 'HEAD']);
  assert.strictEqual(diff.opts.cwd, ROOT);
});

test('loadImpactContext: an unreadable drift diff fails closed as map-drift-unreadable; a map problem skips the diff (#4132)', () => {
  const failing = loadImpactContext({
    decl: declOf(), repoRoot: ROOT, commonDir: COMMON,
    execImpl: fakeGit({ diff: () => { throw new Error('bad object'); } }).execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }),
  });
  assert.strictEqual(failing.problem, 'map-drift-unreadable');
  assert.deepStrictEqual(failing.driftTests, []);
  const { execImpl, calls } = fakeGit();
  const missing = loadImpactContext({ decl: declOf(), repoRoot: ROOT, commonDir: COMMON, execImpl, fsImpl: fakeFs({}) });
  assert.strictEqual(missing.problem, 'map-missing');
  assert.deepStrictEqual(missing.driftTests, []);
  assert.strictEqual(calls.some((c) => c.args[0] === 'diff'), false);
});
```

Also: in the existing `'loadImpactContext: the fetch runs once on a problem and the map is reloaded'` test, assert the drift diff ran exactly once, after the reload (its `diff` call's commit arg is the reloaded map's commit). In the existing `lazyImpactContext` test, add `driftTests: []` to the loaded object and assert `ctx.driftTests` reads `[]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/impact.test.js`
Expected: FAIL — the new drift tests fail (`driftTests` undefined) and the widened shapes fail (no `driftTests` key).

- [ ] **Step 3: Implement in `plugin/bin/lib/verify/impact.js`**

- `selectImpactTests`: new param `driftTests = []`; `drift = sortedUnique(driftTests.filter((t) => atHead.has(t) && Object.hasOwn(map.tests, t)))`; add to the `tests` union and return it as `driftTests`.
- New private `listDriftTests({ decl, repoRoot, commit, execImpl })` → `string[] | null`: `git diff --name-only -z --no-renames --end-of-options {commit} HEAD` (a two-revision tree diff — defined whether or not the commit is an ancestor of the base), split on `\0`, kept when a `decl.impact.tests` glob matches (reuse the `globToRegExp` pattern `listHeadTests` uses), sorted unique; `null` when git throws.
- `loadImpactContext`: after the (possibly re-read) `state` and only when `state.problem` is null, call `listDriftTests` with `state.mapCommit`; `null` → `problem = 'map-drift-unreadable'`. Return `driftTests` (`[]` on any problem). Problem precedence: map problem, then drift problem, then head-test problem.
- `lazyImpactContext`: add `get driftTests()`.
- Update the file header comment's I/O-helpers paragraph to name the drift read.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/impact.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/impact.js tests/bin-lib/verify/impact.test.js
git commit -m "Select tests that drifted since the impact map's commit — refs #4132"
```

### Task 2: Carry drift into scope.impact, report.json and the contract doc

**Files:**
- Modify: `plugin/bin/lib/verify/scope.js`
- Modify: `plugin/bin/verify.js:625` (the `map-unlocatable` stub context)
- Modify: `plugin/skills/test/impact-selection.md`
- Test: `tests/bin-lib/verify/scope.test.js`, `tests/bin-lib/verify/impact-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `selectImpactTests({ ..., driftTests })` and `ctx.driftTests`.
- Produces: `scope.impact` (and so `report.json` `scope.impact`) gains `driftTests: string[]` (default `[]`) and `driftSelected: number | null` (the drift-selected count — `null` whenever no selection ran, exactly like `selected`).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/verify/scope.test.js`: add `driftTests: [], driftSelected: null` to `FULL_RUN`; widen the literal impact shapes at lines 150 and 231-234 with `driftTests: [], driftSelected: 0`. New test:

```js
test('drifted tests from the context join the subset and are counted (#4132)', () => {
  const r = isel(['src/x.js'], { 'src/x.js': 'M' }, { ...CTX, driftTests: ['tests/b.test.js'] });
  assert.deepStrictEqual(r.impact, {
    suite: 'tests', files: ['tests/a.test.js', 'tests/b.test.js'], fallback: null, selected: 2,
    changedTests: [], untracedTests: [], driftTests: ['tests/b.test.js'], driftSelected: 1, superseded: false,
  });
});
```

`tests/bin-lib/verify/impact-cli.test.js`:
- AC2.1 — in `'selects the subset (AC1.1 report shape)'` (map at the base) add `assert.deepStrictEqual(imp.driftTests, []); assert.strictEqual(imp.driftSelected, 0);` — the map-at-base selection is unchanged.
- New end-to-end test, map older than the base:

```js
test('a test edited after the map commit to read src/x.js is selected when src/x.js changes, map older than the base (#4132)', async () => {
  const r = impactRepo();
  writeMap(r); // map at the original base M: b reads only src/y.js
  r.git('checkout', '-q', 'main');
  commitFile(r, 'tests/b.test.js', 'b now reads src/x.js\n');
  r.git('checkout', '-q', '-B', 'feature', 'main'); // base B = main's new tip, M is older
  commitFile(r, 'src/x.js', 'x2\n');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(r.marker(), 'tests/a.test.js\ntests/b.test.js\n');
  const imp = r.report().scope.impact;
  assert.deepStrictEqual(imp.files, ['tests/a.test.js', 'tests/b.test.js']);
  assert.deepStrictEqual(imp.driftTests, ['tests/b.test.js']);
  assert.strictEqual(imp.driftSelected, 1);
  assert.strictEqual(imp.fallback, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/scope.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: FAIL — `driftTests`/`driftSelected` missing from `scope.impact`; the end-to-end marker is `tests/a.test.js\n` only.

- [ ] **Step 3: Implement**

- `scope.js` `impactResult`: defaults gain `driftTests: []` and `driftSelected: null`. `resolveImpact`: pass `driftTests: ctx.driftTests || []` to `selectImpactTests`; on success set `driftTests: r.driftTests, driftSelected: r.driftTests.length`. Update the header comment's impact paragraph with one clause on drift.
- `verify.js`: the `map-unlocatable` stub object gains `driftTests: []` (the `{ ...impactCtx, problem }` spread at line 638 then copies the getter's value like every other field).
- `plugin/skills/test/impact-selection.md`:
  - **Selection** paragraph: append the new rule — every test file the map knows, present at HEAD, whose content differs between the map's commit and HEAD (`git diff --no-renames {commit} HEAD`) is selected too, as untraced (its recorded reads may be stale). A tree diff, so it holds whether or not the map's commit is an ancestor of the base; only `map-not-ancestor` (the commit is not an ancestor of HEAD) stops it. With the map at the base, the drifted tests are the branch's own committed test edits, which are already changed tests, so the selection is unchanged.
  - **Fallback table:** add a `map-drift-unreadable` row — git could not list the test files that differ between the map's commit and HEAD.
  - **Report:** add `driftTests` and `driftSelected` to the `scope.impact` field list, with one sentence: `driftTests` names the drift-selected tests and `driftSelected` their count (`null` when no selection ran).
  - **Known limits:** delete the `Map-to-base drift` bullet (the AC: replaced by the new rule above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/scope.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/impact.test.js`
Expected: PASS

AC3.1 verification — Run: `grep -c "Map-to-base drift" plugin/skills/test/impact-selection.md`
Expected: `0` (the known-limit bullet is gone), and `grep -c "map-drift-unreadable" plugin/skills/test/impact-selection.md` prints a non-zero count (the new rule's fallback row landed).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/scope.js plugin/bin/verify.js plugin/skills/test/impact-selection.md tests/bin-lib/verify/scope.test.js tests/bin-lib/verify/impact-cli.test.js
git commit -m "Report drift-selected tests in scope.impact and document the rule — refs #4132"
```
