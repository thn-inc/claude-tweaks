# verify report.js git calls omit windowsHide, and the conformance scan cannot see injected-runner calls (#3854) Implementation Plan

**Goal:** `plugin/bin/lib/verify/report.js`'s three git calls pass `windowsHide: true`, and `tests/windows-hide-spawn-conformance.test.js` catches a call made through an injected runner whose default is a `child_process` function.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T060242-record-3854/work/3854-spec.md` (materialized from GitHub issue #3854)

**Scope addition (scope-creep: add-to-plan):** widening the scanner makes the repo-wide `every child_process call under plugin/bin/ passes windowsHide` test see six more injected-runner call sites that lack the flag today (probed with a grep for `<name> = execFileSync` parameter defaults). `npm test` (AC3) cannot pass without them, so each gains the same one-option change.

---

### Task 1: Add windowsHide to report.js's git calls and teach the conformance scan injected runners

**Files:**
- Modify: `plugin/bin/lib/verify/report.js` (gitInfo's two calls, gitDir's one call)
- Modify: `tests/windows-hide-spawn-conformance.test.js` (match calls through an identifier whose default/alias is a child_process function)
- Test: `tests/bin-lib/verify/report.test.js` (fake-execImpl assertions on all three calls)
- Modify: `plugin/bin/calibration-report.js:70` (`runner(...)` options)
- Modify: `plugin/bin/qa-stamp.js:78` (`execImpl(...)` options)
- Modify: `plugin/bin/lib/verify/changed-files.js:29` (`git()` helper's `execImpl(...)` options)
- Modify: `plugin/bin/lib/verify/pre-existing.js:38` (`execImpl(...)` options)
- Modify: `plugin/bin/lib/issues/recent-commit-check.js:91` (`execImpl(...)` options)
- Modify: `plugin/bin/lib/health-core/read-commit.js:25` (`execImpl(...)` options)

- [ ] **Step 1: Failing tests**
  - `tests/bin-lib/verify/report.test.js`: one test with a recording fake `execImpl` asserting `windowsHide: true` on the options of `gitInfo`'s two calls and `gitDir`'s one call (and that `gitDir` still passes `cwd`).
  - `tests/windows-hide-spawn-conformance.test.js`:
    - a scanner self-test: a report.js-shaped snippet (`const { execFileSync } = require('child_process'); function gitInfo(execImpl = execFileSync) { execImpl('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }); }`) is flagged; the same with `windowsHide: true` is not; an object-member default (`cp.execFileSync`) and an alias assignment (`const run = execFileSync;`) are matched too; a `.exec(` method call on another object is not.
    - a live-corpus revert test: read `plugin/bin/lib/verify/report.js`, assert it carries exactly three `windowsHide: true` occurrences, and for each one, removing just that occurrence makes `unhiddenCalls` report exactly one offender.
  - Run: `node --test tests/bin-lib/verify/report.test.js tests/windows-hide-spawn-conformance.test.js` — Expected: FAIL
- [ ] **Step 2: Implement**
  - Add `windowsHide: true` to report.js's three option objects.
  - In `unhiddenCalls`, collect identifiers bound to a child_process function — a parameter default or alias assignment `X = fn` / `X = obj.fn` (terminated by `,` `)` `}` or `;`) where `fn` is a local child_process name or `obj` a child_process module binding — and add them to the call-matching alternation with the same `(?<![.\w])` guard the local names use.
  - Add `windowsHide: true` to the six injected-runner sites listed above.
- [ ] **Step 3: Run** `node --test tests/bin-lib/verify/report.test.js tests/windows-hide-spawn-conformance.test.js` — PASS. Prove discrimination: temporarily drop `windowsHide` from one report.js call and see both the repo-wide scan and the new report test go red, then restore.
- [ ] **Step 4: Commit** — one commit, `Hide verify report.js git windows and scan injected runners — windowsHide`, `refs #3854`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2's report.js edit; Deliverable 2 → Step 2's scanner change + Step 1's self-test. AC1 → report.test.js fake-execImpl test; AC2 → live-corpus revert test (and the Step 3 manual revert); AC3 → Common Step 5's full `npm test` run.
- **Placeholders:** none.
