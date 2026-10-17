# engine-verify probe unregister (#3388) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the three `registerCheck` probe tests in `engine-verify.test.js` from leaking their checks into every later `runVerify` call in the same file.

**Architecture:** `registerCheck(name, fn)` returns an unregister function that removes that exact registry entry (by object identity, not name) from the module-level `CHECKS` array. The production registrations in `engine-verify.js` ignore the return value, so the production path does not change. Each probe test keeps the returned function and calls it in a `finally`.

**Tech Stack:** Node 18+, CommonJS, `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T192011-record-3388/work/3388-spec.md` (materialized from GitHub issue #3388)

## Global Constraints

- The production registration path does not change. Every `registerCheck('…', fn)` call in `engine-verify.js` keeps its current form and its current order in `CHECKS`.
- No new export unless needed. `registerCheck` is already exported, and the unregister function is its return value.
- Commit message: `{Verb} {what} — {detail}`, with `refs #3388` and never `closes`/`fixes`.

## Review Focus

- Unregister called twice: the second call is a no-op. It must not splice index -1, because `splice(-1, 1)` would remove the LAST real check. Pin this with an assertion in the new tail test.
- Two registrations with the same name: unregister removes only its own entry. Identity-based removal covers this, and the tail test pins it.
- A probe test whose assertion throws must still unregister. The `finally` covers this; review checks each of the three probes.
- Deleted ordering comments must not take unrelated rationale with them. For example, AC1/AC2's `deferred: ['run-dir-archival']` explanation and the subprocess test's "real checks legitimately fail" note must stay.

---

### Task 1: Removable check registration + leak-free probes

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:53-55` (`registerCheck`)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`

**Interfaces:**
- Produces: `registerCheck(name: string, fn: Function) => () => void`. The returned function removes this registration's own `{name, fn}` entry from `CHECKS`, and is idempotent.

- [ ] **Step 1: Write the failing test.** Append this as the LAST test in `engine-verify.test.js`:

```js
test('#3388: probe checks registered by earlier tests do not leak -- a clean fixture at the end of the file exits 0', () => {
  const names = runVerify({ runDir: null, base: 'main', deps: {} }).rows.map((r) => r.check);
  for (const probe of ['__test-exitcode-probe__', '__test-throwing-check__', '__test-null-guard-probe__']) {
    assert.ok(!names.includes(probe), `${probe} leaked into later runVerify calls`);
  }
  // unregister is identity-scoped and idempotent
  const before = runVerify({ runDir: null, base: 'main', deps: {} }).rows.map((r) => r.check);
  const unregA = registerCheck('__test-dup__', () => ({ result: 'pass', detail: 'a' }));
  const unregB = registerCheck('__test-dup__', () => ({ result: 'pass', detail: 'b' }));
  unregA();
  unregA();
  const mid = runVerify({ runDir: null, base: 'main', deps: {} }).rows.map((r) => r.check);
  assert.deepStrictEqual(mid, [...before, '__test-dup__']);
  unregB();
  assert.deepStrictEqual(runVerify({ runDir: null, base: 'main', deps: {} }).rows.map((r) => r.check), before);

  const runId = 'test-3388-clean-tail';
  const repoRoot = makeCleanRepoRoot();
  const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => 'gh version 2.0.0' } });
    assert.deepStrictEqual(result.rows.filter((r) => r.result === 'fail'), []);
    assert.strictEqual(result.exitCode, 0);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
```

(The null-runDir `runVerify` call lists every registered check name without invoking any check fn.)

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --test-name-pattern="#3388" tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL. `--test-name-pattern` still loads the whole file, but it skips the probe tests, so the leak assertion alone may pass. The idempotence assertion fails, because `unregA` is `undefined` (TypeError: unregA is not a function). Then run the whole file with `node --test tests/bin-lib/wrap-up/engine-verify.test.js`. Expected: FAIL, with the leak assertion naming `__test-exitcode-probe__`.

- [ ] **Step 3: Implement `registerCheck(name, fn) => () => void` in `engine-verify.js`.** Keep a reference to the pushed entry object. Return a function that finds it with `CHECKS.indexOf(entry)` and splices it out only when the index is `!== -1`.

- [ ] **Step 4: Make the three probe tests unregister in a `finally`.** In `runVerify sets exitCode 3 …(forced-fail probe)`, `runVerify contains a check function that throws…`, and `runVerify short-circuits to an all-unknown row set when runDir is null…`, assign `const unregister = registerCheck(...)` and wrap the remaining body in `try { … } finally { unregister(); }`.

- [ ] **Step 5: Delete the ordering-workaround comments, keeping other rationale.**
  - The AC1/AC2 header block (~L149-162): drop the sentences about placement "BEFORE 'runVerify sets exitCode 3 …'" and the forced-fail contamination explanation. Keep the sentences about the record #900 fixtures, the hoisted helper fns, and the `deferred: ['run-dir-archival']` paragraph.
  - The #3373 block (~L208-211): drop "Placed before the forced-fail probe below … exitCode 0)."
  - The #1841 block (~L380-388): drop "Placed here, before the forced-fail probe … AC2 fixture immediately above)." Keep the gather-failure rationale.
  - The null-guard probe test's inline comment (~L2087-2093): drop the "This registration is cumulative … permanently-throwing probe." sentences. Keep the explanation of what the throwaway check proves.
  - The subprocess test comment (~L2119-2120): drop "This test spawns a fresh subprocess, so it is immune to the null-guard probe registered above (module state does not cross process boundaries)." Keep the rest.
  - Re-check with `grep -n "forced-fail probe\|null-guard probe\|cumulative\|contamination\|permanently" tests/bin-lib/wrap-up/engine-verify.test.js`. Expected: only test names and live assertions remain, and no placement rationale.

- [ ] **Step 6: Run the file and confirm it passes**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS (0 failures)

Order-independence check: temporarily move the new #3388 test to directly after the forced-fail probe test, run the file (Expected: PASS), then move it back.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Make engine-verify probe checks removable — registerCheck returns an unregister fn; probes clean up in finally (refs #3388)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (registerCheck returns an unregister function, production path unchanged) is Step 3. Deliverable 2 (the three probes unregister in `finally`) is Step 4. Deliverable 3 (delete the ordering-only comments) is Step 5. AC1 (probe names are absent afterwards) is the Step 1 leak assertion. AC2 (a clean tail test exits 0) is the Step 1 fixture. AC3 (the file passes regardless of order) is Step 6's order-independence check.
- **Placeholders:** none.
- **Return-shape widening:** `registerCheck` goes from returning `undefined` to returning a function. `git grep registerCheck` shows that no caller reads the return value; the only callers are the production registrations and the test probes.
