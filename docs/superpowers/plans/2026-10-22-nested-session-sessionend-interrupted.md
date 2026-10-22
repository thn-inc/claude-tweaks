# Nested-Session SessionEnd Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nested `claude -p` session ending inside a pipeline session no longer stamps the parent's run `interrupted`, while a genuine owner SessionEnd still does.

**Architecture:** `record-worktree` stamps the owning Claude Code process's pid (`ownerPid`, read from `CLAUDE_PID`) into `run-state.json`. `session-end.js` compares that against its own `CLAUDE_PID` and, when both are known and differ, writes nothing (no stamp, no event). Unknown on either side fails open to today's behaviour.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T033950-record-3845/work/3845-spec.md` (record #3845)

## Global Constraints

- A nested `claude -p` session ending inside an owning session leaves the parent run's `status` unchanged.
- A genuine owner SessionEnd still stamps `interrupted` (existing behaviour preserved).
- The new regression test fails before the fix and passes after; `npm test` passes.
- Hooks never break a session (`docs/hooks.md`): no new throw paths in `session-end.js`.
- Run-state is written only through `hooks.js` verbs (`record-worktree`), never directly by a skill.

**Measured premise (Spec Step 2 probe, Claude Code 2.1.302, logged to decisions.md):** Claude Code sets `CLAUDE_PID` to its own pid in every process it spawns. A nested `claude -p` run from a session's Bash tool had `CLAUDE_PID=45921` in both its hook env and its Bash env, while the parent had `8207`. The record's #3056 shape, where the child's SessionEnd carried the parent's `session_id`, did not reproduce locally (the child got a fresh id). That premise is unverified, which is why the guard keys on the process id and not the session id.

## Review Focus

1. Malformed `CLAUDE_PID` (`''`, `'abc'`, `'0'`, `'-5'`) reads as unknown, so the owner still gets stamped. Covered in Task 1.
2. `ownerPid` stored as a non-integer (e.g. the string `"8207"`) reads as unknown and fails open. Covered in Task 1.
3. An env-less re-record (`CLAUDE_PID` absent) must not clobber an existing `ownerPid`, the same rule `sessionId` follows. Covered in Task 2.
4. A resumer re-stamp from a different process updates `ownerPid`, so the resumer's own SessionEnd stamps. Covered in Task 2.
5. A nested session on an `env`- or `fallback`-attributed run also writes nothing, because the guard runs before attribution matters. Covered in Task 3.

---

### Task 1: `claudePid` / `isNestedSession` helpers in context.js

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js` (add two functions near `isTrustedOwnedRun`, add both to `module.exports`)
- Test: `tests/hooks-run-attribution.test.js` (new section `// ─── nested sessions (#3845) ───`)

**Interfaces:**
- Produces: `claudePid(env: object) -> number | null`. Returns a positive integer when `env.CLAUDE_PID` is a string matching `/^[1-9]\d*$/`, else `null`.
- Produces: `isNestedSession(runState: object | null, env: object) -> boolean`. True only when `runState.ownerPid` is a positive integer, `claudePid(env)` is non-null, and the two differ.

- [ ] **Step 1: Write the failing tests** (`tests/hooks-run-attribution.test.js`)

```js
test('#3845 claudePid: a positive integer string parses, anything else is unknown', () => {
  assert.strictEqual(ctxLib.claudePid({ CLAUDE_PID: '8207' }), 8207);
  for (const bad of [undefined, '', 'abc', '0', '-5', '12.5', ' 8207']) {
    assert.strictEqual(ctxLib.claudePid({ CLAUDE_PID: bad }), null, `CLAUDE_PID=${JSON.stringify(bad)}`);
  }
  assert.strictEqual(ctxLib.claudePid(undefined), null);
});

test('#3845 isNestedSession: only a known, differing pid pair is nested', () => {
  assert.strictEqual(ctxLib.isNestedSession({ ownerPid: 100 }, { CLAUDE_PID: '200' }), true);
  assert.strictEqual(ctxLib.isNestedSession({ ownerPid: 100 }, { CLAUDE_PID: '100' }), false);
  assert.strictEqual(ctxLib.isNestedSession({}, { CLAUDE_PID: '200' }), false, 'no ownerPid -> fail open');
  assert.strictEqual(ctxLib.isNestedSession({ ownerPid: 100 }, {}), false, 'no CLAUDE_PID -> fail open');
  assert.strictEqual(ctxLib.isNestedSession({ ownerPid: '100' }, { CLAUDE_PID: '200' }), false, 'string ownerPid -> fail open');
  assert.strictEqual(ctxLib.isNestedSession(null, { CLAUDE_PID: '200' }), false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-run-attribution.test.js`
Expected: FAIL with `ctxLib.claudePid is not a function`

- [ ] **Step 3: Implement both functions in `plugin/bin/lib/hooks/context.js`**

Add a comment block stating the measured premise (one process, one `CLAUDE_PID`, shared by its Bash tool and its hooks; a nested `claude -p` sets its own) and the fail-open rule. Export both.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-run-attribution.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js tests/hooks-run-attribution.test.js
git commit -m "Add claudePid/isNestedSession helpers — owner-process identity for run-state, refs #3845"
```

### Task 2: `record-worktree` stamps `ownerPid`

**Files:**
- Modify: `plugin/bin/hooks.js` (the `record-worktree` branch, right after the `patch.sessionId` line, ~line 705)
- Test: `tests/hooks-dispatcher.test.js` (append next to the existing record-worktree session-id stamp tests, ~line 513)

**Interfaces:**
- Consumes: `ctxLib.claudePid(env)` from Task 1.
- Produces: `run-state.json` field `ownerPid: number`. Written only when `claudePid(process.env)` is non-null; omitted otherwise, so an existing value is never clobbered.

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-dispatcher.test.js`)

```js
test('#3845: record-worktree stamps ownerPid from CLAUDE_PID and preserves it on an env-less re-record', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project, env: { CLAUDE_PID: '4242' } });
  assert.strictEqual(readRunState(run).ownerPid, 4242);
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project, env: { CLAUDE_PID: '' } });
  assert.strictEqual(readRunState(run).ownerPid, 4242, 'env-less re-record must not clobber ownerPid');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project, env: { CLAUDE_PID: '5151' } });
  assert.strictEqual(readRunState(run).ownerPid, 5151, 'a resumer re-stamp from another process takes ownership');
});

test('#3845: record-worktree without CLAUDE_PID writes no ownerPid', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-2'], { cwd: project, env: { CLAUDE_PID: '' } });
  assert.ok(!('ownerPid' in readRunState(run)));
});
```

(`runHook` spreads `process.env`, so every test pins `CLAUDE_PID` explicitly. The test runner itself may run under Claude Code.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-dispatcher.test.js`
Expected: FAIL (`ownerPid` is `undefined` in the two new tests)

- [ ] **Step 3: Add the `ownerPid` patch line in `plugin/bin/hooks.js`**

`const ownerPid = ctxLib.claudePid(process.env); if (ownerPid !== null) patch.ownerPid = ownerPid;` plus a one-line `#3845` comment.

- [ ] **Step 4: Run the whole dispatcher suite**

Run: `node --test tests/hooks-dispatcher.test.js`
Expected: PASS. The #3225 `--dispatch` byte-equality test stays green because both of its calls share one env.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-dispatcher.test.js
git commit -m "Stamp ownerPid in record-worktree — the owning Claude Code process for session-end, refs #3845"
```

### Task 3: session-end skips a nested session, plus docs

**Files:**
- Modify: `plugin/bin/lib/hooks/session-end.js`
- Modify: `docs/hooks.md` (the run-state field list in the run-dir state files bullet: add `ownerPid`; the "Two resolutions" bullet: one sentence on the session-end nested guard)
- Test: `tests/hooks-run-attribution.test.js` (unit), `tests/hooks-dispatcher.test.js` (end to end through `hooks.js session-end`)

**Interfaces:**
- Consumes: `ctxLib.isNestedSession(runState, env)` from Task 1 and the `ownerPid` field from Task 2.

- [ ] **Step 1: Write the failing tests**

Unit (`tests/hooks-run-attribution.test.js`). Set and restore `process.env.CLAUDE_PID` in a `try/finally` around each `sessionEnd.run`:

```js
test('AC1.1 #3845: a nested session ending (same session id, different CLAUDE_PID) leaves the parent run untouched', () => {
  // run-state { status: 'active', sessionId: 'me', ownerPid: 100 }, env CLAUDE_PID='200', input session_id 'me'
  // assert readState(mine).status === 'active'; assert readEvents(mine) deepEqual []
});
test('AC2.1 #3845: the owner process ending still stamps interrupted', () => {
  // same run-state, env CLAUDE_PID='100' -> status 'interrupted', one session-end event
});
test('#3845: a nested session on an env-attributed run also writes nothing', () => {
  // ownedRun { dir, attribution: 'env' } (resolveRun with { PIPELINE_RUN_DIR: dir }), ownerPid 100, CLAUDE_PID '200'
  // -> status 'active', no events
});
```

End to end (`tests/hooks-dispatcher.test.js`). Reuses `tmpProject()` and `runHook`:

```js
test('AC3.1 #3845: hooks.js session-end from a nested claude process (same session id, other CLAUDE_PID) leaves the run active; the owner process stamps it', () => {
  // record-worktree --run run /tmp/wt-1 with env { CLAUDE_CODE_SESSION_ID: 'owner', CLAUDE_PID: '100' }
  // runHook(['session-end'], { cwd: project, input: JSON.stringify({ session_id: 'owner', reason: 'other', cwd: project }), env: { CLAUDE_PID: '200' } })
  // assert readRunState(run).status === 'active'
  // runHook(['session-end'], { ..., env: { CLAUDE_PID: '100' } })
  // assert readRunState(run).status === 'interrupted'
});
```

- [ ] **Step 2: Run to verify the AC1.1 / AC3.1 / env-attributed tests fail and AC2.1 passes**

Run: `node --test tests/hooks-run-attribution.test.js tests/hooks-dispatcher.test.js`
Expected: AC1.1, the env-attributed test and AC3.1 FAIL (status `interrupted`). AC2.1 passes. That split is the before-fix evidence for AC3.1.

- [ ] **Step 3: Guard in `plugin/bin/lib/hooks/session-end.js`**

Read the run state once. If `ctxLib.isNestedSession(state, process.env)`, return `{}` before any write. Add a comment: a nested `claude -p` can carry the owner's session id (#3056's run), so its end is not this run's session ending. Neither the stamp nor the breadcrumb belongs to this run (the same treatment as a bystander). Keep the existing `fallback` rule unchanged.

- [ ] **Step 4: Update `docs/hooks.md`**

- Run-state field list: after "owning session id", add "owning Claude Code process id (`ownerPid`, from `CLAUDE_PID` at `record-worktree` time, #3845)".
- "Two resolutions" bullet: add one sentence. `session-end`'s `interrupted` stamp is additionally withheld, with no event written, when the run's `ownerPid` and the ending process's `CLAUDE_PID` are both known and differ (a nested `claude -p` started from the owner's session). Unknown on either side keeps the pre-#3845 behaviour.

- [ ] **Step 5: Run the touched suites**

Run: `node --test tests/hooks-run-attribution.test.js tests/hooks-dispatcher.test.js tests/hooks-lifecycle.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/session-end.js docs/hooks.md tests/hooks-run-attribution.test.js tests/hooks-dispatcher.test.js
git commit -m "Skip session-end's interrupted stamp for a nested claude session — owner pid mismatch, refs #3845"
```

Waived AC3.2: `npm test` passing is Common Step 5's full-suite verification, not a task test.
