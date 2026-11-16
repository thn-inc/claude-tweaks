# Queue pull: one failed native-blockers GraphQL call disables both the blocked and unlanded-blocker passes (#5309) Implementation Plan

**Goal:** A failed native-blockers GraphQL call (`bin/resolve-blockers.js`, one aliased call for every eligible candidate) fails closed for the records it could not read, with one Warning, instead of silently disabling the `blocked` pass's native filtering and, through `preflight-records.js`'s own native read, the `unlanded-blocker` pass.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5309/work/5309-spec.md` (materialized from GitHub issue #5309)

**Decision (the build's own, fast-lane has no plan review).** Today (`plugin/bin/lib/dispatch/queue-pull.js` `runBlocked`'s `native-deps` step, ~line 509; fence `plugin/skills/dispatch/queue-pull-script.md` lines 192-203) a non-zero `resolve-blockers.js` exit leaves `dispatch-native-deps.json` as `{}` and prints `Warning: native dependency query failed — falling back to no native filtering this run: …`; every candidate then stays in `dispatch-groups.json`, the unlanded-blocker pass's `dispatch-unlanded-blockers.js` → `preflight-records.js --work-links native` call hits the same failing GraphQL and prints a second Warning (`LANDING_EXITED`), and the write-back persists the unfiltered groups as a cache verdict that later cache hits replay without re-querying. Fix, in both the module and the fence (the fence still exists — #5231 has not removed it — so the parity row is kept):

1. `resolve-blockers.js` batches every number into one call, so a failure leaves **every queried record** (the `NATIVE_NUMS` set, i.e. every record in `dispatch-eligible.json`) with unreadable native blockers. Each one is excluded under the existing `reason: 'blocked'` with `detail: { blockedBy: ['native blockers (state unreadable)'] }` — a string entry, which `plugin/skills/dispatch/blocked-exclusion-report.md` already renders verbatim, and which `queue-order.js`'s `namesForeignBlocker` does not read as a foreign ref. No new exclusion reason (so `dispatch-queue-exclusion-addition`'s registration sites are not touched).
2. The one Warning replaces the old text: it names the call and the fail-closed consequence, e.g. `Warning: native dependency query failed — every candidate excluded as blocked (native blockers unreadable, fail closed) this run: {stderr}`. Module and fence print the identical bytes.
3. With those records removed from `dispatch-groups.json`, the unlanded-blocker pass sees no candidate that needs the native read — `dispatch-unlanded-blockers.js` prints an empty pool unchanged with no call and no Warning — so the pass is no longer disabled and no second Warning prints. Confirm this on the F-native fault row, do not assume it.
4. The write-back (module `runWriteBack`'s `write-back` step; fence lines ~276-302) writes nothing on a pull whose native query failed, so a failed read is never persisted as a queue-order verdict a later cache hit would replay without re-querying.

Mechanism (how the failure reaches the grouping block, e.g. a marker in `dispatch-native-deps.json` or a state flag) is the implementer's choice, provided module and fence behave identically on every matrix and fault row.

---

### Task 1: Fail closed on a failed native-blockers query, with one Warning, in module and fence

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (the fence, the parity oracle — kept per the spec's Current State)
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (line ~11 states the native query "falls back to no native filtering" — rewrite to the fail-closed posture)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (grep it for "no native filtering"; update only a sentence that describes this gh-path fallback)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (the `F-native` row of `FAULT_EXPECT`, ~line 3315, and the header comment's F-native bullet, lines 31-33 — mark it fixed by #5309 as the other fixed bullets are)

- [ ] **Step 1: Failing test** — change the `F-native` `FAULT_EXPECT` row to the new expectation: stderr gains exactly one line, the new native Warning (no `LANDING_EXITED`); entries: every eligible record of the `S2-gh-miss` base excluded as `blocked` (use `entries:` literally, or `drops`/`adds` against the base — whichever the row helpers express exactly); and no write-back (assert via the row's recorded `writeOrder`/git-push calls, or the persisted blob, if the fault harness exposes one — otherwise say why it cannot be asserted). Add a focused unit test that runs the passes over `makeContext` with a `spawnCli` fake returning a non-zero `resolve-blockers.js` exit, asserting the exclusions, the single Warning, and that `queueOrder.writeOrder` is not called. Run them before Step 2 and confirm red.
- [ ] **Step 2: Implement** — the four decisions above, module first, then mirror into the fence (the module header: "Fix a defect here and mirror the change into the fence"). **Size headroom:** `queue-pull-script.md` is 52484 bytes against `RAIL_BYTES` 52500 (16 bytes left). Any fence growth must be paid for in the same file — cut fence comment lines or prose sentences that restate the module (e.g. the write-back comment block at lines ~258-263, or the size-guard comment at ~238-243) — and `wc -c` must stay at or under 52500 after the edit. If a cut shifts fence line numbers, update every `Fence NNN-MMM` / `fence NNN` citation in `queue-pull.js` (and the test file) that the shift makes wrong. Update the 'blocked' bullet at `queue-pull-script.md` line 5 only if it now misstates what a 'blocked' entry can carry.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js` (the parity suite runs the bash oracle — it is slow; use a large timeout) and the rail test for skill sizes (`npm test -- tests/skill-size*.test.js` or the file `grep -l RAIL_BYTES tests/*.test.js` names) — PASS. Quote the raw summary lines.
- [ ] **Step 4: Commit** — one commit, message `Fail closed on a failed native-blockers query in the queue pull — one Warning, no second pass disabled (refs #5309)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 and AC 1 (records with unreadable blockers not dispatched, one Warning naming the call) are Task 1 Steps 1-2, decisions 1-3; the parity row is kept (fence mirrored, decision preamble).
- **Placeholders:** none.
