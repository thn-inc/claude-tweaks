# ports registry test: bind-detection test collides with the machine lease pool on port 20003 (#3759) Implementation Plan

**Goal:** Stop `tests/bin-lib/ports/registry.test.js`'s bind-detection test from binding a real socket on `127.0.0.1:20003` (`POOL_BASE + 3`) in the machine-wide 20000+ lease pool, while keeping the assertion that `allocate` moves past a block with a taken port.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T074853-record-3759/work/3759-spec.md` (materialized from GitHub issue #3759)

---

### Task 1: Make the bind-detection test independent of whether POOL_BASE + 3 is free

**Files:**
- Test: `tests/bin-lib/ports/registry.test.js`

Approach: bind the "taken" listener on an OS-assigned port (`listen(0)`), which is outside the 20000-29999 pool. Inject a `probe` into `allocate` that sends the first candidate block's check to that real port through `probe.js`'s `isFree`, and reports every other block as free. Bind detection stays real (a real bound socket plus the real `isFree`), allocate's skip logic is still what the assertion exercises, and nothing touches the shared pool range.

- [ ] **Step 1: Failing test** — reproduce the reported failure. Occupy `127.0.0.1:20003` from a separate process, then run `node --test tests/bin-lib/ports/registry.test.js`. Expected: FAIL (`EADDRINUSE 127.0.0.1:20003` in "skips a block with a bound port").
- [ ] **Step 2: Implement** — rewrite the "allocate: skips a block with a bound port, moves to the next candidate" test as described in Approach. Import `isFree` from `plugin/bin/lib/ports/probe`. Update the `alwaysFree` comment, which claims this file's bind-detection tests use the real pool.
- [ ] **Step 3: Run** — with `127.0.0.1:20003` still occupied, run `node --test tests/bin-lib/ports/registry.test.js`. Expected: PASS. Then temporarily make `claimFreeBase` ignore the probe result and confirm the rewritten test goes red, then revert (AC2 discrimination proof).
- [ ] **Step 4: Commit** — one commit: `Decouple ports registry bind-detection test from the shared lease pool — refs #3759`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (independent of POOL_BASE + 3) and Deliverable 2 (keep the skip assertion) are covered by Step 2. AC1 (passes with 20003 occupied) is Step 3's first run. AC2 (still fails when allocate stops skipping) is Step 3's revert proof. AC3 (`npm test` passes) is Common Step 5 / `/test`.
- **Placeholders:** none.
