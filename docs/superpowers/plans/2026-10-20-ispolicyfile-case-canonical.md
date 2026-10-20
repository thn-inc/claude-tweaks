# isPolicyFile Case-Canonical Realpath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `isPolicyFile` recognise a mis-cased absolute path to the repo's `.claude-tweaks/policy.yml` by resolving both sides of its equality with the case-canonical (`.native`) realpath, while a symlink swapped in for `policy.yml` stays denied.

**Architecture:** `realTarget()` (target side) and `canonicalRepoPath()` (reference side) in `plugin/bin/lib/hooks/pre-tool-use.js` both switch to `plugin/bin/lib/path-guard`'s `.native` default — `resolveLeaf` without an explicit `realpath`, and `canonicalRealpath` for every parent-directory resolution (including `realTarget`'s missing-leaf fallback, so both sides of the equality use one resolver). An optional trailing `{ fsImpl }` option is threaded through `isPolicyFile` → `realTarget` / `canonicalRepoPath` so a test can model a case-insensitive volume. `safeReal` stays (other callers use it) but no longer participates in `isPolicyFile`.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T222838-record-3495/work/3495-spec.md`

**Scope keywords:** isPolicyFile, realTarget, canonicalRepoPath

## Global Constraints

- Both sides of `isPolicyFile` resolve with the case-canonical realpath — never one side `.native` and the other the JS form.
- The leaf-asymmetry stays: `realTarget` follows the leaf symlink chain; `canonicalRepoPath` resolves only the parent and keeps the literal `policy.yml` basename.
- `isPolicyFile(repoRoot, targetPath)` call sites (lines ~941, ~1545) keep working unchanged — the new option is optional and defaults to the real `fs`.

## Review Focus

- Mis-cased `repoRoot` (not just a mis-cased target) — both sides canonical → still matches. Test added in Task 1.
- Mis-cased target where `policy.yml` is a symlink to a file elsewhere → must stay `false`. Test added in Task 1.
- `realTarget`'s other consumer, `shadowPipelineRunDir` (~683), now sees `.native` output: a correctly-cased path is unchanged; a mis-cased path now resolves under `pipelinesDir` (stricter, fail-safe). No new test — a reviewer should confirm no existing shadow-guard test regresses (`tests/hooks-*shadow*` in the full suite).
- Not-yet-existing `policy.yml` (Write creating it): parent-only fallback must still match. Existing test `realTarget: a not-yet-existing leaf takes the parent-only fallback and matches` covers it.
- EACCES-at-leaf fallbacks: existing tests at `callers-characterization.test.js:159-189` patch only the JS `realpathSync` and inherit the real `.native`, so after the change they would stop exercising the fallback. Task 1 rewrites them to inject an `fsImpl` whose `.native` fails for the leaf.

---

### Task 1: Resolve both sides of isPolicyFile case-canonically

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:38` (import), `:187-235` (`realTarget`, `canonicalRepoPath`, `isPolicyFile`)
- Modify: `tests/path-guard-conformance.test.js:123` (allowlist entry for `lib/hooks/pre-tool-use.js`)
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md:43` (`safeReal` anti-pattern row)
- Test: `tests/bin-lib/path-guard/callers-characterization.test.js` (pre-tool-use section, lines 105-207)

**Interfaces:**
- Produces: `isPolicyFile(repoRoot: string, targetPath: string, { fsImpl = fs } = {}) -> boolean`; private `realTarget(targetPath, { fsImpl } = {}) -> string|null`; private `canonicalRepoPath(repoRoot, relPath, { fsImpl } = {}) -> string|null`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/path-guard/callers-characterization.test.js`

Add a helper `caseInsensitiveFs(entries)` — `entries` maps canonical absolute paths to `{ type: 'file' | 'directory' }` or `{ type: 'symlink', target }`; lookup is by `p.toLowerCase()`. It returns `{ ...fs, realpathSync, lstatSync }` where:
- `realpathSync(p)` (JS model): ENOENT if absent; a symlink resolves to `realpathSync(target)`; otherwise returns `p` **as typed** (echoes casing).
- `realpathSync.native(p)`: ENOENT if absent; a symlink resolves to `realpathSync.native(target)`; otherwise returns the **canonical** key.
- `lstatSync(p)`: ENOENT if absent; otherwise a stat-like object with `isSymbolicLink()/isFile()/isDirectory()` from `type`.

New tests (repo `/Vol/Repo`, entries for `/Vol`, `/Vol/Repo`, `/Vol/Repo/.claude-tweaks`, and `policy.yml`):
```js
test('isPolicyFile (#3495): a mis-cased target to an existing policy.yml matches on a case-insensitive volume', () => {
  assert.equal(isPolicyFile('/Vol/Repo', '/vol/repo/.CLAUDE-TWEAKS/Policy.yml', { fsImpl }), true);
});
test('isPolicyFile (#3495): a mis-cased repoRoot still matches the correctly-cased target', () => {
  assert.equal(isPolicyFile('/vol/REPO', '/Vol/Repo/.claude-tweaks/policy.yml', { fsImpl }), true);
});
test('isPolicyFile (#3495): a symlink swapped in for policy.yml is still denied through a mis-cased target', () => {
  // policy.yml: { type: 'symlink', target: '/Vol/Elsewhere/evil.yml' }, plus '/Vol/Elsewhere' dir and evil.yml file
  assert.equal(isPolicyFile('/Vol/Repo', '/vol/repo/.claude-tweaks/POLICY.yml', { fsImpl }), false);
});
```
Flip the existing `realTarget: resolves with the JS fs.realpathSync, never .native` test to `realTarget: resolves with .native, never the JS fs.realpathSync` — inject `fsImpl = { ...fs, realpathSync: patched }` where `patched` throws `'JS realpath must not be used here'` and `patched.native = fs.realpathSync.native`; assert `isPolicyFile(root, alias, { fsImpl }) === true`.

Rewrite the two EACCES fallback tests (`...realpath AND lstat fail...` and `...lstat reports as present but whose realpath fails...`) to pass an injected `fsImpl` whose `realpathSync.native` (and, for the first, `lstatSync`) throws EACCES for `policy` — no global `fs` monkeypatching — and keep their `true` assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/path-guard/callers-characterization.test.js`
Expected: FAIL — the three new `#3495` cases that expect `true` fail (the mis-cased target/root cases), and the flipped `.native` test fails (JS form still used).

- [ ] **Step 3: Implement in `plugin/bin/lib/hooks/pre-tool-use.js`**

Import `canonicalRealpath` alongside `resolveLeaf`. `realTarget(targetPath, { fsImpl } = {})`: `resolveLeaf(resolved, { fsImpl })` (no explicit `realpath`), and the missing/unreadable fallback resolves the parent with `canonicalRealpath(path.dirname(resolved), { fsImpl })`. `canonicalRepoPath(repoRoot, relPath, { fsImpl } = {})`: parent via `canonicalRealpath(..., { fsImpl })`. `isPolicyFile(repoRoot, targetPath, { fsImpl } = {})` threads `{ fsImpl }` to both. Replace the `~190-194` comment (the "keep JS form until #3495" note) with one stating both sides use path-guard's `.native` default so a mis-cased path compares equal. Leave `safeReal` and every other caller untouched.

- [ ] **Step 4: Update the conformance allowlist and the skill row**

`tests/path-guard-conformance.test.js:123`: `realpathSync` count `2` → `1`; reason: the one remaining token is `safeReal` (~423), the JS-form helper still used by the E1/worktree-identity comparisons (both sides of each through `safeReal`); `isPolicyFile` no longer uses it — both sides go through path-guard's `.native` `resolveLeaf`/`canonicalRealpath` (#3495). Keep the existsSync sentence, re-checking its line number.

`.claude/skills/pre-tool-use-gate-exemptions/SKILL.md:43`: replace "`realTarget()` and `safeReal` keep the JS form until #3495 moves both sides of `isPolicyFile`'s equality together, so a new exemption…" with wording that #3495 moved both sides of `isPolicyFile` to path-guard's `.native` resolvers, `safeReal` remains JS-form for the E1/worktree comparisons only, and a new exemption that compares resolved paths resolves both sides through `canonicalRealpath()` / `resolveLeaf()` rather than copying `safeReal`. Keep the rest of the row.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/bin-lib/path-guard/callers-characterization.test.js tests/path-guard-conformance.test.js tests/hooks-policy-exemption.test.js tests/bin-lib/path-guard/*.test.js`
Expected: PASS, 0 failures. Covers AC1.1 (the mis-cased target/root `#3495` tests) and AC2.1 (the symlink-swap `#3495` test plus the existing `realTarget: a symlink swapped in for policy.yml…` test; the full `npm test` run is `/build` Common Step 5).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/bin-lib/path-guard/callers-characterization.test.js tests/path-guard-conformance.test.js .claude/skills/pre-tool-use-gate-exemptions/SKILL.md
git commit -m "Resolve both sides of isPolicyFile case-canonically — mis-cased policy.yml paths keep the exemption (refs #3495)"
```
