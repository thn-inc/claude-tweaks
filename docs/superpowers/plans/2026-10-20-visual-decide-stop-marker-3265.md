# visual-decide stop leaves no server-stopped marker when the daemon exits without running its SIGTERM handler (win32) (#3265) Implementation Plan

**Goal:** `cmdStop` in `plugin/bin/lib/visual-decide/cli.js` writes the `server-stopped` marker only when `waitFor` times out. When the daemon's PID disappears without its own SIGTERM handler running (win32's unconditional terminate, or an outside SIGKILL), no marker is written and `status` reports a cleanly stopped server as `crashed`. The fix: always leave the marker behind.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T132710-record-3265/work/3265-spec.md` (materialized from GitHub issue #3265)

---

### Task 1: Write the server-stopped marker whenever stop's wait settles without it

**Files:**
- Modify: `plugin/bin/lib/visual-decide/cli.js` (`cmdStop`, lines ~218-231)
- Test: `tests/bin-lib/visual-decide/cli.test.js` (new test, placed after the existing `stop writes server-stopped marker defensively when waitFor times out on a still-signalable PID` test)

- [ ] **Step 1: Failing test.** Add a test that runs on every platform (no `skip:`): `stop leaves server-stopped and status reports stopped when the daemon exits without running its SIGTERM handler`. It simulates the daemon with a spawned child that installs **no** SIGTERM handler (`spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' })`), so SIGTERM kills it without any marker write on every platform. Write `server-info` into a fresh `mkTmp('vd-state-')` dir pointing at that child's pid (`{ pid, port: 0, url: 'http://127.0.0.1:0/', key: 'test' }`, the same shape the neighbouring stuck-PID test uses). **Run `stop` asynchronously, not via the file's synchronous `run()` helper:** the child belongs to the test process, and while `execFileSync` blocks the event loop libuv cannot reap it. The killed child would then stay a zombie that `kill(pid, 0)` still reports alive, so `waitFor` would time out and the pre-fix timeout branch would write the marker anyway, and the test could not go red on the pre-fix code. Use a promisified `execFile` (`util.promisify(require('node:child_process').execFile)`) so the test process reaps the child as soon as it dies. Assert that `stop` exits 0 and prints `stopped`, that `server-stopped` exists in the state dir, and that `status --state {dir}` prints `stopped` (not `crashed`). In a `finally`, `child.kill('SIGKILL')` best-effort (wrapped in try/catch, since the child may already be gone).
- [ ] **Step 2: Implement.** In `cmdStop`, replace the `if (!settled) { writeStoppedMarker(stateDir); }` branch with an unconditional "marker absent → write it" check after the wait: `if (!fs.existsSync(path.join(stateDir, 'server-stopped'))) writeStoppedMarker(stateDir);`. This covers both a PID that went away without its handler running and a timeout. Keep `waitFor`'s return value only if something else still uses it; otherwise drop the `settled` binding and `await` the call directly. Update the comment so it names both cases: zombie/timeout (#3130) and a handler-less exit (win32 SIGTERM, outside SIGKILL; #3265). Touch nothing else in the file.
- [ ] **Step 3: Run** `node --test tests/bin-lib/visual-decide/cli.test.js` and expect PASS. Then prove the new test discriminates: temporarily restore the pre-fix `cmdStop` (`git show HEAD:plugin/bin/lib/visual-decide/cli.js` into the file), re-run, and confirm the new test FAILS (status `crashed` and/or marker absent). Restore the fix and re-run to PASS.
- [ ] **Step 4: Commit** with one commit containing both files, message `Write visual-decide server-stopped marker whenever stop settles without it — refs #3265`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (marker written whenever the wait settles without the marker present) maps to Step 2. Deliverable 2 (platform-independent handler-less exit test) maps to Step 1. AC1 (marker exists and `status` reports stopped) is asserted in Step 1. AC2 (the test runs on Linux CI and fails on the pre-fix code) is covered by no `skip:` in Step 1 and the revert check in Step 3. AC3 (`npm test` passes) is covered by `/build` Common Step 5's final verification.
- **Placeholders:** none.
