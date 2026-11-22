# Plan at Specify — Shaping Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a new policy value `plan-at-specify: on`, `/claude-tweaks:specify`'s shaping mode writes, audits, reviews and stores a plan for each record it stamps `ready`, settles detail questions itself, asks only the asked classes, and holds a record with `needs:decision` when no human can answer.

**Architecture:** A new policy key resolves `off` unless `planning-decisions` is `asked-classes` (the resolver refuses the combination with a warn-tier stderr line). The whole procedure lives in one new lazily read file, `plugin/skills/specify/planning.md`; the three shaping-mode files gain one marker-delimited pointer block each, read only when the key resolves `on`. Planner and reviewer are dispatched subagents that return paths and tables only; the plan is stored with `bin/plan-store.js` and its `Plan:` line rides the record's one write.

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS (`plugin/bin/lib/policy-schema.js`, `plugin/bin/resolve-policy.js`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T171229-spec-6056/work/6056-spec.md`

Scope keywords: plan-at-specify, Held-by: specify-planning, held-questions:start, planningDecisionsFrom, specify-plan-checkout

Waived plugin/bin/lib/driver/plan-lane.js: read only — Task 4's `planning.md` reaches `needsNoPlan` through `bin/express-lane.js plan-lane --record-json`, verified at plan time; no change.
Waived plugin/bin/plan-store.js: read only — Task 4's `planning.md` calls its `write` and `check` verbs as shipped by #6052; no change.

Check B no-change classification (sweep hits on `plan-at-specify` outside the task list): `docs/journeys/store-a-reviewed-plan-beside-its-record-6052.md` (persona line names the feature as future work, still accurate), `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md` (the design doc this record decomposes from), `docs/plans/2026-11-22-plan-at-specify-shaping-ledger.md` (this run's ledger).

## Global Constraints

- Under `plan-at-specify: off` (the default) shaping mode behaves exactly as today: every new shaping-mode sentence sits inside a `<!-- plan-at-specify:start -->` … `<!-- plan-at-specify:end -->` block whose first instruction is the gate (spec AC1).
- Read-limit rail: `RAIL_BYTES` = 52,500 B per `plugin/skills/**/*.md` file (`plugin/bin/lib/skill-audit/budgets.js`). Measured at base `de6f773c60` and the expected result after this plan:
  - `plugin/skills/specify/shaping-mode.md`: 23,990 B → ~24,900 B
  - `plugin/skills/specify/shaping-mode-stamping.md`: 35,528 B → ~36,050 B
  - `plugin/skills/specify/shaping-mode-readback.md`: 11,278 B → ~11,850 B
  - `plugin/skills/_shared/policy-schema.md`: 49,606 B → ~50,150 B (already past the 47,250 B 90% flag; ~2,350 B headroom left, so no section move is needed for one row)
  - `plugin/skills/_shared/policy-schema-coverage.md`: 44,584 B → ~44,620 B
  - `plugin/skills/_shared/planning-decisions.md`: 6,464 B → ~6,580 B
  - `plugin/skills/help/context-flow.md`: 20,089 B → ~20,280 B
  - `plugin/skills/specify/planning.md` (new): ~21,000 B
- Plan text never enters specify's main session: planners and reviewers return paths and tables only (spec AC6).
- `_shared/planning-decisions.md` stays the only file stating the three asked classes: `planning.md` cites its sections by name and never contains a clause from `tests/helpers/planning-decisions-clauses.js`'s `CLASS_CLAUSES` (pinned by `tests/planning-decisions-conformance.test.js`'s "no other file under plugin/ states the three classes").
- A skill reference inside actionable instruction text uses the fully-qualified `/claude-tweaks:{skill}` form (CLAUDE.md, Cross-references).
- Never write the literal placeholder tokens `TBD`, `TODO` or `<!-- ambiguity:` in prose.
- Commits: `{Verb} {what} — {detail}` subject, a `Refs #6056` body line, and the harness's own attribution trailer. Never commit the plan or spec files.
- Targeted test runs use `node --test <file>`; only Task 9 runs the whole suite.
- Every `bin/plan-store.js` exit-3 (no ref) path keeps the planning decisions and writes no `Plan:` line (spec Deliverable 5).

Governing project skills, quoted verbatim:

- `.claude/skills/policy-key-addition/SKILL.md` (applies to `plugin/bin/lib/policy-schema.js`, `plugin/skills/_shared/policy-schema.md`, `plugin/skills/_shared/policy-schema-coverage.md`, `docs/journeys/resolve-a-policy-key.md`, `tests/policy-schema.test.js`):
  - "**The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin."
  - "State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "Key such a guard on `invalid`, and build its test fixture from a real `resolvePolicyKeys` reply rather than a hand-written one"
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s \"Canonical read path carve-outs\", which lists every key carrying the flag"
  - "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record."
  - "Every new key gets this decision, even when the answer is neither flag. A key whose every consumer reads `policy.yml` directly, never through `resolve-policy.js --run`, is `policyOnly` … Say the decision in the comment above the row, as both of those do."
  - "**A Manifesto-visible lever** also walks `_shared/auto-mode-contract.md`'s \"Adding a new policy lever\" checklist." — not applicable: `/claude-tweaks:specify` has no Manifesto, so `plan-at-specify` is not a lever; the row comment says so.
  - "\"Lands\" means merges: a key whose first consumer arrives in a later task of the same PR merges together with it, so it takes no marker" — so no `Not yet used.` marker.
- `.claude/skills/superpowers-step-override/SKILL.md` (applies to the planner prompt in `planning.md` and `tools/upstream-drift/manifest.yml`):
  - "Put the override in the sentence that invokes the skill, as a directive addressed to it, and name the upstream step or line in its own words so the skill can find what it is told to change."
  - "Add an assertion to the `superpowers` entry of `tools/upstream-drift/manifest.yml`"
  - "Add the override's edge to `docs/skill-graph.md`"
- `.claude/skills/skill-prose-conformance-tests/SKILL.md` (applies to every new test that reads `plugin/skills/**/*.md`):
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message**"
  - From its `mirrored-and-dispatched-prose-pins.md`: "Slice the same structurally-bounded region out of each file, rewrite only the enumerated tokens that legitimately differ, and `assert.strictEqual` the results." and the dispatched-body checks "a sweep for references the agent cannot resolve, and fence balance".
- `.claude/skills/record-body-line-addition/SKILL.md` names `plugin/bin/lib/issues/plan-line.js`; this plan adds no body line and does not modify that module, so none of its rules apply.

## Review Focus

1. **Every shaped body lacks `## Overview`, and `specHash` throws `SPEC_NO_OVERVIEW` without it** — so `plan-store.js write` would exit 1 on every shaped record. `planning.md` step 1 inserts an Overview; Task 3 pins the throw and the success with an Overview.
2. **The plan-lane predicate reading the live record's labels** — the stamps this pass adds (`ceremony:*`, `size:*`, `risk:*`) are not on the record yet. `planning.md` passes the post-write label set through `--record-json`; Task 4 pins "fetched labels plus this pass's stamps".
3. **`plan-at-specify: on` with `planning-decisions` unset or malformed** — both resolve `ask-all`, so the key must resolve `off` with the conflict field. Task 1 pins unset, malformed and factory-sourced readings.
4. **A held record's write both adding and removing `needs:decision`** (the stamping file's `needs:*` bullet removes it). `planning.md`'s Hold omits `--remove-label "needs:decision"`; Task 6 pins it.
5. **Reviewer text with newlines breaking the one-line held-questions schema** that #6059 parses. Task 6 pins the one-line rule and round-trips a filled template through the test's reader.

---

### Task 1: `plan-at-specify` policy key with the `ask-all` refusal

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new `POLICY_KEYS` row after the `planning-decisions` row at line 335; new helper beside `deriveExpressDriverMaxLines` near line 673; one guard in `resolvePolicyKeys` after the `policySourceExcluded` block near line 891)
- Modify: `plugin/bin/resolve-policy.js` (`warningLines`, lines 216-251, and the header comment)
- Modify: `plugin/skills/_shared/policy-schema.md` (new row directly below the `planning-decisions` row, line 254)
- Test: `tests/policy.test.js` (append after line 354)
- Test: `tests/policy-schema.test.js` (lines 46-47)

**Interfaces:**
- Produces: policy key `plan-at-specify` (`enum`, values `['off', 'on']`, default `'off'`, `policyOnly: true`). `resolvePolicyKeys(['plan-at-specify'], …)` returns `{ value: 'off', source: <source of the 'on' value>, conflict: 'planning-decisions' }` when the key is set `on` and `planning-decisions` resolves `ask-all`; otherwise the ordinary entry with no `conflict` field.
- Produces: `warningLines` emits, in every output mode, exactly `resolve-policy: warning: plan-at-specify is on but planning-decisions is ask-all — using "off"; set planning-decisions: asked-classes to plan at /claude-tweaks:specify\n` for a requested `plan-at-specify` whose entry carries `conflict: 'planning-decisions'`. Task 4's `planning.md` and Task 7's `shaping-mode.md` block cite this behaviour.

- [ ] **Step 1: Write the failing tests** — append to `tests/policy.test.js`:

```js
// #6056: plan-at-specify — shaping-time planning, refused while planning-decisions is ask-all.
const PLAN_AT_SPECIFY_CONFLICT_LINE = 'resolve-policy: warning: plan-at-specify is on but planning-decisions is ask-all — using "off"; set planning-decisions: asked-classes to plan at /claude-tweaks:specify\n';
const resolvePlanAtSpecify = (opts) => require('../plugin/bin/lib/policy-schema').resolvePolicyKeys(['plan-at-specify'], opts)['plan-at-specify'];

test('plan-at-specify is policyOnly, defaults to off, offers exactly off and on, and is factory-settable (#6056)', () => {
  const row = require('../plugin/bin/lib/policy-schema').POLICY_KEYS.find((k) => k.key === 'plan-at-specify');
  const { FACTORY_REFUSED_KEYS } = require('../plugin/bin/lib/policy-factory');
  assert.ok(row, 'plan-at-specify row exists');
  assert.strictEqual(row.policyOnly, true);
  assert.strictEqual(row.default, 'off');
  assert.deepStrictEqual(row.values, ['off', 'on']);
  assert.strictEqual(row.category, 'pipeline-behavior');
  assert.strictEqual(row.tier, 'advanced');
  assert.ok(!row.summary.startsWith('Not yet used'));
  assert.ok(!row.policySourceExcluded);
  assert.ok(!FACTORY_REFUSED_KEYS.includes('plan-at-specify'));
});

test('AC1.1: plan-at-specify resolves off when unset, when off, and when malformed, with no conflict field (#6056)', () => {
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: '' }), { value: 'off', source: 'default' });
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: off\n' }), { value: 'off', source: 'policy' });
  const bad = resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: yes\n' });
  assert.strictEqual(bad.value, 'off');
  assert.strictEqual(bad.invalid, true);
  assert.ok(!('conflict' in bad));
});

test('Deliverable 9: on with planning-decisions ask-all (unset, explicit or malformed) resolves off with the conflict, source kept (#6056)', () => {
  const refused = { value: 'off', source: 'policy', conflict: 'planning-decisions' };
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\n' }), refused);
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: ask-all\n' }), refused);
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: ask-some\n' }), refused);
});

test('Deliverable 9: on with asked-classes resolves on, from the policy or the factory layer (#6056)', () => {
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }), { value: 'on', source: 'policy' });
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\n', factoryRaw: 'planning-decisions: asked-classes\n' }), { value: 'on', source: 'policy' });
  assert.deepStrictEqual(resolvePlanAtSpecify({ factoryRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }), { value: 'on', source: 'factory' });
});

test('a run config sets neither plan-at-specify nor the planning-decisions it is checked against (#6056)', () => {
  assert.deepStrictEqual(
    resolvePlanAtSpecify({ policyRaw: 'plan-at-specify: on\n', runConfigRaw: 'planning-decisions: asked-classes\n' }),
    { value: 'off', source: 'policy', conflict: 'planning-decisions' },
  );
  assert.deepStrictEqual(resolvePlanAtSpecify({ policyRaw: '', runConfigRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }), { value: 'off', source: 'default' });
});

test('Deliverable 9: warningLines names the conflict in every mode, from a real resolvePolicyKeys reply (#6056)', () => {
  const { resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');
  const { warningLines } = require('../plugin/bin/resolve-policy');
  const keys = ['plan-at-specify'];
  const conflicted = { keys, result: resolvePolicyKeys(keys, { policyRaw: 'plan-at-specify: on\n' }), invalidRaw: new Map(), degrades: new Map() };
  for (const values of [true, false]) assert.deepStrictEqual(warningLines(conflicted, { values }), [PLAN_AT_SPECIFY_CONFLICT_LINE]);
  const clean = { ...conflicted, result: resolvePolicyKeys(keys, { policyRaw: 'plan-at-specify: on\nplanning-decisions: asked-classes\n' }) };
  for (const values of [true, false]) assert.deepStrictEqual(warningLines(clean, { values }), []);
});
```

In `tests/policy-schema.test.js`, change lines 46-47 to:

```js
  // Last bump: 120 -> 121, #6056
  assert.strictEqual(POLICY_KEYS.length, 121);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/policy.test.js`
Expected: FAIL — `plan-at-specify row exists` is not ok and the resolver returns `{ error: 'unknown-key' }`.

- [ ] **Step 3: Implement the row, the refusal and the warning**

In `plugin/bin/lib/policy-schema.js`, directly after the `planning-decisions` row, add the comment and row:

```js
  // #6056: read only by specify/shaping-mode.md's Planning at specify paragraph, through resolve-policy.js --values with no --run, so policyOnly (no per-run route). /claude-tweaks:specify has no Manifesto, so it is not a Manifesto lever and auto-mode-contract.md's new-lever checklist does not apply. Not policySourceExcluded: a standing opt-in is the point. Factory-settable: a user-wide opt-in only moves planning to shaping time, and an older build ignores an unknown key. resolvePolicyKeys refuses `on` while planning-decisions resolves ask-all (planningDecisionsFrom): the entry resolves `off`, keeps its source and gains conflict: 'planning-decisions'; resolve-policy.js warns on stderr. Its first consumer lands in this same PR, so no "Not yet used." marker.
  { key: 'plan-at-specify', type: 'enum', values: ['off', 'on'], default: 'off', policyOnly: true, summary: "Writes, reviews and stores a record's plan while specify shapes it; needs planning-decisions set to asked-classes.", category: 'pipeline-behavior', tier: 'advanced' },
```

Add `function planningDecisionsFrom(sources)` after `deriveExpressDriverMaxLines`, returning `'ask-all' | 'asked-classes'`: walk `sources` in order, skip `run-config` (the key is `policyOnly`), take the first source holding `planning-decisions`; a valid raw value resolves through `resolveValue`, an invalid one resolves the schema default (never the next source's value, the main loop's rule); no source holding it resolves the schema default. Comment it as the read the `plan-at-specify` refusal makes, mirroring the two derive helpers' comments.

In `resolvePolicyKeys`, after the `policySourceExcluded` block and before `result[requested] = resolved;`:

```js
    // #6056: plan-at-specify needs planning-decisions: asked-classes. `on` beside ask-all resolves
    // `off`, keeps its source, and carries the conflict for resolve-policy.js's warning.
    if (canonical === 'plan-at-specify' && resolved.value === 'on' && planningDecisionsFrom(sources) === 'ask-all') {
      resolved = { ...resolved, value: 'off', conflict: 'planning-decisions' };
    }
```

In `plugin/bin/resolve-policy.js`'s `warningLines`, after the degraded-key loop and before `if (values)`, push `PLAN_AT_SPECIFY_CONFLICT_LINE`'s exact text once when `new Set(keys)` holds `plan-at-specify` and `result['plan-at-specify']` carries `conflict === 'planning-decisions'`. Extend the file's header comment with one sentence: a requested `plan-at-specify` refused for `planning-decisions: ask-all` writes that warning in every output mode, stdout and exit code unchanged, and its JSON entry carries the additive `conflict` field.

In `plugin/skills/_shared/policy-schema.md`, add this row directly below the `planning-decisions` row:

```markdown
| `plan-at-specify` | `policy.yml` only (`policyOnly`: the `--run` overlay never applies; not a Manifesto lever) | `specify/shaping-mode.md`, `specify/planning.md` | `off` | `on` has `/claude-tweaks:specify`'s shaping mode write, review and store a record's plan (`refs/claude-tweaks/plans/{n}`) before its one write. Unset or invalid (`invalid: true`) resolves `off`. `on` while `planning-decisions` resolves `ask-all` (unset and malformed included) resolves `off`, keeps its source and adds `conflict: "planning-decisions"`; `resolve-policy.js` then writes one stderr warning naming the conflict in every output mode (#6056) |
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/policy.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-entry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/resolve-policy.js plugin/skills/_shared/policy-schema.md tests/policy.test.js tests/policy-schema.test.js
git commit -m "Add plan-at-specify policy key — refused to off while planning-decisions is ask-all" -m "Refs #6056"
```

---

### Task 2: Name `plan-at-specify` in the `policyOnly` lists

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:102`
- Modify: `docs/journeys/resolve-a-policy-key.md:48` and its `## Origin` list (line 97)
- Test: `tests/policy-schema.test.js` (append after the `AC11.4 (#5917)` test, line ~1160)

**Interfaces:**
- Consumes: Task 1's `plan-at-specify` row.

- [ ] **Step 1: Write the failing test** — append to `tests/policy-schema.test.js`:

```js
test('#6056: the policyOnly bullet names plan-at-specify', () => {
  const line = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema-coverage.md')).split('\n').find((l) => l.includes('are `policyOnly`'));
  assert.ok(line, 'the policyOnly bullet is missing');
  assert.ok(line.includes('`plan-at-specify` (#6056)'), 'the policyOnly bullet does not name plan-at-specify');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/policy-schema.test.js`
Expected: FAIL with "the policyOnly bullet does not name plan-at-specify"

- [ ] **Step 3: Edit the two lists**

`plugin/skills/_shared/policy-schema-coverage.md` line 102: replace `` `model-effort` (#5941) and `planning-decisions` (#6051) are `policyOnly` `` with `` `model-effort` (#5941), `planning-decisions` (#6051) and `plan-at-specify` (#6056) are `policyOnly` ``.

`docs/journeys/resolve-a-policy-key.md` line 48: replace `` `planning-decisions`, #6051) `` with `` `planning-decisions`, #6051; `plan-at-specify`, #6056) ``. Add as the first bullet under `## Origin`:

```markdown
- Step 3 updated during build of #6056 (`plan-at-specify`) — the key is `policyOnly`, so step 3's red flag lists it; set `on` beside a `planning-decisions` that resolves `ask-all`, it resolves `off` with an additive `conflict` field and one stderr warning
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/policy-schema.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/policy-schema-coverage.md docs/journeys/resolve-a-policy-key.md tests/policy-schema.test.js
git commit -m "Name plan-at-specify in the policyOnly lists — coverage bullet and journey red flag" -m "Refs #6056"
```

---

### Task 3: Pin that no body parser rejects a `Plan:` line (AC8)

**Role:** integration

**Files:**
- Create: `tests/bin-lib/issues/plan-line-body-parsers.test.js`

**Interfaces:**
- Consumes: `composePlanLine`, `parsePlanLine`, `specHash`, `parseRiskFlags`, `parseAcceptanceTarget`, `parseDependencies`, `extractFingerprint` (`plugin/bin/lib/issues/record.js`); `extractKeyFileEntries`, `extractKeyFilesSection` (`plugin/bin/lib/issues/grouping.js`); `liftMetadata` (`plugin/bin/lib/issues/materialize-format.js`); `validateShaped` (`plugin/bin/lib/compose-record/compose.js`); `extractAcceptanceClauses`, `extractSpecPaths` (`plugin/bin/lib/plan-audit/parser.js`).

A real-input probe of exactly these parsers on the fixture below was run at plan time (scratch script, not committed): every parser returned the same value with and without the line, `validateShaped(withLine).ok` was `true`, and `specHash` on the body with `## Overview` removed threw `code: 'SPEC_NO_OVERVIEW'`.

- [ ] **Step 1: Write the test file** — `tests/bin-lib/issues/plan-line-body-parsers.test.js`:

```js
'use strict';
// #6056 AC8: a record body carrying a `Plan:` line (written by plan-store.js through
// composePlanLine) gets the same verdict from every existing body parser as the same body without
// it, so a build of such a record still plans as today until #6060 lands. Also pins why
// specify/planning.md inserts `## Overview`: specHash refuses a body without one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
```

Requires as listed in Interfaces. Build `LINE = composePlanLine({ record: 6056, commit: 'a'.repeat(40), specHash: 'b'.repeat(64) })` (the real writer, never a hand-typed line) and `BODY`, a shaping-mode body with: metadata lines `Surface: infra`, `Risk-flags: none`, `Acceptance-target: local`; then `## Overview` (one line), `## Current State` (one bullet naming `` `plugin/bin/plan-store.js` ``), `## Deliverables` (`1. A step.`), `## Acceptance Criteria` (`1. The step runs; the line is written.`), `## Release Note`, `## Technical Approach` with `### Key Files` holding `` - `plugin/skills/specify/planning.md` — new ``, `## Gotchas`, `## Planning Decisions` (`No planning questions arose.`), `## Original request` ending with `Blocked by #6052`. `WITH_LINE = BODY` with `${LINE}\n` inserted after `Acceptance-target: local\n`. `PARSERS` maps the eleven names above to their functions.

Tests:
- `AC8.1: every existing body parser gives the same verdict with and without a Plan: line` — for each `[name, fn]`, `assert.deepEqual(fn(WITH_LINE), fn(BODY), name)`; first assert `WITH_LINE !== BODY` and `parsePlanLine(LINE).ok === true`.
- `AC8.1: the shape gate accepts a body carrying a Plan: line` — `validateShaped(WITH_LINE)` deep-equals `{ ok: true, gaps: [] }`.
- `control: the comparison sees a metadata change a parser reads` — a body with `Risk-flags: none` replaced by `Risk-flags: auth` gives a different `parseRiskFlags` result than `BODY`, so the per-parser equality can go red.
- `planning inserts ## Overview because specHash refuses a body without one` — `assert.throws(() => specHash(BODY.replace(/## Overview\n\n[^\n]*\n\n/, '')), { code: 'SPEC_NO_OVERVIEW' })` after asserting the replace changed the text, and `specHash(BODY)` matches `/^[0-9a-f]{64}$/`.

- [ ] **Step 2: Run the test**

Run: `node --test tests/bin-lib/issues/plan-line-body-parsers.test.js`
Expected: PASS — AC8 is a no-regression criterion over code that already accepts the line; the discrimination proof is the in-file `control:` test. Before Step 1 the file does not exist and the command fails.

- [ ] **Step 3: Prove the control discriminates**

In a scratch copy (never the shared tree), change the `control:` test's `Risk-flags: auth` replacement to a no-op string and confirm that test goes red; restore. Report the mutant in the task's status line.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/issues/plan-line-body-parsers.test.js
git commit -m "Pin that a Plan: line changes no body parser's verdict — AC8 of the specify planning step" -m "Refs #6056"
```

---

### Task 4: `planning.md` — gate, predicate, per-record step, planner prompt and its upstream pin

**Role:** integration

**Files:**
- Create: `plugin/skills/specify/planning.md`
- Create: `tests/specify-planning-conformance.test.js`
- Modify: `tools/upstream-drift/manifest.yml` (the `superpowers` entry's `assertions`, after the `plugin/skills/build/dispatch.md` / `make it pass, then run the whole suite.` assertion, line ~338)

**Interfaces:**
- Consumes: Task 1's resolver behaviour (refusal + warning). `bin/express-lane.js plan-lane --record-json <file>` prints `{"number","lane","reason"}` (`plugin/bin/lib/express/cli.js`'s `runPlanLane`, verified at plan time: a probe record built from this spec printed `{"number":6056,"lane":null,"reason":"outside-every-lane"}`). `bin/plan-store.js write|check` (exit 0/1/2/3, stdout JSON).
- Produces: `planning.md` headings, in order: `# Specify — Planning at Shaping Time (#6056)`, `## Which records are planned`, `## Per-record step`, `## Planner prompt`. Tasks 5 and 6 append `## Reviewer dispatch`, `## Routing`, `## Hold` (with `### Held-questions schema`), `## Batches`, `## Read-back and outcome`, in that order. Task 7's pointer blocks cite `## Per-record step` and `## Read-back and outcome` by name.
- Produces: `tests/specify-planning-conformance.test.js` helpers reused by Tasks 5-7: `planning()` (live text via `readText`), `lit(s)` (wrap-tolerant literal regex, as in `tests/planning-decisions-conformance.test.js` line 21), `pinned(region, patterns, label)` (asserts `missingFactsOf(patterns)(region)` is `[]`, then `assertEachPatternGoesRed`), `fenceAfter(text, heading)` (body of the first fenced block after the heading line).

- [ ] **Step 1: Write the failing tests** — `tests/specify-planning-conformance.test.js`, header comment naming #6056 and the file's purpose (pins `plugin/skills/specify/planning.md`, the shaping-mode pointer blocks and the brief shared with `build/plan-review.md`; read live because these files are the declared contract). Requires `readText`, `missingFactsOf`, `assertEachPatternGoesRed`, `sectionOf` (`./helpers/conformance-asserts`), `classStatementSites` (`./helpers/planning-decisions-clauses`). Tests (each fact list goes through `pinned`):

- `AC1.1: planning.md opens with the gate and the ask-all refusal` over the text before `## Which records are planned`:
  - `lit('under `off`, the default, nothing in this file runs and shaping is exactly as written')`
  - `lit('Resolution refuses `on` while `planning-decisions` resolves `ask-all`')`
  - `lit('prints `off` and one stderr warning naming the conflict, never an error')`
- `AC6.1: plan text never enters this session` over the same region: `lit('**Plan text never enters this session.**')`, `lit('Planners and the reviewer return paths and tables only')`, `lit('never Read the plan file')`.
- `Deliverable 7: the predicate calls needsNoPlan through express-lane.js plan-lane on the post-write labels` over `## Which records are planned`: `lit('express-lane.js" plan-lane --record-json')`, `lit('`needsNoPlan` (`bin/lib/driver/plan-lane.js`)')`, `lit('the fetched labels plus this pass\'s stamps')`, `lit('A non-zero exit, no JSON line, or `lane: null` plans the record.')`.
- `AC5.1: a record a plan-less lane takes gets no plan and no Plan: line, logged` over the same section: `lit('A non-null `lane` means the record is not planned: no plan, no `Plan:` line')`, `lit('`not planned: {lane} lane ({reason})`')`.
- `Deliverable 8: a stored plan is reused only when plan-store.js check says valid` over the same section: `lit('plan-store.js" check --line')`, `lit('`{"valid": true}` (exit 0) keeps that line')`, `lit('Any other verdict or exit re-plans')`.
- `Deliverable 2: the per-record step runs compose, planner, audit, reviewer, route, amend, store, write in order` — `const ORDER = ['1. **Body.**', '2. **Base and checkout.**', '3. **Planner.**', '4. **Audit.**', '5. **Reviewer.**', '6. **Route.**', '7. **Amend.**', '8. **Store.**', '9. **Write.**', 'git fetch origin {integration-branch}', 'git worktree add --detach', 'plan-audit.js" "{plan}" --spec "{body}"', 'plan-store.js" write --record {n}']`; `orderProblems(section)` returns `['missing: …']` per absent anchor and `['order']` when the step labels (first nine) or the four commands are not each in ascending index; assert `[]` on `sectionOf(planning(), '## Per-record step')`. Control: swap `3. **Planner.**` and `5. **Reviewer.**` labels in a copy → `['order']`.
- `Deliverable 2: the base is fetched first, the checkout is read-only, open Prerequisites do not skip planning` over `## Per-record step`: `lit('whose sha is `{base}`, the plan\'s base')`, `lit('The checkout\'s tracked files are read-only: the plan is the one file written there.')`, `lit('Open Prerequisites do not skip planning.')`, `lit('git worktree remove --force "{checkout}"')`.
- `Review Focus 1: a body with no ## Overview gets one, because the spec hash refuses it` over `## Per-record step`: `lit('insert one directly above `## Current State`')`, `lit('refuses a spec with no Overview')`.
- `Deliverable 5: the no-ref outcome keeps the decisions and writes no Plan: line` over `## Per-record step`: `lit('Exit 3 is the no-ref outcome: keep every decision line, write no `Plan:` line, and record why')`, `lit('`bin/plan-store.js` is the line\'s one writer, so never type or edit it')`.
- `the planner is a Standard, clean-room dispatch that stops writing-plans before its Execution Handoff` over `fenceAfter(planning(), '## Planner prompt')`: `lit('[Use: Standard]')`, `lit('Invoke the Skill tool with skill `superpowers:writing-plans`')`, `lit('skip its Execution Handoff step entirely')`, `lit('ASSUMPTION — verify at build:')`, `lit('{plugin-root}/skills/build/plan-authoring-checks.md')`, `lit('PLAN: {absolute path to the saved plan file}')`, `lit('Never quote the plan\'s text.')`, `lit('STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}')`. Plus `lit('resolve-profile.js" standard')` and `lit('never `fork`')` over `sectionOf(planning(), '## Planner prompt')`.
- `the planner prompt is self-contained and every fence in planning.md is balanced` — the planner fence contains none of `'_shared/'`, `'SKILL.md'`, `' above'`, `' below'`; `planning().split('\n').filter((l) => /^\s*```/.test(l)).length` is even. Control: appending `' see _shared/x.md'` to the fence body is reported.
- `the Execution Handoff override is pinned in the upstream-drift manifest` — read `tools/upstream-drift/manifest.yml` as text; find the line `      - file: "plugin/skills/specify/planning.md"`; the next three lines include `will rely on (record #6056)`, `upstream-path: "skills/writing-plans/SKILL.md"` and `must-match: "## Execution Handoff"`.
- `planning.md never restates the asked classes` — `assert.deepEqual(classStatementSites(new Map([[PLANNING_REL, planning()]])), [])`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL with ENOENT on `plugin/skills/specify/planning.md`

- [ ] **Step 3: Write `plugin/skills/specify/planning.md`** with exactly this content (Tasks 5 and 6 append the remaining sections):

````markdown
# Specify — Planning at Shaping Time (#6056)

Read only when `shaping-mode.md`'s Planning at specify paragraph resolved `plan-at-specify` to `on` under `work-backend: github-issues`; under `off`, the default, nothing in this file runs and shaping is exactly as written. Resolution refuses `on` while `planning-decisions` resolves `ask-all`: `resolve-policy.js` then prints `off` and one stderr warning naming the conflict, never an error, and that paragraph relays the warning as a one-line notice. This file writes a plan for each record shaping mode is about to stamp `ready`, reviews it, settles or asks its questions, and stores it beside the record, all before the record's one write. Which questions reach the user, and how every other one is written down, is `_shared/planning-decisions.md`'s, cited here by section name; this session is the controller that file names.

**Plan text never enters this session.** Planners and the reviewer return paths and tables only, so never Read the plan file and never ask an agent for its text; `plan-audit.js`'s JSON and `plan-store.js`'s JSON are the only other views of it.

## Which records are planned

A record is planned when `shaping-mode-stamping.md`'s Compose-then-write-once is about to write it with `ready`: a `shaped` record, including a single-record exit-0 record whose `### Risk flags` run changed its body. A refused record, a digest container, an `already shaped, no-op` record and a body the pre-write shape check refuses are never planned.

**Plan-less lane predicate.** First ask whether a lane that composes no plan will take the record. Resolve `{lane-file}` with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-lane-{n}.json`, then write the record there, `{labels}` being the fetched labels plus this pass's stamps (`risk:*`, `size:*`, `ceremony:*`, Type, `ready`) minus its removals, comma-joined — the verdict reads those labels, and the live record does not carry them yet:

```bash
node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({number:Number(process.argv[2]),body:fs.readFileSync(process.argv[3],'utf8'),labels:process.argv[4].split(',').filter(Boolean)}))" -- "{lane-file}" {n} "{body}" "{labels}"
node "${CLAUDE_PLUGIN_ROOT}/bin/express-lane.js" plan-lane --record-json "{lane-file}"
```

It prints `{number, lane, reason}`: the verdict of `needsNoPlan` (`bin/lib/driver/plan-lane.js`). A non-null `lane` means the record is not planned: no plan, no `Plan:` line and no `## Overview` insertion; its Actions Performed Detail reads `not planned: {lane} lane ({reason})`, and with a run dir it logs one `SKIP` (Logging, below). A non-zero exit, no JSON line, or `lane: null` plans the record.

**Reuse a stored plan.** When the record's fetched body already carries a `Plan:` line, run `## Per-record step`'s steps 1-2, then check the line against the new body and base:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line "{plan-line}" --spec-file "{body}" --base {base}
```

`{"valid": true}` (exit 0) keeps that line: skip steps 3-8, remove the checkout, and carry the line into the write. Any other verdict or exit re-plans, and the new line replaces the old one.

## Per-record step

Run at the point `shaping-mode-stamping.md`'s Compose-then-write-once names: after `### Risk flags` settled the session-tmp body file, `{body}`, and before that section's pre-write shape check. In order:

1. **Body.** `{body}` is the composed body. When the fetched body held a `## Overview` or `## Planning Decisions` section this composition dropped, carry it over verbatim. When `{body}` has no `## Overview`, insert one directly above `## Current State`: one paragraph saying what the record builds and why, drawn from its own Current State and Deliverables. The plan's spec hash (`bin/lib/issues/plan-line.js`) covers `## Overview` through `## Planning Decisions` and refuses a spec with no Overview. `## Planning Decisions` goes after `## Gotchas` (and after `## Breaking Change` when present), before `## Original request`.
2. **Base and checkout.** Resolve `{integration-branch}` per `_shared/integration-branch.md`, then run each of these as its own plain call (`_shared/scratch-worktree.md` §7): `git fetch origin {integration-branch}`; `git rev-parse origin/{integration-branch}`, whose sha is `{base}`, the plan's base; `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-checkout-{n}`, whose path is `{checkout}`; `git worktree add --detach "{checkout}" {base}`. The checkout's tracked files are read-only: the plan is the one file written there. Once this record's planning ends, on every path, remove it with `git worktree remove --force "{checkout}"`.
3. **Planner.** Dispatch one planner on the Standard profile (`## Planner prompt`). Open Prerequisites do not skip planning.
4. **Audit.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{plan}" --spec "{body}" --repo-root "{checkout}"`. When it exits non-zero, or its `checkE.uncovered` or `checkF.unlisted` is non-empty, re-dispatch the planner once with the Amend prompt, passing the audit's JSON line as its findings, and run the audit again; a check whose `ok` is still `false` means planning failed.
5. **Reviewer.** Dispatch one reviewer on the Capable profile (`## Reviewer dispatch`).
6. **Route.** Route its reply (`## Routing`).
7. **Amend.** When routing produced plan amendments, settled lines, decided lines or flag additions, re-dispatch the planner with the Amend prompt, the decisions table and `{plan}`; it returns the path. Run step 4's audit once more; a failing check here means planning failed.
8. **Store.** From this session's working directory, run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"`. Exit 0 prints `{ref, commit, specHash, line}`: insert `line` verbatim as the last line of `{body}`'s metadata block, above its first `##` heading; `bin/plan-store.js` is the line's one writer, so never type or edit it. Exit 3 is the no-ref outcome: keep every decision line, write no `Plan:` line, and record why — the Detail reads `planned, no Plan: line: plan-store exit {code} ({first stderr line})`, and with a run dir one `SKIP`. Any other non-zero exit takes the same fallback.
9. **Write.** Return to Compose-then-write-once: its pre-write shape check and its one write follow, with `## Hold`'s label changes for a held record.

**Planning failed** (the checkout cannot be made, a planner or reviewer reply is still unusable after its one re-dispatch, or an audit fails as step 4 or 7 says): remove the checkout, drop this pass's settled and decided lines, write no `Plan:` line, and let the record be written as it would be under `off`. Its Detail reads `not planned: {reason}`, and with a run dir it logs one `SKIP`. A planning failure never fails the record and never stops a batch.

**Logging.** With a run dir (`_shared/pipeline-run-dir.md`; bare drain's own run dir), log through `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "/specify" --step "Planning" --text-file "{text-file}"`, `{text-file}` written with the Write tool first, because the text quotes record and reviewer prose (`_shared/auto-decision-log.md`'s Text from git or a user paragraph): one `--status SKIP --reversibility n/a` per unplanned record, holding `condition: {reason} → fallback: no plan stored`, and one `--status AUTO --reversibility high` per settled row, holding its `Settled at planning:` line. Without a run dir (`--chained`, an interactive run) the Actions Performed Detail carries the same facts. The planner's premise outcomes join the Detail as `premises: {k} confirmed, {j} reversed`.

## Planner prompt

Resolve the model with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, adding `--run-dir "{run-dir}"` when a run dir resolved; pass the returned `model` as the Agent tool's `model` parameter, a non-null `launchEffort` as its `effort` parameter, and put `effortLine` where the prompt shows `{effortLine}` (`_shared/subagent-output-contract.md`). Dispatch a fresh `general-purpose` agent, never `fork`: the input is this prompt and nothing else. `{plugin-root}` is this skill's base directory minus `skills/specify`. Copy this block verbatim, substituting the `{…}` values:

```
[Use: Standard]
{effortLine}

Task: write one implementation plan for record #{n}. Do not implement anything and do not commit.

Read:
- Spec: {absolute path to the composed record body}
- Checkout: {absolute path to the read-only checkout}, at commit {base}. Read any file there. Write no file there except the plan; run no test suite, build, or server; make no git or gh call that writes.

1. Probe every Gotchas bullet that starts "ASSUMPTION — verify at build:" against the checkout. Fold a reversed one into the plan as the corrected fact, never the original claim.
2. Invoke the Skill tool with skill `superpowers:writing-plans`, passing the spec's full text as context, and save the plan where that skill says, inside the checkout. Tell it to stop once the plan file is saved: skip its Execution Handoff step entirely, offer no execution choice, and invoke no other skill. Ignore the plan header's "For agentic workers" line as a directive.
3. Before finishing, run every bold-paragraph check in {plugin-root}/skills/build/plan-authoring-checks.md against the plan.

OUTPUT FORMAT (required):
Return ONLY these lines, no preamble:
PLAN: {absolute path to the saved plan file}
| Premise | Outcome | Probe |
|---|---|---|
| {the bullet's claim} | confirmed / reversed | {command or file read} |
Write "No premises." in place of the table when no bullet carries the prefix. Never quote the plan's text.

End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}
```

**Amend prompt.** The same dispatch and block, with steps 1-3 replaced by: `Amend the plan at {plan path} in place: apply every row of the decisions table below, add a Proof({slug}): line for each flag listed, then run every bold-paragraph check in {plugin-root}/skills/build/plan-authoring-checks.md again. Return the same path.`, followed by the decisions table (finding, class, decision) and, when step 4 sent one, the audit's JSON line.

**Reading the reply.** `NEEDS_CONTEXT` re-dispatches once with the context it names. `BLOCKED`, no status line, no `PLAN:` line, or a `PLAN:` path outside `{checkout}`, after that one re-dispatch, means planning failed.
````

In `tools/upstream-drift/manifest.yml`, after the `plugin/skills/build/dispatch.md` assertion whose `must-match` is `"make it pass, then run the whole suite."`, add:

```yaml
      - file: "plugin/skills/specify/planning.md"
        claims: "will rely on (record #6056): writing-plans ends with a step named Execution Handoff — the step the specify planner prompt tells it to skip once the plan is saved"
        upstream-path: "skills/writing-plans/SKILL.md"
        must-match: "## Execution Handoff"
```

(`## Execution Handoff` is line 179 of the installed `superpowers/7.0.2/skills/writing-plans/SKILL.md`; `skills/writing-plans/SKILL.md` is already in the entry's `contract-paths`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-planning-conformance.test.js tests/planning-decisions-conformance.test.js tools/upstream-drift/tests/manifest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/planning.md tests/specify-planning-conformance.test.js tools/upstream-drift/manifest.yml
git commit -m "Add specify's planning step — gate, lane predicate, per-record step and planner prompt" -m "Refs #6056"
```

---

### Task 5: Reviewer dispatch and routing, with the brief pinned to `plan-review.md`'s

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/planning.md` (append `## Reviewer dispatch` and `## Routing` after `## Planner prompt`)
- Test: `tests/specify-planning-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 4's helpers and headings. `build/plan-review.md`'s first fenced block after `## Dispatch prompt` (lines 33-72), unchanged by this plan.
- Produces: `## Reviewer dispatch` (prompt fence), `## Routing`, cited by Task 6's `## Hold` and `## Batches`.

- [ ] **Step 1: Write the failing tests** — append:

```js
// The reviewer brief mirrors build/plan-review.md's Dispatch prompt (#6056 Gotchas): every shared
// line is listed and pinned byte-equal, and every intentional difference is named with its reason.
const REVIEW_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-review.md');
const BRIEF_DIFFERENCES = [
  { why: 'the spec is the composed record body in a session-tmp file, not a materialized work/ file',
    from: "- Spec: {absolute path to the worktree's work/{n}-spec.md}",
    to: '- Spec: {absolute path to the composed record body}' },
  { why: 'the repository the reviewer may read is the read-only checkout of origin/{integration-branch}',
    from: 'You may also read any file in the repository at {absolute worktree root}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.',
    to: 'You may also read any file in the repository at {absolute path to the read-only checkout}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.' },
  { why: 'the table carries a Recommended reading column (spec Deliverable 2.5)',
    from: '| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |',
    to: '| Severity | Class | Resolution | Recommended reading | Path:Line | Finding | Evidence | Suggested resolution |' },
  { why: 'the separator row gains the column', from: '|---|---|---|---|---|---|---|', to: '|---|---|---|---|---|---|---|---|' },
  { why: 'example row 1 gains the column',
    from: '| high | spec gap | intent-resolvable | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |',
    to: '| high | spec gap | intent-resolvable | — | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |' },
  { why: 'example row 2 gains the column',
    from: '| medium | cross-task contract | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |',
    to: '| medium | cross-task contract | — | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |' },
];
const BRIEF_INSERTIONS = [
  { why: 'a needs-human row names the reading the reviewer recommends (spec Deliverable 2.5)',
    after: 'On a needs-human row, Suggested resolution names both defensible readings: "Reading A: … / Reading B: …" (for a criterion change, Reading A keeps the criterion as written).',
    line: 'On a needs-human row, set Recommended reading to "Reading A" or "Reading B": the one that keeps every Acceptance Criterion and recorded decision and sits closer to the spec\'s stated intent, or "Reading A" when neither keeps them all. Write "—" in Recommended reading on every other row.' },
];
// Every other non-blank line of plan-review.md's block, copied verbatim, in order.
const BRIEF_SHARED_LINES = [ /* see Step 1 note */ ];
```

Step 1 note for `BRIEF_SHARED_LINES`: copy, verbatim and in order, every non-blank line of `plan-review.md`'s Dispatch prompt block (lines 33-72) except the six `from` lines above — 26 lines, from `[Use: Capable]` through `End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}`.

Add `dispatchBlock(text, heading)` (first fenced block after the heading, as `tests/build-plan-review-conformance.test.js` lines 31-40 do) and:

- `briefProblems(reviewBlock, planningBlock)` → array: `'shared list incomplete'` when the non-blank lines of `reviewBlock` minus the `from` lines differ from `BRIEF_SHARED_LINES`; `'shared line missing: …'` for a shared line not present exactly once in `planningBlock`; `'difference not applied: …'` when a `from` line is not exactly once in `reviewBlock`; `'brief drifted'` when `toSpecifyBrief(reviewBlock) !== planningBlock`, where `toSpecifyBrief` replaces each `from` line with its `to` line and inserts each insertion's `line` directly after its `after` line.
- Test `the reviewer brief equals plan-review.md's Dispatch prompt with only the named differences` — `briefProblems(...)` deep-equals `[]`, and every difference and insertion has a non-empty `why`.
- Control `go-red: a shared line edited in planning.md only is reported` — replace `Find five classes of problem, and only these:` with `Find six classes of problem, and only these:` in a copy of the planning block (assert the copy differs) → result includes `'shared line missing: Find five classes of problem, and only these:'` and `'brief drifted'`.
- Control `go-red: an unnamed difference is reported` — append `x` to the planning block's `Severity scale:` line → result includes `'brief drifted'`.
- Test `the reviewer is dispatched as plan-review.md dispatches it` over `sectionOf(planning(), '## Reviewer dispatch')`: `lit('`isolation: "worktree"`')`, `lit('never `fork`')`, `lit('`resolve-profile.js capable`')`, `lit('A table whose header lacks the Recommended reading column is unusable.')`.
- Test `AC2.2 + AC3.1 + AC4.1: routing settles detail rows silently, asks each asked row once, and asks nothing headless` over `sectionOf(planning(), '## Routing')`:
  - `lit('a `Settled at planning:` line, never asked, in every posture')`
  - `lit('Each question is asked once.')`
  - `lit('the recommended reading first, labelled `(Recommended)`, then the other reading, then `Leave for later`')`
  - `lit('at most four questions per call, one call per message')`
  - `lit('columns `Record`, `Finding`, `Class`, `Recommended reading`')`
  - `lit('it is asked, or held when headless')`
  - `lit('as `shaping-mode-stamping.md`\'s `### Risk flags` step 2 defines it')`
  - `lit('a headless run asks nothing and takes `## Hold` for every asked row')`
  - `lit('risk-flags.js" add --body-file "{body}" --add {slug}')`
- Test `AC2.1: a planned record always carries ## Planning Decisions` over `## Routing`: `lit('A planned record always carries the section')`, `lit('`No planning questions arose.`')`.
- Test `the reviewer and planner fences are self-contained` — the reviewer fence contains neither `'SKILL.md'` nor `' above'` nor `' below'` (it keeps plan-review's `_shared/github-rate-limit.md` example text, a named shared line).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL with "heading not found: ## Reviewer dispatch"

- [ ] **Step 3: Append to `planning.md`** after `## Planner prompt`:

````markdown
## Reviewer dispatch

One reviewer on the Capable profile, dispatched as `build/plan-review.md`'s Dispatch section dispatches its own: the model from `resolve-profile.js capable` (with `--run-dir "{run-dir}"` when a run dir resolved), a fresh `general-purpose` agent, never `fork`, `isolation: "worktree"`, and no conversation history. The prompt is that file's Dispatch prompt with the differences `tests/specify-planning-conformance.test.js` names: the Spec is the composed body, the repository is the read-only checkout, and the table carries a Recommended reading column. Copy this block verbatim, substituting the `{…}` paths and `{effortLine}`:

```
{the planning-side brief: plan-review.md's Dispatch prompt block with BRIEF_DIFFERENCES and BRIEF_INSERTIONS applied — the implementer produces it by applying exactly those edits to a copy of plan-review.md lines 33-72}
```

**Reading the reply** follows `build/plan-review.md`'s Reading the reply for `NEEDS_CONTEXT`, an unusable reply, `No findings.`, a `+N more` row, and the rule that promotes a spec-gap row to needs-human, except that an unusable reply after the one re-dispatch means planning failed (`## Per-record step`) and every log line is this file's, never that file's `/build` entries. A table whose header lacks the Recommended reading column is unusable.

## Routing

Route every parsed row by its Class and Resolution, never on Severity:

- **`low` and `info` rows** amend nothing; they are counted in the Detail and logged.
- **Undecided behaviour, cross-task contract, missing-review-risk and mischaracterized-role rows** become plan amendments for step 7.
- **An intent-resolvable spec-gap row** whose Evidence sentence appears verbatim in `{body}` adds one line under `## Planning Decisions` quoting that sentence, as `build/plan-review.md`'s intent-resolvable sequence writes its clarification line.
- **Every needs-human row**, the reviewer's or one promoted, is classified against `_shared/planning-decisions.md`'s `## Asked classes` and `## Doubt rule`. The kept flags are `{body}`'s `Risk-flags:` line; the declared categories are read as `build/plan-review-asked-classes.md`'s Routing step 1 reads them. A row a recorded decision already answers takes `## Line forms`' answered-round rule: a `Decided by the user at planning:` line, never asked. A row outside the asked classes takes `## Settled path`: a `Settled at planning:` line, never asked, in every posture. A class (b) row whose category `{body}` does not flag first gets `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" add --body-file "{body}" --add {slug}` and a `Proof({slug}):` amendment for step 7; a non-zero exit still asks the row. A row whose two readings cannot be written from its Suggested resolution and `{body}` is unclassifiable: it is asked, or held when headless.

**Asking.** Headless means no human is reachable, as `shaping-mode-stamping.md`'s `### Risk flags` step 2 defines it: a headless run asks nothing and takes `## Hold` for every asked row. Otherwise render one batch table with columns `Record`, `Finding`, `Class`, `Recommended reading`, then ask per `_shared/planning-decisions.md`'s `## Asking`: one `AskUserQuestion` per question set, at most four questions per call, one call per message, each question's options the recommended reading first, labelled `(Recommended)`, then the other reading, then `Leave for later`. The recommended reading is the one `## Asking` names; the reviewer's Recommended reading cell is its input, never the verdict. Each question is asked once. An answer is written `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`. `Leave for later` on any question, or a call that errors, times out or is auto-answered, takes `## Hold` for every question of that record not yet answered.

**Writing the lines.** Every `Settled at planning:`, `Decided by the user at planning:` and intent-resolvable line goes under one `## Planning Decisions` section of `{body}`, placed as step 1 says; the section never edits an existing criterion's line. A planned record always carries the section: with no line to write, it holds the one line `No planning questions arose.`
````

The `{the planning-side brief…}` placeholder above is a plan instruction, not file text: the fence in `planning.md` holds the 33 lines `toSpecifyBrief(plan-review.md's block)` produces, so the Step 1 equality test passes by construction.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-planning-conformance.test.js tests/planning-decisions-conformance.test.js tests/build-plan-review-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/planning.md tests/specify-planning-conformance.test.js
git commit -m "Add specify's plan reviewer and routing — brief pinned to plan-review.md's, differences named" -m "Refs #6056"
```

---

### Task 6: Hold, held-questions contract, batches and read-back

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/planning.md` (append `## Hold`, `### Held-questions schema` inside it, `## Batches`, `## Read-back and outcome`)
- Test: `tests/specify-planning-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 4/5 headings and helpers; `_shared/work-record.md`'s Decision-comment template (`<!-- needs-decision: {unit} -->`, `## Decision needed`, `**Proposed:**`, `**Why:**`, `**Command:**`).
- Produces: the held-questions contract #6059 reads — `HELD_QUESTIONS` constants in the test: `heldBy: 'Held-by: specify-planning'`, `start: '<!-- held-questions:start -->'`, `end: '<!-- held-questions:end -->'`, `question: '- Question: '`, `option: '  Option: '`, `recommended: '  Recommended: '`; reader `parseHeldQuestions(comment) -> { heldBy: boolean, questions: [{ text, options: [string, string], recommended }] }`, throwing `Error('held-questions block malformed')` when the block is absent, unterminated, or a question lacks exactly two options and one recommended line.

- [ ] **Step 1: Write the failing tests** — append the `HELD_QUESTIONS` constants and `parseHeldQuestions` (a line reader over the text between `start` and `end`; `heldBy` is true when the line directly above `start` equals `heldBy`), then:

- `Deliverable 8: the hold template and the schema carry the same contract strings (writer and reader)` — `template = fenceAfter(planning(), '## Hold')`; `schema = text from '### Held-questions schema' to the next '## '`; every `HELD_QUESTIONS` value appears in `template`, and every value, untrimmed, appears in `schema` wrapped in backticks (`schema.includes('`' + value + '`')`: `` `- Question: ` ``, `` `  Option: ` ``, `` `  Recommended: ` ``, `` `Held-by: specify-planning` ``, `` `<!-- held-questions:start -->` ``, `` `<!-- held-questions:end -->` ``). Fill the template (`{question text}` → `Which file carries the pointer`, `{recommended reading}` → `docs/hooks.md`, `{other reading}` → `plugin/skills/dispatch/task-prompt.md`, `{n}` → `42`, `{k}` → `1`) and assert `parseHeldQuestions(filled)` deep-equals `{ heldBy: true, questions: [{ text: 'Which file carries the pointer', options: ['docs/hooks.md', 'plugin/skills/dispatch/task-prompt.md'], recommended: 'docs/hooks.md' }] }`.
- `Deliverable 8: the hold comment is the canonical decision comment, unit specify, Command re-shapes the record` over the template: `lit('<!-- needs-decision: specify -->')`, `lit('## Decision needed')`, `lit('**Proposed:**')`, `lit('**Why:**')`, `lit('**Command:** `/claude-tweaks:specify #{n}`')`.
- Control `go-red: a template without the Held-by line is read as no hold` — remove `Held-by: specify-planning\n` from the filled copy (assert it changed) → `parseHeldQuestions(copy).heldBy === false`; and a copy with one `  Option: ` line removed throws `/held-questions block malformed/`.
- `AC3.2 + AC4.1 + Deliverable 4: a hold writes the body and plan, drops ready and adds needs:decision without removing it in the same call` over `sectionOf(planning(), '## Hold')`: `lit('is left without `ready`')`, `lit('omit `--add-label ready`, add `--remove-label ready` when the record carries it, add `--add-label "needs:decision"`')`, `lit('omit `--remove-label "needs:decision"`')`, `lit('with its settled lines, its decided lines and its plan stored')`, `lit('Every value is one line: a newline inside reviewer text becomes a space.')`.
- `Deliverable 3 + 10: a batch defers writes, fans planners and reviewers out, asks once, and holds per record` over `sectionOf(planning(), '## Batches')`: `lit('defers every record\'s write')`, `lit('with the planners dispatched in one message')`, `lit('with the reviewers dispatched in one message')`, `lit('one batch table and the chunked questions covering every record\'s asked rows together')`, `lit('A hold is per record; the rest of the batch proceeds.')`, `lit('`SKILL.md`\'s "a loop never a fan-out" still governs the record writes')`.
- `AC2.1 + AC5.1: read-back asserts the Plan: line or the hold, and the outcome words` over `sectionOf(planning(), '## Read-back and outcome')`: `lit('exactly one `Plan:` line, equal to the `line` `plan-store.js write` printed')`, `lit('in place of that file\'s `ready` and no-`needs:*` assertions')`, `lit('`held — needs:decision ({k} planning question(s))`')`, `lit('A held record is never in a `/claude-tweaks:flow` command')`, `lit('bare drain\'s Release reason stays `shaped: #{n}`')`, `lit('**Not planned:** no `Plan:` line was written this pass.')`.
- `planning.md headings appear in order` — `## Which records are planned`, `## Per-record step`, `## Planner prompt`, `## Reviewer dispatch`, `## Routing`, `## Hold`, `## Batches`, `## Read-back and outcome`, ascending indices.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL with "heading not found: ## Hold"

- [ ] **Step 3: Append to `planning.md`** after `## Routing`:

````markdown
## Hold

A held record is written the same way, with its settled lines, its decided lines and its plan stored (steps 7-8 run on what was settled), and is left without `ready`. In Compose-then-write-once's call: omit `--add-label ready`, add `--remove-label ready` when the record carries it, add `--add-label "needs:decision"` (bootstrap it per `_shared/label-bootstrap.md`), and omit `--remove-label "needs:decision"`; older decision comments are still resolved first, as that file's `needs:*` bullet says. Once the edit lands, post the comment below through `_shared/github-write-transport.md`: write it with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-hold-{n}.md` prints, then run `gh issue comment {n} --body-file "{path}"`, or post it with `add_issue_comment` when `gh` is absent. A failed post renders the record's row `failed — hold comment not posted ({reason})`. The comment is `_shared/work-record.md`'s canonical decision comment, `{unit}` = `specify`:

```
<!-- needs-decision: specify -->
## Decision needed
**Proposed:** {Q1: recommended reading; Q2: recommended reading; …}
**Why:** planning at /claude-tweaks:specify held {k} question(s) that need a human
**Command:** `/claude-tweaks:specify #{n}`
Held-by: specify-planning
<!-- held-questions:start -->
- Question: {question text}
  Option: {recommended reading}
  Option: {other reading}
  Recommended: {recommended reading}
<!-- held-questions:end -->
```

### Held-questions schema

The block is the contract a later reader parses (#6059); `tests/specify-planning-conformance.test.js` pins the template above and these rules to the same strings.

- `Held-by: specify-planning` sits on the line directly above the block and marks the comment as this step's hold.
- The block opens with `<!-- held-questions:start -->` and closes with `<!-- held-questions:end -->`, each on its own line.
- Each held question is one `- Question: ` line followed by exactly two `  Option: ` lines, the recommended reading first, and one `  Recommended: ` line, in the order the questions would have been asked.
- Every value is one line: a newline inside reviewer text becomes a space. Values quote the body, the plan and the finding with repo-relative paths, never a local absolute path.

**Re-running.** `/claude-tweaks:specify #{n}` re-shapes a held record: `shaping-mode-stamping.md`'s `needs:*` bullet resolves the hold comment and removes the label, and the held questions are asked again unless a `**Decision**` paragraph on the body now answers them (`_shared/planning-decisions.md`'s `## Line forms` answered round).

## Batches

A comma list or range defers every record's write: the per-record loop runs each record through Compose-then-write-once up to the point `## Per-record step` names, copies `{body}` to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-body-{n}.md` prints, and moves on; that copy is the record's `{body}` from then on. Once every record is there, run the lane predicate per record, then steps 1-3 for every planned record with the planners dispatched in one message (one `Agent` call each), step 4 per record, step 5 with the reviewers dispatched in one message, and step 6 with one batch table and the chunked questions covering every record's asked rows together. A hold is per record; the rest of the batch proceeds. Each record then finishes steps 7-9 and its read-back, in list order. These dispatches are shaping mode's one fan-out, each under `_shared/subagent-output-contract.md`; `SKILL.md`'s "a loop never a fan-out" still governs the record writes.

## Read-back and outcome

Read from `shaping-mode-readback.md`'s `plan-at-specify` block, per record:

- **Planned:** the re-fetched body carries exactly one `Plan:` line, equal to the `line` `plan-store.js write` printed, plus `## Overview` and `## Planning Decisions`.
- **Held:** `ready` is absent and `needs:decision` present, in place of that file's `ready` and no-`needs:*` assertions, and the newest unresolved decision comment from a trusted author carries `Held-by: specify-planning`.
- **Not planned:** no `Plan:` line was written this pass.

In Actions Performed, a planned or not-planned record keeps the `shaped` outcome, its Detail adding `planned (Plan: {short commit})`, `planned, no Plan: line: …` or `not planned: …`; a held record's outcome is `held — needs:decision ({k} planning question(s))`. A held record is never in a `/claude-tweaks:flow` command `SKILL.md`'s Next Actions renders; when every record is held, the recommended line is `/claude-tweaks:specify #{n}` for the first held record. Under `--chained` and bare drain the held outcome is the returned or reported outcome, and bare drain's Release reason stays `shaped: #{n}`.
````

- [ ] **Step 4: Run the tests to verify they pass, and check the size**

Run: `node --test tests/specify-planning-conformance.test.js tests/planning-decisions-conformance.test.js`
Expected: PASS

Run: `wc -c plugin/skills/specify/planning.md`
Expected: a count below 52500 (about 21,000)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/planning.md tests/specify-planning-conformance.test.js
git commit -m "Add specify's planning hold, held-questions contract, batches and read-back" -m "Refs #6056"
```

---

### Task 7: Shaping-mode pointer blocks, gated on `plan-at-specify`

**Role:** integration

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md` (after the `> **Parallel execution:**` paragraph, line 34, before the `---` on line 36)
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` (inside `### Compose-then-write-once`, between the `**`work-backend: github-issues`:**` paragraph, line 195, and its ```` ```bash ```` fence, line 197)
- Modify: `plugin/skills/specify/shaping-mode-readback.md` (inside `### Read-back verification`, directly before the line `Assert, against the re-fetched result:`, line 69)
- Test: `tests/specify-planning-conformance.test.js` (append)

**Interfaces:**
- Consumes: `planning.md`'s `## Per-record step`, `## Hold`, `## Read-back and outcome` (Tasks 4-6); Task 1's stderr warning text.

Existing pins near these sites (grepped `tests/` for each file name and for phrases around each insertion point): `tests/risk-flags-prose-conformance.test.js` slices `### Compose-then-write-once` with `between(stamping, '\n### Compose-then-write-once\n', '\n**Split across two files')`, takes the section's first ```` ``` ```` block (the assembly fence, unaffected because the new block holds no fence) and orders `COMPOSE_SETTLE` before `compose-record.js" --check` (the new block names neither literal); `tests/ceremony-framing-per-record-conformance.test.js` only orders the self-check before the section heading; `tests/specify-diagram-suggestion-shaping.test.js` slices `### Diagram suggestion` to `### Read-back verification` (the new readback block sits after that heading). None asserts the moved or inserted bytes, so no existing test changes.

- [ ] **Step 1: Write the failing tests** — append:

```js
// AC1: under plan-at-specify: off, shaping mode is unchanged. Every planning sentence in the three
// shaping files sits inside one marker block whose instruction is the gate; nothing outside the
// blocks, and nothing in any other specify file but planning.md, names the planning step.
const SHAPING_FILES = {
  'plugin/skills/specify/shaping-mode.md': ['Only when it prints `on` under `work-backend: github-issues`', 'Any other output, or a failed call, skips every `plan-at-specify` block and shaping runs as written.'],
  'plugin/skills/specify/shaping-mode-stamping.md': ['When `shaping-mode.md`\'s Planning at specify paragraph read `planning.md`', 'Otherwise skip this paragraph.'],
  'plugin/skills/specify/shaping-mode-readback.md': ['When `shaping-mode.md`\'s Planning at specify paragraph read `planning.md`', 'Otherwise skip this paragraph.'],
};
const GATE_START = '<!-- plan-at-specify:start -->';
const GATE_END = '<!-- plan-at-specify:end -->';
const PLANNING_TOKENS = ['plan-at-specify', 'planning.md', 'plan-store', 'Planning Decisions', 'Plan: '];
```

`gateProblems(text, gatePhrases)` returns: `'block count'` unless the text holds exactly one `GATE_START` followed by one `GATE_END`; `'leak: {token}'` for each `PLANNING_TOKENS` entry present in the text with the block (markers included) removed; `'gate: {phrase}'` for each gate phrase missing from the block (whitespace-collapsed). Tests:

- `AC1.1: each shaping file holds one gated plan-at-specify block and no planning text outside it` — `gateProblems` is `[]` for all three files.
- `AC1.1: no other specify file except planning.md names the planning step` — every `plugin/skills/specify/*.md` not in `SHAPING_FILES` and not `planning.md` contains no `PLANNING_TOKENS` entry; assert the directory walk found more than 20 files.
- Controls (each doctors a copy, asserts it differs, and matches its own problem): appending `'\nread planning.md now\n'` → includes `'leak: planning.md'`; removing `GATE_END` → includes `'block count'`; removing the stamping block's `Otherwise skip this paragraph.` → includes `'gate: Otherwise skip this paragraph.'`.
- `the pointer blocks sit where they run` — in `shaping-mode-stamping.md`, the block's index is after the `**`work-backend: github-issues`:**` line and before the first `` ```bash `` after it; in `shaping-mode-readback.md`, after `### Read-back verification` and before `Assert, against the re-fetched result:`; in `shaping-mode.md`, after the `> **Parallel execution:**` line and before the first `\n---\n`.
- `Deliverable 9: the shaping-mode block resolves the key once, read-only of --run, and relays the conflict warning` over the `shaping-mode.md` block: `lit('Resolve `plan-at-specify` once per invocation, before the first record')`, `lit('resolve-policy.js" --values plan-at-specify')`, `lit('Relay a stderr warning the call prints')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL with `block count` for each shaping file

- [ ] **Step 3: Insert the three blocks** (each block is the marker line, one paragraph, the end marker line, with a blank line before and after the block).

First run `git fetch origin main` and `git log origin/main --oneline -3 -- plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/shaping-mode-readback.md`; if #5560 or #4746 has landed, catch the worktree up (`_shared/worktree-setup.md`'s Post-creation catch-up) and re-read the three files before editing, since both edit them (spec Gotchas).

`shaping-mode.md`, after the `> **Parallel execution:**` paragraph:

```markdown
<!-- plan-at-specify:start -->
**Planning at specify (#6056).** Resolve `plan-at-specify` once per invocation, before the first record: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values plan-at-specify`. Only when it prints `on` under `work-backend: github-issues`, read `planning.md` in this skill's directory now; it runs at the points the `plan-at-specify` blocks in `shaping-mode-stamping.md` and `shaping-mode-readback.md` name, and on a batch it defers the writes and fans its planners and reviewers out, the one exception to the loop's no-fan-out rule above. Any other output, or a failed call, skips every `plan-at-specify` block and shaping runs as written. Relay a stderr warning the call prints, which names a conflict with `planning-decisions`, as a one-line notice.
<!-- plan-at-specify:end -->
```

`shaping-mode-stamping.md`, between the github-issues paragraph and its `bash` fence:

```markdown
<!-- plan-at-specify:start -->
When `shaping-mode.md`'s Planning at specify paragraph read `planning.md`, run its `## Per-record step` here, once `### Risk flags` has settled the body file and before the `--check` below; it may add `## Overview`, `## Planning Decisions` and a `Plan:` line to that file, and its `## Hold` changes this call's labels for a held record. Otherwise skip this paragraph.
<!-- plan-at-specify:end -->
```

`shaping-mode-readback.md`, directly before `Assert, against the re-fetched result:`:

```markdown
<!-- plan-at-specify:start -->
When `shaping-mode.md`'s Planning at specify paragraph read `planning.md`, apply its `## Read-back and outcome` to this record too: for a held record its assertions replace the `ready` and no-`needs:*` bullets below, and its outcome words join Actions Performed's and Next Actions'. Otherwise skip this paragraph.
<!-- plan-at-specify:end -->
```

- [ ] **Step 4: Run the tests to verify they pass, and that the neighbouring pins still hold**

Run: `node --test tests/specify-planning-conformance.test.js tests/risk-flags-prose-conformance.test.js tests/ceremony-framing-per-record-conformance.test.js tests/specify-diagram-suggestion-shaping.test.js tests/specify-range-form-readback.test.js tests/specify-near-duplicate-prose.test.js tests/shaping-mode-needs-removal.test.js tests/specify-shaping-noop-check.test.js`
Expected: PASS

Run: `wc -c plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/shaping-mode-readback.md`
Expected: about 24,900, 36,050 and 11,850, each below 52500

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/shaping-mode-readback.md tests/specify-planning-conformance.test.js
git commit -m "Point shaping mode at the planning step — one gated block per file, off unchanged" -m "Refs #6056"
```

---

### Task 8: Shared-rule wording, skill graph and structure docs

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/planning-decisions.md` (lines 3 and 17)
- Modify: `tests/planning-decisions-conformance.test.js:42`
- Modify: `docs/skill-graph.md` (`## specify` table, after its last row, line 664)
- Modify: `docs/plugin-structure.md:205` (the `specify` row)
- Modify: `plugin/skills/help/context-flow.md:65` (the `/specify` row)

**Interfaces:**
- Consumes: `planning.md` (Tasks 4-6) as the new citer of `_shared/planning-decisions.md`.

Behaviour-change sweep for the classifier sentence (grepped `plugin/ tests/ docs/` for "build's plan review (the controller)" and "specify-time planning will cite it later"): only `planning-decisions.md` holds them and only `tests/planning-decisions-conformance.test.js:42` pins the first.

- [ ] **Step 1: Update the pinned pattern first** — `tests/planning-decisions-conformance.test.js` line 42 becomes:

```js
  [lit('The classifier is the controller — the build\'s plan review, or `/claude-tweaks:specify`\'s planning step — never the reviewer.'), 'classifier is the controller'],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/planning-decisions-conformance.test.js`
Expected: FAIL with "asked classes: missing classifier is the controller"

- [ ] **Step 3: Edit the prose and the docs**

`plugin/skills/_shared/planning-decisions.md`: line 3's sentence `` `build/plan-review-asked-classes.md` cites it for build-time plan review today; specify-time planning will cite it later. `` becomes `` `build/plan-review-asked-classes.md` cites it for build-time plan review, and `specify/planning.md` for specify-time planning (#6056). ``; line 17 becomes `The classifier is the controller — the build's plan review, or `/claude-tweaks:specify`'s planning step — never the reviewer.`

`docs/skill-graph.md`, three rows appended to the `## specify` table:

```markdown
| `/superpowers:writing-plans` | Under `plan-at-specify: on` (#6056), `planning.md` dispatches a Standard planner that invokes it in a read-only checkout of `origin/{integration-branch}` and tells it to skip its Execution Handoff step once the plan is saved; `tools/upstream-drift/manifest.yml` pins that heading. |
| `/build` | `planning.md`'s reviewer prompt is `build/plan-review.md`'s Dispatch prompt plus three named differences, pinned byte-equal by `tests/specify-planning-conformance.test.js`; its planner runs `build/plan-authoring-checks.md`. A build of a record carrying a `Plan:` line still plans as today until the build-reuse record (#6060) lands. |
| `_shared/planning-decisions.md` | `planning.md`'s Routing classifies every needs-human row against `## Asked classes` and `## Doubt rule`, writes `## Line forms`' lines and asks per `## Asking` with `Leave for later`; `plan-at-specify` resolves `off` unless `planning-decisions` is `asked-classes` (#6056). |
```

`docs/plugin-structure.md`, the `specify` row: add `planning.md` after `shaping-mode-readback.md` in the file list, and append to the row's description: `planning.md holds the plan-at-specify step (#6056) — plan-less lane predicate, read-only checkout, planner and reviewer dispatch prompts, routing, the needs:decision hold and its held-questions schema, batches and read-back — read only when plan-at-specify resolves on, from the gated blocks in the three shaping files.` (The row wraps onto `| | |` continuation lines; append to the last one.)

`plugin/skills/help/context-flow.md`, the `/specify` row's Writes cell: after `` (`ready` + scoring, plus `solution:unjustified` and `## Gotchas` on a `solution-baked` verdict) `` add `` ; under `plan-at-specify: on`, also a plan on `refs/claude-tweaks/plans/{n}`, a `Plan:` body line and `## Planning Decisions`, or a `needs:decision` hold ``.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/planning-decisions-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/skill-catalog-completeness.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/planning-decisions.md tests/planning-decisions-conformance.test.js docs/skill-graph.md docs/plugin-structure.md plugin/skills/help/context-flow.md
git commit -m "Name specify's planning step as a planning-decisions citer — skill graph and structure docs" -m "Refs #6056"
```

---

### Task 9: Full-suite verification

**Files:**
- Test: whole suite (no file changes)

- [ ] **Step 1: Run the whole suite, output to a file**

Run: `npm test -- --full > "$TMPDIR/ct-6056-full.txt" 2>&1; echo "exit=$?"`
Expected: `exit=0` (AC7.1). Read the summary lines (`ℹ tests`, `ℹ pass`, `ℹ fail`) from the end of the file with `tail -n 20`.

- [ ] **Step 2: Triage any failure in isolation**

For each failing file, run `node --test {file}` alone. A file that passes alone and failed only in the full run is load flake per CLAUDE.md; any file that fails alone is a defect to fix in the task that owns that file, then re-run Step 1. Never accept a subagent's reported counts: quote the raw summary lines.

- [ ] **Step 3: Audit the skill bytes**

Run: `wc -c plugin/skills/specify/planning.md plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/shaping-mode-readback.md plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-coverage.md plugin/skills/_shared/planning-decisions.md plugin/skills/help/context-flow.md`
Expected: every count below 52500

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, 9 (policy value, refusal, warn-tier notice, `policyOnly` ruling, not a Manifesto lever) | 1, 2, 7 |
| Deliverable 2 (step order, session-tmp body shared by planner/reviewer/`plan-audit.js --spec`) | 4, 5 |
| Deliverable 3, 10 (batches, batch table columns, chunks of four, per-record hold, headless definition) | 5, 6 |
| Deliverable 4 (headless and `Leave for later` hold) | 5, 6 |
| Deliverable 5 (no-ref fallback) | 4 |
| Deliverable 6 (tests: step order, gate, headless hold, policy refusal) | 1, 4, 5, 6, 7 |
| Deliverable 7 (predicate via `needsNoPlan`) | 4 |
| Deliverable 8 (hold comment contract, re-shape reuse via `plan-store.js check`) | 4, 6 |
| AC1.1 | 1, 7 |
| AC2.1, AC2.2 | 5, 6 |
| AC3.1, AC3.2 | 5, 6 |
| AC4.1 | 5, 6 |
| AC5.1 | 4, 6 |
| AC6.1 | 4 |
| AC7.1 | 9 |
| AC8.1 | 3, 8 |
