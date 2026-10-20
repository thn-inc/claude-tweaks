# friction-events.js non-UTC claim boundary regression tests (#3641) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove `friction-events.js` keeps post-claim friction events on hosts ahead of and behind UTC when `decisions.md` is stamped by the real log-decision writer.

**Architecture:** Deliverable 1 already shipped as #3442 (`4dbf60b8d`). `computeClaimBoundary` now resolves the local `HH:MM:SS` against the mint's local calendar day, which is the spec's first alternative ("interpret ... in the same zone `append.js` wrote it in"). No production change is needed. This plan adds the regression tests the spec asks for. Each test stamps `decisions.md` through `plugin/bin/lib/log-decision/append.js`'s `formatEntry` + `appendEntry`, the module `bin/log-decision.js` wraps, then runs `friction-events.js`'s `run()`.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124158-record-3641/work/3641-spec.md`

## Global Constraints

- Expand-contract: keep reading the existing `HH:MM:SS` form for runs already on disk. Unchanged here, because the format is not touched.
- Tests use the existing `withTz` helper in `tests/friction-events-cli.test.js` and per-test `fs.mkdtempSync` dirs, the same way neighboring tests do.

## Review Focus

- Host behind UTC whose mint UTC day differs from its local day (LA evening = next UTC day): pinned by the AC2 test's fixture (mint `2026-10-19T050000`, 22:00 PDT on 10-18).
- A fixture that silently writes UTC (TZ not honored) would make the test vacuous: each test asserts the stamped `decisions.md` line carries the local clock (`20:59:10` / `22:01:00`).

---

### Task 1: TZ-parameterized claim-boundary tests

**Files:**
- Modify: `tests/friction-events-cli.test.js` (insert after the last `#3442` test, before the `#2016` vocabulary section)

**Interfaces:**
- Consumes: `formatEntry({status, now, step, text, reversibility})`, `appendEntry({runDir, section, entry})` from `plugin/bin/lib/log-decision/append.js`; `run(argv, deps)` and `readEvents` from `plugin/bin/friction-events.js`; the file's `fakeDeps` and `withTz` helpers.

- [ ] **Step 1: Write the tests**
  - `#3641 AC1.1: a log-decision-stamped claim under TZ=Europe/Copenhagen keeps a later wd-guard-refusal`: dir `2026-10-19T185800-record-999`, claim `now = Date.UTC(2026, 9, 19, 18, 59, 10)`, events `wd-guard-refusal` at `18:58:30Z` (pre) and `19:05:00Z` (post). Assert that decisions.md contains `- AUTO 20:59:10 —`, and that `run()` stdout holds exactly the `19:05:00Z` event.
  - `#3641 AC2.1: under TZ=America/Los_Angeles a pre-claim event is still excluded`: dir `2026-10-19T050000-record-999`, claim `Date.UTC(2026, 9, 19, 5, 1, 0)`, events at `05:00:30Z` (pre) and `05:05:00Z` (post). Assert that decisions.md contains `- AUTO 22:01:00 —`, and that the output holds exactly the `05:05:00Z` event.
  - `run()` is called with `fakeDeps({ readEvents })`, the real `readEvents` injected.
- [ ] **Step 2: Run** `node --test tests/friction-events-cli.test.js`. Expected: PASS (fix already on base).
- [ ] **Step 3: Revert-proof (AC3.1)**. Temporarily replace the two `claimed = new Date(...)` lines in `computeClaimBoundary` with the pre-#3442 form from `git show 4dbf60b8d^:plugin/bin/friction-events.js`, and run the file again. Expected: both `#3641` tests FAIL. Then restore with `git checkout -- plugin/bin/friction-events.js` and re-run. Expected: PASS.
- [ ] **Step 4: Commit** `tests/friction-events-cli.test.js`, message `Add non-UTC claim-boundary regression tests for friction-events — refs #3641`.

## Self-review

- Spec coverage: Deliverable 1 is already on base (premise reversal logged). Deliverable 2 is covered by Step 1. AC1 and AC2 are covered by Step 1. AC3 is covered by Step 3.
- Placeholders: none.
