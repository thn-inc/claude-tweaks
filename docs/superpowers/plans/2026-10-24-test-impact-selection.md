# Test-Impact Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `verify.js --scope` selects only the test files a change can affect, using a test-impact map built from one traced full-suite run, and falls back to the full suite (naming why) whenever the map cannot be trusted.

**Architecture:** A `--require` preload (`tools/test-impact/tracer.js`, propagated to every child `node` via `NODE_OPTIONS`) records which repo paths each test file reads; `tools/test-impact.js trace` turns one traced run into a commit-stamped map in the git common dir, and `fetch` pulls the newest map a post-merge CI job built. The plugin side (`plugin/bin/lib/verify/impact.js`) is generic: it parses a map, and a new verify-scope rule kind (`"impact": true`) asks it which tests intersect the changed files. `verify.js` runs the declared subset command with the selected file list, or the suite's full command on any fallback.

**Tech Stack:** Node 20+ CommonJS, `node --test`, git CLI, `gh` (fetch only), GitHub Actions.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T081908-record-4024/work/4024-spec.md`

## Global Constraints

- Plugin code (`plugin/bin/**`) ships no npm deps; every git/gh call goes through an injectable `execImpl`/runner (`gh-api-module-pattern`), uses `--end-of-options` before revs, `windowsHide: true`, `stdio: ['ignore','pipe','pipe']`.
- Generic mechanism: nothing under `plugin/` may name this repo's paths (`tests/`, `tools/`); the repo-specific values live only in `.claude-tweaks/verify-scope.json` and `tools/`.
- Fail closed: a missing map, a map not traced at an ancestor of HEAD, a map older than `maxAgeCommits`, a map from a failing suite, an unparseable map, or a changed impact-rule path no traced read covers → the impact suite runs its full command and `report.json`'s `scope.impact.fallback` names the reason.
- No declaration with an `impact` block behaves differently from today: every new field/branch is gated on `decl.impact`; existing return shapes (`changedFiles`, `selectScope`, rule objects) are unchanged unless the new input is present.
- Map refresh (tracing) never runs inside verify or a build; verify may only run the declared `impact.fetch` command (download of a ready map).
- CI's `npm test` (full) stays the merge gate; `.github/workflows/test.yml` is not changed.
- `plugin/skills/test/verification.md` is at 52489 bytes against `RAIL_BYTES` 52500: its net byte change must be ≤ +11 — the impact contract goes in a new lazy sub-file.
- Commit messages: `{Verb} {what} — {detail}`, body ends `refs #4024` (never closes/fixes) and the line `Claude-Session: https://claude.ai/code/session_01E1gDeD3PPFqVRzcgMbvZ4h`.

## Selection semantics (decided — every task uses these)

Map test entry kinds, each a list of repo-relative POSIX paths (`''` = repo root):
- `f` content reads: `readFile*`, `open*`, `createReadStream`, `copyFile*` source, module loads, `stat*`/`lstat*` (metadata includes size), `cp*` of a file.
- `s` existence probes: `exists*`, `access*`, `realpath*`, `readlink*`.
- `d` directory listings: `readdir*`, `opendir*`, `cp*` of a directory source.
- `c` content prefixes: a non-node child process given a directory argument inside the repo, or a content-reading `git` subcommand (`ls-files grep show cat-file ls-tree archive diff log status blame`) run in the repo with no path argument (prefix = that git cwd).

`under(p, prefix)` ⇔ `prefix === '' || p === prefix || p.startsWith(prefix + '/')`.

For each changed impact-rule path `p` with status `M` (modified): a test is selected iff `p ∈ f` or `under(p, c)`. With status `A` or `D` (added/deleted/renamed side): iff `under(p, e)` for some non-empty `e ∈ f ∪ s` (the path itself or an ancestor directory — a directory's first file added or last deleted changes its existence and stat; `''` never counts, the root always exists) or `under(p, d)` or `under(p, c)`.
A changed test file goes through the same rules: the OTHER map tests that read it are matched (a conformance test reading or listing every test file); it never matches itself and never yields `untraced-path`.
Selected set = matched tests ∪ changed test files present at HEAD ∪ test files present at HEAD absent from the map ("untraced tests"). A changed path that is not a test file and selects nothing → fallback `untraced-path: {p}`.
Anchoring with no usable stamp anchor: only the `--integration-branch` merge-base anchors an impact declaration (`fallbackBase`); an explicit `--base` keeps today's behavior (mode `full`, fallback `no-anchor`).

## Review Focus

- A test that spawns `node` with an explicit, clean `env` (no `NODE_OPTIONS`) must still be traced — Task 6 test `child with explicit env is traced`.
- A test whose cwd was deleted mid-test (`tests/lib.test.js`'s deleted-cwd case) must not change behaviour under the tracer — the tracer never calls `process.cwd()` for an absolute path and never throws — Task 6 test `absolute path never consults process.cwd`.
- `util.promisify(execFile)` must keep resolving `{stdout, stderr}` under the tracer (wrapped functions copy own property descriptors, including `util.promisify.custom`) — Task 6 test `wrapped execFile keeps promisify.custom`.
- A path containing a tab or newline must not corrupt a trace file — trace lines are JSON — Task 6 test `paths with newline round-trip`.
- A space in the checkout path (this machine's `Code Workspaces`) must survive `NODE_OPTIONS` (double-quoted `--require`) and the `{files}` substitution (shell-quoted via `substituteFile`) — Task 5 test `{files} path with a space is quoted`, Task 7 test `trace under a path with a space`.

---

### Task 1: Changed-file statuses (additive)

**Files:**
- Modify: `plugin/bin/lib/verify/changed-files.js`
- Test: `tests/bin-lib/verify/changed-files.test.js`

**Interfaces:**
- Produces: `changedFiles({ base, execImpl, withStatus = false })` → unchanged `{ base, files }` when `withStatus` is false; with it, `{ base, files, statuses }` where `statuses` is a plain object `{ [path]: 'A' | 'M' | 'D' }` covering every entry of `files`.

- [ ] **Step 1: Write failing tests** in `changed-files.test.js` using the file's existing fake-`exec` pattern:
  - `withStatus maps diff statuses`: diff `-z` stream `A\0new.js\0M\0mod.js\0D\0gone.js\0R100\0old.js\0ren.js\0C090\0src.js\0copy.js\0T\0type.js\0` + empty porcelain → `statuses` deepStrictEqual `{ 'new.js':'A','mod.js':'M','gone.js':'D','old.js':'D','ren.js':'A','copy.js':'A','type.js':'M' }`.
  - `withStatus maps porcelain statuses`: empty diff + porcelain `?? u.js\0 M w.js\0 D x.js\0A  y.js\0R  n.js\0o.js\0` → `{ 'u.js':'A','w.js':'M','x.js':'D','y.js':'A','n.js':'A','o.js':'D' }`.
  - `an existence change wins over M`: diff says `M\0p.js\0`, porcelain `?? p.js`-style `A` for the same path → `'A'`; diff `A`, porcelain ` M` → `'A'`.
  - `withStatus off keeps the old shape`: existing `deepStrictEqual(changedFiles(...), { base, files: [] })` stays and a new assertion that `'statuses' in result` is false.
- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/changed-files.test.js` — Expected: the new tests FAIL (`statuses` undefined).
- [ ] **Step 3: Implement** status-returning variants of the two parsers (`parseDiffNameStatusZ`, `parseStatusPorcelainZ` gain an optional second output — return `[path, status]` pairs internally; keep the exported path-only behaviour for existing callers) and merge rule: first non-`M` status for a path wins, else `M`.
- [ ] **Step 4: Run** the same file — Expected: all PASS.
- [ ] **Step 5: Commit** `git add plugin/bin/lib/verify/changed-files.js tests/bin-lib/verify/changed-files.test.js` — message `Add changed-file statuses to changedFiles — withStatus flag feeds test-impact selection`.

### Task 2: Impact map format and pure selection

**Files:**
- Create: `plugin/bin/lib/verify/impact.js`
- Test: `tests/bin-lib/verify/impact.test.js`

**Interfaces:**
- Produces:
  - `IMPACT_MAP_VERSION = 1`, `DEFAULT_MAP_NAME = 'claude-tweaks-test-impact.json'`, `KINDS = ['f','s','d','c']`.
  - `encodeImpactMap({ commit, tracedAt, exitCode, node, tests })` where `tests` is `{ [testFile]: { f:[], s:[], d:[], c:[] } }` (paths) → interned object `{ version, commit, tracedAt, exitCode, node, paths: string[] (sorted unique), tests: { [testFile]: { f:number[], s:number[], d:number[], c:number[] } } }` (index lists sorted; empty kinds omitted).
  - `parseImpactMap(text)` → `{ ok: true, map }` with `map.tests[t]` decoded back to path arrays (all four kinds present, possibly empty) and `map.commit`, `map.exitCode`; or `{ ok: false, reason }` with reason one of `'unparseable'`, `'wrong-version'`, `'bad-commit'` (not 40-hex), `'bad-shape'` (tests not an object / index out of range / non-integer).
  - `under(path, prefix)` per the Selection semantics.
  - `selectImpactTests({ map, changed, headTests, isTestFile })` — `changed`: `[{ path, status }]`; `headTests`: string[] of test files present at HEAD; `isTestFile(path) → boolean`. Returns `{ ok: true, tests: string[] (sorted), matched: string[], changedTests: string[], untracedTests: string[] }` or `{ ok: false, reason: 'untraced-path: {p}' }` (first offending path in sorted order).
  - `mapProblem({ parsed, isAncestor, distance, maxAgeCommits })` → `null` or one of `'map-missing'` (parsed null), `'map-invalid: {reason}'`, `'map-from-failing-suite'` (exitCode !== 0), `'map-not-ancestor'`, `'map-stale: {distance} commits > {maxAgeCommits}'`.

- [ ] **Step 1: Write failing tests** in `impact.test.js`:
  - `encode/parse round-trips` a two-test map; `parseImpactMap('{')` → reason `unparseable`; version 2 → `wrong-version`; commit `'abc'` → `bad-commit`; an index 99 with 1 path → `bad-shape`.
  - `M selects only content readers`: map `{ 'tests/a.test.js': { f:['src/x.js'] }, 'tests/b.test.js': { s:['src/x.js'], d:['src'] } }`, changed `[{path:'src/x.js',status:'M'}]` → `tests` `['tests/a.test.js']`.
  - `A selects existence and listing readers (AC3.1)`: same map, status `A` → both tests.
  - `D selects existence and listing readers`: status `D` → both tests.
  - `c prefix selects on any status`, including prefix `''`.
  - `a directory read matches only beneath it`: `d:['plugin/skills']` with added `plugin/skillsX/a.md` → `untraced-path: plugin/skillsX/a.md`.
  - `changed test files are selected directly` even when absent from the map (new test), and not when deleted (absent from `headTests`).
  - `untraced tests at HEAD are selected`: `headTests` includes `tests/new.test.js` absent from map → in `tests` and `untracedTests`.
  - `untraced path fails closed`: modified `src/nobody.js` → `{ ok:false, reason:'untraced-path: src/nobody.js' }`.
  - `discrimination (AC4.1 AC4.2)`: fixture map where `tests/a.test.js` reads `src/x.js` and `tests/b.test.js` reads `src/x.js`; delete `src/x.js` from b's `f` → b deselected; restore → b reselected (assert both directions in one test).
  - `mapProblem` table: each reason string exactly as in Interfaces, and `null` for a valid ancestor within bound (`distance === maxAgeCommits` is still fresh).
- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/impact.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `impact.js` (pure; no fs, no git).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** both files — `Add the test-impact map format and pure selection — generic impact.js for verify-scope`.

### Task 3: Declaration — `impact` block and rule kind

**Files:**
- Modify: `plugin/bin/lib/verify/declaration.js`
- Test: `tests/bin-lib/verify/declaration.test.js`

**Interfaces:**
- Consumes: Task 2 `DEFAULT_MAP_NAME` (not required; only for the doc comment).
- Produces: `decl.impact` = `null` when absent, else `{ suite: string, command: string, tests: string[], maxAgeCommits: number, map: string | null, fetch: string | null }` (`maxAgeCommits` default `200`). Impact rules parse to `{ match, suites: null, impact: true, static }`; non-impact rules keep exactly `{ match, suites, static }`.

- [ ] **Step 1: Write failing tests**:
  - `a valid impact block parses`: `checks.tests` `{ tests:'npm test' }`, `impact: { suite:'tests', command:'run {files}', tests:['tests/**/*.test.js'] }`, rules `[{match:'src/**', impact:true, static:true}]` → `decl.impact` deepStrictEqual `{ suite:'tests', command:'run {files}', tests:['tests/**/*.test.js'], maxAgeCommits:200, map:null, fetch:null }` and `rules[0]` deepStrictEqual `{ match:'src/**', suites:null, impact:true, static:true }`.
  - `every invalid impact field is named` in one result: `suite` undeclared, `command` missing `{files}`, `tests` empty, `maxAgeCommits` 0, `map` `'../x'` (must be repo-relative without `..`, or start with `{git-common-dir}/`), `fetch` `''`.
  - `an impact rule needs the impact block`; `an impact rule may not also carry suites`; `impact with a tool-scoped tests command is refused`.
  - `no impact block → decl.impact is null` and the existing rule deepStrictEqual at line 57 still passes.
- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/declaration.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `readDeclaration` (collect errors like the existing blocks).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add the impact block and rule kind to verify-scope declarations — validated, null when absent`.

### Task 4: Scope selection with impact rules

**Files:**
- Modify: `plugin/bin/lib/verify/scope.js`
- Test: `tests/bin-lib/verify/scope.test.js`

**Interfaces:**
- Consumes: Task 2 `selectImpactTests`; Task 3 `decl.impact`, impact rules.
- Produces: `selectScope({ decl, files, stamp, statuses = null, impact = null, fallbackBase = null })`. `impact` context = `{ map: parsedMap | null, problem: string | null, headTests: string[] }`. When `decl.impact` is null the function is byte-for-byte today's (no `impact` key in the result). When set, the result gains `impact: { suite, files: string[] | null, fallback: string | null, selected: number | null, changedTests, untracedTests, superseded: boolean }`:
  - `files` null ⇔ the suite runs its full command (fallback or superseded); `selected` = `files.length` or null.
  - `superseded: true` when some changed file selected every suite (unmatched path, or a `'*'` rule) — the impact suite runs in full, `fallback` stays null.
  - `fallback` = `impact.problem` when non-null, else `selectImpactTests`'s reason, else null. A missing `impact` context reads as problem `'map-missing'`.
  - `base`: `anchorOf(stamp)`, else `fallbackBase` when `decl.impact` is set (a CI-verified integration-branch merge-base the caller resolved), else null → mode `full` as today.
  - Mode: a subset impact suite (`files` non-null) never yields `full`; it counts as the suite selected. An empty subset drops the suite from `suites`. Static flag from the impact rule as for other rules.

- [ ] **Step 1: Write failing tests** (declaration built with Task 3's shape; one impact suite `tests` plus a second suite `docs`):
  - `impact subset → scoped`: map where `tests/a.test.js` reads `src/x.js`; files `['src/x.js']`, statuses `{ 'src/x.js':'M' }`, headTests `['tests/a.test.js','tests/b.test.js']` (b traced, reads nothing relevant) → `mode 'scoped'`, `suites ['tests']`, `impact.files ['tests/a.test.js']`, `selected 1`.
  - `fallback names its reason and runs full`: `impact.problem 'map-stale: 300 commits > 200'` → `impact.files null`, `fallback` that string, `mode 'full'` when static and every suite selected, else `'scoped'`.
  - `untraced path fails closed` → `fallback 'untraced-path: src/nobody.js'`.
  - `an unmatched path supersedes` → `superseded true`, `files null`, `fallback null`, mode `full`.
  - `no stamp + fallbackBase anchors on the merge-base` → `base` = fallbackBase, mode `scoped`; `no stamp + no fallbackBase` → mode `full`.
  - `no impact block is unchanged`: the existing AC1 deepStrictEqual still holds and a decl without impact has no `impact` key.
- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/scope.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement**; keep the existing first-match loop, routing impact-rule matches to an impact path list.
- [ ] **Step 4: Run** — Expected: PASS; also run `node --test tests/verify-scope-declaration.test.js` — Expected: PASS (repo declaration unchanged yet).
- [ ] **Step 5: Commit** — `Route impact rules through selectScope — subset, fallback and merge-base anchoring`.

### Task 5: Wire impact selection into verify.js

**Files:**
- Modify: `plugin/bin/verify.js`, `plugin/bin/lib/verify/file-template.js` (additive `token` option), `plugin/bin/lib/verify/impact.js` (I/O helpers)
- Create: `tests/bin-lib/verify/impact-cli.test.js`
- Test: `tests/bin-lib/verify/file-template.test.js`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `substituteFile(template, file, { platform, token = '{file}' })` — identical behaviour, placeholder configurable.
  - In `impact.js`: `resolveMapPath({ decl, commonDir, repoRoot })` (`decl.impact.map` with `{git-common-dir}` expanded, else `path.join(commonDir, DEFAULT_MAP_NAME)`); `loadImpactContext({ decl, repoRoot, commonDir, execImpl, fsImpl, runFetch })` → `{ map, problem, headTests, mapPath, mapCommit, distance, fetch: { ran, exitCode, durationMs, timedOut, signal } | null }`. It reads + parses the map, checks `git merge-base --is-ancestor` and `git rev-list --count {commit}..HEAD`, computes `mapProblem`; when a problem exists and `decl.impact.fetch` is set it calls `runFetch(command)` once (verify passes a `spawnSync(command, { shell: true, timeout: 120000, cwd: repoRoot, stdio: 'ignore' })` wrapper), then reloads. `headTests` = `git ls-files -z --cached --others --exclude-standard` filtered by `decl.impact.tests` globs (`globToRegExp`) and present on disk.
  - `report.json` `scope.impact` = Task 4's `sel.impact` plus `{ mapPath, mapCommit, mapAgeCommits, fetch, listPath, selectedFiles }`; stdout line after `Scope:`: `Impact: {selected} of {headTests.length} test file(s) selected (map {commit9}, {distance} commit(s) old)` or `Impact: full {suite} — {fallback | 'superseded by a full-suite rule'}`.

- [ ] **Step 1: Write failing tests**:
  - `file-template.test.js`: `substituteFile('run {files}', '/a b/l.txt', { platform:'linux', token:'{files}' })` → `{ ok:true, command:"run '/a b/l.txt'" }`; default token unchanged.
  - `impact-cli.test.js` — a temp git repo fixture (copy the setup helpers style of `tests/bin-lib/verify/cli.test.js`; spawn `plugin/bin/verify.js` as a child) with `src/x.js`, `src/y.js`, `tests/a.test.js`, `tests/b.test.js`, a declaration with `checks.tests.tests` = a `node -e` command that writes `FULL` to a marker file, `impact.command` = a `node -e` command that copies the `{files}` list into the marker file, rule `src/** → impact`, `--integration-branch main`, a map written into the fixture's git common dir at the base commit (`a` reads `src/x.js`, `b` reads `src/y.js`):
    - `selects the subset (AC1.1 report shape)`: modify `src/x.js` on a branch → marker holds exactly `tests/a.test.js`; `report.scope.impact.selected === 1`; `report.durationMs` is a number; stdout matches `/^Impact: 1 of 2 test file\(s\) selected/m`; pass stamp scope `scoped` with `fullSha` = merge-base.
    - `missing map runs full and names it (AC5.1)`: no map → marker `FULL`, `scope.impact.fallback === 'map-missing'`.
    - `stale map (AC5.1)`: `maxAgeCommits: 1`, two commits after the map commit → fallback `map-stale: 2 commits > 1`.
    - `non-ancestor map`: map commit on an unrelated orphan branch → `map-not-ancestor`.
    - `fetch runs once on a problem`: `impact.fetch` = `node -e` that writes a valid map → subset selected and `scope.impact.fetch.ran === true`.
    - `{files} path with a space is quoted`: run with `--log-dir` under a directory containing a space → subset still selected.
    - `no impact block → no scope.impact key` (existing declaration shape).
- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/file-template.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement**: in the `--scope` block, when `decl.impact`: call `changedFiles({ base, withStatus: true })`, filter `statuses` through merge narrowing, `loadImpactContext`, pass `fallbackBase: anchorSha ? null : resolvedBase` (only when `parsed.integrationBranch` named it and no `--base` was given), then for a subset write the list (one path per line) to `{logDir}/impact-files.txt` and build the impact suite's cmd entry with `command: substituteFile(decl.impact.command, listPath, { token: '{files}' }).command` (refused substitution → fall back to the full command with fallback `files-list-unquotable: {reason}`). A `--cmd` of the same name still supplies the full command used on fallback. The H2 required-names check treats the impact suite as satisfied by `decl.impact.command` in subset mode.
- [ ] **Step 4: Run** the two files, then `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/scope.test.js` — Expected: PASS (no regression).
- [ ] **Step 5: Commit** — `Run impact-selected tests from verify.js --scope — subset command, fallback reason, fetch-on-stale`.

### Task 6: Read tracer

**Files:**
- Create: `tools/test-impact/tracer.js`
- Create: `tests/test-impact-tracer.test.js`, `tests/fixtures/test-impact/` (fixture project: `a.test.js`, `b.test.js`, `lib/x.js`, `lib/y.js`, `bin/child.js`, `docs/`)

**Interfaces:**
- Produces: preload contract — active only when `CT_TRACE_ROOT` (realpath of the repo) and `CT_TRACE_DIR` are set; attribution from `CT_TRACE_TEST`, else, when `NODE_TEST_CONTEXT` is set and `process.argv[1]` is under the root, the repo-relative test path (then exported to `process.env.CT_TRACE_TEST`). Unattributed processes patch nothing. Each attributed process appends JSON lines to `{CT_TRACE_DIR}/{pid}-{ms}-{rand}.trace`: first `["T", test]`, then `[kind, relPath]` (`kind` ∈ f,s,d,c) once per unique pair, written immediately with the unpatched `appendFileSync`. `.git/` paths and paths outside the root are dropped. `CT_TRACE_REQUIRE` holds the exact `--require "{abs tracer}"` token; any child_process call with an explicit `env` gets `CT_TRACE_*` and that token appended to its `NODE_OPTIONS`. Wrapped functions copy the original's own property descriptors. The tracer never throws into the host and never calls `process.cwd()` for an absolute path.

- [ ] **Step 1: Write failing tests** in `tests/test-impact-tracer.test.js`; each copies the fixture to a temp dir whose path contains a space, runs `node --test a.test.js b.test.js` there with the trace env (one `spawnSync`), and parses the trace files:
  - `module loads and reads are attributed`: `a.test.js` requires `lib/x.js` and `readFileSync('docs/note.md')` → a's records include `f lib/x.js`, `f docs/note.md`, `f a.test.js`; b's do not.
  - `readdir records a d entry`, `existsSync records s`, `statSync records f`.
  - `child with explicit env is traced (AC2.1 spawn half)`: `b.test.js` runs `spawnSync(process.execPath, ['bin/child.js'], { env: { PATH: process.env.PATH } })` and child reads `lib/y.js` → b's records include `f lib/y.js`.
  - `git content command in the repo records c`: `a.test.js` runs `git ls-files` with `cwd` = fixture root (fixture `git init`ed) → `c ''`; with a path argument `lib` → `c lib` and no `c ''`.
  - `wrapped execFile keeps promisify.custom`: a test awaiting `util.promisify(execFile)(process.execPath, ['-e','console.log(1)'])` gets an object with `stdout`.
  - `absolute path never consults process.cwd`: fixture test chdirs into a temp dir, deletes it, `statSync('/abs/path')` then asserts `process.cwd()` throws.
  - `paths with newline round-trip`: a test reads a fixture file named `we\nird.md` → parsed record equals that name.
  - `unattributed process records nothing`: running a plain `node -e` with the trace env writes no trace file.
- [ ] **Step 2: Run** `node --test tests/test-impact-tracer.test.js` — Expected: FAIL (tracer missing).
- [ ] **Step 3: Implement** `tracer.js` (the spike at the scratchpad proved the approach against the full suite: 15,712 tests passed traced). Wrap: fs `readFileSync readFile openSync open createReadStream copyFileSync copyFile statSync stat lstatSync lstat` → f; `existsSync exists accessSync access realpathSync readlinkSync` → s; `readdirSync readdir opendirSync opendir` → d; `cpSync cp` → d for a directory source else f; same per kind on `fs.promises`; `Module._extensions['.js'|'.json'|'.cjs']` → f; child_process `spawn spawnSync execFile execFileSync exec execSync fork` → env injection, and for non-node commands each existing in-repo path argument → f (file) or c (directory), plus the git rule.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add the test-impact read tracer — NODE_OPTIONS preload attributing reads to test files`.

### Task 7: Map builder, trace/fetch CLI, and run-tests file subset

**Files:**
- Create: `tools/test-impact.js`, `tools/test-impact/build-map.js`
- Modify: `tools/run-tests.js`
- Test: `tests/test-impact-cli.test.js`, `tests/run-tests-isolation.test.js`

**Interfaces:**
- Consumes: Task 2 `encodeImpactMap`, `parseImpactMap`, `DEFAULT_MAP_NAME`; Task 6 trace-file format.
- Produces:
  - `buildMap({ traceDir, commit, exitCode, node, now, fsImpl })` → encoded map (lines that fail to parse are skipped and counted in a returned `skipped` number; a trace file without a `T` header is skipped).
  - `tools/test-impact.js trace [--out <path>] [--allow-dirty]` — refuses a dirty tree (exit 2) unless `--allow-dirty`; runs `node tools/run-tests.js` with `CT_TRACE_ROOT`, `CT_TRACE_DIR` (mkdtemp), `CT_TRACE_REQUIRE`, `NODE_OPTIONS` (existing + require token); writes the map atomically (default `{git-common-dir}/claude-tweaks-test-impact.json`); prints `trace: {n} test file(s), {paths} path(s), suite exit {code} → {out}`; exit 0 when a map was written (suite failures are recorded in `exitCode`), 1 when no trace data was produced.
  - `tools/test-impact.js fetch [--repo owner/name] [--out <path>]` — `gh run list --workflow test-impact-map.yml --branch main --status success --limit 1 --json databaseId,headSha`, `gh run download {id} --name test-impact-map --dir {tmp}`, validates with `parseImpactMap` and `map.commit === headSha`, skips the write when the cached map already has that commit; exit 0 on success/up-to-date, 1 on any failure (message on stderr). `run({ argv, deps })` seam with injectable `gh`, `git`, `fs`, `spawn`.
  - `tools/run-tests.js --files-from <path>`: runs exactly the listed repo-relative files (blank lines ignored); a missing file, a non-`.test.js` entry, or an empty list exits 1 with a message — never zero files to `node --test`. Exported `readFileList(text, { exists })`.

- [ ] **Step 1: Write failing tests**:
  - `run-tests-isolation.test.js`: `readFileList` happy path, empty → throws `/no test files/`, missing → throws naming the file, non-test entry → throws; a spawned `node tools/run-tests.js --files-from {list}` with two fixture files from `tests/fixtures/run-tests/` runs exactly those (stdout `# tests` count) — reuse the existing fixture-probe pattern in that file.
  - `test-impact-cli.test.js`: `buildMap` over hand-written trace files (two processes for one test merge; a header-less file skipped; a corrupt line counted in `skipped`); `trace` refuses a dirty tree (fake git); `fetch` with a fake `gh` writes the map, is a no-op when current, exits 1 on a map whose commit mismatches `headSha`; `trace under a path with a space`: end-to-end `trace --allow-dirty --out {tmp}` against a temp copy of `tests/fixtures/test-impact/` laid out as `tests/*.test.js` with its own minimal `tools/run-tests.js` symlinked/copied, asserting the produced map attributes `lib/x.js` to its test.
- [ ] **Step 2: Run** `node --test tests/test-impact-cli.test.js tests/run-tests-isolation.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add test-impact trace and fetch CLIs and run-tests --files-from — map refresh outside builds`.

### Task 8: Adopt in this repo — declaration, post-merge map job, docs

**Files:**
- Modify: `.claude-tweaks/verify-scope.json`, `tests/verify-scope-declaration.test.js`, `plugin/skills/test/verification.md`, `tests/test-skill-affected-conformance.test.js`, `docs/plugin-structure.md`
- Create: `.github/workflows/test-impact-map.yml`, `plugin/skills/test/impact-selection.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Update tests first**:
  - `verify-scope-declaration.test.js`: the `plugin|tests|tools` loop now asserts `rule.impact === true` for `plugin/**`, `tests/**`, `tools/**`, and `suites === '*'` for `tools/run-tests.js` and `tools/test-impact/**` (they change how every test runs or how the map is built, not what a test reads); `decl.impact.suite === 'tests'`, `decl.impact.command` contains `--files-from {files}`, `decl.impact.fetch` names `tools/test-impact.js fetch`; the skill-prose case now passes an impact context with a fixture map and asserts `mode 'scoped'`, and with no context asserts `impact.fallback === 'map-missing'`.
  - `test-skill-affected-conformance.test.js`: Build Common Step 5 row must state `full` and `impact` (replace the `'always full'` pin with both substrings).
- [ ] **Step 2: Run** both — Expected: FAIL.
- [ ] **Step 3: Implement**:
  - `verify-scope.json`: remove `plugin/skills/**` (now covered by `plugin/**`); rules in order `tools/run-tests.js → "*"`, `tools/test-impact/** → "*"`, `plugin/** → impact`, `tests/** → impact`, `tools/** → impact`, then the existing journeys/bookkeeping rules; `impact: { suite: "tests", command: "node tools/run-tests.js --files-from {files}", tests: ["tests/**/*.test.js", "tools/upstream-drift/tests/**/*.test.js"], maxAgeCommits: 200, fetch: "node tools/test-impact.js fetch" }`.
  - `.github/workflows/test-impact-map.yml`: `on: push (main), workflow_dispatch, pull_request with paths [tools/test-impact/**, tools/test-impact.js, tools/run-tests.js, .github/workflows/test-impact-map.yml]` (the PR trigger proves the job on a real runner before merge); `permissions: contents: read`; ubuntu, node 20, `fetch-depth: 0`, the same git-identity/`GH_TOKEN` env as `test.yml`; step `node tools/test-impact.js trace --allow-dirty --out "$RUNNER_TEMP/test-impact-map.json"`; `actions/upload-artifact@v4` name `test-impact-map`, retention 7 days; header comment explaining it is the refresh path and never a merge gate.
  - `impact-selection.md` (new lazy sub-file): the map format (kinds, `under`, statuses), the rule kind and `impact` block fields, fallback reasons, merge-base anchoring with no stamp, `report.json` `scope.impact` fields and the `Impact:` stdout line, refresh/fetch, and that standalone `/claude-tweaks:test` (no `--scope`) is the explicit full mode.
  - `verification.md`: Build Common Step 5 row → `full (impact-selected via [impact-selection.md](impact-selection.md) when the declaration declares \`impact\`)`; net bytes ≤ +11 — trim equivalent bytes from the same section's prose without changing meaning. Check with `wc -c`.
  - `docs/plugin-structure.md`: add `impact.js` to the `plugin/bin/lib/verify/` line and `test-impact.js`/`test-impact/` to the `tools/` line; add `impact-selection.md` wherever the per-skill sub-file table lists `test/` sub-files.
- [ ] **Step 4: Run** `node --test tests/verify-scope-declaration.test.js tests/test-skill-affected-conformance.test.js` and every test that reads `verification.md`'s size or sub-file citations (`grep -rl "verification.md" tests` — run them) — Expected: PASS.
- [ ] **Step 5: Commit** — `Adopt impact selection for plugin, tests and tools — post-merge map job, documented contract`.

### Task 9: Real-map acceptance check (folded into final verification)

Not a code task — run after Task 8, before Common Step 5:
- [ ] `node tools/test-impact.js trace --allow-dirty` in this worktree → map in the git common dir.
- [ ] AC1.1/AC3.1: with scratch diffs (never committed) touching `plugin/skills/init/claude-md-template.md` + `CLAUDE.md`, and adding `plugin/skills/brand-new/SKILL.md`, run `node plugin/bin/verify.js --scope .claude-tweaks/verify-scope.json --integration-branch main --no-stamp --json {scratch}/r.json --log-dir {scratch}/logs` and record `scope.impact.selected` and `durationMs`. The spike measured 80 selected tests / ~22 s for AC1: 60 tests read every skill file's content and 17 run content-reading git in the repo, so "fewer than 50" is not reachable without dropping real dependencies — log it as `premise reversed` per `_shared/pr-checklist-refresh.md`.
- [ ] AC2.1: `grep -rlE "log-decision(\.js)?" tests tools/upstream-drift/tests` hand-checked list ⊆ the selection for a scratch edit to `plugin/bin/log-decision.js`; record any grep hit not selected and why.
- [ ] Revert the scratch edits; confirm `git status` clean.
- [ ] AC6.1 is a post-merge measurement over the next 20 pipeline runs' `timing.json` — not observable in this build; add an `open` ledger row naming it so wrap-up routes it (a follow-up measurement record), never claims it.
