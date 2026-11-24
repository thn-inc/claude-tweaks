# learned-skills-auto-merge Policy Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `learned-skills-auto-merge` policy key (Shape B derived default: `true` only at `autonomy: unattended` without `control-mode: on`) and record the reversal of #5290's learned-skills human-review floor in ADR 0040.

**Architecture:** One new `POLICY_KEYS` row plus a `deriveLearnedSkillsAutoMerge(sources, refusedKeys)` derivation in `plugin/bin/lib/policy-schema.js`, applied in `resolvePolicyKeys` exactly where `housekeeping-auto-merge`'s derivation is applied. Prose registration in the schema docs. A new ADR file. No reader is wired (sibling sub-issues do that), so the key carries the "Not yet used" marker.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T151029-record-6109/work/6109-spec.md` (re-materialized 2026-11-23 with the issue body's plan-review **Decision**: Reading B plus the indirect route closed)

Scope keywords: learned-skills-auto-merge, deriveHousekeepingAutoMerge

## Global Constraints

- Key: `learned-skills-auto-merge`, type `boolean`, category `merge-safety`, tier `advanced`, schema `default: false`.
- Summary (exact): `Not yet used. Lets wrap-up's learned-skill update PRs merge themselves once CI is green, instead of waiting for a person.`
- Derived unset default: `true` only when `autonomy` resolves `unattended` AND `control-mode` does not resolve `on`; otherwise `false`. An explicit key wins both ways (#580), including explicit `true` under `control-mode: on`.
- `autonomy` read through `firstSourceValue` with the `run-config` source skipped (policy.yml then factory; factory is skipped only if `autonomy` is in `refusedKeys`, which it is not today) — so a run config's `autonomy: unattended` never turns the default on (spec Decision). `control-mode` read policy-file only (it is `policyOnly` and in `FACTORY_REFUSED_KEYS`): skip `run-config` and `factory` sources, the way `planningDecisionsFrom` skips them. Use one skip predicate for both reads: `(s) => s.name === 'run-config' || (s.name === 'factory' && refusedKeys.includes(key))`. `housekeeping-auto-merge`'s own derivation is not changed.
- Derived entry keeps `source: 'default'` (Shape B invariant).
- Commit messages: `{Verb} {what} — {detail}` with `refs #6109`; never `closes`/`fixes`.
- `plugin/skills/_shared/policy-schema.md` is 51,122 B (after merging main) against RAIL_BYTES 52,500 B (1,378 B headroom): the new row must be ≤ 600 B, leaving ≥ 770 B.
- Other files cite the ADR by title, never by number.

## Who may set it (policy-key-addition decision)

**`policyOnly: true`; factory-settable (not in `FACTORY_REFUSED_KEYS`).** The key removes a human-review floor on instruction changes, and a run's own agent writes that run's `config.yml` — the same reason #5830 made `control-mode` policy-only — so a `--run` overlay must never switch it on. A user-wide factory default is the maintainer's own standing consent (as for `housekeeping-auto-merge`), so it stays settable there. This is the issue body's **Decision** (Reading B), which also closes the indirect route: the derived default reads `autonomy` with the run-config source skipped. State both in the comment above the row. Owes policy-key-addition sites 8 and 9.

## Governing skill rules (quoted from `.claude/skills/policy-key-addition`)

- "The core tier has an enforced cap of 12 ... so a new key is `advanced` unless it replaces a core one."
- "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion ... The assertion beneath it ... pins the unique-key count and takes the same bump"
- "Every key needs a table row there that starts `` | `{key}` | `` ... and its summary must not be copied verbatim from the row's `summary`"
- "A key that lands before its consumer opens its `summary` with `Not yet used. ` ... and joins `NOT_YET_USED` in `tests/resolve-policy-control-mode.test.js`."
- "A derived key is also named in its shape's paragraph there, the membership list `/claude-tweaks:help`'s policy mode reads, and gets a `computed (…)` row in `plugin/skills/help/policy.md`'s Derived-default keys table"
- "A `policyOnly` key is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s 'Canonical read path carve-outs'" and "in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`"

## Scope notes

Waived docs/REGISTRY.md: ADRs are registered by the existing `docs/decisions/*.md` glob row (REGISTRY.md line 23), so the spec's conditional REGISTRY edit does not apply; Task 2 re-confirms.

Check B hit `plugin/skills/_shared/autonomy-ceiling.md` (its ceiling table describes `housekeeping-auto-merge`'s live derived effect): left unchanged on purpose — the new key has no reader yet, so describing a live `unattended` effect there would be false; the sibling `drain` sub-issue that wires the reader owns that prose. Check B hit the run ledger: bookkeeping, not scope.

## Review Focus

1. `control-mode: on` set only in a run config (`runConfigRaw`) must NOT veto the derivation (control-mode is policyOnly) — unattended still derives `true`. Test in Task 1.
2. `control-mode: on` in the factory layer must NOT veto (control-mode is factory-refused). Test in Task 1.
3. A run config setting `learned-skills-auto-merge: true` under `autonomy: supervised` must resolve `false` (key is policyOnly). Test in Task 1.
4. A run config setting `autonomy: unattended` over a `policy.yml` `autonomy: supervised` must derive `false` (run-config skip on the autonomy read). Test in Task 1.
5. A malformed key value (`maybe`) at unattended keeps `invalid: true` and takes the derived `true`. Test in Task 1.
6. `autonomy: trusted` derives `false` (positive-list on `unattended` only — unlike housekeeping). Covered by AC1.1 (b).

---

### Task 1: Policy key, derivation, tests and schema prose

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (row after `housekeeping-auto-merge` ~line 145; new derive function after `deriveHousekeepingAutoMerge` ~line 659; apply in `resolvePolicyKeys` beside the housekeeping branch ~line 877)
- Test: `tests/resolve-policy-lib.test.js` (new block right after the housekeeping-auto-merge block, before `// --- merge-authorization`)
- Modify: `tests/policy-schema.test.js:46-48` (both counts 124 → 125, `// Last bump: 124 -> 125, #6109`)
- Modify: `tests/resolve-policy-control-mode.test.js:313` (append `'learned-skills-auto-merge'` to `NOT_YET_USED`)
- Modify: `plugin/skills/_shared/policy-schema.md` (row after `grant-veto-window-hours` in the merge-safety table)
- Modify: `plugin/skills/_shared/policy-schema-read-path.md:20` (Shape B paragraph: add the key to the member list)
- Modify: `plugin/skills/help/policy.md:59` (new Derived-default table row after housekeeping's)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:102` (policyOnly bullet: add `` `learned-skills-auto-merge` (#6109) ``)
- Modify: `docs/journeys/resolve-a-policy-key.md:48` (policyOnly red-flags list: add `` `learned-skills-auto-merge`, #6109 ``)
- Modify: `docs/journeys/review-project-policy.md:32` (step 2 Should understand: add the new key's `computed (derived from autonomy and control-mode)` wording to the derived-default list, and say it is advanced-tier so the core-only Notable-defaults finding does not surface its unset derived value)

**Interfaces:**
- Produces: `deriveLearnedSkillsAutoMerge(sources, refusedKeys) -> boolean` (module-private, like its sibling).

- [ ] **Step 1: Write the failing tests** in `tests/resolve-policy-lib.test.js`, each requesting the key alone (`const K = 'learned-skills-auto-merge'`):

```js
test('AC1.1 (a): unset + autonomy unattended derives true', () => {
  assert.deepStrictEqual(resolvePolicyKeys([K], { policyRaw: 'autonomy: unattended\n' })[K], { value: true, source: 'default' });
});
test('AC1.1 (b) AC4.2: unset + autonomy trusted derives false', () => { /* policyRaw 'autonomy: trusted\n' -> { value: false, source: 'default' } */ });
test('AC1.1 (c) AC4.2: unset + autonomy supervised derives false', () => { /* 'autonomy: supervised\n' -> false/default */ });
test('AC1.1 (d): unset + unattended with control-mode: on derives false', () => { /* 'autonomy: unattended\ncontrol-mode: on\n' -> false/default */ });
test('AC2.1 (a) AC4.2: explicit false at unattended wins', () => { /* 'learned-skills-auto-merge: false\nautonomy: unattended\n' -> { value: false, source: 'policy' } */ });
test('AC2.1 (b) AC4.2: explicit true at supervised wins', () => { /* 'learned-skills-auto-merge: true\nautonomy: supervised\n' -> { value: true, source: 'policy' } */ });
test('explicit true under control-mode: on wins (#580)', () => { /* '...: true\nautonomy: unattended\ncontrol-mode: on\n' -> true/policy */ });
test('a run-config control-mode: on does not veto (control-mode is policyOnly)', () => { /* policyRaw unattended, runConfigRaw 'control-mode: on\n' -> true/default */ });
test('a factory control-mode: on does not veto (control-mode is factory-refused)', () => { /* policyRaw unattended, factoryRaw 'control-mode: on\n' -> true/default */ });
test('AC3.1 (a): a run-config value never sets the key (policyOnly)', () => { /* policyRaw supervised, runConfigRaw '...: true\n' -> false/default */ });
test('AC3.1 (b): a run-config autonomy: unattended never turns the default on', () => { /* policyRaw 'autonomy: supervised\n', runConfigRaw 'autonomy: unattended\n' -> false/default */ });
test('factory autonomy: unattended alone derives true (factory is read)', () => { /* factoryRaw 'autonomy: unattended\n', no policyRaw -> true/default */ });
test('policy autonomy: supervised over factory unattended derives false', () => { /* policyRaw supervised, factoryRaw unattended -> false/default */ });
test('a factory learned-skills-auto-merge: true is honored (factory-settable)', () => { /* factoryRaw 'learned-skills-auto-merge: true\n' -> { value: true, source: 'factory' } */ });
test('set-but-invalid at unattended keeps invalid: true and derives true', () => { /* '...: maybe\nautonomy: unattended\n' -> { value: true, source: 'default', invalid: true } */ });
```

Plus in `tests/policy.test.js` (beside the other policyOnly row pins): `learned-skills-auto-merge is policyOnly, advanced, merge-safety, default false, factory-settable` asserting `row.policyOnly === true`, `row.tier === 'advanced'`, `row.category === 'merge-safety'`, `row.default === false`, and `!FACTORY_REFUSED_KEYS.includes(K)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/resolve-policy-lib.test.js tests/policy.test.js`
Expected: FAIL — unknown key / missing row.

- [ ] **Step 3: Implement**
  - Row (with the decision comment above it): `{ key: 'learned-skills-auto-merge', type: 'boolean', default: false, policyOnly: true, summary: <Global Constraints exact>, category: 'merge-safety', tier: 'advanced' }`. Comment also names the derivation and that the `drain` sub-issue drops the marker.
  - `deriveLearnedSkillsAutoMerge(sources, refusedKeys)`: with `const skipFor = (key) => (s) => s.name === 'run-config' || (s.name === 'factory' && refusedKeys.includes(key));` return `firstSourceValue(sources, 'autonomy', skipFor('autonomy')) === 'unattended' && firstSourceValue(sources, 'control-mode', skipFor('control-mode')) !== 'on'`. Header comment states the invariants (positive list on `unattended`; neither input is read from a run config, so no run config can turn the key on directly or indirectly; source stays `'default'`).
  - In `resolvePolicyKeys`, beside the housekeeping branch: `if (canonical === 'learned-skills-auto-merge' && resolved.source === 'default') resolved = { ...resolved, value: deriveLearnedSkillsAutoMerge(sources, FACTORY_REFUSED_KEYS) };` (use the same lazily-required `FACTORY_REFUSED_KEYS` binding the plan-at-specify branch at ~line 905 uses; confirm it is in scope at the insertion point).
  - Bump `tests/policy-schema.test.js` counts and Last-bump line; add to `NOT_YET_USED`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/resolve-policy-lib.test.js tests/policy.test.js tests/policy-schema.test.js tests/resolve-policy-control-mode.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js`
Expected: PASS (these fail until the doc row exists — do Step 5 first if naming/metadata tests are red).

- [ ] **Step 5: Prose registration**
  - `policy-schema.md` row (≤ 600 B, summary NOT verbatim): `` | `learned-skills-auto-merge` | `policy.yml` only (`policyOnly`) | Not yet read — the learned-skills drain (`/claude-tweaks:wrap-up`'s `learned-skills-pr.md`) and `_shared/github-pr-scan.md` item 9, wired by sibling sub-issues | derived: `true` at `autonomy: unattended` unless `control-mode: on`, else `false` | When true, wrap-up's learned-skills PR merges once CI is green with no human review. Explicit value wins both ways; malformed → derived value with `invalid: true` | ``
  - Shape B paragraph: change "(`housekeeping-auto-merge`, #580)" to name both keys, e.g. "(`housekeeping-auto-merge`, #580; `learned-skills-auto-merge`, #6109)", and name the derive functions of both. Reword its closing `/claude-tweaks:help` sentence so it stays true for both (plan-review settlement, Reading A): help renders an explicitly-set B default as `computed (derived from autonomy)` for `housekeeping-auto-merge` and `computed (derived from autonomy and control-mode)` for `learned-skills-auto-merge`; the Notable-defaults finding covers core-tier keys only, so it surfaces `housekeeping-auto-merge`'s unset/derived divergence and not the advanced-tier `learned-skills-auto-merge`'s. `help/policy.md`'s Notable-defaults rule is not changed.
  - `help/policy.md` row: `` | `learned-skills-auto-merge` (B) | `computed (derived from autonomy and control-mode)` | `deriveLearnedSkillsAutoMerge()`'s result | `_shared/policy-schema-read-path.md`'s Shape B paragraph | ``
  - policyOnly lists in `policy-schema-coverage.md:102` and `docs/journeys/resolve-a-policy-key.md:48`.
  - `docs/journeys/review-project-policy.md` step 2 Should understand: add the new key's computed wording beside the three listed, plus one clause that it is advanced-tier, so an unset derived `true` is not in Notable defaults.
  - Byte check: `wc -c plugin/skills/_shared/policy-schema.md` ≤ 51,600; then `node plugin/bin/context-cost-report.js --plugin-root plugin` shows no rail breach (Gotcha verify step).

- [ ] **Step 6: Go-red controls (AC4.1)** — in the worktree, temporarily replace `=== 'unattended'` with `=== 'never'` in the derive function: AC1.1 (a) must fail. Restore. Temporarily drop the `&& ... !== 'on'` clause: AC1.1 (d) must fail. Restore. Temporarily make the autonomy read's skip `() => false` (run-config consulted): AC3.1 (b) must fail. Restore. Record all three outputs (test name + `not ok`) in the task report.

- [ ] **Step 7: Run the impacted tests again** (Step 4 command plus `tests/context-cost.test.js` and any `rail:` suite touching `_shared/`): PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/policy-schema.js tests/resolve-policy-lib.test.js tests/policy.test.js tests/policy-schema.test.js tests/resolve-policy-control-mode.test.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-read-path.md plugin/skills/help/policy.md plugin/skills/_shared/policy-schema-coverage.md docs/journeys/resolve-a-policy-key.md docs/journeys/review-project-policy.md
git commit -m "Add the learned-skills-auto-merge policy key — derived true only at unattended without control mode, refs #6109"
```

### Task 2: ADR 0040

**Role:** integration

**Files:**
- Create: `docs/decisions/0040-learned-skills-prs-merge-without-review-once-green.md`
- (No `docs/REGISTRY.md` edit: ADRs are registered by the `docs/decisions/*.md` glob row, verified at plan time — the spec's "if ADRs are registered there" condition does not hold.)

- [ ] **Step 1:** Re-check `ls docs/decisions/` — 0039 is the highest at plan time; use 0040 unless taken. Read `docs/decisions/0039-*.md` and match its heading/section format (title, status, date, context, decision, consequences).
- [ ] **Step 2: Write the ADR**, title "Learned-skills PRs merge without review once green". Must contain:
  - #5290's ruling quoted: "an instruction change that merges with no review is what the floor exists to stop".
  - Evidence: maintainer reports not reading these diffs; merges happen in batches minutes apart; 36 PRs in a week, median 19h open; #6083's hand fold of ten conflicting PRs. Cites #6088 (the 2026-11-23 ruling).
  - Decision: the learned-skills PR merges once CI is green under `learned-skills-auto-merge`.
  - Boundary: a record's own diff, the record-owned run-branch route and console-approved skill updates keep `merge-check`'s agent-instruction floor unchanged.
  - Takes effect only once the `drain` and PR-scan sub-issues land; the old "waits for a human" prose stays authoritative until then.
  - Why `unattended` alone turns the default on: the setting is the maintainer's own consent to unreviewed merges; `control-mode: on` vetoes an unset default; an explicit key always wins.
  - "Green" = every check on the PR head completed successfully; no checks, only skipped checks, or pending checks count as not green.
  - A bad merge is undone with `git revert` of its squash commit.
- [ ] **Step 3: Verify (AC5.1)** — `grep -c "#5290\|#6088" docs/decisions/0040-learned-skills-prs-merge-without-review-once-green.md` ≥ 2, and run `node --test tests/` suites matching `decisions` / `adr` if any (`git grep -l "docs/decisions" -- tests`).
- [ ] **Step 4: Commit** — `git commit -m "Record the learned-skills review-floor reversal in an ADR — refs #6109"`

### Final verification (AC6.1)

Waived AC4.1: the seen-failing clause is proven by Task 1 Step 6's go-red mutation controls (a revert-and-observe proof, not a committed test); the implementer quotes all three failing outputs in its report.

Waived AC6.1: `npm test -- --full` is run by the build's Common Step 5 / `/claude-tweaks:test` runner, not by a task.
