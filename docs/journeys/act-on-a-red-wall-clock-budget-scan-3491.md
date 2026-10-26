---
files:
  - tests/wall-clock-budget-conformance.test.js
  - tests/helpers/strip-comments.js
  - docs/plugin-structure.md
  - perf/closing-keyword-linearity.test.js
---

# Act on a Red Wall-Clock Budget Scan

**Persona:** A claude-tweaks plugin maintainer adding a test under `tests/` that times something with `performance.now()`, `Date.now()` or `process.hrtime`, then asserts the elapsed time against a number (`assert.ok(elapsed < 200)`). `npm test` goes red on `tests/wall-clock-budget-conformance.test.js`.
**Goal:** Put the timing budget where it cannot flake the default suite, without losing the behaviour the budget was guarding.
**Entry point:** `npm test` (or `node --test tests/wall-clock-budget-conformance.test.js`) reports `not ok … AC1.1, AC3.1: every tests/**/*.test.js passes the scan against ALLOWLIST`. Its diff lists one line per budget:
`tests/{file}:{line}: {comparison} — a wall-clock budget under tests/ flakes under load; move it to perf/ (run by npm run test:perf), or pin this site in ALLOWLIST with a reason. See docs/plugin-structure.md.`
**Success state:** Either the timing assertion lives in a `perf/*.test.js` file, or the site is pinned in the scan's `ALLOWLIST` by its comparison text with a one-line reason. Any functional assertions stay in `tests/`. `npm test` is green.

## Steps

### 1. Read the offender line
- **URL:** the failing assertion's diff in the test run.
- **Action:** Open `tests/{file}:{line}` and find the comparison the line quotes.
- **Should feel:** Pinpointed. The line is exact, and it already names both fixes and the doc behind the rule.
- **Should understand:**
  - A budget is a `<`, `<=`, `>` or `>=` comparison whose one side is a wall-clock reading and whose other side is a number. The reading can be direct, or come through a variable or helper derived from one in the same test body. The number is a literal or a numeric `const`.
  - A ratio of two timings (`elapsed < 4 * baseline`) is not a budget and is never flagged.
  - Neither is a timestamp passed into a call or checked for freshness against a non-numeric value.
  - A `{file}: …` line naming the comment stripper means the file could not be parsed (`tests/helpers/strip-comments.js`). That is not a budget hit.
- **Red flags:**
  - Silencing the scan by hiding the reading: moving it into an opaque helper call, or comparing against `cond ? 500 : 200`. That still flakes; it is only invisible (the header's known limits 1 and 3).

### 2. Move the budget to perf/
- **URL:** `perf/` (example: `perf/closing-keyword-linearity.test.js`, #3412's regex-linearity budget) and `docs/plugin-structure.md`'s `perf/` entry.
- **Action:** Split the test. The functional assertions stay in `tests/`. The timing assertion moves to a new `perf/{topic}.test.js` with a header comment explaining why it lives there.
- **Should feel:** Like a relocation rather than a rewrite. The perf file keeps the same input and the same bound.
- **Should understand:** `npm test` never runs `perf/` (`tools/run-tests.js`'s default roots are `tests/` and `tools/upstream-drift/tests/`). `npm run test:perf` runs it, alone and without a competing suite, so its bound can stay tight.
  - A concurrency bound (the probes must overlap) leaves a deterministic remainder in `tests/`: wrap the slowed call in an in-flight counter (increment, record the max, await, decrement in `finally`) and assert the max. A serial run reads 1. Example: `tests/bin-lib/wrap-up/pack.test.js`'s `gatherPack` test.
- **Red flags:**
  - Deleting the timing assertion outright when it was the only proof of a linearity or non-blocking property.
  - Loosening the bound to an arbitrary large number and keeping it in `tests/`. That is still a budget, still flagged, and still flaky under enough load.

### 3. Or pin it, deliberately
- **URL:** the `ALLOWLIST` object in `tests/wall-clock-budget-conformance.test.js`.
- **Action:** When the timing is inseparable from a functional assertion, pin the site:
  - Add the comparison's whitespace-collapsed text to the file's `sites` list, or create a `{ sites, reason }` entry for the file.
  - Write a one-line `reason` that says why it cannot move to `perf/`. A pin is only for a timing inseparable from the functional assertion; a bound that can be split from its functional half moves instead (#3939 moved every pre-existing pin this way, so `ALLOWLIST` is empty).
- **Should feel:** Visible and reviewable. The bypass is an audit record in the diff, never a deleted test.
- **Should understand:**
  - Pins are by text, not count. Removing one budget and adding another in the same file still fails.
  - A pin whose site is gone fails as stale until it is removed.
  - An entry with no `reason` or no `sites` fails.
- **Red flags:**
  - Pinning a new budget to get green, when it could have been moved.
  - A reason that only restates the comparison.
  - Editing the matcher to stop seeing the site.

### 4. Re-run and confirm
- **URL:** the scan and the edited test's own suite.
- **Action:** Run `node --test tests/wall-clock-budget-conformance.test.js` and the edited file's suite. If you moved a budget, also run `npm run test:perf`.
- **Should feel:** Mechanical. All three are green.
- **Should understand:** The scan walks exactly the files `npm test` runs. A budget in a newly added `tools/upstream-drift/tests/` file is caught the same way.
- **Red flags:** A green scan after the matcher stopped seeing a `perf/` site. The conformance suite's `MOVED_TO_PERF` map pins the moved budgets' comparison texts in their `perf/` files, so a blinded matcher fails there. Editing the map to match, when no budget was deliberately changed, means the matcher went blind, not that the budget left.

## Origin
- Created during build of #3491. That build added the conformance scan and the stripper's opt-in `literals: 'blank'` mode it reads. It pinned the 12 pre-existing budgets in 9 `tests/` files on the allow-list. #3939 then moved those 12 to `perf/`, emptied `ALLOWLIST`, and added the `MOVED_TO_PERF` map as the scan's floor.
- Related: `act-on-a-red-path-containment-scan-3498.md` and `act-on-a-red-path-guard-lint-3417.md` (sibling source-scan conformance tests over the same shared stripper).
