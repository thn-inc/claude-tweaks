# Fix the stage-item Race Test's Stdout Capture (#3105) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tests/bin-lib/stage-item/write.test.js`'s six-process `allocate: true` race test reads every worker's path only after the worker's stdio has closed. It also checks the `staged/` directory directly, so a future failure says whether it was a capture problem or a lost update.

**Architecture:** One test-only change. The root cause is confirmed (see below): the test resolves each worker's promise on the child's `'exit'` event, and Node documents that a child's stdio streams can still be open when `'exit'` fires. A worker's path can therefore still be in the pipe, `stdout.trim()` returns `''`, `results.filter(Boolean)` drops it, and the distinct-file count reads 5. The allocator (`plugin/bin/lib/stage-item/write.js`'s `wx` exclusive create) is correct and stays untouched.

**Tech Stack:** Node `child_process.spawn`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T225734-spec-3105/work/3105-spec.md`

## Root cause (confirmed before planning)

A reproduction harness mirrored the test's exact worker logic. It recorded each worker's stdout at `'exit'` and at `'close'`, plus the real `staged/` contents. It ran 300 iterations, 12 at a time, alongside 4 CPU hogs, in a Linux `node:20` container, which is CI's OS and Node major version.

- **14 of 300 iterations failed the test's own assertion.** In every failure, 1-3 workers' stdout was `''` at `'exit'`, but at `'close'` all 6 paths were present and distinct.
- **`staged/` held exactly 6 files with 6 distinct contents every time.**

So no staged proposal was lost; the allocator never collided. On Windows, the same harness never showed an `'exit'`/`'close'` lag in 500 iterations, even under CPU stress. That is why the flake only appeared on ubuntu CI.

## Global Constraints

- Test-only change. Do not modify `plugin/bin/lib/stage-item/write.js`, which was proven correct by the reproduction.
- Keep the test's existing two assertions, distinct files and distinct contents, with their exact messages, so the CI history stays comparable.
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- A worker that exits non-zero must still reject with its stderr. Moving to `'close'` must keep the exit code: `'close'` passes `(code, signal)`.
- A worker killed by a signal (`code === null`) must reject, not resolve.
- The `staged/` check must be independent evidence, read from disk, not derived from the captured stdout. Otherwise a capture bug could still mask, or fake, a lost update.

---

### Task 1: Resolve workers on `'close'` and assert the `staged/` directory directly

**Files:**
- Modify: `tests/bin-lib/stage-item/write.test.js` (the `two real OS processes racing the same allocate:true numbered-kind id` test, ~lines 142-172)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Confirm the RED mechanism is the one being fixed**

Read the test and confirm it resolves on `p.on('exit', …)` with `resolve(stdout.trim())`, and that `results.filter(Boolean)` would drop an empty capture. (The flake is load-dependent, so RED is the reproduction harness above, not a deterministic local failure.)

- [ ] **Step 2: Change the worker promise to resolve on `'close'`**

Replace:

```js
    p.on('exit', (code) => (code === 0 ? resolve(stdout.trim()) : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
```

with:

```js
    // #3105: 'close', not 'exit' — Node fires 'exit' while the child's stdio pipes may still
    // hold unread data, so a worker's path could be read as '' and filtered out (a 5 !== 6
    // flake on loaded Linux CI). 'close' fires only after every stdio stream has ended.
    p.on('close', (code, signal) => (code === 0 ? resolve(stdout.trim()) : reject(new Error(`worker ${i} exited ${code}${signal ? ` (signal ${signal})` : ''}: ${stderr}`))));
```

- [ ] **Step 3: Add the on-disk assertion after the existing two**

Directly after the `every worker's content must survive` assertion, add:

```js
  // Independent of the stdout capture above: the run dir itself must hold one staged file
  // per worker, so a future failure here means a lost update, not a capture problem.
  const onDisk = fs.readdirSync(path.join(runDir, 'staged')).filter((f) => f.startsWith('race-deviation-'));
  assert.equal(onDisk.length, WORKERS, `staged/ must hold one file per worker, found ${JSON.stringify(onDisk)}`);
```

- [ ] **Step 4: Run the test**

Run: `node --test --test-name-pattern "two real OS processes racing" tests/bin-lib/stage-item/write.test.js`
Expected: PASS
Run: `node --test tests/bin-lib/stage-item/write.test.js`
Expected: PASS (the whole file)

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/stage-item/write.test.js
git commit -m "Resolve the stage-item race test's workers on close, not exit — and check staged/ on disk (#3105)"
```
