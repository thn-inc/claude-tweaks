# Dispatch first-call teardown wording (#3367) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dispatch's prose name the same first-call failure teardown `two-call-gate.md` section 5 actually specifies (a direct `/claude-tweaks:wrap-up {target} cleanup-only` call), and pin it with a prose-conformance assertion.

**Architecture:** Two in-place sentence rewrites in `plugin/skills/dispatch/` plus one `node --test` assertion that scans every `.md` under that directory for the retired `/flow`-routed teardown phrase.

**Tech Stack:** Markdown skill prose; `node --test` with `tests/helpers/read-skill`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183825-record-3367/work/3367-spec.md` (materialized from GitHub issue #3367)

## Global Constraints

- New wording cites `two-call-gate.md` section 5 instead of restating its #1766 rationale (Deliverable 1).
- `plugin/skills/dispatch/SKILL.md` must stay under the shared 51,200-byte `CEILING_BYTES` (currently 46,305 B; the edit adds ~30 B).
- Commit messages: `{Verb} {what} — {detail}`, `refs #3367`, never a closing keyword.

## Review Focus

- `two-call-gate.md:23` names `/claude-tweaks:flow {target} wrap-up cleanup-only` as the *rejected* form in its #1766 rationale — the assertion must not trip on it (negative lookahead on ` cleanup-only`).
- `settle-parked.md:89` and `resume-confirmation.md:45` use `/claude-tweaks:flow "{target}" wrap-up` (quoted target) for parked-run resume — a legitimate, different command; the assertion's literal `{target}` (unquoted) does not match them.
- `plugin/skills/dispatch/SKILL.md:227` carries the same stale teardown phrase ("one further explicit `/claude-tweaks:flow {target} wrap-up` call") — added to scope under `scope-creep: add-to-plan`, since Deliverable 2's dispatch-wide assertion cannot pass without it.
- Moved-prose pin check: `git grep -n -F` over `tests` and `plugin` for "routes through the explicit", "one further explicit", "Where that teardown falls", "always through wrap-up's own cleanup" found no test pins — only the two source lines themselves.

---

### Task 1: Retire the `/flow`-routed first-call teardown wording across dispatch

**Files:**
- Modify: `plugin/skills/dispatch/sequential-execution.md:58`
- Modify: `plugin/skills/dispatch/SKILL.md:227`
- Test: `tests/dispatch-sequential-execution-conformance.test.js`

**Interfaces:**
- Consumes: `readText` from `tests/helpers/read-skill` (already imported in the test file); `fs.readdirSync` for the directory scan.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the failing tests** — append to `tests/dispatch-sequential-execution-conformance.test.js`:

```js
// #3367: two-call-gate.md section 5 makes the first-call teardown a direct
// /claude-tweaks:wrap-up {target} cleanup-only call (#1766). The retired form
// routed it through /flow. The " cleanup-only" lookahead exempts section 5's
// own rationale, which names the rejected /flow form on purpose; the quoted
// "{target}" parked-run resume command in settle-parked.md is a different literal.
const STALE_TEARDOWN = /\/claude-tweaks:flow \{target\} wrap-up(?! cleanup-only)/;

test('AC1.1/AC1.2: sequential-execution.md names the direct wrap-up cleanup-only call as the first-call teardown (#3367)', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  const para = t.slice(t.indexOf('Where that teardown falls'));
  assert.match(para.slice(0, para.indexOf('\n')), /`\/claude-tweaks:wrap-up \{target\} cleanup-only`[^\n]*`two-call-gate\.md` section 5/);
  assert.ok(!t.includes('/claude-tweaks:flow {target} wrap-up'), 'no /flow-routed teardown remains');
});

test('AC2: no file under plugin/skills/dispatch/ describes the first-call teardown as /claude-tweaks:flow {target} wrap-up (#3367)', () => {
  const dir = path.join(ROOT, 'plugin', 'skills', 'dispatch');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .filter((f) => STALE_TEARDOWN.test(readText(path.join(dir, f))));
  assert.deepStrictEqual(offenders, []);
});
```

Add `const fs = require('fs');` beside the existing `path` require.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/dispatch-sequential-execution-conformance.test.js`
Expected: FAIL — the AC1 test fails its `assert.match`, and the AC2 test reports `['SKILL.md', 'sequential-execution.md']` as offenders.

- [ ] **Step 3: Rewrite both sentences in place**
  - `sequential-execution.md:58`: replace "teardown routes through the explicit `/claude-tweaks:flow {target} wrap-up` call `two-call-gate.md` section 5 specifies" with "teardown is the direct `/claude-tweaks:wrap-up {target} cleanup-only` call `two-call-gate.md` section 5 specifies". Rest of the paragraph unchanged.
  - `SKILL.md:227`: replace "one further explicit `/claude-tweaks:flow {target} wrap-up` call" with "one further direct `/claude-tweaks:wrap-up {target} cleanup-only` call (`two-call-gate.md` section 5)". Rest of the paragraph unchanged.

- [ ] **Step 4: Run tests to verify they pass, then prove AC2 discriminates**

Run: `node --test tests/dispatch-sequential-execution-conformance.test.js`
Expected: PASS (5 tests).

AC2.1 go-red control: temporarily restore the old `sequential-execution.md:58` phrase (`git show HEAD:plugin/skills/dispatch/sequential-execution.md > plugin/skills/dispatch/sequential-execution.md`), re-run the same command — Expected: FAIL with `sequential-execution.md` in the offenders list — then restore the fix (re-apply the Step 3 edit) and re-run — Expected: PASS.

Also run the suites that pin `dispatch/SKILL.md` bytes: `node --test tests/dispatch-graphql-blocked-preflight.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/timing-prose-conformance.test.js tests/flow-cleanup-only-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/sequential-execution.md plugin/skills/dispatch/SKILL.md tests/dispatch-sequential-execution-conformance.test.js
git commit -m "Name the direct wrap-up cleanup-only teardown in dispatch prose — retire the /flow-routed form (refs #3367)"
```

AC3 (`npm test` passes) is covered by `/build` Common Step 5's full verification run, not by this task.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3 first bullet; Deliverable 2 → Step 1's AC2 test; AC1 → AC1 test; AC2 (fails on restore, passes after) → Step 4 go-red control; AC3 → Common Step 5.
- **Placeholders:** none.
- **Proportion:** one task, two one-clause edits, two tests.
