# test-impact tracer drops a read whose trace write fails, with no fail-closed record (#4158) Implementation Plan

**Goal:** When the test-impact tracer cannot write a trace line (`appendFileSync` throws, e.g. EMFILE/ENOSPC), the failure is recorded through a channel that does not depend on that write, so `node tools/test-impact.js trace` never produces a map with exitCode 0 from a run that lost a read.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T100232-record-4158/work/4158-spec.md` (materialized from GitHub issue #4158)

**Design (decided at plan time — implement this, do not redesign):**

1. `tools/test-impact/tracer.js` — in `emit`'s `catch`, mark the process as having lost a trace write (`markLost()`), instead of swallowing silently. `failClosed` already routes through `emit`, so a failed fail-closed write is covered by the same path.
   - `markLost()` (idempotent): (a) tries to write a **loss marker** — a separate file beside the trace file, same basename with `.lost` in place of `.trace` (`{pid}-{ms}-{rand}.lost`), content one JSON line `["T", test]` — using the tracer's unpatched `appendFileSync`; (b) the first time, registers one `process.once('exit', …)` listener.
   - The `exit` listener: if the marker still has not been written, retry writing it once (an EMFILE at failure time may have cleared by exit); if it still cannot be written, and the exit `code` is 0, set `process.exitCode = 1` (Node honours an `exitCode` set inside an `exit` listener, for a natural exit and for an explicit `process.exit(0)` alike — probed on Node 20 and 22) and write one diagnostic line to fd 2 with `fs.writeSync(2, …)` (sync; `process.stderr` may be async on a macOS pipe at exit). This exit code is the channel that needs no file write: a `node --test` worker that exits non-zero fails its test file, so the suite — and the map's `exitCode` — goes non-zero.
   - Every new step is wrapped so it never throws into the host. The listener is registered lazily (only after a loss), so an ordinary traced process gains no `exit` listener.
   - Update the file's header comment (Output / fail-closed description) to describe the `.lost` marker and the exit-code fallback.
2. `tools/test-impact/build-map.js` — `buildMap` also counts `.lost` files in the trace dir and returns `lost` (count) and `lostTests` (sorted unique test names read from each marker's `["T", test]` line; a marker that does not parse still counts toward `lost`). Header comment updated.
3. `tools/test-impact.js` `trace` — when `built.lost > 0`, refuse the map: write nothing to `--out`, print `test-impact.js trace: {n} traced process(es) could not record a read (tests: {list}) — no map written` to stderr, return 1. This check runs before the existing `tests === 0` check. Update the header comment's exit-code paragraph (exit 1 also covers a run whose tracer lost a read).

### Task 1: Fail the trace closed when a trace write fails

**Files:**
- Modify: `tools/test-impact/tracer.js`
- Modify: `tools/test-impact/build-map.js`
- Modify: `tools/test-impact.js`
- Create: `tests/fixtures/test-impact/fail-trace-append.js` — a `--require` preload loaded before the tracer (same shape as `tests/fixtures/test-impact/freeze-readdir.js`): replaces `fs.appendFileSync` with a wrapper that throws an `ENOSPC`-coded error when the target path ends in `.trace` and the data contains the JSON string `"lib/y.js"`; when env `FAIL_TRACE_APPEND=all` it throws for every `.trace` **and** `.lost` path in the trace dir instead (so the marker cannot be written either). All other calls pass through to the original.
- Test: `tests/test-impact-cli.test.js`
- Test: `tests/test-impact-tracer.test.js`

- [ ] **Step 1: Failing tests**
  - `tests/test-impact-cli.test.js`: (a) a `buildMap` unit test — a trace dir holding a normal headed trace file plus a `.lost` marker yields `lost: 1` and `lostTests: ['tests/a.test.js']`; (b) a `trace` unit test with a fake `spawn` that writes a headed trace file and a `.lost` marker into `opts.env.CT_TRACE_DIR`, returning status 0 — `run` returns 1, nothing is written at `--out`, stderr names the test; (c) an end-to-end test modelled on the existing "trace under a path with a space" test (POSIX-only skip, same fixture-root setup) whose `env.NODE_OPTIONS` carries `--require "{abs path to tests/fixtures/test-impact/fail-trace-append.js}"` so the injector loads before the tracer the CLI appends: the real CLI exits 1, writes no map at `--out`, and stderr names `tests/y.test.js`. Against the current swallow, (c) goes red: the CLI exits 0 and writes an exitCode-0 map that is missing `lib/y.js` under `tests/y.test.js`.
  - `tests/test-impact-tracer.test.js`: an attributed process (`node -e "require('fs').readFileSync('lib/x.js')"` with `traceEnv(root, dir)` plus `CT_TRACE_TEST=x.test.js`, the injector preloaded first, `FAIL_TRACE_APPEND=all`) exits with status 1 although its own code succeeded, and leaves no `.lost` file; without `FAIL_TRACE_APPEND=all` a read of `lib/y.js` leaves a `.lost` marker whose line is `["T","x.test.js"]` and exits 0.
- [ ] **Step 2: Implement** — the Design above, across the three tool files and the fixture.
- [ ] **Step 3: Run** `node --test tests/test-impact-cli.test.js tests/test-impact-tracer.test.js` — PASS. Prove (c) discriminates by running it against `git show HEAD:tools/test-impact/tracer.js` (in a scratch copy, never by editing the shared tree) and seeing it fail.
- [ ] **Step 4: Commit** — one commit, `Fail the test-impact trace closed when a trace write fails — refs #4158`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (failure recorded through a channel independent of the failing write) → Design items 1-3 (marker file + exit-code fallback + trace refusal). Deliverable 2 (test injecting a failing `appendFileSync`, map refused) → Step 1 (c) and the tracer test. AC "no map with exitCode 0" → Design 3 and the exit-code fallback; AC "new test goes red against the current swallow" → Step 1 (c) and Step 3's discrimination check; AC "`npm test` passes" → Common Step 5.
- **Placeholders:** none.
