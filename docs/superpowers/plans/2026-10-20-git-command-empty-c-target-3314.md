# git-command: empty -C and omitted -C resolve to the same target (#3314) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `git -C '' commit` and `git commit` resolve to the identical target string for a cwd of `/repo`, on both `path.posix` and `path.win32`.

**Architecture:** `skipGlobalFlags` (`plugin/bin/lib/hooks/git-command.js:276`) currently runs an empty `-C` value through `path.resolve(dir, '')`, which normalizes `dir` (`/repo` → `\repo` under `path.win32`), while an omitted `-C` leaves `dir` as the verbatim cwd `forEachCommandSegment` passed in (`:239`). Real git leaves the cwd unchanged for `-C ""`, so the fix keeps `dir` verbatim for an empty value — the form the omitted case already produces and the one every other plain-cwd target (`gitTargets('git commit', '/repo')` → `'/repo'`, pinned at `tests/hooks-git-command.test.js:11`) already hands the worktree gate. The gate consumes `t.dir` only through fs/realpath probes (`pre-tool-use.js:899-923`), which accept either form, so verbatim changes no gate outcome on a real filesystem. A `pathImpl` parameter (default `path`, the existing `shared-primitives.js` seam convention) makes the win32 behavior testable on any host.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T132016-record-3314/work/3314-spec.md`

## Global Constraints

- No new dependencies; `node --test` only.
- Commit messages reference the record as `refs #3314`, never `closes`/`fixes`.
- The full suite (`npm test`) stays green (spec AC, "The suite stays green").

## Review Focus

- `-C ''` with an UNKNOWN cwd (`dir === null`) must still be unprovable (resolveGitCommand returns null) — unchanged from today, since `dir` stays null. Pinned in Task 1.
- `-C ''` followed by a relative `-C b` must resolve `b` against the unchanged cwd (`/repo/b`). Pinned in Task 1.
- Non-empty `-C` values (absolute, relative, unresolvable `$VAR`) keep their current behavior — existing tests at `tests/hooks-git-command.test.js:14-17,161-162` cover them.
- `env -C ''` in `findGitLead` is a different code path (`resolveCd`) and out of scope — `env` itself rejects an empty `-C`.

---

### Task 1: Keep `dir` verbatim for an empty `-C` value, with an injectable `pathImpl`

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js:276-306` (`skipGlobalFlags`)
- Test: `tests/hooks-git-command.test.js:255-261` (the existing "empty -C value" test)

**Interfaces:**
- Produces: `skipGlobalFlags(t: string[], i: number, dir: string|null, pathImpl = path) -> { index: number, dir: string|null, unprovable: boolean }`. The sole caller, `resolveGitCommand` (`:382`), passes no fourth argument and is unchanged.

- [ ] **Step 1: Write the failing tests** — in `tests/hooks-git-command.test.js`, add `skipGlobalFlags` to the destructured require at line 6-8, then replace the body of the existing test at line 255 with assertions that both forms are identical, and add a win32 test:

```js
test('AC1.1: an empty -C value ("git -C \'\' commit") behaves like omitting -C entirely — identical target, not like an unparseable command', () => {
  // (keep the existing explanatory comment)
  assert.deepStrictEqual(gitTargets('git -C "" commit -m "msg"', '/repo'), gitTargets('git commit -m "msg"', '/repo'));
  assert.deepStrictEqual(gitTargets('git -C "" commit -m "msg"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
});

test('AC1.2: empty -C and omitted -C resolve to the identical dir under both path.posix and path.win32 (#3314)', () => {
  for (const impl of [path.posix, path.win32]) {
    const empty = skipGlobalFlags(['git', '-C', '', 'commit'], 1, '/repo', impl);
    const omitted = skipGlobalFlags(['git', 'commit'], 1, '/repo', impl);
    assert.strictEqual(empty.dir, omitted.dir);
    assert.strictEqual(empty.dir, '/repo');
    assert.strictEqual(empty.index, 3);
    assert.strictEqual(empty.unprovable, false);
  }
});

test('an empty -C value leaves an UNKNOWN cwd unprovable, and a following relative -C resolves against the unchanged cwd', () => {
  assert.strictEqual(resolveGitCommand(['git', '-C', '', 'commit'], null), null);
  assert.deepStrictEqual(gitTargets('git -C "" -C b commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/repo', 'b') }]);
});
```

- [ ] **Step 2: Run the tests (pre-fix baseline)**

Run: `node --test tests/hooks-git-command.test.js`
Expected: PASS on a POSIX host — before the fix `skipGlobalFlags` ignores the 4th argument and uses the host `path`, so the win32 iteration is vacuous. This step only confirms the new tests are well-formed; the discriminating evidence is Step 4's go-red control, where `pathImpl` is honored but the empty-value branch is removed (probed: `path.win32.resolve('/repo','')` returns `\repo`, which `!== '/repo'`).

- [ ] **Step 3: Implement** — in `skipGlobalFlags`, add the `pathImpl = path` parameter and use it for the `-C` branch's `isAbsolute`/`resolve` calls. Add a first branch inside `if (flag === '-C' && i + 1 < t.length)`: when `raw === ''`, leave `dir` unchanged (comment: git leaves cwd unchanged for an empty `-C`; resolving would normalize `dir` and give the worktree gate a different target string than an omitted `-C`, e.g. `C:\repo` vs `/repo` on Windows — #3314). Then the existing `isUnresolvable` / absolute / null / relative branches, unchanged except for `pathImpl`.

- [ ] **Step 4: Run the tests to verify they pass, then prove they discriminate**

Run: `node --test tests/hooks-git-command.test.js`
Expected: PASS.
Go-red control: temporarily delete the `raw === ''` branch (keeping `pathImpl`), re-run — AC1.2 must FAIL on the win32 iteration; restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-git-command.test.js
git commit -m "Keep empty git -C value verbatim — empty and omitted -C now resolve to one target on posix and win32 (refs #3314)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (same target for both forms, verbatim chosen) → Task 1 Step 3. Deliverable 2 (pin both forms with one expected value, win32 via injected `path.win32`) → Task 1 Step 1 (AC1.1, AC1.2). AC "suite stays green" → Common Step 5 full `npm test`.
- **Placeholders:** none.
