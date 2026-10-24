# Re-prove downstream checks after a fix inserts an earlier guard (#3988) Implementation Plan

**Goal:** When a fix inserts a precondition guard ahead of an existing check, make the plan-authoring discrimination check and the SDD re-review instructions require re-proving each downstream check's test by mutating that check.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061038-record-3988/work/3988-spec.md` (materialized from GitHub issue #3988)

---

### Task 1: Add the inserted-guard re-proof rule to both texts, pinned by a conformance test

**Role:** transcription

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md`
- Create: `plugin/skills/build/plan-authoring-boundary-checks.md`
- Modify: `plugin/skills/build/dispatch.md`
- Modify: `plugin/skills/build/architecture-alignment.md`
- Modify: `plugin/bin/lib/plan-audit/checks.js` (comment only)
- Modify: `plugin/bin/lib/plan-audit/parser.js` (comment only)
- Modify: `docs/plugin-structure.md`
- Test: `tests/plan-authoring-inserted-guard-reprove-prose.test.js`

**Scope additions (scope-creep policy `add-to-plan`):** the spec's Key Files names only `plan-authoring-checks.md`. Deliverable 2 names the SDD re-review composition site, which is `plugin/skills/build/dispatch.md` (the paragraph that composes every task-reviewer and re-review dispatch instruction, next to the #2740 tree-immutability rule). `plan-authoring-checks.md` is 52,425 B against `RAIL_BYTES` = 52,500 B (`node -e "console.log(require('./plugin/bin/lib/skill-audit/budgets.js').RAIL_BYTES)"` prints `52500`), so the rule cannot be added without freeing bytes. The remedy is the byte-pin check's own: move a genuinely lazy section into a cited sub-file, the way #3592 moved the pairing-loop checks. The Producer-freshness and Upstream-schema premise checks apply only to plans that cross a deployment or foreign-schema boundary, which most plans never do. They move verbatim to `plan-authoring-boundary-checks.md`. Their four citations re-point: `architecture-alignment.md:24`, `checks.js:194`, `parser.js:73`, and `docs/plugin-structure.md`'s build row. Moved-prose pin grep (`git grep -n -F -e "rollout-ordering precondition" -e "attached-but-not-current" -e "per-resource flag" -e "wheel/bundle/image" -- tests plugin docs`) finds no test pin on either moved paragraph, only the paragraphs themselves.

**Incident facts (verified):** `plugin/bin/lib/tiebreak.js:234` is the ±`LINE_TOLERANCE_REPRODUCTION_WIDE` evidence guard. The past-EOF guard (`:241`) and the window check (`:242-245`) run after it. #3945 closed via PR #3954, squash `f007f1c32`.

- [ ] **Step 1: Failing test.** Create `tests/plan-authoring-inserted-guard-reprove-prose.test.js` with exactly this content:

```js
'use strict';
// A fix that inserts an earlier guard re-proves the checks after it (#3988, after #3945's F2 fix wave).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const BUILD = path.join(__dirname, '..', 'plugin/skills/build');
const CHECKS = readText(path.join(BUILD, 'plan-authoring-checks.md'));
const DISPATCH = readText(path.join(BUILD, 'dispatch.md'));
const BOUNDARY = readText(path.join(BUILD, 'plan-authoring-boundary-checks.md'));

const CHECK_LEAD = '**Inserted-guard re-proof check (extends the Guard-branch discrimination check):**';
const DISPATCH_LEAD = '**Downstream re-proof after an inserted guard (#3988).**';

// The plan-authoring rule is its own paragraph; the dispatch rule is one bolded
// instruction inside dispatch.md's long paragraph, ending at the next bold lead.
function section(text, lead, terminator) {
  const start = text.indexOf(lead);
  assert.ok(start >= 0, `missing lead: ${lead}`);
  assert.equal(text.indexOf(lead, start + 1), -1, `lead appears more than once: ${lead}`);
  const end = text.indexOf(terminator, start + lead.length);
  return text.slice(start, end === -1 ? undefined : end);
}

function assertChecksRule(text) {
  const p = section(text, CHECK_LEAD, '\n\n');
  for (const literal of [
    'inserts a precondition guard ahead of an existing check',
    'names each check downstream of the new guard',
    'by mutating that check, not only the new guard',
    '#3945',
  ]) assert.ok(p.includes(literal), `plan-authoring rule lacks: ${literal}`);
  const guardBranch = text.indexOf('**Guard-branch discrimination check (extends the Reachability check):**');
  assert.ok(guardBranch >= 0 && guardBranch < text.indexOf(CHECK_LEAD),
    'the rule must follow the Guard-branch discrimination check it extends');
}

function assertDispatchRule(text) {
  const p = section(text, DISPATCH_LEAD, ' **');
  for (const literal of [
    'every re-review dispatch it composes',
    "the scoped re-review of its final review's fix wave included",
    'inserts a precondition guard ahead of an existing check',
    'names each check downstream of that guard',
    'going red with the check itself mutated, not only the new guard',
    'is not ADDRESSED',
  ]) assert.ok(p.includes(literal), `dispatch rule lacks: ${literal}`);
}

test('AC1.1 (#3988): plan-authoring-checks.md carries the inserted-guard re-proof rule', () => {
  assertChecksRule(CHECKS);
});

test('AC1.1 (#3988): dispatch.md tells every SDD re-review to re-prove downstream checks', () => {
  assertDispatchRule(DISPATCH);
});

test('AC2.1 (#3988): each pin goes red without its rule', () => {
  const dropChecks = CHECKS.replace(section(CHECKS, CHECK_LEAD, '\n\n'), '');
  assert.throws(() => assertChecksRule(dropChecks));
  assert.throws(() => assertChecksRule(
    CHECKS.replace('by mutating that check, not only the new guard', 'by mutating the new guard')));
  const dropDispatch = DISPATCH.replace(section(DISPATCH, DISPATCH_LEAD, ' **'), '');
  assert.throws(() => assertDispatchRule(dropDispatch));
  assert.throws(() => assertDispatchRule(
    DISPATCH.replace('going red with the check itself mutated, not only the new guard', 'going red')));
});

test('the cross-boundary checks moved to their sub-file, with a pointer left behind (#3988)', () => {
  assert.ok(CHECKS.includes('**Cross-boundary checks:**'), 'the pointer paragraph must be present');
  assert.ok(CHECKS.includes('`plan-authoring-boundary-checks.md`'), 'the pointer must name the sub-file');
  for (const lead of ['**Producer-freshness check:**', '**Upstream-schema premise check:**']) {
    assert.ok(BOUNDARY.includes(lead), `the sub-file must hold ${lead}`);
    assert.ok(!CHECKS.includes(lead), `${lead} must live only in the sub-file`);
  }
});
```

- [ ] **Step 2: Run, expect FAIL.**
  Run: `node --test tests/plan-authoring-inserted-guard-reprove-prose.test.js`
  Expected: FAIL (`plan-authoring-boundary-checks.md` does not exist yet, so the module-level read throws ENOENT).

- [ ] **Step 3: Implement.** Make these edits exactly.

  **3a. Create `plugin/skills/build/plan-authoring-boundary-checks.md`** with this header, then a blank line, then the current `**Producer-freshness check:**` paragraph from `plan-authoring-checks.md` (line 67) moved byte-for-byte, then a blank line, then the current `**Upstream-schema premise check:**` paragraph (line 69) moved byte-for-byte, then a trailing newline:

```markdown
# Plan-Authoring Checks — Cross-Boundary Premises

Read from `plan-authoring-checks.md`'s **Cross-boundary checks:** pointer, only when a plan depends on something outside this change's own code: a producer deployed separately from its consumer, or a schema this project does not own. Same purpose as that file: each check targets a failure that reads as correct to a task-level review comparing plan text against implemented code.
```

  **3b. In `plugin/skills/build/plan-authoring-checks.md`,** replace the two moved paragraphs (lines 67 and 69 and the blank line between them) with this single paragraph:

```markdown
**Cross-boundary checks:** when a plan task adds a consumer of an artifact that only this change produces and the two ship through different deployment paths, or a spec or plan asserts a semantic about a schema this project does not own, read `plan-authoring-boundary-checks.md` in this directory and run the matching check (Producer-freshness, Upstream-schema premise). They live there because most plans cross neither boundary.
```

  **3c. In the same file,** insert this paragraph immediately after the `**Guard-branch discrimination check (extends the Reachability check):**` paragraph, separated by blank lines:

```markdown
**Inserted-guard re-proof check (extends the Guard-branch discrimination check):** when a fix inserts a precondition guard ahead of an existing check, the plan names each check downstream of the new guard and re-proves each one's test by mutating that check, not only the new guard. A fixture the new guard now rejects first never reaches the checks after it, so their tests stay green with those checks deleted. #3945's F2 fix wave put the ±5-line evidence guard ahead of `plugin/bin/lib/tiebreak.js`'s past-EOF guard and window check; their tests stopped catching a regression there, and the scoped re-review still marked F2 ADDRESSED (squash `f007f1c32`, PR #3954).
```

  **3d. In `plugin/skills/build/dispatch.md`,** in the long Common Step 2 paragraph, insert this sentence immediately after the sentence ending `would otherwise be silently lost.` (the #2740 tree-immutability rule) and before ` **Review findings go through the deferral gate (#3004).**`. Keep one space on each side:

```markdown
**Downstream re-proof after an inserted guard (#3988).** In the same invocation instruction, also direct `/superpowers:subagent-driven-development` to instruct every re-review dispatch it composes — the scoped re-review of its final review's fix wave included — that when a fix under review inserts a precondition guard ahead of an existing check, it names each check downstream of that guard and shows that check's test going red with the check itself mutated, not only the new guard, in the scratch worktree the rule above requires; a finding whose downstream test stays green is not ADDRESSED.
```

  **3e. Re-point the moved checks' citations:**
  - `plugin/skills/build/architecture-alignment.md:24`: `` per `plan-authoring-checks.md`'s Producer-freshness check `` → `` per `plan-authoring-boundary-checks.md`'s Producer-freshness check ``
  - `plugin/bin/lib/plan-audit/checks.js:194`: `// plan-authoring-checks.md's Upstream-schema premise check (#2575): a plan` → `// plan-authoring-boundary-checks.md's Upstream-schema premise check (#2575): a plan`
  - `plugin/bin/lib/plan-audit/parser.js:73`: `// plan-authoring-checks.md's Upstream-schema premise check: paths or URLs a` → `// plan-authoring-boundary-checks.md's Upstream-schema premise check: paths or URLs a`
  - `docs/plugin-structure.md` build row (line 97): in the file list, `plan-authoring-pairing-checks.md, dispatch.md` → `plan-authoring-pairing-checks.md, plan-authoring-boundary-checks.md, dispatch.md`; in the description, after `moved out for Read-rail headroom (#3592);` insert ` plan-authoring-boundary-checks.md holds the Producer-freshness and Upstream-schema premise checks the plan-authoring checks file points to, moved out for Read-rail headroom (#3988);`

- [ ] **Step 4: Run, expect PASS.**
  Run: `node --test tests/plan-authoring-inserted-guard-reprove-prose.test.js tests/empty-value-probe-check-prose.test.js tests/ceremony-profile-roster.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/parser.test.js`
  Expected: PASS. Then `wc -c plugin/skills/build/plan-authoring-checks.md` must print a value under 52500 (expected ≈ 50,800).

- [ ] **Step 5: Prove discrimination by reverting.** In a scratch copy (never edit the shared tree in place): delete the 3c paragraph from `plan-authoring-checks.md` and confirm the AC1.1 plan-authoring test fails. Separately, delete the 3d sentence from `dispatch.md` and confirm the AC1.1 dispatch test fails. Record both red outputs in the task report.

- [ ] **Step 6: Commit.** One commit: `Re-prove downstream checks after a fix inserts an earlier guard — plan-authoring rule plus SDD re-review instruction, refs #3988`, ending with the line `Claude-Session: https://claude.ai/code/session_01DnYg3w8XDSuxLSQwtrZcV1`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → 3c. Deliverable 2 → 3d. AC1.1 → the two AC1.1 tests. AC2.1 → the AC2.1 go-red test plus Step 5's revert proof.
- **Placeholders:** none.
- **Inline self-consistency:** the test's literals are substrings of the 3c/3d texts verbatim. The dispatch section terminator ` **` does not occur inside the 3d sentence. Each mutation in AC2.1 removes a literal its assertion function requires.
