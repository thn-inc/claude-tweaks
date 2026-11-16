# Status line spawn-free git reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A status line render in a main checkout or a linked worktree with a plain GitHub `origin` launches exactly one child process — `git --no-optional-locks status --porcelain -b`, no `/bin/sh` — and renders exactly what it rendered before.

**Architecture:** Two filesystem readers in `plugin/bin/claude-tweaks-statusline.js` each return a definite answer or `null` ("ask git"); the existing git call becomes the fallback for every `null`. Every remaining git call moves from `execSync` (shell) to `execFileSync('git', [...])`.

**Tech Stack:** Node 18+ (CommonJS), `node:test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T004054-spec-5266-5294/spec-5266/work/5266-spec.md` (record #5266)

## Global Constraints

- The status line must never throw: every new read sits inside a `try`/`catch` whose failure path is the existing git call (or the existing `null`).
- Every `execFileSync` keeps `windowsHide: true` and `stdio: ['ignore', 'pipe', 'ignore']`, `encoding: 'utf8'` (`tests/windows-hide-spawn-conformance.test.js`).
- `git status` keeps `--no-optional-locks` (`tests/git-status-optional-locks.test.js`) and the existing `// git-path-read: not a path list (branch and dirty flag only)` trailing comment on its call line.
- No `execSync` and no `exec` remain in the file.
- `git rev-parse --git-common-dir` prints the **realpath** of the common dir (probed on git 2.56: a `--relative-paths` worktree and a submodule under macOS `/var` → `/private/var` differ from a plain `path.resolve`). The filesystem reader realpaths the common dir before `path.dirname`.
- Strip a trailing `\r` from every line read from `.git`, `commondir` and `config` (CRLF checkouts).

## Review Focus

- A linked worktree whose `.git` file holds a **relative** `gitdir:` (git `worktree add --relative-paths`) under a symlinked tmpdir — must resolve to the same realpath'd main dir git reports (Task 1 test).
- A submodule checkout (`gitdir: ../.git/modules/sub`, no `commondir` file) — must render the same name git's answer produces (`modules`), not the superproject (Task 1 test).
- `origin` defined only inside an `[include]`d file — the fast path must defer to git, which follows includes (Task 2 test).
- Several `url =` lines under `[remote "origin"]` — `git config --get` returns the **last**; the reader must too (Task 2 test).
- A repo with no `origin` in its local config — must still reach git (global/system config can define it) and render no glyph (Task 2 test).

---

### Task 1: Spawn-free main-checkout resolution

**Review risk:** high

**Files:**
- Modify: `plugin/bin/claude-tweaks-statusline.js:75-96` (`resolveMainProjectDir`), exports block
- Modify: `tests/path-guard-conformance.test.js:111` (the file's `ALLOWLIST` entry: `realpathSync: 1` → `realpathSync: 2`, reason extended)
- Test: `tests/statusline.test.js`

**Interfaces:**
- Produces: `commonDirFromFs(dir: string, env = process.env): string | null` — exported. Returns the realpath of the git common dir for a directory whose `.git` is a **file**, or `null` meaning "ask git".
- `resolveMainProjectDir(dir, opts = {})` — exported. `opts.fast === false` skips `commonDirFromFs` and goes straight to the git call (the test seam Task 3's on/off parity matrix uses); omitted, behaviour is the fast path with git fallback.
- A shared test helper `recordLaunches(fn)` lives in `tests/statusline.test.js` from this task on (Task 3 reuses it): it patches `child_process`'s `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync` with recording wrappers that call through (each record `{ fn, file, args }`, `args` an array or `[]`), deletes the status line module from `require.cache`, re-requires it (so its destructured bindings capture the wrappers), runs `fn(freshModule)` and returns `{ result, launches }`, then restores every original and the cache entry in `finally`.

- [ ] **Step 1: Write the failing tests** in `tests/statusline.test.js`, after the existing linked-worktree test. Add a fixture helper `withWorktrees(fn)` that builds, under one `mkdtemp` base: a main repo with one commit; an absolute linked worktree (`git worktree add -q <wt> -b a`); a `--relative-paths` worktree when git supports the flag (catch the error and pass `null`); a submodule checkout (`git -c protocol.file.allow=always submodule add -q <inner> sub`); and a symlink pointing at the absolute worktree. Clean up with `git worktree remove --force` plus `fs.rmSync` in `finally`. A `gitCommonMain(dir)` test helper returns `path.dirname(fs.realpathSync(path.resolve(dir, <git rev-parse --git-common-dir output>)))`.

Tests:
- `commonDirFromFs: matches git rev-parse --git-common-dir for every worktree shape` — for each of absolute worktree, relative-paths worktree (when present), submodule, symlinked worktree path: `assert.strictEqual(path.dirname(sl.commonDirFromFs(dir)), gitCommonMain(dir))`.
- `resolveMainProjectDir: equals git's answer for every worktree shape` — same four dirs, `assert.strictEqual(sl.resolveMainProjectDir(dir), gitCommonMain(dir))`.
- `commonDirFromFs: GIT_DIR or GIT_COMMON_DIR in the env defers to git` — `assert.strictEqual(sl.commonDirFromFs(wt, { GIT_DIR: '/x' }), null)`, the same for `{ GIT_COMMON_DIR: '/x' }`, and the same for an **empty** value (`{ GIT_DIR: '' }`) — set counts, not non-empty.
- `commonDirFromFs: an unparseable .git file defers to git` — a temp dir whose `.git` file contains `not a gitdir line` → `null`.
- `commonDirFromFs: a gitdir that does not exist defers to git` — `.git` file `gitdir: /nonexistent/x/.git/worktrees/y` → `null`.
- `commonDirFromFs: an unreadable commondir defers to git` — a fake gitdir directory whose `commondir` is itself a directory (EISDIR) → `null`.
- `resolveMainProjectDir: each fallback reaches git` — for the unparseable `.git` file, the missing gitdir and the EISDIR commondir dirs, `recordLaunches` around `resolveMainProjectDir(dir)` records exactly one `{ fn: 'execFileSync', file: 'git', args: ['rev-parse', '--git-common-dir'] }`, and the returned value equals what the base code returns there (`dir`, since git fails on these fakes); for the real absolute worktree it records **no** launch.
- `commonDirFromFs: CRLF .git and commondir files parse the same` — copy the absolute worktree's admin data into a fake gitdir with `\r\n` line endings and a `.git` file ending `\r\n`; result equals `gitCommonMain(wt)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/statusline.test.js`
Expected: FAIL — `sl.commonDirFromFs is not a function` (and `sl.resolveMainProjectDir is not a function`).

- [ ] **Step 3: Implement `commonDirFromFs(dir, env = process.env)`** and route `resolveMainProjectDir` through it.

Rules, in order — any `null` means "ask git": `env.GIT_DIR !== undefined` or `env.GIT_COMMON_DIR !== undefined` (an empty string counts as set) → `null`; read `<dir>/.git` (failure → `null`); first line matching `/^gitdir:\s*(.+?)\s*$/` after stripping `\r` (none → `null`); `gitdir = path.resolve(dir, match)`; read `<gitdir>/commondir`: success → `common = path.resolve(gitdir, content.trim())`, `ENOENT` → `common = gitdir`, any other error → `null`; return `fs.realpathSync(common)` (throws → `null`).

`resolveMainProjectDir(dir, opts = {})`: keep the `.git`-is-a-directory early return; otherwise, unless `opts.fast === false`, `const common = commonDirFromFs(dir); if (common) return path.dirname(common);`, else the existing git fallback, now `execFileSync('git', ['rev-parse', '--git-common-dir'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', cwd: dir, windowsHide: true })` with its existing absolute/relative handling. Add `execFileSync` to the `child_process` require (keep `execSync` until Task 3 removes its last use).

Use plain JS `fs.realpathSync` (never `.native` nor path-guard's `canonicalRealpath`): git's `strbuf_realpath` resolves symlinks but keeps the input's letter case, as JS `realpathSync` does, while `.native`/`canonicalRealpath` return on-disk case and would break parity on a case-insensitive volume. That makes the file's second `realpathSync`, so update `tests/path-guard-conformance.test.js`'s `'claude-tweaks-statusline.js'` entry to `realpathSync: 2` and append to its reason: `; and realpaths the git common dir read from a linked worktree's .git file, to print exactly what git rev-parse --git-common-dir prints (JS realpath keeps input case, as git does); a throw falls back to that git call.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/statusline.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/claude-tweaks-statusline.js tests/statusline.test.js tests/path-guard-conformance.test.js
git commit -m "Resolve the status line's main checkout from .git files — no git spawn for a linked worktree (#5266)"
```

### Task 2: Spawn-free origin URL

**Review risk:** high

**Files:**
- Modify: `plugin/bin/claude-tweaks-statusline.js:116-128` (`readOriginRemote`), exports block
- Test: `tests/statusline.test.js`

**Interfaces:**
- Consumes: Task 1's `recordLaunches` test helper.
- Produces: `originUrlFromConfig(mainDir: string, env = process.env): string | null` — exported. The local config's last `[remote "origin"]` `url` value, or `null` meaning "ask git". `readOriginRemote(dir, opts = {})` keeps its return contract (`string | null`), is now exported, and `opts.fast === false` skips the fs reader (the same test seam as Task 1).

- [ ] **Step 1: Write the failing tests** in `tests/statusline.test.js`, using the existing `withRepo` fixture plus direct edits to `<repo>/.git/config` where a shape `git remote add` cannot produce. A helper `gitOrigin(dir)` returns `git config --get remote.origin.url` trimmed, or `null` on a non-zero exit.

Fast-path tests (assert the fs answer **and** that it equals git's):
- `originUrlFromConfig: plain origin matches git config --get` — `withRepo('git@github.com:owner/repo.git')` → `'git@github.com:owner/repo.git'` and `=== gitOrigin(dir)`.
- `originUrlFromConfig: several url lines — the last wins, as git config --get does` — append `\turl = https://github.com/o/second.git` under the origin section → returns the second, equal to `gitOrigin`.
- `originUrlFromConfig: section and key names are case-insensitive` — rewrite the header to `[Remote "origin"]` and the key to `URL = …` → returns the url, equal to `gitOrigin`.
- `originUrlFromConfig: CRLF config parses the same` — rewrite the config with `\r\n` → same url.

Fallback tests (each asserts `originUrlFromConfig(...) === null` **and** `readOriginRemote(dir) === gitOrigin(dir)`; each fixture is built so that deleting its trigger from the code makes the reader return a **different, non-null** url — so the test goes red):
- `[include] path = extra` placed **after** a local `[remote "origin"] url = https://github.com/o/local.git`, with `extra` setting `url = https://github.com/o/included.git` (git answers `included`; without the include rule the reader would answer `local`).
- value containing `;` (`url = https://github.com/o/r.git;x`) and value containing a backslash (`url = https://github.com/o/r\.git`) — one test each.
- `config` that cannot be read: replace `.git/config` with a directory (EISDIR) — `readOriginRemote` equals `gitOrigin` (git fails too → `null`).
- `[includeIf "gitdir:**"]` section present.
- a `.git/config.worktree` file exists.
- env carries `GIT_CONFIG_GLOBAL` (pass `{ GIT_CONFIG_GLOBAL: '/dev/null' }` to `originUrlFromConfig` only; `readOriginRemote` uses the real env).
- env carries `GIT_DIR`.
- old-style header `[remote.origin]`.
- quoted value `url = "https://github.com/o/r.git"`.
- value containing `#` (`url = https://github.com/o/r.git # note`).
- a line ending in `\` (continuation) anywhere in the file.
- no origin section at all (`withRepo(null)`) — fast path `null`, `readOriginRemote` → `null`.
- `mainDir/.git` is a file, not a directory (use the Task 1 worktree fixture's absolute worktree path as `mainDir`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/statusline.test.js`
Expected: FAIL — `sl.originUrlFromConfig is not a function`.

- [ ] **Step 3: Implement `originUrlFromConfig(mainDir, env = process.env)`** and route `readOriginRemote` through it.

Return `null` when: any env key starting `GIT_CONFIG` or equal to `GIT_DIR` is present (`!== undefined`, an empty string counts); `<mainDir>/.git` is not a directory; `<mainDir>/.git/config.worktree` exists (probe both with `fs.statSync` in `try`/`catch` — never `fs.existsSync`, which `tests/path-guard-conformance.test.js` bans in this file); `<mainDir>/.git/config` cannot be read. Parse line by line (`split(/\r?\n/)`): skip blank lines and lines whose first non-space char is `#` or `;`; any line ending in `\` → `null`. A header line matches `/^\s*\[([^\]]*)\]\s*(.*)$/`; trailing text after `]` → `null`; the inside must match `/^([A-Za-z0-9-]+)(?:\s+"([^"\\]*)")?$/` else `null` (this rejects `[remote.origin]`); a section name (case-insensitive) of `include` or `includeif` → `null`; inside `remote`/`origin` (sub-name case-sensitive), a key line `/^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/` whose key is `url` (case-insensitive): no `=` → `null`; value containing `"`, `\`, `#` or `;` → `null`; otherwise record `value.trim()` (last wins). Any other key/header line that matches neither shape → `null`. End: the last recorded url, or `null` when none.

`readOriginRemote(dir, opts = {})`: unless `opts.fast === false`, `const fast = originUrlFromConfig(dir); if (fast) return fast;` — then the existing git call as `execFileSync('git', ['config', '--get', 'remote.origin.url'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', cwd: dir, windowsHide: true })`, same trim / `|| null` / catch-to-`null`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/statusline.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/claude-tweaks-statusline.js tests/statusline.test.js
git commit -m "Read the status line's origin URL from .git/config, falling back to git when the answer could differ (#5266)"
```

### Task 3: Shell-free status call, the one-spawn pin, and on/off parity

**Review risk:** high

**Files:**
- Modify: `plugin/bin/claude-tweaks-statusline.js:6` (require), `:139-157` (`renderProject` gains `opts`), `:216-230` (`renderGit`)
- Test: `tests/statusline.test.js`
- Test (run only): `tests/windows-hide-spawn-conformance.test.js`, `tests/git-status-optional-locks.test.js`

**Interfaces:**
- Consumes: Tasks 1-2 (`resolveMainProjectDir(dir, opts)`, `readOriginRemote(dir, opts)`, the `recordLaunches` helper).
- Produces: `renderProject(input, fallbackCwd, opts = {})` passes `opts` to both `resolveMainProjectDir` and `readOriginRemote`; `main()` calls it without `opts`.

- [ ] **Step 1: Write the failing tests** in `tests/statusline.test.js`.

`render launches exactly one child process — git status, no shell — in a main checkout and a linked worktree`: for a `withRepo('git@github.com:owner/repo.git')` main checkout and for a linked worktree of it (with the same origin), call `renderProject({ workspace: { project_dir: dir } }, dir)` then `renderGit(dir)` on the fresh module and assert the recorded list deep-equals `[{ fn: 'execFileSync', file: 'git', args: ['--no-optional-locks', 'status', '--porcelain', '-b'] }]`.

`rendered project and git segments are byte-identical with the fast paths on and off, and nothing runs through a shell`: one fixture per repo in the spec's list — main checkout (GitHub origin); linked worktree; submodule checkout; no `origin`; non-GitHub `origin`; `origin` only in an included file; `origin` with a quoted value; detached HEAD; unborn branch; dirty tree; a directory that is not a repo. For each, inside `recordLaunches`, compute `on = m.renderProject(input, dir) + '|' + m.renderGit(dir)` and `off = m.renderProject(input, dir, { fast: false }) + '|' + m.renderGit(dir)` and `assert.strictEqual(on, off, label)`; across every recorded launch of the whole matrix, assert none has `fn` `exec` or `execSync` (this is the AC4 pin, see the logged premise reversal — it covers every fallback path the matrix reaches).

Also add three real-repo `renderGit` render checks beside the existing ones (they pass before and after — they pin the shell-to-argv switch's output): `renderGit: unborn branch renders its name` (`git init -q -b trunk`, no commit → `'trunk'`), `renderGit: detached HEAD renders nothing` (`withRepo(null)` then `git checkout -q --detach` → `null`), `renderGit: a directory that is not a repo renders nothing` (plain `mkdtemp` dir → `null`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/statusline.test.js`
Expected: FAIL — the recorded list holds `{ fn: 'execSync', file: 'git --no-optional-locks status --porcelain -b' }`.

- [ ] **Step 3: Thread `opts` through `renderProject`, and switch `renderGit` to `execFileSync('git', ['--no-optional-locks', 'status', '--porcelain', '-b'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', cwd, windowsHide: true })`** keeping the `// git-path-read: …` comment on the call line, and drop `execSync` from the `child_process` require.

- [ ] **Step 4: Run the suite and the two conformance scans**

Run: `node --test tests/statusline.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/claude-tweaks-statusline.js tests/statusline.test.js
git commit -m "Run the status line's git status without a shell — one child process per render (#5266)"
```

### Task 4: Measure processes per render (no code — the controller runs it, not an implementer)

The preload lives in the controller's session scratchpad; an implementer subagent never runs this task. "Before" figures come from the base commit's copy of the file, not from memory: `git show 671c9a83c:plugin/bin/claude-tweaks-statusline.js` written to a temp file **inside `plugin/bin/`** (so its relative `./lib/...` requires resolve), measured, then deleted.

- [ ] **Step 1:** From the worktree root, render three times each against the main checkout and a linked worktree with the spawn-counting preload — once with the base copy (before), once with the built file (after) — and save the raw output for the PR:

Run: `SPAWN_LOG=<log> node -r /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/83882d73-686e-4d78-b6e2-5a3f5a1fdcb9/scratchpad/count-spawns.js plugin/bin/claude-tweaks-statusline.js <<< '{"cwd":"<dir>","workspace":{"current_dir":"<dir>","project_dir":"<dir>"}}'`
Expected: each render logs exactly one line, `{"fn":"execFileSync","file":"git","args":["--no-optional-locks","status","--porcelain","-b"],"shell":false}` — 2 processes per render (node + git), down from 5 (main) and 7 (linked worktree).
