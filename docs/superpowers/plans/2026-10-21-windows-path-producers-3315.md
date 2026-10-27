# Windows Path Producers (#3315) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin and fix the latent Windows path faults #2767's class map left untested, so each site's win32 behaviour is proven on a POSIX host.

**Architecture:** Each site gains an injected stdlib path module (`pathImpl`, default the native `path`), following `.claude/skills/windows-checkout-test-parity`'s "Inject the OS-aware stdlib module itself" pattern. Display IDs are normalized at the producer with `toPosix` from `plugin/bin/lib/shared-primitives.js`. Paths later opened with `fs` stay native. Tests pass `path.win32` (or `path.win32.delimiter`) and pin exact strings. `process.platform` is never stubbed.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T001546-record-3315/work/3315-spec.md`

**Provenance:** authored by attempt 1 (run `2026-10-21T041646-record-3315`, commit `9342f0653`, closed PR #3851 — that attempt stopped only because its session had no subagent dispatch tool). Re-adopted by run `2026-10-22T001546-record-3315` after re-verifying every cited site against `main` at `34021e305`; line numbers below are refreshed to that base.

**Caller enumeration (grep `-e isProcedurePath -e computeInboundReferences -e "splitOversized(" -e "probeWorktrees(" -e "checkA(" -e "checkB(" plugin/bin`, run at 34021e305):** `plugin/bin/residue.js:135` (`probeWorktrees`), `plugin/bin/docs-health.js:304` (`computeInboundReferences`), `plugin/bin/plan-audit.js:166-167` (`checkA`/`checkB`), `plugin/bin/lib/skill-audit/transcript-load.js:118` and `plugin/bin/lib/timing/transcript.js:168` (`isProcedurePath`), `plugin/bin/lib/code-health/scope.js:70` (`splitOversized`). Every caller keeps the default `pathImpl`. `REAPER_DOMAIN` (grep `plugin tests`) has no consumer outside `worktrees.js`.

Scope keywords: isProcedurePath, REAPER_DOMAIN, splitOversized, computeInboundReferences, nearestExistingAncestor

## Global Constraints

- Inject `path.win32` / `path.win32.delimiter` at the seam. Never stub `process.platform` (the spec says so verbatim).
- Every new test fails with its site's fix reverted and passes with it (AC1.1). Each task's Step 2 is that proof.
- `npm test` stays green on ubuntu (AC2.1). Common Step 5 runs it.
- The default `pathImpl` must be the native `path`, so POSIX behaviour and every existing caller are unchanged.
- Out of scope: `archive-merged`. The record says it needs a real Windows run before it can be classified.

Waived AC2.1: proven by `/claude-tweaks:build` Common Step 5's full `npm test` run (and the `/claude-tweaks:test` gate), not a per-task test.

**Scope-keyword hits reviewed, no change needed (plan-audit Check B):**
- `plugin/bin/docs-health.js:304` and `plugin/bin/lib/skill-audit/transcript-load.js:118` are callers. They keep the default `pathImpl`, so their behaviour is unchanged.
- `tests/path-guard-conformance.test.js:135` pins `checks.js`'s `existsSync` count (7). Task 1 adds no `existsSync`, so the pin holds. Re-run that suite in Task 1's Step 4.
- `plugin/skills/code-health/focus-mode.md`, `plugin/skills/_shared/criteria-docs-diataxis.md`, `plugin/skills/build/plan-audit.md` and the #2767 plan only describe these functions. No described behaviour changes.
- `tests/skill-load-report-cli.test.js:39` carries a comment asserting today's win32 bug as behaviour; Task 5 rewords it (added under `scope-creep: add-to-plan`, run `2026-10-22T001546-record-3315`).

## Review Focus

1. A path that git prints with forward slashes on Windows (`C:/repo/.claude/worktrees/x`) and one with backslashes must both count as in the reaper domain. Task 4 pins both.
2. A nested subdirectory two levels under an oversized code-health candidate must still get its own slice on win32. Task 3 pins `big/one/deeper`.
3. A Windows `file_path` read from the installed plugin cache (`C:\Users\x\.claude\plugins\cache\...\skills\...md`) must count as procedure bytes, and a non-skill `.md` under the worktree must not. Task 5 pins both.
4. The empty relative path (`relative(x, x)`) must still produce `'.'` for plan-audit's `nearestExistingAncestor`. Task 1's site test keeps the existing `|| '.'` reachable.
5. The `cloud-setup-drift-check` suite must not report a false failure on Windows. Its `#!/bin/sh` curl stub and `bash -c` cases skip there with a stated reason (Task 6).

---

### Task 1: Shared `relativeDisplayId` helper and plan-audit display IDs

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js` (beside `toPosix`, line ~217; export it)
- Modify: `plugin/bin/lib/plan-audit/checks.js` (`checkA` lines 80-150 — the two `nearestExistingAncestor` producers at 117 and 140; `checkB` lines 170-190 — `unplanned.add` at 186)
- Test: `tests/bin-lib/shared-primitives.test.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`

**Interfaces:**
- Produces: `relativeDisplayId(from: string, to: string, pathImpl = path): string` from `plugin/bin/lib/shared-primitives.js`. It returns `toPosix(pathImpl.relative(from, to), pathImpl.sep)`.
- Produces: `checkA(entries, repoRoot, { pathImpl = path } = {})` and `checkB(scopeKeywords, plannedPaths, repoRoot, { pathImpl = path } = {})`. `pathImpl` feeds only `relativeDisplayId`; every `fs` path stays on the native `path`. `plugin/bin/plan-audit.js`'s calls are unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/shared-primitives.test.js`:

```js
test('AC1.1: relativeDisplayId joins a win32 relative path with forward slashes (#3315)', () => {
  assert.strictEqual(relativeDisplayId('C:\\repo', 'C:\\repo\\plugin\\bin\\x.js', path.win32), 'plugin/bin/x.js');
  assert.strictEqual(relativeDisplayId('C:\\repo', 'C:\\repo', path.win32), '');
});
test('relativeDisplayId is plain path.relative under path.posix (#3315)', () => {
  assert.strictEqual(relativeDisplayId('/repo', '/repo/a/b.md', path.posix), 'a/b.md');
});
```

In `tests/bin-lib/plan-audit/checks.test.js`, use a tmp repo (the file's existing fixture helper) with `plugin/bin/` existing:

```js
test('AC1.1: checkA reports nearestExistingAncestor as a / display ID under path.win32 (#3315)', () => {
  // Create: plugin/bin/new/deeper/x.js -> two missing levels -> reported missing
  const r = checkA([{ type: 'Create', path: 'plugin/bin/new/deeper/x.js' }], root, { pathImpl: path.win32 });
  assert.strictEqual(r.missingDetail[0].nearestExistingAncestor, 'plugin/bin');
});
test('AC1.1: checkB lists unplanned files as / display IDs under path.win32 (#3315)', () => {
  // plugin/bin/hit.js contains the keyword and is not planned
  const r = checkB(['zebrakeyword'], [], root, { pathImpl: path.win32 });
  assert.deepStrictEqual(r.unplanned, ['plugin/bin/hit.js']);
});
```

`path.win32.relative` on a POSIX host resolves both POSIX absolute paths against a drive-less root, so it returns `plugin\bin` for real tmp paths. That is why these site tests reach the win32 branch with real `fs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/shared-primitives.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: the `relativeDisplayId` tests FAIL (not exported). The two `checkA`/`checkB` tests may pass here, because an ignored option falls back to the host `path`, which already gives `/` on POSIX. Their go-red proof is Step 5's revert control, not this run.

- [ ] **Step 3: Implement**

Add `relativeDisplayId` and export it. In `checkA`, compute both `nearestExistingAncestor` values as `relativeDisplayId(repoRoot, nearestExistingAncestor(...), pathImpl) || '.'`. In `checkB`, compute `unplanned.add(relativeDisplayId(repoRoot, file, pathImpl))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/shared-primitives.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Revert control.** Temporarily remove `toPosix` from `relativeDisplayId` (return `pathImpl.relative(from, to)`) and re-run Step 2's command. Expected: the three `AC1.1` tests FAIL. Restore the fix.

- [ ] **Step 6: Commit** — `git add` the four files; message `Normalize plan-audit display IDs to / under win32 — relativeDisplayId helper (refs #3315)`.

### Task 2: findability `referencedBy` display IDs

**Files:**
- Modify: `plugin/bin/lib/docs-health/findability.js:31-88` (`referencedBy.push` at 82)
- Test: `tests/bin-lib/docs-health/findability.test.js`

**Interfaces:**
- Consumes: `relativeDisplayId(from, to, pathImpl)` (Task 1).
- Produces: `computeInboundReferences(docId, root, { pathImpl = path } = {})`. `pathImpl` feeds only the `referencedBy` entry. Line 76's `relFromCandidate` is already normalized and stays as it is. `plugin/bin/docs-health.js:304` is unchanged.

- [ ] **Step 1: Write the failing test**

```js
test('AC1.1: referencedBy entries are / display IDs under path.win32 (#3315)', () => {
  // tmp root: docs/api/config.md, plus docs/guide/howto.md containing "../api/config.md"
  const r = computeInboundReferences('api/config', root, { pathImpl: path.win32 });
  assert.deepStrictEqual(r.referencedBy, ['docs/guide/howto.md']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/docs-health/findability.test.js`
Expected: this may PASS before the fix, because the ignored option falls back to the host `path`, which already gives `/` on POSIX. The go-red proof is Step 4b.

- [ ] **Step 3: Implement** — `referencedBy.push(relativeDisplayId(root, file, pathImpl))`.

- [ ] **Step 4: Run the test to verify it passes** — same command, PASS.

- [ ] **Step 4b: Revert control.** Temporarily replace the call with `pathImpl.relative(root, file)` (injected, no `toPosix`) and re-run. Expected: FAIL with `docs\guide\howto.md`. Restore the fix.

- [ ] **Step 5: Commit** — message `Normalize findability referencedBy to / display IDs under win32 (refs #3315)`.

### Task 3: code-health `splitOversized` keys on win32

**Files:**
- Modify: `plugin/bin/lib/code-health/scope.js:101-159` (`relDir` at 123, ancestor walk at 128-135; and export `splitOversized`)
- Test: `tests/bin-lib/code-health/scope.test.js` (the "listSlices byte cap (splitOversized)" section, line ~604)

**Interfaces:**
- Produces: `splitOversized(id, absDir, out, { pathImpl = path, listFiles = (dir) => sourceFiles(dir, { recursive: true }), sizeOf = (f) => fs.statSync(f).size } = {})`, exported. `listSlices`' call is unchanged. `sizeOf` keeps today's throw-to-0 fallback.

- [ ] **Step 1: Write the failing test**

```js
test('AC1.1: splitOversized keeps a nested win32 subdirectory as its own slice (#3315)', () => {
  const big = 20 * 1024; // two of these exceed MAX_SLICE_BYTES (30 KiB), reaching the split branch
  const files = ['C:\\c\\big\\own.js', 'C:\\c\\big\\one\\b.js', 'C:\\c\\big\\one\\deeper\\a.js', 'C:\\c\\big\\two\\c.js'];
  const sizes = { 'C:\\c\\big\\two\\c.js': 1 };
  const out = [];
  splitOversized('big', 'C:\\c\\big', out, { pathImpl: path.win32, listFiles: () => files, sizeOf: (f) => sizes[f] ?? big });
  assert.deepStrictEqual(out, [
    { id: 'big', path: 'C:\\c\\big', recursive: false },
    { id: 'big/one', path: 'C:\\c\\big\\one', recursive: false },
    { id: 'big/one/deeper', path: 'C:\\c\\big\\one\\deeper', recursive: true },
    { id: 'big/two', path: 'C:\\c\\big\\two', recursive: true },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/code-health/scope.test.js`
Expected: FAIL after Step 1 (`splitOversized` is not exported). The revert form, with `pathImpl` wired but `relDir` left native, drops the `big/one/deeper` slice because `walk` looks up `one/deeper` while the node is keyed `one\deeper`.

- [ ] **Step 3: Implement.** Compute `relDir` as `toPosix(pathImpl.relative(absDir, pathImpl.dirname(file)), pathImpl.sep)`. Walk ancestors with `path.posix.dirname` and `path.posix.basename`, since the node keys are `/` IDs. Build each slice path with `pathImpl.join(absDir, rel)` (native, because it is opened later).

- [ ] **Step 4: Run the test to verify it passes** — same command, PASS (existing split tests included).

- [ ] **Step 5: Commit** — message `Key splitOversized nodes on / IDs so win32 nested slices survive (refs #3315)`.

### Task 4: residue worktrees reaper-domain check

**Files:**
- Modify: `plugin/bin/lib/residue/probes/worktrees.js` (line 28's constant; `probeWorktrees`, lines 120-142)
- Test: `tests/bin-lib/residue/probes-git.test.js`

**Interfaces:**
- Produces: `REAPER_DOMAIN = '.claude/worktrees'` (a `/` ID, no longer `path.join`; it has no consumer outside this file). `probeWorktrees({ ..., pathImpl = path })`, where `reaped = toPosix(wt.path, pathImpl.sep).includes(REAPER_DOMAIN)`.

- [ ] **Step 1: Write the failing test**

```js
test('AC1.1: probeWorktrees counts both git-style and native win32 paths as in the reaper domain (#3315)', () => {
  const scope = { ran: true, headBranch: 'main', worktrees: [
    { path: 'C:/repo', branch: 'main' },
    { path: 'C:/repo/.claude/worktrees/a', branch: 'a', locked: false },
    { path: 'C:\\repo\\.claude\\worktrees\\b', branch: 'b', locked: false },
    { path: 'C:\\elsewhere\\c', branch: 'c', locked: false },
  ] };
  const { findings } = probeWorktrees({ scope, isDirty: () => false, pathImpl: path.win32 });
  const ev = findings.map((f) => f.evidence);
  assert.match(ev[0], /, in reaper domain$/);
  assert.match(ev[1], /, in reaper domain$/);
  assert.match(ev[2], /outside reaper domain/);
});
```

Match the scope shape the file's existing `SCOPE` fixture uses if it differs from the one above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/residue/probes-git.test.js`
Expected: FAIL after Step 1. On a POSIX host today's code misses `b`; with `pathImpl.join` it would miss `a`.

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run the test to verify it passes** — same command, PASS.

- [ ] **Step 5: Commit** — message `Match the reaper domain on / IDs so win32 worktree paths classify (refs #3315)`.

### Task 5: timing `isProcedurePath` input separator

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js:93-99`
- Modify: `tests/skill-load-report-cli.test.js:38-40` (comment only — it states "a backslash path is never seen as a skill-file Read", which this task makes false; reword to say the posix fixture form is kept for portability, not because a backslash path is unrecognized. The fixture code itself stays unchanged.)
- Test: `tests/bin-lib/timing/transcript.test.js` (beside the #1929 test, line ~159)

**Interfaces:**
- Produces: `isProcedurePath(filePath, worktree, pathImpl = path)`. Both `filePath` and `worktree` pass through `toPosix(x, pathImpl.sep)` before the existing prefix strip and regexes. The callers (`transcript.js:168`, `skill-audit/transcript-load.js:118`) are unchanged.

- [ ] **Step 1: Write the failing test**

```js
test('AC1.1: isProcedurePath matches win32 skill paths and nothing else (#3315)', () => {
  const W = path.win32;
  assert.equal(isProcedurePath('C:\\repo\\plugin\\skills\\review\\SKILL.md', 'C:\\repo', W), true);
  assert.equal(isProcedurePath('plugin\\skills\\_shared\\x.md', 'C:\\repo', W), true);
  assert.equal(isProcedurePath('C:\\Users\\x\\.claude\\plugins\\cache\\m\\claude-tweaks\\6.0.0\\skills\\flow\\multi-spec.md', 'C:\\repo', W), true);
  assert.equal(isProcedurePath('C:\\repo\\docs\\notes.md', 'C:\\repo', W), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/timing/transcript.test.js`
Expected: FAIL after Step 1 (the first three return `false`).

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run the test to verify it passes** — same command plus `node --test tests/bin-lib/skill-audit/`, PASS.

- [ ] **Step 5: Commit** — message `Normalize isProcedurePath input so win32 transcripts count procedure reads (refs #3315)`.

### Task 6: `cloud-setup-drift-check` PATH delimiter and shell-stub skips

**Files:**
- Modify: `tests/cloud-setup-drift-check.test.js` (line 171's `PATH` join; every test that runs the `#!/bin/sh` curl stub or `bash -c`)

**Interfaces:**
- Produces: a file-local `prependPath(dir, envPath, delimiter = path.delimiter)` that returns `${dir}${delimiter}${envPath}`, used at line 171.

- [ ] **Step 1: Write the failing test**

```js
test('AC1.1: prependPath joins PATH with the platform delimiter (#3315)', () => {
  assert.strictEqual(prependPath('C:\\stub', 'C:\\Windows', path.win32.delimiter), 'C:\\stub;C:\\Windows');
  assert.strictEqual(prependPath('/stub', '/usr/bin', path.posix.delimiter), '/stub:/usr/bin');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/cloud-setup-drift-check.test.js`
Expected: FAIL after Step 1 (`prependPath` is not defined). A revert to a hardcoded `':'` fails the win32 assertion.

- [ ] **Step 3: Implement.** Define `prependPath` and use it at line 171. Give every test that spawns the stub runner or `bash` the option `{ skip: process.platform === 'win32' && 'win32: the fake curl is a #!/bin/sh stub and the snippet runs under bash; neither executes under cmd.exe' }`. Before choosing that set, grep the file for the stub-runner helper and `'bash'`. The skip is a recorded not-a-bug verdict for the stubs, as the spec allows, and is not a stub of `process.platform`.

- [ ] **Step 4: Run the test to verify it passes** — same command, PASS (every case runs on ubuntu).

- [ ] **Step 5: Commit** — message `Join cloud-setup-drift-check PATH with path.delimiter; skip sh stubs on win32 (refs #3315)`.
