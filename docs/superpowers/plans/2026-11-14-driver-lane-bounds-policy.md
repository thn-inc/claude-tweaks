# Driver Lane Bounds as Policy Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline driver's size ceiling, Key File limit and implementation-line bound three `policyOnly` policy keys whose defaults equal today's express values, and require the #5222 reviewer step for any record admitted beyond the express bounds.

**Architecture:** `evaluateRecordEligibility` gains two optional bound options (absent → byte-identical verdicts); `express-lane.js check` gains an optional `--max-lines` flag (absent → reads `auto-merge-max-lines` as today). The driver reads the three keys once, computes the reviewer-on answer once per record (`ctx.reviewer`), and that one answer feeds admission's new reviewer rule, the `check` flag decision, the worker prompt's stated bound, and the review step.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T212211-spec-5224/work/5224-spec.md`

Scope keywords: evaluateRecordEligibility, evaluateAdmission, reviewRequired, EXPRESS_MAX_KEY_FILES, express-driver-max

## Global Constraints

- Every default equals today's express value: accepted size `low`, Key File limit `3` (= `EXPRESS_MAX_KEY_FILES`), line bound unset = "the express bound" (no flag passed, so `check` reads `auto-merge-max-lines` itself). No widened value is pinned as a default in any test or doc row; tests set widened values explicitly.
- `size:high` is never accepted under any policy value (the size key's enum is `low`, `medium` only).
- The eligibility reasons are a wire contract: keep the existing `REASONS` strings byte-identical; add, never reword. New function-valued reasons go in a **separate** frozen export, not in `REASONS` — `tests/bin-lib/express/eligibility.test.js`'s `REASONS is frozen …` test spreads every non-function-pair key of `REASONS` into a literal `deepStrictEqual`, and AC1 requires that file to pass unmodified.
- Do not add a parallel `maxLines` option to `evaluateDiffBounds`. Do not read `auto-merge-max-lines` in the driver and pass it as the flag: omitting the flag keeps `check` the single place the express bound is read.
- `plugin/skills/_shared/express-lane.md` is untouched; no file under `plugin/skills/` other than `_shared/policy-schema.md` and `_shared/policy-schema-coverage.md` changes. `express-lane.js gate` passes no new option, so its verdicts are unchanged.
- All three keys are `policyOnly: true`, tier `advanced`, category `merge-safety`.
- `plugin/skills/_shared/policy-schema.md` stays under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`). Measured at this base: 47,854 B (4,646 B headroom; past the soft 90% `nearCeiling` line of 47,250 B, which never fails). Three rows of ≤ ~450 B each leave ≥ ~3.2 KB; no section move is planned. Re-measure with `wc -c` after merging `main` (AC8).
- Plan-amended scope (beyond the spec's Key Files, `scope-creep: add-to-plan`): `plugin/bin/lib/driver/run.js` (`newCtx` field, `realDeps` member), `plugin/bin/lib/driver/review.js` (`reviewRecord` reads `ctx.reviewer` so admission, the flag and the review step share one answer), `tests/bin-lib/driver/run.test.js` (fake-runner ACs 4/11/12), `tests/bin-lib/driver/review.test.js` (its one `reviewRecord` call's ctx), `docs/journeys/resolve-a-policy-key.md` (policy-key-addition site 9).

**Governing skills, quoted verbatim:**

From `.claude/skills/policy-key-addition`:
- "**The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived (`_shared/policy-schema-read-path.md`'s Derived-default keys, Shapes A and B). `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)."
- "**The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
- "**The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit."
- "**The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
- "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s \"Canonical read path carve-outs\", which lists every key carrying the flag"
- "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record. No test reads that list"
- "An invalid value resolves to the default with `invalid: true`."
- "**A key joining a family reaches only the callers that list it.** If the family's consumers each spell out the existing keys (a hand-built policy object, a `resolve-policy.js --values` line, a `resolvePolicyKeys` list), a new key is resolved nowhere, and every caller silently runs on its default."

From `.claude/skills/driver-step-addition`:
- "`plugin/bin/lib/driver/run.js` `newCtx` and `interruptClass` | Needed only for a new durable side effect. … Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one."
- "A baseline the check keeps on `ctx` (`ctx.indexFlags`) starts as `null` in `newCtx` and gets no `interruptClass` rung: it is a read, not a side effect." (applies to `ctx.reviewer`)
- "`docs/driver.md` | Copied by hand, and no test reads it."
- "`tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else."

From `plugin/bin/lib/express/cli.js`'s header (gh-api-module-pattern's CLI wrapper contract for this CLI): "2 malformed invocation (an unreadable or mis-shaped --records-json / --record-json / --detail-file included) or `gh` absent where it is needed".

**Consumers of the changed readers** (Consumer-enumeration check): `evaluateRecordEligibility` — `express/cli.js` `gate` (express; passes no new option, unchanged), `express/queue.js` `keepSingleton` (express fast-lane bundling; passes no new option, unchanged), `driver/steps.js` `eligibilityStep` (Task 5, passes both). `evaluateAdmission` — `driver/steps.js` `admissionStep` only (Task 5). `reviewRequired` — `review.js` `reviewRecord` today; after Task 5 called once per record by `steps.js` through `deps.reviewRequired`, and `reviewRecord` reads `ctx.reviewer`. `express-lane.js check` argv — `driver/steps.js` `checkStep` only (the prose express lane runs it without `--max-lines`).

`prose-code-twin-pin` does not apply: the code twin's prose (`_shared/express-lane.md`) is untouched, and the new options are driver-only (absent for every express caller).

**Derived-default shape for `express-driver-max-lines`: Shape B** (`_shared/policy-schema-read-path.md`'s Derived-default keys — "Pick B when an existing consumer must keep reading the value as a plain default"). The row keeps a static base `default: 40` (equal to `auto-merge-max-lines`' own default), and `resolvePolicyKeys` derives the value whenever the key resolves `source: 'default'` (unset **and** set-but-invalid; the `invalid: true` flag survives) as the resolved `auto-merge-max-lines` value, read through the same sources with the same invalid handling, mirroring `deriveHousekeepingAutoMerge` (`plugin/bin/lib/policy-schema.js:589-601`, wired at `:699`). `source` stays `default`, which is the attribution the driver reads: any `source: 'default'` means "pass no flag", so `check` itself applies `auto-merge-max-lines`. The resolved value is then the express bound in fact, so `--all` and `/claude-tweaks:help` never show a no-bound `null`. `_shared/policy-schema-read-path.md` names `housekeeping-auto-merge` as its Shape B example and is not edited (AC9.1); the doc row states the shape.

## Review Focus

1. A malformed size value (`high`, `Medium`, `med`) in `policy.yml` must resolve `low` with `invalid: true` and never widen the lane — Task 3 test `AC5.3: malformed values never widen`.
2. A Key File limit set *below* 3 (e.g. `2`): a `size:low` record with 3 Key Files is refused `more than 2 Key Files` whatever the reviewer value, and it is not "beyond the express bounds" (defined against `EXPRESS_MAX_KEY_FILES`), so the default reviewer stays off for a 2-file record — Task 4 test `Review Focus 2: a limit below the express limit narrows`.
3. A driver line bound *below* `auto-merge-max-lines` with the reviewer on is passed as the flag (narrowing on purpose) — Task 5 test `Review Focus 3: a driver bound below the express bound narrows reviewer-on records`.
4. The worker prompt must state the bound `check` will enforce — the driver's bound when the flag is passed, else `auto-merge-max-lines` — Task 5 test `Review Focus 4: the worker prompt states the effective line bound`.
5. `--max-lines` spellings `5.0`, `-3`, `0`, `abc`, missing value: exit 2, nothing written — Task 2 test `AC4.2: a malformed --max-lines is a usage error`.

## Spec coverage (clauses proved by a verification step, not a test)

| AC clause | Proof |
|---|---|
| AC1.1 | Task 1 Step 4 and Task 2 Step 4 run the whole eligibility and cli test files with only appended tests (no existing test edited) |
| AC8.1 | Task 3 Step 4 (`tests/bin-lib/skill-audit/`) and Task 6 Step 3 (`wc -c` after merging `origin/main`) |
| AC8.2 | Task 3 Step 4 runs `tests/policy-schema.test.js`, `tests/policy-key-naming.test.js`, `tests/policy-schema-metadata.test.js`; the count pin goes 106 → 109 |
| AC9.1 | Task 6 Steps 1 and 2 |
| AC10.1 | Task 5 Step 3 (the "Lane bounds" subsection) and Task 6 Step 4 |

---

### Task 1: Eligibility bound options

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/eligibility.js:16-34` (constants), `:98-130` (`evaluateRecordEligibility`), `:178-180` (exports)
- Test: `tests/bin-lib/express/eligibility.test.js` (append only; no existing test edited — AC1.1)

**Interfaces:**
- Produces:
  - `SIZE_CEILINGS = Object.freeze({ low: Object.freeze(['low']), medium: Object.freeze(['low', 'medium']) })` — the accepted size labels per ceiling.
  - `BOUND_REASONS = Object.freeze({ size: (ceiling) => \`size is not ${SIZE_CEILINGS[ceiling].join(' or ')}\`, tooManyKeyFiles: (limit) => \`more than ${limit} Key Files\`, sizeCeilingUnreadable: (v) => \`size ceiling unreadable: ${String(v)}\`, keyFileLimitUnreadable: (v) => \`Key File limit unreadable: ${String(v)}\` })`. `BOUND_REASONS.size('low') === REASONS.size` and `BOUND_REASONS.tooManyKeyFiles(3) === REASONS.tooManyKeyFiles` by construction.
  - `evaluateRecordEligibility(issue, { ...existing, sizeCeiling?, maxKeyFiles? })` — same return shape. `sizeCeiling` undefined → today's `facets.size !== 'low'` → `REASONS.size`. Present and a key of `SIZE_CEILINGS` → refuse when the size label is not in `SIZE_CEILINGS[sizeCeiling]` with `BOUND_REASONS.size(sizeCeiling)`. Present but not a key (e.g. `'high'`, `null`) → `BOUND_REASONS.sizeCeilingUnreadable(v)` (fail closed). `maxKeyFiles` undefined → today's rule; a safe integer ≥ 1 → `keyFiles.length > maxKeyFiles` → `BOUND_REASONS.tooManyKeyFiles(maxKeyFiles)`; anything else → `BOUND_REASONS.keyFileLimitUnreadable(v)`. Each pushed at the same position in the reasons order as the rule it replaces.

- [ ] **Step 1: Write the failing tests** (append; names carry AC ids)

```js
test('AC3.3: size:high is refused under every ceiling, naming the ceiling', () => {
  for (const ceiling of ['low', 'medium']) {
    const out = evaluateRecordEligibility(record(['size:high', ...nonSize(ELIGIBLE_LABELS)], ['a.js']), { ...OPTS, sizeCeiling: ceiling });
    assert.ok(out.reasons.includes(BOUND_REASONS.size(ceiling)), ceiling);
  }
  assert.strictEqual(BOUND_REASONS.size('medium'), 'size is not low or medium');
});
test('AC3.4: more Key Files than the widened limit names that limit', () => { /* 6 Key Files, maxKeyFiles: 5 → reasons includes 'more than 5 Key Files'; 5 Key Files → not */ });
test('AC6.4: absent size label still refused with size is not low under the default', () => { /* no size:* label, sizeCeiling: 'low' and sizeCeiling omitted → both include 'size is not low' */ });
test('AC6.3: an empty Key File list is still refused with no Key Files', () => { /* maxKeyFiles: 5, zero Key Files → includes REASONS.noKeyFiles */ });
test('AC6.2: a malformed bound refuses, never accepts', () => { /* sizeCeiling 'high' | null | 'Medium', maxKeyFiles 0 | 2.5 | '4' | null → eligible false with the unreadable reason; an otherwise-eligible record */ });
test('defaults spelled explicitly give byte-identical verdicts to absent options', () => {
  // for each size in low/medium/high/absent × Key File count 0..5:
  // deepStrictEqual(evaluateRecordEligibility(r, OPTS), evaluateRecordEligibility(r, { ...OPTS, sizeCeiling: 'low', maxKeyFiles: 3 }))
});
```

`record`, `OPTS` and `ELIGIBLE_LABELS` are the file's existing helpers; `nonSize` filters out `size:*` labels (add it beside them if absent).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: FAIL after Step 1 — `BOUND_REASONS` is undefined.

- [ ] **Step 3: Implement** the two options and exports in `eligibility.js` per the Interfaces block. Extend the comment above `evaluateRecordEligibility` with one sentence: the two options exist for the pipeline driver lane (#5224; its admission is `../driver/admission.js`), and every express caller omits them.

- [ ] **Step 4: Run the whole file**

Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: PASS, every pre-existing test included (AC1.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/express/eligibility.js tests/bin-lib/express/eligibility.test.js
git commit -m "Add size-ceiling and Key File limit options to express eligibility — #5224"
```

### Task 2: `express-lane.js check --max-lines`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/express/cli.js` — header comment (`check` bullet), `USAGE` (`:55`), `VERB_FLAGS.check` (`:96`), `parseArgs` (`:123-125`), `runCheck` (`:333`)
- Test: `tests/bin-lib/express/cli.test.js` (append only — AC1.1)

**Interfaces:**
- Produces: `check … [--max-lines <n>]`. Parsed with the existing `positiveInt('--max-lines', v)` (so `5.0`, `-3`, `0`, `abc` throw `UsageError` → exit 2; a missing value is caught by `parseArgs`'s "requires a value"). In `runCheck`: `maxLines: flags['--max-lines'] !== undefined ? flags['--max-lines'] : config.autoMergeMaxLines`. Envelope shape unchanged.
- `USAGE`'s `check` line gets ` [--max-lines <n>]` appended **after** `[--repo owner/name]` (the existing `USAGE` line test matches by substring, so the old line must stay a prefix), plus one new line: `'       --max-lines: the pipeline driver's implementation-line bound (bin/drive.js); absent, check applies auto-merge-max-lines'`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC4.1: check with --max-lines evaluates the diff bounds with that maxLines', () => {
  // a diff of 60 implementation lines on a Key File; auto-merge-max-lines resolves 40
  // without the flag → action 'escalate', reason 'out-of-bounds'; with --max-lines 80 → action 'proceed'
});
test('AC4.2: a malformed --max-lines is a usage error', () => {
  for (const v of ['5.0', '-3', '0', 'abc']) { /* run([... 'check', ..., '--max-lines', v]) === 2; no decisions.md write; stderr names --max-lines */ }
  /* '--max-lines' as the last argument → 2 ("requires a value") */
});
test('AC4.1: the USAGE check line names --max-lines as the driver flag', () => {
  assert.ok(USAGE.includes('[--repo owner/name] [--max-lines <n>]'));
  assert.match(USAGE, /--max-lines: the pipeline driver's implementation-line bound/);
});
```

Build the 60-line diff with the file's existing `check` fixtures (its git fake for `gatherDiffFiles` and its blast-radius config fake).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/express/cli.test.js`
Expected: FAIL after Step 1 — `unknown argument for check: --max-lines`.

- [ ] **Step 3: Implement** per the Interfaces block; the header's `check` bullet gains one clause: "`--max-lines` (the driver's flag) replaces `auto-merge-max-lines` as the line bound".

- [ ] **Step 4: Run the whole file**

Run: `node --test tests/bin-lib/express/cli.test.js`
Expected: PASS, every pre-existing test included (AC1.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/express/cli.js tests/bin-lib/express/cli.test.js
git commit -m "Add the driver's --max-lines flag to express-lane.js check — #5224"
```

### Task 3: Three policy keys

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:91-96` (rows after `express-driver-review`, with a `// #5224:` comment line), `:577-601` (a `deriveExpressDriverMaxLines(sources)` beside `deriveHousekeepingAutoMerge`), `:699-700` (its wiring in `resolvePolicyKeys`)
- Modify: `plugin/skills/_shared/policy-schema.md:105` (three rows after `express-driver-review`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:101` (`policyOnly` bullet)
- Modify: `docs/journeys/resolve-a-policy-key.md:44` (Red flags list: `express-driver-max-size`, `express-driver-max-key-files`, `express-driver-max-lines`, #5224)
- Test: `tests/policy-schema.test.js` (count pin `:150-153`, new tests after `:1060`)

**Interfaces:**
- Produces (rows):
  - `{ key: 'express-driver-max-size', type: 'enum', values: ['low', 'medium'], default: 'low', policyOnly: true, summary: …, category: 'merge-safety', tier: 'advanced' }`
  - `{ key: 'express-driver-max-key-files', type: 'integer', min: 1, default: 3, policyOnly: true, … }`
  - `{ key: 'express-driver-max-lines', type: 'integer', min: 1, default: 40, policyOnly: true, … }` — Shape B (Global Constraints' derived-default note): a comment above the row names the derivation.
  - `deriveExpressDriverMaxLines(sources) -> number`: the `auto-merge-max-lines` value the main loop would resolve from `sources` — first source holding the key wins, an invalid value resolves that key's schema default (40) and never the next source's value, exactly as `deriveHousekeepingAutoMerge` reads `autonomy`. Wired in `resolvePolicyKeys` beside the `housekeeping-auto-merge` branch: `if (canonical === 'express-driver-max-lines' && resolved.source === 'default') resolved = { ...resolved, value: deriveExpressDriverMaxLines(sources) };`. The policyOnly skip of the `--run` overlay applies to `express-driver-max-lines` itself only; the derivation reads `auto-merge-max-lines` through every source, as `check` does.
  - Summaries ≤ 140 chars, plain-language, not copied into the doc rows.
- Doc rows (owner column `bin/drive.js` (#5224)): state unset / set / malformed results from the resolver, `policyOnly` and why ("it bounds what autonomous machinery may take on, so a `--run` config never widens it"), that a record beyond the express bounds is admitted only with the reviewer step on, and for `express-driver-max-lines` that it is a Shape B derived default: unset or malformed (`invalid: true`) resolves the effective `auto-merge-max-lines` value with `source: default`, the driver then passes no `--max-lines`, and `check` applies `auto-merge-max-lines`; the driver's bound applies only when the key is set and the reviewer is on for the record.

- [ ] **Step 1: Write the failing tests**

```js
// count pin comment: 106 -> 109, #5224: express-driver-max-size — enum low|medium, default low; express-driver-max-key-files — integer >= 1, default 3; express-driver-max-lines — integer >= 1, Shape B (base 40, derives auto-merge-max-lines while source is default); all policyOnly
assert.strictEqual(POLICY_KEYS.length, 109);  // and the Set-size line
test('AC5.1: the size and Key File keys resolve the express values unset', () => {
  const r = resolvePolicyKeys(['express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-lines'], { policyRaw: '', runConfigRaw: null });
  assert.deepStrictEqual(r['express-driver-max-size'], { value: 'low', source: 'default' });
  assert.deepStrictEqual(r['express-driver-max-key-files'], { value: 3, source: 'default' });
  assert.deepStrictEqual(r['express-driver-max-lines'], { value: 40, source: 'default' });
});
test('AC5.5: express-driver-max-lines unset derives whatever auto-merge-max-lines holds', () => {
  // policyRaw 'auto-merge-max-lines: 77\n' → { value: 77, source: 'default' }
  // policyRaw 'auto-merge-max-lines: x\n' (invalid there) → { value: 40, source: 'default' }  (its own invalid-value fallback)
  // runConfigRaw 'auto-merge-max-lines: 55\n' → { value: 55, source: 'default' }  (the overlay reaches the derivation, as it reaches check)
  // policyRaw 'express-driver-max-lines: 0\nauto-merge-max-lines: 77\n' → { value: 77, source: 'default', invalid: true }
});
test('AC5.2: the Key File default equals EXPRESS_MAX_KEY_FILES', () => { /* require express/eligibility; strictEqual(row.default, EXPRESS_MAX_KEY_FILES) */ });
test('AC5.3: malformed values never widen', () => {
  // max-size: high | Medium | med → { value: 'low', source: 'default', invalid: true }
  // max-key-files: 0 | 2.5 | x → { value: 3, source: 'default', invalid: true }
  // max-lines: 0 | -1 | x → { value: 40, source: 'default', invalid: true }  (40 derived from an unset auto-merge-max-lines)
});
test('AC5.4: set values resolve from policy', () => { /* medium; 5; 120 → source 'policy' */ });
// AC7.1–AC7.3: one test per key — add rows to the existing #5216 policyOnly table (`:1012-1018`):
//   { id: 'AC7.1', key: 'express-driver-max-size', def: 'low', other: 'medium', policyVal: 'medium' }  (use a run value distinct from policyVal where the table's shape needs one)
//   { id: 'AC7.2', key: 'express-driver-max-key-files', def: 3, other: 9, policyVal: 5 }
//   { id: 'AC7.3', key: 'express-driver-max-lines', def: 40, other: 999, policyVal: 120 }
```

Read the existing table's loop before adding rows, so each new row fits its assertion shape.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/policy-schema.test.js`
Expected: FAIL after Step 1 — length 106 !== 109.

- [ ] **Step 3: Implement** the rows, the three doc rows, the coverage bullet (append the three names before "are `policyOnly`") and the journey Red flags entry. Then measure: `wc -c plugin/skills/_shared/policy-schema.md` must print < 52500.

- [ ] **Step 4: Run the policy suites**

Run: `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS (AC8.2, AC8.3).

Run: `node --test tests/bin-lib/skill-audit/`
Expected: PASS (AC8.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-coverage.md docs/journeys/resolve-a-policy-key.md tests/policy-schema.test.js
git commit -m "Register the driver lane bound policy keys — #5224"
```

### Task 4: Admission's reviewer rule

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/admission.js` (header comment, `ADMISSION_REASONS`, `evaluateAdmission`)
- Test: `tests/bin-lib/driver/admission.test.js`

**Interfaces:**
- Consumes: `SIZE_CEILINGS`, `EXPRESS_MAX_KEY_FILES` from `../express/eligibility` (Task 1); `reviewRequired` from `./review` (tests only).
- Produces:
  - `evaluateAdmission({ ...existing, keyFiles, bounds: { sizeCeiling, maxKeyFiles }, reviewerOn })`.
  - New `ADMISSION_REASONS` keys: `reviewerOff: 'record is beyond the express bounds and the reviewer step is off for it'`, `reviewerUnreadable: 'reviewer-on answer unreadable'`, `boundsUnreadable: 'lane bounds unreadable'`, `keyFilesUnreadable: 'record Key Files unreadable'`.
  - The rule (appended after the routing gate; every gate still runs): `reviewerOn` not a boolean → `reviewerUnreadable`. `bounds` not an object, `sizeCeiling` not a key of `SIZE_CEILINGS`, or `maxKeyFiles` not a safe integer ≥ 1 → `boundsUnreadable`. `keyFiles` not an array → `keyFilesUnreadable`. When labels, bounds and keyFiles are all readable: `beyond = size !== 'low' || keyFiles.length > EXPRESS_MAX_KEY_FILES`; `inside = SIZE_CEILINGS[sizeCeiling].includes(size) && keyFiles.length <= maxKeyFiles`; `beyond && inside && reviewerOn === false` → `reviewerOff`. `beyond && !inside` adds nothing (eligibility owns that refusal). `size` comes from `parseRecordFacets(labels).size`.
  - `reviewerGateReason({ labels, keyFiles, bounds, reviewerOn }) -> string | null` (exported; `evaluateAdmission` calls it for its reviewer reason): `ADMISSION_REASONS.reviewerOff` exactly when labels are an array, `keyFiles` an array, `bounds` readable, and `beyond && inside && reviewerOn === false`; `null` in every other case (the unreadable reasons stay `evaluateAdmission`'s). Task 5's eligibility step calls it on an eligibility refusal (the Plan Review Clarification, Reading A).
  - Header comment: add the closed rule's three states (beyond + reviewer on → admitted by this rule; beyond + reviewer not on → `reviewerOff`; inside → rule does not apply) and that any unreadable input refuses with its own reason.

- [ ] **Step 1: Write the failing tests**

Extend `ADMIT` with `keyFiles: ['a.js'], bounds: { sizeCeiling: 'low', maxKeyFiles: 3 }, reviewerOn: false` (it already has `size` absent from its labels — add `'size:low'` to its labels so the base record is inside the express bounds). Extend `AC3.7`'s key list and value asserts with the four new keys.

```js
// laneVerdict mirrors steps.js's composition: eligibility (stops the record) then admission.
// issue built like eligibility.test.js's record() helper (copy it here: Key Files section, risk:low, type:feature, shaped body).
function laneVerdict(issue, { sizeCeiling = 'low', maxKeyFiles = 3, review = 'beyond-express' } = {}) {
  const el = evaluateRecordEligibility(issue, { enabled: true, allowAbsentCeremony: true, integrationModel: 'pr-first', sensitivePaths: [], sizeCeiling, maxKeyFiles });
  const reviewer = reviewRequired({ issue, keyFiles: el.keyFiles, policyValue: review });
  const facts = { labels: issue.labels, keyFiles: el.keyFiles, bounds: { sizeCeiling, maxKeyFiles }, reviewerOn: reviewer.on };
  if (!el.eligible) {
    const extra = reviewerGateReason(facts);
    return { admitted: false, reasons: extra ? [...el.reasons, extra] : el.reasons };
  }
  return evaluateAdmission({ ...ADMIT, ...facts });
}
test('AC2.1/AC2.2: with every key unset the lane verdict equals today\'s rules (hand-written table)', () => {
  // EXPECTED: a literal 4 × 6 table keyed `${size}|${count}` (size ∈ low, medium, high, absent; count 0..5),
  // written by hand from today's rules: low|1..3 → []; low|0 → ['no Key Files']; low|4,5 → ['more than 3 Key Files'];
  // medium|high|absent with count c → ['size is not low'] plus the same Key File reason as low|c.
  // For each review value in off, beyond-express, on: deepStrictEqual(laneVerdict(issue, { review }).reasons, EXPECTED[key]).
});
test('AC3.1: widened, size:medium with 4 Key Files is admitted with the reviewer on or default, refused with it off', () => {
  // sizeCeiling medium, maxKeyFiles 5: review on → admitted; beyond-express → admitted; off → reasons deepStrictEqual [R.reviewerOff]
});
test('AC3.2: widened, size:low with 4 Key Files takes the same two outcomes', () => { /* same three review values */ });
test('AC3.5: a record inside the express bounds is admitted the same with the reviewer on or off', () => { /* size:low, 2 Key Files, widened policy, review on/off/beyond-express → admitted */ });
test('AC3.6/AC3.7: failing an eligibility bound and the reviewer condition reports eligibility reasons only, outside the driver bounds', () => {
  // size:medium, 6 Key Files, maxKeyFiles 5, sizeCeiling medium, review off → reasons deepStrictEqual ['more than 5 Key Files'] (no reviewerOff)
});
test('AC3.6 (Plan Review Clarification): inside the driver bounds, another eligibility failure is followed by the reviewer reason', () => {
  // risk:medium, size:medium, 4 Key Files, sizeCeiling medium, maxKeyFiles 5:
  //   review off → reasons deepStrictEqual ['risk is not low', R.reviewerOff]
  //   review on and beyond-express → reasons deepStrictEqual ['risk is not low']
  // risk:medium, size:low, 2 Key Files (inside the express bounds), review off → ['risk is not low']
});
test('reviewerGateReason returns null on unreadable input', () => {
  // labels null; keyFiles null; bounds { sizeCeiling: 'high', maxKeyFiles: 3 }; reviewerOn 'false' → null each
});
test('AC6.2: a missing or non-boolean reviewer-on answer refuses', () => {
  for (const v of [undefined, null, 'true', 1, {}]) assert.ok(reasonsFor({ reviewerOn: v }).includes(R.reviewerUnreadable));
});
test('AC6.2: missing or malformed bounds refuse', () => {
  for (const b of [undefined, null, {}, { sizeCeiling: 'high', maxKeyFiles: 3 }, { sizeCeiling: 'low', maxKeyFiles: 0 }, { sizeCeiling: 'low', maxKeyFiles: '3' }]) assert.ok(reasonsFor({ bounds: b }).includes(R.boundsUnreadable));
  assert.ok(reasonsFor({ keyFiles: null }).includes(R.keyFilesUnreadable));
});
test('Review Focus 2: a limit below the express limit narrows', () => {
  // maxKeyFiles 2: size:low with 3 Key Files → laneVerdict reasons ['more than 2 Key Files'] for every review value;
  // size:low with 2 Key Files, review beyond-express → admitted (not beyond the express bounds)
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/driver/admission.test.js`
Expected: FAIL after Step 1 — `R.reviewerOff` undefined / `reviewerGateReason` is not a function / AC3.7 key list mismatch.

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Run**

Run: `node --test tests/bin-lib/driver/admission.test.js tests/bin-lib/express/eligibility.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/admission.js tests/bin-lib/driver/admission.test.js
git commit -m "Require the reviewer for driver records beyond the express bounds — #5224"
```

### Task 5: Driver wiring — one reviewer answer, the bounds, the flag

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` — `POLICY_KEYS` (`:98-104`), `eligibilityStep` (`:215-228`), `admissionStep` (`:233-268`), `runImplementer` (`:555-561`), `checkStep` (`:811-819`)
- Modify: `plugin/bin/lib/driver/run.js` — `newCtx` (`reviewer: null`), `realDeps` (`reviewRequired: (opts) => require('./review').reviewRequired(opts)`)
- Modify: `plugin/bin/lib/driver/review.js` — `reviewRecord` (`:1153`) and the "On or off" header paragraph (`:75-77`)
- Modify: `docs/driver.md` — `express-driver-review` table's `beyond-express` row (`:75`), a new "Lane bounds" subsection after the reviewer-step table
- Modify: `docs/plugin-structure.md` — the `plugin/bin/lib/express/` entry (`:71`: eligibility's two driver options, `check --max-lines`) and the `plugin/bin/lib/driver/` entry (`:77`: admission's reviewer rule and its new facts)
- Test: `tests/bin-lib/driver/run.test.js`
- Test: `tests/bin-lib/driver/review.test.js` (its one `reviewRecord` ctx at `:925` gains `reviewer: { on: true, reason: 'test' }`)
- Test: `tests/bin-lib/driver/run.test.js:4133` and `:4141` — the two direct `reviewRecord` calls (missing wiring member) — their ctx gains `reviewer: { on: true, reason: 'test' }` so they still reach the `the review pass failed before it started` path; `:819` (`assert.deepEqual(reads[0].args, Object.keys(POLICY))`) stays as written and passes because `POLICY` gains all three keys in `POLICY_KEYS` order

**Interfaces:**
- Consumes: Task 1's options, Task 2's `--max-lines`, Task 3's keys, Task 4's admission facts.
- Produces:
  - `POLICY_KEYS` gains `'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-lines'` (so the policy step's unreadable check covers them — AC6.1).
  - `eligibilityStep` passes `sizeCeiling: policy['express-driver-max-size'].value, maxKeyFiles: policy['express-driver-max-key-files'].value`, then — right after `ctx.keyFiles` is set, before deciding the verdict — makes the **one** reviewer call of the record: `ctx.reviewer = deps.reviewRequired({ issue: ctx.issue, keyFiles: ctx.keyFiles, policyValue: policy['express-driver-review'].value })`. On a refusal (Plan Review Clarification, Reading A) its stop detail is the eligibility reasons followed by `reviewerGateReason({ labels: ctx.issue.labels, keyFiles: ctx.keyFiles, bounds, reviewerOn: ctx.reviewer && ctx.reviewer.on })` when that returns a reason, joined with `; ` as today.
  - `admissionStep` makes no reviewer call: admission gets `keyFiles: ctx.keyFiles, bounds: { sizeCeiling, maxKeyFiles }` (the same two values eligibility got) and `reviewerOn: ctx.reviewer ? ctx.reviewer.on : undefined` (a non-boolean passes through so admission refuses).
  - `driverLineBound(ctx) -> number | null` (module-private in `steps.js`): the `express-driver-max-lines` value when its envelope's `source !== 'default'` and `ctx.reviewer && ctx.reviewer.on === true`, else `null`.
  - `checkStep` appends `'--max-lines', String(bound)` to the `check` argv only when `driverLineBound(ctx) !== null`.
  - `runImplementer`'s stated `maxLines` = `driverLineBound(ctx) ?? Number(shared.policy['auto-merge-max-lines'].value)` (the existing finite check stays on the `auto-merge-max-lines` branch).
  - `reviewRecord`: `const need = ctx.reviewer;` — when `need` is not an object with a boolean `on`, return `{ status: 'fail', stopClass: STOP_CLASSES.PRE_PUSH, detail: 'reviewer-on answer missing', extra: <the seven-key null extra the pre-pass catch already uses> }`; otherwise the existing `if (!need.on) return { status: 'ok', skip: true };`. `reviewRequired` stays exported and unchanged.

- [ ] **Step 1: Update the harness, then write the failing tests**

Harness: append the three keys to `POLICY`, after `'express-driver-review'` and in the order `POLICY_KEYS` lists them (`'express-driver-max-size': 'low'`, `'express-driver-max-key-files': 3`, `'express-driver-max-lines': undefined`), and make the policy reply at `:455` return `{ value: policy['auto-merge-max-lines'], source: 'default' }` for `express-driver-max-lines` when `policy[k]` is `undefined` (the Shape B envelope; every other key keeps `{ value: policy[k], source: 'policy' }`). The AC4.8, AC11.1, AC11.2 and AC3.6 run tests script the `eligibility` and `admission` replies to call the real `evaluateRecordEligibility` and `evaluateAdmission` with the options and facts the step passes, over an issue whose body lists the Key Files the row names (shape it like `tests/bin-lib/express/eligibility.test.js`'s `record()` helper); the default fakes return `eligible: true` / `admitted: true` and can never refuse. Add a `reviewRequired` dep that records its call and by default returns the real `reviewRequired(opts)`. Add the default-script reply if the harness routes it through `dispatch`.

```js
test('AC12.1: one reviewRequired call per record feeds admission and the check flag', async () => {
  // reviewRequired scripted to return a sentinel { on: true, reason: 'sentinel' }; policy express-driver-max-lines: 90 (source policy)
  // assert: reviewRequired called exactly once; the admission input's reviewerOn === true; check argv includes ['--max-lines', '90']
  // then sentinel { on: false, … } (record inside the express bounds) → check argv has no --max-lines
});
test('AC4.3/AC4.4: the flag is passed only when the key is set and the reviewer is on', async () => {
  // rows: (unset, review on) → no flag; (invalid, on) → no flag;
  // (120 policy, review off, size:low record) → no flag; (120 policy, review on) → ['--max-lines', '120']
  // the invalid row's envelope is { value: 200, source: 'default', invalid: true } (Shape B: derived from auto-merge-max-lines)
});
test('AC4.5: a record inside the express bounds with the reviewer always on gets the driver bound', async () => { /* size:low, 1 Key File, review on, max-lines 120 → flag present */ });
test('AC4.6/AC4.7: a diff between the express and driver bounds passes check with the reviewer on and escalates with it off', async () => {
  // check reply scripted on argv: includes '--max-lines' → proceed; else → escalate out-of-bounds.
  // reviewer on (review 'on', max-lines 120) → final outcome not express-escalated, the recorded check argv carries the flag;
  // reviewer off (review 'off') → stop at check, reason 'out-of-bounds', argv has no flag
});
test('AC4.8/AC11.1: a widened record goes through review before push', async () => {
  // policy max-size medium, max-key-files 5, review beyond-express; issue size:medium with 4 Key Files; reviewer envelope with no findings
  // assert the step order includes 'check', 'review', 'push' with review's index < push's index
});
test('AC11.2: with the reviewer off a widened record is refused at admission and nothing reaches check', async () => {
  // same record, review off → final stop.step 'admission', class refused, detail includes ADMISSION_REASONS.reviewerOff; zero check calls
});
test('AC3.6 (Plan Review Clarification): the eligibility stop names the reviewer reason after eligibility\'s own', async () => {
  // real eligibility + admission; risk:medium, size:medium, 4 Key Files, max-size medium, max-key-files 5, review off
  // → final stop.step 'eligibility', class refused, detail === 'risk is not low; ' + ADMISSION_REASONS.reviewerOff; reviewRequired called once
});
test('AC5.5: with express-driver-max-lines unset the lane bound is auto-merge-max-lines, whatever it holds', async () => {
  // POLICY auto-merge-max-lines: 77, max-lines unset, review on → no --max-lines in check argv; the worker prompt states 77
});
test('AC6.1: an unreadable bound key stops the driver before any record', async () => {
  // resolvePolicy omits 'express-driver-max-size' → policy step fail, shared.fatal, no fetch call (follow the existing #5218 unreadable-policy test's shape)
});
test('Review Focus 3: a driver bound below the express bound narrows reviewer-on records', async () => { /* auto-merge-max-lines 200, max-lines 20, review on → ['--max-lines', '20'] */ });
test('Review Focus 4: the worker prompt states the effective line bound', async () => { /* flag passed → prompt names the driver bound, not 200; flag absent → names 200 */ });
test('the eligibility step passes the size ceiling and Key File limit it read', async () => { /* eligibility dispatch records opts; sizeCeiling 'medium', maxKeyFiles 5 from policy */ });
```

In `review.test.js`, add one test: `reviewRecord with no ctx.reviewer fails closed and launches no worker`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js`
Expected: FAIL after Step 1 — no `reviewRequired` call recorded / no `--max-lines` in argv.

- [ ] **Step 3: Implement** per the Interfaces block. `docs/driver.md`: the `beyond-express` row's last sentence becomes "…so under this default and the default lane bounds the step does not run in a real run today; widening the lane bounds (below) or `on` is how it runs." The new "Lane bounds" subsection is a three-row table (`express-driver-max-size` `low`, `express-driver-max-key-files` `3`, `express-driver-max-lines` unset = `auto-merge-max-lines`), then: a record beyond the express bounds (size not `low`, or more than `EXPRESS_MAX_KEY_FILES` Key Files) is admitted only when the reviewer step is on for it (`record is beyond the express bounds and the reviewer step is off for it`); the driver passes `check --max-lines` only when `express-driver-max-lines` is set and the reviewer is on for the record; the widened values are chosen by editing `policy.yml`, not by this change; all three are `policy.yml` only.

- [ ] **Step 4: Run**

Run: `node --test tests/bin-lib/driver/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/run.js plugin/bin/lib/driver/review.js docs/driver.md docs/plugin-structure.md tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js
git commit -m "Wire the driver lane bounds and one reviewer answer through admission and check — #5224"
```

### Task 6: Final checks

**Role:** transcription

**Files:** none — check-only. A check that fails stops this task and returns to the controller, which sends the fix to the task that owns the file (Task 3 for the rail: the spec Gotcha's pointer-stub section move, per `.claude/skills/policy-key-addition` site 4).

- [ ] **Step 1:** `git diff --name-only origin/main...HEAD -- plugin/skills/` prints only `plugin/skills/_shared/policy-schema-coverage.md` and `plugin/skills/_shared/policy-schema.md` (AC9.1, AC9.2).
- [ ] **Step 2:** `git diff --stat origin/main...HEAD -- plugin/skills/_shared/express-lane.md` prints nothing (AC9.1).
- [ ] **Step 3:** after merging `origin/main`, `wc -c plugin/skills/_shared/policy-schema.md` prints < 52500 (AC8.1).
- [ ] **Step 4:** `grep -n "express-driver-max-" docs/driver.md` lists all three keys with their defaults and the "editing `policy.yml`" sentence (AC10.1).
- [ ] **Step 5:** `git diff --stat origin/main...HEAD -- plugin/bin/lib/express/queue.js` prints nothing, and `grep -n -E "sizeCeiling|maxKeyFiles" plugin/bin/lib/express/queue.js plugin/bin/lib/express/cli.js` prints nothing: both express callers of `evaluateRecordEligibility` still pass no bound option (Check B consumer).

**Scope exclusions (Check B):** `docs/superpowers/plans/2026-11-12-drive-js.md`, `2026-11-12-driver-lane-admission.md`, `2026-11-13-driver-reviewer-step.md`, `2026-11-13-driver-standalone-settle.md` and `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md` match the scope keywords but are the archived plans of shipped prerequisite units and the program's design doc — historical records, not edited by this unit.
