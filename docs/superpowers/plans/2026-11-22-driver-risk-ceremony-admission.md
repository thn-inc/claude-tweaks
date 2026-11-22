# Driver Risk and Ceremony Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the pipeline driver admit records above `risk:low` (up to a policy ceiling) and, with `express-driver-review: on`, records with a non-fast-lane ceremony label, only with the reviewer on, and stop every such record at `pending-review` before any judgment worker launches.

**Architecture:** Extend #5224's pattern. `eligibility.js` gains a driver-only risk ceiling option, a driver-only any-ceremony option and one pure `widenings()` helper. `steps.js` computes `ctx.widenedBy` once in the eligibility step and hands it to `reviewRequired` (review.js), `evaluateAdmission` (admission.js), the `--check` verdict line (run.js) and the merge context. `merge.js` `entry()` recomputes the label-derived widenings from the live labels, unions them with `ctx.widenedBy`, and stops at `pending-review` (`widened-admission`) when the union is non-empty or `ctx.widenedBy` is not an array.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T105528-record-6018/work/6018-spec.md` (record #6018)

Scope keywords: express-driver-review, evaluateRecordEligibility, evaluateAdmission, reviewRequired, eligibilityOptions, widenedBy

## Global Constraints

- New policy key `express-driver-max-risk`: `{ key: 'express-driver-max-risk', type: 'enum', values: ['low', 'medium', 'high'], default: 'low', policyOnly: true, category: 'merge-safety', tier: 'advanced' }`. Every default reproduces today.
- `REASONS` in `eligibility.js` is a wire contract: never change the strings of `REASONS.risk` (`'risk is not low'`) or `REASONS.ceremony` (`'ceremony is not fast-lane'`).
- The express lane (`bin/express-lane.js`, `/flow`'s express path) must not change: every new option is passed only by the driver and absent means today's rule.
- `.claude-tweaks/policy.yml` must not change.
- `#5224`'s size widening keeps today's merge path; only `risk` and `ceremony` widenings force `pending-review`.
- Commits: `{Verb} {what} — {detail}` subjects, `refs #6018` in the body, never `closes`/`fixes`.
- Governing skill `.claude/skills/policy-key-addition` (applies to `policy-schema.js`, `policy-schema.md`), quoted:
  - "`key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived … `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)."
  - "The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
  - "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin."
  - "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s "Canonical read path carve-outs", which lists every key carrying the flag"
  - "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record."
  - "Say the decision in the comment above the row, as both of those do." (the who-may-set-it decision)
  - "**A key joining a family reaches only the callers that list it.** … Grep every reader of a sibling key, in `plugin/bin/` and in the `node -e` fences under `plugin/skills/`." — the only reader of the `express-driver-max-*` family is `steps.js` `POLICY_KEYS`/`laneBounds`/`eligibilityOptions` (git grep, this plan's authoring).
- Governing skill `.claude/skills/driver-step-addition` (applies to `steps.js`, `run.js`): "Needed only for a new durable side effect. Initialize its flag in `newCtx`" — `ctx.widenedBy` is not a side effect, but it starts as `null` in `newCtx` like `eligibilityReasons`, so `merge.js` fails closed on a ctx the eligibility step never filled. "Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one."
- `plugin/skills/_shared/policy-schema.md` is 51,733 B (after merging origin/main at fe1c307e8d) against `RAIL_BYTES` 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`); Task 1 moves seven rows out (about 3.6 KB) before adding anything, per IL-70, following `policy-schema-model-profiles.md`'s split shape.

Waived .claude-tweaks/policy.yml: the spec forbids changing it here (Gotchas); no task writes it, and the trial sub-issue (#6021) is the first to set the key.

## Review Focus

1. A record whose labels change between admission and merge (risk raised to `medium`, `ceremony:standard` added) must not take the merge path: Task 5 recomputes from live labels (AC9.1 covers `risk`; Task 5 adds a `ceremony:standard` live-label case).
2. A resumed or separately invoked merge with no `ctx.widenedBy` must stop, not merge: Task 5's unset and non-array cases.
3. An `express-driver-max-risk` typo (`Medium`, `critical`) must never widen: the resolver turns it into `low` with `invalid: true` (Task 1 test) and the driver passes only `.value`, so `--check` refuses a `risk:medium` record with the same reasons as the key unset (Task 4 AC10 test) — the spec Decision (Reading A, 2026-11-22). A non-enum value passed straight to `evaluateRecordEligibility` (a programming error, not a policy value) refuses with its own reason (Task 2 test).
4. A record that is both size-widened (#5224) and risk-widened takes the `pending-review` stop: Task 5's union does not consult size; Task 4 adds a `size:medium` + `risk:medium` `--check` case showing `widenedBy: ['risk']`.
5. Two ceremony labels, one unrecognised (`ceremony:standard` plus `ceremony:fastlane`), must refuse under the relaxation: Task 2 test.

---

### Task 1: The `express-driver-max-risk` key and the express-driver prose split

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new row after `express-driver-max-lines`, line 119)
- Modify: `plugin/skills/_shared/policy-schema.md` (remove the seven `express-driver*` rows at lines 91-97; add a stub section)
- Create: `plugin/skills/_shared/policy-schema-express-driver.md`
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:102` (policyOnly bullet)
- Modify: `docs/journeys/resolve-a-policy-key.md:47` (step 3 Red flags) and its history list
- Modify: `plugin/skills/dispatch/configuration.md:14` ("Canonical row" pointer)
- Modify: `plugin/bin/lib/driver/admission.js:79` (comment citing "the `express-driver` row of _shared/policy-schema.md" → the new file)
- Test: `tests/policy-schema.test.js` (count pin at line 46-47; policyOnly table at lines 914-920; new resolve tests)

**Interfaces:**
- Produces: `POLICY_KEYS` row `express-driver-max-risk`; `resolvePolicyKeys(['express-driver-max-risk'], …)` returns `{ value: 'low', source: 'default' }` unset, `{ value: v, source: 'policy' }` for `low|medium|high`, `{ value: 'low', source: 'default', invalid: true }` for anything else.

- [ ] **Step 1: Write the failing tests** in `tests/policy-schema.test.js`
  - Change the pin to `// Last bump: 118 -> 119, #6018` / `assert.strictEqual(POLICY_KEYS.length, 119);` (main is at 118 after #5996).
  - Add `{ id: 'AC8 (#6018)', key: 'express-driver-max-risk', def: 'low', other: 'high', policyVal: 'medium' }` to the policyOnly table at lines 914-920.
  - `test('AC8.1, AC8.2 (#6018): express-driver-max-risk resolves low unset, each enum value from policy, and a malformed value to low with invalid', …)`: assert `resolvePolicyKeys(['express-driver-max-risk'], { policyRaw: '', runConfigRaw: null })['express-driver-max-risk']` deep-equals `{ value: 'low', source: 'default' }`; for each of `low`, `medium`, `high` the `policyRaw: 'express-driver-max-risk: {v}\n'` reply is `{ value: v, source: 'policy' }`; for each of `Medium`, `critical`, `2` it is `{ value: 'low', source: 'default', invalid: true }`.
  - Same test: `fs.statSync(policy-schema.md).size < 52500`, and `policy-schema-express-driver.md` contains a row starting `` | `express-driver-max-risk` | ``.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/policy-schema.test.js`
Expected: FAIL after Step 1 (count 118 ≠ 119, and the new key is unknown to the resolver)

- [ ] **Step 3: Add the row and move the prose**
  - `policy-schema.js`: the row from Global Constraints, `summary` written fresh (not containing the key name, not copied into any `.md`), with a comment above it stating the decision: `policyOnly` because it bounds what autonomous machinery may take on, so a `--run` config never widens it (#6018).
  - Create `policy-schema-express-driver.md` with a first-line `<!-- Sibling of `_shared/policy-schema.md` — … split out per IL-70 … -->` comment (as `policy-schema-model-profiles.md` line 1), a `## Express driver` heading, the same five-column header as the merge-safety table (`| Key | Canonical home | Owner skill(s) | Default | Meaning |`), the seven moved rows verbatim, then a new `express-driver-max-risk` row: canonical home `policy.yml`, owner `bin/drive.js` (#6018), default `low`; meaning: the highest risk label the driver admits, `low`, `medium` or `high`; unset or malformed (`invalid: true`, e.g. `Medium`, `critical`) gives `low`; `policyOnly`, for the same reason as its siblings; a record admitted above `risk:low` is admitted only with the reviewer step on and always stops at `pending-review` for a human merge.
  - `policy-schema.md`: delete the seven rows; after the table that held them, add `## Express driver` with one sentence pointing at `policy-schema-express-driver.md` (split out per IL-70 for Read-rail headroom) and a one-column `| Key |` stub table listing all eight keys (the `## Model profiles` stub at lines 174-187 is the shape).
  - Add `express-driver-max-risk` (#6018) to the policyOnly list in `policy-schema-coverage.md:102` and to the Red flags list in `docs/journeys/resolve-a-policy-key.md:47`, plus a history bullet there (`- Step 3 updated during build of #6018 (express-driver-max-risk) — the key is policyOnly, so step 3's red flag lists it`).
  - Repoint `admission.js:79`'s comment and `plugin/skills/dispatch/configuration.md:14`'s "Canonical row" to `_shared/policy-schema-express-driver.md`.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/policy.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Add the express-driver-max-risk policy key — split the express-driver rows out of policy-schema.md`

### Task 2: Eligibility risk ceiling, ceremony relaxation and `widenings()`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/eligibility.js`
- Test: `tests/bin-lib/express/eligibility.test.js`
- Read (no change): `plugin/bin/lib/express/cli.js` — express-lane caller of `evaluateRecordEligibility`; passes no driver option, so AC1.2 pins it unchanged
- Read (no change): `plugin/bin/lib/express/queue.js` — its express half passes no driver option (AC1.2); its driver half is Task 8

**Interfaces:**
- Produces (exported from `eligibility.js`):
  - `RISK_CEILINGS = Object.freeze({ low: ['low'], medium: ['low', 'medium'], high: ['low', 'medium', 'high'] })` (inner arrays frozen)
  - `isReadableRiskCeiling(v) -> boolean` (an own key of `RISK_CEILINGS`)
  - `BOUND_REASONS.risk(ceiling) -> string`: readable → `` `risk is not ${RISK_CEILINGS[ceiling].join(' or ')}` `` (so `risk('low') === 'risk is not low'`, `risk('medium') === 'risk is not low or medium'`); unreadable → `BOUND_REASONS.riskCeilingUnreadable(ceiling)`
  - `BOUND_REASONS.riskCeilingUnreadable(v) -> 'risk ceiling unreadable: ' + String(v)`
  - `REASONS.risk` is now built as `BOUND_REASONS.risk('low')` (string unchanged)
  - `evaluateRecordEligibility(issue, { …existing, riskCeiling, allowAnyCeremony })`
  - `widenings({ labels, riskCeiling, anyCeremony }) -> Array<'risk'|'ceremony'>`, pure, order `['risk', 'ceremony']`

- [ ] **Step 1: Write the failing tests** (`DRIVER` is the file's existing `{ ...OPTS, allowAbsentCeremony: true }`)
  - `test('AC1.1 (#6018): riskCeiling low gives byte-identical verdicts to an absent option over risk × ceremony', …)`: for risk in `['risk:low', 'risk:medium', 'risk:high', null]` × ceremony in `['ceremony:fast-lane', 'ceremony:standard', null, 'ceremony:fastlane']` (built from `ELIGIBLE_LABELS` minus its risk/ceremony labels), `evaluateRecordEligibility(r, { ...DRIVER, riskCeiling: 'low' })` deep-equals `evaluateRecordEligibility(r, DRIVER)`, and `evaluateRecordEligibility(r, { ...DRIVER, riskCeiling: 'low', allowAnyCeremony: false })` too.
  - `test('AC1.2 (#6018): an express call (no driver options) keeps today's reasons over the same matrix', …)`: for the same 16 records, `evaluateRecordEligibility(r, OPTS).reasons` includes `REASONS.risk` exactly when risk is not `risk:low` and `REASONS.ceremony` exactly when ceremony is not `ceremony:fast-lane`; `REASONS.risk === 'risk is not low'` and `REASONS.ceremony === 'ceremony is not fast-lane'`.
  - `test('AC2.1, AC2.2 (#6018, eligibility half): riskCeiling medium admits risk:medium, refuses risk:high and an unlabelled risk naming the ceiling', …)`: with `{ ...DRIVER, riskCeiling: 'medium' }` a `risk:medium` + `ceremony:fast-lane` record is eligible; `risk:high` and no risk label each give reasons containing `'risk is not low or medium'` and not `REASONS.risk`.
  - `test('AC2.3 (#6018): riskCeiling high admits risk:high', …)`: eligible.
  - `test('riskCeiling unreadable refuses with its own reason, never a fallback (#6018)', …)`: for `'Medium'`, `'critical'`, `null`, `'toString'` the reasons contain `` `risk ceiling unreadable: ${String(v)}` `` even for a `risk:low` record.
  - `test('AC5.1, AC5.3 (#6018, eligibility half): allowAnyCeremony passes a recognised ceremony label; an unrecognised spelling still refuses', …)`: with `{ ...DRIVER, allowAnyCeremony: true }`, `ceremony:standard` is eligible; `ceremony:fastlane` alone, `Ceremony:standard` alone, and `ceremony:standard` together with `ceremony:fastlane` each give `REASONS.ceremony`; only a literal `true` relaxes (`'true'`, `1` do not).
  - `test('widenings (#6018)', …)` asserting exactly: `widenings({ labels: ['risk:medium'], riskCeiling: 'medium' })` → `['risk']`; `['risk:low']` with `'medium'` → `[]`; `['risk:high']` with `'high'` → `['risk']`; AC11: `['risk:low', 'risk:medium']` and `['risk:medium', 'risk:low']` each with `'medium'` and with `'low'` → `['risk']`; `['risk:low', 'ceremony:standard']` with `anyCeremony: true` → `['ceremony']`, with `anyCeremony: false` or absent → `[]`; `['ceremony:fast-lane']` with `anyCeremony: true` → `[]`; `['ceremony:standard', 'ceremony:fast-lane']` and `['ceremony:fast-lane', 'ceremony:standard']` with `anyCeremony: true` → `['ceremony']`; no ceremony label → `[]`; `['risk:medium', 'ceremony:standard']`, `'medium'`, `anyCeremony: true` → `['risk', 'ceremony']`; gh `{ name }` objects give the same answers as strings; an unreadable `riskCeiling` → no `risk`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: FAIL after Step 1 (`widenings` / `RISK_CEILINGS` not exported)

- [ ] **Step 3: Implement** in `eligibility.js`, mirroring `SIZE_CEILINGS` / `isReadableSizeCeiling` / `BOUND_REASONS.size`. The risk rule becomes: `riskCeiling === undefined` → today's `facets.risk !== 'low'` push; unreadable → `riskCeilingUnreadable`; else `!RISK_CEILINGS[riskCeiling].includes(facets.risk)` → `BOUND_REASONS.risk(riskCeiling)`. `allowAnyCeremony === true` adds one more way for `ceremonyOk`: at least one label name matches `/^ceremony:/i` and every such name is exactly `ceremony:{t}` for a `t` in `CEREMONY_TIERS` (import from `../issues/record-vocabulary`). `widenings` returns `'risk'` when `isReadableRiskCeiling(riskCeiling)` and any label name is exactly `risk:medium` or `risk:high` — it scans every `risk:*` name, never `facets.risk`, which keeps only the last match (spec Gotcha, AC11); the ceiling does not otherwise gate it, so the eligibility step's answer agrees with merge.js's widest-option recompute for a dual-labelled record; `'ceremony'` when `anyCeremony === true` and any label name is exactly `ceremony:{t}` for a `t` in `CEREMONY_TIERS` other than `fast-lane` — again scanning every name, never `facets.ceremony` (last match only), so `['ceremony:standard', 'ceremony:fast-lane']` widens in either order (plan review, 2026-11-22). Update the comment above `evaluateRecordEligibility` to name both new options (#6018).

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/cli.test.js tests/bin-lib/express/queue.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Add the driver risk ceiling and ceremony relaxation to eligibility — one widenings helper`

### Task 3: Admission's widened reviewer rule and `reviewRequired` for widenings

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/admission.js`
- Modify: `plugin/bin/lib/driver/review.js` (`reviewRequired`, lines 315-328, and the "On or off" header paragraph, lines 75-81)
- Test: `tests/bin-lib/driver/admission.test.js`
- Test: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Consumes: nothing from Task 2 at runtime (both take `widenedBy` as an array the caller computed with `widenings()`).
- Produces:
  - `ADMISSION_REASONS.reviewerOffWidened = 'record is admitted beyond low risk or fast-lane ceremony and the reviewer step is off for it'`
  - `ADMISSION_REASONS.widenedUnreadable = 'record widening facts unreadable'`
  - `evaluateAdmission(facts)` reads `facts.widenedBy`: `undefined` reads as `[]` (callers from before #6018); an array of strings is used; anything else pushes `widenedUnreadable`. A non-empty array with `reviewerOn === false` pushes `reviewerOffWidened` (after the existing `reviewerGateReason` push).
  - `reviewRequired({ issue, keyFiles, policyValue, widenedBy })`: `off`/`on` decide alone as today; otherwise a record beyond the express bounds keeps today's answers and reasons; else a non-empty `widenedBy` array → `{ on: true, reason: `admitted widened by ${widenedBy.join(', ')}` }`; a `widenedBy` that is neither `undefined` nor an array → `{ on: true, reason: 'widening facts unreadable' }`; else today's inside-bounds `on: false`.

- [ ] **Step 1: Write the failing tests**
  - admission: `test('AC1.1 (#6018): widenedBy absent and widenedBy [] give the base verdicts', …)` — for the file's base fact set and each existing refusal fixture it already builds, `evaluateAdmission({ ...facts, widenedBy: [] })` deep-equals `evaluateAdmission(facts)`.
  - admission: `test('AC3.1 (#6018): a widened record with the reviewer off is refused with the widened reason', …)` — base facts plus `widenedBy: ['risk'], reviewerOn: false` → `{ admitted: false, reasons: [ADMISSION_REASONS.reviewerOffWidened] }`; with `reviewerOn: true` → admitted; `widenedBy: ['ceremony'], reviewerOn: false` → the same refusal.
  - admission: `test('widenedBy unreadable refuses with its own reason (#6018)', …)` — `'risk'`, `null`, `{}` each give reasons containing `ADMISSION_REASONS.widenedUnreadable`.
  - review: `test('AC4.1 (#6018): beyond-express turns the reviewer on for a risk-widened record inside the express bounds, naming the widening', …)` — `reviewRequired({ issue: { labels: [{ name: 'size:low' }, { name: 'risk:medium' }] }, keyFiles: ['a.js', 'b.js'], policyValue: 'beyond-express', widenedBy: ['risk'] })` deep-equals `{ on: true, reason: 'admitted widened by risk' }`.
  - review: `test('AC4.2 (#6018): ceremony:standard with risk:low and no widening keeps today's off answer', …)` — same record with labels `size:low`, `risk:low`, `ceremony:standard` and `widenedBy: []` deep-equals `{ on: false, reason: 'size:low and 2 Key Files are inside the express bounds' }`; `widenedBy` absent gives the same.
  - review: `test('reviewRequired: off still decides alone for a widened record; unreadable widenings turn it on (#6018)', …)` — `policyValue: 'off', widenedBy: ['risk']` → `{ on: false, reason: 'express-driver-review is off' }`; `policyValue: 'beyond-express', widenedBy: 'risk'` → `{ on: true, reason: 'widening facts unreadable' }`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/review.test.js`
Expected: FAIL after Step 1 (`reviewerOffWidened` undefined; `reviewRequired` ignores `widenedBy`)

- [ ] **Step 3: Implement** as the Interfaces block states. Extend admission.js's header "reviewer rule" paragraph with the widened states (widened and the reviewer on: admitted by this rule; widened and the reviewer off: refused, `reviewerOffWidened`; `widenedBy` unreadable: refused, `widenedUnreadable`). Extend review.js's "On or off" paragraph with the widened rule.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/review.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Refuse a widened record with the reviewer off — reviewRequired turns on for widenings`

### Task 4: Driver wiring — policy read, `ctx.widenedBy`, the `--check` line and the merge context

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`POLICY_KEYS` 124-130, `eligibilityOptions` 278-288, `eligibilityStep` 295-311, `admissionStep` 354-366, `mergeStep` 1500-1506)
- Modify: `plugin/bin/lib/driver/run.js` (`newCtx` 214-224, `checkRecord` 530)
- Test: `tests/bin-lib/driver/run.test.js` (the `POLICY` fixture at 339-360)
- Test: `tests/bin-lib/driver/budget.test.js` (`POLICY_RESOLVED` at 18-25)
- Modify: `plugin/bin/lib/express/queue.js` (`SECOND_KEYS` line 15 only — gains `'express-driver-max-risk'` after `'express-driver-max-key-files'`, so this commit never leaves the queue pull's driver half throwing on `eligibilityOptions`; Task 8 does the rest)
- Test: `tests/bin-lib/express/queue.test.js` (the `calls` pin at line 61 gains the key)
- Read (no change): `plugin/bin/lib/driver/budget.js` — its pre-screen calls `eligibilityOptions(shared.policy)` (line 155), so it inherits both new options with no edit

**Interfaces:**
- Consumes: `widenings`, the two eligibility options (Task 2); `reviewRequired`'s and `evaluateAdmission`'s `widenedBy` (Task 3).
- Produces:
  - `POLICY_KEYS` gains `'express-driver-max-risk'` right after `'express-driver-max-lines'`.
  - `eligibilityOptions(policy)` adds `riskCeiling: policy['express-driver-max-risk'].value` and `allowAnyCeremony: policy['express-driver-review'].value === 'on'` (the budget pre-screen inherits both through this one function).
  - `eligibilityStep` sets `ctx.widenedBy = widenings({ labels: ctx.issue.labels, riskCeiling: opts.riskCeiling, anyCeremony: opts.allowAnyCeremony })` (with `opts = eligibilityOptions(policy)`) before the `reviewRequired` call — set to `[]` instead when the eligibility verdict refuses (`!verdict.eligible`), so `--check` never reports a widening for a record it refused (a refused record never reaches merge, so this narrows nothing) — passes `widenedBy: ctx.widenedBy` to it, and on its `ok` result returns `extra: { widenedBy: ctx.widenedBy }` only when the list is non-empty (an unwidened record's event line is unchanged).
  - `admissionStep` passes `widenedBy: ctx.widenedBy` to `deps.evaluateAdmission`.
  - `newCtx` gains `widenedBy: null`.
  - `checkRecord` prints `{ record, admitted, reasons, widenedBy }` with `widenedBy` = `ctx.widenedBy` when an array, else `[]`.
  - `mergeStep`'s `mctx` gains `widenedBy: ctx.widenedBy` (Task 5 reads it).

- [ ] **Step 1: Write the failing tests** in `run.test.js` (add `'express-driver-max-risk': 'low'` to `POLICY` after `'express-driver-max-lines'`, and `'express-driver-review': { value: 'beyond-express' }, 'express-driver-max-risk': { value: 'low' }` to budget.test.js's `POLICY_RESOLVED`), using the file's existing `checkRecord` harness and `WIDENED`-style policy overrides:
  - `test('AC2.1 (#6018): --check with express-driver-max-risk medium and the reviewer on admits risk:medium with widenedBy [risk]', …)` — policy `express-driver-max-risk: 'medium'`, `express-driver-review: 'on'`, record labels `risk:medium`, `size:low`, `ceremony:fast-lane`, `type:task`, `auto:build`, otherwise admissible: the last stdout line parses to `{ record, admitted: true, reasons: [], widenedBy: ['risk'] }`.
  - `test('AC2.2 (#6018): --check refuses risk:high under ceiling medium with the ceiling reason', …)` — reasons contain `'risk is not low or medium'`, `admitted: false`.
  - `test('AC2.3 (#6018): --check admits risk:high under ceiling high', …)`.
  - `test('AC3.2 (#6018): --check with ceiling medium and express-driver-review off refuses risk:medium with the widened reviewer-off reason', …)` — reasons equal `[ADMISSION_REASONS.reviewerOffWidened]`.
  - `test('AC5.1 (#6018): express-driver-review on admits ceremony:standard with widenedBy [ceremony]', …)`.
  - `test('AC5.2, AC5.3 (#6018): beyond-express (also with a size-widened record whose reviewer is on) and off refuse ceremony:standard with the ceremony reason; ceremony:fastlane refuses under every reviewer value', …)` — for `beyond-express` with `express-driver-max-size: 'medium'` and `size:medium`, and for `off`, reasons contain `'ceremony is not fast-lane'`; `ceremony:fastlane` under `on`, `beyond-express`, `off` likewise.
  - `test('AC10.1 (#6018): a malformed express-driver-max-risk value (Medium) falls back to low — --check refuses risk:medium exactly as with the key unset', …)` — feed the harness the policy the resolver returns for `express-driver-max-risk: Medium` (`{ value: 'low', source: 'default', invalid: true }`, taken from `resolvePolicyKeys` on that `policyRaw`, not hand-built), reviewer `on`, record `risk:medium`: the verdict line deep-equals the one printed with the key unset (`admitted: false`, reasons containing `REASONS.risk`, `widenedBy: []`).
  - `test('AC7.1 (#6018): the --check verdict line carries widenedBy and an unwidened record prints widenedBy []', …)` — default policy, eligible record: line is `{ record, admitted: true, reasons: [], widenedBy: [] }`.
  - `test('AC11.1 (#6018, driver half): a record labelled risk:low and risk:medium, in either order, is admitted under ceiling medium with widenedBy [risk]', …)` — reviewer `on`.
  - `test('Review Focus 4 (#6018): a size:medium risk:medium record is widened by risk only', …)` — policy max-size `medium`, max-risk `medium`, review `beyond-express`: `widenedBy` is `['risk']`.
  - `test('the eligibility event names widenedBy only for a widened record (#6018)', …)` — drive one widened and one unwidened record through the existing STEPS harness to the eligibility event: the widened line has `widenedBy: ['risk']`, the unwidened one has no `widenedBy` key.
  - `test('mergeStep hands ctx.widenedBy to merge (#6018)', …)` — a captured `mctx.widenedBy` equals the ctx's list.
  - Update the existing `budget pre-screen: eligibilityOptions is exactly what the eligibility step passes` test only if it pins the option object by hand.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js`
Expected: FAIL after Step 1 (`widenedBy` missing from the verdict line; `express-driver-max-risk` not in `POLICY_KEYS`)

- [ ] **Step 3: Implement** as the Interfaces block states; import `widenings` from `../express/eligibility`.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/express/queue.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Wire the driver's widenings through eligibility, admission, --check and merge`

### Task 5: `merge.js` stops a widened record at `pending-review`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js` (`entry()` 232-260, `REASONS` 1587-1594)
- Test: `tests/bin-lib/driver/merge.test.js` (`fixture()`'s ctx at line 58-61 gains `widenedBy: []`; `SPEC_REASONS` and its count at 2774-2786)

**Interfaces:**
- Consumes: `widenings` (Task 2); `ctx.widenedBy` on the merge context (Task 4).
- Produces: `REASONS` gains `'widened-admission'` (placed before `'unclassified'`); `entry()` stops with reason `widened-admission` right after the two `not-authorized` checks and before `summary-entry-missing`, `readIntegrationModel`, the overlap hold and `consultSupplier`.

Proof(auth): merge.test.js's widened-admission tests assert that a record carrying auto:merge and auto:build with a non-empty, unset, non-array, or label-recomputed widening returns pending-review with reason widened-admission, that deps.judgments is never called, and that no ready or merge call is made — so a widened record cannot merge on its own.

- [ ] **Step 1: Write the failing tests** (use the file's `mergeHarness`, `assertNoReadyNoMerge`, `kindsOf`)
  - `test('AC6.1 (#6018): a widened record stops at pending-review, widened-admission, before the supplier', …)` — labels `auto:build`, `auto:merge`, `risk:low`; ctx `{ ...CTX, widenedBy: ['risk'] }` → `outcome: 'pending-review'`, `reason: 'widened-admission'`, `detail` matches `/risk/`; `kindsOf(h)` has no `judgments`; `assertNoReadyNoMerge(h)`.
  - `test('AC6.2 (#6018): widenedBy [] with unwidened live labels takes today's path', …)` — `{ ...CTX, widenedBy: [] }`, labels `bug`, `auto:build`, `auto:merge` → `outcome: 'merged'`.
  - `test('AC9.1 (#6018): risk:medium with widenedBy unset, a string, or [] stops at widened-admission and never calls the supplier', …)` — labels `auto:build`, `auto:merge`, `risk:medium`; ctx variants: `widenedBy` deleted, `widenedBy: 'risk'`, `widenedBy: []`; each → `pending-review` / `widened-admission`, no `judgments` call, `assertNoReadyNoMerge(h)`.
  - `test('Review Focus 1 (#6018): a ceremony:standard live label with widenedBy [] stops at widened-admission', …)`.
  - `test('ceremony:standard plus ceremony:fast-lane, in either order, with widenedBy [] stops at widened-admission (#6018)', …)` — both label orders → `pending-review` / `widened-admission`, no `judgments` call.
  - `test('a ceremony:fast-lane, risk:low record with widenedBy [] is not widened (#6018)', …)` → `merged`.
  - `test('AC11.1 (#6018, merge half): risk:low plus risk:medium, in either order, with widenedBy [] stops at widened-admission', …)` — both label orders, each → `pending-review` / `widened-admission`, no `judgments` call.
  - Bump `SPEC_REASONS` with `'widened-admission'` and its length assertion `28` → `29`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/driver/merge.test.js`
Expected: FAIL after Step 1 (`widened-admission` not produced)

- [ ] **Step 3: Implement** in `entry()`: if `ctx.widenedBy` is not an array → `stop(s, 'merge-entry', 'widened-admission', 'widening list missing or unreadable')`; else the union (first seen first) of `ctx.widenedBy` and `widenings({ labels: labels.names, riskCeiling: 'high', anyCeremony: true })`; non-empty → `stop(s, 'merge-entry', 'widened-admission', `admitted widened by ${union.join(', ')}`)`. The recompute deliberately uses the widest options (`riskCeiling: 'high'`, `anyCeremony: true`): any live `risk:medium`/`risk:high` or recognised non-fast-lane ceremony label at merge time is a widening, whatever the run's policy, since such a record either was admitted widened or had its labels changed after admission — say so in a comment. Add `'widened-admission'` to `REASONS` and update the comment above `entry()`.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Stop a widened driver record at pending-review before any judgment worker — refs #6018`

### Task 6: The cost report keys the new reasons and reads the extended verdict line

**Role:** integration

**Files:**
- Modify: `tools/pipeline-cost-report/funnel.js` (`VALUE_HEADS` 35-42; export `parseVerdict` at line 230)
- Test: `tests/pipeline-cost-report/funnel.test.js`

**Interfaces:**
- Produces: `VALUE_HEADS` gains `'risk ceiling unreadable'`; `module.exports` gains `parseVerdict`. The readable-ceiling reasons (`risk is not low or medium`, `risk is not low or medium or high`) are a closed set of whole strings and need no head, as `size is not low or medium` has none.

- [ ] **Step 1: Write the failing tests**
  - In the existing `reasonKey cuts only the heads that embed a value` test add `assert.strictEqual(reasonKey('risk ceiling unreadable: Medium'), 'risk ceiling unreadable')` and `assert.strictEqual(reasonKey('risk is not low or medium'), 'risk is not low or medium')`.
  - `test('AC7.1 (#6018, parseVerdict half): parseVerdict reads a verdict line that carries widenedBy', …)` — `parseVerdict('noise\n{"record":5,"admitted":true,"reasons":[],"widenedBy":["risk"]}\n')` deep-equals `{ admitted: true, keys: [] }`; `parseVerdict('{"record":5,"admitted":false,"reasons":["risk ceiling unreadable: x"],"widenedBy":[]}')` deep-equals `{ admitted: false, keys: ['risk ceiling unreadable'] }`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/pipeline-cost-report/funnel.test.js`
Expected: FAIL after Step 1 (`parseVerdict` not exported; `risk ceiling unreadable` not cut)

- [ ] **Step 3: Implement** the two changes.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/pipeline-cost-report/funnel.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Key the driver risk-ceiling reason in the cost report funnel — parseVerdict exported`

### Task 7: Driver docs

**Role:** integration

**Files:**
- Modify: `docs/driver.md` (line 19 `--check` line; the reviewer table row for `beyond-express` near line 150; `### Lane bounds` 167-177; `## The merge step` entry order and `REASONS` list, lines 183 and 197)
- Modify: `plugin/skills/dispatch/driver-route.md:24` (the `--check` line shape)
- Modify: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md:48` (lane bounds sentence)
- Modify: `docs/plugin-structure.md:121` (the `eligibility.js` description)
- Read (no change): `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`, `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`, `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`, `docs/superpowers/plans/2026-11-15-dispatch-driver-route.md`, `docs/superpowers/plans/2026-11-16-typed-dispatch-build-authority-5584.md` — historical design and plan records; never edited

- [ ] **Step 1: Edit**
  - `--check` line shape in both files becomes `{"record":N,"admitted":bool,"reasons":[…],"widenedBy":[…]}`, with one sentence: `widenedBy` lists `risk` and/or `ceremony` for a record admitted beyond low risk or fast-lane ceremony, readers ignore keys they do not know.
  - Lane bounds: a fourth table row for `express-driver-max-risk` (default `low`; `low` accepts `risk:low` only, `medium` adds `risk:medium`, `high` adds `risk:high`; an unlabelled risk is refused under every value); a paragraph: with `express-driver-review: on` any recognised ceremony label passes eligibility (an unrecognised spelling still refuses); a record admitted above `risk:low` or with a non-fast-lane ceremony is widened, is admitted only with the reviewer step on (otherwise `record is admitted beyond low risk or fast-lane ceremony and the reviewer step is off for it`), turns the reviewer on under `beyond-express`, and always stops at the merge step as `widened-admission`, so a human merges it.
  - Reviewer table `beyond-express` row: add "or a record widened by risk".
  - Merge entry order: after the `auto:merge`/`auto:build` checks, "the record is not widened (`widened-admission`): the run's widening list, unioned with the risk and ceremony widenings recomputed from the live labels; a missing list stops too"; add `widened-admission` to the reason list.
  - Journey line 48: name `express-driver-max-risk` beside the two size bounds.
  - `docs/plugin-structure.md:121`: after the `sizeCeiling` clause, name the driver's `riskCeiling` option (a `RISK_CEILINGS` key, `low`, `medium` or `high` — #6018) and `allowAnyCeremony: true` (any recognised `ceremony:*` label — #6018), and add `widenings` and `RISK_CEILINGS`/`isReadableRiskCeiling` to the bound helpers list.

- [ ] **Step 2: Verify**
Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS (driver.md pins still hold)

- [ ] **Step 3: Commit** `Document the driver's risk ceiling, ceremony relaxation and widened-admission stop`

### Task 8: The queue pull's driver half asks the driver's widened question

**Role:** integration
**Review risk:** high

Added at resume (plan audit Check B, after merging origin/main): #6011 landed `plugin/bin/lib/express/queue.js`, whose driver half calls `eligibilityOptions(policy)` with a policy resolved from its own `SECOND_KEYS`. After Task 4 `eligibilityOptions` reads `policy['express-driver-max-risk'].value`, which the real resolver never returns for a key it was not asked for, so the call would throw inside queue.js's load `try` and silently disable the driver half for every pull ("driver modules failed to load"). The half must also ask the driver's whole question: a widened record is driver-routable only with the reviewer on.

**Files:**
- Modify: `plugin/bin/lib/express/queue.js` (`driverRoutable` lines 89-96; header comment — `SECOND_KEYS` already gained the key in Task 4)
- Test: `tests/bin-lib/express/queue.test.js` (new tests)

**Interfaces:**
- Consumes: `widenings` (Task 2); `reviewRequired`'s `widenedBy` (Task 3); `eligibilityOptions`'s `riskCeiling`/`allowAnyCeremony` (Task 4).
- Produces: `driverRoutable` computes `widenedBy = widenings({ labels: issue.labels, riskCeiling: driver.eligibility.riskCeiling, anyCeremony: driver.eligibility.allowAnyCeremony })`, passes it to `reviewRequired`, and answers `false` when `widenedBy` is non-empty and the reviewer is off (admission's `reviewerOffWidened` rule), besides today's `reviewerGateReason` check.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/express/queue.test.js`
  - `test('#6018: the driver half resolves express-driver-max-risk, so the real resolver shape never throws', …)` — use a resolver that, like the real one, returns entries only for the keys it was asked for (so a missing key makes `eligibilityOptions` throw on `.value`); assert the second call's `keys` include `'express-driver-max-risk'`, and that with `express-driver: 'on'`, `express-driver-max-risk: 'medium'`, `express-driver-review: 'on'`, a `risk:medium`, `size:low`, `ceremony:fast-lane` record is kept a singleton (`keepSingleton` true) and no `express-driver: driver modules failed to load` line is written.
  - `test('#6018: a risk-widened record is not driver-routable with express-driver-review off', …)` — same record, `express-driver-review: 'off'` → `keepSingleton` false.
  - `test('#6018: with express-driver-max-risk unset the driver half keeps today's answer for risk:medium', …)` — value `'low'` → `keepSingleton(MEDIUM_RISK)` false.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/express/queue.test.js`
Expected: FAIL after Step 1 (a risk:medium record under ceiling medium is not routable; a widened record with the reviewer off is)

- [ ] **Step 3: Implement** as the Interfaces block states; import `widenings` from `./eligibility`.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/express/queue.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-order.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Ask the driver's widened question in the queue pull's driver half — resolve express-driver-max-risk`
