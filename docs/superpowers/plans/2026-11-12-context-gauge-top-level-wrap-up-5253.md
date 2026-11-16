# context-gauge.js writes a handoff for a top-level run whose only remaining step is wrap-up (#5253) Implementation Plan

**Goal:** `plugin/bin/context-gauge.js` refuses to write `handoff.json` whose steps include `wrap-up` when the run is not bound `dispatched: true`, enforcing the rule `plugin/skills/flow/context-handoff.md` states only in prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T134216-spec-5253/work/5253-spec.md` (materialized from GitHub issue #5253)

---

### Task 1: Refuse a top-level wrap-up handoff in the gauge

**Files:**
- Modify: `plugin/bin/context-gauge.js`
- Test: `tests/bin-lib/timing/context-gauge.test.js`

**Decisions this plan fixes (the implementer does not re-decide them):**
- **Where:** in `measure()`, after the `HANDS_OFF` identification check (line ~202) and before `readHandoffCount`/the bound check, so the refusal never spends a handoff. It applies to both forms: `--next-steps` and `--record-steps` (whose `nextSteps` is the union).
- **The predicate:** `nextSteps.includes('wrap-up')` and the run is not bound — read `deps.readRunState(runDir)` (wrap it in try/catch exactly as the existing single-record branch does; a throw or `null` counts as not bound) and treat it as bound only when `state.dispatched === true`. A multi-spec run's `runDir` is already the parent, so no extra lookup.
- **Result on refusal:** `over` stays as measured (`true`), `handoff: null`, and `reason` is exactly: `handoff.json not written: a top-level run (run-state.json not dispatched: true) never hands off wrap-up — flow/context-handoff.md: continue in place`. Return it through the existing `done(...)` helper so `run()`'s existing SKIP logging writes it to `decisions.md` unchanged — add no new logging code.
- **Header comment:** add one sentence to the file's header comment block naming this refusal beside the other `handoff: null` cases.

- [ ] **Step 1: Failing test** — in `tests/bin-lib/timing/context-gauge.test.js`:
  - Give `runFixture` a `dispatched = false` option that, when `true`, adds `dispatched: true` to the `run-state.json` it writes (only when `worktree` is true, as today).
  - Add test `CLI: a top-level run over the cap with wrap-up in --next-steps writes no handoff — over as measured, handoff: null, reason names the rule`: `runFixture()` (not dispatched), transcript at 250000, `--next-steps review,polish,wrap-up`; assert exit 0, `c.json()` deep-equals `{ contextTokens: 250000, cap: 200000, over: true, transcript: t, handoff: null, reason: <the exact reason string above> }`, `handoff.json` absent from `fx.runDir`, and `decisions.md` in `fx.runDir` contains that reason.
  - Add test `CLI: a dispatched run over the cap with wrap-up in --next-steps still writes handoff.json`: `runFixture({ dispatched: true })`, same arguments; assert `reason: null`, `handoff` is the `handoff.json` path, and the file's `nextSteps` deep-equals `['review', 'polish', 'wrap-up']` and `handoffCount` is 1.
  - Add test `CLI: a top-level run with --record-steps naming wrap-up writes no handoff`, reusing the existing `--record-steps` fixture shape (manifest.yml via `manifestInit`) with one record's list carrying `wrap-up`; assert `handoff: null` and the same reason.
  - Run `node --test tests/bin-lib/timing/context-gauge.test.js` before Step 2: the first and third new tests must FAIL (a handoff is written today). Also expect these existing tests to start failing once Step 2 lands, because they pass `wrap-up` on a top-level fixture and assert a written handoff: the `--cap` override test (`review,polish,wrap-up`), `handoffCount increments` (`review,wrap-up`), the `resume carries the run's mode` test (`review,wrap-up`), and any `--record-steps` test whose step lists include `wrap-up` and expects a handoff. Fix each by passing `dispatched: true` to its `runFixture` call (or adding `dispatched: true` to its hand-written `run-state.json`), never by dropping `wrap-up` from its arguments, so each keeps asserting what it asserted. The bound test (`polish,wrap-up` at 3 earlier handoffs) keeps its bound reason only if the refusal runs after the bound check; since the refusal runs before it, pass `dispatched: true` there too so it still tests the bound. The fallback-identified test returns before the refusal and needs no change.
- [ ] **Step 2: Implement** — the refusal in `measure()` per the decisions above, and the header-comment sentence.
- [ ] **Step 3: Run** `node --test tests/bin-lib/timing/context-gauge.test.js` and `node --test tests/flow-context-handoff-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Refuse a top-level wrap-up handoff in context-gauge.js — enforce context-handoff.md's rule in code, refs #5253`, with the session trailer.

---

## Self-review

- **Spec coverage:** Deliverable 1 (refusal, `handoff: null`, reason, SKIP logged the existing way) → Step 2 and the first new test's `decisions.md` assertion; Deliverable 2 (both sides) → the first and second new tests; AC1 → first test; AC2 → second test; AC3 (`npm test`) → Common Step 5's verification.
- **Placeholders:** none.
