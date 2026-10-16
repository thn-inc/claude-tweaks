# Pin session-tmp-resolve's win32 forward-slash output on Linux CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plugin/bin/session-tmp-resolve.js`'s win32 forward-slash printing decision take an injectable `platform` parameter instead of reading `process.platform` inline, and add a Linux-runnable test that pins the win32 branch's backslash-free output.

**Architecture:** Extract the one-line printing decision (`process.platform === 'win32' ? resolved.split(path.sep).join('/') : resolved`) into a small exported pure function, `formatPrintedPath(resolved, { platform, sep } = {})`, defaulting both options to the real `process.platform`/`path.sep` so the CLI's own runtime behavior is unchanged. Guard the file's top-level CLI execution behind `require.main === module` (the convention already used by `plugin/bin/check-artifact-overwrite.js` and others) so a test can `require()` the file and call `formatPrintedPath` directly with an injected `platform: 'win32'`, without spawning a subprocess and without needing an actual Windows runner.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), no new dependencies.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3068/.claude-tweaks/pipelines/2026-10-16T073839-record-3068/work/3068-spec.md` (materialized from GitHub issue #3068)

## Global Constraints

- Posix (non-win32) CLI output must stay byte-for-byte unchanged (Acceptance Criteria).
- The new test must run on Linux (no `skip:` gate) and must fail if the win32 forward-slash branch is reverted to printing the native path unchanged (Acceptance Criteria).
- Follow the existing injectable-option convention already used in this codebase: `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic(..., { platform = process.platform, ... } = {})`.

## Review Focus

- **Reverting the win32 branch must fail the new test, not just the existing skip-gated one** — the whole point of this spec. The new test calls `formatPrintedPath` directly with `platform: 'win32'` and asserts a forward-slash, backslash-free result; if someone reverts the ternary to always return `resolved` unchanged, this test fails on Linux.
- **Posix behavior must be provably unchanged** — the existing posix test (`tests/session-tmp-resolve-cli.test.js`, spawn-based, byte-for-byte assertion) must still pass untouched after the refactor, since it is the existing pin for "Posix output is byte-for-byte unchanged."
- **The CLI's own runtime path must still call the extracted function with real `process.platform`** — if the CLI's call site hardcodes `{ platform: 'win32' }` or omits the option entirely, it would silently break real win32 users even though the Linux spawn tests keep passing (they never exercise the CLI's own default-threading). Pin this by keeping the existing win32-skipped spawn test (`tests/session-tmp-resolve-cli.test.js`'s `skip: process.platform !== 'win32'` test) unchanged — it still exercises the real CLI subprocess end-to-end and would catch a wrong default on an actual Windows run.
- **`require.main === module` guard must not change CLI behavior when run as a script** — adding the guard must not alter stdout/exit-code behavior for any existing spawn-based test (they invoke the file as a subprocess via `spawnSync`, which always sets `require.main === module` for the entry script).
- **Module export must not leak into the CLI's own stdout** — requiring the file for its export (in the new unit test) must not execute the CLI's top-level `console.log`/`process.exitCode` logic, which would pollute `node --test`'s own output or set an unintended exit code for the test process.

---

### Task 1: Extract injectable `formatPrintedPath` and add a Linux-runnable win32-behavior test

**Files:**
- Modify: `plugin/bin/session-tmp-resolve.js` (whole file — currently top-level script code with no exports, no `require.main` guard)
- Test: `tests/session-tmp-resolve-cli.test.js` (append one new test; existing tests unchanged)

**Interfaces:**
- Consumes: nothing new — `path.sep`, `process.platform` (both already used in the file today).
- Produces: `formatPrintedPath(resolved, { platform = process.platform, sep = path.sep } = {})` → `string`. Exported as `module.exports = { formatPrintedPath }` from `plugin/bin/session-tmp-resolve.js`. No other task/file in this plan consumes it — this is the only task.

- [ ] **Step 1: Write the failing test**

Append to `tests/session-tmp-resolve-cli.test.js` (after the existing `require`s at the top of the file, add one more require for the module under test; the new test itself goes alongside the other `test(...)` calls, e.g. right after the existing "win32: prints forward-slash paths only" test):

```js
const { formatPrintedPath } = require('../plugin/bin/session-tmp-resolve.js');
```

```js
test('formatPrintedPath: win32 branch prints a backslash-free, forward-slash path (runs on every OS, not just win32)', () => {
  const nativeWindowsPath = 'C:\\Users\\me\\AppData\\Local\\Temp\\ct-session-sess-fwd\\foo.json';
  const printed = formatPrintedPath(nativeWindowsPath, { platform: 'win32', sep: '\\' });
  assert.ok(!printed.includes('\\'), `expected no backslash in ${printed}`);
  assert.equal(printed, 'C:/Users/me/AppData/Local/Temp/ct-session-sess-fwd/foo.json');
});

test('formatPrintedPath: posix branch returns the input unchanged, byte for byte', () => {
  const nativePosixPath = '/tmp/ct-session-sess-posix/foo.json';
  const printed = formatPrintedPath(nativePosixPath, { platform: 'linux', sep: '/' });
  assert.equal(printed, nativePosixPath);
});

test('formatPrintedPath: defaults platform/sep to the real process.platform/path.sep', () => {
  const printed = formatPrintedPath('/tmp/ct-session-sess-default/foo.json');
  assert.equal(printed, process.platform === 'win32'
    ? '/tmp/ct-session-sess-default/foo.json'.split(path.sep).join('/')
    : '/tmp/ct-session-sess-default/foo.json');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-tmp-resolve-cli.test.js`
Expected: FAIL with `TypeError: (0 , _session_tmp_resolve.formatPrintedPath) is not a function` (or equivalent "not exported"/"undefined is not a function") — the module does not yet export `formatPrintedPath` and the file still executes CLI argv-parsing on require, so requiring it with zero `process.argv` CLI args will also print its own `Usage:` error to stderr and set `process.exitCode = 1` as a side effect of the `require()` call itself (confirming the `require.main` guard is also still needed).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `plugin/bin/session-tmp-resolve.js` with:

```js
#!/usr/bin/env node
// bin/session-tmp-resolve.js
//
// Thin CLI wrapper over lib/session-tmp.js#sessionTmpPath, for skill
// snippets that need several session-scoped temp paths in one bash fence
// without inlining the same `node -e "..."` resolution boilerplate per
// call site (#266 shipped that inline form first; this is the byte-cheaper
// follow-up for files pushed near the 40 KB skill-file ceiling by it).
//
// Usage: session-tmp-resolve.js VAR=filename [VAR=filename ...]
// Output: one `VAR=path` line per argument, in argument order — eval-ready
// (`eval "$(node session-tmp-resolve.js ...)"`). Reads
// process.env.CLAUDE_CODE_SESSION_ID directly; no flags, no other env deps.
'use strict';
const os = require('os');
const path = require('path');
const { sessionTmpPath } = require('./lib/session-tmp');

// Print-only: on win32 emit forward slashes (`C:/Users/…`). The value is interpolated by skill
// snippets into JS string literals inside `node -e "…"`, where `C:\Users\…` would be read as
// escape sequences (`\U`, `\t`). Node, Git Bash and the Windows fs APIs all accept `/`; the
// library's return value stays native. Posix output is unchanged. `platform`/`sep` are
// injectable (default to the real `process.platform`/`path.sep`) so a test can pin the win32
// branch's behavior on any OS, mirroring `lib/atomic-write.js`'s `platform = process.platform`
// convention.
function formatPrintedPath(resolved, { platform = process.platform, sep = path.sep } = {}) {
  return platform === 'win32' ? resolved.split(sep).join('/') : resolved;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: session-tmp-resolve.js VAR=filename [VAR=filename ...]');
    process.exitCode = 1;
    return;
  }

  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0) {
      console.error(`Invalid argument (expected VAR=filename): ${arg}`);
      process.exitCode = 1;
      return;
    }
    const varName = arg.slice(0, eq);
    const filename = arg.slice(eq + 1);
    const resolved = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    const printed = formatPrintedPath(resolved);
    console.log(`${varName}=${JSON.stringify(printed)}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { formatPrintedPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-tmp-resolve-cli.test.js`
Expected: PASS (all tests, including the three new ones and every pre-existing test in the file — the win32-skipped spawn test still reports as skipped on Linux, not failed).

- [ ] **Step 5: Run the full existing CLI behavior spot-check**

Run: `node plugin/bin/session-tmp-resolve.js ST_FOO=foo.json` (with `CLAUDE_CODE_SESSION_ID` unset or set in env) and separately `node plugin/bin/session-tmp-resolve.js` (no args)
Expected: first invocation prints one `ST_FOO="..."` line exactly as before; second invocation prints the `Usage:` error to stderr and exits 1 — confirming the `require.main` guard did not change observable CLI behavior.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/session-tmp-resolve.js tests/session-tmp-resolve-cli.test.js
git commit -m "Extract injectable platform into session-tmp-resolve's path printing

refs #3068"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (injectable platform/path-flavor instead of inline `process.platform`) — Task 1 Step 3's `formatPrintedPath({ platform, sep })`. Deliverable 2 (a Linux-runnable test asserting the win32 branch prints a backslash-free path) — Task 1 Step 1's first new test. Acceptance Criterion 1 (reverting the win32 branch fails a test on ubuntu CI) — the same new test, which calls the branch directly rather than being `skip`-gated. Acceptance Criterion 2 (posix output byte-for-byte unchanged) — the pre-existing posix spawn test is untouched, plus the new "posix branch returns input unchanged" unit test.
- **Placeholders:** none — every step has concrete code and concrete commands.
- **Type consistency:** `formatPrintedPath(resolved, { platform, sep } = {})` is defined once (Step 3) and consumed identically by the three new tests (Step 1) and the CLI's own `main()` (Step 3) — one signature, no drift, since there is only one task.
- **Review Focus:** all five lines above each map to a concrete assertion in Task 1 (the revert-sensitivity test, the unchanged posix test, the default-threading test, the win32-skipped spawn test staying untouched, and Step 5's manual spot-check for the `require.main` guard).
