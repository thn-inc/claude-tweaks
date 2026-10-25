# Move ownEventRecency into run-liveness (#4154) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sure no module under `plugin/bin/lib/run-liveness/` requires `reconcile/`. To do that, move the pure reader `ownEventRecency` out of `reconcile/archive-merged.js` and into `run-liveness/probes.js`.

**Architecture:** `ownEventRecency(runDir)` is a ~12-line pure reader over `readEventLines` (from `../hooks/context`, which `probes.js` already imports). It moves verbatim, header comment included, into `probes.js` and is exported alongside `DEFAULT_PROBES`. `archive-merged.js` deletes its own copy and imports the function from `../run-liveness/probes`. It keeps it in its own `module.exports` so every existing importer keeps working. `ownEventAt` calls the now-local function and drops its lazy `require('../reconcile/archive-merged')`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T145943-record-4154/work/4154-spec.md`

## Global Constraints

- No module under `plugin/bin/lib/run-liveness/` may `require` anything under `reconcile/`.
- Existing `tests/bin-lib/run-liveness/probes.test.js` and `tests/bin-lib/reconcile/archive-merged.test.js` pass **unchanged**. No edits to any test file.
- No user-visible change. `ownEventRecency`'s return shape stays exactly `{ readable: boolean, lastOwnMs: number|null }`.

**Corrected premise (logged to decisions.md):** the spec says "There is no cycle today". That is stale. `archive-merged.js:17` already does `const { runLiveness } = require('../run-liveness');`, and `run-liveness/index.js:19` requires `./probes`. So archive-merged → run-liveness → probes → archive-merged is a live cycle today, broken only by `probes.js:44`'s lazy in-function require. The fix is unchanged.

**Sole-site evidence** (`grep -rn "ownEventRecency" plugin tests`, run at authoring): the only code callers are `plugin/bin/lib/run-liveness/probes.js:44-45` and `plugin/bin/lib/reconcile/archive-merged.js:349,1770` (definition at 333, export at 2513). The other hits are comments: `plugin/bin/lib/hooks/context.js:1013`, `tests/hooks-context.test.js:651`, and `tests/bin-lib/reconcile/archive-merged.test.js:2800,2829`. No test imports `ownEventRecency` directly. `archive-merged.test.js` imports `lastOwnEventMs`, which stays in archive-merged as a thin wrapper.

## Review Focus

- A `fallback`-attributed line and an unparseable `ts` must still be skipped. The body moves verbatim, so the existing `lastOwnEventMs` tests in `archive-merged.test.js` (2844-2857) pin this behavior through the wrapper.
- An absent `events.jsonl` must still give `{ readable: false, lastOwnMs: null }`, not a throw. Already pinned by `lastOwnEventMs: null when events.jsonl is absent`. `ownEventAt` still throws on unreadable, which is pinned by `probes.test.js`.
- Load order: `archive-merged.js` requiring `../run-liveness/probes` at top level must not hit a partially-initialised export. `probes.js` requires no `reconcile/` module, so there is no cycle to observe. Verified by the AC grep plus loading both modules in the suite.

---

### Task 1: Move ownEventRecency into run-liveness/probes.js

**Files:**
- Modify: `plugin/bin/lib/run-liveness/probes.js:34-67` (add `ownEventRecency` + its header comment above `ownEventAt`; replace the lazy require; export it)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:307-344` (delete the definition + its header comment; add `const { ownEventRecency } = require('../run-liveness/probes');` beside line 17's run-liveness require; keep `ownEventRecency` in the line-2513 export list)
- Modify: `plugin/bin/lib/hooks/context.js:1013` (comment only: `archive-merged.js's ownEventRecency` → `run-liveness/probes.js's ownEventRecency`)

**Interfaces:**
- Produces: `ownEventRecency(runDir: string) -> { readable: boolean, lastOwnMs: number|null }`, exported from `plugin/bin/lib/run-liveness/probes.js` as `module.exports = { DEFAULT_PROBES, ownEventRecency }`. Still re-exported from `archive-merged.js`.

- [ ] **Step 1: Failing check (AC1.1)** is the spec's own grep, no new test file. The AC asks for a grep, and the repo keeps no require-graph test for this module.

- [ ] **Step 2: Run it to verify it fails**

Run: `! grep -rn "require('../reconcile/" plugin/bin/lib/run-liveness`
Expected: FAIL (exit 1). grep prints one hit, `plugin/bin/lib/run-liveness/probes.js:44: ... require('../reconcile/archive-merged');`

- [ ] **Step 3: Implement the move**

Move lines 307-344 of `archive-merged.js` (the `// #1737:` header comment and the function) into `probes.js` immediately above the `ownEventAt` header comment. Body unchanged; `readEventLines` is already imported there. In the moved header, change "`isAbandonedInterrupted` used to ask" so it still reads correctly from its new home: "(archive-merged.js's `isAbandonedInterrupted` used to ask)". In `ownEventAt`, delete the two lines `// Lazy: ...` and `const { ownEventRecency } = require('../reconcile/archive-merged');`. In `archive-merged.js`, add the import on the line after line 17. The `lastOwnEventMs` wrapper and its comment stay ("`ownEventRecency` above" → "`ownEventRecency` (run-liveness/probes.js)").

- [ ] **Step 4: Verify (AC1.1, AC2.1, AC2.2)**

Run: `! grep -rn "require('../reconcile/" plugin/bin/lib/run-liveness`
Expected: PASS (exit 0, no output)

Run: `node --test tests/bin-lib/run-liveness/probes.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/run-liveness/index.test.js tests/hooks-context.test.js`
Expected: PASS, 0 failures

Run: `git diff --stat -- tests`
Expected: empty (tests unchanged)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/probes.js plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/hooks/context.js
git commit -m "Move ownEventRecency into run-liveness/probes — drop run-liveness's require of reconcile/ (refs #4154)"
```

Waived AC3.1: the full `npm test` run is `/build` Common Step 5's verification (and `/test`'s gate), run centrally after this task, not a task test step.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3. Deliverable 2 → Step 4's grep. AC1.1 → Steps 2/4 grep. AC2.1/AC2.2 → Step 4's targeted run + `git diff --stat -- tests`. AC3.1 → Common Step 5.
- **Placeholders:** none.
