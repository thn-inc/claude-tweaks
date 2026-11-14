# Impact-Selected Local `npm test` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plain `npm test` on a developer machine runs only the test files the impact map selects for the checkout's changes; the whole suite runs with `--full` or in CI.

**Architecture:** `tools/run-tests.js` gains one pure decision (`resolveRunMode`) over its arguments and environment, one selector (`selectChangedTests`) that calls the selection code `verify.js --scope` already uses, and one pure planner (`planDefaultRun`) that turns a selection into "whole suite", "subset" or "nothing to run" plus the line to print. A selected subset takes the code path `--files-from` already takes. Every caller that needs the whole suite names it with `--full`.

**Tech Stack:** Node (built-in `node --test`), no dependencies. Selection modules: `plugin/bin/lib/verify/{declaration,changed-files,impact,scope}.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T132412-spec-5319-5369-5370/spec-5319/work/5319-spec.md` (record #5319)

**Scope keywords:** `run-tests.js`, `npm test`

## Global Constraints

- Selection uses the modules under `plugin/bin/lib/verify/`. No second selector, and no change to any file under `plugin/`.
- An unknown never selects fewer tests: any reason selection cannot be trusted runs the whole suite and prints the reason.
- A run of zero tests is never silent: it prints one line and exits 0.
- "CI is set" means `typeof env.CI === 'string' && env.CI !== ''`, the rule `resolveConcurrency` already uses.
- The runner must still load when copied beside only `plugin/bin/lib/suite-slot.js` (the fixture layout in `tests/run-tests-isolation.test.js` and `tests/test-impact-cli.test.js`), so the verify modules are required lazily, inside the selector, never at the top of the file.
- All output lines go to stderr with the `run-tests.js: ` prefix, like the runner's existing lines.
- Governing project skills, quoted:
  - `.claude/skills/suite-slot-test-env`: "Build the child env with `slotEnv(dir, extra)` from `tests/helpers/suite-slot-env.js`." and "`withSandbox` in `tests/run-tests-isolation.test.js` predates the helper and strips the same keys inline for `tools/run-tests.js` children." A new test that spawns the runner as a child uses `withSandbox` or `slotEnv`.
  - `.claude/skills/verify-scope-rule-kind`: "Keep a neighbouring path in `tests/verify-scope-declaration.test.js`'s fail-closed list (it holds `.claude-tweaks/verify-scope.json` for this) and run that file before committing." Run that file before committing any change to the declaration.
  - `.claude/skills/windows-checkout-test-parity`: the runner "picks its argv in a pure `buildTestArgs(files, roots, { platform, nodeMajor, concurrency })`". New decisions take `env` and `argv` as parameters and never read `process` inside a pure function.
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #5319` (never a closing keyword).
- Per-task tests: run only the test files the task names. The whole suite runs once for the branch, in CI.

## Review Focus

1. A test file the map selects is deleted in the working tree: the runner must drop it from the list, not hand `node --test` a missing path. (Task 1, `selectChangedTests drops selected files that are not on disk`.)
2. No `origin/main` and no local `main` (a fresh clone of a fork): the run is the whole suite with the reason printed, not a crash. (Task 1, `a base that does not resolve runs the whole suite`.)
3. A corrupt `.claude-tweaks/verify-scope.json`: whole suite with the reason; the exit code is the tests', not the selector's. (Task 1, `an unreadable declaration runs the whole suite`.)
4. `--full` together with `--files-from`: refused with one line and exit 1, since the two contradict. (Task 1, `--full cannot be combined with --files-from`.)
5. `CI=` (set but empty) counts as unset, and `CI=false` counts as set, matching `resolveConcurrency`. (Task 1, `resolveRunMode` table.)

---

### Task 1: The default run selects by impact

**Role:** integration
**Review risk:** high — the mode decision fails closed on computed selection state, and selection (including the declared `fetch`, up to 120 s) runs before the suite slot is taken, so the subset and whole-suite lanes are chosen after it.

**Files:**
- Modify: `tools/run-tests.js`
- Create: `tests/run-tests-default-run.test.js`
- Modify: `tests/run-tests-shard.test.js` (the `extractRunFlags` return-shape pins near line 102)
- Modify: `tests/package-json-test-script.test.js` (the bare spawn near line 185 passes `--full`)
- Modify: `tests/run-tests-isolation.test.js` (one process-level test, beside the `--files-from` process tests)

**Interfaces:**
- Produces, exported from `tools/run-tests.js`:
  - `extractRunFlags(argv)` → `{ rest, shard, recordDurations, full }` (`full` is a boolean; `--full` is removed from `rest`).
  - `resolveRunMode({ rest, shard, recordDurations, full, env })` → `'listed' | 'whole' | 'select'`. `'listed'` when `rest` contains `--files-from`. `'whole'` when `full`, `shard`, `recordDurations !== null`, `rest.length > 0` (explicit roots), or CI is set. Otherwise `'select'`. Throws `Error('--full cannot be combined with --files-from')` when both are present.
  - `selectChangedTests({ repoRoot, deps })` → `{ files: string[] | null, reason: string | null, base: string | null, total: number }`. `files === null` means "run the whole suite" and `reason` says why. `files` is sorted, repo-relative, and holds only paths that exist on disk. `deps` is optional and defaults to the real modules, loaded lazily: `{ readDeclaration, resolveBase, changedFiles, gitLocations, loadImpactContext, lazyImpactContext, selectScope, runFetch, exists, countTests }`. It never throws: any error becomes `{ files: null, reason: 'selection failed: ' + message }`.
  - `planDefaultRun(selection)` → `{ action: 'whole' | 'subset' | 'none', files: string[] | null, line: string }`.
- Lines (exact text; `{base9}` is the first 9 characters of `base`):
  - subset: ``run-tests.js: impact-selected {k} of {n} test files for changes since {base9} — `npm test -- --full` runs the whole suite here; CI runs it on every PR``
  - none: ``run-tests.js: no test file selected for changes since {base9} — nothing to run; `npm test -- --full` runs the whole suite here``
  - whole: `run-tests.js: running the whole suite — impact selection could not narrow it: {reason}`
- A reason is always one line: take the text up to the first line break and trim it before it goes into `reason` (Node's module-not-found message and a failed `git` call's message both span several lines).
- `countTests` defaults to `listTestFiles(repoRoot, DEFAULT_ROOTS).length`, the set `--full` runs.
- Spec AC7 ("one function of the arguments, the environment and the selection result") is met by the pair: `resolveRunMode` decides from arguments and environment whether selection is consulted at all, and `planDefaultRun` decides from the selection result. Both are pure and tested as tables; the main block only composes them.
- Other suites (controller ruling after Task 1's report): the plain run stays the impact suite's files. When the scope result's `suites` is an array naming suites besides the impact suite (this repo: `journeys`, for `docs/journeys/**`), `selectChangedTests` also returns them as `otherSuites: string[]` (sorted; `[]` when there are none and on every whole-suite result), and `planDefaultRun` appends `` — also selected: {names joined by ", "} (run by `verify.js --scope`, not here)`` to the end of the subset line and of the none line. With `otherSuites` empty both lines are byte-identical to the exact lines above. Test `AC4.2: other selected suites are named, never silently dropped`: a `docs/journeys/x.md` change beside `plugin/bin/x.js` gives `otherSuites` `['journeys']` with the same `files` as without it, and a line ending in that suffix; a `docs/journeys/x.md` change alone gives `files` `[]`, action `'none'`, and a line ending in that suffix.
- Reasons: the `fallback` string `selectScope` returns (for example `map-missing`); `superseded by a full-suite rule ({up to three paths, comma-joined})` when `impact.superseded`; `no declaration` when `.claude-tweaks/verify-scope.json` is missing; `the declaration has no impact block`; the declaration's first validation error; the `ChangedFilesError` message when no base resolves.

- [ ] **Step 1: Write the failing tests** in `tests/run-tests-default-run.test.js`

Name each test with the acceptance-criterion clause it covers. Required tests and their assertions:

```js
const { extractRunFlags, resolveRunMode, selectChangedTests, planDefaultRun } = require(path.join(ROOT, 'tools', 'run-tests.js'));

test('AC2.1: --full is a run flag and selects the whole suite', () => {
  assert.deepStrictEqual(extractRunFlags(['--full']), { rest: [], shard: null, recordDurations: null, full: true });
  assert.strictEqual(resolveRunMode({ rest: [], shard: null, recordDurations: null, full: true, env: {} }), 'whole');
});

test('AC2.2 / AC7.1: resolveRunMode table', () => {
  const mode = (over) => resolveRunMode({ rest: [], shard: null, recordDurations: null, full: false, env: {}, ...over });
  assert.strictEqual(mode({}), 'select');
  assert.strictEqual(mode({ env: { CI: '' } }), 'select');
  assert.strictEqual(mode({ env: { CI: 'true' } }), 'whole');
  assert.strictEqual(mode({ env: { CI: 'false' } }), 'whole'); // any non-empty value, as resolveConcurrency reads it
  assert.strictEqual(mode({ shard: { index: 1, total: 4 } }), 'whole');
  assert.strictEqual(mode({ recordDurations: 'out.json' }), 'whole');
  assert.strictEqual(mode({ rest: ['perf'] }), 'whole');
  assert.strictEqual(mode({ rest: ['--files-from', 'list.txt'] }), 'listed');
  assert.throws(() => mode({ full: true, rest: ['--files-from', 'list.txt'] }), /--full cannot be combined with --files-from/);
});
```

Selector tests use injected `deps`. Build a `fakeDeps(over)` helper whose defaults describe a healthy checkout: `readDeclaration` returns `{ ok: true, decl }` with the repo's real declaration (read it with the real `readDeclaration` once at the top of the file), `resolveBase` returns `'a'.repeat(40)`, `changedFiles` returns `{ files: ['plugin/bin/x.js'], statuses: { 'plugin/bin/x.js': 'M' } }`, `gitLocations` returns `{ repoRoot: ROOT, commonDir: ROOT }`, `loadImpactContext` returns a context whose `map` says `tests/one.test.js` content-reads `plugin/bin/x.js` and whose `headTests` are `['tests/one.test.js', 'tests/two.test.js']` (copy the map-building shape from `ctx` in `tests/verify-scope-declaration.test.js`), `lazyImpactContext` and `selectScope` are the real functions, `exists` returns true, `countTests` returns 2.

- `AC1.1: a changed plugin module selects only the test files the map names for it` — result is `{ files: ['tests/one.test.js'], reason: null, base: 'a'.repeat(40), total: 2 }`.
- `AC1.2: a heavy test file is selected only when the map says it reads a changed path` — with `tests/bin-lib/dispatch/queue-pull.test.js` in `headTests` and not a reader of `plugin/bin/x.js`, it is absent from `files`; make it a reader and it is present.
- `AC3.1: a map problem runs the whole suite and names it` — `loadImpactContext` returns `{ map: null, problem: 'map-missing', headTests: [], driftTests: [] }`; result `files === null`, `reason === 'map-missing'`.
- `AC3.2: a path a full-suite rule matches runs the whole suite` — `changedFiles` returns `tools/run-tests.js`; `files === null`, `reason` matches `/^superseded by a full-suite rule \(tools\/run-tests\.js\)$/`.
- `AC3.3: a base that does not resolve runs the whole suite` — `resolveBase` throws the real `ChangedFilesError`-shaped error; `files === null`, `reason` is its message.
- `AC3.4: an unreadable declaration runs the whole suite` — `readDeclaration` returns `{ ok: false, errors: ['verify-scope.json: could not parse JSON: boom'] }`; `reason` is that first error. A missing declaration (`{ ok: true, decl: null, missing: true }`) gives `reason === 'no declaration'`.
- `AC3.5: a thrown error becomes a one-line reason, never an exception` — `changedFiles` throws `new Error('git exploded\nfatal: second line')`; `reason === 'selection failed: git exploded'`, and `planDefaultRun` of that result returns a `line` with no line break.
- `AC4.1: no change selects nothing` — `changedFiles` returns `{ files: [], statuses: {} }`; `files` deep-equals `[]`, `reason === null`.
- `selectChangedTests drops selected files that are not on disk` — `exists` returns false for `tests/one.test.js`; `files` deep-equals `[]`.
- `AC1.3 / AC4.2 / AC3.6: planDefaultRun returns the action and the exact line` — three cases, asserting `line` against the exact strings in Interfaces above (with `base9 === 'aaaaaaaaa'`, `k = 1`, `n = 2`), `action`, and `files`.

Also in this step: update every `extractRunFlags` `deepStrictEqual` pin in `tests/run-tests-shard.test.js` (three, near lines 102 to 104) to include `full: false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/run-tests-default-run.test.js`
Expected: FAIL (the file's imports are `undefined`: `resolveRunMode is not a function`)

- [ ] **Step 3: Implement in `tools/run-tests.js`**

1. `extractRunFlags`: recognise `--full`.
2. `resolveRunMode`, `planDefaultRun`: pure, as specified.
3. `selectChangedTests`: load the real deps inside the function (`require('../plugin/bin/lib/verify/declaration')` and its three siblings); wrap everything in one try/catch. Sequence: read `path.join(repoRoot, '.claude-tweaks', 'verify-scope.json')`; resolve the base with `resolveBase({ integrationBranch: 'main', execImpl })`; `changedFiles({ base, execImpl, withStatus: true })`; build the impact context with `lazyImpactContext(() => loadImpactContext({ decl, ...where, runFetch }))`, using the `map-unlocatable` literal context `verify.js` uses when `gitLocations` returns null; call `selectScope({ decl, files, stamp: null, statuses, impact, fallbackBase: base })`; read `sel.impact`. `execImpl` is `execFileSync` with `cwd: repoRoot` added to its options, so the runner works from any directory. `runFetch` runs the declared command with `spawnSync(command, { shell: true, cwd, timeout: 120000, stdio: 'ignore', windowsHide: true })` and returns `{ ran, exitCode, durationMs, timedOut, signal }`, the shape `runImpactFetch` in `plugin/bin/verify.js` returns; say so in a one-line comment.
4. Main block: after `extractRunFlags`, call `resolveRunMode`. For `'select'`, call `selectChangedTests({ repoRoot: REPO_ROOT })` then `planDefaultRun`, print `line`, and: `'none'` → `process.exit(0)` before any slot is taken; `'subset'` → continue exactly as a `--files-from` run does (`roots = null`, `files` = the selection), so it takes the subset slot lane and the existing Windows command-line fallback; `'whole'` → continue as today. The Windows fallback message currently names `--files-from ${argv[1]}`; make it name the selected subset when there is no list file.
5. Update the header comment: what a bare run does, `--full`, and that `CI` set means the whole suite.
6. Export the four functions.

- [ ] **Step 4: Add the process-level test and pin the existing bare spawn**

In `tests/run-tests-isolation.test.js`, beside the `--files-from` process tests and using the same copied-runner layout (`copyRunner(root)`, a probe fixture under `<root>/tests/`, `withSandbox` env with `CI` deleted): `AC3.7: a bare run that cannot select runs the whole suite and prints why`. Spawn `<root>/tools/run-tests.js` with no arguments. Assert exit 0, the probe ran (its output file exists), and stderr holds a line matching `/^run-tests\.js: running the whole suite — impact selection could not narrow it: /`. Assert too that exactly one stderr line starts with `run-tests.js: running the whole suite`, so a multi-line error message never spills into extra lines. In that layout the verify modules are absent, so this is the selector's failure path running for real.

In `tests/package-json-test-script.test.js`, the bare spawn near line 185 becomes `[ '-r', preload, path.join('tools', 'run-tests.js'), '--full' ]`, so the test keeps exercising the `buildTestArgs` error path whether or not `CI` is set.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/run-tests-default-run.test.js tests/run-tests-shard.test.js tests/package-json-test-script.test.js tests/run-tests-isolation.test.js`
Expected: PASS, 0 failures

- [ ] **Step 6: Prove the new tests can fail**

Temporarily make `resolveRunMode` return `'whole'` for the bare case and confirm `AC2.2 / AC7.1` goes red; temporarily remove the on-disk filter and confirm `selectChangedTests drops selected files that are not on disk` goes red. Restore both and re-run Step 5.

- [ ] **Step 7: Commit**

```bash
git add tools/run-tests.js tests/run-tests-default-run.test.js tests/run-tests-shard.test.js tests/package-json-test-script.test.js tests/run-tests-isolation.test.js
git commit -m "Select by impact on a plain local npm test — --full or CI runs the whole suite, refs #5319"
```

### Task 2: Every whole-suite caller asks for the whole suite

**Files:**
- Modify: `.claude-tweaks/verify-scope.json` (`checks.tests.tests`)
- Modify: `tools/test-impact.js` (the trace spawn near line 194, and the header comment near line 6)
- Modify: `.github/workflows/windows-regression.yml` (the `--cmd tests="npm test"` line near 135)
- Modify: `tests/verify-scope-declaration.test.js`
- Modify: `tests/test-impact-cli.test.js` (the spawned-args pin near line 212)

**Interfaces:**
- Consumes: `--full` from Task 1.
- Produces: `checks.tests.tests === 'node tools/run-tests.js --full'`; the tracer spawns `[path.join(root, 'tools', 'run-tests.js'), '--full']`; the Windows workflow passes `--cmd tests="npm test -- --full"`.

- [ ] **Step 1: Write the failing tests**

In `tests/verify-scope-declaration.test.js`:
- Change both `'npm test'` pins on `r.decl.checks.tests.tests` (near lines 29 and 90) to `'node tools/run-tests.js --full'`. Where the second pin's message says the shards run the suite the declaration names, also assert `pkg.scripts.test === 'node tools/run-tests.js'` (read `package.json`), so the shards (`npm test -- --shard`) and the declaration provably run the same runner.
- Add `AC6.1: every workflow that runs the suite asks for the whole suite`. Read every `*.yml` under `.github/workflows/`. For each line that runs the suite (not a `#` comment line, and matching `/\bnpm test\b(?!:)/` or `/\bnode\s+\S*run-tests\.js/`; a `paths:` entry naming the file and `npm run test:perf` are not suite runs), assert it carries `--shard`, `--full` or `--record-durations`. Assert no workflow file matches `/^\s*CI:\s*(''|""|false)?\s*$/m` or `/\bunset CI\b/`, since the remaining whole-suite callers rely on `CI` being set. Assert the list of suite-running lines found is non-empty, and holds at least `test.yml`'s shard line and `windows-regression.yml`'s `npm test` line, so the scan cannot pass by matching nothing. The tracer is a third suite caller: a line matching `/\bnode\s+\S*test-impact\.js\s+trace\b/` (`test-impact-map.yml`) is a suite run too, and its whole-suite guarantee is not on the workflow line but in `tools/test-impact.js`'s own spawn, so for that line assert instead that `tools/test-impact.js` source contains the `'--full'` argument in its `run-tests.js` spawn (the same argv `tests/test-impact-cli.test.js` pins), and require `test-impact-map.yml` in the non-empty set.

- Add `AC5.1: verify.js's selection still picks a test that reads a changed module, and its full command runs every file`. Using the file's existing `sel(files, ctx)` helper and a context whose map says `tests/bin-lib/dispatch/queue-pull.test.js` content-reads `plugin/bin/lib/dispatch/queue-pull.js`: a change to that module selects that test file (`impact.files` includes it), a change to an unrelated traced module does not, and `r.decl.checks.tests.tests` ends with `--full` while `r.decl.impact.command` still contains `--files-from {files}`.

In `tests/test-impact-cli.test.js`, change the `seen.args` pin near line 212 to `[path.join(dir, 'tools', 'run-tests.js'), '--full']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/verify-scope-declaration.test.js tests/test-impact-cli.test.js`
Expected: FAIL after Step 1 (the three changed pins and `AC6.1` on the Windows workflow line)

- [ ] **Step 3: Make the three changes**

`.claude-tweaks/verify-scope.json`: `"tests": "node tools/run-tests.js --full"` inside `checks.tests`. `tools/test-impact.js`: add `'--full'` to the spawned argv and to the header comment's command. `.github/workflows/windows-regression.yml`: `--cmd tests="npm test -- --full"`. Then grep for other pins of the old values and update each hit that is a live pin, not history:

```bash
git grep -n -F '"npm test"' -- tests tools .github plugin/bin
git grep -n -F "'npm test'" -- tests tools
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/verify-scope-declaration.test.js tests/test-impact-cli.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Check AC5 against the real declaration**

Run: `node plugin/bin/verify.js --changed-files --ignore-stamp --integration-branch main`
Expected: exit 0 and a file list (the declaration still validates and reads). Then confirm `tests/verify-scope-declaration.test.js` already holds a `selectScope` case over this repo's declaration for a changed plugin module (the `sel([...], ctx)` cases near line 150); that case is AC5's pin and it passed in Step 4.

- [ ] **Step 6: Commit**

```bash
git add .claude-tweaks/verify-scope.json tools/test-impact.js .github/workflows/windows-regression.yml tests/verify-scope-declaration.test.js tests/test-impact-cli.test.js
git commit -m "Name the whole suite where it is required — declaration, tracer and Windows workflow pass --full, refs #5319"
```

### Task 3: Docs say what a plain `npm test` runs, and the selector is probed on real input

**Files:**
- Modify: `CLAUDE.md` (the Commands block)
- Modify: `docs/plugin-structure.md` (the `tools/` line near 88 and the `npm test` command line near 145)
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md` (the `npm test resolves its file list` bullet near line 189)

**Interfaces:**
- Consumes: the behavior from Tasks 1 and 2.

- [ ] **Step 1: Sweep for prose that describes the old behavior**

```bash
git grep -n -i -E 'npm test' -- CLAUDE.md README.md docs/plugin-structure.md docs/getting-started.md docs/donts.md docs/releasing.md .claude/skills
```

For each hit, decide whether the sentence claims a plain local `npm test` runs every file. Update those; leave sentences about CI, about `verify.js`'s full command, and about a consumer project's own `npm test`. List in the commit body any hit left unchanged and why.

- [ ] **Step 2: Edit the three files**

`CLAUDE.md` Commands block: the `npm test` line says it runs the impact-selected subset for the checkout's changes locally and the whole suite in CI; add `npm test -- --full` as the whole-suite command. `CLAUDE.md` has a 150-line budget: replace lines, do not add net lines beyond one. `docs/plugin-structure.md`: the same two facts on the `tools/` line and the command line. The skill bullet: a new file under `tests/**` is picked up with no registration step in a whole-suite run, and a plain local run always runs a test file the map does not know.

- [ ] **Step 3: Run the doc-pinning tests**

Run: `node --test tests/package-json-test-script.test.js tests/verify-scope-declaration.test.js`
Expected: PASS, 0 failures. Then find and run any test that reads the edited lines:

```bash
git grep -l -E 'plugin-structure\.md|CLAUDE\.md' -- tests | head -20
```

Run each listed file that asserts on text near the edited lines; all pass.

- [ ] **Step 4: Probe the selector on a real checkout and record the result** (run by the build orchestrator after the implementer's commit, since it reads sibling worktrees and writes the run's decision log)

Write a scratch script outside the repo that requires this worktree's `tools/run-tests.js` and prints `selectChangedTests({ repoRoot })` for a sibling worktree whose branch changed a plugin module (pick one from `git worktree list`; read-only). Compare `files.length` with that worktree's own last `verify.js --scope` report (`{git-dir}/claude-tweaks-verify/report.json`, `scope.impact.selected`) when its `sha` equals that worktree's HEAD; when it does not, compare with a fresh `node plugin/bin/verify.js --changed-files --ignore-stamp --integration-branch main` file list run in that worktree and note that the counts measure different bases. Record one line in the run's decision log:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status SCANNED --step "Task 3 real-input probe" --text "selectChangedTests on {worktree}: {k} of {n} selected, reason {reason}; verify.js report there: {selected} at {sha9}" --reversibility n/a
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/plugin-structure.md .claude/skills/skill-prose-conformance-tests/SKILL.md
git commit -m "Document the impact-selected local npm test — --full names the whole suite, refs #5319"
```
