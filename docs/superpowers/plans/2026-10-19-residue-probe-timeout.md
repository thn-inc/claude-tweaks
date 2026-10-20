# Residue probe timeout headroom (#3479) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the wrap-up fact pack's residue probe from timing out in a many-worktree checkout, and make a timeout name itself when one does happen.

**Architecture:** `residue.js --scope blast-radius` spends most of its wall clock (measured: ~15 s of 14–30 s with 60–68 worktrees) in `probeWorktrees` running one sequential `git status --porcelain` per unlocked worktree. Every finding that probe emits is `scope: 'observed'`, and `filterResultsByScope` drops all `observed` findings under `--scope blast-radius`, so that work is thrown away. Task 1 makes the probe skip that work when the CLI scope is `blast-radius`. Task 2 makes `pack.js` re-word a subprocess timeout kill (Node rejects with `killed: true`, `signal: 'SIGTERM'`, message `Command failed: …`) into an error naming the timeout.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185553-record-3479/work/3479-spec.md` (materialized from GitHub issue #3479)

## Global Constraints

- `EXEC_OPTS` in `plugin/bin/lib/wrap-up/pack.js` stays `{ maxBuffer: 32 * 1024 * 1024, timeout: 30000 }` — the existing test `gatherPack: every subprocess call is bounded by maxBuffer and a timeout` pins both values.
- `--scope repo` (residue.js's default) output must be byte-for-byte unchanged — only `--scope blast-radius` skips work.
- Commit messages: `{Verb} {what} — {detail}`, body line `refs #3479` (never `closes`/`fixes`).

## Review Focus

- A `maxBuffer` overflow (`code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`, no `killed` flag) must keep its own message, not be relabeled as a timeout — Task 2 test `a maxBuffer overflow is not relabeled as a timeout`.
- `gh` absent (`code: 'ENOENT'`) must still surface as `gh-absent` after the helper wraps `gh()` — covered by the existing `gh-absent` test in `pack.test.js` (line ~1083); Task 2 Step 4 runs it.
- A probe that never settles is still bounded by the outer `withTimeout` race and already reads `timeout after {ms}ms` — Task 2 test `a residue subprocess that never settles reports a timeout` pins it for the residue probe specifically.
- `probeWorktrees` called with no `cliScope` (any caller other than residue.js — today none, but the export is public) keeps today's full behavior — Task 1 test `without cliScope, the dirty check still runs`.
- `--scope blast-radius` must still report the worktree probe as `ran: true` (an empty, ran result), never `ran: false`/`unknown` — Task 1 test asserts `ran === true`.

---

### Task 1: Skip discarded worktree dirty checks under `--scope blast-radius`

**Files:**
- Modify: `plugin/bin/lib/residue/probes/worktrees.js` (`probeWorktrees`, ~line 115)
- Modify: `plugin/bin/residue.js` (the `probeWorktrees({ scope })` call in `main()`)
- Test: `tests/bin-lib/residue/probes-git.test.js`

**Interfaces:**
- Produces: `probeWorktrees({ scope, isPidAlive?, isDirty?, cliScope? })` → `{ ran, reason, findings }`. `cliScope` is the residue CLI's `--scope` value (`'repo' | 'blast-radius' | undefined`).

- [ ] **Step 1: Write the failing tests** (append near the other `probeWorktrees` tests, reusing the file's `SCOPE` fixture)

```js
test('under --scope blast-radius the probe runs no per-worktree dirty or liveness check and reports no findings (#3479)', () => {
  let dirtyCalls = 0; let pidCalls = 0;
  const r = probeWorktrees({ scope: SCOPE, cliScope: 'blast-radius', isDirty: () => { dirtyCalls += 1; return false; }, isPidAlive: () => { pidCalls += 1; return true; } });
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.reason, null);
  assert.deepStrictEqual(r.findings, []);
  assert.strictEqual(dirtyCalls, 0);
  assert.strictEqual(pidCalls, 0);
});

test('without cliScope, the dirty check still runs for every unlocked sibling worktree (#3479)', () => {
  const seen = [];
  probeWorktrees({ scope: SCOPE, isDirty: (p) => { seen.push(p); return false; } });
  assert.deepStrictEqual(seen, ['/repo/.claude/worktrees/done', '/repo/.worktrees/fallback']);
});

test('the blast-radius short-circuit matches what filterResultsByScope would have kept (#3479)', () => {
  const full = probeWorktrees({ scope: SCOPE, isDirty: () => false, isPidAlive: () => true });
  const [filtered] = filterResultsByScope([full], 'blast-radius');
  assert.deepStrictEqual(probeWorktrees({ scope: SCOPE, cliScope: 'blast-radius' }), filtered);
});
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `node --test tests/bin-lib/residue/probes-git.test.js`
Expected: FAIL — `dirtyCalls` is 2 and `findings` is non-empty in the first new test (the other two already pass; they pin unchanged behavior).

- [ ] **Step 3: Implement**

In `probeWorktrees`, after the `!scope.ran` guard: when `cliScope === 'blast-radius'`, return `{ ran: true, reason: null, findings: [] }`. Comment why: every finding this probe emits is `scope: 'observed'` by construction, and `filterResultsByScope` drops all of them under `blast-radius`, so the per-worktree `git status` (one sequential subprocess per unlocked worktree, ~15 s at 60 worktrees) would be discarded (#3479). In `residue.js` `main()`, pass `cliScope: opts.scope` to `probeWorktrees`.

- [ ] **Step 4: Run the residue suites**

Run: `node --test tests/bin-lib/residue/*.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Measure on the real checkout**

Run (from the worktree root): `/usr/bin/time -p node plugin/bin/residue.js --base "$(git merge-base HEAD origin/main)" --integration-branch origin/main --scope blast-radius --no-suite --json > /dev/null`
Expected: `real` well under 15 s (it measured 14.2 s before this change, ~2 s of which is the other probes).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/residue/probes/worktrees.js plugin/bin/residue.js tests/bin-lib/residue/probes-git.test.js
git commit -m "Skip discarded worktree dirty checks under residue --scope blast-radius — the observed findings were filtered out anyway" -m "refs #3479"
```

---

### Task 2: Name the timeout when a pack subprocess is killed by `EXEC_OPTS.timeout`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (new helper near `EXEC_OPTS`; the four `deps.execFile(..., { cwd: inputs.worktree, ...EXEC_OPTS })` call sites in `buildProbes`: the `gh()` wrapper, `state`, `residue`, `unblocked`)
- Test: `tests/bin-lib/wrap-up/pack.test.js`

**Interfaces:**
- Produces: module-local `execBounded(deps, cmd, args, cwd)` → `Promise<{ stdout, stderr }>`; on a rejection with `err.killed === true` it throws `new Error(\`timeout after ${EXEC_OPTS.timeout}ms: ${cmd} ${label} (killed by ${err.signal})\`)` where `label` is `path.basename(args[0])` for `node` and `args[0]` for `gh`; every other rejection is rethrown unchanged. Not exported.

- [ ] **Step 1: Write the failing tests** (use the file's existing `okDeps`/`fixtureRunDir` helpers)

```js
test('gatherPack: a residue subprocess killed by the exec timeout reports a timeout, not "Command failed" (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (String(args[0]).endsWith('residue.js')) { const e = new Error(`Command failed: node ${args[0]}`); e.killed = true; e.signal = 'SIGTERM'; e.code = null; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /^timeout after 30000ms: node residue\.js \(killed by SIGTERM\)$/);
});

test('gatherPack: a residue subprocess that never settles reports a timeout (#3479)', async () => {
  const deps = okDeps({ probeTimeoutMs: 25, execFile: async (cmd, args) => (String(args[0]).endsWith('residue.js') ? new Promise(() => {}) : okDeps().execFile(cmd, args)) });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /timeout after 25ms/);
});

test('gatherPack: a maxBuffer overflow is not relabeled as a timeout (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (String(args[0]).endsWith('residue.js')) { const e = new Error('stdout maxBuffer length exceeded'); e.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.error, 'stdout maxBuffer length exceeded');
});

test('gatherPack: a gh call killed by the exec timeout names gh and the timeout (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (cmd === 'gh') { const e = new Error('Command failed: gh pr view'); e.killed = true; e.signal = 'SIGTERM'; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['pr'], deps });
  assert.match(pack.pr.error, /^timeout after 30000ms: gh pr \(killed by SIGTERM\)$/);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js`
Expected: FAIL — the first and fourth new tests (error is `Command failed: …`); the second and third already pass and pin unchanged behavior.

- [ ] **Step 3: Implement `execBounded` and route all four call sites through it**

Keep `gh()`'s `ENOENT` → `gh-absent` mapping (an ENOENT rejection has no `killed` flag, so it passes through `execBounded` unchanged). A short comment on the helper: Node reports a timeout kill as the generic `Command failed: …`, which reads as a crash and hid #3479's 0.5 s of headroom.

- [ ] **Step 4: Run the wrap-up suites**

Run: `node --test tests/bin-lib/wrap-up/*.test.js`
Expected: PASS, 0 failures (including the existing `every subprocess call is bounded by maxBuffer and a timeout`, `residue exploded`, and `gh-absent` tests).

- [ ] **Step 5: Live pack check (AC 1)**

Run (from the worktree root): `node plugin/bin/wrap-up-pack.js --run "$PIPELINE_RUN_DIR" --only residue --print residue` (or `--json` to a scratch path and read `residue.ok`/`residue.durationMs`).
Expected: `residue.ok === true` and `residue.durationMs < 15000` (under half of the 30 s timeout).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js tests/bin-lib/wrap-up/pack.test.js
git commit -m "Name the timeout when a wrap-up pack subprocess is killed — replaces Node's generic Command failed text" -m "refs #3479"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (cheaper `--scope blast-radius`) → Task 1; Deliverable 2 (timeout names itself) → Task 2. AC 1 (ok:true, duration under half the timeout) → Task 1 Step 5 + Task 2 Step 5; AC 2 (forced timeout via injected `deps.execFile`, never-resolving or kill signal) → Task 2 tests 1 and 2; AC 3 (`node --test` for the wrap-up pack suites) → Task 2 Step 4.
- **Placeholders:** none.
- **Return-shape widening:** none — `probeWorktrees` gains an optional input; its return shape is unchanged.
