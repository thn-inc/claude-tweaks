# Plan-lane predicate (#6053) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure predicate, `needsNoPlan`, that says from a record's lane bounds alone whether the pipeline driver, the express lane or build's micro-plan path will take it, so `/specify` can skip writing a plan for it.

**Architecture:** The micro-plan gate's rule moves out of `build/micro-plan.md` prose into `plugin/bin/lib/issues/micro-plan-gate.js`. `plugin/bin/lib/driver/plan-lane.js` composes three verdicts, in order: the driver's (the real `evaluateRecordEligibility` with the driver's own `eligibilityOptions`, plus `evaluateAdmission` with grants, blockers, PRs, state, escalation and parity neutralised), the express lane's (`evaluateRecordEligibility` at express options, grant labels neutralised), and the micro-plan gate. A new `plan-lane` verb on `bin/express-lane.js` prints the verdict for one record.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T122528-record-6053/work/6053-spec.md` (GitHub #6053)

## Global Constraints

- Verdict shape: `{lane: 'driver'|'express'|'micro-plan'|null, reason}`; `reason` is a short stable code from the exported `PLAN_LANE_REASONS`.
- Precedence: driver, then express, then micro-plan.
- Ignores grants, blockers, PRs and `express-driver: split` parity; `express-driver: off` means the driver lane never matches; `split` reads as `on`.
- Fail closed: a missing, unreadable or malformed input returns `lane: null` with a `reason` — never falls through to a later lane.
- Advisory: eligible by bounds, not admitted. No I/O in `plan-lane.js` or `micro-plan-gate.js`.
- The driver bounds are read through the helpers admission uses (`eligibilityOptions` from `driver/steps.js`, `evaluateRecordEligibility`, `evaluateAdmission`, `reviewRequired`) — never re-derived — so #6018, #6019 and #6020 are followed when they land.
- Commit subjects: `{Verb} {what} — {detail}`, body `refs #6053`, last line `Claude-Session: https://claude.ai/code/session_01QXpjcTg72ute5piR7pVugP`.
- Test names cite the AC clause they cover: `AC1.1`, `AC2.1`, `AC3.1`, `AC4.1`, `AC6.1` (precedence), `AC6.2` (`split` reads like `on`), `AC6.3` (missing Key Files / unreadable bound → null). see the Waived line below.

Waived AC5.1: `npm test` passing is Common Step 5's verification run, not a task test.
- Governing rules, quoted verbatim:
  - `parse-signal-discipline`: "**Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't apply" … Never reuse the same `null`/`undefined`/`[]` for both." — so `extractKeyFileEntries` distinguishes absent (`null`), unparseable (`unparsed > 0`) and parsed-to-zero (`entries: []`, `unparsed: 0`), and micro-plan.md's "could not parse" and "parsed to zero" are distinguishable and only the latter satisfies condition 3 holds in code.
  - `prose-code-twin-pin`: "either two imported constants … or the prose table parsed row-for-row against the imported constant when the vocabulary's canonical form lives in the prose itself. Either shape is a real pin; a test only asserting that individual literal strings are *present* somewhere is not".
  - `skill-prose-conformance-tests`: "A pinned constant must be load-bearing. An exported list that nothing else reads pins prose against a dead value and stays green forever" — `evaluateMicroPlanGate` builds `failed` from `MICRO_PLAN_CONDITIONS`; "Apply the whitespace-collapsed control scan to **both** directions of a migration suite — absence assertions need it more than presence ones" — Task 4's absence regexes run on `s.replace(/\s+/g, ' ')`; "Prove the assertion can go red before trusting its green".
  - `gh-api-module-pattern` (CLI wrapper contract): the verb keeps `cli.js`'s Combined-2 exit vocabulary and "Every side effect goes through `deps`".

## Review Focus

1. A health-origin record (`by:code-health` label) whose Key Files come from its origin header and whose body has no `### Key Files` section: the predicate must read `lane: null`, `key-files-missing`, not a driver or express verdict built from the header. Test in Task 2.
2. An unreadable policy bound (`express-driver-max-size: 'huge'`, `express-driver-max-key-files: 0`) on a record the express lane would take: must read `lane: null`, `policy-unreadable`, never `express`. Test in Task 2.
3. `express-driver: split` with an odd issue number in the labels' record: reads `driver` (parity ignored). Test in Task 2.
4. A grant-only or state-only difference (`auto:merge-pending`, `bot:blocked`, `parked`) must not change the lane. Test in Task 2.
5. A malformed `Risk-flags:` line: `lane: null`, `risk-flags-unreadable`. Test in Task 2.

---

### Task 1: Micro-plan gate in code

**Role:** integration · **Review risk:** medium

**Files:**
- Modify: `plugin/bin/lib/issues/grouping.js` (add `extractKeyFileEntries`; `extractKeyFilesSection` becomes a map over it)
- Create: `plugin/bin/lib/issues/micro-plan-gate.js`
- Test: `tests/bin-lib/issues/grouping.test.js`
- Test: `tests/bin-lib/issues/micro-plan-gate.test.js`

**Interfaces:**
- Produces: `extractKeyFileEntries(body: string) -> {entries: Array<{path: string, note: string}>, unparsed: number} | null` — `null` when `extractSection(body, 'Key Files')` finds no section; otherwise `entries` holds one entry per list item `extractKeyFilesSection` accepts today (same `LIST_ITEM_RE`, first backticked span, placeholder skip), `note` being the item text after that span, trimmed, and `unparsed` counts list items with no backticked span, plus 1 when the section has non-blank text but no list item at all (template-placeholder items are not counted). `extractKeyFilesSection(body)` returns `r ? r.entries.map((e) => e.path) : []`, byte-identical behavior.
- Produces (`micro-plan-gate.js`): `MICRO_PLAN_CONDITIONS = Object.freeze(['fast-lane-ceremony', 'low-size', 'implementation-file-limit', 'no-risk-flag'])`; `MAX_IMPLEMENTATION_FILES = 1`; `countImplementationFiles(entries) -> number`; `evaluateMicroPlanGate({labels, keyFileEntries, body}) -> {passes: boolean, failed: string[], unreadable: null|'labels'|'key-files'|'risk-flags'}`.

- [ ] **Step 1: Write the failing tests**

`grouping.test.js`, `extractKeyFileEntries`:
- a body with no `### Key Files` heading → `null`; a heading followed directly by the next heading → `{entries: [], unparsed: 0}`; a heading with prose but no list → `unparsed: 1`; ``- plain/path.js no backticks`` → `unparsed: 1`.
- ``- `plugin/a.js` — new predicate`` → `{entries: [{path: 'plugin/a.js', note: '— new predicate'}], unparsed: 0}`.
- for the existing `extractKeyFilesSection` fixtures in the file, `extractKeyFilesSection(b)` deep-equals `extractKeyFileEntries(b)?.entries.map(e => e.path) ?? []`.

`micro-plan-gate.test.js`:
- `countImplementationFiles` counts `plugin/bin/x.js` and `plugin/skills/build/a.md` (prompt prose) as 1 each; counts 0 for `tests/x.test.js`, `docs/notes.md`, `docs/plans/diagram.html`, and for an entry whose note matches `read only`, `read-only` or `no change` (any case) — the #3696 shape ``- `bin/check-staged-stack.js` — CLI exit path (read only, no change)``.
- `evaluateMicroPlanGate` passes for labels `['ceremony:fast-lane', 'size:low']`, one implementation entry plus one test entry, body `Risk-flags: none`; and with zero implementation entries.
- fails with `failed: ['fast-lane-ceremony']` for `ceremony:standard`; `['low-size']` for `size:medium`; `['implementation-file-limit']` for two implementation entries; `['no-risk-flag']` for `Risk-flags: auth`.
- `keyFileEntries: null` or `{entries: [...], unparsed: 1}` → `{passes: false, unreadable: 'key-files'}`; `labels` not an array → `unreadable: 'labels'`; a malformed `Risk-flags:` line (`parseRiskFlags(...).status === 'unknown'`) → `unreadable: 'risk-flags'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/micro-plan-gate.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/issues/micro-plan-gate'"

- [ ] **Step 3: Implement**

`extractKeyFileEntries` in `grouping.js`, exported beside `extractKeyFilesSection`. `micro-plan-gate.js` reads `size`/`ceremony` via `parseRecordFacets` (`../issues/record`), the count via `computeDiffFacts(paths.map((p) => ({path: p, additions: 0, deletions: 0}))).implFiles` (`../dispatch/ceremony-derive`) after dropping read-only entries (`/\b(read[ -]only|no change)\b/i` on `note`), risk via `parseRiskFlags` (`./record-risk-flags`). Its header comment carries the counting rule and the #3696 read-only story that `micro-plan.md` condition 3 now cites (Task 4). `failed` lists every failing condition id in `MICRO_PLAN_CONDITIONS` order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/issues/grouping.test.js`
Expected: PASS

- [ ] **Step 5: Revert check** — temporarily drop the read-only filter and confirm the #3696 case goes red; restore.

- [ ] **Step 6: Commit** — `Move the micro-plan gate rule into code — micro-plan-gate.js and extractKeyFileEntries`

### Task 2: The plan-lane predicate

**Role:** judgment · **Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/plan-lane.js`
- Test: `tests/bin-lib/driver/plan-lane.test.js`
Waived plugin/bin/lib/driver/admission.js: read only — Step 3 calls evaluateAdmission and re-reads it first in case #6018/#6019 landed.
Waived plugin/bin/lib/express/eligibility.js: read only — Step 3 calls evaluateRecordEligibility and the bound readers and re-reads it first in case #6018/#6019/#6020 landed.
- Read only: `plugin/bin/lib/driver/steps.js` (`eligibilityOptions`), `plugin/bin/lib/driver/review.js` (`reviewRequired`)

**Interfaces:**
- Consumes: Task 1's `extractKeyFileEntries` and `evaluateMicroPlanGate`.
- Produces: `POLICY_KEYS` (frozen: `express-driver`, `express-driver-max-size`, `express-driver-max-key-files`, `express-driver-review`, `express-lane`, `integration-model`, `merge-sensitive-paths`); `PLAN_LANE_REASONS` (frozen map, values: `inside-driver-bounds`, `inside-express-bounds`, `passes-micro-plan-gate`, `outside-every-lane`, `labels-unreadable`, `body-unreadable`, `key-files-missing`, `key-files-unreadable`, `policy-unreadable`, `risk-flags-unreadable`); `needsNoPlan({labels, keyFiles, body, policy}) -> {lane, reason}`, where `keyFiles` is `extractKeyFileEntries(body)`'s result and `policy` is resolve-policy's `{key: {value, source}}` object.

- [ ] **Step 1: Write the failing tests**

Fixture helper: a spec-shaped body (`Surface: infra`, `Risk-flags: none`, the sections `shapeGate` needs, `### Key Files` with N backend paths) plus labels; a policy builder defaulting to `express-driver: on`, `express-driver-max-size: medium`, `express-driver-max-key-files: 5`, `express-driver-review: beyond-express`, `express-lane: true`, `integration-model: pr-first`, `merge-sensitive-paths: []`.
- AC1.1: a record inside the driver bounds (`risk:low`, `size:medium`, no ceremony label, `type:feature`, 4 Key Files) with `express-driver: on`, no `auto:build`, labels carrying `bot:blocked` → `{lane: 'driver', reason: 'inside-driver-bounds'}`.
- AC6.2: `express-driver: split` gives the same; `express-driver: off` on a record the express lane takes (`ceremony:fast-lane`, `size:low`, 2 Key Files) → `express`.
- AC2.1: `express-lane: false`, `express-driver: off`, `ceremony:fast-lane`, `size:low`, one implementation Key File + one test → `micro-plan`.
- AC3.1: `risk:high` record → `{lane: null, reason: 'outside-every-lane'}`.
- AC6.1 precedence: a record inside driver, express and micro-plan bounds → `driver`; with `express-driver: off` → `express`.
- AC6.3 fail closed: `keyFiles: null` → `key-files-missing`; `keyFiles: 'x'` or `{entries: [], unparsed: 1}` → `key-files-unreadable`; `labels: null` → `labels-unreadable`; `body: 7` → `body-unreadable`; `express-driver-max-size: 'huge'` or `express-driver-max-key-files: 0` or a missing policy key or `express-driver: 'sometimes'` → `policy-unreadable`; malformed `Risk-flags:` → `risk-flags-unreadable`.
- Review Focus 1 (health-origin, no section), 4 (`auto:merge-pending`, `parked` do not change the lane).
- Parity (spec Deliverable 5): over a matrix of at least 12 records × 3 policies (vary size, ceremony label presence/value, risk, Key File count 1/4/6, a protected path such as `plugin/skills/_shared/x.md`, frontend surface, `express-driver-review` on/off/beyond-express), assert `needsNoPlan(...).lane === 'driver'` iff `evaluateRecordEligibility({body, labels: neutral}, eligibilityOptions(policy)).eligible && evaluateAdmission({state: 'OPEN', labels: neutral, openBlockerRefs: [], openLinkedPRs: [], routing: split→on, driverEscalated: false, keyFiles, bounds: {sizeCeiling, maxKeyFiles}, reviewerOn: reviewRequired(...).on, buildAuthority: 'typed'}).admitted`, computed in the test from the real modules; at least one matrix row must land on each side.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/driver/plan-lane.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/driver/plan-lane'"

- [ ] **Step 3: Implement `needsNoPlan`**

Order: validate inputs (labels array, body string, keyFiles null → missing / non-array → unreadable, every `POLICY_KEYS` entry an object with `value`, `express-driver` in off/split/on, `express-driver-review` in off/on/beyond-express, `isReadableSizeCeiling`/`isReadableKeyFileLimit` on the two bounds, `express-lane` boolean, `integration-model` non-empty string), then `parseRiskFlags(body).status === 'unknown'` → `risk-flags-unreadable`. Neutral labels: `normalizeLabelNames(labels)` minus `auto:*`, `bot:*` and `LABELS.PARKED`. Driver (skipped when `express-driver` is `off`): eligibility with `{...eligibilityOptions(policy), escalated: false}` and admission as in the parity assertion. Express (skipped when `express-lane` is not `true`): `evaluateRecordEligibility({body, labels: neutral}, {enabled: true, integrationModel, sensitivePaths: sensitivePathsOf(...), escalated: false})`. Micro-plan: `evaluateMicroPlanGate({labels, keyFileEntries: keyFiles, body}).passes`. Header comment states the advisory meaning and why each neutralised fact is ignored.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/plan-lane.test.js`
Expected: PASS

- [ ] **Step 5: Revert check** — make the driver branch ignore `reviewRequired` (pass `reviewerOn: true`) and confirm a parity row goes red; restore.

- [ ] **Step 6: Commit** — `Add the plan-lane predicate — which plan-less lane a record's bounds admit`

### Task 3: `plan-lane` verb on express-lane.js

**Role:** integration · **Review risk:** medium

**Files:**
- Modify: `plugin/bin/lib/express/cli.js` (verb, USAGE line, VERB_FLAGS, HANDLERS, header comment "Five verbs" → six)
- Test: `tests/bin-lib/express/cli-plan-lane.test.js` (new file; the existing `cli.test.js` fake-deps setup is the model)

**Interfaces:**
- Consumes: Task 2's `needsNoPlan`, `POLICY_KEYS`; Task 1's `extractKeyFileEntries`.
- Produces: `express-lane.js plan-lane (--issue <n> | --record-json <file>) [--repo owner/name]` → stdout one JSON line `{"number":n,"lane":…,"reason":…}`, exit 0 whatever the lane; 1 fetch or policy-read failure; 2 usage error, unreadable `--record-json`, or `gh` absent with `--issue`.

- [ ] **Step 1: Write the failing tests** in the new file (fake `deps` as `cli.test.js`'s gate tests do): `--record-json` with a micro-plan-shaped record and a fake `resolvePolicy` → exit 0, `lane: 'micro-plan'`, and `resolvePolicy` called with exactly `POLICY_KEYS`; both flags or neither → exit 2; `--issue` with `ghAvailable: () => false` → exit 2; `resolvePolicy` throwing → exit 1.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/express/cli-plan-lane.test.js`
Expected: FAIL with "unknown verb: plan-lane"

- [ ] **Step 3: Implement `runPlanLane(deps, flags)`** reusing the file's `fetchIssue`, `readJsonFile`, `validRecord`, `ghPresent`; `keyFiles = extractKeyFileEntries(body)`. Require `../driver/plan-lane` **inside** `runPlanLane`, never at the top of `cli.js`: `driver/steps.js` (which `plan-lane.js` loads for `eligibilityOptions`) already loads `express/cli.js` transitively (measured at plan time), so a top-level require is a cycle that hands one side a partial `module.exports` — the file's existing in-function `require('../run-manifest/write')` is the precedent. Sweep `grep -rn "Five verbs\|express-lane.js gate (--issue" plugin docs tests` and update any verb list it finds.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/express/cli-plan-lane.test.js tests/bin-lib/express/cli.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe** — run `node plugin/bin/express-lane.js plan-lane --issue 6053` (expected `lane: null`, `outside-every-lane`: `ceremony:standard`, five Key Files, and this repo's `express-driver` resolves `off`) and the same against one closed `ceremony:fast-lane` record found with `gh issue list --state closed --label ceremony:fast-lane --limit 5 --json number`; reconcile each printed lane by hand against the record's labels, Key Files and `Risk-flags:` line, and write both commands and outputs to `$PIPELINE_RUN_DIR/evidence/plan-lane-probe.txt` (`mkdir -p` first, plain Bash redirect) and one `log-decision.js --status AUTO --step "AC evidence"` entry citing it.

- [ ] **Step 6: Commit** — `Add express-lane.js plan-lane — print the plan-lane verdict for one record`

### Task 4: micro-plan.md cites the code

**Role:** transcription · **Review risk:** medium

**Files:**
- Modify: `plugin/skills/build/micro-plan.md` (condition 3, the fall-through paragraph's count, the SKIP log text)
- Modify: `plugin/skills/build/SKILL.md:104`, `docs/skill-graph.md:151`, `docs/plugin-structure.md:193` (drop the restated count, cite `micro-plan.md`'s gate)
- Modify: `tests/build-micro-plan-conformance.test.js` (retire its `/### Key Files.*at most one implementation file/s` assertion, which the new file replaces)
- Test: `tests/build-micro-plan-code-twin.test.js` (new file)
- Modify: `tests/bin-lib/dispatch/ceremony-derive.test.js:183-194` (micro-plan.md no longer restates `PROMPT_PROSE_DIRS`; keep `wrap-up/ceremony-derivation.md`)
- No change: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (a design doc recording the rule as it stood; not shipped prose) and `docs/decisions/0017-*` (the diff-ceiling's own, separate one-file bound)

**Interfaces:**
- Consumes: Task 1's `MICRO_PLAN_CONDITIONS`, `MAX_IMPLEMENTATION_FILES`, `countImplementationFiles`.

- [ ] **Step 1: Write the failing test** `AC4.1: micro-plan.md cites micro-plan-gate.js and restates no count` in the new `tests/build-micro-plan-code-twin.test.js`: the numbered items under `## Applicability gate` (up to `**Any other header shape**`) are exactly `MICRO_PLAN_CONDITIONS.length` items, item i carrying `` (`{MICRO_PLAN_CONDITIONS[i]}`) ``; the gate section names `bin/lib/issues/micro-plan-gate.js`, `MAX_IMPLEMENTATION_FILES` and `countImplementationFiles`; the whole file matches none of `/at most one implementation file/i`, `/two or more implementation files/i`, `/<=\s*1 implementation/i`. In `build-micro-plan-conformance.test.js`, delete the old `/### Key Files.*at most one implementation file/s` assertion (its test keeps its other four matches). Keep every phrase `tests/risk-flags-bypass-prose.test.js` pins (`All four must hold`, `4. The spec body does not carry a risk flag`, `` `parseRiskFlags` ``, `a spec body that carries a risk flag`).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/build-micro-plan-code-twin.test.js`
Expected: FAIL

- [ ] **Step 3: Edit the prose.** Condition 3 becomes: the `### Key Files` section names no more implementation files than `MAX_IMPLEMENTATION_FILES`, counted by `countImplementationFiles` in `bin/lib/issues/micro-plan-gate.js`, whose header comment says which entries count; zero still qualifies. Each condition ends with its id. The fall-through paragraph says "more implementation files than condition 3 allows"; the SKIP text reads `implementation-file limit met`. Then edit the three restating lines and the ceremony-derive twin test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/build-micro-plan-code-twin.test.js tests/build-micro-plan-conformance.test.js tests/risk-flags-bypass-prose.test.js tests/bin-lib/dispatch/ceremony-derive.test.js tests/log-decision-text-file-sites-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Cite the micro-plan gate's code from micro-plan.md — the count is no longer restated`

## Self-review

- Spec coverage: Deliverable 1 → Task 2; 2 → Task 3; 3 → Task 2's tests; 4 → Tasks 1 and 4; 5 → Task 2's parity test. ACs 1-3 and 6 → Task 2; AC4 → Task 4; AC5 → Common Step 5.
- Placeholders: none.
