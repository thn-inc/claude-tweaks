# Express Lane On By Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `express-lane` defaults to `true`; a project opts out with `express-lane: false`, and every doc, test and a new decision record say so.

**Architecture:** A one-value default flip in `POLICY_KEYS`, a test pin for the default and the opt-out, a prose sweep over the six places that describe the lane as opt-in, and decision record 0041. No eligibility, gate or merge rule changes.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T094940-record-4591/work/4591-spec.md` (record #4591)

Scope sweep (no `Scope keywords:` field): a `Scope keywords: express-lane` audit matched 73 files, every one a reader of the resolved value, a sibling `express-*` key, a history doc or a test fixture that sets the key explicitly — none states the default. The default-describing sites were found instead by grepping the old behavior's phrases (`off by default`, `opts into the express lane`, `express-lane: true`, `Opt in`) across `plugin`, `docs`, `README.md` and `tests`; Task 2 lists every hit and classifies the rest.

## Global Constraints

- Opt-out value is exactly `express-lane: false` in `.claude-tweaks/policy.yml`. Booleans are the literal `true`/`false`, never `on`/`off`.
- No change to `plugin/bin/lib/express/**`, `plugin/bin/lib/driver/**`, eligibility, gate or merge rules (spec Technical Approach: "No eligibility or merge rule changes").
- The decision record takes the next free number at build time: `docs/decisions/` ends at `0040`, and `gh pr list --state open --search "docs/decisions/0041 in:files"` returned `[]` at plan time, so it is `0041`. Re-check before creating it.
- `plugin/skills/_shared/policy-schema.md` is 51,986 B against `RAIL_BYTES` 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`): the `express-lane` row edit must not grow the file by more than ~200 B. Measure `wc -c` after the edit.
- Quoted from `.claude/skills/policy-key-addition/SKILL.md` (governs `policy-schema.js` and `policy-schema.md`):
  - "`plugin/bin/lib/policy-schema.js`'s `POLICY_KEYS` is the data, and `plugin/skills/_shared/policy-schema.md` is the prose index; \"if the two disagree, one of them has a bug\"."
  - "its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`)."
  - "**Changing what an existing value does needs two greps, not one.** Grep the key's kebab-case name across `plugin/skills/`, `docs/journeys/` and `README.md`, then grep its Manifesto display name too". `express-lane` is not a Manifesto lever (no display name in `flow/manifesto-overrides.md`); the kebab-case grep is done below and its hits classified in Task 2.
  - The key count pin is untouched: no key is added or removed.
- Commit messages: `{Verb} {what} — {detail}`, and reference the record as `refs #4591`, never `closes`/`fixes`.

## Review Focus

1. An existing install with `pr-first`, PR CI and `auto:merge` small records starts express-merging on upgrade with no policy edit — the decision record and Release Note must say this plainly (Task 3).
2. A test fixture or suite that resolved policy from an empty `policy.yml` and silently relied on the lane being off now sees it on — Task 1 Step 4 runs every suite naming `express-lane`.
3. A malformed value (`express-lane: off`) now falls back to the default `true` with `invalid: true`, i.e. a typo'd opt-out turns the lane ON — pinned by Task 1's test so the behavior is explicit, and stated in the decision record's Consequences.
4. The `policy-schema.md` row growing past the Read rail — Task 2 Step 3 measures it.
5. A doc describing a conditional (`With express-lane off, …`) being rewritten as if the lane were always on — Task 2 classifies those hits as no-change.

---

### Task 1: Flip the schema default and pin it

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:110-111` (comment above the row, `default`, `summary`)
- Test: `tests/policy-schema.test.js:51-57` (the `express-lane keys resolve their defaults (#4025)` test)

**Interfaces:**
- Consumes: `resolvePolicyKeys(keys: string[], { policyRaw: string, runConfigRaw: string|null })` → `{ [key]: { value, source, invalid? } }` (already imported in the test file).
- Produces: `POLICY_KEYS` row `{ key: 'express-lane', type: 'boolean', default: true, … }`.

- [ ] **Step 1: Write the failing tests**

In `tests/policy-schema.test.js`, rename the existing test to `'AC1.1, AC2.1: express-lane defaults on and a project opts out (#4025, #4591)'` and change/add these assertions (keep the `express-review-sample-every` lines as they are):

```js
assert.deepStrictEqual(resolved['express-lane'], { value: true, source: 'default' });
const optOut = resolvePolicyKeys(['express-lane'], { policyRaw: 'express-lane: false\n', runConfigRaw: null });
assert.deepStrictEqual(optOut['express-lane'], { value: false, source: 'policy' });
const typo = resolvePolicyKeys(['express-lane'], { policyRaw: 'express-lane: off\n', runConfigRaw: null });
assert.strictEqual(typo['express-lane'].value, true, 'a malformed opt-out falls back to the default, on');
assert.strictEqual(typo['express-lane'].invalid, true);
```

Check the exact shape `resolvePolicyKeys` returns for the opt-out and the typo (it may carry extra fields such as `invalid`) by running it once before pinning; use `deepStrictEqual` only where the real reply has exactly those fields, else assert the fields individually.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/policy-schema.test.js`
Expected: FAIL — `express-lane` resolves `{ value: false, source: 'default' }`.

- [ ] **Step 3: Change the row in `plugin/bin/lib/policy-schema.js`**

`default: true`. New `summary`: "Runs the express lane unless set to false: a small, low-risk singleton record builds, tests and merges-on-green in one agent, not the full /flow frame." Update the comment above it from "opt-in" to say the lane is on by default and a project opts out (#4591).

- [ ] **Step 4: Run the tests to verify they pass, plus every suite that names `express-lane`**

Run: `node --test tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/bin-lib/express/cli.test.js tests/bin-lib/express/queue.test.js tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/cli-plan-lane.test.js tests/bin-lib/driver/plan-lane.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-order.test.js tests/flow-claim-preflight.test.js`
Expected: PASS. `tests/bin-lib/express/cli.test.js`'s `harness(fx, {}, { 'express-lane': false })` cases cover AC2.2 (`express-lane.js gate` reports `express-lane disabled` with the lane set false). If any suite fails because a fixture relied on the old default, set `'express-lane': false` explicitly in that fixture (never change the assertion's meaning) and list the file in the commit.

- [ ] **Step 5: Verify AC1.1 and AC2.1/AC2.2 end to end in a scratch directory**

In a scratch dir under the session scratchpad holding `.claude-tweaks/policy.yml` with no `express-lane` key, run `node "<worktree>/plugin/bin/resolve-policy.js" --values express-lane` from that dir → prints `true` (AC1.1). With `express-lane: false` → prints `false` (AC2.1). Scratch only; not committed.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/policy-schema.js tests/policy-schema.test.js
git commit -m "Default express-lane to true — a project opts out with express-lane: false, refs #4591"
```

### Task 2: Sweep the docs to on-by-default

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/policy-schema.md:89` (`express-lane` row: default `true`, meaning)
- Modify: `plugin/skills/_shared/work-record-config.md:27` (same)
- Modify: `plugin/skills/dispatch/configuration.md:12` (same)
- Modify: `docs/getting-started.md:95` ("With `express-lane: true` in `policy.yml` (off by default, `pr-first` only)") and `:139` ("With `express-lane: true`, a singleton group…")
- Modify: `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:29-36` (step "1. Opt in")
- No change (classified): `docs/journeys/route-a-dispatch-singleton-through-the-driver-5232.md:39` ("With `express-lane` off, a refused record takes the normal two-call path") — a conditional, still true; `plugin/skills/dispatch/SKILL.md:248`, `plugin/skills/dispatch/driver-route.md:12,19,30`, `plugin/skills/_shared/express-lane.md:51` — read the resolved value, describe no default.

**Interfaces:**
- Consumes: Task 1's default `true`.
- Produces: nothing code-facing.

- [ ] **Step 1: Run the AC3 grep before the change and record the hits**

Run: `git grep -n -i -E "off by default|opts? (a project )?into the express lane" -- plugin docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`
Expected at base (control, run at plan time): express-lane hits at `plugin/bin/lib/policy-schema.js:111` (Task 1 removes it), `plugin/skills/_shared/policy-schema.md:89`, `plugin/skills/_shared/work-record-config.md:27`, `plugin/skills/dispatch/configuration.md:12`, `docs/getting-started.md:95` and `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:34`; the other hits (`docs/REGISTRY.md:47`, `docs/releasing.md:21`, `plugin/skills/_shared/materiality-floor.md:57`, `worktree-setup*.md`, `backlog/SKILL.md:127`, `capture/SKILL.md:66`, `help/reference-card.md:44`, `docs/superpowers/specs/*`) describe other features and stay. The plan/ledger exclusions are added per #4579.

- [ ] **Step 2: Rewrite each listed site**

- Three skill-doc rows: default cell `` `true` ``; meaning opens "Runs the express lane unless a project sets it `false`:" then the existing "a small, low-risk singleton record …" clause. In `policy-schema.md` the wording must differ from the schema `summary` (Task 1) — e.g. "On unless a project sets `false`: …".
- `getting-started.md:95`: "The express lane is on by default (`pr-first` only; set `express-lane: false` in `policy.yml` to turn it off): `/claude-tweaks:flow #N` for one small eligible record … skips the pipeline."
- `getting-started.md:139`: "Unless `express-lane: false`, a singleton group whose record passes `express-lane.js gate` runs as one express agent call …".
- Journey step 1: retitle "### 1. Check the project can run it"; **Action:** confirm `.claude-tweaks/policy.yml` resolves `integration-model: pr-first` and the repo has PR CI; set `express-lane: false` to turn the lane off. **Should feel:** no switch to flip on a pr-first repo with PR CI. **Should understand:** "The lane is on by default and runs only under `integration-model: pr-first`, with `gh` available." **Red flags:** an express routing note in a run on a repo that set `express-lane: false`; `/flow` reading `express-entry.md` or calling `gh issue view` with the lane set `false`. Also update the **Entry point** line if it implies an opt-in.

- [ ] **Step 3: Verify AC3.1 and the Read rail**

Run: `git grep -n -i -E "off by default|opts? (a project )?into the express lane" -- plugin docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' | grep -i express`
Expected: no output (AC3.1).
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
- Consumes: Task 1's default; the format of `docs/decisions/0040-learned-skills-prs-merge-without-review-once-green.md` (title `# 0041. …`, `Status`/`Date`/`Context` bullets, `## Context`, `## Decision`, `## Alternatives considered`, `## Consequences`).
- Produces: nothing code-facing.

- [ ] **Step 1: Re-check the number is free**

Run: `ls docs/decisions/` and `gh pr list --state open --search "docs/decisions/0041 in:files" --json number`. Use the next free number (0041 unless taken).

- [ ] **Step 2: Write the record**

- **Status:** accepted; **Date:** 2026-11-25; **Context:** #4591 (decision approved 2026-10-30 during #4365's brainstorm).
- Context: the lane (#4025, shipped in #4354) defaulted to `false` and never ran in practice.
- Decision: `express-lane` defaults to `true`; `express-lane: false` opts out.
- Why on, while decision record 0012 ships the top autonomy tier shut: the lane widens no merge authority — it merges only records already carrying `auto:merge` (or a passing `/flow` merge authorization), takes only `risk:low` × `size:low` × `ceremony:fast-lane` records with a `type:*` label and at most 3 Key Files, refuses frontend surfaces, protected paths and `merge-sensitive-paths`, requires `pr-first` and green PR CI, and hands everything else back to the normal path. It removes review ceremony only.
- Post-merge sampling (`express-review-sample-every`, the drain sweep, and #4365's foreground own-PR check) stands in for the skipped review.
- Consequences: existing installs with `pr-first`, PR CI and `auto:merge` small records start express-merging on upgrade without a policy edit; a malformed value (`express-lane: off`) resolves to the default, so it leaves the lane on — opt out with the literal `false`.
- Revisit when: a sampled post-merge review finds a regression an express merge shipped, or sampled reviews file findings on express PRs at a higher rate than on normal-path PRs.
- Do not use the phrase "off by default" (AC3's grep would match it); say "defaulted to `false`".

- [ ] **Step 3: Verify AC4.1**

Run: `grep -c -E "0012|#4365|[Rr]evisit" docs/decisions/0041-express-lane-ships-on-by-default.md` → at least 3 matching lines, one each (AC4.1: exists, cites 0012 and #4365, states a revisit trigger).
Run: `node --test tests/payload-boundary.test.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0041-express-lane-ships-on-by-default.md
git commit -m "Add decision record 0041 — the express lane ships on by default, refs #4591"
```

### Task 4: Full verification

**Role:** transcription

- [ ] **Step 1: AC5.1** — `npm test` passes; run through the pipeline's verification (Common Step 5 / `/claude-tweaks:test`), not hand-rolled.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (default + summary) | Task 1 |
| Deliverable 2 (every listed place; journey opt-in step) | Task 2 |
| Deliverable 3 (decision record) | Task 3 |
| Deliverable 4 (tests) | Task 1 |
| AC1.1 | Task 1 Steps 1, 5 |
| AC2.1 | Task 1 Steps 1, 5 |
| AC2.2 | Task 1 Step 4 (`tests/bin-lib/express/cli.test.js`) |
| AC3.1, AC3.2 | Task 2 Steps 1, 3 |
| AC4.1 | Task 3 Step 3 |
| AC5.1 | Task 4 |
| Technical Approach: check for a test pinning docs table and schema together | Task 1 Step 4 / Task 2 Step 3 run `tests/policy-schema-metadata.test.js` and `tests/policy-key-naming.test.js`, the suites that read both |
| Gotcha: Release Note says it plainly | Task 3 Consequences; the record's own `## Release Note` is reused by the PR |
