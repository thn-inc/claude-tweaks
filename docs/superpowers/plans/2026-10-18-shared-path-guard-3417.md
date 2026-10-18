# Shared Path-Guard Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared module under `plugin/bin/lib/path-guard/` that holds the hardened filesystem-check primitives. The three named readers route through it, a conformance lint flags new bare `realpathSync(` / `existsSync(` calls, and [IL-150]/[IL-161] point at it.

**Architecture:** A pure-Node module with no dependencies beyond `fs`/`path`, and every primitive takes an injectable `fsImpl` (and `realpath`) so existing callers that inject fakes keep working. Callers are migrated *without behavior change*: each one passes the realpath function it uses today, so the module's case-canonical default (`fs.realpathSync.native`) applies to new code, not silently to old code. The lint is a `node --test` source scan with an exact per-file count allowlist.

**Tech Stack:** Node 18+, `node:test`, `node:assert/strict`, no npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T215350-record-3417/work/3417-spec.md` (record #3417)

## Global Constraints

- The module lives in a flat sibling directory: `plugin/bin/lib/path-guard/index.js` (CLAUDE.md structure note — no nested `_shared/`).
- `transcript.js`, `installed-plugins.js` and `pre-tool-use.js`'s `realTarget()` are routed through it **with no behavior change**, and their existing suites stay green **unmodified**: `tests/bin-lib/timing/transcript.test.js`, `tests/bin-lib/installed-plugins.test.js`, `tests/bin-lib/superpowers-version.test.js`, `tests/bin-lib/impeccable-engine/resolve.test.js`, `tests/hooks-policy-exemption.test.js`, `tests/hooks-bookkeeping-stamps-gate.test.js`, `tests/hooks-pre-tool-use.test.js`, `tests/hooks-pipeline-shadow-guard.test.js` (baseline at f49277005: 283/283 pass).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #3417` (never `closes`/`fixes`), plus the trailer `Claude-Session: https://claude.ai/code/session_01QGrWbAJ6KVbLkyCLrrphEx`.
- Never `git stash`; stage files by explicit path.
- Every new test is proven to fail before the code under test exists (or against a naive stand-in), per CLAUDE.md's go-red discipline.

## Review Focus

1. **A migrated caller changes its realpath flavor.** Moving `transcript.js` or `realTarget()` from the JS `fs.realpathSync` to `.native` changes Windows 8.3 short-name expansion and casing. `transcript.test.js` compares against `fs.realpathSync(...)`, so the windows-regression job would go red post-merge, and `isPolicyFile` would compare a native leaf against a JS-resolved `canonicalRepoPath`. Each migrated site passes its current realpath explicitly (Tasks 2 and 4 pin this).
2. **An lstat failure that is not ENOENT is read as "missing".** That is exactly the #3375 row-24 fail-open. `lstatType`/`resolveLeaf` must return `unreadable` with the code, never `missing` (Task 1 case "lstat failure").
3. **A path component starting with `..` (e.g. `/a/..foo`) is treated as escaping.** `installed-plugins.js`'s old `!rel.startsWith('..')` wrongly excluded it. The shared `isAncestorOrSelf` tests the `..` *segment* (Task 1 lexical cases). This is the one intended semantic difference in a migrated caller, and it is called out in Task 3.
4. **The lint counts a comment or a function reference as a call.** `realpath: fs.realpathSync.native` (a reference) and `// fs.realpathSync(` (a comment) must not count, while `fsImpl.realpathSync(p)` and `realpathSync.native(p)` must (Task 5 scanner fixture).
5. **A stale allowlist entry.** If a migrated or deleted call site leaves an entry above its real count, the allowlist stops being exact, and a future regression could hide in the slack. The evaluator flags count < allowed and missing files as well as count > allowed (Task 5).

---

### Task 1: path-guard module and unit tests

**Files:**
- Create: `plugin/bin/lib/path-guard/index.js`
- Test: `tests/bin-lib/path-guard/path-guard.test.js`

**Interfaces:**
- Produces (all exported from `plugin/bin/lib/path-guard/index.js`):
  - `lstatType(p, { fsImpl = fs } = {}) -> { type: 'file'|'directory'|'symlink'|'other'|'missing'|'unreadable', code: string|null }`. A successful lstat gives `code: null`. `ENOENT`/`ENOTDIR` give `type: 'missing'` with that code. Any other error gives `type: 'unreadable'`, with the error's code or `'EUNKNOWN'`.
  - `canonicalRealpath(p, { fsImpl = fs, realpath } = {}) -> string | null`. `realpath` defaults to `fsImpl.realpathSync.native`, falling back to `fsImpl.realpathSync` when `.native` is absent. Any throw returns `null`.
  - `resolveLeaf(p, { fsImpl = fs, realpath } = {}) -> { state: 'resolved', path } | { state: 'missing', code } | { state: 'dangling' } | { state: 'unreadable', code }`. Order: if realpath succeeds, return `resolved`. Otherwise call `lstatType(p)`: `symlink` gives `dangling` (a symlink whose target cannot be resolved: dangling, looping or unreadable), `missing` gives `missing`, and `unreadable` gives `unreadable`. When the leaf exists (file/directory/other) but realpath still failed, return `unreadable` with the realpath error's code (or `'EUNKNOWN'`).
  - `isAncestorOrSelf(ancestor, candidate, { pathImpl = path } = {}) -> boolean`. Pure and lexical, for already-canonical absolute paths. `rel = pathImpl.relative(ancestor, candidate)`. True iff `rel === ''`, or (`rel !== '..'`, `!rel.startsWith('..' + pathImpl.sep)`, and `!pathImpl.isAbsolute(rel)`).
  - `resolveWithin(p, root, { fsImpl, realpath, pathImpl } = {}) -> string | null`. Returns the leaf's resolved path when `canonicalRealpath(root)` is non-null, `resolveLeaf(p)` is `resolved`, and `isAncestorOrSelf(rootReal, leaf.path)`. Otherwise `null` (fail closed).
- Header comment: names #3417, [IL-150], [IL-161], and why the default is `.native` (#3380: the JS form echoes input casing on a case-insensitive volume).

- [ ] **Step 1: Write the failing tests**

The test file holds two fixtures and one table, run twice per case.

*Fixtures:*
- **Real tmp tree.** `root = fs.realpathSync.native(fs.mkdtempSync(...))`, holding `root/in/target.txt`, `root/out/secret.txt`, `root/in/link -> root/out/secret.txt`, and `root/in/dangling -> root/in/nowhere`. All expected real paths are computed with `fs.realpathSync.native`.
- **lstat-failure fsImpl.** `{ ...fs, lstatSync, realpathSync }`. Both functions throw `{ code: 'EIO' }` for `root/in/target.txt`, and the replacement `realpathSync` carries a `.native` that throws the same way.
- **`caseInsensitiveVolume(entries)`.** A posix-only fake keyed on the lowercased `path.posix.resolve(p)`. It provides `lstatSync`/`statSync` (stats with `isFile`/`isDirectory`/`isSymbolicLink`; throws `{code:'ENOENT'}` when absent), `existsSync`, `realpathSync` (returns the *input* casing, as the JS form does), and `realpathSync.native` (returns the canonical casing). Entries: `{'/Vol/Root': 'dir', '/Vol/Root/Notes.txt': 'file', '/Vol/Root/Sub': 'dir'}`. The mis-cased inputs are `/vol/root/notes.txt` and `/vol/root/sub`.

*Naive stand-ins* (the hazard each test must catch):
- `naiveType = (p, {fsImpl=fs}={}) => ({ type: fsImpl.existsSync(p) ? 'file' : 'missing', code: null })`
- `naiveRealpath = (p, {fsImpl=fs}={}) => fsImpl.realpathSync(p)` (the JS form, which throws on failure)
- `naiveLiteral = (p, {fsImpl=fs}={}) => (fsImpl.existsSync(p) ? p : null)`
- `naiveLeaf = (p, {fsImpl=fs}={}) => (fsImpl.existsSync(p) ? { state: 'resolved', path: p } : { state: 'missing', code: 'ENOENT' })`
- `naiveWithin = (p, root) => (isPathContained(path.resolve(p), path.resolve(root), { orEqual: true }) ? path.resolve(p) : null)` (lexical only; `isPathContained` comes from `plugin/bin/lib/shared-primitives.js`)

*Cases.* Each row is `{ id, primitive, run(fn), naive }`, where `run` calls `fn` with the case's inputs and asserts with `assert.deepEqual`/`assert.equal`. For every row, emit two tests: `` `AC1.1: ${id}` `` runs `run(realPrimitive)`, and `` `AC1.2: ${id} is red against ${naive.name}` `` runs `assert.throws(() => run(naive))`. Both tests call the same `run`, so the control can actually fail (plan-authoring Go-red control check). Expected values:

| id | call | expected | naive |
|---|---|---|---|
| lstatType symlinked leaf | `lstatType(in/link)` | `{type:'symlink', code:null}` | naiveType |
| lstatType dangling leaf | `lstatType(in/dangling)` | `{type:'symlink', code:null}` | naiveType |
| lstatType lstat failure | `lstatType(in/target.txt, {fsImpl: eio})` | `{type:'unreadable', code:'EIO'}` | naiveType |
| lstatType mis-cased path | `lstatType('/vol/root/sub', {fsImpl: vol})` | `{type:'directory', code:null}` | naiveType |
| canonicalRealpath symlinked leaf | `canonicalRealpath(in/link)` | real `out/secret.txt` | naiveLiteral |
| canonicalRealpath dangling leaf | `canonicalRealpath(in/dangling)` | `null` | naiveRealpath |
| canonicalRealpath lstat failure | `canonicalRealpath(in/target.txt, {fsImpl: eio})` | `null` | naiveRealpath |
| canonicalRealpath mis-cased path | `canonicalRealpath('/vol/root/notes.txt', {fsImpl: vol})` | `'/Vol/Root/Notes.txt'` | naiveRealpath |
| resolveLeaf symlinked leaf | `resolveLeaf(in/link)` | `{state:'resolved', path: real out/secret.txt}` | naiveLeaf |
| resolveLeaf dangling leaf | `resolveLeaf(in/dangling)` | `{state:'dangling'}` | naiveLeaf |
| resolveLeaf lstat failure | `resolveLeaf(in/target.txt, {fsImpl: eio})` | `{state:'unreadable', code:'EIO'}` | naiveLeaf |
| resolveLeaf mis-cased path | `resolveLeaf('/vol/root/notes.txt', {fsImpl: vol})` | `{state:'resolved', path:'/Vol/Root/Notes.txt'}` | naiveLeaf |
| resolveWithin symlinked leaf | `resolveWithin(in/link, in)` (link escapes `in/`) | `null` | naiveWithin |
| resolveWithin dangling leaf | `resolveWithin(in/dangling, in)` | `null` | naiveWithin |
| resolveWithin lstat failure | `resolveWithin(in/target.txt, in, {fsImpl: eio})` | `null` | naiveWithin |
| resolveWithin mis-cased path | `resolveWithin('/vol/root/notes.txt', '/Vol/Root', {fsImpl: vol, pathImpl: path.posix})` | `'/Vol/Root/Notes.txt'` | naiveWithin |

*Extra plain tests:*
- `resolveLeaf` on a non-existent path returns `{state:'missing', code:'ENOENT'}`.
- `resolveLeaf` returns `{state:'unreadable', code:'EIO'}` when lstat succeeds on a regular file but realpath throws `EIO`.
- `canonicalRealpath` falls back to `fsImpl.realpathSync` when `.native` is absent.
- `canonicalRealpath(p, { realpath: fn })` calls the injected `fn`.
- `isAncestorOrSelf` lexical cases: equal gives true; a child gives true; a sibling prefix (`/a/bc` vs `/a/b`) gives false; a `..foo` child (`/a/..foo` under `/a`) gives true; the parent gives false. With `path.win32`: `isAncestorOrSelf('C:\\Repo', 'c:\\repo\\x', {pathImpl: path.win32})` is true, and a cross-drive `D:\\x` is false.
- `Waived AC1.1 for isAncestorOrSelf`: it is a pure string function that never touches the filesystem, so the four filesystem inputs do not apply to it. `resolveWithin` carries them instead.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/path-guard/path-guard.test.js`
Expected: FAIL. `Cannot find module '../../../plugin/bin/lib/path-guard'` (the module does not exist yet).

- [ ] **Step 3: Implement the five exports in `plugin/bin/lib/path-guard/index.js`** per the Interfaces block. `'use strict'`, requires `fs` and `path` only.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/path-guard/path-guard.test.js`
Expected: PASS. Every `AC1.1` and `AC1.2` row passes (the `AC1.2` rows pass *because* `assert.throws` caught the naive stand-in failing).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/path-guard/index.js tests/bin-lib/path-guard/path-guard.test.js
git commit -m "Add shared path-guard module — lstat type check, fail-closed leaf resolution, case-canonical realpath, containment; refs #3417"
```

### Task 2: Route `transcript.js` through path-guard

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (`locateTranscripts` lines ~41-86, `readDispatches` lines ~249-281)

**Interfaces:**
- Consumes: `lstatType`, `resolveLeaf`, `canonicalRealpath`, `isAncestorOrSelf` from `../path-guard`.

- [ ] **Step 1: Migrate `locateTranscripts`.**
  - `projectsRealResolved = canonicalRealpath(projects, { fsImpl, realpath: fsImpl.realpathSync })`, with a null result returning `[]`.
  - In `push`: keep the lexical `startsWith(projectsResolved)` pre-check first. Then `const leaf = resolveLeaf(p, { fsImpl, realpath: fsImpl.realpathSync })`, returning when `leaf.state !== 'resolved'`, and replace `isPathContained(real, projectsRealResolved)` with `isAncestorOrSelf(projectsRealResolved, leaf.path)`.
  - The rest is unchanged: the stat/`isFile` check, and pushing `leaf.path`.
  - Pass `realpath: fsImpl.realpathSync` explicitly (Review Focus 1): the JS form is what this reader uses today, and `.native` would change Windows short-name expansion. Comment that one line with that reason. The equal-to-root case that `isAncestorOrSelf` now admits is still rejected by the `isFile` check, so nothing observable changes.
  - Drop the now-unused `isPathContained` import if nothing else uses it.
- [ ] **Step 2: Migrate `readDispatches`.**
  - The `subagentsDir` check becomes `if (lstatType(subagentsDir, { fsImpl }).type === 'symlink') return {...}`. Any other type falls through to `readdirSync`, as today.
  - Per entry, call `lstatType(path.join(subagentsDir, n), { fsImpl })`. `symlink` gives `skipped.set(n, 'symlink')`. `missing`/`unreadable` give `skipped.set(n, t.code)`. Every other type is unchanged, so it is still read.
- [ ] **Step 3: Run the existing suite, unmodified.**
  Run: `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/cli.test.js tests/bin-lib/timing/derive.test.js`
  Expected: PASS, with the same pass count as before the edit. Run that same command on the pre-edit file first, using `git show HEAD:plugin/bin/lib/timing/transcript.js` to read it, and record both counts in the task report.
- [ ] **Step 4: Confirm the import landed.** `grep -n "path-guard" plugin/bin/lib/timing/transcript.js` prints the require line.
- [ ] **Step 5: Commit** `plugin/bin/lib/timing/transcript.js`: `Route transcript.js readers through path-guard — no behavior change; refs #3417`.

### Task 3: Route `installed-plugins.js` through path-guard

**Files:**
- Modify: `plugin/bin/lib/installed-plugins.js` (`safeRealpath`, the `isAncestorOrSelf` expression in `selectEntry`)

**Interfaces:**
- Consumes: `canonicalRealpath`, `isAncestorOrSelf` from `./path-guard`.
- Produces: `safeRealpath(p, deps)` and `selectEntry(...)` keep their exact signatures and exports (`superpowers-version.js` and `impeccable-engine/index.js` import them).

- [ ] **Step 1: Migrate.**
  - `safeRealpath(p, deps)` becomes `const r = canonicalRealpath(p, { realpath: deps.realpath }); return r === null ? p : r;`. The injected `deps.realpath` is preserved: superpowers-version injects `.native`, impeccable-engine and the tests inject the JS form, and the fallback-to-input on failure is kept, because a stale `projectPath` must still compare lexically.
  - Replace the inline `path.relative` ancestor test with `isAncestorOrSelf(candidate, target)`.
  - State the one intended semantic difference in a code comment: a `projectPath` child component named `..something` now counts as contained, where the old `startsWith('..')` wrongly excluded it (Review Focus 3).
- [ ] **Step 2: Run the existing suites, unmodified.**
  Run: `node --test tests/bin-lib/installed-plugins.test.js tests/bin-lib/superpowers-version.test.js tests/bin-lib/impeccable-engine/resolve.test.js`
  Expected: PASS, with the same counts as the pre-edit baseline (record both counts).
- [ ] **Step 3: Commit** `plugin/bin/lib/installed-plugins.js`: `Route installed-plugins.js realpath and ancestor test through path-guard; refs #3417`.

### Task 4: Route `pre-tool-use.js`'s `realTarget()` through path-guard

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`realTarget`, lines ~176-196, and its comment)

**Interfaces:**
- Consumes: `resolveLeaf` from `../path-guard`.
- Produces: `realTarget(targetPath) -> string | null`, same contract.

- [ ] **Step 1: Migrate `realTarget`.**
  - Keep the non-string/empty/relative guard returning `null`. Then call `const leaf = resolveLeaf(path.resolve(targetPath), { realpath: fs.realpathSync })`.
  - `resolved` returns `leaf.path`. `dangling` returns `null`. `missing` and `unreadable` take today's parent-only fallback (`safeReal(path.dirname(...))` plus the literal basename; `null` when the parent is unresolvable).
  - Comment that `unreadable` keeps the parent-only path because the pre-#3417 code treated every lstat failure as "nothing there yet". It is a write target, so the write itself fails on the same EACCES.
  - Comment why the JS `fs.realpathSync` is passed: `canonicalRepoPath` and `safeReal` resolve the other side of `isPolicyFile`'s equality with the JS form, so switching only this side to `.native` would turn a mis-cased allow into a deny. Moving both sides together is a separate change, which this plan files as a follow-up.
  - The hook's hot path gains only a require of a `fs`/`path`-only module.
- [ ] **Step 2: Run the existing hook suites, unmodified.**
  Run: `node --test tests/hooks-policy-exemption.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-pre-tool-use.test.js tests/hooks-pipeline-shadow-guard.test.js`
  Expected: PASS, with the same counts as the pre-edit baseline (record both counts).
- [ ] **Step 3: Commit** `plugin/bin/lib/hooks/pre-tool-use.js`: `Route realTarget() through path-guard's resolveLeaf — same three-way contract; refs #3417`.

### Task 5: Conformance lint over `plugin/bin/**/*.js`

**Files:**
- Create: `tests/path-guard-conformance.test.js`

**Interfaces:**
- Consumes: the migrated tree from Tasks 2-4. Counts must be taken *after* them.
- In-file functions:
  - `stripComments(src) -> string`: blanks comments while keeping offsets. Copy the two-regex body from `tests/windows-hide-spawn-conformance.test.js`, which does not export it.
  - `countGuardedCalls(src) -> { realpathSync: number, existsSync: number }`: counts `/\brealpathSync(?:\.native)?\s*\(/g` and `/\bexistsSync\s*\(/g` over `stripComments(src)`.
  - `evaluate(files, allowlist) -> string[]`. `files` is `{ relPosixPath: source }` and `allowlist` is `{ relPosixPath: { realpathSync?, existsSync?, reason } }`. It returns one offender line per file whose count for either key differs from the allowlisted value (a missing key or entry counts as 0), and one per allowlist entry whose file is absent from `files`. Each offender line names the file, the key, the actual count and the allowed count.
  - `ALLOWLIST`: one entry per existing `plugin/bin` file (path relative to `plugin/bin`, posix) with a non-zero count, plus a `reason`.
- Scan root: every `.js` file under `plugin/bin/`, skipping `node_modules` and `lib/path-guard/`.

- [ ] **Step 1: Write the tests.**
  - `scanner counts calls, not comments or references`: `countGuardedCalls` over a fixture that has `fs.realpathSync(a)`, `fs.realpathSync.native(b)`, `fsImpl.realpathSync(c)`, `fs.existsSync(d)`, `// fs.realpathSync(e)`, `/* existsSync(f) */` and `const deps = { realpath: fs.realpathSync.native }` gives `{ realpathSync: 3, existsSync: 1 }`.
  - `AC3.1: a bare fs.realpathSync( in a new plugin/bin/lib/ file is flagged`: `evaluate({ 'lib/new-reader.js': "const fs = require('fs');\nmodule.exports = (p) => fs.realpathSync(p);\n" }, ALLOWLIST)` returns exactly one offender, which contains `lib/new-reader.js` and `realpathSync`.
  - `a stale allowlist entry is flagged`: `evaluate({}, { 'lib/gone.js': { existsSync: 1, reason: 'x' } })` returns one offender naming `lib/gone.js`.
  - `AC3.1: passes on the current tree`: `assert.deepEqual(evaluate(readTree(), ALLOWLIST), [], message)`. `message` tells the author to route through `plugin/bin/lib/path-guard` (`lstatType` / `resolveLeaf` / `canonicalRealpath` / `resolveWithin`), or to add an `ALLOWLIST` entry with a reason when existence alone is the question.
  - `AC2.1: the three named call sites import path-guard`: the sources of `lib/timing/transcript.js`, `lib/installed-plugins.js` and `lib/hooks/pre-tool-use.js` each match `/require\(\s*['"](?:\.\.?\/)+path-guard(?:\/index(?:\.js)?)?['"]\s*\)/`.
  - `AC4.1: docs/donts.md's IL-150 and IL-161 lines name the helper`: every `docs/donts.md` line containing `[IL-150]` or `[IL-161]` also contains `path-guard`, and at least one line carries each tag. This goes red until Task 6.
- [ ] **Step 2: Build the allowlist by audit, not by copying counts.**
  - Run the scanner over the tree to list every file with a non-zero count.
  - Read each call site, and write one `reason` per file that states why its existence check or realpath is safe. Typical reasons: "existence-only probe; the type is checked by the following statSync/isFile", "existence of a config file — any type reads as absent on the following readFileSync failure", "realpath of a directory the caller just created", "deps-injected default, routed through the caller's own fallback".
  - **Do not fix any call site.** If a site is genuinely unsafe (existence trusted as proof of type, or a realpath compared against a differently-resolved value), still allowlist it, prefix its reason with `UNSAFE —`, and list it in your report as a follow-up (file, line, one-sentence hazard). The controller files those via `/claude-tweaks:capture`.
- [ ] **Step 3: Run.**
  Run: `node --test tests/path-guard-conformance.test.js`
  Expected: every test PASSES except `AC4.1`, which FAILS (`docs/donts.md` not yet updated). Prove `AC3.1`'s live test can go red: temporarily add `fs.realpathSync(x);` to `plugin/bin/lib/installed-plugins.js`, see it FAIL naming that file, then restore the file with `git checkout -- plugin/bin/lib/installed-plugins.js` and quote both outputs in the report.
- [ ] **Step 4: Commit** `tests/path-guard-conformance.test.js`: `Add path-guard conformance lint — exact per-file realpathSync/existsSync allowlist; refs #3417`.

### Task 6: Point IL-150/IL-161 and the structure docs at the helper

**Files:**
- Modify: `docs/donts.md:116` ([IL-150]) and `docs/donts.md:197` ([IL-161])
- Modify: `docs/incident-log.md` (end of the `## IL-150` section, around line 1347; end of the `## IL-161` section, around line 1732, after its `**Removal condition:**` paragraph)
- Modify: `docs/plugin-structure.md` (add a `plugin/bin/lib/path-guard/` row right after the `plugin/bin/lib/installed-plugins.js` row, line 64)
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` (the "Resolve the leaf symlink before deciding" bullet)

- [ ] **Step 1: donts.md.**
  - **[IL-150].** Keep the rule, but change "mirror `realTarget()`" to "route through `plugin/bin/lib/path-guard`'s `resolveLeaf()` (`realTarget()` in `pre-tool-use.js` is its gate-side caller)". Keep the three-way shape: resolved, dangling fails closed, missing passes through.
  - **[IL-161].** Narrow it to: check a path's type with `plugin/bin/lib/path-guard`'s `lstatType()` rather than `fs.existsSync`/a listing, and contain a write or read with `resolveWithin()`. `tests/path-guard-conformance.test.js` flags any new bare `realpathSync(`/`existsSync(` call outside the module.
  - Each line stays one rule plus one clause of why, ending with its tag.
- [ ] **Step 2: incident-log.md.**
  - Under IL-150, add `**Narrowed 2026-10-18 (#3417).**`. IL-150 carries no removal condition of its own. Its rule now points at the shared `resolveLeaf()` instead of a copy-the-shape instruction, because `realTarget()` routes through it.
  - Under IL-161, add `**Removal condition met, narrowed rather than retired (2026-10-18, #3417).**`. Both halves of the stated condition now exist: the shared lstat-backed helper (`plugin/bin/lib/path-guard/`) and the grep-based lint (`tests/path-guard-conformance.test.js`). The rule is narrowed, not retired, because the lint enforces only *routing* for new call sites. The allowlisted legacy callers are judged one by one in the allowlist's reasons, and any marked `UNSAFE —` are tracked as follow-up records.
- [ ] **Step 3: plugin-structure.md row.**
  `plugin/bin/lib/path-guard/ → index.js (#3417) — lstatType, canonicalRealpath (.native by default), resolveLeaf (resolved/missing/dangling/unreadable), isAncestorOrSelf (lexical), resolveWithin (fail-closed containment); every primitive takes an injectable fsImpl/realpath. New filesystem-check code routes through it; tests/path-guard-conformance.test.js enforces it with an exact allowlist.`
- [ ] **Step 4: Skill bullet.**
  In `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`, change "Reuse it, or replicate its three-way shape … exactly" to say that `realTarget()` routes through `plugin/bin/lib/path-guard`'s `resolveLeaf()`, and that a new exemption calls `resolveLeaf()` (or `realTarget()`) rather than replicating the shape.
- [ ] **Step 5: Run.**
  Run: `node --test tests/path-guard-conformance.test.js tests/claude-md-budget.test.js`
  Expected: PASS, with `AC4.1` now green.
- [ ] **Step 6: Commit** the four files: `Point IL-150/IL-161 at the path-guard helper and record the IL-161 removal condition; refs #3417`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (module with four primitives) | Task 1 |
| Deliverable 2 (three call sites, no behavior change) | Tasks 2, 3, 4 |
| Deliverable 3 (lint with allowlist) | Task 5 |
| Deliverable 4 (IL-150/IL-161 updated, removal conditions applied) | Task 6 |
| AC1.1, AC1.2 | Task 1 table |
| AC2.1 | Task 5 import test + the per-task unmodified-suite runs (Tasks 2-4) |
| AC3.1 | Task 5 fixture + live-tree tests |
| AC4.1 | Task 5 donts test + Task 6 |
