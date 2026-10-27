# chmod denial skip on win32 (#4290) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chmod-based permission-denial test, and every mode-bit read-back, skips (or narrows) on win32 through one shared helper instead of failing there or hand-rolling its own `process.platform` guard.

**Architecture:** `tests/helpers/root.js` gains `chmodDenialSkip(reason, opts)` — node:test's `{ skip }` shape covering root (caller's reason) and win32 (`win32: chmod does not deny access`) — and `MODE_BITS_HONORED`. The root-skip conformance scan accepts the new helper. All 13 denial tests in the record convert to `chmodDenialSkip` (none has an existing production seam — map below), the two mode-bit tests guard only their mode assertions, and all nine ad-hoc win32 chmod guards in `tests/` migrate to the helper.

**Tech Stack:** Node `node:test`, CommonJS. Test-only change — nothing under `plugin/` changes.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T131247-spec-4290-4285-4396/spec-4290/work/4290-spec.md`

Scope keywords: chmodSync

## Global Constraints

- The win32 skip reason is exactly `win32: chmod does not deny access`.
- Do not add a production seam only for this (spec Deliverables). No file under `plugin/` changes.
- No test newly skipped on Linux (AC1.1): on a non-root Linux runner `chmodDenialSkip(...)` returns `{ skip: false }`.
- Under root the caller's own reason string is kept verbatim (it is what the file passes to `skipUnderRoot` today).
- A file that still calls `chmodSync(` must keep satisfying `tests/permission-sim-root-skip-conformance.test.js` — import `helpers/root` and call `skipUnderRoot(` or `chmodDenialSkip(`, or mark every chmod line `// root-safe`.

## Per-test decision map (Deliverable 3: "decide each denial test individually")

Every module under test was read for an existing fs/reader/`deps` seam (signatures verified in this worktree: `listSlices(root)` scope.js:37; `sweepShadow({ runRoot, pipelineRunDir, worktree })` sweep-shadow.js:104, exports only `{ sweepShadow, claimFreeDest }` :221; `detectReleaseProcess(root, { integrationModel })` release-bootstrap.js:135 — its `fsImpl` seam lives only on `assertSafeWriteTarget` :469; `probeArtifacts({ cwd, now, run })` artifacts.js:165 — `run` is the git runner only; `mainCheckoutRoot(p)` worktree-detect.js:50; `checkRunDirAnchoredOrOutside(candidate, cwd)` :218; `archiveRunDir(root, runDir)` archive-merged.js:1193; the curation-judge, hooks-dispatcher ×2 tests spawn `hooks.js` as a child process). None reaches the failing read/write, so **every denial test takes `chmodDenialSkip`; none converts to fault injection.**

| # | File:line | Test (title prefix) | Today's options arg → new |
|---|---|---|---|
| 1 | tests/bin-lib/code-health/scope.test.js:132 | listSlices keeps (does not exclude) a dot-directory whose scan genuinely fails | `skipUnderRoot('root ignores directory permissions')` → `chmodDenialSkip('root ignores directory permissions')` |
| 2 | tests/bin-lib/hooks/sweep-shadow.test.js:41 | read-only shadow staged/ dir produces a failure diagnostic | same reason, `chmodDenialSkip` |
| 3 | tests/bin-lib/hooks/sweep-shadow.test.js:59 | unreadable shadow decisions.md produces a failure diagnostic | `'root ignores file permissions'` |
| 4 | tests/bin-lib/hooks/sweep-shadow.test.js:104 | #1305: permission-denied PARENT dir … staged/ entry gate | `'root ignores directory permissions'` |
| 5 | tests/bin-lib/hooks/sweep-shadow.test.js:122 | #1305: permission-denied PARENT dir … decisions.md entry gate | `'root ignores directory permissions'` |
| 6 | tests/bin-lib/init/release-bootstrap.test.js:503 | detectReleaseProcess: an unreadable config (EACCES) | `'root bypasses chmod restrictions'` |
| 7 | tests/bin-lib/residue/artifacts.test.js:192 | an unreadable root fails the whole probe loudly | `'root ignores directory permissions'` |
| 8 | tests/curation-judge-stagepath.test.js:263 | probe: an mv failure is a loud diagnostic | `'root ignores directory permissions'` |
| 9 | tests/hooks-dispatcher.test.js:325 | record-worktree reports a distinct failure when the run-state write itself fails | `'root ignores directory permissions'` |
| 10 | tests/hooks-dispatcher.test.js:1307 | a gate denial with an unwritable run dir still denies | `'root ignores directory permissions'` |
| 11 | tests/hooks-worktree-detect.test.js:160 | mainCheckoutRoot: a stat failure that is NOT ENOENT | `'root bypasses mode bits'` |
| 12 | tests/hooks-worktree-detect.test.js:245 | checkRunDirAnchoredOrOutside: unreadable ancestor fails closed | `'root bypasses mode bits'` |
| 13 | tests/reconcile.test.js:607 | archiveRunDir: an unreadable run dir returns reason readdir-failed | `'root ignores directory permissions'` |

Line numbers were read in this worktree on 2026-10-26; match by title if they have drifted. The reason string to keep is whatever that test's `skipUnderRoot(...)` call passes today.

Waived AC3.1: no denial test converts to fault injection — no module under test has an existing seam (map above), and the spec forbids adding one.
Waived AC3.2: same reason — there is no converted test whose injected failure needs proving.

## Review Focus

1. **A root runner on Linux** — a converted test must still skip under root with its original reason, not the win32 one. Pinned by Task 1's `isRoot: true` cases.
2. **A file whose last `skipUnderRoot(` call disappears in a conversion but which still calls `chmodSync(`** — the conformance scan must still pass it via `chmodDenialSkip(`. Pinned by Task 1's AC2.1 self-check fixture and by the real scan running in every later task's verification.
3. **win32 AND root at once** — the win32 reason wins (it is the more fundamental cause). Pinned by Task 1.
4. **A test that wraps its options as `{ skip: X.skip || … }`** (ledger-residue, timing/cli, run-liveness) — the migrated form must keep a single skip value, never `{ skip: { skip: … } }`. Pinned by Task 5/6's verification (`# skipped` count unchanged on Linux).
5. **install-statusline-wrapper on win32** — the non-mode assertions (content, path) must keep running there. Pinned by Task 4 guarding only the `mode & 0o777` lines.

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1's `AC1.1:` test; every task's identical-count verification; Task 7 Step 1 |
| AC2.1 | Task 1's `AC2.1:` self-check test |
| AC3.1, AC3.2 | Waived (above) |
| AC4.1 | Task 7 Step 2, the Windows run's per-file `not ok` read and `attributable: []` |
| AC4.2 | Task 1's `AC4.2:` test (reason literal); Task 7 Step 2 (the real `# SKIP` lines) |

## Check B ruling

`Scope keywords: chmodSync` matches 16 files outside the task list. Every `chmodSync(` line in the 14 test files is an exec-bit (`0o755`) or mode-read setup already marked `// root-safe`, so none is a denial simulation. `docs/plugin-structure.md` and `plugin/bin/install-statusline-wrapper.js` mention or perform a production chmod, which is out of scope. The one denial, `tools/upstream-drift/tests/checks.test.js:667`, already skips on win32 and under root (:656-663). It sits outside `tests/`, the scan's domain, and is left alone, because migrating it would import `tests/helpers` into `tools/`. No file is added.

---

### Task 1: `chmodDenialSkip` and `MODE_BITS_HONORED` in tests/helpers/root.js; conformance accepts the helper

**Files:**
- Modify: `tests/helpers/root.js`
- Modify: `tests/permission-sim-root-skip-conformance.test.js`

**Interfaces:**
- Produces: `chmodDenialSkip(reason: string, opts?: { platform?: string, isRoot?: boolean }) -> { skip: false | string }` — `opts.platform` defaults to `process.platform`, `opts.isRoot` to `IS_ROOT`. Returns `{ skip: 'win32: chmod does not deny access' }` when platform is `win32` (whatever `isRoot` is), else `{ skip: reason }` when `isRoot`, else `{ skip: false }`.
- Produces: `MODE_BITS_HONORED: boolean` — `process.platform !== 'win32'`.
- Produces: `WIN32_CHMOD_SKIP_REASON = 'win32: chmod does not deny access'` (exported, so tests compare against one literal source — but tests below still spell the literal).
- `module.exports = { IS_ROOT, skipUnderRoot, chmodDenialSkip, MODE_BITS_HONORED, WIN32_CHMOD_SKIP_REASON }`.

- [ ] **Step 1: Write the failing tests** in `tests/permission-sim-root-skip-conformance.test.js`:

```js
test('AC4.2: chmodDenialSkip skips on win32 with the shared reason, whatever the root state', () => {
  const { chmodDenialSkip } = require(path.join(TESTS_DIR, 'helpers', 'root.js'));
  assert.deepStrictEqual(chmodDenialSkip('root reason', { platform: 'win32', isRoot: false }), { skip: 'win32: chmod does not deny access' });
  assert.deepStrictEqual(chmodDenialSkip('root reason', { platform: 'win32', isRoot: true }), { skip: 'win32: chmod does not deny access' });
});

test('AC1.1: chmodDenialSkip never skips a non-root POSIX runner, and keeps the caller reason under root', () => {
  const { chmodDenialSkip } = require(path.join(TESTS_DIR, 'helpers', 'root.js'));
  assert.deepStrictEqual(chmodDenialSkip('root reason', { platform: 'linux', isRoot: false }), { skip: false });
  assert.deepStrictEqual(chmodDenialSkip('root reason', { platform: 'darwin', isRoot: true }), { skip: 'root reason' });
});

test('MODE_BITS_HONORED is false exactly on win32', () => {
  const { MODE_BITS_HONORED } = require(path.join(TESTS_DIR, 'helpers', 'root.js'));
  assert.strictEqual(MODE_BITS_HONORED, process.platform !== 'win32');
});

test('AC2.1: the scan accepts a fixture using only chmodDenialSkip, and still flags one using neither helper (self-check)', () => {
  const onlyNew = "const { chmodDenialSkip } = require('./helpers/root');\n"
    + "test('x', chmodDenialSkip('reason'), () => { fs.chmodSync('/tmp/x', 0o000); });\n";
  assert.strictEqual(checkFile('/fake/good3.test.js', onlyNew), null);
  const neither = "const { IS_ROOT } = require('./helpers/root');\nfs.chmodSync('/tmp/x', 0o000);\n";
  assert.match(checkFile('/fake/bad2.test.js', neither), /bad2\.test\.js:2/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/permission-sim-root-skip-conformance.test.js`
Expected: FAIL — `chmodDenialSkip is not a function` (AC4.2/AC1.1 tests), `MODE_BITS_HONORED` undefined, and the AC2.1 fixture flagged (`checkFile` returns a violation for `good3`).

- [ ] **Step 3: Implement**
  - `tests/helpers/root.js`: add the three exports above; extend the header comment with one paragraph: on win32 `fs.chmodSync` only toggles the read-only attribute, so a chmod denial never happens and `statSync().mode & 0o777` reads `0o666` — `chmodDenialSkip` is the one predicate for a denial simulation, `MODE_BITS_HONORED` for a mode-bit read-back (#4290).
  - Conformance `checkFile`: `usesHelper = HELPER_IMPORT_RE.test(text) && (text.includes('skipUnderRoot(') || text.includes('chmodDenialSkip('))`. Update the violation message and the file's header comment to name both helpers. Keep the existing self-check tests unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/permission-sim-root-skip-conformance.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit** — `git add tests/helpers/root.js tests/permission-sim-root-skip-conformance.test.js` then commit `Add chmodDenialSkip and MODE_BITS_HONORED to the root-skip helper — win32 chmod never denies (refs #4290)`.

### Task 2 [batch]: Convert denial tests 1-7 (code-health, hooks/sweep-shadow, init, residue)

**Files:**
- Modify: `tests/bin-lib/code-health/scope.test.js` (map row 1)
- Modify: `tests/bin-lib/hooks/sweep-shadow.test.js` (rows 2-5)
- Modify: `tests/bin-lib/init/release-bootstrap.test.js` (row 6)
- Modify: `tests/bin-lib/residue/artifacts.test.js` (row 7)

**Interfaces:**
- Consumes: Task 1's `chmodDenialSkip(reason)`.

- [ ] **Step 1: Record the Linux baseline** — Run: `node --test tests/bin-lib/code-health/scope.test.js tests/bin-lib/hooks/sweep-shadow.test.js tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/residue/artifacts.test.js` and note the `# pass` / `# skipped` counts.
- [ ] **Step 2: Convert** each mapped test's options argument from `skipUnderRoot('{reason}')` to `chmodDenialSkip('{reason}')` (same reason string), adding `chmodDenialSkip` to the file's existing `require('…/helpers/root')` destructure. Drop `skipUnderRoot` from the destructure only when the file has no remaining use of it.
- [ ] **Step 3: Verify (AC1.1, AC2.1)** — Run the Step 1 command again. Expected: `# fail 0`, `# pass` and `# skipped` identical to Step 1. Then Run: `node --test tests/permission-sim-root-skip-conformance.test.js` — Expected: PASS.
- [ ] **Step 4: Commit** the four files: `Skip the chmod denial tests on win32 in code-health, sweep-shadow, release-bootstrap and residue artifacts (refs #4290)`.

### Task 3 [batch]: Convert denial tests 8-13 (curation-judge, hooks-dispatcher, worktree-detect, reconcile)

**Files:**
- Modify: `tests/curation-judge-stagepath.test.js` (row 8)
- Modify: `tests/hooks-dispatcher.test.js` (rows 9-10)
- Modify: `tests/hooks-worktree-detect.test.js` (rows 11-12)
- Modify: `tests/reconcile.test.js` (row 13)

**Interfaces:**
- Consumes: Task 1's `chmodDenialSkip(reason)`.

- [ ] **Step 1: Record the Linux baseline** — Run: `node --test tests/curation-judge-stagepath.test.js tests/hooks-dispatcher.test.js tests/hooks-worktree-detect.test.js tests/reconcile.test.js` and note `# pass` / `# skipped`.
- [ ] **Step 2: Convert** exactly as Task 2 Step 2. `tests/reconcile.test.js` also holds exec-bit chmods at ~:2414/~:2457/~:2933 (not denials) — leave them untouched; the file keeps satisfying the scan through its helper import plus `chmodDenialSkip(`.
- [ ] **Step 3: Verify (AC1.1, AC2.1)** — the Step 1 command again: `# fail 0`, counts identical; then the conformance suite passes.
- [ ] **Step 4: Commit** the four files: `Skip the chmod denial tests on win32 in curation-judge, hooks-dispatcher, worktree-detect and reconcile (refs #4290)`.

### Task 4: Guard the install-statusline-wrapper mode assertions with MODE_BITS_HONORED

**Files:**
- Modify: `tests/install-statusline-wrapper.test.js`

**Interfaces:**
- Consumes: Task 1's `MODE_BITS_HONORED`.

- [ ] **Step 1: Record the Linux baseline** — Run: `node --test tests/install-statusline-wrapper.test.js`; note counts.
- [ ] **Step 2: Guard** only these three assertions with `if (MODE_BITS_HONORED)` (`const { MODE_BITS_HONORED } = require('./helpers/root');`):
  - :62 `assert.strictEqual(stat.mode & 0o777, 0o755);` (test "installWrapper writes the wrapper script under the injected homedir")
  - :113 the `0o644` precondition and :118 the `0o755` restore assertion (test "installWrapper restores 0o755 when re-run …").
  Every other assertion in both tests stays unconditional. The `// root-safe` chmod at :112 keeps its marker.
- [ ] **Step 3: Verify (AC1.1)** — the Step 1 command: `# fail 0`, counts identical (no skip added); conformance suite passes.
- [ ] **Step 4: Commit**: `Guard the statusline wrapper's mode-bit assertions with MODE_BITS_HONORED — win32 reads 0o666 (refs #4290)`.

### Task 5 [batch]: Migrate the two named ad-hoc guards and four more to chmodDenialSkip

**Files:**
- Modify: `tests/skill-load-report-cli.test.js` — `CHMOD_DENIAL_SKIP` (:112-113, uses :115, :128) → `const CHMOD_DENIAL_SKIP = chmodDenialSkip('mode bits are ignored under root');`
- Modify: `tests/bin-lib/reconcile/ledger-residue.test.js` — the inline options at :290-291 → `chmodDenialSkip('root ignores mode bits')`
- Modify: `tests/bin-lib/stage-item/ledger.test.js` — `SKIP_PERMS` (:13; used as `{ skip: SKIP_PERMS }` at :170, :230, :284) → `const SKIP_PERMS = chmodDenialSkip('chmod is ignored under root').skip;`
- Modify: `tests/bin-lib/console/cli.test.js` — `NO_POSIX_PERMISSIONS` (:704) → `chmodDenialSkip('a root runner ignores directory mode bits')`

**Interfaces:**
- Consumes: Task 1's `chmodDenialSkip(reason)`.

- [ ] **Step 1: Record the Linux baseline** — Run: `node --test tests/skill-load-report-cli.test.js tests/bin-lib/reconcile/ledger-residue.test.js tests/bin-lib/stage-item/ledger.test.js tests/bin-lib/console/cli.test.js`; note counts.
- [ ] **Step 2: Migrate** each guard as listed, keeping each test's own root reason; no `process.platform === 'win32'` chmod guard remains in these files.
- [ ] **Step 3: Verify (AC1.1)** — the Step 1 command: `# fail 0`, counts identical; conformance suite passes; `git grep -n "process.platform === 'win32'" -- tests/skill-load-report-cli.test.js tests/bin-lib/reconcile/ledger-residue.test.js tests/bin-lib/stage-item/ledger.test.js tests/bin-lib/console/cli.test.js` prints no line that sits in a chmod skip.
- [ ] **Step 4: Commit**: `Migrate four ad-hoc win32 chmod skips to chmodDenialSkip (refs #4290)`.

### Task 6 [batch]: Migrate the remaining five ad-hoc win32 chmod guards

**Files:**
- Modify: `tests/bin-lib/reconcile/reap-merged.test.js` — `MID_DELETE_SKIP` (:625-627; uses :645, :725, :759, :823) → `chmodDenialSkip('root bypasses mode bits')`. Leave `PATH_STUB_SKIP` alone (#4285 owns it).
- Modify: `tests/bin-lib/wrap-up/verify-json-cli.test.js` — `unwritableSkip` (:131) → `chmodDenialSkip('root ignores directory permissions')`
- Modify: `tests/bin-lib/wrap-up/finish-console-cli.test.js` — `unreadableSkip` (:402) → `chmodDenialSkip('root ignores file permissions')`
- Modify: `tests/bin-lib/run-liveness/index.test.js` — inline options at :377 → `chmodDenialSkip('chmod 000 is not a denial under root')`
- Modify: `tests/bin-lib/timing/cli.test.js` — inline options at :178 → `chmodDenialSkip('root ignores file permissions')`

**Interfaces:**
- Consumes: Task 1's `chmodDenialSkip(reason)`.

- [ ] **Step 1: Record the Linux baseline** — Run: `node --test tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/wrap-up/verify-json-cli.test.js tests/bin-lib/wrap-up/finish-console-cli.test.js tests/bin-lib/run-liveness/index.test.js tests/bin-lib/timing/cli.test.js`; note counts.
- [ ] **Step 2: Migrate** as listed.
- [ ] **Step 3: Verify (AC1.1)** — Step 1 command: `# fail 0`, counts identical; conformance suite passes.
- [ ] **Step 4: Commit**: `Migrate the remaining win32 chmod skips to chmodDenialSkip (refs #4290)`.

### Task 7: Windows proof (verification only — run by the controller, not an implementer)

- [ ] **Step 1 (AC1.1):** Run the spec's AC1 command on Linux: `node --test tests/bin-lib/code-health/scope.test.js tests/bin-lib/hooks/sweep-shadow.test.js tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/residue/artifacts.test.js tests/curation-judge-stagepath.test.js tests/hooks-dispatcher.test.js tests/hooks-worktree-detect.test.js tests/install-statusline-wrapper.test.js tests/reconcile.test.js tests/permission-sim-root-skip-conformance.test.js tests/skill-load-report-cli.test.js tests/bin-lib/reconcile/ledger-residue.test.js` — Expected: `# fail 0`.
- [ ] **Step 2: Windows run.** Dispatch `windows-regression.yml` on the branch after the last code change and download `verify-report`.
  - AC4.1: for each of the 9 files, the isolated log's `not ok` names include no chmod-denial or mode-bit test, and `baselineAdjudicated.attributable` is `[]` (no newly failing file).
  - AC4.2: each skipped test in those files prints `# SKIP win32: chmod does not deny access`.
