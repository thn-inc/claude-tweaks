# Superpowers Version Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print one SessionStart inform-tier line when the session's effective superpowers install is older than the version claude-tweaks is verified against. The line names both versions and the update command.

**Architecture:** `selectEntry` moves from `plugin/bin/lib/impeccable-engine/index.js` into a new shared `plugin/bin/lib/installed-plugins.js`, gaining an additive `excludeHome` option. A new `plugin/bin/lib/superpowers-version.js` resolves the effective install, reads the version from the artifact's own `plugin.json`, compares it to a shipped floor constant, and renders the notice. `session-start.js` pushes the line on `startup` or absent `source` only, inside its own best-effort `try`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T144508-spec-3375-3380/spec-3380/work/3380-spec.md`

## Global Constraints

- Floor constant `SUPERPOWERS_FLOOR = '7.0.0'`. It equals `tools/upstream-drift/manifest.yml`'s superpowers `pinned` (re-pinned by #3376, closed). A test pins the two equal.
- Nothing under `plugin/` may `require` from `tools/`. `tests/payload-boundary.test.js` already enforces this.
- The plugins file is `$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json`, defaulting to `~/.claude/plugins/installed_plugins.json` (the `dream-scan.js` resolution: `env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude')`).
- The version is read from `{installPath}/.claude-plugin/plugin.json`'s `version` and never from the metadata `version` field.
- Version grammar `^v?\d+\.\d+\.\d+$`, compared numerically. Anything else is unparsable, which means no notice.
- Only `user` and `project` entries count; `local` and `managed` are ignored.
- Never a stop: no `permissionDecision`, no non-zero exit, no `AskUserQuestion`. Every read is wrapped, and any failure means no notice and no throw.
- The notice is emitted only when the hook payload's `source` is `startup` or absent (not a string).
- There is no notice when no install is found, and none when the effective version is equal to or newer than the floor.
- Commit style: `{Verb} {what} — {detail} (refs #3380)`.

### Probe results (ASSUMPTION Gotcha, verified 2026-10-17 with headless `claude -p` init events)

- **Confirmed:** a project-scope entry applies to its `projectPath` and to every directory below it, including a worktree of that project (memenu-app, memenu-app/docs and a memenu-app worktree all load 6.3.0).
- **Reversed:** a project entry whose `projectPath` is the home directory (6.2.0) never applies. `~`, `~/Code Workspaces` and an ad-hoc dir all load the user-scope 7.0.0. The superpowers resolver therefore skips home-directory project entries (`excludeHome: true`). Impeccable's resolver keeps today's behavior: the option is additive and off by default.
- **Observed, not encoded:** two projects with exact-match project entries (6.2.0 and 6.3.0) loaded user 7.0.0. Both lack `claude-plugins-official` in the project's `extraKnownMarketplaces`, while memenu-app declares it. This is unexplained, so the resolver still matches those entries. The notice describes the stale install, which is true, rather than claiming the session runs it. The module header records this case.

## Review Focus

1. **A home-directory project entry older than user scope.** It must not match. The cwd resolves to the user entry, and there is no notice when user is at or above the floor. Test: Task 2.
2. **The artifact disagrees with the metadata.** Metadata `version: "6.3.0"` with an artifact `plugin.json` at `7.0.0` gives no notice, because the artifact wins. Test: Task 2.
3. **A sibling path prefix.** A project entry for `/x/proj` must not match a cwd of `/x/proj2`. Test: Task 1.
4. **A symlinked cwd or projectPath.** Both sides are realpath-normalised, so a symlink to the project dir still matches. Test: Task 1.
5. **Wrong-shape JSON inside a valid file.** `plugins` is an array or string, an entry list is not an array, or an entry is `null`: return `null` and do not throw. Test: Task 2.

---

### Task 1: Extract `selectEntry` to a shared helper with an opt-in home exclusion

**Files:**
- Create: `plugin/bin/lib/installed-plugins.js`
- Modify: `plugin/bin/lib/impeccable-engine/index.js` (remove local `safeRealpath`/`selectEntry` at lines ~106-151, `require` the shared one)
- Test: `tests/bin-lib/installed-plugins.test.js`

**Interfaces:**
- Produces: `selectEntry(entries, projectPath, deps, opts = {})`. `deps` is `{ realpath(p), homedir() }`, where `homedir` is only read when `opts.excludeHome`. It returns the matched entry object or `null`. Rule: project-scope entries whose realpathed `projectPath` is the realpathed target or an ancestor of it, longest wins with the first-encountered entry winning ties, falling back to the first `scope: 'user'` entry. With `opts.excludeHome: true`, a project entry whose realpathed `projectPath` equals the realpathed `deps.homedir()` is skipped. Entries that are not objects are skipped.
- Also exports `safeRealpath(p, deps)` (realpath, or `p` on throw).

- [ ] **Step 1: Write failing tests** in `tests/bin-lib/installed-plugins.test.js`. Use real temp dirs and `deps = { realpath: fs.realpathSync, homedir: () => home }`.
  - `ancestor-or-self project entry wins over user`: entries `[user@/, project@{proj}]`, target `{proj}/a/b` → the project entry.
  - `longest projectPath wins`: project entries at `{root}` and `{root}/proj`, target `{root}/proj/x` → the `{root}/proj` one.
  - `sibling prefix does not match`: project entry `{root}/proj`, target `{root}/proj2` → the user entry.
  - `symlinked target matches its real project`: symlink `{root}/link → {root}/proj`, target `{root}/link/sub` → the project entry.
  - `no match and no user entry → null`.
  - `local/managed scopes ignored`: an entry `{scope:'local', projectPath: proj}` and target `proj` → user.
  - `excludeHome skips a home-directory entry`: a project entry at `home`, target `{home}/work` → user with `{excludeHome:true}`, and the home entry without it (this pins Impeccable's unchanged default).
  - `non-object entries skipped`: `[null, 'x', user]` → user.
- [ ] **Step 2: Run** `node --test tests/bin-lib/installed-plugins.test.js`. Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `plugin/bin/lib/installed-plugins.js` by moving `safeRealpath` and `selectEntry` from impeccable-engine verbatim, then adding the `opts.excludeHome` skip and the non-object guard. Give it a header comment naming both consumers and the probe ruling for `excludeHome`. In `impeccable-engine/index.js`, replace the two functions with `const { selectEntry } = require('../installed-plugins');`. Its call stays `selectEntry(entries, projectPath, deps)`, with no opts.
- [ ] **Step 4: Run** `node --test tests/bin-lib/installed-plugins.test.js tests/bin-lib/impeccable-engine/*.test.js`. Expected: all pass.
- [ ] **Step 5: Commit** `Extract selectEntry into a shared installed-plugins helper — opt-in excludeHome for resolvers whose host never applies a home-directory project entry (refs #3380)`

### Task 2: `superpowers-version.js` — effective version, comparison, notice text, floor parity

**Files:**
- Create: `plugin/bin/lib/superpowers-version.js`
- Test: `tests/bin-lib/superpowers-version.test.js`

**Interfaces:**
- Consumes: `selectEntry` from Task 1.
- Produces:
  - `SUPERPOWERS_FLOOR` — the string `'7.0.0'`. A comment beside it says: the last verified pin in `tools/upstream-drift/manifest.yml`; a future superpowers re-pin deliberately raises the notice threshold for every project still on the previous version; and the parity test lives in `tests/bin-lib/superpowers-version.test.js`.
  - `parseVersion(s) -> [major, minor, patch] | null` — strict grammar `^v?(\d+)\.(\d+)\.(\d+)$`; non-strings → `null`.
  - `isOlder(a, b) -> boolean` — true only when both parse and `a < b` numerically.
  - `effectiveSuperpowersVersion(projectDir, overrides = {}) -> { version, scope, marketplace, projectPath, installPath } | null`. `deps = { ...defaultDeps(), ...overrides }`, with `defaultDeps()` returning `{ readFile: (p) => fs.readFileSync(p, 'utf8'), realpath: fs.realpathSync, homedir: os.homedir, env: process.env }`.
    1. The plugins file is `path.join(deps.env.CLAUDE_CONFIG_DIR || path.join(deps.homedir(), '.claude'), 'plugins', 'installed_plugins.json')`.
    2. Gather every key matching `/^superpowers@(.+)$/` whose value is an array, tag each object entry with its marketplace, and keep only the `user` and `project` scopes.
    3. Sort by `lastUpdated` descending, so equal-length matches resolve to the latest.
    4. Call `selectEntry(flat, projectDir, deps, { excludeHome: true })`.
    5. Read `{installPath}/.claude-plugin/plugin.json`, and return `version` only when `parseVersion` accepts it.
    6. Wrap the whole body in `try { … } catch { return null; }`.
  - `superpowersNotice({ effective, floor, projectDir }) -> string | null` — `null` unless `effective` is set and `isOlder(effective.version, floor)`. Exact copy (the `{…}` parts are fields):
    `claude-tweaks: superpowers {version} is older than {floor}, the version claude-tweaks is verified against — update with: claude plugin update superpowers@{marketplace} --scope {scope}{SUFFIX}; if it reports already at the latest, run claude plugin marketplace update {marketplace} first`
    `{SUFFIX}` is ` (run from {projectPath}, the project this install belongs to)` when `scope === 'project'` and the realpathed `projectPath` differs from the realpathed `projectDir`; otherwise it is empty.
- The module header records: the probe results above (confirmed, reversed, observed-not-encoded); the placement choice (SessionStart inform tier, because it already assembles inform-tier banners and has the cwd, and one small synchronous read fits the inline block); and that "effective" means installed with a readable artifact, with `enabledPlugins` not consulted.

- [ ] **Step 1: Write failing tests** in `tests/bin-lib/superpowers-version.test.js`. Use a fixture helper `mkConfig({ plugins, artifacts })`. It writes `{tmp}/config/plugins/installed_plugins.json`, writes `{tmp}/inst/{name}/.claude-plugin/plugin.json` for each artifact, and returns `{ deps: { env: { CLAUDE_CONFIG_DIR: … }, homedir: () => fakeHome }, … }`. Tests:
  - **AC1.1** `older-than-floor emits`: user 7.0.0 plus project 6.3.0 for `proj`, cwd `proj` → `effective.version === '6.3.0'`. The notice includes `6.3.0`, `7.0.0`, `claude plugin update superpowers@claude-plugins-official --scope project`, and no `run from`.
  - **AC2.1** `equal → null`, `newer (7.1.0) → null`.
  - **AC2.1** `user-only 7.0.0 → effective user, notice null`. Also user 6.3.0 only → the notice says `--scope user`.
  - `none installed` (no key, or a missing file) → `null`.
  - **AC2.2** `ancestor entry`: cwd `proj/sub/deep` → the project entry. The notice includes `run from {proj}`.
  - **AC2.2/AC2.3** `worktree with no entry of its own`: cwd `proj/.claude/worktrees/w1` → the proj entry. A worktree outside `proj` with no ancestor resolves to user (AC2.3).
  - `project overrides user` (project 6.3.0, user 7.0.0) is covered by AC1. Add the reverse: project 7.0.0, user 6.3.0 → no notice.
  - `home-directory project entry ignored` (Review Focus 1): a project 6.2.0 entry at `fakeHome`, with cwd `{fakeHome}/work` → user 7.0.0, notice null.
  - `artifact wins over metadata` (Review Focus 2).
  - `two marketplaces`: `superpowers@a` user 7.0.0 and `superpowers@b` project 6.3.0 for cwd → the marketplace is `b` and the notice names `superpowers@b`. Two user entries across keys → the later `lastUpdated` wins.
  - `CLAUDE_CONFIG_DIR override`: a file only under the override dir is read, and a file only under `{fakeHome}/.claude` is ignored. With `env: {}`, the `{fakeHome}/.claude` file is read.
  - **AC3.1** `malformed`: an empty file, non-JSON, `plugins: []`, `plugins: 'x'`, and an entry list that is `{}` → `null`, with no throw (Review Focus 5).
  - **AC3.1** `unreadable installPath`: a missing dir, or `plugin.json` that is not JSON → `null`.
  - **AC4.1/AC4.2** `numeric compare`: `isOlder('6.10.0','6.9.0') === false` and `isOlder('6.9.0','6.10.0') === true` (AC4.1). `parseVersion('v7.0.0')` → `[7,0,0]`. `7.0.0-rc.1`, `7.0.0+build`, `7.0` and `''` → `null`. A `plugin.json` at `7.0.0-rc.1`, and one at `7.0.0+build`, each give a `null` notice (AC4.2).
  - **AC5.1/AC5.2** `floor parity`: `SUPERPOWERS_FLOOR === loadManifest(path.join(ROOT,'tools','upstream-drift','manifest.yml')).dependencies.find((d) => d.name === 'superpowers').pinned`. It is an equality between two independent sources, so changing either alone turns it red (AC5.2).
- [ ] **Step 2: Run** `node --test tests/bin-lib/superpowers-version.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `plugin/bin/lib/superpowers-version.js` to the Interfaces above.
- [ ] **Step 4: Run** `node --test tests/bin-lib/superpowers-version.test.js tests/payload-boundary.test.js`. Expected: all pass.
- [ ] **Step 5: Commit** `Add superpowers-version resolver — effective install by scope, artifact-read version, strict semver, notice text and floor pinned to the drift manifest (refs #3380)`

### Task 3: Wire the notice into SessionStart, isolate existing tests, document

**Files:**
- Modify: `plugin/bin/lib/hooks/session-start.js` (a new `try` block directly after the `resolveBuildLine` block, ~line 106)
- Modify: `tests/hooks-session-start.test.js` (all 49 `sessionStart.run(` calls)
- Modify: `docs/hooks.md` (a new inform-tier bullet after the `worktree-always` verdict banner bullet)
- Modify: `.claude/skills/upstream-repin/SKILL.md` (one line in the `superpowers` paragraph, ~line 43)
- Modify: `docs/plugin-structure.md` (one line each for `installed-plugins.js` and `superpowers-version.js`, beside the `impeccable-engine/` entry, ~line 63)

**Interfaces:**
- Consumes: `effectiveSuperpowersVersion`, `superpowersNotice` and `SUPERPOWERS_FLOOR` from Task 2.
- Produces: the optional `ctx.superpowersDeps` override (passed through as `effectiveSuperpowersVersion`'s `overrides`). `bin/hooks.js` never sets it.

- [ ] **Step 1: Isolate existing tests.** In `tests/hooks-session-start.test.js`, add `const NO_INSTALL = { readFile: () => { throw Object.assign(new Error('no install (test)'), { code: 'ENOENT' }); } };` and `const runSessionStart = (ctx) => sessionStart.run({ superpowersDeps: NO_INSTALL, ...ctx });`. Replace every `sessionStart.run(` call with `runSessionStart(`, then confirm `grep -c "sessionStart.run(" tests/hooks-session-start.test.js` prints `1` (the helper itself).
- [ ] **Step 2: Write failing tests** in the same file, using a fixture written to a temp `CLAUDE_CONFIG_DIR` and passed as `superpowersDeps: { env: { CLAUDE_CONFIG_DIR }, homedir: () => fakeHome }`:
  - **AC1.1** `#3380: startup emits the superpowers notice once`: `input: { source: 'startup' }` with a project 6.3.0 entry for `project` → `additionalContext` matches `/superpowers 6\.3\.0 is older than 7\.0\.0/` exactly once.
  - **AC6.1/AC6.2** `#3380: absent source emits; resume/clear/compact do not`: `input: {}` emits. Each of `resume`, `clear` and `compact` gives an `additionalContext` with no `superpowers 6.3.0` (AC6.1); `startup` emits (AC6.2, with the test above).
  - **AC2.1/AC3.1** `#3380: no-notice cases leave output byte-identical`: for user-only 7.0.0, a malformed file and an unreadable installPath, the `out.json` JSON string equals the one produced with `NO_INSTALL`.
  - `#3380: garbage input does not throw`: `input: '%%%'` and `input: null` → `run` resolves with `additionalContext` present.
  - **AC7.1** `#3380: the notice is inform-only`: in the emitting case, `out.json.hookSpecificOutput` has no `permissionDecision` key and `out.exitCode` is undefined. The `plugin/` → `tools/` import ban is already enforced by `tests/payload-boundary.test.js`, which Step 6 runs.
- [ ] **Step 3: Run** `node --test tests/hooks-session-start.test.js`. Expected: the four new tests FAIL; all existing tests pass.
- [ ] **Step 4: Implement the block** in `session-start.js`, in its own `try { … } catch { /* best-effort */ }`, following the file's comment style (cite #3380). Compute `const source = ctx.input && typeof ctx.input === 'object' ? ctx.input.source : undefined;` and proceed only when `typeof source !== 'string' || source === 'startup'`. Then push `superpowersNotice({ effective: effectiveSuperpowersVersion(ctx.cwd, ctx.superpowersDeps), floor: SUPERPOWERS_FLOOR, projectDir: ctx.cwd })` when it is non-null.
- [ ] **Step 5: Docs.**
  - **`docs/hooks.md`:** add a bullet `**Superpowers version notice (inform tier, #3380):**`. It names `plugin/bin/lib/superpowers-version.js`. It says the line fires on `startup` or absent `source` only, that it is silent when nothing is installed, when the install is at or above the floor, or on any read failure, and why SessionStart was chosen over `/claude-tweaks:help`.
  - **`upstream-repin/SKILL.md`:** add one sentence: re-pinning `superpowers` also moves `SUPERPOWERS_FLOOR` in `plugin/bin/lib/superpowers-version.js` (the parity test fails until it does), and that deliberately raises the SessionStart notice threshold for every project still on the previous version.
  - **`plugin-structure.md`:** add the two module lines.
- [ ] **Step 6: Run** `node --test tests/hooks-session-start.test.js tests/hooks-dispatcher.test.js tests/bin-lib/superpowers-version.test.js tests/bin-lib/installed-plugins.test.js tests/payload-boundary.test.js`. Expected: all pass, including `invariant: every event exits 0 on garbage stdin` (AC8.1, whose full `npm test` half runs at /build's verify step).

Waived AC1.2: informational, not a behavior. #3376 has closed and the manifest pins 7.0.0, so the shipped floor is already 7.0.0.

Waived AC8.1: this is a suite-level gate, not a per-task test. /build's verify step runs the full `npm test` (this step runs its dispatcher half). Its "never reads the real plugins file" half is Task 3 Step 1's `NO_INSTALL` injection.
- [ ] **Step 7: Commit** `Surface the superpowers version notice at SessionStart — startup-only inform line, existing tests isolated from the real plugins file, docs and re-pin note (refs #3380)`
