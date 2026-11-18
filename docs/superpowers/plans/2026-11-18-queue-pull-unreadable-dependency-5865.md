# Queue pull (files transport): an unreadable dependency fails closed (#5865) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the files transport, the agent writes `{"number": N, "state": "unreadable"}` for a dependency `issue_read` cannot read; the queue pull treats it as open, prints one Warning naming every such number, and persists no queue-order cache.

**Architecture:** A new pure reader `unreadableDependencyNumbers(text)` beside `closedDependencyNumbers` in `plugin/bin/lib/dispatch/queue-pull.js` returns the numbers the agent's dependency-freshness text marks `unreadable`. The blocked pass's files-transport block (the #5408 block, ~line 706) calls it once: a non-empty set prints one Warning and sets `state.depFreshFailed`, which `runWriteBack` already honours (`if (state.depFreshFailed) return;`). `closedDependencyNumbers` already counts a non-`closed` state as not closed; a test pins it.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-18T072534-spec-5879-5863-5865-5830/spec-5865/work/5865-spec.md`

## Global Constraints

- The Warning line, exactly (numbers ascending, `, `-joined, each `#`-prefixed): `Warning: dependency-freshness file marks #8000 unreadable — treated as open (fail closed), queue-order cache not written this run`
- Exactly one Warning names an unreadable number per pull: the #5408 `verified-open-deps file omits #N …` Warning is not printed for a number the freshness file marks `unreadable` (the number is still added to `openNumbers` and still sets `state.depUnreadable`, as today). This is how AC "prints exactly one Warning naming #8000" holds when #8000 is also absent from the verified-open-deps file.
- An `unreadable` entry is recognised only when it is a valid entry by `closedDependencyNumbers`'s own test (integer `number`, string `state`) and `state.toLowerCase() === 'unreadable'`.
- Files transport only. The gh transport and the fence (`plugin/skills/dispatch/queue-pull-script.md`) do not change; this block stays module-only like the #5408 block above it (its comment already says so).
- `plugin/skills/dispatch/SKILL.md` stays at or under `RAIL_BYTES` (52,500; it is 51,988 now and this plan does not edit it). `mcp-transport.md` (27,452 bytes) has ample room.
- Scope: Touch only what the task requires.

## Review Focus

1. A freshness file with an `unreadable` entry and `closed` entries for other dependencies — expected: no cache written, the others still counted closed (AC3). Pinned in Step 1.
2. An `unreadable` entry for a dependency the verified-open-deps file lists as open (the well-behaved agent case, mcp-transport.md's `--verified-open-deps` bullet) — expected: one unreadable Warning, record blocked, no cache. Pinned in Step 1.
3. A contradictory pair (`closed` and `unreadable` for one number) — expected: not closed (the existing contested rule) and marked unreadable. Pinned in Step 1.
4. A cache-hit pull — `runWriteBack` returns before any write on a hit, so nothing changes there; the warning still prints from the blocked pass whenever that pass runs.
5. `"UNREADABLE"` in another case — expected: recognised (case-insensitive, matching `isClosed`).

---

### Task 1: Unreadable entry fails closed on the files transport

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (new `unreadableDependencyNumbers` beside `closedDependencyNumbers` ~line 308; the files block of the blocked pass ~line 706)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (the `--dep-freshness` bullet, line 83)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (a new test after the `AC1.1, AC1.2 (#5408)` test, ~line 1147, reusing its `run` harness shape)

**Interfaces:**
- Produces: `unreadableDependencyNumbers(text: string|null) -> number[]` (ascending, de-duplicated; `[]` for null, unparseable, or a non-array). Module-internal: not exported. Only `closedDependencyNumbers` is added to `module.exports` (if not already there), for Step 1's unit assertion. The caller wraps the array in `new Set(...)` for membership lookups and uses the array itself for the Warning's ascending number list.

- [ ] **Step 1: Write the failing test (AC1.1, AC2.1, AC3.1, AC3.2)** `#5865: files: a dependency-freshness entry marked unreadable is treated as open, prints one Warning naming it and writes no queue-order cache`, built on the #5408 test's `run(blockedBody, freshness, verified)` harness (copy the harness, do not share mutable state). Cases:
  - `run('Blocked by #8000', '[{"number":8000,"state":"unreadable"}]')` (8000 absent from verified-open-deps): `entriesOf(r, 'blocked')` equals `[{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }]`; the Warning lines that contain `#8000` are exactly `[UNREADABLE(8000)]` (filter `r.stderr` lines starting `Warning:` and including `#8000`); `r.store.written.length === 0`.
  - Same with `verified = '8000\n'`: same three assertions.
  - `'[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"closed"}]'`: `groupNumbers(r)` is `[[9001], [9002]]`, no Warning line contains `unreadable`, `r.store.written.length === 1`.
  - #9002 blocked by both (`Blocked by #8000\nBlocked by #8001` as its blocked body, verified-open-deps empty) with `[{"number":8000,"state":"unreadable"},{"number":8001,"updated_at":"2026-11-09T10:00:00Z","state":"closed"}]`: `r.store.written.length === 0`; `entriesOf(r, 'blocked')` equals `[{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }]` (#8001 counted closed, so it is not in `blockedBy`); exactly one Warning line names #8000 and no Warning line names #8001.
  - `'[{"number":8000,"state":"closed"},{"number":8000,"state":"UNREADABLE"}]'`: blocked as above, one `UNREADABLE(8000)` Warning, no cache.
  - A unit assertion that `closedDependencyNumbers('[{"number":8000,"state":"unreadable"}]')` has no 8000 (export it for the test if it is not exported; the module's export list is at the bottom of the file).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "#5865" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL after Step 1 (no unreadable Warning is printed; the closed-other-deps case writes a cache it must not).

- [ ] **Step 3: Implement** `unreadableDependencyNumbers` (same parse and validity rules as `closedDependencyNumbers`) and, in the blocked pass's files block, compute the set once from `state.depFreshnessInput` before the omitted-dependency loop: skip the omitted-dependency Warning for a number in the set (still `openNumbers.add` and `state.depUnreadable = true`), and after the loop, when the set is non-empty, print the Global Constraints Warning once and set `state.depFreshFailed = true`. Run the unreadable check whether or not the verified-open-deps file was `bad`. Update the block's comment to cite #5865.

- [ ] **Step 4: Update `mcp-transport.md`'s `--dep-freshness` bullet:** replace "a number `issue_read` cannot read is left out" with: a number `issue_read` cannot read gets the entry `{"number": N, "state": "unreadable"}`, which the CLI treats as open, names in one Warning, and never persists to the queue-order cache.

- [ ] **Step 5: Run the suites and verify the revert goes red (AC4.1)**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS, 0 failures. Then revert the Step 3 change in `queue-pull.js` (the new function and its call site; keep the `closedDependencyNumbers` export), re-run the `#5865` test, see it FAIL on the `#5865` assertions themselves — a module-load error is not a valid red — and restore it. Quote both raw outputs. Also run `node --test tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/budgets.test.js` (AC5.1, rail) — Expected: PASS.

- [ ] **Step 6: Commit** — `Fail closed on an unreadable dependency in the files-transport freshness file (refs #5865)`.

---

## Self-review

- Deliverables: mcp-transport bullet → Step 4; module Warning + `depFreshFailed` + never closed → Steps 1, 3; no cache when `depFreshFailed` → existing `runWriteBack` guard, asserted in Step 1.
- AC1-AC3 → Step 1 cases; AC4 → Step 5 revert; AC5 → Step 4 and the Step 5 rail run.
