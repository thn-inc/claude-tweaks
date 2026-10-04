# Multi-spec parent run-state helper (record 2858) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One exported helper, `readRunStateWithParent`, owns the multi-spec "per-spec run dir falls back to its parent for the shared worktree/PR stamps" rule; the three code readers that each carried a copy call it.

**Architecture:** The helper lives beside `readRunState` in `plugin/bin/lib/hooks/context.js`. It reads the per-spec `run-state.json`, and when the run dir's basename matches `/^spec-/` it fills `worktree`, `pr`, `prExempt` field by field from the parent directory's `run-state.json`. It never throws. `pack.js` `resolveState`, `engine-verify.js` `resolvePrNumber`, and `precondition.js` `checkPrBookkeepingPrecondition` become thin callers.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T155140-record-2858/work/2858-spec.md`

## Global Constraints

- Acceptance grep must return no hits outside the helper: `grep -rn "path.dirname(runDir), 'run-state.json'" plugin/bin`.
- A per-spec dir with a status-only `run-state.json` resolves the parent PR in all three consumers, one committed test each.
- Every existing test in `tests/hooks-context.test.js`, `tests/bin-lib/wrap-up/pack.test.js`, `tests/bin-lib/wrap-up/engine-verify.test.js`, `tests/bin-lib/pr-bookkeeping/precondition.test.js` stays green and unedited.
- The helper must not throw on a missing, unreadable, malformed, or non-object per-spec or parent file, nor on a non-string `runDir` (hook contract `docs/hooks.md`: never break a session).
- Commit style: `{Verb} {what} — {detail}`; reference the record as `refs #2858`, never `closes`/`fixes`.
- Never run `git stash`. Run every command in the foreground. Use `node --test path/to/file.test.js` (file form, never a bare directory).
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Design decisions (settled at plan time — do not re-derive)

Readers of a parent `run-state.json` in `plugin/bin` (grep `run-state\.json|readRunState|path\.dirname\(` over `plugin/bin`, 2026-10-04): exactly three — `wrap-up/pack.js:227`, `wrap-up/engine-verify.js:508`, `pr-bookkeeping/precondition.js:54-60`. `hooks/pre-tool-use.js:1066` reads the parent directory *name* only (pathspec), never its state. The fourth reader the record names, `plugin/skills/flow/multispec-review-console.md:88`, is skill prose executed at the parent run dir; it has no code to migrate and stays as is.

The three copies disagreed. The helper's single rule:

| Aspect | Rule |
|---|---|
| Gate | basename of `runDir` matches `/^spec-/`. Option `requireRunIdParent: true` additionally requires the parent basename to match `RUN_ID_RE` (precondition.js keeps this stricter gate — its existing test pins it; pack/engine-verify existing tests use non-run-id tmp parents and pin the looser gate). |
| `worktree` | own value kept when it is a non-empty string; otherwise filled from the parent's non-empty string. |
| `pr` | own value kept when it is an object with an integer `number`; otherwise filled from a parent `pr` of that shape. |
| `prExempt` | own value kept when truthy; otherwise filled from a truthy parent value. |
| Precedence | a usable per-spec value always wins over the parent's. |
| Non-object JSON (array, string, number) | read as `null`. |
| Return | `{ state, parentRunDir, filled }` — `state` is `null` when neither file contributed anything; `parentRunDir` is the parent path whenever the gate passed (even if the parent file is unreadable — precondition.js reads the parent `decisions.md` through it), else `null`; `filled` lists the field names taken from the parent. |

Known behaviour changes (each asserted in Task 2's tests):
- `resolvePrNumber`: a per-spec file without a usable `pr` now finds the parent PR (the record's deliberate change); a directory whose basename is not `spec-*` no longer reads its parent at all (the gate it never had).
- `pack.js` `sources.state` reads `'parent'` only when `worktree` or `pr` actually came from the parent (before: whenever the parent file was readable and the own state incomplete).

## Review Focus

- A per-spec `run-state.json` holding malformed JSON while the parent is valid — expect the parent's stamps, no throw (Task 1 test).
- A per-spec `pr` that is present but `null` or `{}` — expect the parent's `pr` (Task 1 and Task 2 tests).
- A non-multi-spec run dir whose parent directory happens to contain a `run-state.json` — expect no borrowing (Task 1 and Task 2 tests).
- A parent carrying only `prExempt` — `resolvePrNumber` returns `null`; precondition passes as `pr-stamped-or-exempt` (Task 2 tests).
- An injected reader that throws — expect `state: null`, no throw (Task 1 test).

---

### Task 1: `readRunStateWithParent` helper in context.js

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js` (add after `RUN_ID_RE` at line 77; extend `module.exports` at line 651)
- Test: `tests/hooks-context.test.js` (append)

**Interfaces:**
- Consumes: existing `readRunState(runDir)` and `RUN_ID_RE` in the same file.
- Produces: `readRunStateWithParent(runDir, { read = readRunState, requireRunIdParent = false } = {})` returning `{ state: object|null, parentRunDir: string|null, filled: string[] }`. `read` is `(dir) => parsed run-state or null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hooks-context.test.js`:

```js
// #2858: the one multi-spec parent fallback (per-field fill of worktree/pr/prExempt).
function mkSpecChild(parentState, childState, parentName = '2026-07-01T090000-spec-7-8') {
  const project = tmpProject();
  const parent = mkRun(project, parentName, parentState);
  const child = path.join(parent, 'spec-7');
  fs.mkdirSync(child, { recursive: true });
  if (childState !== undefined) fs.writeFileSync(path.join(child, 'run-state.json'), typeof childState === 'string' ? childState : JSON.stringify(childState));
  return { parent, child };
}

test('readRunStateWithParent: a status-only per-spec state is filled per field from the parent', () => {
  const { parent, child } = mkSpecChild({ worktree: '/w/tree', pr: { number: 12, url: 'u' }, prExempt: 'initial-publish' }, { status: 'active' });
  const r = ctx.readRunStateWithParent(child);
  assert.deepStrictEqual(r.state, { status: 'active', worktree: '/w/tree', pr: { number: 12, url: 'u' }, prExempt: 'initial-publish' });
  assert.strictEqual(r.parentRunDir, parent);
  assert.deepStrictEqual(r.filled, ['worktree', 'pr', 'prExempt']);
});

test('readRunStateWithParent: a usable per-spec value wins over the parent (precedence)', () => {
  const { child } = mkSpecChild({ worktree: '/parent/tree', pr: { number: 12 }, prExempt: 'p' }, { worktree: '/own/tree', pr: { number: 99 }, prExempt: 'own' });
  const r = ctx.readRunStateWithParent(child);
  assert.deepStrictEqual(r.state, { worktree: '/own/tree', pr: { number: 99 }, prExempt: 'own' });
  assert.deepStrictEqual(r.filled, []);
});

test('readRunStateWithParent: a present-but-unusable per-spec value (pr null, pr {}, worktree "") is filled from the parent', () => {
  for (const own of [{ pr: null, worktree: '' }, { pr: {}, worktree: '' }]) {
    const { child } = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, own);
    const r = ctx.readRunStateWithParent(child);
    assert.strictEqual(r.state.worktree, '/w/tree');
    assert.deepStrictEqual(r.state.pr, { number: 12 });
    assert.deepStrictEqual(r.filled, ['worktree', 'pr']);
  }
});

test('readRunStateWithParent: a non-spec run dir never borrows from a parent directory that happens to hold a run-state.json', () => {
  const project = tmpProject();
  const parent = mkRun(project, '2026-07-01T090000-spec-1', { worktree: '/w/tree', pr: { number: 12 } });
  const child = path.join(parent, 'not-a-spec');
  fs.mkdirSync(child);
  assert.deepStrictEqual(ctx.readRunStateWithParent(child), { state: null, parentRunDir: null, filled: [] });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.deepStrictEqual(ctx.readRunStateWithParent(child), { state: { status: 'active' }, parentRunDir: null, filled: [] });
});

test('readRunStateWithParent: requireRunIdParent refuses a spec-* dir whose parent is not run-id-shaped, and still borrows under a run-id-shaped parent', () => {
  const loose = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, { status: 'active' }, 'not-a-run');
  assert.deepStrictEqual(ctx.readRunStateWithParent(loose.child, { requireRunIdParent: true }), { state: { status: 'active' }, parentRunDir: null, filled: [] });
  assert.deepStrictEqual(ctx.readRunStateWithParent(loose.child).filled, ['worktree', 'pr']);
  const strict = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, { status: 'active' });
  assert.deepStrictEqual(ctx.readRunStateWithParent(strict.child, { requireRunIdParent: true }).filled, ['worktree', 'pr']);
});

test('readRunStateWithParent: missing, malformed, and non-object files never throw', () => {
  const neither = mkSpecChild(undefined, undefined);
  assert.deepStrictEqual(ctx.readRunStateWithParent(neither.child), { state: null, parentRunDir: neither.parent, filled: [] });

  const badChild = mkSpecChild({ worktree: '/w/tree', pr: { number: 12 } }, '{not json');
  assert.deepStrictEqual(ctx.readRunStateWithParent(badChild.child).state, { worktree: '/w/tree', pr: { number: 12 } });

  const badParent = mkSpecChild(undefined, { status: 'active' });
  fs.writeFileSync(path.join(badParent.parent, 'run-state.json'), '{not json');
  assert.deepStrictEqual(ctx.readRunStateWithParent(badParent.child), { state: { status: 'active' }, parentRunDir: badParent.parent, filled: [] });

  const arrays = mkSpecChild(undefined, '[1,2]');
  fs.writeFileSync(path.join(arrays.parent, 'run-state.json'), '"a string"');
  assert.deepStrictEqual(ctx.readRunStateWithParent(arrays.child).state, null);

  for (const bad of [undefined, null, 42, '']) {
    assert.deepStrictEqual(ctx.readRunStateWithParent(bad), { state: null, parentRunDir: null, filled: [] });
  }
});

test('readRunStateWithParent: reads through the injected reader, and a throwing reader degrades to null', () => {
  const seen = [];
  const read = (dir) => { seen.push(dir); return path.basename(dir) === 'spec-7' ? { status: 'active' } : { pr: { number: 5 } }; };
  const r = ctx.readRunStateWithParent(path.join('/runs/2026-07-01T090000-spec-7-8', 'spec-7'), { read });
  assert.deepStrictEqual(r.state, { status: 'active', pr: { number: 5 } });
  assert.deepStrictEqual(seen, [path.join('/runs/2026-07-01T090000-spec-7-8', 'spec-7'), '/runs/2026-07-01T090000-spec-7-8']);
  const thrown = ctx.readRunStateWithParent('/runs/x/spec-7', { read: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(thrown, { state: null, parentRunDir: '/runs/x', filled: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node -e "const c=require('./plugin/bin/lib/hooks/context'); if (typeof c.readRunStateWithParent !== 'function') { console.error('readRunStateWithParent is not exported'); process.exit(1); }"`
Expected: FAIL with "readRunStateWithParent is not exported"

- [ ] **Step 3: Write the implementation**

In `plugin/bin/lib/hooks/context.js`, insert immediately after the `const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T/;` line:

```js

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function hasPrNumber(state) {
  return isPlainObject(state.pr) && Number.isInteger(state.pr.number);
}

// The one multi-spec parent fallback (#2858). A /flow multi-spec run hands
// each spec's skills a per-spec run dir ({parent-run-id}/spec-{N}/) that
// carries its own status, while the run's shared worktree/PR stamps live on
// the PARENT run dir (record-worktree / record-pr write there). Reads the
// per-spec run-state.json and, behind the /^spec-/ basename gate, fills a
// missing worktree / pr / prExempt field by field from the parent's — a
// usable per-spec value always wins. `requireRunIdParent` adds the stricter
// "parent basename is run-id-shaped" gate pre-tool-use.js's perSpecPathspec
// applies. `read` is injectable for callers that read through their own deps.
// Never throws: a missing, unreadable, malformed, or non-object file reads as
// null. Returns { state, parentRunDir, filled } — parentRunDir is set
// whenever the gate passed (even when the parent file is unreadable), and
// `filled` names the fields taken from the parent.
function readRunStateWithParent(runDir, { read = readRunState, requireRunIdParent = false } = {}) {
  if (typeof runDir !== 'string' || !runDir) return { state: null, parentRunDir: null, filled: [] };
  const safeRead = (dir) => {
    try {
      const v = read(dir);
      return isPlainObject(v) ? v : null;
    } catch { return null; }
  };
  const own = safeRead(runDir);
  if (!/^spec-/.test(path.basename(runDir))) return { state: own, parentRunDir: null, filled: [] };
  const parentRunDir = path.dirname(runDir);
  if (requireRunIdParent && !RUN_ID_RE.test(path.basename(parentRunDir))) return { state: own, parentRunDir: null, filled: [] };
  const parent = safeRead(parentRunDir);
  if (!parent) return { state: own, parentRunDir, filled: [] };
  const state = { ...(own || {}) };
  const filled = [];
  if (!(typeof state.worktree === 'string' && state.worktree) && typeof parent.worktree === 'string' && parent.worktree) {
    state.worktree = parent.worktree;
    filled.push('worktree');
  }
  if (!hasPrNumber(state) && hasPrNumber(parent)) {
    state.pr = parent.pr;
    filled.push('pr');
  }
  if (!state.prExempt && parent.prExempt) {
    state.prExempt = parent.prExempt;
    filled.push('prExempt');
  }
  return { state: own || filled.length ? state : null, parentRunDir, filled };
}
```

In the `module.exports` block, change `readRunState, writeRunState,` to `readRunState, readRunStateWithParent, writeRunState,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-context.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js tests/hooks-context.test.js
git commit -m "Add readRunStateWithParent — one per-field multi-spec parent fallback beside readRunState (refs #2858)"
```

---

### Task 2: Migrate pack.js, engine-verify.js, precondition.js to the helper

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js:218-233` (`resolveState`) and its require block
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:499-516` (`resolvePrNumber`) and its require block
- Modify: `plugin/bin/lib/pr-bookkeeping/precondition.js:47-64` (and the require at line 7)
- Test: `tests/bin-lib/wrap-up/pack.test.js`, `tests/bin-lib/wrap-up/engine-verify.test.js`, `tests/bin-lib/pr-bookkeeping/precondition.test.js` (append to each)

**Interfaces:**
- Consumes: `readRunStateWithParent(runDir, { read, requireRunIdParent })` from `plugin/bin/lib/hooks/context.js` (Task 1) returning `{ state, parentRunDir, filled }`.
- Produces: unchanged public signatures — `resolveState(deps, runDir) -> { state, source }`, `resolvePrNumber(runDir) -> number|null`, `checkPrBookkeepingPrecondition({ runDir, cwd }) -> { ok, reason, message? }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/wrap-up/engine-verify.test.js` directly after the existing `resolvePrNumber returns null when run-state.json exists directly at runDir but carries no pr field` test:

```js
test('resolvePrNumber (#2858): a per-spec run-state.json carrying only status still finds the parent PR', () => {
  const parentDir = makeTmpDir('verify-prnum-statusonly-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.strictEqual(resolvePrNumber(subDir), 1199);
});

test('resolvePrNumber (#2858): a per-spec pr wins over the parent pr; a null per-spec pr falls back to it', () => {
  const parentDir = makeTmpDir('verify-prnum-precedence-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ pr: { number: 42 } }));
  assert.strictEqual(resolvePrNumber(subDir), 42);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ status: 'active', pr: null }));
  assert.strictEqual(resolvePrNumber(subDir), 1199);
});

test('resolvePrNumber (#2858): a non-spec run dir with no run-state.json does not read a parent directory that happens to hold one', () => {
  const parentDir = makeTmpDir('verify-prnum-gate-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, '2026-10-04T000000-record-1');
  fs.mkdirSync(subDir);
  assert.strictEqual(resolvePrNumber(subDir), null);
});

test('resolvePrNumber (#2858): a parent carrying only prExempt resolves no PR', () => {
  const parentDir = makeTmpDir('verify-prnum-exempt-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ prExempt: 'initial-publish' }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.strictEqual(resolvePrNumber(subDir), null);
});
```

Append to `tests/bin-lib/wrap-up/pack.test.js` directly after the existing `resolveInputs: a spec-* subdirectory whose own run-state.json lacks worktree/pr falls back to the parent run's (#1930 review C1)` test (that existing test is pack's status-only test; these add the remaining rules):

```js
test('resolveInputs (#2858): a per-spec worktree wins over the parent\'s while a null per-spec pr is filled from it', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-precedence-'));
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ worktree: '/parent/tree', pr: { number: 1901 } }));
  const child = path.join(parent, 'spec-1930');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active', worktree: '/own/tree', pr: null }));
  const inputs = resolveInputs({ runDir: child, cwd: '/elsewhere', deps: okDeps() });
  assert.strictEqual(inputs.worktree, '/own/tree');
  assert.strictEqual(inputs.pr, 1901);
  assert.strictEqual(inputs.sources.state, 'parent');
});

test('resolveInputs (#2858): a non-spec run dir never borrows a parent directory\'s run-state.json, and a parent that contributes nothing is not the source', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-gate-'));
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ worktree: '/parent/tree', pr: { number: 1901 } }));
  const plain = path.join(parent, '2026-10-04T000000-record-1');
  fs.mkdirSync(plain, { recursive: true });
  fs.writeFileSync(path.join(plain, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const inputs = resolveInputs({ runDir: plain, cwd: '/elsewhere', deps: okDeps() });
  assert.strictEqual(inputs.worktree, '/elsewhere');
  assert.strictEqual(inputs.pr, null);
  assert.strictEqual(inputs.sources.state, 'run-state.json');

  const emptyParent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-emptyparent-'));
  fs.writeFileSync(path.join(emptyParent, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const child = path.join(emptyParent, 'spec-1930');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.strictEqual(resolveInputs({ runDir: child, cwd: '/elsewhere', deps: okDeps() }).sources.state, 'run-state.json');
});
```

Append to the end of `tests/bin-lib/pr-bookkeeping/precondition.test.js`:

```js
test('checkPrBookkeepingPrecondition (#2858): a per-spec runDir whose own run-state.json carries only status borrows the parent\'s worktree and PR', () => {
  const parentId = '2026-09-17T000019-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  writeRunState(parentRunDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active' });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition (#2858): a status-only per-spec runDir honors a prExempt stamped on the parent', () => {
  const parentId = '2026-09-17T000020-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  writeRunState(parentRunDir, { status: 'active', worktree: wt, prExempt: 'initial-publish' });
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active', pr: null });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});
```

- [ ] **Step 2: Run the tests to verify the new engine-verify test fails**

Run: `node -e "const fs=require('fs'),os=require('os'),path=require('path');const {resolvePrNumber}=require('./plugin/bin/lib/wrap-up/engine-verify');const p=fs.mkdtempSync(path.join(os.tmpdir(),'probe-'));fs.writeFileSync(path.join(p,'run-state.json'),JSON.stringify({pr:{number:7}}));const c=path.join(p,'spec-1');fs.mkdirSync(c);fs.writeFileSync(path.join(c,'run-state.json'),JSON.stringify({status:'active'}));if(resolvePrNumber(c)!==7){console.error('status-only per-spec dir did not resolve the parent PR');process.exit(1);}"`
Expected: FAIL with "status-only per-spec dir did not resolve the parent PR"

(The new pack and precondition status-only tests already pass before the migration — those two copies already filled per field. They pin the behaviour across the migration; only `resolvePrNumber` changes behaviour.)

- [ ] **Step 3: Write the implementation**

`plugin/bin/lib/wrap-up/engine-verify.js` — add `const { readRunStateWithParent } = require('../hooks/context');` to the file's require block (next to the other `require` lines at the top), then replace the comment block and function at lines 499-516 with:

```js
// `verify`'s --run-dir may be the parent pipeline run directory, or (in a
// multi-spec run) a spec-{N}/ subdirectory whose own run-state.json carries
// no PR -- the run's shared PR stamp lives one directory up. Resolved through
// hooks/context.js's readRunStateWithParent (#2858): per-field fill behind
// the /^spec-/ basename gate, a per-spec pr winning over the parent's. Absence
// or a parse/shape failure returns null, which correctly degrades to "no PR"
// (local-merge / degraded-pr-first) behavior in the caller -- it never falls
// further than one level up.
function resolvePrNumber(runDir) {
  const { state } = readRunStateWithParent(runDir);
  return state && state.pr && state.pr.number ? state.pr.number : null;
}
```

`plugin/bin/lib/wrap-up/pack.js` — add `const { readRunStateWithParent } = require('../hooks/context');` after the `const { parseRepo, repoSlug } = require('../repo-resolve');` line, then replace the comment and function at lines 218-233 with:

```js
// run-state.json, with the parent fallback a per-spec subdirectory needs: a
// `spec-*/` run dir carries its own status but not the run's worktree or PR —
// those live one level up, on the parent run's state (#1930 review C1). The
// rule itself is hooks/context.js's readRunStateWithParent (#2858), read
// here through `deps`; `source` is 'parent' only when a worktree or PR
// actually came from there.
function resolveState(deps, runDir) {
  const { state, filled } = readRunStateWithParent(runDir, {
    read: (dir) => readJson(deps, path.join(dir, 'run-state.json')),
  });
  if (filled.includes('worktree') || filled.includes('pr')) return { state, source: 'parent' };
  return { state, source: state ? 'run-state.json' : 'unavailable' };
}
```

`plugin/bin/lib/pr-bookkeeping/precondition.js` — change line 7 to `const { readRunStateWithParent } = require('../hooks/context');`, and replace the block from `let runState;` through the closing `}` of its `catch` (lines 47-64) with:

```js
  let runState;
  let parentRunDir = null;
  try {
    // Only a genuine multi-spec child -- a spec-* dir whose parent is itself
    // run-id-shaped, the same rule pre-tool-use.js's perSpecPathspec applies
    // -- may borrow the parent's stamps; any other parent is not this run's.
    const resolved = readRunStateWithParent(runDir, { requireRunIdParent: true });
    runState = resolved.state || {};
    parentRunDir = resolved.parentRunDir;
  } catch {
    return { ok: true, reason: 'unreadable-run-state' };
  }
```

In the long comment above that block, replace the sentence fragment `the same fallback pack.js's resolveState\n  // applies.` with `through hooks/context.js's readRunStateWithParent\n  // (#2858), the one fallback pack.js's resolveState shares.` (keep the comment's line wrapping at the surrounding width).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js tests/hooks-context.test.js`
Expected: PASS, 0 failures

Run: `grep -rn "path.dirname(runDir), 'run-state.json'" plugin/bin`
Expected: no output (exit 1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/lib/pr-bookkeeping/precondition.js tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js
git commit -m "Migrate the three parent run-state readers to readRunStateWithParent — resolvePrNumber converges on the per-field rule (refs #2858)"
```
