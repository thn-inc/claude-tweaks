# Installed-plugins first-applicable rule Implementation Plan (#3541)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `selectEntry` pick the `installed_plugins.json` record Claude Code itself loads — the first applicable record in file order — so `resolve()` and `effectiveSuperpowersVersion` report what a session actually runs.

**Architecture:** `selectEntry` becomes one `find` over the records with an `applies(entry)` predicate (user/managed scope, exact realpath match, or same canonical git root). A new `canonicalGitRoot` walks up to the nearest `.git` through injected `deps.readFile` only (a directory `.git` surfaces as an `EISDIR` throw, so no new fs token). Both callers drop `excludeHome`; the superpowers resolver stops sorting by `lastUpdated`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T170937-spec-3541-3543-3585/spec-3541/work/3541-spec.md`

**Scope keywords:** excludeHome, selectEntry

## Global Constraints

- The rule source is Claude Code **2.1.302** (minified `QP`/`gJt`/`ZI`); the probe date is **2026-10-19**.
- Array order is `installed_plugins.json` file order — never sort the records, never iterate them through a structure that loses order.
- A stale record (its worktree dir deleted) still matches through its main checkout — never filter out missing paths.
- `FAILURE_REASONS` in `impeccable-engine/index.js` stays byte-identical.
- No new `realpathSync`/`existsSync` token in `plugin/bin/lib/installed-plugins.js` (`tests/path-guard-conformance.test.js`); every filesystem read goes through injected `deps`. `installed-plugins.js` must keep requiring `./path-guard` (AC2.1 of that suite).
- After this change `git grep -n excludeHome -- plugin/` prints nothing.
- Commit messages: `{Verb} {what} — {detail}` style, end with `refs #3541` (never closes/fixes) and the `Claude-Session:` trailer the dispatcher gives you.

## Review Focus

1. A `.git` **file** whose `gitdir:` is relative (`gitdir: ../.git/worktrees/w`) — resolve against the directory holding the `.git` file. Test in Task 1.
2. A `commondir` file with a trailing newline and a relative value (`../..`, git's normal form) — trim, resolve against the gitdir. Test in Task 1 (the linked-worktree fixture writes exactly that).
3. A `.git` file whose gitdir has **no** `commondir` (submodule shape) — the directory itself is the root, no throw. Test in Task 1.
4. A session in a **subdirectory** of a git checkout with a record for the checkout root — applies (same canonical root). Test in Task 1.
5. `deps` with no `readFile` (the characterization suite's `{ realpath }`-only deps) — `canonicalGitRoot` returns `null`, exact-path matching still works, nothing throws. Test in Task 1.

---

### Task 1: `selectEntry` first-applicable rule + `canonicalGitRoot`

**Files:**
- Modify: `plugin/bin/lib/installed-plugins.js` (header lines 1-20, `selectEntry` lines 54-81, exports line 83)
- Test: `tests/bin-lib/installed-plugins.test.js`
- Test: `tests/bin-lib/path-guard/callers-characterization.test.js` (lines 211-261, the installed-plugins block)
- Modify: `docs/plugin-structure.md` (line 66, the `installed-plugins.js` row)

**Interfaces:**
- Produces: `selectEntry(entries: Array, projectPath: string, deps: { realpath?, readFile? }) -> entry | null` (the 4th `opts` parameter is removed); `canonicalGitRoot(p: string, deps: { realpath?, readFile? }) -> string | null` (exported); `module.exports = { readInstalledPlugins, selectEntry, safeRealpath, canonicalGitRoot }`.
- Consumers (Consumer-enumeration check — both **pick-one**, an ordering rule suffices): `impeccable-engine/index.js:163` (`resolve`), `superpowers-version.js:101` (`effectiveSuperpowersVersion`). Sole-site grep: `git grep -n "selectEntry(" -- plugin/` → those two lines plus the definition.

- [ ] **Step 1: Write the failing tests** — replace the old ancestor / longest-path / excludeHome / "local and managed are ignored" tests in `tests/bin-lib/installed-plugins.test.js` (keep the `readInstalledPlugins` tests, the symlink tests rewritten to exact-path, and the non-object test). Real temp dirs (`fs.realpathSync(fs.mkdtempSync(...))`), deps `{ realpath: fs.realpathSync, readFile: (p) => fs.readFileSync(p, 'utf8') }`. A helper `gitCheckout(dir)` does `fs.mkdirSync(path.join(dir, '.git'), { recursive: true })`; `linkedWorktree(main, wt)` writes `wt/.git` = `gitdir: ${main}/.git/worktrees/w\n` and `main/.git/worktrees/w/commondir` = `../..\n`. Tests (names carry the AC ids):
  - `AC1.1: file order decides — [user, project(P)] -> user; [project(P), user] -> project(P)`.
  - `AC2.1: a record for a deleted worktree of P still matches a session at P through the main checkout` — `P` a git checkout, `A = project(P/.claude/worktrees/w)` (path never created), `B = user`, `C = project(P)`; `selectEntry([A, B, C], P, deps) === A`.
  - `AC3.1: a session in a linked worktree W of P selects a project(P) record listed before the user record`.
  - `AC4.1/AC4.2: a non-git folder F record applies at exactly F, not at F/sub (null with no other record)` — precondition `assert.equal(canonicalGitRoot(F, deps), null)` (skip via `t.skip` if the tmpdir sits inside a git checkout).
  - `AC5.1/AC5.2: a managed record applies anywhere; a local record applies at its own path` — `selectEntry([managed], anyDir) === managed`; `selectEntry([local(P)], P) === local`; `selectEntry([local(P)], other) === null`.
  - `AC6.1: canonicalGitRoot returns null when no ancestor holds a .git`.
  - Review Focus 1-4: relative `gitdir:` resolves; `commondir` with trailing newline resolves to the main checkout; a `.git` file with no `commondir` returns that directory; a session at `P/sub` (git checkout `P`) matches `project(P)`.
  - Symlinks: a symlinked session path and a symlinked `projectPath` both still match exactly (realpath both sides).
  - Non-object entries skipped: `selectEntry([null, 'x', user], P) === user`.
  - `AC11.1: the installed-plugins.js header names Claude Code 2.1.302, the first-applicable-in-file-order rule, and the 2026-10-19 probe` — read the module source, take the leading comment block (lines before the first `require`), assert it includes `2.1.302`, `2026-10-19`, and `file order`, and does not include `excludeHome`.

  In `callers-characterization.test.js` replace the `'ancestor, self, longest-wins…'`, `'excludeHome skips…'` and `'"..foo" counts as contained (#3417)'` tests with: `'installed-plugins: without deps.readFile only exact paths match, in file order'` — `{ realpath: ident }` deps: `selectEntry([entryAt('/work'), entryAt('/work/app')], '/work/app', deps)` is the `/work/app` entry, `selectEntry([entryAt('/work')], '/work/app', deps) === null`, `canonicalGitRoot('/work', deps) === null` (Review Focus 5). Rewrite the stale-projectPath test: a throwing realpath still compares lexically — `selectEntry([e('/stale')], '/stale', { realpath: boom }) === e`, `selectEntry([e('/stale')], '/other', …) === null`. Keep both `safeRealpath` tests unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/installed-plugins.test.js tests/bin-lib/path-guard/callers-characterization.test.js`
Expected: FAIL after Step 1 (`canonicalGitRoot is not a function`, and AC1.1's `[user, project(P)]` returns `project(P)`)

- [ ] **Step 3: Implement in `plugin/bin/lib/installed-plugins.js`**

`canonicalGitRoot(p, deps)` — return `null` when `typeof p !== 'string'` or `typeof deps?.readFile !== 'function'`. Algorithm:

```
dir = path.resolve(safeRealpath(p, deps))
loop:
  try text = deps.readFile(path.join(dir, '.git'))
  catch err:
    if err && err.code === 'EISDIR' -> return safeRealpath(dir, deps)      // .git is a directory
    parent = path.dirname(dir); if parent === dir -> return null; dir = parent; continue   // ENOENT/ENOTDIR/other: walk on, through missing components
  m = /^gitdir:\s*(.+?)\s*$/m on the text's first line; no match -> return safeRealpath(dir, deps)
  gitdir = path.resolve(dir, m[1])
  try common = String(deps.readFile(path.join(gitdir, 'commondir'))).trim() catch -> return safeRealpath(dir, deps)
  commonDir = path.resolve(gitdir, common)
  return safeRealpath(path.basename(commonDir) === '.git' ? path.dirname(commonDir) : dir, deps)
```

`selectEntry(entries, projectPath, deps)` — `target = safeRealpath(projectPath, deps)`; a `Map` local to this call memoizes `canonicalGitRoot` by input path; `applies(e)`: object entry; `scope` `user`/`managed` → true; else needs a string `projectPath` and either `safeRealpath(e.projectPath) === target` or both canonical roots non-null and equal. Return `entries.find(applies) || null`. Drop the `isAncestorOrSelf` import (keep `canonicalRealpath` from `./path-guard`).

Header (replace lines 1-20): state the rule (first applicable record in array order; the three applicability conditions; scope not ranked), name Claude Code 2.1.302 and the 2026-10-19 probe with its three observations from the spec's "Probe, 2026-10-19" bullets (impeccable user 4.6.0 first; superpowers synology-nas reaching user 7.0.0 at index 1; claude-tweaks memenu-app loading 6.113.0 from a deleted worktree record), note home-directory records lose only by order, the Windows second pass (gh-74612) is out of scope, and that a future Claude Code release can change the rule — re-probe against `npx`-pinned builds. Drop every "Why excludeHome exists" / "Observed, not encoded" sentence.

`docs/plugin-structure.md` line 66: replace the selectEntry parenthetical with the new rule (first applicable record in file order: user/managed scope, exact path, or same canonical git root via canonicalGitRoot; Claude Code 2.1.302, #3541) and add `canonicalGitRoot` to the export list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/installed-plugins.test.js tests/bin-lib/path-guard/callers-characterization.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `git add` the four files by name; message `Rewrite selectEntry to Claude Code's first-applicable rule — canonicalGitRoot, refs #3541`.

### Task 2: Impeccable `resolve()` — drop `excludeHome`, `not-installed` detail

**Files:**
- Modify: `plugin/bin/lib/impeccable-engine/index.js` (header lines 11-26, `resolve` lines 161-166)
- Test: `tests/bin-lib/impeccable-engine/resolve.test.js` (`fakeDeps` lines 15-25, AC3a 55-65, AC3d 88-98, AC6.1 198-206)
- Modify: `plugin/skills/design-wrapper/impeccable-plugin.md` (line 54, the `scope` clause — 22,122 B, far under the 52,500 B rail)
- Modify: `docs/plugin-structure.md` (line 65, the impeccable-engine row's selection parenthetical)

**Interfaces:**
- Consumes: `selectEntry(entries, projectPath, deps)` from Task 1 (3 args).
- Produces: `resolve()` `{ ok: false, reason: 'not-installed', fix: NOT_INSTALLED_FIX, detail }` when the key has ≥1 record and none applies; the existing no-record and read-failure shapes are unchanged.

- [ ] **Step 1: Write the failing tests** in `resolve.test.js`:
  - Change `fakeDeps`' default `readFile` to return the JSON only for a path ending `installed_plugins.json` and throw `Object.assign(new Error('ENOENT'), { code: 'ENOENT' })` otherwise, so the git walk finds no `.git` in fake paths.
  - Rename AC3a to `'a project-scope entry listed before the user entry wins (file order)'` (assertions unchanged).
  - Replace AC3d with `'a project entry for an ancestor path does not apply below it -> user'` — entries `[project('/repo'), user]`, `projectPath: '/repo/sub'` → `pluginRoot === '/path/user'`.
  - Replace the old `AC6.1` home test with `'a home-directory project entry listed after the user entry loses by file order'`.
  - `AC7.1/AC7.2: memenu-app fixture — [user 4.6.0, memenu-app 3.0.6] selects the 4.6.0 install, not upgrade-required` — real temp dirs: a config dir holding `installed_plugins.json`, two install dirs each with `skills/impeccable/scripts/impeccable` (use `launcherFor`) and `.claude-plugin/plugin.json`, a `memenu-app` project dir; deps `{ ...fakeDeps(), readFile: readReal, exists: fs.existsSync, env: { CLAUDE_CONFIG_DIR: cfg }, realpath: fs.realpathSync }`; assert `ok === true`, `pluginRoot === user4_6_0Dir`, `pluginVersion === '4.6.0'`, `scope === 'user'`.
  - `AC8.1: records present but none applies -> not-installed with fix and a detail naming the count` — entries `[project('/a'), project('/b'), project('/c')]`, `projectPath: '/repo'` → `reason === 'not-installed'`, `fix.startsWith('/plugin install impeccable@impeccable')`, `detail` matches `/^3 install records for impeccable@impeccable, none applies to \/repo /` and includes `no user or managed record`.
  - `AC8.2: FAILURE_REASONS is unchanged` — `assert.deepStrictEqual([...FAILURE_REASONS], ['not-installed','upgrade-required','engine-not-installed','shape-mismatch','exec-failed','timeout'])` and `Object.isFrozen(FAILURE_REASONS)` (import `FAILURE_REASONS`).
  - AC4a (`entries: []`) keeps asserting no `detail` is required; add `assert.strictEqual(out.detail, undefined)` there so the empty case is distinguished.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/impeccable-engine/resolve.test.js`
Expected: FAIL after Step 1 (AC8.1 has no `detail`)

- [ ] **Step 3: Implement** — `resolve()` calls `selectEntry(entries, projectPath, deps)`. In the `!entry` branch, when `Array.isArray(entries) && entries.length > 0`, add `detail`: `` `${n} install record${n === 1 ? '' : 's'} for impeccable@impeccable, none applies to ${projectPath} (${scopes} records for other paths; no user or managed record)` `` where `scopes` is the distinct string `scope` values of the object entries joined with `/` (omit the `${scopes} records for other paths; ` part when there are none). Rewrite the header's "ASSUMPTION resolution" paragraph (lines 11-26): drop the ancestor-or-equal + longest-match description and point at `installed-plugins.js`'s first-applicable rule (worktree records still match: a session matches a record for its own path or for any checkout of the same repository). `impeccable-plugin.md` line 54: replace `` `scope` is `"project"` or `"user"` (a project-scope entry wins over the user-scope install when both exist for this working directory) `` with `` `scope` is the selected record's scope (`"user"`, `"project"`, `"managed"` or `"local"`) — the first record in `installed_plugins.json` order that applies to this working directory, the rule Claude Code itself uses ``. `docs/plugin-structure.md` line 65: replace the selection parenthetical with "the first applicable record in file order — installed-plugins.js's selectEntry; with records present but none applying, `not-installed` carries a `detail` (#3541)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/impeccable-engine/resolve.test.js tests/bin-lib/impeccable-engine/run.test.js tests/bin-lib/impeccable-engine/windows-launch.test.js tests/impeccable-engine-skip-reasons.test.js tests/impeccable-plugin-contract.test.js tests/design-wrapper-doctor-no-fix.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — the four files by name; `Report the Impeccable install Claude Code loads — first-applicable selection, not-installed detail, refs #3541`.

### Task 3: superpowers resolver keeps file order

**Files:**
- Modify: `plugin/bin/lib/superpowers-version.js` (header lines 6-23, scope filter line 92, sort lines 97-100, call line 101)
- Test: `tests/bin-lib/superpowers-version.test.js`
- Test: `tests/hooks-session-start.test.js` (`mkSuperpowersWorld` lines 1209-1218 — push the project entry **before** the user entry so `--scope project` stays the selected record)
- Modify: `tests/path-guard-conformance.test.js` (line 148 — the `lib/superpowers-version.js` reason cites line numbers 69/123/124; update them to the post-edit lines of the two `fs.realpathSync.native` tokens and the comparison)

**Interfaces:**
- Consumes: `selectEntry(entries, projectPath, deps)` from Task 1.
- Produces: `effectiveSuperpowersVersion(projectDir, overrides)` — same return shape; `scope` may now be `managed` or `local`.

- [ ] **Step 1: Write the failing tests** in `superpowers-version.test.js`:
  - `AC9.1/AC9.2: the first applicable record in file order wins, even when a later record has the newer lastUpdated` — `[project(proj) 6.3.0 lastUpdated 2026-01-01, user 7.0.0 lastUpdated 2026-09-01]` at `proj` → `6.3.0`; and `[user 7.0.0 2026-01-01, project(proj) 6.3.0 2026-09-01]` → `7.0.0`.
  - Reorder fixtures that relied on project-over-user ranking so the project entry is listed first (AC1.1, `project 7.0.0 over user 6.3.0`, the two-marketplace test: put marketplace `b`'s key first in the map).
  - Replace `'AC2.2: ancestor project entry applies below its projectPath…'` with: a project entry for a **git checkout** `proj` (`fs.mkdirSync(proj/.git)`) applies at `proj/sub/deep` and the notice carries the `run from` suffix; and a project entry for a **non-git** folder does not apply below it (user wins).
  - Replace `'AC2.2/AC2.3: a worktree under the project…'` with a linked-worktree fixture (`.git` file + `commondir`, as in Task 1) resolving to the main checkout's project record; a worktree of a different repo resolves to user.
  - Replace the home-directory test and the mis-cased-home test with one test: a home-directory project entry listed **after** the user entry loses by order (`[user, project(home)]` at `home/work` → user).
  - Replace `'two user entries across marketplaces: the later lastUpdated wins'` with `'two user entries across marketplaces: the first key in file order wins'`.
  - Add `'managed and local records are admitted'` — `[managed 6.3.0]` at any dir → scope `managed`; `[local(proj) 6.3.0, user 7.0.0]` at `proj` → scope `local`.
  - Re-check `'a throwing homedir gives null rather than throwing'` — with `CLAUDE_CONFIG_DIR` injected `homedir` may no longer be called; keep the test's intent (no throw) and adjust its expected value to what the new code returns, with a comment saying why.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/superpowers-version.test.js`
Expected: FAIL after Step 1 (AC9.1's `[project, user-newer]` returns 7.0.0 after the sort)

- [ ] **Step 3: Implement** — delete the `stamp`/`flat.sort` block and its comment; scope filter admits `user`, `managed`, `project`, `local`; call `selectEntry(flat, projectDir, deps)`. Keep `Object.keys` flattening and the control-char filter. Rewrite the header's "Probe results (… 2026-10-17)" block: point at `installed-plugins.js` for the rule (Claude Code 2.1.302, 2026-10-19 probe), state that records keep file order and are never sorted, that which of several `superpowers@{marketplace}` keys loads is unsettled so keys flatten in `Object.keys` order, and drop the "Confirmed / Reversed / Observed, not encoded" bullets. Update `hooks-session-start.test.js`'s fixture order and the conformance reason's line numbers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/superpowers-version.test.js tests/hooks-session-start.test.js tests/path-guard-conformance.test.js`
Expected: PASS; and `git grep -n excludeHome -- plugin/` prints nothing (AC10.1).

- [ ] **Step 5: Commit** — the four files by name; `Keep superpowers install records in file order — first-applicable selection, refs #3541`.

## Verification (folded into /build Common Step 5)

`npm test` (AC12.1); `git grep -n excludeHome -- plugin/` empty (AC10.1); `grep -n "2.1.302" plugin/bin/lib/installed-plugins.js` and the header names the first-applicable-in-file-order rule and the 2026-10-19 probe (AC11.1).
