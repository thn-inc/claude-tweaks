# Express Lane On By Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `express-lane` defaults to `true`; a project opts out with `express-lane: false`; a malformed value fails closed at `express-lane.js gate`; every doc, test and a new decision record say so.

**Architecture:** A one-value default flip in `POLICY_KEYS`, plus one narrowing refusal in the express gate: `expressGateOptions` treats an `invalid: true` `express-lane` entry as off and `evaluateRecordEligibility` names it with a new reason. Then a prose sweep over every place that describes the lane as opt-in, and decision record 0041.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T100105-record-4591/work/4591-spec.md` (record #4591), including its `## Planning Decisions` section, which amends the Technical Approach and the AC3 grep.

Scope sweep (no `Scope keywords:` field): a `Scope keywords: express-lane` audit matches ~75 files, nearly all readers of the resolved value, sibling `express-*` keys, history docs or fixtures that set the key explicitly. The default-describing sites were found by grepping the old behavior's phrases (`off by default`, `opts into the express lane`, `express-lane: true`, `Opt in`, `opt-in`) across `plugin`, `docs`, `README.md`; Task 2 lists every hit and classifies the rest.

## Global Constraints

- Opt-out value is exactly `express-lane: false` in `.claude-tweaks/policy.yml`. Booleans are literal `true`/`false`.
- Fail closed (Planning Decision Q1): when the resolved `express-lane` entry carries `invalid: true`, `express-lane.js gate` refuses every record with the reason `express-lane value invalid — treated as off` (em dash, U+2014), and the express path does not run. The generic `policy-schema.js` invalid-value fallback stays unchanged for every key; `resolve-policy.js --values express-lane` may still print `true` for a malformed value. The gate is the one place that acts on it. No other eligibility or merge rule changes.
- The schema `summary` stays within the 140-character limit `tests/policy-schema-metadata.test.js` enforces.
- The `express-lane disabled` and invalid-value gate checks read a real `policy.yml` fixture through the real resolver, never a harness-injected value.
- Decision record number: `docs/decisions/` on `origin/main` ends at `0040`, and no open PR adds a `docs/decisions/` file (checked at plan time), so it is `0041`. Re-check before creating it.
- `plugin/skills/_shared/policy-schema.md` is 51,986 B against `RAIL_BYTES` 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`): the `express-lane` row edit must not grow it by more than ~300 B. Measure `wc -c` after the edit.
- Quoted from `.claude/skills/policy-key-addition/SKILL.md` (governs `policy-schema.js` and `policy-schema.md`):
  - "`plugin/bin/lib/policy-schema.js`'s `POLICY_KEYS` is the data, and `plugin/skills/_shared/policy-schema.md` is the prose index; \"if the two disagree, one of them has a bug\"."
  - "its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`)."
  - "**Changing what an existing value does needs two greps, not one.**" `express-lane` is not a Manifesto lever; the kebab-case grep is classified in Task 2. The key count pin (125) is untouched.
- Commit messages: `{Verb} {what} — {detail}`, referencing `refs #4591`, never `closes`/`fixes`.

## Review Focus

1. Upgrade behavior: an existing install with `pr-first`, PR CI and `auto:merge` small records starts express-merging with no policy edit — the decision record says this plainly (Task 3).
2. A typo'd opt-out (`express-lane: off`, `no`, `False`) must never turn the lane on — Task 1's real-`policy.yml` gate test pins `off`, and the eligibility unit test pins the reason for any `invalid: true` entry.
3. A fixture or suite that resolved policy from an empty `policy.yml` and relied on the lane being off now sees it on — Task 1 Step 6 runs every `tests/` file naming `express-lane`.
4. The queue pull (`express/queue.js`) reads only the value, so an invalid value still keeps an otherwise-eligible singleton out of a fast-lane bundle; the gate then refuses it and it takes the normal path. That grouping effect is accepted (the gate is the one place that acts, per Planning Decision Q1) — Task 1 does not change `queue.js` code, only its stale "opt-in" comment.
5. The `policy-schema.md` row growing past the Read rail — Task 2 Step 3 measures it.

---

### Task 1: Flip the default and fail closed on an invalid value
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:110-111` (comment above the row, `default`, `summary`)
- Modify: `plugin/bin/lib/express/policy.js:43-53` (`expressGateOptions`)
- Modify: `plugin/bin/lib/express/eligibility.js:84-100` (`REASONS`) and `:206-218` (`evaluateRecordEligibility`'s option destructure and the `enabled` check), plus the doc comment above the function
- Modify: `plugin/bin/lib/driver/plan-lane.js:137-138` (comment: `enabled` is true here only for a valid `true` value)
- Modify: `plugin/bin/lib/express/queue.js:67` (comment "the lanes are opt-in" → the driver lane is opt-in, the express lane is on unless a project sets it `false`)
- Test: `tests/policy-schema.test.js:51-57`, `tests/bin-lib/express/eligibility.test.js:120-141`, `tests/bin-lib/express/cli.test.js` (new tests after the `realFixture`/`writeMainPolicy` helpers, ~line 1040)

**Interfaces:**
- Consumes: `resolvePolicyKeys(keys, { policyRaw, runConfigRaw })` → `{ [key]: { value, source, invalid? } }`; `resolvePolicyConfig({ git, readFile, keys, cwd, homeDir, env })` → `{ result }` (`plugin/bin/lib/policy-schema.js:1197`); test helpers `realFixture()`, `writeMainPolicy(dir, text)`, `harness(fx, over, policy)`, `record(n, labels)` in `cli.test.js`.
- Produces: `POLICY_KEYS` row `{ key: 'express-lane', type: 'boolean', default: true, … }`; `REASONS.invalidValue === 'express-lane value invalid — treated as off'`; `expressGateOptions(policy)` → `{ enabled, laneValueInvalid, integrationModel, sensitivePaths, protectedPathGlobs }` where `enabled === (entry.value === true && entry.invalid !== true)` and `laneValueInvalid === (entry.invalid === true)`; `evaluateRecordEligibility(issue, { …, laneValueInvalid })` pushes `REASONS.invalidValue` instead of `REASONS.disabled` when `enabled !== true` and `laneValueInvalid === true`.

- [ ] **Step 1: Write the failing tests**

`tests/policy-schema.test.js` — rename the test to `'AC1.1, AC2.1: express-lane defaults on and a project opts out (#4025, #4591)'`; keep the `express-review-sample-every` lines:

```js
assert.deepStrictEqual(resolved['express-lane'], { value: true, source: 'default' });
const optOut = resolvePolicyKeys(['express-lane'], { policyRaw: 'express-lane: false\n', runConfigRaw: null });
assert.deepStrictEqual(optOut['express-lane'], { value: false, source: 'policy' });
const typo = resolvePolicyKeys(['express-lane'], { policyRaw: 'express-lane: off\n', runConfigRaw: null });
assert.strictEqual(typo['express-lane'].invalid, true, 'the generic fallback is unchanged; the gate acts on invalid');
```

Check the real reply shapes once before pinning; use `deepStrictEqual` only where the reply has exactly those fields.

`tests/bin-lib/express/eligibility.test.js` — add `invalidValue: 'express-lane value invalid — treated as off'` to the `REASONS is frozen` literal pin, and a new test `'#4591: an invalid express-lane value refuses with its own reason, never disabled'`: with the file's eligible record and `OPTS`, `{ ...OPTS, enabled: false, laneValueInvalid: true }` → `reasons` is exactly `[REASONS.invalidValue]`; `{ ...OPTS, enabled: false }` → exactly `[REASONS.disabled]`; control: `{ ...OPTS, enabled: true }` → `eligible: true` (the record is otherwise eligible, so the reason above is the only refusal).

`tests/bin-lib/express/cli.test.js` — a helper `policyHarness(fx, policyText)`: `writeMainPolicy(fx.main, policyText)`, then `harness(fx)` with `deps.resolvePolicy` resolving `express-lane` through the real resolver — `resolvePolicyConfig({ git: (args) => execFileSync('git', args, { cwd: fx.main, encoding: 'utf8' }), readFile: <the harness's readFile>, keys: ['express-lane'], cwd: fx.main, homeDir: fx.root }).result['express-lane']` — and every other key from the fake `POLICY`. `homeDir: fx.root` keeps a user-wide factory policy out. Two tests, eligible `record(7)` via `--records-json`:
- `'AC2.1 (gate half): express-lane: false in a real policy.yml reports express-lane disabled'` → exit 0, `enabled: false`, verdict `reasons` exactly `[REASONS.disabled]`.
- `'#4591 Planning Decision Q1: express-lane: off in a real policy.yml refuses with the invalid-value reason'` → exit 0, `enabled: false`, verdict `eligible: false`, `reasons` exactly `[REASONS.invalidValue]`.
- Control in the same block: a real `policy.yml` with no `express-lane` key → `enabled: true`, verdict `eligible: true` (AC1.1 through the gate).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/policy-schema.test.js tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/cli.test.js`
Expected: FAIL — `express-lane` resolves `{ value: false, source: 'default' }`; `REASONS.invalidValue` undefined; the `off` gate test gets `[REASONS.disabled]` (today's fallback is the `false` default); the no-key control gets `disabled`.

- [ ] **Step 3: Change the schema row**

`default: true`. New `summary` (≤140 chars, differs from every doc row): "Runs the express lane unless false: a small, low-risk singleton record builds, tests and merges-on-green in one agent." Comment above: the lane is on by default and a project opts out with `false` (#4591); an invalid value is refused at the gate (`express/policy.js`).

- [ ] **Step 4: Implement the fail-closed refusal**

`expressGateOptions` and `evaluateRecordEligibility` per the Interfaces block; `REASONS.invalidValue` added to the frozen object beside `disabled`, with a one-line comment naming #4591's fail-closed decision. No other rule changes.

- [ ] **Step 5: Run the three suites to verify they pass**

Run: `node --test tests/policy-schema.test.js tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/cli.test.js`
Expected: PASS.

- [ ] **Step 6: Run every `tests/` suite that mentions `express-lane`**

The list is `git grep -l express-lane -- tests` filtered to `*.test.js` (Planning Decision: blanket rule). At plan time:

Run: `node --test tests/bin-lib/dispatch/queue-order.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/plan-lane.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/settle.test.js tests/bin-lib/express/cli-plan-lane.test.js tests/bin-lib/express/cli.test.js tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/queue.test.js tests/dispatch-express-routing-prose.test.js tests/dispatch-prompt-cli-prose.test.js tests/express-lane-prose.test.js tests/flow-claim-preflight.test.js tests/flow-express-entry-prose.test.js tests/phase-exit-call-sites-conformance.test.js tests/pipelines-push-first-local-runs-conformance.test.js tests/policy-protected-paths.test.js tests/policy-schema.test.js tests/risk-flags-bypass-prose.test.js tests/specify-planning-conformance.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js`
Expected: PASS (`tests/bin-lib/dispatch/queue-pull-oracle.js` is a helper the queue-pull suite loads). Re-run the grep first; add any new file. If a suite fails because a fixture relied on the old default, set `'express-lane': false` (or `express-lane: false` in its policy text) in that fixture explicitly — never change an assertion's meaning — and list the file in the commit.

- [ ] **Step 7: Verify AC1.1 and AC2.1 end to end**

In a scratch git repo under the session scratchpad with `.claude-tweaks/policy.yml` holding no `express-lane` key: `node "<worktree>/plugin/bin/resolve-policy.js" --values express-lane` → `true` (AC1.1). With `express-lane: false` → `false` (AC2.1). Scratch only; the committed proofs are Step 1's tests.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/express/policy.js plugin/bin/lib/express/eligibility.js plugin/bin/lib/driver/plan-lane.js plugin/bin/lib/express/queue.js tests/policy-schema.test.js tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/cli.test.js
git commit -m "Default express-lane to true — false opts out, an invalid value fails closed at the gate, refs #4591"
```

### Task 2: Sweep the docs to on-by-default
**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/policy-schema.md:89` (`express-lane` row: default `true`, meaning)
- Modify: `plugin/skills/_shared/work-record-config.md:27` (same)
- Modify: `plugin/skills/dispatch/configuration.md:12` (same)
- Modify: `docs/getting-started.md:95` ("With `express-lane: true` in `policy.yml` (off by default, `pr-first` only)") and `:139` ("With `express-lane: true`, a singleton group…")
- Modify: `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:29-35` (step "1. Opt in") and the **Entry point** line if it implies an opt-in
- No change (classified): `docs/journeys/route-a-dispatch-singleton-through-the-driver-5232.md:39` ("With `express-lane` off, …") — a conditional, still true; `docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md:26` and `let-the-driver-pick-records-under-a-budget-5229.md:35` — conditionals on the project's value; `docs/superpowers/specs/phase-7-trial-reviews/4365-review.md:9` — history; `plugin/skills/dispatch/SKILL.md:250`, `plugin/skills/flow/SKILL.md:151`, `plugin/skills/flow/express-entry.md`, `plugin/skills/_shared/express-lane.md` — read the resolved value and the gate's verdict, describe no default, and a malformed value reaches the gate, which refuses (so the normal path runs, as these files already say for any non-eligible verdict).

**Interfaces:**
- Consumes: Task 1's default `true` and `REASONS.invalidValue`.
- Produces: nothing code-facing.

- [ ] **Step 1: Run the AC3 grep before the change and record the hits (AC3.2)**

Run: `git grep -n -i -E "off by default|opts? (a project )?into the express lane" -- plugin docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' | grep -i express`
Expected at base (run at plan time): `docs/getting-started.md:95`, `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:34`, `plugin/bin/lib/policy-schema.js:111` (Task 1 removes it), `plugin/skills/_shared/policy-schema.md:89`, `plugin/skills/_shared/work-record-config.md:27`, `plugin/skills/dispatch/configuration.md:12`. The exclusions and the `grep -i express` filter are Planning Decision Q2's.

- [ ] **Step 2: Rewrite each listed site**

- Three skill-doc rows: default cell `` `true` ``; meaning opens "On unless a project sets it `false`:" then the existing "a small, low-risk singleton record …" clause. Wording must differ from Task 1's schema `summary`.
- `getting-started.md:95`: "The express lane is on by default (`pr-first` only; set `express-lane: false` in `policy.yml` to turn it off): `/claude-tweaks:flow #N` for one small eligible record … skips the pipeline."
- `getting-started.md:139`: "Unless `express-lane: false`, a singleton group whose record passes `express-lane.js gate` runs as one express agent call …".
- Journey step 1: retitle "### 1. Check the project can run it"; **Action:** confirm `.claude-tweaks/policy.yml` resolves `integration-model: pr-first` and the repo has PR CI; set `express-lane: false` to turn the lane off. **Should feel:** no switch to flip on a pr-first repo with PR CI; one line to turn it off. **Should understand:** "The lane is on by default and runs only under `integration-model: pr-first`, with `gh` available." and "A malformed value such as `express-lane: off` never turns it on: the gate refuses every record with `express-lane value invalid — treated as off`." Keep the PR-CI bullet. **Red flags:** an express routing note in a run on a repo that set `express-lane: false` or a malformed value; `/flow` reading `express-entry.md` or calling `gh issue view` with the lane set `false`.

- [ ] **Step 3: Verify AC3.1 and the Read rail**

Run: `git grep -n -i -E "off by default|opts? (a project )?into the express lane" -- plugin docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' | grep -i express`
Expected: no output (AC3.1, as amended by Planning Decision Q2).
Run: `wc -c plugin/skills/_shared/policy-schema.md` → under 52,500.
Run: `node --test tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/express-lane-prose.test.js tests/dispatch-express-routing-prose.test.js tests/flow-express-entry-prose.test.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/_shared/policy-schema.md plugin/skills/_shared/work-record-config.md plugin/skills/dispatch/configuration.md docs/getting-started.md docs/journeys/ship-a-small-record-on-the-express-lane-4025.md
git commit -m "Describe the express lane as on by default — express-lane: false opts out, refs #4591"
```

### Task 3: Decision record 0041
**Role:** judgment

**Files:**
- Create: `docs/decisions/0041-express-lane-ships-on-by-default.md`

**Interfaces:**
- Consumes: Task 1's default and fail-closed rule; the format of `docs/decisions/0040-learned-skills-prs-merge-without-review-once-green.md` (title `# 0041. …`, its status/date/context bullets, `## Context`, `## Decision`, `## Alternatives considered`, `## Consequences`).
- Produces: nothing code-facing.

- [ ] **Step 1: Re-check the number is free**

Run: `git ls-tree --name-only origin/main docs/decisions/` (after `git fetch origin main`) and `gh pr list --state open --search "docs/decisions in:files" --json number,files`. Use the next free number (0041 unless taken).

- [ ] **Step 2: Write the record**

- Status accepted; Date 2026-11-25; Context #4591 (decision approved 2026-10-30 during #4365's brainstorm; fail-closed rule decided 2026-11-25 at plan review).
- Context: the lane (#4025, shipped in #4354) defaulted to `false`.
- Decision: `express-lane` defaults to `true`; `express-lane: false` opts out; an invalid value fails closed — `express-lane.js gate` refuses every record with `express-lane value invalid — treated as off`, while the generic invalid-value fallback stays unchanged for every other key.
- Why on, while decision record 0012 ships the top autonomy tier shut: the lane widens no merge authority — it merges only records already carrying `auto:merge` (or a passing `/flow` merge authorization), takes only `risk:low` × `size:low` × `ceremony:fast-lane` records with a `type:*` label and at most 3 Key Files, refuses frontend surfaces, protected paths and `merge-sensitive-paths`, requires `pr-first` and green PR CI, and hands everything else back to the normal path. It removes review ceremony only.
- Post-merge sampling (`express-review-sample-every`, the drain sweep, and #4365's foreground own-PR check) stands in for the skipped review.
- Alternatives: keep it opt-in (the lane never ran); generic fallback for a malformed value (a typo'd opt-out would turn autonomous merging on).
- Consequences: existing installs with `pr-first`, PR CI and `auto:merge` small records start express-merging on upgrade with no policy edit; the queue pull still keeps an invalid-value singleton unbundled, and the gate then sends it down the normal path.
- Revisit when: a sampled post-merge review finds a regression an express merge shipped, or sampled reviews file findings on express PRs at a higher rate than on normal-path PRs.
- Never write "off by default" or "opts into the express lane" (AC3.1's grep); say "defaulted to `false`".

- [ ] **Step 3: Verify AC4.1**

Run: `grep -n -E "0012|#4365|[Rr]evisit" docs/decisions/0041-express-lane-ships-on-by-default.md` → at least one line each for `0012`, `#4365`, and a revisit trigger (AC4.1).
Run: the AC3.1 grep from Task 2 Step 3 → no output.
Run: `node --test tests/payload-boundary.test.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0041-express-lane-ships-on-by-default.md
git commit -m "Add decision record 0041 — the express lane ships on by default and fails closed on an invalid value, refs #4591"
```

### Task 4: Full verification
**Role:** transcription

- [ ] **Step 1: AC5.1** — `npm test` passes; run through the pipeline's verification (Common Step 5 / `/claude-tweaks:test`), not hand-rolled. Folded into Common Step 5: no implementer dispatch.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (default + summary) | Task 1 |
| Deliverable 2 (every listed place; journey opt-in step) | Task 2 |
| Deliverable 3 (decision record) | Task 3 |
| Deliverable 4 (tests) | Task 1 |
| AC1.1 | Task 1 Steps 1, 7 |
| AC2.1 (resolver prints `false`; gate reports `express-lane disabled`) | Task 1 Steps 1, 7 (`policy-schema.test.js`, the real-`policy.yml` gate test in `cli.test.js`) |
| AC3.1, AC3.2 | Task 2 Steps 1, 3; Task 3 Step 3 |
| AC4.1 | Task 3 Step 3 |
| AC5.1 | Task 4 |
| Planning Decision Q1 (new AC: `express-lane: off` → invalid-value refusal, real `policy.yml`) | Task 1 Step 1 (`cli.test.js`, `eligibility.test.js`) |
| Planning Decision Q2 (grep exclusions + `grep -i express`) | Task 2 Steps 1, 3 |
| Blanket rule: summary ≤140, suite list, Task 1 high risk, real `policy.yml` | Task 1 Steps 1, 3, 6; Task 1 marker |
| Technical Approach: check for a test pinning docs table and schema together | Task 1 Step 6 / Task 2 Step 3 run `tests/policy-schema-metadata.test.js` and `tests/policy-key-naming.test.js` |
| Gotcha: upgrade behavior said plainly | Task 3 Consequences; the record's `## Release Note` |
| Gotcha: next free decision number | Task 3 Step 1 |
