# Plan-review convergence after one answered round (#4958) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a record has had one answered needs-human plan-review round, plan review stops the build only for a gap that alters or loosens an Acceptance Criterion or contradicts a recorded decision, and settles every other gap itself.

**Architecture:** A controller-side routing rule in `plugin/skills/build/plan-review.md`: a new `### Converged round (#4958)` subsection between the intent-resolvable/plan-amendment subsections and `### Spec gap — needs-human`, detecting a converged round by two signals and settling non-contradicting rows through the existing intent-resolvable sequence. The reviewer's Dispatch prompt block is untouched and pinned byte-identical by a frozen fixture. `spec-template.md`'s Closed rule and `auto-mode-contract.md`'s HARD-GATE row each gain one reconciling clause.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites (`tests/helpers/read-skill`'s `readText`).

**Spec:** `.claude-tweaks/pipelines/2026-11-13T005754-spec-4958/work/4958-spec.md`

## Global Constraints

- The reviewer's Dispatch prompt fenced block in `plan-review.md` stays byte-identical to `origin/main` (AC5).
- Never edit an Acceptance Criterion's own line when settling; settled rows append under `## Plan Review Clarifications`.
- No round counter (Reading B was rejected).
- Settled-row attribution literal: `Settled by plan review after an answered round:`.
- A failed or unreadable comment read counts as not converged.
- `plugin/skills/_shared/auto-mode-contract.md` is 47,370 B against `RAIL_BYTES` 52,500 B: one short qualifier only. `plan-review.md` 22,135 B, `spec-template.md` 28,444 B — both far under the rail after this change (about +2.8 KB and +0.25 KB).
- Governing skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`): "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt"; for new prose with no pre-change bytes, "mutate the live text in memory, and match the failure to its own assertion".

## Review Focus

1. A `<!-- plan-review-question -->` comment by a `CONTRIBUTOR` (untrusted) must not converge the round — pinned by the `trusted` anchor in Task 1's signal set.
2. `gh issue view` failing (network, rate limit) must fail toward today's stop, never toward settling — pinned by the `not converged` anchor.
3. A converged-round reply whose surviving rows block a dispatched call: nothing is applied, settled rows included, so the next build reviews afresh — pinned by Task 1's `blocks` anchor.
4. A row promoted to needs-human by Reading the reply's promotion rule (an unquoted intent-resolvable row) is subject to the same convergence rule as a reviewer-marked one — pinned by the `promotion rule` anchor.
5. A first round (neither signal) must route exactly as today — pinned by Task 1's first-round sentence and the gate-sentence go-red against the frozen pre-change excerpt.

---

### Task 1: Converged-round routing in plan-review.md

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/fixtures/plan-review-dispatch-prompt-4958.txt`
- Create: `tests/plan-review-convergence-conformance.test.js`
- Modify: `plugin/skills/build/plan-review.md` (Reading the reply's "A table" bullet; Handling by class intro; new `### Converged round (#4958)` subsection before `### Spec gap — needs-human`; that subsection's first paragraph)

**Interfaces:**
- Produces: `tests/plan-review-convergence-conformance.test.js` with helpers `dispatchBlock(text)`, `subsection(text, heading)`, `norm(t)`, `problems(anchors, text)`, and constants `REVIEW`, `TEMPLATE`, `CONTRACT` (Task 2 appends tests to this file using them).

- [ ] **Step 1: Write the failing test (freeze the prompt fixture first)**

First run the existing pins once as a baseline (spec Gotcha: run all three before and after editing): `node --test tests/build-plan-review-conformance.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/plan-review-hard-gate-conformance.test.js` — expected PASS.

Before editing `plan-review.md`, write `tests/fixtures/plan-review-dispatch-prompt-4958.txt` holding the current file's Dispatch prompt block (the worktree copy equals `origin/main` here — confirm with `git diff origin/main -- plugin/skills/build/plan-review.md` printing nothing). Produce it with a scratch node script using the same slicing as `dispatchBlock` below (from the first `\n```` after `\n## Dispatch prompt` to the closing fence, exclusive) and `fs.writeFileSync`, never a shell redirect.

Create `tests/plan-review-convergence-conformance.test.js`:

```js
'use strict';
// #4958: plan review converges after one answered needs-human round. Read live —
// just-shipped prose; go-red controls mutate the live text in memory, and the
// gate sentence is checked against the frozen pre-change excerpt.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const norm = (t) => t.replace(/\s+/g, ' ');
const REVIEW = read('plugin', 'skills', 'build', 'plan-review.md');
const TEMPLATE = read('plugin', 'skills', 'specify', 'spec-template.md');
const CONTRACT = read('plugin', 'skills', '_shared', 'auto-mode-contract.md');
const FROZEN_PROMPT = fs.readFileSync(path.join(__dirname, 'fixtures', 'plan-review-dispatch-prompt-4958.txt'), 'utf8');

// dispatchBlock and subsection: copy the two helpers verbatim from
// tests/build-plan-review-conformance.test.js (same slicing).

const CONVERGED = '### Converged round (#4958)';
const NEEDS_HUMAN = '### Spec gap — needs-human';
const problems = (anchors, text) => anchors.filter((a) => !norm(text).includes(a));

const SIGNAL_ANCHORS = [
  'trusted `<!-- plan-review-question -->` comment',
  'Decided by the user at plan review:',
  'counts as **not converged**',
  'Under `work-backend: local-files` only the spec-line signal applies',
];
const RULE_ANCHORS = [
  'stays needs-human only when settling it would alter or loosen an existing Acceptance Criterion, or contradict a recorded decision',
  'a `**Decision**` paragraph in the spec, or a Closed rule',
  'one the promotion rule in Reading the reply marked',
  'never asked',
  'the reading that keeps the criterion as written',
  'blocks, nothing is applied, settled rows included',
];
const TRAIL_ANCHORS = [
  'Settled by plan review after an answered round:',
  'names the reading not taken',
  '--status AUTO',
  'settled after an answered round: {finding} — chose {reading taken}; not {reading not taken}',
  '--reversibility high',
  '### Plan review amendments (standalone build, if any)',
];
const FIRST_ROUND = '**On a first round** (neither signal), routing is unchanged: every needs-human row reaches the HARD-GATE below.';
const GATE_SENTENCE = 'In a converged round, only the rows that survive the convergence rule above reach this gate; on a first round every needs-human row does.';
const READING_QUALIFIER = 'In a converged round, only a row that survives the convergence rule reaches it (`### Converged round (#4958)` below).';

// origin/main's needs-human opening, before #4958 (frozen, not read from history).
const PRE_CHANGE_GATE = "The HARD-GATE: this plan-review needs-human spec gap is registered in `_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row — a deliberate stop before Task 1 that `auto` never silences. Every needs-human finding in the reply is handled together, as one question set.";
```

Tests (names carry the AC clause ids):

- `AC1.1: a converged round is defined by exactly the two signals, and a failed comment read is not converged` — `assert.deepStrictEqual(problems(SIGNAL_ANCHORS, subsection(REVIEW, CONVERGED)), [])`.
- `AC2.1, AC2.2: in a converged round only a criterion or recorded-decision conflict stays needs-human; the rest are settled, never asked` — `RULE_ANCHORS` over the subsection.
- `AC3.1: a settled row carries the attribution, names the reading not taken, and logs one AUTO entry (or a handoff line standalone)` — `TRAIL_ANCHORS` over the subsection.
- `AC4.1: a first round routes unchanged, and the gate and Reading the reply say only surviving rows reach it` — `FIRST_ROUND` in the subsection; `GATE_SENTENCE` in `subsection(REVIEW, NEEDS_HUMAN)`; `READING_QUALIFIER` in `norm(REVIEW)`; `assert.ok(!norm(PRE_CHANGE_GATE).includes(GATE_SENTENCE))` (go-red against the frozen excerpt).
- `AC4.1: the Converged round subsection sits after the plan-amendment subsection and before the needs-human gate` — `REVIEW.indexOf('### Undecided behaviour') < REVIEW.indexOf(CONVERGED) < REVIEW.indexOf(NEEDS_HUMAN)`, each index `!== -1`.
- `AC5.1: the reviewer Dispatch prompt block is byte-identical to origin/main` — `assert.strictEqual(dispatchBlock(REVIEW), FROZEN_PROMPT)`; plus `assert.ok(FROZEN_PROMPT.length > 1000)` so an empty fixture cannot pass.
- `AC7.1 go-red: each anchor set fails when one anchor is removed, and a one-byte prompt edit breaks AC5.1` — for every anchor in the three sets, `problems(set, doctored)` is non-empty where `doctored = subsection(...).split(anchor).join('removed')`; `assert.notStrictEqual(dispatchBlock(REVIEW).replace('spec gap', 'spec-gap'), FROZEN_PROMPT)`.
- `plan-review.md stays within the rail` — `Buffer.byteLength(REVIEW) <= RAIL_BYTES`.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node --test tests/plan-review-convergence-conformance.test.js`
Expected: FAIL — `plan-review.md lacks "### Converged round (#4958)"` (AC5.1 and the rail test pass already).

- [ ] **Step 3: Edit `plugin/skills/build/plan-review.md`**

1. Reading the reply, "A table" bullet: after the sentence ending `` `low` and `info` included.`` insert `READING_QUALIFIER` (exact text above) as the next sentence.
2. Handling by class intro: `settle the needs-human set first (last subsection)` → `settle the needs-human set first (the last two subsections)`.
3. Insert, immediately before `### Spec gap — needs-human`, this subsection (exact copy):

````markdown
### Converged round (#4958)

Before any needs-human row reaches the HARD-GATE, decide once per review whether this record is in a **converged round** — it has already had one answered needs-human round. A round is converged when either signal holds:

- **Question comment.** The record carries a trusted `<!-- plan-review-question -->` comment (`_shared/pr-run-comments.md`'s Trusted authors): a dispatched or parallel-wave round already asked, and the record was re-built. Read the comments once per review — `gh issue view {n} --json comments`, keeping comments whose body starts with that marker through the trusted-author select that section prints, or MCP `issue_read` `get_comments` when `gh` is absent. A failed or unreadable comment read counts as **not converged**: the gate fails toward today's stop, never toward silently settling.
- **Spec line.** The worktree's `work/{n}-spec.md` already carries a `Decided by the user at plan review:` clarification line: a present-human round already answered in this run.

Under `work-backend: local-files` only the spec-line signal applies: there are no comments.

**On a first round** (neither signal), routing is unchanged: every needs-human row reaches the HARD-GATE below.

**Convergence rule.** In a converged round, a needs-human row — the reviewer's, or one the promotion rule in Reading the reply marked — stays needs-human only when settling it would alter or loosen an existing Acceptance Criterion, or contradict a recorded decision. A recorded decision is a `Decided by the user at plan review:` line, a `**Decision**` paragraph in the spec, or a Closed rule (`specify/spec-template.md`'s State-Classification Deliverables). Every other needs-human row is settled by plan review, never asked:

1. Pick the reading closer to the spec's stated intent. When the row came from a criterion change, that is the reading that keeps the criterion as written.
2. Apply it through the intent-resolvable sequence above, sharing its one commit, record comment and re-audit with every other amendment from this reply. Its clarification line quotes the row's Finding in place of an Evidence sentence, is attributed `Settled by plan review after an answered round:`, and names the reading not taken.
3. Log one `AUTO` entry per settled row, so the Review Console lists it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO \
     --section "/build" --step "Common Step 1.6 (plan review)" \
     --text "settled after an answered round: {finding} — chose {reading taken}; not {reading not taken}" --reversibility high
   ```

   A standalone `/build` with no run dir lists each settled row in the handoff's `### Plan review amendments (standalone build, if any)` section instead.

Rows that survive the rule go to the HARD-GATE below as one question set. When a dispatched call or parallel-wave member then blocks, nothing is applied, settled rows included: the next build reviews the answered record afresh.
````

   Check the last sentence against `RULE_ANCHORS`' `blocks, nothing is applied, settled rows included` (the anchor matches after `norm`).
4. `### Spec gap — needs-human`, first paragraph: between `` that `auto` never silences.`` and `Every needs-human finding in the reply is handled together` insert `GATE_SENTENCE` (exact text above).

- [ ] **Step 4: Run the new suite and every suite pinning plan-review.md**

Run: `node --test tests/plan-review-convergence-conformance.test.js tests/build-plan-review-conformance.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/plan-review-hard-gate-conformance.test.js tests/build-resume-common-steps.test.js`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/plan-review-dispatch-prompt-4958.txt tests/plan-review-convergence-conformance.test.js plugin/skills/build/plan-review.md
git commit -m "Converge plan review after one answered round — settle non-contradicting needs-human gaps (#4958)"
```

### Task 2: Reconcile the Closed rule and the HARD-GATE row

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/spec-template.md` (`## State-Classification Deliverables`, after the paragraph ending `the build proceeded.`)
- Modify: `plugin/skills/_shared/auto-mode-contract.md` (the `| HARD-GATE / BLOCKED / STOP conditions` row)
- Test: `tests/plan-review-convergence-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `REVIEW`, `TEMPLATE`, `CONTRACT`, `norm`, and the convergence subsection's heading `### Converged round (#4958)`.

- [ ] **Step 1: Append the failing tests**

```js
const CLOSED_RULE_SENTENCE = "The rule still matters on a record's first plan-review round; after one answered round, later rounds converge under `build/plan-review.md`'s convergence rule anyway, which treats a Closed rule as a recorded decision.";
const CONTRACT_QUALIFIER = 'plan-review needs-human spec gap (`build/plan-review.md`, #3377; after one answered round, only a gap contradicting a criterion or recorded decision, #4958)';

function closedRuleSection(text) {
  const start = text.indexOf('## State-Classification Deliverables\n');
  assert.notStrictEqual(start, -1);
  return text.slice(start, text.indexOf('\n## ', start));
}
const contractRow = () => CONTRACT.split('\n').find((l) => l.startsWith('| HARD-GATE / BLOCKED / STOP conditions'));
```

- `AC6.1: the Closed rule section names the convergence rule` — `norm(closedRuleSection(TEMPLATE)).includes(CLOSED_RULE_SENTENCE)`; go-red: the same check on the section with the sentence removed is false.
- `the HARD-GATE row limits the plan-review gate to first rounds and converged-round contradictions` — `contractRow().includes(CONTRACT_QUALIFIER)`; go-red: `contractRow().replace('#4958', '')` does not include it.
- `auto-mode-contract.md stays within the rail` — `Buffer.byteLength(CONTRACT) <= RAIL_BYTES`.
- AC6.2: `tests/specify-closed-rule.test.js` still passes — no new test; Step 4 runs that suite unchanged.

- [ ] **Step 2: Run the suite to verify the new tests fail**

Run: `node --test tests/plan-review-convergence-conformance.test.js`
Expected: FAIL — the AC6.1 and HARD-GATE-row tests.

- [ ] **Step 3: Edit both files**

1. `spec-template.md`: append `CLOSED_RULE_SENTENCE` (exact text) as a new final sentence of the paragraph ending `the next pass applied it to a newly found state and the build proceeded.`
2. `auto-mode-contract.md`: in the HARD-GATE row, replace `plan-review needs-human spec gap (`build/plan-review.md`, #3377)` with `CONTRACT_QUALIFIER`. Decision on the spec's conditional Deliverable ("only if it overstates"): the row as written calls every plan-review needs-human spec gap "a real stop before Task 1 in every mode", which overstates once converged rounds settle most gaps, so the qualifier is added. Measure `wc -c` after: must stay ≤ 52,500 (expected ≈ 47,450).

- [ ] **Step 4: Run the new suite, the Closed-rule suite and the HARD-GATE suite**

Run: `node --test tests/plan-review-convergence-conformance.test.js tests/specify-closed-rule.test.js tests/plan-review-hard-gate-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/spec-template.md plugin/skills/_shared/auto-mode-contract.md tests/plan-review-convergence-conformance.test.js
git commit -m "Reconcile the Closed rule and the HARD-GATE row with plan-review convergence (#4958)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Prior-round detection (both signals, failed read, local-files) — AC1 | Task 1 |
| Convergence rule, recorded-decision definition — AC2 | Task 1 |
| Review Console trail / standalone handoff — AC3 | Task 1 |
| First round unchanged — AC4 | Task 1 |
| Reviewer brief byte-identical — AC5 | Task 1 (frozen fixture) |
| Closed rule reconciled, `specify-closed-rule` still passes — AC6 | Task 2 |
| HARD-GATE row (conditional; decided: qualifier added) | Task 2 |
| Tests fail when the convergence paragraph is reverted — AC7 | Tasks 1-2 go-red tests |
| `npm test` passes — AC8 | Common Step 5 (`bin/verify.js`) |

Behavior-change prose sweep (run before Task 1): `git grep -n -i -E "(every|any|each) (needs-human|\`needs-human\`)" -- plugin docs CLAUDE.md` returns only `plugin/skills/build/plan-review.md` lines 80, 114 and 120 — the three sentences Task 1 qualifies or leaves correct (line 120 is inside the gate, after convergence has filtered the set).
