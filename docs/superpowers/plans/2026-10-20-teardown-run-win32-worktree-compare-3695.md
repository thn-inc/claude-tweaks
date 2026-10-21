# Teardown-Run Win32 Worktree Compare (#3695) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `teardown-run.js` match a worktree's `git worktree list --porcelain` entry against the stamped worktree path on Windows, so a merged run's branch and remote ref get deleted instead of `branch: skipped — no branch recorded`.

**Architecture:** One exported pure helper, `findWorktreeEntry(entries, target, pathImpl = path)`, replaces the two strict `===` compares (`branchOfWorktree` at `:83`, the #2747 prunable retry at `:257`). It compares `pathImpl.resolve` of both sides and folds case when `pathImpl` is win32, so a `path.win32` pin runs on any host.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `node:path` (`path.win32` / `path.posix`).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3695/work/3695-spec.md`

## Global Constraints

- Compare idiom: `path.resolve(a) === path.resolve(b)` (the repo idiom, `archive-merged.js:2059`), never a realpath-only compare at `:257` — the worktree may be half-removed there and realpath would fail.
- Thread `pathImpl` only through the compare; do not refactor `parseWorktreeList` (`worktree-reap.js`).
- Do not change any existing test's expected strings in `tests/hooks-teardown-run.test.js` — those assertions are correct; the code under them is wrong.
- Drive-letter case (spec Gotcha 1): on win32 the compare is case-insensitive (decision logged in `spec-3695/decisions.md`). On posix it stays case-sensitive.

## Review Focus

1. **Drive-letter case differs** (`d:/a/x/feat` porcelain vs `D:\a\x\feat` stamped) — must still match on win32. Pinned in Task 1 Step 1.
2. **Posix host, case-only difference** (`/a/X` vs `/a/x`) — must NOT match; folding there would cross-match distinct directories. Pinned in Task 1 Step 1.
3. **Falsy target** (`null`/`''`) — returns `null`, never matches the first entry (`path.resolve('')` is the cwd). Pinned in Task 1 Step 1.
4. **Trailing separator** on one side (`D:/a/x/feat/`) — `resolve` strips it; must match. Pinned in Task 1 Step 1.
5. **A call site bypassing the helper** (an inline strict `.path ===` reintroduced at `:83` or `:257`) — the helper pins would stay green, so a source-scan pin guards the call sites (AC3). Pinned in Task 1 Step 1.

---

### Task 1: Normalized worktree-path lookup in teardown-run.js

**Files:**
- Modify: `plugin/bin/lib/hooks/teardown-run.js:78-86` (`branchOfWorktree`), `:255-258` (prunable retry), `:314` (`module.exports`)
- Test: `tests/hooks-teardown-run.test.js` (append; existing tests untouched)

Waived plugin/bin/lib/hooks/run-integrity.js: read only — `deriveBranch` (`:84-99`) is the `realpathOrSelf` precedent; unaffected per the spec.
Waived plugin/bin/lib/reconcile/archive-merged.js: read only — `:2059` is the `path.resolve(a) === path.resolve(b)` idiom this task copies.

**Interfaces:**
- Produces: `findWorktreeEntry(entries: Array<{path: string, ...}>, target: string|null, pathImpl = require('path')) -> entry | null`, exported from `teardown-run.js` beside `teardownRun, branchOfWorktree, repoSpecOf, defaultGhApiDelete, describeGitFailure`.

- [ ] **Step 0: Characterization baseline**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: PASS on this (posix) host — AC1 (`branch: deleted feat-branch`) and AC10 (prunable retry) already characterize the host-path behavior the change must keep.

- [ ] **Step 1: Write the failing tests (AC1.1, AC2.1, AC3.1)** (append to `tests/hooks-teardown-run.test.js`; require `findWorktreeEntry` from `../plugin/bin/lib/hooks/teardown-run` and `parseWorktreeList` from `../plugin/bin/lib/hooks/worktree-reap`)

Fixture: `const PORCELAIN = 'worktree D:/a/x\nHEAD 1111111\nbranch refs/heads/trunk\n\nworktree D:/a/x/feat\nHEAD 2222222\nbranch refs/heads/feat-branch\nprunable gitdir file points to non-existent location\n\n';` and `const entries = parseWorktreeList(PORCELAIN);`

- `test('#3695 AC1: win32 — a forward-slash porcelain path resolves the backslash-stamped worktree to its branch')` — `assert.strictEqual(findWorktreeEntry(entries, 'D:\\a\\x\\feat', path.win32).branch, 'feat-branch')`; also `findWorktreeEntry(entries, 'd:\\a\\x\\feat\\', path.win32).branch === 'feat-branch'` (drive case + trailing separator, Review Focus 1 and 4).
- `test('#3695 AC2: win32 — the prunable-retry lookup finds the prunable entry')` — the entry found for `'D:\\a\\x\\feat'` with `path.win32` has `prunable === true`.
- `test('#3695: posix stays case-sensitive and a falsy target never matches')` — `findWorktreeEntry([{ path: '/a/X', branch: 'b' }], '/a/x', path.posix) === null`; `findWorktreeEntry(entries, null, path.win32) === null`; `findWorktreeEntry(entries, '', path.win32) === null`.
- `test('#3695 AC3: no strict worktree-path compare remains at either call site')` — read `plugin/bin/lib/hooks/teardown-run.js` and assert it does not match `/\.path === /`, and that `findWorktreeEntry(` appears at least 3 times (definition + two call sites).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: FAIL — `findWorktreeEntry is not a function` for the three helper tests, and the AC3 scan fails on the two existing `.path ===` lines (83, 257).

- [ ] **Step 3: Implement `findWorktreeEntry(entries, target, pathImpl = path)` in `teardown-run.js`**

Add `const path = require('path');` with the other requires. Return `null` for a falsy `target`; otherwise compare `key(entry.path) === key(target)` where `key(p) = pathImpl.resolve(p)`, lowercased when `pathImpl.sep === '\\'`. Return the first match or `null`. Comment cites #3695 and why `resolve` not realpath (half-removed worktree at the retry). Then:
- `branchOfWorktree`: replace the loop with `const entry = findWorktreeEntry(parseWorktreeList(list.stdout), worktreePath); return entry ? (entry.branch || null) : null;`
- prunable retry (`:257`): `findWorktreeEntry(parseWorktreeList(listAfter.stdout), effectiveWorktreePath)`.
- Add `findWorktreeEntry` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass (AC4.1 — this file; `npm test` runs at `/build` Common Step 5)**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: PASS — every test, including the unchanged AC1/AC10 and the four new `#3695` tests.

- [ ] **Step 5: Verify the go-red control (AC3.1)**

Temporarily change the helper's compare to `entry.path === target` (strict, no resolve): Run `node --test tests/hooks-teardown-run.test.js` — Expected: FAIL on `#3695 AC1` and `#3695 AC2`. Restore, re-run — PASS. Separately, temporarily put `w.path === effectiveWorktreePath` back at the `:257` call — Expected: FAIL on `#3695 AC3`. Restore. Never commit either reverted state.

- [ ] **Step 6: Commit**

```bash
git -C "<worktree>" add plugin/bin/lib/hooks/teardown-run.js tests/hooks-teardown-run.test.js
git -C "<worktree>" commit -m "Normalize teardown-run worktree path compares — win32 porcelain vs stamped path (refs #3695)"
```

---

## Self-review

- **Spec coverage:** D1 (normalized compares at `:83`/`:257` via a `pathImpl` seam) → Step 3. D2 (win32 forward-slash vs backslash pin for branch + prunable) → Step 1 AC1/AC2. AC1 → `#3695 AC1`; AC2 → `#3695 AC2`; AC3 → Step 5 + `#3695 AC3`; AC4 → Step 4 (file) and `/build` Common Step 5 (`npm test`). Gotcha 1 (drive case) → win32 fold + AC1's `d:` case. Gotcha 2 (other 5 pre-existing Windows failures) is confirmable only by the post-merge `windows-regression` run — not claimed here.
- **Placeholders:** none (`<worktree>` is the run's worktree path, supplied in the dispatch).
- **Sole site:** corrected at review. The authoring grep matched only `.path === {name}Path|Dir|wt` and missed `e.path === cwd`: `plugin/bin/lib/hooks/post-tool-use.js:243` (`resolveWorktreePathViaPorcelain`) and `plugin/bin/lib/hooks/context.js:784` (`stampAdHocRunDirForDenial`) make the same strict porcelain-vs-native compare. They are outside this spec's Key Files and are routed as a follow-up record (run ledger). The realpath-normalized lookups (`worktree-reap.js` `isWorktreeLocked`, `resume-freshness.js`, `flow/consolidated-pass.js`, `run-integrity.js` `deriveBranch`) and the node-produced `ports/` `lease.path === realPath` compares are unaffected.
