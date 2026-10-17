# Flow ledger creation after worktree (#3036) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/flow` run under `worktree-always` creates its open-items ledger inside the run's worktree, right after the worktree exists, instead of at Step 1.8 where no writable location exists yet.

**Architecture:** Prose-only change to six skill files plus one `node --test` conformance suite. Step 1.8 keeps creation only for runs that never get a new worktree; a new `build/worktree-setup.md` Step 4.6 (single-spec) and `flow/multi-spec.md` "Shared worktree" step 1 (multi-spec) create it after the worktree exists; `_shared/ledger-format.md`'s No-worktree run exception is re-keyed on the resolved strategy/run shape; review's QA Ledger Check learns the new log locations.

**Tech Stack:** Markdown skill prose; `node --test` (built-in runner, no deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062228-spec-3036/work/3036-spec.md`

## Global Constraints

- Creation log line, byte-for-byte (#1800): `AUTO {time} — flow: created open-items ledger {path}. Reversibility: n/a.`
- `tests/pr-early-run-lifecycle-step1-logging-conformance.test.js` must stay green: `flow/SKILL.md` keeps the phrase `Create the open items ledger` and the exact log line above.
- Byte pins: `plugin/skills/flow/multi-spec.md` < 20,480 B (`tests/run-dir-timestamp-utc.test.js`, `tests/timing-prose-conformance.test.js`; now 18,783 B → 1,697 B headroom). `flow/SKILL.md` (43,199 B) and `review/code-mode-steps.md` (41,885 B) ≤ 51,200 B (`CEILING_BYTES`, `tests/ceremony-profile-roster.test.js`). Composed `worktree-setup` step (`_shared/worktree-setup.md` 20,555 + `build/worktree-setup.md` 22,276 = 42,831 B) ≤ 51,200 B.
- Commits: `{Verb} {what} — {detail} — refs #3036` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01W6mrrohe7J2aJrDtyaaLGo`.

## Review Focus

1. **Already-isolated session (dispatched run, multi-spec Adopted branch):** Step 1.8 creates the ledger AND Step 4.6 / multi-spec step 1 runs again — expect one file, no duplicate log line. Pinned by Task 1's Step 4.6 test asserting the idempotency clause (`If the file already exists`, verified at `ledger/SKILL.md:65`).
2. **Standalone `/claude-tweaks:build`:** must NOT start creating ledgers (Gotcha 1). Pinned by Task 1's assertion that Step 4.6 is gated on `$PIPELINE_RUN_DIR` being set.
3. **Wrap-up-only run (no worktree ever):** still gets `{run-dir}/ledger.md` (AC3.1). Pinned by Task 1's ledger-format assertions (wrap-up-only shape named in the exception).
4. **Multi-spec run:** exactly one ledger at the parent scope, not one per spec. Pinned by Task 1's `MULTISPEC_SHARED_WORKTREE` exclusion assertion and Task 2's parent-scope assertion.
5. **Run dir adopted holding a pre-#3036 `{run-dir}/ledger.md`** (Gotcha 3): keeps using it rather than splitting into two ledgers. Pinned by Task 1's ledger-format note assertion.

Behavioral claims and their mechanisms: "Create is idempotent" → `ledger/SKILL.md:65` ("If the file already exists (resuming a pipeline), read it and continue"). "Readers check `{run-dir}/ledger.md` first" → `plugin/bin/lib/wrap-up/ledger-write.js:46`, `plugin/bin/lib/wrap-up/pack.js:373`. Creation itself is prose-only (no code path writes a ledger file — `grep -rn "ledger.md" plugin/bin` shows only readers).

Sole-site grep for Step 1.8 citations (moved-prose pin check), run while authoring:
```
grep -rn -E 'Step 1\.8|step 1\.8' plugin docs tests | grep -v -i claim
→ plugin/skills/review/code-mode-steps.md:87, plugin/skills/flow/SKILL.md:130,
  tests/pr-early-run-lifecycle-step1-logging-conformance.test.js:7,66 (content pin, stays green)
```
and for the old exception condition:
```
grep -rn "carries no \`worktree\` field" plugin tests
→ _shared/ledger-format.md:15, ledger/SKILL.md:56 (both rewritten here);
  build/SKILL.md:300 + its test (Common Step 7 bookkeeping — a different, correct use; untouched)
```

---

### Task 1: Single-spec creation point and re-keyed exception

**Files:**
- Create: `tests/flow-ledger-creation-timing-conformance.test.js`
- Modify: `plugin/skills/flow/SKILL.md:130` (Step 1 item 8)
- Modify: `plugin/skills/build/worktree-setup.md:150` (insert Step 4.6 after Step 4.5)
- Modify: `plugin/skills/_shared/ledger-format.md:15` and `:21` (exception condition + stray-ledger note)
- Modify: `plugin/skills/ledger/SKILL.md:54-56` (Create callers + location rule)

**Interfaces:**
- Produces: the phrase `build/worktree-setup.md` Step 4.6 and `flow/multi-spec.md`'s "Shared worktree" step 1 as the two named post-worktree creation points — Task 2 adds the multi-spec half and cites both.

- [ ] **Step 1: Write the failing test**

Create `tests/flow-ledger-creation-timing-conformance.test.js`:

```js
'use strict';
// #3036: flow's Step 1.8 created the open-items ledger before the run's
// worktree existed, so under worktree-always a run about to get a NEW
// worktree had no writable location. Creation now happens right after the
// worktree exists; the No-worktree run exception is keyed on strategy/shape.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8').replace(/\s+/g, ' ');
const OLD_CONDITION = /A run with no worktree at all — `run-state\.json` carries no `worktree` field/;

test('AC1.1: flow Step 1.8 creates the ledger only when no new worktree is coming', () => {
  const text = read('flow/SKILL.md');
  assert.match(text, /Create the open items ledger — here only when no new worktree is coming/);
  assert.match(text, /Step 1\.3 resolved `current-branch`, or this session is already inside an isolated worktree/);
  assert.match(text, /`build\/worktree-setup\.md` Step 4\.6 \(single-spec\) or `multi-spec\.md`'s "Shared worktree" step 1 \(multi-spec\)/);
});

test('AC1.1: build/worktree-setup.md Step 4.6 creates the ledger after the worktree exists, flow-parented single-spec only', () => {
  const text = read('build/worktree-setup.md');
  assert.match(text, /4\.6\. \*\*Create the open-items ledger \(`\/flow` single-spec runs, #3036\)\*\*/);
  assert.match(text, /only when `\$PIPELINE_RUN_DIR` is already set/);
  assert.match(text, /`MULTISPEC_SHARED_WORKTREE` is not set/);
  assert.match(text, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./);
  assert.match(text, /If the file already exists/);
  assert.ok(text.indexOf('4.5. **Record the assignment**') < text.indexOf('4.6. **Create the open-items ledger'));
});

test('AC2.1: the No-worktree run exception is keyed on strategy/shape, not the momentary worktree field', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /A run that will \*\*never\*\* have a worktree/);
  assert.match(text, /Keyed on the resolved strategy or run shape, never on `run-state\.json`'s momentary lack of a `worktree` field/);
  assert.doesNotMatch(text, OLD_CONDITION);
});

test('AC3.1: a wrap-up-only run with no worktree still gets its run-dir ledger', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /a wrap-up-only invocation with no build\/test\/review step left to create one/);
  assert.match(text, /\{run-dir\}\/ledger\.md/);
});

test('Gotcha 3: an adopted run dir already holding a pre-#3036 run-dir ledger keeps using it', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /already holding a `\{run-dir\}\/ledger\.md` written under the pre-#3036 rule keeps that file as its ledger/);
});

test('ledger/SKILL.md Create names every creation site and the re-keyed location rule', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /`build\/worktree-setup\.md` Step 4\.6/);
  assert.match(text, /"Shared worktree" step 1/);
  assert.match(text, /for a run that will never have a worktree \(#3036/);
  assert.doesNotMatch(text, /when this run has no worktree \(`run-state\.json` carries no `worktree` field/);
});

test('go-red proof: the pre-#3036 exception sentence fails the AC2.1 negative assertion', () => {
  const old = 'A run with no worktree at all — `run-state.json` carries no `worktree` field, or no `run-state.json` exists yet';
  assert.throws(() => assert.doesNotMatch(old, OLD_CONDITION));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-ledger-creation-timing-conformance.test.js`
Expected: FAIL — the AC1.1, AC2.1, AC3.1, Gotcha 3 and ledger/SKILL.md tests fail (prose not yet changed); only the go-red proof passes.

- [ ] **Step 3: Edit `plugin/skills/flow/SKILL.md` Step 1 item 8**

Replace the whole line beginning `8. **Create the open items ledger** using` (line 130) with:

```markdown
8. **Create the open items ledger — here only when no new worktree is coming** (#3036): Step 1.3 resolved `current-branch`, or this session is already inside an isolated worktree (Step 1.3's "Already inside an isolated worktree session" case). Create it using `/claude-tweaks:ledger`'s create operation. The `{feature}` name matches the execution plan that build will create. This file tracks findings and operational tasks across all pipeline phases. See `/claude-tweaks:ledger` for status lifecycle and phase taxonomy. **Log the creation** (#1800) — `review/code-mode-steps.md`'s QA Ledger Check reads this line to distinguish "the ledger was created" from "creation was skipped": `AUTO {time} — flow: created open-items ledger {path}. Reversibility: n/a.` **Otherwise** (a new worktree is coming) skip creation here: under `worktree-always` a `docs/plans/` write from the main checkout is denied, and `_shared/ledger-format.md`'s No-worktree run exception is reserved for runs that never get a worktree. The ledger is created right after the worktree exists instead — `build/worktree-setup.md` Step 4.6 (single-spec) or `multi-spec.md`'s "Shared worktree" step 1 (multi-spec) — and both log the same line.
```

- [ ] **Step 4: Insert Step 4.6 in `plugin/skills/build/worktree-setup.md`**

Immediately after the line beginning `4.5. **Record the assignment**` (line 150) and before `5. All subsequent work happens in the worktree`, insert:

```markdown
4.6. **Create the open-items ledger (`/flow` single-spec runs, #3036)** — only when `$PIPELINE_RUN_DIR` is already set (a `/claude-tweaks:flow`-parented build; a standalone `/claude-tweaks:build` has no run dir yet at this step and creates no ledger here) and `MULTISPEC_SHARED_WORKTREE` is not set (a multi-spec run's one ledger is created at `flow/multi-spec.md`'s "Shared worktree" step 1). Create it with `/claude-tweaks:ledger`'s create operation — the `{feature}` name matches the execution plan this build will create — and log it exactly as `flow/SKILL.md` Step 1 item 8 does: `AUTO {time} — flow: created open-items ledger {path}. Reversibility: n/a.` This is the first point a `docs/plans/` write can land under `worktree-always` (the reason `materialize.md` writes the spec after worktree creation), and it precedes every build task. Runs on the externally-created-worktree skip path above too, like Step 4.5. When Step 1.8 already created the file (an already-isolated session), Create's "If the file already exists" rule makes this a no-op — do not log a second creation line.
```

- [ ] **Step 5: Re-key the exception in `plugin/skills/_shared/ledger-format.md`**

On line 15, replace the opening clause
`**No-worktree run exception.** A run with no worktree at all — `run-state.json` carries no `worktree` field, or no `run-state.json` exists yet — AND`
with
`**No-worktree run exception.** A run that will **never** have a worktree — a `current-branch` git strategy, or a wrap-up-only invocation with no build/test/review step left to create one — AND`
and, on the same line, immediately before `Without `worktree-always: true`, a no-worktree run can simply write`, insert:
`**Keyed on the resolved strategy or run shape, never on `run-state.json`'s momentary lack of a `worktree` field** (#3036): a `worktree`-strategy run has no `worktree` field until its worktree exists, and its ledger is created right after that (`build/worktree-setup.md` Step 4.6, or `flow/multi-spec.md`'s "Shared worktree" step 1), never through this exception. `

Then at the end of the paragraph on line 21 (after `...since there is no run-dir-scoped alternative to check.`) append:
` A run dir adopted already holding a `{run-dir}/ledger.md` written under the pre-#3036 rule keeps that file as its ledger for the rest of the run — the resolution rule above reads it consistently — rather than creating a second one; run dirs are per-run and archived at wrap-up, so no migration is needed.`

- [ ] **Step 6: Update `plugin/skills/ledger/SKILL.md` Create**

Replace line 54 with:
`Create a new ledger file. Called by `/claude-tweaks:flow` Step 1 (only when no new worktree is coming — `current-branch` strategy, or an already-isolated session), by `build/worktree-setup.md` Step 4.6 or `flow/multi-spec.md`'s "Shared worktree" step 1 (right after the run's worktree exists), or — for a run that will never have a worktree — by `wrap-up/residue-sweep.md`'s preamble on its first finding.`

Replace line 56's clause `— or, when this run has no worktree (`run-state.json` carries no `worktree` field, or no `run-state.json` exists), `{run-dir}/ledger.md`.` with
`— or, for a run that will never have a worktree (#3036 — never keyed on `run-state.json`'s momentary lack of a `worktree` field), `{run-dir}/ledger.md`.`

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/flow-ledger-creation-timing-conformance.test.js tests/pr-early-run-lifecycle-step1-logging-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS (all).

Run: `wc -c plugin/skills/flow/SKILL.md plugin/skills/build/worktree-setup.md plugin/skills/_shared/worktree-setup.md`
Expected: `flow/SKILL.md` ≤ 51,200; the two worktree-setup files sum ≤ 51,200.

- [ ] **Step 8: Commit**

```bash
git add tests/flow-ledger-creation-timing-conformance.test.js plugin/skills/flow/SKILL.md plugin/skills/build/worktree-setup.md plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md
git commit -m "Move /flow ledger creation behind the worktree — Step 4.6 creates it after worktree setup; No-worktree exception keyed on strategy — refs #3036" -m "Claude-Session: https://claude.ai/code/session_01W6mrrohe7J2aJrDtyaaLGo"
```

---

### Task 2: Multi-spec creation point and QA Ledger Check reader

**Files:**
- Test: `tests/flow-ledger-creation-timing-conformance.test.js` (append — created by Task 1)
- Modify: `plugin/skills/flow/multi-spec.md:146` (Shared worktree step 1, before `2. **Per-record builds skip creation**`)
- Modify: `plugin/skills/review/code-mode-steps.md:86-89` (QA Ledger Check, no-ledger branch)

**Interfaces:**
- Consumes: Task 1's named creation points (`build/worktree-setup.md` Step 4.6; `flow/multi-spec.md`'s "Shared worktree" step 1).

- [ ] **Step 1: Append the failing tests**

Append to `tests/flow-ledger-creation-timing-conformance.test.js`:

```js
test('AC1.1: multi-spec creates one shared ledger at Shared worktree step 1, parent scope', () => {
  const text = read('flow/multi-spec.md');
  const start = text.indexOf('### Shared worktree');
  assert.ok(start !== -1, 'Shared worktree section must exist');
  const section = text.slice(start, text.indexOf('2. **Per-record builds skip creation**', start));
  assert.match(section, /Create the open-items ledger here \(#3036\)/);
  assert.match(section, /\$MULTISPEC_PARENT_DIR/);
  assert.match(section, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./);
});

test('AC4.1: the QA Ledger Check finds the creation line on both the single-spec and multi-spec paths', () => {
  const text = read('review/code-mode-steps.md');
  const start = text.indexOf('### QA Ledger Check');
  assert.ok(start !== -1);
  const section = text.slice(start, start + 2500);
  assert.match(section, /`build\/worktree-setup\.md` Step 4\.6/);
  assert.match(section, /\$MULTISPEC_PARENT_DIR\/decisions\.md/);
  assert.doesNotMatch(section, /\(`\/flow`'s Step 1\.8 log line,/);
});

test('multi-spec.md stays under its 20,480-byte raw budget', () => {
  const bytes = fs.statSync(path.join(SKILLS, 'flow', 'multi-spec.md')).size;
  assert.ok(bytes < 20480, `multi-spec.md is ${bytes} bytes`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-ledger-creation-timing-conformance.test.js`
Expected: FAIL — the two new AC tests fail; the byte-budget test passes (append-shaped: the file already passes Task 1's tests).

- [ ] **Step 3: Edit `plugin/skills/flow/multi-spec.md`**

Insert, as the final paragraph of step 1 (directly before the line beginning `2. **Per-record builds skip creation**`, indented three spaces like step 1's other continuation lines):

```markdown
   **Create the open-items ledger here (#3036)** — right after the worktree exists (adopted or
   created), before any record's build: one ledger for the whole run, at the run-level scope
   (`$MULTISPEC_PARENT_DIR`, never a per-spec `$PIPELINE_RUN_DIR`), via `/claude-tweaks:ledger`'s
   create operation, logged to `$MULTISPEC_PARENT_DIR/decisions.md` as
   `AUTO {time} — flow: created open-items ledger {path}. Reversibility: n/a.` This is the
   multi-spec run's single creation point — `build/worktree-setup.md` Step 4.6 skips under
   `MULTISPEC_SHARED_WORKTREE=1` for that reason.
```

- [ ] **Step 4: Edit `plugin/skills/review/code-mode-steps.md` QA Ledger Check**

Replace lines 87-89:
```
  Check `decisions.md` first for a line matching `ledger` creation (`/flow`'s Step 1.8 log line,
  below) or an explicit skip; if one is present, the absence is already explained and this branch
  is a no-op. Otherwise append one line to `decisions.md`:
```
with:
```
  Check `decisions.md` first for a line matching `ledger` creation (#3036: `/flow`'s Step 1.8 or
  `build/worktree-setup.md` Step 4.6 write it there; under a multi-spec run, check
  `$MULTISPEC_PARENT_DIR/decisions.md` instead) or an explicit skip; if one is present, the absence
  is already explained and this branch is a no-op. Otherwise append one line to `decisions.md`:
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/flow-ledger-creation-timing-conformance.test.js tests/pr-early-run-lifecycle-step1-logging-conformance.test.js tests/run-dir-timestamp-utc.test.js tests/timing-prose-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add tests/flow-ledger-creation-timing-conformance.test.js plugin/skills/flow/multi-spec.md plugin/skills/review/code-mode-steps.md
git commit -m "Create the multi-spec ledger at Shared worktree step 1 — QA Ledger Check reads the new creation sites — refs #3036" -m "Claude-Session: https://claude.ai/code/session_01W6mrrohe7J2aJrDtyaaLGo"
```

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (create after worktree; Step 1.8 only for current-branch / already-isolated) | Task 1 Steps 3-4, Task 2 Step 3 |
| Deliverable 2 (exception keyed on strategy/shape) | Task 1 Steps 5-6 |
| Deliverable 3 (creation log line at new points) | Task 1 Step 4, Task 2 Step 3 |
| AC1.1 | Task 1 tests `AC1.1` ×2, Task 2 test `AC1.1` |
| AC2.1 | Task 1 test `AC2.1` |
| AC3.1 | Task 1 test `AC3.1` |
| AC4.1 | Task 2 test `AC4.1` |
| Gotcha 1 (standalone build) | Task 1 Step 4 gate + test |
| Gotcha 2 (full suite before merge) | Executed at /flow's verification + review steps |
| Gotcha 3 (stray run-dir ledger) | Task 1 Step 5 note + test |
