# classifyOwnership and findRunsByWorktreePath case-canonical worktree comparison (#3836) Implementation Plan

**Goal:** `classifyOwnership` and `findRunsByWorktreePath` (`plugin/bin/lib/hooks/context.js`) still compare worktree paths with the JS-form `fs.realpathSync` (it echoes the input's letter case on a case-insensitive volume). Move them onto path-guard's `.native` `canonicalRealpath`, the way #3769 already moved `findRunByWorktreePath`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T064007-record-3836/work/3836-spec.md` (materialized from GitHub issue #3836)

**Reproduced at base (real APFS volume, scratch script — not committed):** `classifyOwnership({ sessionId: 's1', cwd: wt }, { sessionId: 's1', worktree: <wt mis-cased> })` returns `'foreign'` (exact case: `'mine'`); `findRunsByWorktreePath(root, <wt mis-cased>)` returns `[]` (exact case: one run). Both halves of Deliverable 1 hold — neither is dropped.

---

### Task 1: Migrate the JS-form worktree comparisons to canonicalRealpath, threading fsImpl

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (one call site: thread `fsImpl` into the teardown gate's `classifyOwnership` call)
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` (one parenthetical in the Anti-Patterns row that starts "Comparing `fs.realpathSync` output against a root or an exclusion")
- Test: `tests/teardown-gate.test.js`
- Test: `tests/path-guard-conformance.test.js`

- [ ] **Step 1: Failing tests.** In `tests/teardown-gate.test.js`, add a `// --- #3836: ...` section directly after the existing `#3769` block (after the test `findRunByWorktreePath (#3769): a mis-cased recorded worktree matches the correctly-cased target`). Import `classifyOwnership` and `findRunsByWorktreePath` alongside the existing `findRunByWorktreePath, readRunState` import from `../plugin/bin/lib/hooks/context`. Reuse the file's own `fixtureRoot()`, `addWorktree(root)`, `makeRun(root, state)`, `POSIX_ONLY`, `caseInsensitiveFs`, and `preToolUse`. Every new test carries `{ skip: POSIX_ONLY }`.

  Fixture: `root = fixtureRoot()`; `wt = addWorktree(root)` (a REAL linked worktree — `classifyOwnership` asks real git via `wtDetect.repoInfo(cwd)`, so the caller cwd must be a real linked worktree); `misCased = path.join(path.dirname(wt), path.basename(wt).toUpperCase())`; `other = path.join(path.dirname(wt), 'other-wt')` (exists ONLY in the fake, never on disk); `fsImpl = caseInsensitiveFs({ [root]: 'dir', [wt]: 'dir', [other]: 'dir' })`.

  Tests (one assertion focus each):
  1. `classifyOwnership (#3836): a same-session binding recorded in a different letter case than the caller's worktree classifies as mine` — `classifyOwnership({ sessionId: 's1', cwd: wt }, { sessionId: 's1', worktree: misCased }, { fsImpl })` strictly equals `'mine'`; also assert the exact-case binding (`worktree: wt`) is `'mine'` (control).
  2. `classifyOwnership (#3836): a binding to a different live worktree is still foreign, resolved through the injected fs` — binding `worktree: other`, same session, caller `cwd: wt`, `{ fsImpl }` → strictly `'foreign'`. (`other` exists only in the fake, so this goes red unless the foreign proof's existence/isDirectory probes use `fsImpl`.)
  3. `ExitWorktree(remove) (#3836): a same-session remove whose recorded binding differs only in letter case is denied like the exact-case binding` — for each of `[misCased, wt]` as the recorded binding (fresh fixture each), `makeRun(root, JSON.stringify({ status: 'active', worktree: binding, sessionId: 's1' }))`, then `preToolUse.run({ input: { tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, session_id: 's1' }, cwd: wt, runDir: null, runState: null }, { fsImpl })`. Assert `out.json.hookSpecificOutput.permissionDecision === 'deny'`, the reason matches `/still assigned to non-terminal pipeline run/` and includes `path.basename(runDir)`, and the serialized output does NOT contain `recorded by a different session`. (Mirror the existing `assertRemovalDenied3769` helper's assertions.)
  4. `findRunsByWorktreePath (#3836): a mis-cased worktree path returns the ad-hoc run dirs the correctly-cased path does` — create an ad-hoc run dir by hand: `path.join(root, '.claude-tweaks', 'pipelines', '2026-08-01T100000-adhoc-standalone')` with `run-state.json` = `{ status: 'active', worktree: wt }`. Assert `findRunsByWorktreePath(root, misCased, undefined, { fsImpl }).map((r) => r.runDir)` deep-equals `findRunsByWorktreePath(root, wt, undefined, { fsImpl }).map((r) => r.runDir)`, and that the latter has length 1 and names that ad-hoc dir.

  Run: `node --test tests/teardown-gate.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6449b2f5-0757-4199-b9e4-60bfc48e3edd/scratchpad/t3836-red.txt 2>&1; echo "exit=$?"`
  Expected: FAIL — tests 1, 2 and 4 fail on any platform before Step 2. Test 3 fails on this macOS (case-insensitive) host only, because at base the mis-cased binding classifies `'foreign'` and the remove is allowed with the "recorded by a different session" warning; on Linux the base classifies `'indeterminate'`, which also denies. Record which tests failed: this pre-fix run is the revert evidence the Acceptance Criteria require.

- [ ] **Step 2: Implement.**

  `plugin/bin/lib/hooks/context.js`:
  - `worktreeMatches(state, target, targetPath, canonical)`: drop the JS-form default branch. `canonical` becomes required (all three callers pass one after this change): `const recorded = canonical(state.worktree) || state.worktree; return recorded === target || state.worktree === targetPath;`. Update the comment above it: both sides now resolve through path-guard's `.native` `canonicalRealpath`, via the caller's fsImpl-bound canonicalizer (#3769, #3836).
  - `classifyOwnership(caller, runState, opts = {})`: add the optional third `opts` (`{ fsImpl }`), documented in the header comment (forwarded to path-guard's `canonicalRealpath`; production callers omit it). Inside the `if (binding)` branch, define `const canonical = (p) => canonicalRealpath(p, { fsImpl: opts.fsImpl });`, canonicalize git's answer too (`repoInfo`'s `repoRoot` is the JS realpath of git's toplevel, which keeps the input casing): `const top = info.repoRoot ? (canonical(info.repoRoot) || info.repoRoot) : null;` and match with `worktreeMatches({ worktree: binding }, top, info.repoRoot, canonical)`. Replace the foreign proof's `wtDetect.safeReal(binding)` with `canonical(binding)` and its `fs.statSync(real)` with `(opts.fsImpl || fs).statSync(real)`, so the whole branch reads one filesystem. Update the stale inline comments ("worktreeMatches realpaths the recorded side", "second and third args intentionally identical") to describe the new form.
  - `findRunsByWorktreePath(cwd, targetPath, excludeDir, opts = {})`: add the optional fourth `opts` (`{ fsImpl }`), documented in its header comment. `function canonical(p) { return canonicalRealpath(p, { fsImpl: opts.fsImpl }); }`; `const target = canonical(targetPath) || targetPath;` (replaces the `fs.realpathSync(targetPath)` try/catch); pass `canonical` as `worktreeMatches`'s fourth argument. Leave the `excludeDir` / `dir` run-dir realpath comparisons (#1175) unchanged: they compare run dirs, not worktrees.

  `plugin/bin/lib/hooks/pre-tool-use.js` — in `checkTeardownGate`, the line `const ownershipVerdict = ctxLib.classifyOwnership({ sessionId: caller, cwd: ctx.cwd || process.cwd() }, hit.state);` gains a third argument `{ fsImpl }` (the `fsImpl` already in scope at the top of that function). Touch no other `classifyOwnership` call site.

  `tests/path-guard-conformance.test.js` — the `'lib/hooks/context.js'` ALLOWLIST entry: set `realpathSync` to the count the scanner now reports (expected 4), and rewrite `reason` so it states: every worktree comparison (`findRunByWorktreePath` #3769; `findRunsByWorktreePath` and `classifyOwnership` #3836, all through `worktreeMatches`) canonicalizes both sides through path-guard's `.native` `canonicalRealpath`; the remaining `realpathSync` sites are `findRunsByWorktreePath`'s and `findAdHocRunsBySessionId`'s `excludeDir` / run-dir comparisons, which compare run dirs (not worktrees) with the same JS `fs.realpathSync` on both sides, each falling back to the as-given path on throw; and the two `existsSync` sites with their CURRENT line numbers (find them with `grep -n existsSync plugin/bin/lib/hooks/context.js`; today the reason says 44 and 637, and the second one moves).

  `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` — in the Anti-Patterns row beginning "Comparing `fs.realpathSync` output against a root or an exclusion", replace the parenthetical `(a lookup it delegates to `context.js` may not: the `lib/hooks/context.js` reason in `tests/path-guard-conformance.test.js`'s ALLOWLIST names which of that file's sites still compare JS-form)` with one stating that every worktree lookup it delegates to `context.js` now does too (`findRunByWorktreePath` since #3769, `classifyOwnership` and `findRunsByWorktreePath` since #3836), and that the file's remaining JS-form `realpathSync` sites compare run-dir paths only, as the `lib/hooks/context.js` reason in that test's ALLOWLIST records. Edit only that parenthetical.

- [ ] **Step 3: Run** — PASS:
  - `node --test tests/teardown-gate.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6449b2f5-0757-4199-b9e4-60bfc48e3edd/scratchpad/t3836-green.txt 2>&1; echo "exit=$?"`
  - `node --test tests/path-guard-conformance.test.js tests/hooks-context.test.js tests/hooks-pre-tool-use.test.js tests/path-containment-conformance.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6449b2f5-0757-4199-b9e4-60bfc48e3edd/scratchpad/t3836-related.txt 2>&1; echo "exit=$?"`
  - `node --test "tests/bin-lib/path-guard/*.test.js" > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6449b2f5-0757-4199-b9e4-60bfc48e3edd/scratchpad/t3836-pg.txt 2>&1; echo "exit=$?"`
  All exit 0. Do NOT run the full `npm test` — the full suite runs centrally afterwards.

- [ ] **Step 4: Commit** — stage the five files by explicit path, one commit: `Make classifyOwnership and findRunsByWorktreePath case-canonical — canonicalRealpath on both sides, fsImpl threaded` with body `refs #3836` and the trailer line `Claude-Session: https://claude.ai/code/session_01D9kmzbX15tiPfELgr6q5BL`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (reproduce first) — done at base on the real volume (above), and Step 1's pre-fix red run is the committed tests' revert evidence. Deliverable 2 (migrate `worktreeMatches`'s default branch / both callers, threading fsImpl) — Step 2's `context.js` and `pre-tool-use.js` edits. Deliverable 3 (ALLOWLIST count and reason; skill row) — Step 2's last two edits. AC1 (same-session mis-cased `ExitWorktree(remove)` classifies `'mine'` and is denied like exact case) — tests 1 and 3. AC2 (`findRunsByWorktreePath` mis-cased equals correctly-cased) — test 4. AC3 (each new test red with its resolver change reverted; `teardown-gate` and pre-tool-use suites stay green) — Step 1's red run plus Step 3.
- **Placeholders:** none.
