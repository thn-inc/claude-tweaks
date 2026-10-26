# Test-Impact Tracer Hardening (#4133) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tools/test-impact/tracer.js` record what Node's CommonJS resolver actually depends on, including `require.resolve`'s `paths`, bare `node_modules` lookups, and `package.json` `main`/`exports`. Shrink that record to the candidates whose appearance could change the result. Read `bash -o … -c`, `sh +e -c` and `env … cmd` wrappers as the command they run.

**Architecture:** All runtime changes are inside `install()` in `tools/test-impact/tracer.js`. The `Module._resolveFilename` hook builds Node's ordered candidate list (Task 1). It then emits that list only after the real resolver returns, truncated at the candidate that won (Task 2). The child-command walker gains a bash/sh option parser and an `env` unwrapper (Task 3). `plugin/skills/test/impact-selection.md`'s kinds table and Known limits are rewritten last (Task 4). Every behavior is pinned through the existing fixture-project harness, `tests/test-impact-tracer.test.js`, which copies `tests/fixtures/test-impact/` into a temp root and runs `node --test` there under the tracer.

**Tech Stack:** Node 18+ CommonJS (CI runs Node 20, local is 22), `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T190426-record-4133/work/4133-spec.md`

## Global Constraints

- The tracer never throws into the host, never calls `process.cwd()` (it reads cwd via the captured unpatched `realpathSync.native('.')`), and keeps every existing invariant in its header comment.
- A hook failure fails closed: it calls `failClosed()` (records `["c", ""]`) and never under-records silently.
- Paths outside the root and under `.git/` are dropped by `relOf`; that stays the only filter.
- Tracing is POSIX-only. Any fixture call that needs `bash`, `sh` or `env` is skipped on win32, using the file's existing `{ skip: process.platform === 'win32' && '…' }` style.
- No new dependencies. Tests use `node:test` + `node:assert` like their neighbors.
- Commit subjects use `{Verb} {what} — {detail}` with a `refs #4133` body line (never `closes`/`fixes`), plus the `Claude-Session:` trailer.
- Stage specific files only. Never `git add -A`, never `git stash`, never `git reset`.
- Selection semantics this plan relies on (`plugin/bin/lib/verify/impact.js` `reads()`, read-only for this plan): an `s` entry `e` selects a test for an added or deleted path `p` when `p === e` or `p` starts with `e + '/'`. A modified path reaches only `f` entries and `c` prefixes.

## Review Focus

1. **Builtin requests** (`fs`, `node:test`, `path`) must record nothing: Node returns before any lookup, and probing `node_modules/fs` would bloat every trace. Pinned in Task 1.
2. **A request that fails to resolve** (`MODULE_NOT_FOUND`) must still record every candidate, since any of them appearing changes the outcome. Pinned in Task 2.
3. **A result that is the realpath of a symlinked candidate** must not be mistaken for "no candidate matched → nothing recorded". The fallback is "no match → record the whole list". No fixture: the temp root is already realpath'd. Reviewer checks the code path.
4. **`bash script.sh` with no `-c`** must keep its current behavior: `shellScript` returns null and the script path argument is recorded `f`. Reviewer checks that the new option parser returns null when no `-c` was seen.
5. **`env` with an option the parser does not know** must fall back to today's generic path-argument recording and never throw. Reviewer checks that `envCommand` returns null on an unknown option.

---

### Task 1: Node-faithful resolution candidates (paths, bare specifiers, package.json main/exports)

**Files:**
- Modify: `tools/test-impact/tracer.js` (the `Module._resolveFilename` hook, currently lines 279-300, and the header comment lines 15-19)
- Modify: `tests/test-impact-tracer.test.js` (`TEST_FILES`, `before()`, new test)
- Create: `tests/fixtures/test-impact/g.fixture.js`
- Create: `tests/fixtures/test-impact/lib/pkg/package.json` — `{ "main": "entry.js" }`
- Create: `tests/fixtures/test-impact/lib/pkg/entry.js` — `module.exports = { name: 'pkg-entry' };`

**Interfaces:**
- Produces: a function inside `install()`, `resolutionCandidates(request, parent, options) → Array<{ kind: 's' | 'f', abs: string, cover?: true }> | null`. The list is in Node's probe order. It holds absolute paths, out-of-root ones included (they are filtered only at emit). It returns `null` for a builtin or non-string request. `cover: true` marks an `s` entry whose subtree holds the result (a package directory resolved through `exports`). Task 2 consumes this function unchanged.
- Consumes: Node's own `Module._resolveLookupPaths(request, parent)` and `Module._nodeModulePaths(dir)`. If either is not a function, the hook calls `failClosed()`. Uses `Object.keys(Module._extensions)` for the extension list, which is `['.js', '.json', '.node']` on Node 20 and 22. Node never probes `.cjs`, so the hardcoded `RESOLVE_EXTS` constant is deleted.

- [ ] **Step 1: Write the failing fixture and test**

`tests/fixtures/test-impact/g.fixture.js` uses the header comment block of `a.fixture.js`, plus three tests:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('require.resolve with paths resolves against each path', () => {
  assert.strictEqual(require.resolve('./x', { paths: [path.join(__dirname, 'lib')] }), path.join(__dirname, 'lib', 'x.js'));
});

test('a directory require reads its package.json main', () => {
  assert.strictEqual(require('./lib/pkg').name, 'pkg-entry');
});

test('a bare specifier resolves through node_modules main and exports', () => {
  assert.strictEqual(require.resolve('dep', { paths: [__dirname] }), path.join(__dirname, 'node_modules', 'dep', 'lib', 'main.js'));
  assert.strictEqual(require.resolve('exp', { paths: [__dirname] }), path.join(__dirname, 'node_modules', 'exp', 'src', 'index.js'));
});
```

In `tests/test-impact-tracer.test.js`, add `'g.test.js'` to `TEST_FILES`. In `before()`, right after `copyFixture`, create the in-root `node_modules` tree. It cannot be committed, because `.gitignore` ignores `node_modules/`.
- `node_modules/dep/package.json` holds `{"main":"lib/main.js"}`.
- `node_modules/dep/lib/main.js` holds `module.exports = 1;`.
- `node_modules/exp/package.json` holds `{"name":"exp","exports":"./src/index.js"}`.
- `node_modules/exp/src/index.js` holds `module.exports = 2;`.

Create the directories with `fs.mkdirSync(…, { recursive: true })`.

New test:

```js
test('AC1.1: a require resolves the way Node does — paths option, package.json main, bare node_modules lookups', () => {
  const g = recordsOf('g.test.js');
  assert.ok(g.has(rec('s', 'lib/x.js')), 'require.resolve paths: the candidate under the given path');
  assert.ok(!g.has(rec('s', 'x')) && !g.has(rec('s', 'x.js')), 'paths replaces the requiring file\'s own directory');
  assert.ok(g.has(rec('f', 'lib/pkg/package.json')), 'a directory require reads package.json (content, not existence)');
  assert.ok(g.has(rec('f', 'node_modules/dep/package.json')), 'a bare dependency\'s package.json is read');
  assert.ok(g.has(rec('s', 'node_modules/dep')), 'a bare dependency\'s base candidate is probed');
  assert.ok(g.has(rec('f', 'node_modules/exp/package.json')) && g.has(rec('s', 'node_modules/exp')), 'an exports package is covered by its directory');
  for (const r of g) assert.doesNotMatch(JSON.parse(r)[1], /(^|\/)node_modules\/(node:|fs$|path$|assert$)/, 'builtins record nothing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC1.1: a require resolves" tests/test-impact-tracer.test.js`
Expected: FAIL after Step 1. The current hook resolves `./x` against the fixture root (it records `s x`) and records `lib/pkg/package.json` as `s`, never `f`.

- [ ] **Step 3: Implement `resolutionCandidates(request, parent, options)` and emit its in-root entries from the `_resolveFilename` hook**

Capture `const readFileSync = fs.readFileSync;` with the other unpatched originals. Mirror Node's `Module._resolveFilename` / `_findPath` / `tryPackage` / `resolveExports` in this order:

1. Return null when `request` is not a string or is a builtin. Use `Module.isBuiltin(request)` when it is a function, else `request.startsWith('node:') || Module.builtinModules.includes(request)`.
2. Lookup dirs.
   - Absolute request: `[null]`, which means base = `toAbs(request)`.
   - `options.paths` an array, request starting `./` or `../` (win32 also `.\` and `..\`, Node's `isRelative`): each `toAbs(p)`.
   - `options.paths` an array, any other request: for each `p`, `Module._resolveLookupPaths(request, { paths: Module._nodeModulePaths(toAbs(p)) })`, deduped in order.
   - Otherwise: `Module._resolveLookupPaths(request, parent)`.
   - A `'.'` entry, or any relative dir, goes through `toAbs(dir)`. A null result from `_resolveLookupPaths` yields `[]`.
3. For each lookup dir (non-absolute requests only), first apply the exports step. When the request matches `/^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/`, let `pkgDir = path.join(dir, name)`. If `pkgDir/package.json` is a file (unpatched `statSync`), push `{kind:'f', abs: pkgDir/package.json}`. If it parses (unpatched `readFileSync`, in try/catch) with `exports != null`, push `{kind:'s', abs: pkgDir, cover: true}` and skip to the next dir.
4. `base = path.join(dir, request)` (or the absolute request). `trailingSlash` = request ends with `/` or `\`, or its last segment is `.` or `..`. Unless `trailingSlash`, push `s base`, then `s base + ext` for each ext.
5. Directory step (Node's `tryPackage`). If `base/package.json` is a file, push `f base/package.json` and read `main` (try/catch; a parse failure means no `main`). With a string `main`, let `m = path.resolve(base, main)` and push `s m`, `s m + ext`…, `s m/index + ext`…. Then, `main` or not, push `s base/index + ext`….

The hook calls `resolutionCandidates(args[0], args[1], args[3])`, then emits `relOf(abs)` for every entry whose `relOf` is not null, with `emit(kind, r)`. It keeps the hook's current before-style behavior: every candidate is emitted. Replace header comment lines 15-19 so the `s`/`f` kind descriptions match this, for example: "s … every candidate a require probes (relative, absolute, node_modules, require.resolve paths); f … a package.json a require reads for main or exports".

- [ ] **Step 4: Run the tracer suite to verify it passes**

Run: `node --test tests/test-impact-tracer.test.js`
Expected: PASS, every test, including the existing `a relative require records its resolution candidates as s`. That test's `lib/x/index.js` and `lib/x/package.json` are still emitted as `s`, because `lib/x/package.json` does not exist.

- [ ] **Step 5: Commit**

```bash
git add tools/test-impact/tracer.js tests/test-impact-tracer.test.js tests/fixtures/test-impact/g.fixture.js tests/fixtures/test-impact/lib/pkg/package.json tests/fixtures/test-impact/lib/pkg/entry.js
git commit -m "Resolve require candidates the way Node does — paths option, bare node_modules lookups, package.json main/exports"
```

---

### Task 2: Record only the candidates that can change what a require returns

Volume baseline measured before any change, as a traced full suite at `95df8246` (`node tools/test-impact.js trace`). Over 985 tests it recorded `s` 135,709 and `f` 64,634 times. The per-test median was 40 `s` against 8 `f`.

Why the shrink loses no resolution change, given `reads()` in the Global Constraints:
- A candidate after the winner cannot change the result while the winner exists.
- The winner's own deletion is still recorded, because the winner stays in the list.
- Every earlier candidate is kept.
- A candidate nested under an earlier kept `s` entry is already covered for add and delete by that entry's ancestor rule. Its modification never affects resolution. The one exception is a `package.json`, whose content does, so `f` entries are never dropped.

**Files:**
- Modify: `tools/test-impact/tracer.js` (`wrapFn`, the `_resolveFilename` hook, the header comment)
- Modify: `tests/test-impact-tracer.test.js` (replace `a relative require records its resolution candidates as s`)
- Modify: `tests/fixtures/test-impact/g.fixture.js` (one test)

**Interfaces:**
- Consumes: `resolutionCandidates` (Task 1).
- Produces: `wrapFn(orig, before, nested)` gains an after-hook. If `before(arguments)` returns a function `done`, the wrapper calls `orig`, then `done(result, false)`. If `orig` throws, it calls `done(undefined, true)` and rethrows the original error. A throwing `done` calls `failClosed()` and is never rethrown. Hooks that return `undefined` behave exactly as today.

- [ ] **Step 1: Write the failing test**

Add to `g.fixture.js`:

```js
test('a require that does not resolve', () => {
  assert.throws(() => require.resolve('./lib/missing'), { code: 'MODULE_NOT_FOUND' });
});
```

Replace the existing `a relative require records its resolution candidates as s` test in `tests/test-impact-tracer.test.js` with:

```js
test('AC1.1: a require records its candidates up to the one it resolves to, minus those under an earlier probe', () => {
  const a = recordsOf('a.test.js');
  for (const p of ['lib/x', 'lib/x.js']) assert.ok(a.has(rec('s', p)), `a must record s ${p}`);
  for (const p of ['lib/x.json', 'lib/x.node', 'lib/x.cjs', 'lib/x/index.js', 'lib/x/package.json']) {
    assert.ok(!a.has(rec('s', p)), `a must not record s ${p} (after the winner, or under s lib/x)`);
  }
  const g = recordsOf('g.test.js');
  for (const p of ['lib/pkg', 'lib/pkg.js', 'lib/pkg.json', 'lib/pkg.node']) assert.ok(g.has(rec('s', p)), `g must record s ${p}`);
  assert.ok(g.has(rec('f', 'lib/pkg/package.json')), 'the package.json a directory require reads is kept');
  for (const p of ['lib/pkg/entry.js', 'lib/pkg/index.js']) assert.ok(!g.has(rec('s', p)), `${p} is under s lib/pkg`);
  for (const p of ['lib/missing', 'lib/missing.js', 'lib/missing.json', 'lib/missing.node']) {
    assert.ok(g.has(rec('s', p)), `an unresolved require keeps every candidate: ${p}`);
  }
  assert.ok(!g.has(rec('s', 'lib/missing/index.js')), 'still minus those under s lib/missing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC1.1: a require records its candidates up to" tests/test-impact-tracer.test.js`
Expected: FAIL after Step 1, with `a must not record s lib/x.json`, because Task 1's hook emits every candidate.

- [ ] **Step 3: Move the emission into the after-hook and truncate**

The `_resolveFilename` before-hook computes the list and returns `done(result, threw)`. `done` decides the winner and the kept entries:

- **Winner index:** the first entry where `abs === result`, or `cover` with `result` under `abs + path.sep`. If none matches, retry with the unpatched `realpathNative(abs) === result` (try/catch per entry).
- **No winner, or `threw`:** keep the whole list.
- **Kept entries:** entries `0..winner`, minus any `s` entry whose `relOf` is equal to or under (`r + '/'` prefix) the `relOf` of an earlier kept `s` entry.
- **Emit:** each kept in-root entry.

Out-of-root entries stay in the list for indexing and are never emitted. Update the header comment and the comment above the hook so they state the shrink rule and its dependence on `impact.js`'s `reads()` ancestor rule.

- [ ] **Step 4: Run the tracer suite to verify it passes**

Run: `node --test tests/test-impact-tracer.test.js`
Expected: PASS, every test, including Task 1's `AC1.1: a require resolves the way Node does` (its `s lib/x.js`, `s node_modules/dep` and `s node_modules/exp` entries are all at or before their winners).

- [ ] **Step 5: Commit**

```bash
git add tools/test-impact/tracer.js tests/test-impact-tracer.test.js tests/fixtures/test-impact/g.fixture.js
git commit -m "Record only require candidates that can change the result — truncate at the winner, drop those under an earlier probe"
```

**Orchestrator step after Task 2 (not an implementer step):** re-run `node tools/test-impact.js trace --out {scratch}/map-after.json --allow-dirty` and summarise it with the same counter as the baseline. Record the before and after figures in `decisions.md` and the PR body. That report satisfies the spec's "report whether it can shrink".

---

### Task 3: Read bash/sh option clusters and env wrappers as the command they run

**Files:**
- Modify: `tools/test-impact/tracer.js` (`shellScript`, `recordCommand`, a new `envCommand`, the header comment's Children paragraph)
- Modify: `tests/test-impact-tracer.test.js` (`TEST_FILES`, new test)
- Create: `tests/fixtures/test-impact/h.fixture.js`

**Interfaces:**
- Produces:
  - `shellScript(words) → string | null` (same signature, wider grammar).
  - `isEnv(cmd) → boolean` (basename `env`, or `env.exe`).
  - `envCommand(words, base) → { words: string[], base: string | undefined } | null`.

- [ ] **Step 1: Write the failing fixture and test**

`h.fixture.js` uses the same header comment as `d.fixture.js`, its `quiet(cwd)` helper, and one test per wrapper. Each test is skipped on win32 with `'win32: no bash/sh/env'`. Each call runs `execFileSync(cmd, args, quiet(dir))`:

| Test | Command | Args | Cwd (`dir`) |
|---|---|---|---|
| `bash -o pipefail -c` | `'bash'` | `['-o', 'pipefail', '-c', 'git ls-files']` | `docs/async-list` |
| `bash -euo pipefail -c` | `'bash'` | `['-euo', 'pipefail', '-c', 'git ls-files']` | `docs/promise-list` |
| `sh +e -c` | `'sh'` | `['+e', '-c', 'git ls-files']` | `docs/copied` |
| `env VAR=value cmd` | `'env'` | `['FOO=1', 'git', 'ls-files']` | `tools` |
| `env -u NAME cmd` | `'env'` | `['-u', 'FOO', 'git', 'ls-files']` | `bin` |

New test in `tests/test-impact-tracer.test.js`, with `'h.test.js'` added to `TEST_FILES`:

```js
test('AC1.1: bash -o / -euo, sh +e and env wrappers are read as the command they run', { skip: process.platform === 'win32' && 'win32: no bash/sh/env' }, () => {
  const h = recordsOf('h.test.js');
  for (const p of ['docs/async-list', 'docs/promise-list', 'docs/copied', 'tools', 'bin']) {
    assert.ok(h.has(rec('c', p)), `the wrapped git ls-files records c ${p}`);
  }
  assert.ok(!h.has(rec('c', '')), 'every wrapped call records its own cwd, never the root');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC1.1: bash -o" tests/test-impact-tracer.test.js`
Expected: FAIL with `the wrapped git ls-files records c docs/async-list`. Today, `shellScript` returns null at `pipefail` and at `+e`, and `env` is an unknown command.

- [ ] **Step 3: Implement**

`shellScript(words)`:
- Scan the words from index 1, remembering whether a `-`-led cluster held `c`.
- `--rcfile` and `--init-file` skip their value. Any other `--long` word is skipped.
- A `-` or `+` letter cluster (`/^[-+][A-Za-z]+$/`) holding `o` or `O` also skips the next word (`set -o`/`shopt -O` names).
- `--` or `-` ends the options. Return the next word if `c` was seen, else null.
- The first other word is the script if `c` was seen, else null.

`envCommand(words, base)`:
- Skip `-i`, `-0`, `-v`, `-`, `--ignore-environment`, `--null` and `--debug`.
- `-u`, `--unset` and `-P` skip their value. `-uNAME` and `--unset=NAME` stand alone.
- `-C dir`, `--chdir dir` and `--chdir=dir` set `base = toAbs(dir, base)`, returning null if that is null.
- `--` ends the options.
- Any other `-` word returns null.
- Otherwise return `{ words: words.slice(j), base }`.

In `recordCommand`, after the `NAME=value` skip and before the `isNode` check, add: `if (isEnv(cmd)) { const e = envCommand(words, base); if (e) { recordCommand(e.words, e.base); return; } }`. The recursive call re-skips the assignments `env` passes. Update the header comment's Children paragraph.

- [ ] **Step 4: Run the tracer suite to verify it passes**

Run: `node --test tests/test-impact-tracer.test.js`
Expected: PASS, every test, including `shell env prefixes and sh -c scripts are read as the command they run`.

- [ ] **Step 5: Commit**

```bash
git add tools/test-impact/tracer.js tests/test-impact-tracer.test.js tests/fixtures/test-impact/h.fixture.js
git commit -m "Read bash/sh option clusters and env wrappers as the command they run — tracer child parsing"
```

---

### Task 4: Known limits name only the approximations that remain

**Files:**
- Modify: `plugin/skills/test/impact-selection.md`. It is 10,736 B against the 52,500 B `RAIL_BYTES` rail, so there is ample headroom.

- [ ] **Step 1: Rewrite the kinds table rows and the two Known-limits bullets**

Kinds table:
- `f`: append "and a `package.json` a `require` reads for `main` or `exports`".
- `s`: replace "a `require`'s resolution candidates" with "the candidates a `require` probes up to the one it resolves to (all of them when it fails), minus those under an earlier probe".

Known limits, **Module loads.** It states three things:
- CommonJS loads and `require` resolution are traced the way Node resolves: relative, absolute, `node_modules` lookups, `require.resolve`'s `paths`, and `package.json` `main`/`exports`.
- `#` imports and a package's self-reference are not followed.
- ESM `import` loads are seen only through the file-system calls the loader makes.

Known limits, **Non-node children.** It states:
- In-repo path arguments are recorded.
- A content-reading `git` subcommand records a content prefix.
- `sh`/`bash -c` scripts (with their `-o`/`+o` option clusters) and `env` wrappers are read as the command they run.
- Other wrappers (`xargs`, `timeout`, `nice`, `env -S`) are not.

The other bullets are unchanged.

- [ ] **Step 2: Verify the prose and the suite**

Run: `node --test tests/test-impact-tracer.test.js tests/test-impact-cli.test.js tests/test-skill-affected-conformance.test.js`
Expected: PASS. `grep -n "resolution candidates" plugin/skills/test/impact-selection.md` prints nothing.

Waived: none. AC2.1 is covered by this task's prose plus the per-task tracer-suite runs, and by the full suite in Build Common Step 5.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/test/impact-selection.md
git commit -m "Narrow impact-selection Known limits to the approximations the tracer still makes — #4133 docs"
```

---

## Build deviations (Common Step 4.5, all classified Beneficial)

The build extended the plan where following it literally would have left a read unrecorded, which is the failure the spec guards against.

1. **Absent `package.json` probes are recorded as `s`.** The plan recorded `base/package.json` and the exports step's `pkgDir/package.json` only when present (as `f`). Node probes both either way, so an absent one is now `s`. Adding a `package.json` with `exports` changes how `dep/sub` resolves (b947b047e, 19d57d000).
2. **One planned assertion was dropped.** Task 2's `!s lib/pkg/entry.js` cannot hold: Node realpaths the winning file through the patched `fs.realpathSync`, which records `s` for it independently of the hook. The nested drop is pinned by the `lib/missing` assertions instead (19d57d000, da62bc17e).
3. **A node child is self-tracing only while its env keeps the trace.** Under `env -i`, `env -u NODE_OPTIONS`/`CT_TRACE_*`, or a `NODE_OPTIONS=`/`CT_TRACE_*=` assignment, it fails closed with `c ''`, because its reads are unknown, and its path arguments are still recorded (4450090ae, da62bc17e; fixture `i.fixture.js`).
4. **Wrapper parsing keeps the records the generic loop made.** `env -C dir` records `c dir` before moving the cwd, and a `--rcfile`/`--init-file` value is recorded `f` (da62bc17e).
5. **`.` and `..` with `{ paths }`** union Node 22's lookup set (`paths`) and Node 20's (fake-parent `_resolveLookupPaths`), so either Node version's resolution is covered (da62bc17e).

Measurement for deliverable 3, from a traced full suite before and after the shrink (985 tests, suite exit 0 both times):
- `s` records went from 135,709 to 31,033 (−77%), and the per-test median from 40 to 7.
- `f` records went from 64,634 to 64,651.
- The map went from 2,179,814 to 911,333 bytes.
- Suite wall time went from 355 s to 342 s.
