# plan-audit Check A Regular-File Parent (#3493) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** plan-audit Check A stops accepting a regular file (or any other non-directory) as the parent directory of a planned Create/Test file.

**Architecture:** Replace the three type-blind `fs.existsSync` parent checks in `checkA` / `nearestExistingAncestor` with an `isDirectory()` helper built on `plugin/bin/lib/path-guard`'s `lstatType()` (and `resolveLeaf()` for a symlinked parent). The #2745 one-new-level rule and the #1999 sibling cross-reference only rescue a parent that is genuinely *missing*; a parent whose nearest present ancestor is not a directory is always reported.

**Tech Stack:** Node 18+, `node:test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T100053-record-3493/work/3493-spec.md` (materialized from GitHub issue #3493)

Premise-refs: plugin/bin/lib/path-guard/index.js
Premise-refs: plugin/bin/lib/plan-audit/checks.js
Premise-refs: tests/path-guard-conformance.test.js
Premise-refs: plugin/skills/build/plan-audit.md

## Global Constraints

- Route parent checks through `plugin/bin/lib/path-guard`'s `lstatType()`, requiring `type === 'directory'` for a parent (spec Deliverable 1).
- `tests/path-guard-conformance.test.js`'s `lib/plan-audit/checks.js` entry: drop the `UNSAFE —` prefix and adjust the token count (spec Deliverable 3). Remaining `existsSync` tokens after the change: 4 — the Modify/Delete own-path check (`checkA` else-branch), `checkPremiseRefs`, Check C's append-shape candidate probe, and the `plugin/` root probe in the headroom check. All four are plain presence questions.
- No `fs.existsSync` or `fs.realpathSync` added anywhere under `plugin/bin/`.
- `missingDetail[].nearestExistingAncestor` keeps its field name; it now names the nearest *directory* ancestor — exactly what `plugin/skills/build/plan-audit.md` line 19 already documents ("naming the nearest directory that does exist"), so no prose edit is needed.

## Review Focus

1. A Create/Test bullet whose parent is a regular file **at the repo root** (`README.md/new.js`): its grandparent is the repo root directory, so a naive swap of `existsSync(parent)` for `lstatType` would still pass it through the #2745 one-new-level rule. Expected: reported missing. Pinned by the AC1.1 test.
2. A regular file two levels up (`notes.txt/sub/a.js` plus a sibling bullet `notes.txt/sub/b.js`): `lstat` of the parent reports ENOTDIR (`missing`), and the #1999 sibling cross-reference would rescue it. Expected: both reported missing. Pinned in Task 1.
3. A parent that is a **symlink to a real directory**: `lstatType` alone reports `symlink`, and the old `existsSync` accepted it. Rejecting it would make plan-audit stop on a valid plan in a project that symlinks directories. Expected: accepted (resolved through `resolveLeaf` and re-classified). Pinned in Task 1, which skips where the OS refuses to create a symlink.
4. A regular file nested under a real directory (`plugin/bin/tool.js/new.js`): the detail should point the author at `plugin/bin`, not at the file. Pinned in Task 1.
5. The existing #2745 (one new level) and #1999 (sibling cross-reference) passes must keep passing for genuinely missing directories. Already pinned by the existing `checkA` tests in `tests/bin-lib/plan-audit/checks.test.js`, which run unchanged in Step 4.

---

### Task 1: Directory-typed parent checks in Check A

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`
- Modify: `tests/path-guard-conformance.test.js`

**Interfaces:**
- Consumes: `const { lstatType, resolveLeaf } = require('../path-guard');`. `lstatType(p)` returns `{ type: 'missing'|'unreadable'|'symlink'|'file'|'directory'|'other', code }`, where `missing` covers ENOENT *and* ENOTDIR. `resolveLeaf(p)` returns `{ state: 'resolved', path }` or a non-resolved state.
- Produces: no new exports. `checkA(entries, repoRoot)` keeps its return shape `{ ok, missing, missingDetail: [{ path, nearestExistingAncestor }] }`.

- [ ] **Step 1: Write the failing tests** — append after the existing `checkA` block (after the "ledger row 4" tests, before `// ── Check B`) in `tests/bin-lib/plan-audit/checks.test.js`:

```js
// #3493: Check A used fs.existsSync as proof that a Create/Test bullet's
// parent is a directory, so a plan creating a file under a path that is
// currently a regular file passed the audit and failed only at write time.
test('AC1.1 (#3493): checkA reports a Create bullet whose parent path is a regular file', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'README.md'), '');
  try {
    const result = checkA([{ type: 'Create', path: 'README.md/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['README.md/new.js']);
    assert.deepStrictEqual(result.missingDetail, [{ path: 'README.md/new.js', nearestExistingAncestor: '.' }]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: checkA reports a Test bullet whose parent path is a regular file', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'tests'), '');
  try {
    const result = checkA([{ type: 'Test', path: 'tests/new.test.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['tests/new.test.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a regular file two levels up is rescued neither by the one-new-level rule nor by a sibling bullet', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'notes.txt'), '');
  try {
    const result = checkA([
      { type: 'Create', path: 'notes.txt/sub/a.js' },
      { type: 'Create', path: 'notes.txt/sub/b.js' },
    ], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['notes.txt/sub/a.js', 'notes.txt/sub/b.js']);
    assert.deepStrictEqual(result.missingDetail.map((d) => d.nearestExistingAncestor), ['.', '.']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a regular-file parent under a real directory names that directory as the nearest existing ancestor', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'tool.js'), '');
  try {
    const result = checkA([{ type: 'Create', path: 'plugin/bin/tool.js/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missingDetail, [{ path: 'plugin/bin/tool.js/new.js', nearestExistingAncestor: path.join('plugin', 'bin') }]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3493: a parent that is a symlink to a real directory still passes', (t) => {
  const repo = makeTmpRepo();
  try {
    fs.mkdirSync(path.join(repo, 'real'));
    try {
      fs.symlinkSync(path.join(repo, 'real'), path.join(repo, 'linked'), 'dir');
    } catch (err) {
      t.skip(`cannot create a directory symlink here (${err.code})`);
      return;
    }
    const result = checkA([{ type: 'Create', path: 'linked/new.js' }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test --test-name-pattern="3493" tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL. The first four `#3493` tests fail (`ok` is `true` today). The symlink test already passes, because `existsSync` follows symlinks; it pins behavior the fix must keep.

- [ ] **Step 3: Implement in `plugin/bin/lib/plan-audit/checks.js`**

Add `const { lstatType, resolveLeaf } = require('../path-guard');` next to the other `require`s. Add the two helpers below beside `ancestorDirs`, and redefine `nearestExistingAncestor` to walk to the nearest *directory*:

```js
// #3493: a parent counts only when it is a directory (or a symlink resolving
// to one). existsSync answered "is something there" and accepted a regular file.
function isDirectory(p) {
  const leaf = lstatType(p);
  if (leaf.type === 'directory') return true;
  if (leaf.type !== 'symlink') return false;
  const resolved = resolveLeaf(p);
  return resolved.state === 'resolved' && lstatType(resolved.path).type === 'directory';
}

// Nearest ancestor-or-self present on disk in any form (lstatType reports
// ENOENT and ENOTDIR alike as `missing`).
function nearestPresentAncestor(dir) {
  let cur = dir;
  while (lstatType(cur).type === 'missing') {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

function nearestExistingAncestor(dir) {
  let cur = dir;
  while (!isDirectory(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}
```

In `checkA`'s Create/Test branch: replace `if (fs.existsSync(parentAbs)) continue;` with `if (isDirectory(parentAbs)) continue;`. Then put the #2745 grandparent rule and the #1999 `createdDirs` cross-reference (keep their existing comments) inside `if (isDirectory(nearestPresentAncestor(parentAbs))) { … }`, with the grandparent test becoming `isDirectory(grandparentAbs)`. Add one comment line above that `if`: a parent whose nearest present ancestor is a regular file, an unreadable entry, or any other non-directory can never hold the new file, so neither fallback may rescue it. The `missing.push` / `missingDetail.push` that follow stay unchanged and now run for that blocked case too. Leave the Modify/Delete else-branch's `fs.existsSync(abs)` untouched.

- [ ] **Step 4: Update the conformance allowlist** in `tests/path-guard-conformance.test.js`. Replace the `'lib/plan-audit/checks.js'` entry with:

```js
  'lib/plan-audit/checks.js': { existsSync: 4, reason: 'Check A\'s Create/Test parent-directory checks route through path-guard\'s lstatType / resolveLeaf (#3493); the four remaining sites are plain presence questions: a Modify/Delete bullet\'s own path in checkA, a Premise-refs local path in checkPremiseRefs, Check C\'s append-shape candidate path (a miss only skips that candidate), and the plugin/ root before the composed-bytes report.' },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js tests/path-guard-conformance.test.js tests/bin-lib/plan-audit/cli.test.js`
Expected: PASS, 0 failures. This run includes every pre-existing `checkA` test (#2745, #1999, ledger row 4) and the conformance suite's `AC3.1: passes on the current tree` test (#3417's own numbering), which is what covers this spec's AC2.1.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/checks.test.js tests/path-guard-conformance.test.js
git commit -m "Reject a non-directory parent in plan-audit Check A — route through path-guard lstatType

refs #3493"
```

Coverage map: AC1.1 is the `AC1.1 (#3493)` test in Step 1. AC2.1 is the allowlist edit in Step 4, checked by the conformance suite in Step 5 and by the full `npm test` at the build's final verification.
