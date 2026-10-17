# visual-decide stop zombie-PID marker fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `visual-decide` CLI's `stop` command write the `server-stopped` marker even when the target PID is a zombie that stays signalable (`kill(pid, 0)` keeps succeeding) past the `waitFor` timeout, so `stop` never exits 0 claiming "stopped" without the marker actually existing.

**Architecture:** `cmdStop` in `plugin/bin/lib/visual-decide/cli.js` already writes the `server-stopped` marker defensively on two branches (no info / dead PID) before returning. The live-process branch sends `SIGTERM` then calls `waitFor(...)` with a 3000ms timeout, trusting the marker to appear via the server's own SIGTERM handler or `pidAlive` to flip false. On a zombie PID (no reaping init in this process's container), neither ever happens within the timeout, so `waitFor` returns `null` and the function falls through to printing "stopped" with no marker ever written. Fix: when `waitFor` times out (returns a falsy value) and the marker still doesn't exist, write it defensively — the same marker-write already used by the other two branches, extracted into one shared helper.

**Tech Stack:** Node.js builtins only (`node:fs`, `node:path`, `node:child_process`) — matches the file's existing #1202 AC 8 constraint.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-16T155630-record-3130/work/3130-spec.md` (materialized from GitHub issue #3130)

## Global Constraints

- Node builtins only in `plugin/bin/lib/visual-decide/cli.js` — no new dependencies (file's own header comment, #1202 AC 8).
- No change to the already-passing EPERM/ESRCH `pidAlive` semantics at `cli.js:43-54`.
- Existing stop/status test coverage for the non-zombie dead-PID (ESRCH) path must pass unchanged.

## Review Focus

- **Zombie-PID timeout path** — `stop` must write the marker and still exit 0 printing "stopped" even when `waitFor` times out on a PID that stays signalable the whole 3000ms. (Owning test: Task 1 Step 1.)
- **Non-zombie dead-PID (ESRCH) path unaffected** — the existing "stop is stale-PID tolerant" test must keep passing byte-for-byte, since the fix must not touch that branch's behavior. (Owning test: Task 1 Step 4, full-file re-run.)
- **Marker already written by the server itself before timeout** — the defensive write after a timeout must not double-write or error if the marker already exists (it won't, since a timeout implies the existence check inside `waitFor`'s predicate already failed every poll — but the helper itself must tolerate a pre-existing file gracefully, same as the other two call sites already do via their own try/catch).
- **No regression to the live-process success path** — when the server's own handler writes the marker before the 3000ms timeout, `waitFor` resolves `true` and the new timeout-only branch must not fire (no redundant write, no behavior change).
- **Helper extraction doesn't change error semantics** — `writeStoppedMarker`'s own best-effort try/catch must preserve the original silent-swallow behavior (a write failure must never throw or change the command's exit code/stdout).

---

### Task 1: Write server-stopped marker on waitFor timeout in cmdStop

**Files:**
- Modify: `plugin/bin/lib/visual-decide/cli.js:186-218` (`cmdStop`)
- Test: `tests/bin-lib/visual-decide/cli.test.js`

**Interfaces:**
- Consumes: existing `pidAlive(pid)` (unchanged), existing `waitFor(fn, opts)` (unchanged), existing `readInfo(stateDir)` (unchanged).
- Produces: new private helper `writeStoppedMarker(stateDir)` (module-local, not exported — `module.exports` at the bottom of the file is unchanged) used by all three `cmdStop` branches.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/bin-lib/visual-decide/cli.test.js`, immediately after the existing `'stop is stale-PID tolerant (dead PID -> already-stopped, exit 0)'` test:

```javascript
test('stop writes server-stopped marker defensively when waitFor times out on a still-signalable PID', async () => {
  const stateDir = mkTmp('vd-state-');
  fs.mkdirSync(stateDir, { recursive: true });

  // Simulate a PID that stays signalable (kill(pid, 0) keeps succeeding) but
  // never exits and never writes the marker itself -- the same shape a
  // zombie child presents to pidAlive() under a non-reaping init, without
  // needing an actual zombie (this sandbox's PID 1 reaps normally).
  const stuck = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
  });
  await new Promise((resolve) => {
    stuck.once('spawn', resolve);
  });

  fs.writeFileSync(
    path.join(stateDir, 'server-info'),
    JSON.stringify({ pid: stuck.pid, port: 0, url: 'http://127.0.0.1:0/', key: 'test' }),
  );

  try {
    const stopResult = run(['stop', '--state', stateDir]);
    assert.equal(stopResult.code, 0, stopResult.err);
    assert.equal(stopResult.out.trim(), 'stopped');
    assert.equal(
      fs.existsSync(path.join(stateDir, 'server-stopped')),
      true,
      'server-stopped marker must be written even when waitFor times out on a still-signalable PID',
    );
  } finally {
    stuck.kill('SIGKILL');
  }
});
```

This test needs `spawn` imported from `node:child_process` alongside the file's existing `execFileSync` import — change the top of the test file from:

```javascript
const { execFileSync } = require('node:child_process');
```

to:

```javascript
const { execFileSync, spawn } = require('node:child_process');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/visual-decide/cli.test.js`
Expected: FAIL — the new test times out waiting 3000ms then asserts `fs.existsSync(...server-stopped)` is `true`, but it's `false` because current `cmdStop` never writes the marker on the timeout path.

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/visual-decide/cli.js`, add a shared helper just above `cmdStop` (after `runDaemon`, before `async function cmdStop`):

```javascript
function writeStoppedMarker(stateDir) {
  try {
    fs.writeFileSync(path.join(stateDir, 'server-stopped'), '');
  } catch {
    // best-effort
  }
}
```

Then replace the full body of `cmdStop` with:

```javascript
async function cmdStop(opts) {
  const stateDir = opts.state;
  if (!stateDir) throw new Error('stop requires --state');
  const info = readInfo(stateDir);
  if (!info || !pidAlive(info.pid)) {
    writeStoppedMarker(stateDir);
    process.stdout.write('already stopped\n');
    return;
  }
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    // TOCTOU: the process could have died between the pidAlive check above
    // and this call (its own idle timeout fired, or an independent crash) —
    // that's still "already stopped", not a failure (review finding).
    writeStoppedMarker(stateDir);
    process.stdout.write('already stopped\n');
    return;
  }
  const settled = await waitFor(
    () => fs.existsSync(path.join(stateDir, 'server-stopped')) || !pidAlive(info.pid),
    { timeoutMs: 3000, intervalMs: 50 },
  );
  if (!settled) {
    // waitFor timed out: on a zombie PID (no reaping init) pidAlive(pid)
    // keeps answering true via kill(pid, 0) even though the process can no
    // longer run its own SIGTERM handler to write the marker itself. Write
    // it defensively here, matching the dead-PID branch's own behavior
    // above -- stop is a stale-PID-tolerant contract regardless of which
    // branch gets there.
    writeStoppedMarker(stateDir);
  }
  process.stdout.write('stopped\n');
}
```

This replaces the three previously-duplicated `try { fs.writeFileSync(...) } catch { /* best-effort */ }` blocks with calls to the new helper, and adds the `settled`-false branch that writes the marker on timeout.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/visual-decide/cli.test.js` three times consecutively (the Acceptance Criteria require 3/3 passing runs in a non-reaping-init container):

```bash
for i in 1 2 3; do node --test tests/bin-lib/visual-decide/cli.test.js || break; done
```

Expected: PASS all three runs, including the existing `'stop is stale-PID tolerant (dead PID -> already-stopped, exit 0)'` test (ESRCH path, unchanged) and every other pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/visual-decide/cli.js tests/bin-lib/visual-decide/cli.test.js
git commit -m "fix: visual-decide stop: write server-stopped marker on waitFor timeout

refs #3130"
```

---

## Self-review

- **Spec coverage:** Both Deliverables options are satisfied by option (a) — the `settled`-false branch writes the marker defensively, matching the dead-PID branch's existing behavior. All three Acceptance Criteria are covered: the new test (3x run) covers the first; `pidAlive`'s `cli.js:43-54` body is untouched (only its call sites inside `cmdStop` are rearranged into the shared helper — no behavioral change) covers the second; the existing stale-PID-tolerant test is left untouched and still exercises the ESRCH path, covering the third.
- **Placeholders:** none — every step shows the exact code to write.
- **Type consistency:** `writeStoppedMarker(stateDir)` takes the same `stateDir` string every call site already has in scope; no new types introduced.
- **Review Focus:** all five lines above get their test coverage from Task 1's existing-plus-new tests (the four non-new lines are existing behavior Task 1's full-file re-run — Step 4 — re-confirms unchanged).
