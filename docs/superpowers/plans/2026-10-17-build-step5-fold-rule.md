# Build Common Step 5 Fold Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/build` from silently dropping a folded plan verification task's non-runner steps — they run before the handoff or are logged as `SKIP`.

**Architecture:** One rule paragraph in `plugin/skills/build/dispatch.md`, placed immediately after the existing "Common Step 5 runs the full suite once" sentence, plus a one-sentence pointer in `plugin/skills/build/SKILL.md` Common Step 5 so the `batched` strategy (which never reads `dispatch.md`) is covered. Both are pinned by new rows in the existing adoption test file, with a go-red control that runs the same assertion function against doctored text.

**Tech Stack:** Markdown skill prose; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194033-record-3118/work/3118-spec.md` (record #3118)

## Global Constraints

- `plugin/skills/build/SKILL.md` stays under `CEILING_BYTES` = 50 * 1024 = 51,200 B (`plugin/bin/lib/skill-audit/context-cost.js:35`; the record's "46,080 at :31" is stale). Current size 46,492 B — headroom ~4.7 KB. The Step 5 addition is one pointer sentence, not the rule.
- `plugin/skills/build/dispatch.md` is 17,139 B; same 51,200 B ceiling (also asserted by `tests/ceremony-profile-roster.test.js`'s "every touched skill file stays under the byte ceiling").
- `tests/build-skip-degrade-trace-adoption.test.js` asserts exactly 6 `**On skip**` sites in `build/SKILL.md`. The pointer must NOT use the literal `**On skip**`, so that count stays 6, unchanged.
- `SKIP` is for an action not performed with no staged artifact (`_shared/auto-decision-log.md` Degrade-trace rule). A step that ran is never logged `SKIP`, never `STAGED`.
- A folded browser step that runs and finds defects is a Step 5-class failure: fixed and committed before the handoff, not deferred to `/review`.
- The rule triggers on the steps a folded plan task names, never on the record's `surface:`.
- `plugin/skills/build/dispatch.md` line 19 is one long paragraph that already carries the roster tag `sdd-whole-branch-review` and the `Whole-branch review skipped: fast-lane, single-task plan` literal (`tests/ceremony-profile-roster.test.js` finds that line by that literal). Insert inside that same paragraph/line; do not add the word `fast-lane` to the new text.
- Commit messages: `{Verb} {what} — {detail}`, body carries `refs #3118` (never closes/fixes), ending with `Claude-Session: https://claude.ai/code/session_01GpTFbqYexJcCNgUWjAsMZu`. Never `git stash`.

## Review Focus

- A folded step that RAN must not be logged `SKIP` — the rule text states this explicitly.
- A folded browser step that ran and found a defect must be fixed before handoff, not deferred to `/review` — stated in the rule.
- Standalone `/build` (no run dir) must route the skip to the handoff's "Skipped steps" section, not `decisions.md` — stated in the rule.
- `batched` execution must also see the rule — the SKILL.md pointer names `batched`.
- The `**On skip**` count test must stay at 6 — the pointer avoids that literal.

---

### Task 1: Fold rule in dispatch.md + Step 5 pointer in SKILL.md, pinned by the adoption test

**Files:**
- Modify: `plugin/skills/build/dispatch.md:19` (insert after the sentence ending `a reviewer-side full run duplicates that pass without producing the artifact.`)
- Modify: `plugin/skills/build/SKILL.md:268` (Common Step 5's first paragraph — append one sentence)
- Test: `tests/build-skip-degrade-trace-adoption.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the rule label `**Folded verification task (#3118).**` in `dispatch.md`, which the SKILL.md pointer cites by the name `"Folded verification task"`.

- [ ] **Step 1: Write the failing tests** — append to `tests/build-skip-degrade-trace-adoption.test.js` (after the existing `BUILD_STEP_SKIP_SITES` loop / `**On skip**` count test; add `const BUILD_DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');` beside the other `read(...)` constants at the top):

```js
// --- #3118: folded plan verification task contributes only its runner checks ---

function assertFoldRule(text) {
  assert.match(text, /A plan task folded into Common Step 5[^\n]*?contributes only its runner checks/,
    'dispatch.md must state a folded plan task contributes only its runner checks (AC1.1)');
  assert.match(text, /Every other step it names runs after Step 5 passes and before Common Step 7's handoff/,
    'dispatch.md must state every other named step runs before the handoff (AC1.1)');
  assert.match(text, /writes `SKIP \{time\} — \{plan task\} step "\{step\}" \(skipped\): \{condition\} → not run by \/build; surfaced for \/review\. Reversibility: n\/a\.` via `log-decision\.js --status SKIP --section "\/build"`/,
    'dispatch.md must name the SKIP entry for a step that cannot run (AC1.1)');
  assert.match(text, /Skipped steps/, 'standalone /build must route the skip to the handoff Skipped steps section');
  assert.match(text, /A step that ran is never logged as `SKIP`/);
  const anchor = text.indexOf('Common Step 5 runs the full suite once');
  const rule = text.indexOf('A plan task folded into Common Step 5');
  assert.ok(anchor !== -1 && rule > anchor, 'the fold rule must follow the "runs the full suite once" sentence');
}

test('AC1.1: build/dispatch.md states the fold rule — runner checks only; every other named step runs or writes a SKIP entry', () => {
  assertFoldRule(BUILD_DISPATCH);
});

test('AC3.1: go-red — the fold-rule assertions fail when the fold sentence is removed from dispatch.md', () => {
  const doctored = BUILD_DISPATCH.replace(/A plan task folded into Common Step 5[\s\S]*?(?=Every other step it names)/, '');
  assert.notEqual(doctored, BUILD_DISPATCH, 'doctoring must actually remove the fold sentence');
  assert.throws(() => assertFoldRule(doctored));
});

test('AC2.1: build/SKILL.md Common Step 5 points at the dispatch.md fold rule, including under batched', () => {
  const step5 = BUILD_SKILL.split('### Common Step 5: Final Verification')[1].split('### Common Step 5.5')[0];
  assert.match(step5, /a plan task folded into this step contributes only its runner checks/);
  assert.match(step5, /`dispatch\.md`'s "Folded verification task" rule/);
  assert.match(step5, /`batched`/);
  assert.doesNotMatch(step5, /\*\*On skip\*\*/, 'AC4.1: the pointer avoids the **On skip** literal, so the count of 6 stays unchanged');
});
```

AC4.1 is covered by the `assert.doesNotMatch` above plus the existing, unchanged `assert.equal(onSkipCount, 6, …)` test. AC5.1 is covered by the existing `tests/ceremony-profile-roster.test.js` "every touched skill file stays under the byte ceiling" test (lists both `build/SKILL.md` and `build/dispatch.md`). AC6.1 is Common Step 5's `npm test` run.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/build-skip-degrade-trace-adoption.test.js`
Expected: FAIL — the AC1.1, AC3.1 (`assert.notEqual` — nothing to remove yet) and AC2.1 tests fail; all pre-existing tests pass.

- [ ] **Step 3: Implement the prose** (exact copy — the spec fixes the SKIP line)

In `plugin/skills/build/dispatch.md` line 19, immediately after `a reviewer-side full run duplicates that pass without producing the artifact.` and before ` The upstream step this instruction targets`, insert (same line, one leading space):

```
**Folded verification task (#3118).** A plan task folded into Common Step 5 (typically a final "full verification, no new code" task) contributes only its runner checks — the types, lint, and tests `test/verification.md` runs. Every other step it names runs after Step 5 passes and before Common Step 7's handoff: a browser check through `/claude-tweaks:browse`, a script by running it. One that runs and finds a defect is a Step 5-class failure — fix it and commit before the handoff, never defer it to `/review`. A step that cannot run (no browser backend, no dev server, a truly manual check) writes `SKIP {time} — {plan task} step "{step}" (skipped): {condition} → not run by /build; surfaced for /review. Reversibility: n/a.` via `log-decision.js --status SKIP --section "/build"` per `_shared/auto-decision-log.md`'s Degrade-trace rule; standalone `/build` (no run dir) lists it in the Step 7 handoff's Skipped steps section instead (`handoff-template.md`). A step that ran is never logged as `SKIP`. The rule keys on the steps the folded task names, not on the record's `surface:`.
```

In `plugin/skills/build/SKILL.md` Common Step 5, append to the end of the first paragraph (the one ending `using the project's commands from CLAUDE.md.`), one leading space:

```
**Folded plan tasks:** a plan task folded into this step contributes only its runner checks — every other step it names runs before Common Step 7 or writes a `SKIP` entry, per `dispatch.md`'s "Folded verification task" rule, which applies under `batched` too.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/build-skip-degrade-trace-adoption.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS (all tests, including the unchanged `**On skip**` count of 6 and both byte-ceiling checks).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md plugin/skills/build/SKILL.md tests/build-skip-degrade-trace-adoption.test.js
git commit -m "Narrow /build's Common Step 5 fold — folded plan task contributes only runner checks; other steps run or log SKIP

refs #3118

Claude-Session: https://claude.ai/code/session_01GpTFbqYexJcCNgUWjAsMZu"
```
