# Worker Read Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on `permissions.blockReadsOutsideWorkingDirectories` for the driver's implementer worker on sandbox-probed platforms, re-opening only the test command's toolchain through `sandbox.filesystem.allowRead`.

**Architecture:** `roles.js` stays pure: `implementerSettings` gains a validated `readPaths` parameter, and two seam-injected helpers (`toolchainRoot`, `toolchainReadPaths`) derive the readable roots. `worker.js` owns the real seams (PATH walk, `realpath`, first-line read) and derives `readPaths` for every implementer launch on a probed platform when the caller gives none.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T000350-spec-5268/work/5268-spec.md` (record #5268)

**Scope keywords:** blockReadsOutsideWorkingDirectories, allowRead, readPaths, toolchainRoot, additionalDirectories

## Global Constraints

- Probed platforms are `SANDBOX_PROBED_PLATFORMS` (today `['darwin']`). Off them, neither `permissions.blockReadsOutsideWorkingDirectories` nor `sandbox.filesystem.allowRead` is set, and `launchWorker` derives nothing (`readPaths` defaults to `[]`).
- Never `additionalDirectories` or `--add-dir` for any role: "the CLI documentation says those directories also become writable by sandboxed commands."
- `roles.js` stays "Pure data and builders; nothing here spawns a process or touches the file system." Every file-system read the derivation needs is an injected seam; the real seams live in `worker.js`.
- Governing skill `.claude/skills/headless-worker-launch/SKILL.md`, quoted:
  - "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off."
  - "For every command an allow rule admits, list its flags that write a file, read outside the working directory (`git diff --no-index`), run a program (a pager, a configured hook, `-c` config) or reach the network, and probe each one through this module's own launcher. Add a step for the worst one to the opt-in live smoke test in `tests/bin-lib/driver/worker.test.js` (`AC7`, run with `DRIVER_LIVE_SMOKE=1`)"
  - "No code path composes wider rights after a permission denial: a denial goes into the envelope's `denials` for the driver's event line."
  - Anti-pattern: "Copying the probed facts into this skill or another document | They drift from the headers they came from; point at `roles.js` and `worker.js` instead"
- Governing skill `.claude/skills/bin-source-scan-conformance/SKILL.md`: no rule applies — the new code spawns nothing, writes no array literal starting with `'status'`, and compares paths only through `path-guard`'s `isAncestorOrSelf` (no `startsWith(… sep)` idiom).

## Deviation from the spec (logged as a premise reversal)

The spec derives one root from the test command's first word. The driver's real test command is `npm test` (`plugin/bin/lib/driver/steps.js:35`). Probed on this host (2026-11-13): `npm` on `PATH` is `~/.nvm/versions/node/v22.23.2/bin/npm`, whose real path is `…/lib/node_modules/npm/bin/npm-cli.js` (root `…/lib/node_modules/npm`), and that file starts `#!/usr/bin/env node` — the `node` it runs (`…/v22.23.2/bin/node`) lies outside that root, so under the block a different `node` would run or none would. `toolchainRoot` stays exactly as the spec defines it (AC3); `toolchainReadPaths` adds the root of the interpreter the first word's shebang names, one level, and `launchWorker` derives from that. Separately probed: `npm test` runs with an unreadable user config file (exit 0), so the blocked `~/.npmrc` does not stop it.

## Review Focus

1. A test command whose first word is a script run through `#!/usr/bin/env <name>` (npm, npx, pytest in a venv): the interpreter's root is readable too — pinned in Task 2 (`toolchainReadPaths follows an env shebang one level`).
2. A derived root that is the home directory or one of its ancestors (a real binary at `~/bin/x`, root `~`): re-opening it would void the block; use the binary's own directory instead — pinned in Task 2.
3. `PATH` entries that are empty or relative (POSIX treats `''` as the working directory): skipped by the real lookup seam — pinned in Task 3.
4. A seam that throws (`realpath` on a dangling link, an unreadable first line): the part is dropped, never an exception out of the launch — pinned in Task 2.
5. `readPaths` given but not an array (a string `'/opt/tool'`): `TypeError` before anything is written — pinned in Task 1 and Task 3.

---

### Task 1: `implementerSettings` takes `readPaths`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (`implementerSettings`, lines 183-205)
- Test: `tests/bin-lib/driver/roles.test.js` (update the `SANDBOX` constant's consumers; add tests)
- No change: `tests/bin-lib/driver/run.test.js:1406` (calls without `readPaths`; the `[]` default keeps it valid)

**Interfaces:**
- Produces: `implementerSettings({ testCommand, platform, readPaths = [] }) -> settings`. On a probed platform: `settings.permissions.blockReadsOutsideWorkingDirectories === true` and `settings.sandbox.filesystem = { allowRead: [...readPaths] }` (a fresh array). Off probed platforms: neither key. `readPaths` must be an array (`TypeError` naming `readPaths` otherwise) whose every entry is a string that is absolute for the platform (`path.win32.isAbsolute` on `win32`, `path.posix.isAbsolute` elsewhere); a bad entry throws `TypeError` whose message contains `JSON.stringify(entry)`. Validation runs on every platform, before anything is built.

- [ ] **Step 1: Write the failing tests** in `roles.test.js`:
  - `AC1.1: on darwin the read block is on and allowRead deep-equals readPaths` — `implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: ['/opt/tool'] })`: `permissions.blockReadsOutsideWorkingDirectories === true`, `sandbox.filesystem.allowRead` deep-equals `['/opt/tool']`.
  - `AC1.2: on linux neither key is present` — same call with `platform: 'linux'`: `!('blockReadsOutsideWorkingDirectories' in s.permissions)`, `!('sandbox' in s)`; repeat for `win32` with `readPaths: ['C:\\tool']`.
  - `AC2.1: a readPaths entry that is not a string or not absolute throws a TypeError naming it` — for each of `[5, null, 'relative/dir', '', './x']` assert `throws(TypeError)` with `message.includes(JSON.stringify(bad))`; also `readPaths: '/opt/tool'` (not an array) throws `TypeError` matching `/readPaths/`.
  - `AC2.2: an empty readPaths keeps the block on and re-opens nothing` — `readPaths: []` on darwin: block `true`, `allowRead` deep-equals `[]`; and the default (no `readPaths`) equals the `[]` result.
  - `AC5.1: no role's settings or arguments carry additionalDirectories or --add-dir` — for every platform in `['darwin','linux','win32']`, `JSON.stringify(implementerSettings({ testCommand: 'node --test', platform, readPaths: ['/opt/tool'] }))` excludes `additionalDirectories`; for every role in `ROLES`, `composeArgs(...)` excludes `--add-dir`.
  - Update `SANDBOX` in the existing `AC12 … sandbox block` test to include `filesystem: { allowRead: [] }`, and the builders-return-fresh-objects test to assert `a.sandbox.filesystem.allowRead !== b.sandbox.filesystem.allowRead`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/driver/roles.test.js`
  Expected: FAIL — the AC1.1/AC2.x/AC12 tests fail (no `blockReadsOutsideWorkingDirectories`, no `filesystem`).

- [ ] **Step 3: Implement** the `Interfaces` contract in `implementerSettings`. Put `blockReadsOutsideWorkingDirectories: true` in `permissions` after `deny`; put `filesystem: { allowRead: readPaths.slice() }` in the `sandbox` block after `network`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/run.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** `roles.js` and `roles.test.js` — "Turn on the implementer read block with an allowRead list — #5268".

### Task 2: `toolchainRoot` and `toolchainReadPaths`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (new functions after `implementerSettings`; add both to `module.exports`; `require('../path-guard')` for `isAncestorOrSelf`)
- Test: `tests/bin-lib/driver/roles.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `toolchainRoot(command, deps) -> string|null`. `deps = { lookup(name) -> absolute path|null, realpath(p) -> string, home?: string }`. `command`'s first space-separated word: if it contains `/`, absolute → used as the path, relative → `null`; otherwise `deps.lookup(word)` (`null` → `null`). Then `deps.realpath(path)` (a throw → `null`). Root = `path.posix.dirname(dir)` when `path.posix.basename(dir) === 'bin'` (where `dir = path.posix.dirname(real)`), else `dir`. When `deps.home` is given and the root is `isAncestorOrSelf(root, deps.realpath(home))` (a throw there → compare against `home` as given), return `dir` instead.
  - `toolchainReadPaths(testCommand, deps) -> string[]`. `deps` as above plus `firstLine(realPath) -> string`. Returns `[toolchainRoot(testCommand, deps)]`, plus — when `firstLine` of the first word's real path starts with `#!` — the interpreter's root: tokens after `#!` split on whitespace; if the first token's basename is `env`, the interpreter is the first later token not starting with `-`; otherwise the first token. Its root is `toolchainRoot(interpreter, deps)`. One level only (the interpreter's own shebang is not read). `null`s dropped, duplicates dropped, order kept. A throwing `firstLine` adds nothing.

- [ ] **Step 1: Write the failing tests** with fake seams (`lookup` from a map, `realpath` from a map defaulting to identity, `firstLine` from a map defaulting to `''`):
  - `AC3.1: toolchainRoot returns the root above bin, the binary's own directory, or null` — `node` → `/h/.nvm/versions/node/v22/bin/node` gives `/h/.nvm/versions/node/v22`; `node` → `/opt/tools/node` (not in `bin`) gives `/opt/tools`; `lookup` returning `null` gives `null`.
  - `toolchainRoot resolves through realpath` — `npm` → `/h/.nvm/v22/bin/npm`, realpath `/h/.nvm/v22/lib/node_modules/npm/bin/npm-cli.js`: root `/h/.nvm/v22/lib/node_modules/npm`.
  - `toolchainRoot never returns home or an ancestor of it` — `tool` → `/h/bin/tool`, `home: '/h'`: returns `/h/bin`; `home: '/h/x'`, binary `/bin/tool` (root `/`): returns `/bin`.
  - `toolchainRoot takes an absolute first word as the path and refuses a relative one` — `'/opt/t/bin/run --x'` → `/opt/t`; `'./node_modules/.bin/jest'` → `null`, `lookup` never called.
  - `toolchainRoot returns null when realpath throws`.
  - `toolchainReadPaths follows an env shebang one level` — `npm test` with the realpath above and `firstLine` `#!/usr/bin/env node`, `node` → `/h/.nvm/v22/bin/node`: deep-equals `['/h/.nvm/v22/lib/node_modules/npm', '/h/.nvm/v22']`.
  - `toolchainReadPaths follows an absolute shebang and skips env options` — `#!/usr/local/bin/python3` → adds `/usr/local`; `#!/usr/bin/env -S node --flag` → adds node's root.
  - `toolchainReadPaths drops nulls and duplicates, and a throwing firstLine adds nothing` — first word not on PATH → `[]`; shebang interpreter resolving to the same root → one entry; `firstLine` throwing → just the command's root.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/driver/roles.test.js`
  Expected: FAIL — `toolchainRoot is not a function`.

- [ ] **Step 3: Implement** both functions per the `Interfaces` block, with POSIX path functions (`path.posix`), since they run only for probed platforms.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/roles.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — "Derive the test command's toolchain roots for the read block — #5268".

### Task 3: `launchWorker` derives `readPaths`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js` (`launchWorker`, `defaultDeps`; import `toolchainReadPaths`, `SANDBOX_PROBED_PLATFORMS`)
- Test: `tests/bin-lib/driver/worker.test.js` (update the `AC6` settings-text test at line 108; add tests)
- No change: `plugin/bin/lib/driver/steps.js:460` (passes no `readPaths` — the derived default is the intended behavior) and `tests/bin-lib/driver/run.test.js:1216` (its `deepEqual` of the launch options is unchanged).

**Interfaces:**
- Consumes: `implementerSettings({ testCommand, platform, readPaths })` (Task 1), `toolchainReadPaths(testCommand, deps)` (Task 2).
- Produces: `launchWorker` opts gain optional `readPaths`; deps gain optional `toolchain` (`{ lookup, realpath, firstLine, home }`). When `readPaths` is absent and `platform` is in `SANDBOX_PROBED_PLATFORMS` and the role carries settings, `readPaths = toolchainReadPaths(testCommand, deps.toolchain || realToolchainDeps(env))`; otherwise `readPaths` absent → `[]`. Exported `realToolchainDeps(env) -> { lookup, realpath, firstLine, home }`: `lookup(name)` walks `env.PATH` split on `:`, skipping entries that are not absolute, and returns the first `path.join(dir, name)` that is a file with `fs.constants.X_OK` access (any error → next entry, none → `null`); `realpath` is `fs.realpathSync`; `firstLine(p)` reads at most the first 256 bytes and returns the text before the first `\n`; `home` is `env.HOME`.

- [ ] **Step 1: Write the failing tests**:
  - `AC4.1: with no readPaths the settings file's allowRead holds the derived toolchain root, and given readPaths are written exactly` — fake runner; `deps.toolchain` with `lookup` mapping `node` → `/h/.nvm/versions/node/v22/bin/node`, identity `realpath`, `firstLine: () => ''`: `JSON.parse(calls[0].files['--settings'].text).sandbox.filesystem.allowRead` deep-equals `['/h/.nvm/versions/node/v22']`; with `readPaths: ['/opt/a', '/opt/b']` it deep-equals `['/opt/a', '/opt/b']` and `lookup` is never called.
  - `AC2.1: a bad readPaths is refused before anything is written` — `readPaths: ['rel']` and `readPaths: '/opt/tool'`: `launchWorker` rejects with `TypeError`, the runner is never called, `fs.readdirSync(settingsDir)` deep-equals `[]`.
  - `off the probed platforms nothing is derived` — `platform: 'linux'` with a `lookup` that throws if called: resolves `ok`, settings have no `sandbox`.
  - `realToolchainDeps skips relative and empty PATH entries and finds an executable` — temp dir with an executable `tool` (mode `0o755`) and a non-executable `plain`; `env.PATH = ['', 'rel', dir].join(':')`: `lookup('tool')` is `path.join(dir, 'tool')`, `lookup('plain')` and `lookup('missing')` are `null`; `firstLine` of a file `'#!/usr/bin/env node\nrest'` is `'#!/usr/bin/env node'` (skip on `win32`: `{ skip: process.platform === 'win32' && 'POSIX modes' }`).
  - Update the `AC6` test at line 108 to pass `readPaths: []` in `base(t, …)` and compare against `implementerSettings({ testCommand: 'node --test', platform: 'darwin', readPaths: [] })`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/driver/worker.test.js`
  Expected: FAIL — `allowRead` is undefined / `realToolchainDeps is not a function`.

- [ ] **Step 3: Implement** per the `Interfaces` block. Compute `readPaths` before the `implementerSettings` call so validation still precedes `fs.mkdirSync`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/roles.test.js`
  Expected: PASS, 0 failures (the `AC7` live test reports skipped).

- [ ] **Step 5: Commit** — "Derive the implementer's readable toolchain roots at launch — #5268".

### Task 4: Live smoke canary, header and governing-skill row

**Role:** judgment

**Files:**
- Modify: `tests/bin-lib/driver/worker.test.js` (the `AC7` live smoke test, line 768)
- Modify: `plugin/bin/lib/driver/roles.js` header (replace the residual paragraph at lines 103-110 and the read-block paragraph at lines 112-128)
- Modify: `.claude/skills/headless-worker-launch/SKILL.md` (Decision Framework row "Turning on `permissions.blockReadsOutsideWorkingDirectories`", line 57)
- No change: `docs/journeys/launch-a-rights-limited-headless-worker-5217.md` (Common Step 6 owns journeys)

**Interfaces:**
- Consumes: `launchWorker` with derived `readPaths` (Task 3).

- [ ] **Step 1: Extend the `AC7` live smoke test** (`AC6.1` of this spec). Switch its `testCommand` to `'npm test'` — the driver's own command, so the shebang path is exercised — and write into `cwd` a `package.json` (`{"private":true,"scripts":{"test":"node --test"}}`) and `smoke-canary.test.js`. Place a canary file `path.join(os.homedir(), '.driver-smoke-canary-' + crypto.randomBytes(6).toString('hex'))` containing `canary` and remove it in `t.after`. The test file reads the canary path (passed in its source as a JSON string literal) inside `try`, and writes `smoke-canary-result.json` into its own directory with `{ ran: true, version: process.version, readError: <err.code or null>, read: <content or null> }`. Add step (7) to the prompt: `run the bash command: npm test`. Assert: the result file exists (`ran === true` — the test command ran); `read === null` and `readError` is a non-null string (the read failed); `version === process.version` (the toolchain's own `node` ran). Name the test `AC7/AC6.1: live smoke test — …, and the test command cannot read a home-directory canary`.

- [ ] **Step 2: Run the live smoke test** (spends tokens; macOS only):
  Run: `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "live smoke" tests/bin-lib/driver/worker.test.js`
  Expected: PASS. Record the run's date, CLI version (`claude --version`), and the observed `readError` and `version` for Step 3. A failure here is a finding about the design, not a test to loosen: stop and report it.

- [ ] **Step 3: Rewrite the `roles.js` header paragraphs.** The residual paragraph (lines 103-110) no longer says code "can read files outside the working directory": state that on the probed platforms the read block confines reads to the working directory, the derived toolchain roots and the CLI's carve-outs, and keep `git diff --no-index` and the result text as residuals only to the extent the block leaves them. Replace the read-block paragraph (lines 112-128) with the spec's 2026-11-12 probe (CLI 2.1.322, macOS, subscription login, no TTY: canary, home listing, `.zshrc`, `.npmrc`, `~/.ssh` all EPERM with the block and `allowRead` on the toolchain root; same `node` version; toolchain unwritable; `.gitconfig` still openable), the shebang rule and why (`npm` → `npm-cli.js` → `#!/usr/bin/env node`), the home-directory guard, why not `additionalDirectories`/`--add-dir` (writable), and the Step 2 live result with its date and CLI version.

- [ ] **Step 4: Update the governing skill's Decision Framework row** to the turned-on state, pointing at `roles.js` for the facts (no probe values copied): `| Changing which paths the implementer may read | The read block is on; the readable set is the derived toolchain roots (`toolchainReadPaths` in `roles.js`). Never re-open a path through `additionalDirectories` or `--add-dir` — those also become writable. Re-run the `AC7` live smoke test's canary step after any change |`.

- [ ] **Step 5: Run the driver suites**
  Run: `node --test tests/bin-lib/driver/*.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 6: Commit** — "Pin the read block with a live canary and record its probe — #5268".
