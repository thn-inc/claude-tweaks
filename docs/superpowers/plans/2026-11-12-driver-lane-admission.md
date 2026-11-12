# Driver Lane Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pipeline driver's admission side: an `allowAbsentCeremony` option on express eligibility, a pure `evaluateAdmission` module, and three `policyOnly` policy keys — restoring `_shared/policy-schema.md`'s Read-rail headroom so the new doc rows fit.

**Architecture:** `evaluateRecordEligibility` gains one option that changes only its ceremony rule. A new pure module `plugin/bin/lib/driver/admission.js` takes facts its caller already computed with the shared blocker/linked-PR helpers and returns `{ admitted, reasons }`, collecting every failing reason and failing closed on unreadable facts. Three `POLICY_KEYS` rows land with doc rows; three uncited/stub-able prose blocks move out of `policy-schema.md` into a new pointer-stub sibling first.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T104917-spec-5216/work/5216-spec.md` (record #5216)

**Scope keywords:** evaluateRecordEligibility, allowAbsentCeremony, evaluateAdmission, ADMISSION_REASONS, express-driver

## Global Constraints

- Names are pinned for #5218 (built concurrently) — use exactly: `evaluateAdmission`, `ADMISSION_REASONS`, `allowAbsentCeremony`, `express-driver`, `express-driver-wall-clock-minutes`, `express-driver-spend-ceiling-dollars`. "If the build finds one must change, say so in a comment on #5218 before merging."
- `evaluateAdmission({ number, state, labels, openBlockerRefs, openLinkedPRs, routing })` returns `{ admitted: boolean, reasons: string[] }`; `evaluateRecordEligibility`'s return shape `{ number, eligible, reasons, keyFiles }` is unchanged.
- Reason strings, verbatim from the spec: `record lacks auto:build`, `record is parked`, `record is blocked`, `record has an open blocker`, `record has an open PR`, `record is not open`, `blocker facts unreadable`, `open PR facts unreadable`, `record state unreadable`, `express-driver is off`, `express-driver split: issue number is odd`, `express-driver split: issue number unreadable`, template `express-driver value not recognised: {value}`.
- `express-driver`: `enum` `off`/`split`/`on`, default `off`. Ceilings: `integer`, `min: 1`, defaults ≥ the design's targets (≥ 15 minutes, ≥ 5 dollars) — this plan sets **30** and **10**. All three `policyOnly: true`, tier `advanced`.
- AC10: no file under `plugin/skills/` changes except `_shared/policy-schema.md`, the new sibling `_shared/policy-schema-read-path.md`, and `_shared/policy-schema-coverage.md`'s `policyOnly` bullet. `plugin/skills/_shared/express-lane.md` is untouched.
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit style: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01UwjosHjmYr7A5sQtsDnb6o`. Stage named files only.

### Governing project skills (quoted verbatim)

`.claude/skills/policy-key-addition` (Tasks 3–4):
- "**The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived (`_shared/policy-schema.md`'s Derived-default keys, Shapes A and B). `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)."
- "**The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
- "**The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit."
- "**The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
- "**A key that lands before its consumer** opens its `summary` with `Not yet used. ` or `Not yet used; ` and joins `NOT_YET_USED` in `tests/resolve-policy-control-mode.test.js`. That file pins both directions: every listed key carries the marker, and no unlisted key does. The record that wires a key's first consumer drops the marker and the list entry in the same commit." — applies to all three keys: admission takes `routing` as an argument; the first resolver read is #5218's `drive.js`.
- "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s "Canonical read path carve-outs", which lists every key carrying the flag"
- "**Pin each new validation branch with its own assertion.**"

`.claude/skills/blocker-surface-parity` (Task 2):
- "**One predicate decides.** Every surface calls `foreignBlockerBlocks` / `openBlockerRefs` rather than restating the rule: only an exact CLOSED releases; open and unreadable both hold (fail closed)."
- "**Cover both `work-links` modes and both transports** on every row of the table, or say in the row's prose which one the surface does not support and what it prints instead." — admission performs no fetch, so it supports both transports by construction; its tests cover both `work-links` modes.

`.claude/skills/shared-contract-extraction` (Task 3):
- "a **pointer-stub split** — move a whole section into a new sibling `_shared/*.md` file, leave a short pointer paragraph in the original naming the new file, and retarget any test that pins the moved text itself"
- "**When headroom forces a split you did not plan, extract the section with no citers and no byte pins.** … State in the record that the split was headroom-forced, so the next reader does not mistake the new file's boundary for a designed one."
- "**A new `_shared/*.md` file's `docs/skill-graph.md` edge is mandatory; a `docs/plugin-structure.md` mention is a judgment call, not a given.**" — this plan adds the graph row and no `plugin-structure.md` row (that doc carries one curated `_shared` row, not a per-file table).
- "**The rail headroom check is a merge-time check, not only an authoring-time one.**"

Not applicable, with reason: `parse-signal-discipline` (admission parses no prose; its unreadable-fact reasons are explicit inputs), `gh-api-module-pattern` (no shell-out), `bin-source-scan-conformance` (no test reads `plugin/bin` source as text), `lib-module-split` (no module split).

## Review Focus

1. **A record carrying both `ready` and `parked`.** `parseRecordFacets` resolves stage precedence `ready > parked`, so `facets.stage` reads `ready`. Admission must refuse it as parked — check the raw `parked` label, not `facets.stage`. Test owned by Task 2.
2. **A `ceremony:` label the parser does not know, in any case** (`ceremony:fastlane`, `ceremony:Standard`, `Ceremony:fast-lane`). `parseRecordFacets` gives `ceremony: null` for each, identical to an absent label; the raw-label test must use a case-insensitive `^ceremony:` prefix so all three fail. Test owned by Task 1.
3. **Lower-case or padded state** (`'open'`, `'OPEN '`). Only the exact `OPEN` passes; both refuse with `record is not open`, never `record state unreadable` (they are strings). Test owned by Task 2.
4. **`labels` given as gh label objects** (`[{ name: 'auto:build' }]`). Admission must accept both shapes, as `parseRecordFacets` does. Test owned by Task 2.
5. **A non-integer issue number under `on` or `off`.** Only `split` reads the number; under `on` an unreadable number admits, under `off` the reason is `express-driver is off` alone. Test owned by Task 2.

## Headroom arithmetic (measured at base `688c93e31`)

`wc -c plugin/skills/_shared/policy-schema.md` = 52,309; target ≤ 47,250. Three new rows ≈ 1,250 B. Moves (Task 3), each leaving a pointer:

| Block | Lines at base | Bytes | Citers / pins |
|---|---|---|---|
| A. Canonical read path body after the code block: `--values`, `${CLAUDE_PLUGIN_ROOT}` spelling, output envelope + 3 bullets, Derived-default keys (Shape A, Shape B, consolidation note), `--all` | 15–24 and 27–35 (keep line 25, the carve-outs stub) | ≈ 4,330 | Cited by name: `help/policy.md:51` ("Derived-default keys list"), `help/policy.md:57` ("Shape B paragraph"), `docs/journeys/review-project-policy.md:32` ("Shape A/Shape B list"), `help/reference-card.md:165` ("Canonical read path"). None may be edited (AC10), so the stub names each: "Derived-default keys (Shape A, Shape B)". No test pins (checked: `git grep -F` on four moved phrases hits only `plugin/bin/resolve-policy.js:14`, a code comment, and `tests/resolve-policy-cli.test.js:176`, a test name). |
| B. Metadata fields prose: intro paragraph + `summary`/`category`/`tier` bullets | 43–47 | 1,665 | None. Keep the heading and the mapping table (`tests/policy-schema-metadata.test.js` slices `## Metadata fields` for the table). |
| C. Control mode intro, all but the slug sentence | 218 | ≈ 1,010 of 1,114 | None. Keep "Built-in risk slugs: `migrations`, `auth`, `public-contract`, `irreversible-side-effect`." in the section (`tests/resolve-policy-control-mode.test.js:229-237`). |

Projected: 52,309 + 1,250 − (4,330 + 1,665 + 1,010) + stubs ≈ 600 → ≈ 47,150. If Task 4's measurement exceeds 47,250, move D: the "Additional levers" intro paragraph (line 239 at base, 386 B, uncited) behind a one-line pointer — and nothing else.

Deictics that the move breaks (rewrite in the moved text, Task 3 Step 3):
- Shape A: "the derivation's one prose statement lives here (…; the `merge-verification` coverage block below)" → "lives in `_shared/policy-schema-coverage.md`'s `merge-verification` derivation section and `_shared/integration-model.md`'s forge-detection ladder".
- `summary` bullet: "each key's Meaning column in the sections below" → "in `_shared/policy-schema.md`'s key sections"; "duplicated into this file" → "duplicated into `_shared/policy-schema.md`".
- `category` bullet: "The mapping below assigns every key-bearing section of this file" → "`_shared/policy-schema.md`'s Metadata fields mapping table assigns every key-bearing section of that file".

---

### Task 1: `allowAbsentCeremony` on express eligibility

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/express/eligibility.js:98-110` (`evaluateRecordEligibility` opts destructure and the ceremony line)
- Test: `tests/bin-lib/express/eligibility.test.js` (append; existing tests untouched)

**Interfaces:**
- Produces: `evaluateRecordEligibility(issue, { enabled, integrationModel, sensitivePaths, escalated, allowAbsentCeremony })` — `allowAbsentCeremony` boolean, only `=== true` relaxes.

- [ ] **Step 1: Write the failing tests** (reuse the file's `record()`, `OPTS`, `REASONS`; `const DRIVER = { ...OPTS, allowAbsentCeremony: true }`):
  - `AC2.1: with allowAbsentCeremony, an otherwise-eligible record with no ceremony:* label is eligible` — `record(['risk:low','size:low','type:task'])` → `eligible: true`, `reasons: []`.
  - `AC2.2: with allowAbsentCeremony, ceremony:standard is not eligible and names the ceremony reason` — `reasons` deepEqual `[REASONS.ceremony]`.
  - `AC2.3: with allowAbsentCeremony, risk:medium and no ceremony label is not eligible (only ceremony relaxes)` — `reasons` deepEqual `[REASONS.risk]`.
  - `AC2.4: with allowAbsentCeremony, an unrecognised ceremony label is not eligible` — for each of `ceremony:fastlane`, `ceremony:Standard`, `Ceremony:fast-lane`: `reasons` deepEqual `[REASONS.ceremony]` (Review Focus 2).
  - `allowAbsentCeremony: ceremony:fast-lane passes with the option set or absent` — both `eligible: true`.
  - `allowAbsentCeremony: only a literal true relaxes` — `allowAbsentCeremony: 'yes'` with no ceremony label → `[REASONS.ceremony]`.
  - `AC1.1` is the existing file passing unmodified; no new test.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: FAIL after Step 1 — AC2.1 reports `reasons: ['ceremony is not fast-lane']` (the file passes today; Step 1 appends to it).

- [ ] **Step 3: Implement** — destructure `allowAbsentCeremony = false`; replace only the ceremony line. Under `allowAbsentCeremony === true` the rule fails unless no raw label name matches `/^ceremony:/i` (`normalizeLabelNames(labels)`) or `facets.ceremony === 'fast-lane'`; otherwise today's line unchanged. Reason order unchanged. One comment line: the option relaxes only the ceremony rule for the driver lane (design "Eligibility").

- [ ] **Step 4: Run to verify all pass**

Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `Add allowAbsentCeremony to express eligibility — the driver lane accepts an unlabelled ceremony` (eligibility.js + test).

### Task 2: Pure admission module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/admission.js`
- Test: `tests/bin-lib/driver/admission.test.js`
- Read only — Waived `plugin/bin/lib/issues/record-dependencies.js`: the parity tests (Step 1) import its helpers; nothing in it changes.
- Read only — Waived `plugin/bin/lib/issues/cross-repo-states.js`: named by the spec as a shared helper; `bodyForeignBlockers` is the caller's (#5218) fetch step, and the body-text parity fixture builds `foreignByRecord` directly in the shape it returns.

**Interfaces:**
- Consumes: `normalizeLabelNames`, `parseRecordFacets`, `LABELS` from `plugin/bin/lib/issues/record.js`.
- Produces: `module.exports = { ADMISSION_REASONS, evaluateAdmission }`. `ADMISSION_REASONS` is `Object.freeze`d with exactly these keys: `noBuildGrant`, `parked`, `blocked`, `openBlocker`, `openPR`, `notOpen`, `blockerFactsUnreadable`, `prFactsUnreadable`, `stateUnreadable`, `routingOff`, `splitOdd`, `splitUnreadable`, `routingUnknown` (a function `(value) => \`express-driver value not recognised: ${value}\``), values as in Global Constraints. `evaluateAdmission({ number, state, labels, openBlockerRefs, openLinkedPRs, routing }) → { admitted, reasons }`.

- [ ] **Step 1: Write the failing tests.** A base fact set `ADMIT = { number: 5216, state: 'OPEN', labels: ['auto:build', 'ready'], openBlockerRefs: [], openLinkedPRs: [], routing: 'on' }` admits (`{ admitted: true, reasons: [] }`). Then:
  - One test per gate, each asserting `reasons` deepEqual `[thatReason]` from a single mutation of `ADMIT` (so deleting that gate alone turns it red): `AC3.1: no auto:build` → `noBuildGrant`; `AC3.2: the parked stage label` and `AC3.2: bot:parked` → `parked` (two tests); `AC3.3: bot:blocked` → `blocked`; `AC3.4: an open blocker` (`openBlockerRefs: [4816]`) → `openBlocker`; `AC3.5: an open PR` (`openLinkedPRs: [5247]`) → `openPR`; `AC3.6: state CLOSED` → `notOpen`.
  - `AC3.7: ADMISSION_REASONS exports exactly the documented keys` — `Object.keys(ADMISSION_REASONS).sort()` deepEqual the 13 keys above.
  - `Review Focus 1: ready and parked together still refuses as parked` — labels `['auto:build','ready','parked']` → `[parked]`.
  - `Review Focus 3: lower-case or padded state is not open, not unreadable` — `'open'` and `'OPEN '` → `[notOpen]`.
  - `Review Focus 4: gh label objects are accepted` — `labels: [{ name: 'auto:build' }]` admits.
  - `AC4.1: three failing gates yield all three reasons in one call` — no `auto:build` + `bot:blocked` + `state: 'CLOSED'` → all three, in source order.
  - `AC4.2: bot:blocked plus an open blocker yields both reasons`.
  - Three tests, one per fact: `AC5.1 (blocker facts)` — `openBlockerRefs` of `null`, `undefined`, `'4816'` → `[blockerFactsUnreadable]`; `AC5.1 (open-PR facts)` — `openLinkedPRs` of the same three → `[prFactsUnreadable]`; `AC5.1 (state)` — `state` of `undefined`, `null`, `5` → `[stateUnreadable]`.
  - `AC5.2: empty blocker and open-PR arrays mean none` — `ADMIT` (both `[]`) admits; assert it explicitly.
  - `AC6.1: off refuses every record` → `[routingOff]` for even and odd numbers.
  - `AC6.2: split admits even, refuses odd` → `5216` admits; `5217` → `[splitOdd]`.
  - `AC6.3: on admits both`.
  - `AC6.4: an unrecognised routing value is refused by the template` — `'ON'`, `undefined`, `'both'`: reason `startsWith('express-driver value not recognised: ')`, exactly one reason.
  - `AC6.5: split with a missing or non-integer number` — `undefined`, `'5216'`, `5216.5` → `[splitUnreadable]`.
  - `Review Focus 5: only split reads the issue number` — `number: undefined` with `on` admits; with `off` → `[routingOff]` alone.
  - **Parity (spec Technical Approach), both `work-links` modes:** fixtures for one candidate `{ number: 5216, body }` — open local blocker, open foreign blocker, foreign with unreadable state, closed blockers only, no blockers.
    - `parity body-text: admission's blocker verdict matches partitionByOpenBodyBlockers` — call `partitionByOpenBodyBlockers([c], openNumbers, foreignByRecord)`; feed `openBlockerRefs = excluded[0]?.blockedBy ?? []` to `evaluateAdmission`; assert `reasons.includes(openBlocker)` iff the candidate is in `excluded`.
    - `parity native: admission's blocker verdict matches partitionByOpenNativeBlockers` — repoData `{ i5216: node }`; feed `openNativeBlockerRefs(node)`; same iff assertion against `partitionByOpenNativeBlockers`.
    - `parity linked PR: admission's open-PR verdict matches partitionByOpenLinkedPR` — repoData with one OPEN and one MERGED `closedByPullRequestsReferences` node; feed `excludedByOpenPR.map((e) => e.pr)`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/driver/admission.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/driver/admission.js'`.

- [ ] **Step 3: Implement `evaluateAdmission`** in `plugin/bin/lib/driver/admission.js` — header comment naming the design ("Eligibility") and the closed rule: the listed refusals are the complete set; a claimed record (`bot:in-progress`) is deliberately not a gate (the claim step owns it). Pure: no I/O, no `require` of fs/child_process. Check order: grant, parked (raw `LABELS.PARKED` in `normalizeLabelNames(labels)` or `facets.bot.parked`), blocked, blocker facts (`Array.isArray` else unreadable; non-empty → open blocker), PR facts (same), state (`typeof !== 'string'` → unreadable; `!== 'OPEN'` → not open), routing. Never short-circuit. `admitted = reasons.length === 0`.

- [ ] **Step 4: Run to verify all pass**

Run: `node --test tests/bin-lib/driver/admission.test.js`
Expected: PASS, 0 failures. Then prove discrimination: delete the `bot:blocked` check, re-run, see exactly the `AC3.4` (blocked) test red, restore.

- [ ] **Step 5: Commit** — `Add the driver admission verdict — grant, state, blocker, open-PR and routing gates` (admission.js + test).

### Task 3: Restore `policy-schema.md` Read-rail headroom (pointer-stub split)

**Role:** integration

**Files:**
- Create: `plugin/skills/_shared/policy-schema-read-path.md`
- Modify: `plugin/skills/_shared/policy-schema.md` (block A lines 15-24 and 27-35, block B lines 43-47, block C line 218)
- Modify: `docs/skill-graph.md` (one row in the `## help` section's table, after the `bin/resolve-policy.js` row)

**Interfaces:** none in code. The stubs keep these anchors in `policy-schema.md`: `## Canonical read path` (with its opening sentence and code block), the words `Derived-default keys`, `Shape A`, `Shape B`, `## Metadata fields` + mapping table, `## Key naming`, `## Control mode` + the slug sentence.

- [ ] **Step 1: Measure the base.** `wc -c plugin/skills/_shared/policy-schema.md` → expect 52,309 (re-measure if `main` was merged since).
- [ ] **Step 2: Create the sibling** with a top HTML comment in the coverage file's style: sibling of `_shared/policy-schema.md`; blocks moved by #5216 for Read-rail headroom; **headroom-forced, not a designed boundary**. Then three sections in source order: `## Canonical read path — output, derived defaults and --all` (block A verbatim), `## Metadata fields — the three fields` (block B), `## Control mode — how the keys apply` (block C minus the slug sentence).
- [ ] **Step 3: Rewrite the three deictics** in the moved text exactly as listed under "Deictics that the move breaks" above. Grep the sibling for `above`, `below`, `here`, `this file` and resolve any other hit to a named file.
- [ ] **Step 4: Leave the stubs** in `policy-schema.md`, each one paragraph ending "Cite that file, not this stub." (the #4847/#5119 wording):
  - Block A, after the code block: "The `--values` and JSON output formats, the **Derived-default keys** (Shape A, Shape B) and `--all`: moved to `_shared/policy-schema-read-path.md` (#5216, rail headroom)." Line 25's carve-outs stub stays in place.
  - Block B, between the heading and the table: one sentence naming `summary`, `category`, `tier` and pointing at the sibling's Metadata section.
  - Block C, before the table: the slug sentence, then the pointer.
- [ ] **Step 5: Add the skill-graph row** under `## help`: `` | `_shared/policy-schema-read-path.md` | `` — policy mode's derived-default special case (`help/policy.md`) reads Shape A / Shape B membership here, reached through `_shared/policy-schema.md`'s Canonical read path stub; split out by #5216 for rail headroom (headroom-forced, not a designed boundary). No `docs/plugin-structure.md` edit.
- [ ] **Step 6: Verify**

Run: `wc -c plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-read-path.md`
Expected: `policy-schema.md` ≤ 46,000 (≥ 1,250 B under 47,250 for Task 4's rows); sibling well under 52,500.

Run: `node --test tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-control-mode.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/house-structure.test.js`
Expected: PASS, 0 failures.

Run: `git grep -n -F -e "Derived-default keys" -e "Shape B" -- plugin/skills/_shared/policy-schema.md`
Expected: at least one hit (the stub) — a citer following `help/policy.md`'s reference still lands on a name. Control check: run the same grep on `git show 688c93e31:plugin/skills/_shared/policy-schema.md` piped to `grep -n -F -e "Derived-default keys"` — matches line 27.

- [ ] **Step 7: Commit** — `Split three prose blocks out of policy-schema.md — restore Read-rail headroom for the express-driver rows` (both `_shared` files + `docs/skill-graph.md`).

### Task 4: The three `express-driver` policy keys

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:90` (three rows after `express-review-sample-every`, preceded by a `// #5216:` comment naming the driver design and why `policyOnly`)
- Modify: `plugin/skills/_shared/policy-schema.md:121` (three doc rows after `express-review-sample-every`'s)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:101` (the `policyOnly` bullet — find it by its text "are `policyOnly`: the `--run` overlay never applies")
- Test: `tests/policy-schema.test.js` (count pin 100 → 103 with a history comment line, plus new tests), `tests/resolve-policy-control-mode.test.js:294` (`NOT_YET_USED` += the three keys)

**Interfaces:**
- Produces (for #5218): `POLICY_KEYS` rows
  - `{ key: 'express-driver', type: 'enum', values: ['off', 'split', 'on'], default: 'off', policyOnly: true, category: 'merge-safety', tier: 'advanced', summary: 'Not yet used; …' }`
  - `{ key: 'express-driver-wall-clock-minutes', type: 'integer', min: 1, default: 30, policyOnly: true, category: 'merge-safety', tier: 'advanced', summary: 'Not yet used; … in minutes …' }`
  - `{ key: 'express-driver-spend-ceiling-dollars', type: 'integer', min: 1, default: 10, policyOnly: true, category: 'merge-safety', tier: 'advanced', summary: 'Not yet used; … in whole dollars …' }`
  - Each summary: opens `Not yet used; `, ≤ 140 chars, does not contain its own key, states the unit for the two ceilings, and is not copied into the doc row.

- [ ] **Step 1: Write the failing tests** in `tests/policy-schema.test.js`:
  - Bump the count pin to 103 (both asserts) with a comment line `// 100 -> 103, #5216 (pipeline driver admission): express-driver — enum off|split|on, default off; express-driver-wall-clock-minutes, express-driver-spend-ceiling-dollars — integer >= 1, ceilings`.
  - `AC7.1: express-driver resolves off from the default in a fresh project` — `tmpRepo()` with no policy, `spawnSync(process.execPath, [CLI, 'express-driver'], { cwd: repo })`; JSON stdout `['express-driver']` deepEqual `{ value: 'off', source: 'default' }`. Clean up the tmp dir.
  - `AC6/express-driver: each value resolves; a malformed one falls back` — `split` and `on` resolve `source: 'policy'`; `half` → `{ value: 'off', source: 'default', invalid: true }`.
  - `AC8.1: each ceiling resolves its default when unset, at or above the design targets` — wall-clock `{ value: 30, source: 'default' }`, value ≥ 15; spend `{ value: 10, source: 'default' }`, value ≥ 5.
  - `AC8.2: a ceiling below 1, negative or non-integer falls back invalid` — for each key and each of `0`, `-3`, `1.5`, `abc`: `{ value: <default>, source: 'default', invalid: true }`.
  - `AC11.1`–`AC11.3: a run config cannot set {key}` — one test per key: `resolvePolicyKeys([key], { policyRaw: '', runConfigRaw: '<key>: <non-default>\n' })` returns the default with `source: 'default'`; with a `policyRaw` value too, returns the policy value with `source: 'policy'`.
  - `AC8.3: each ceiling's doc row states its unit` — the `policy-schema.md` line starting `` | `express-driver-wall-clock-minutes` | `` includes `minutes`; the `` | `express-driver-spend-ceiling-dollars` | `` line includes `dollars`.
  - `AC11.4: the policyOnly bullet names all three keys` — slice `policy-schema-coverage.md` from the line containing `are \`policyOnly\`` to the end of that line; assert it contains each key in backticks.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/policy-schema.test.js`
Expected: FAIL — count `100 !== 103`, AC7.1 gets `{"error":"unknown-key"}`.

- [ ] **Step 3: Implement** — the three `POLICY_KEYS` rows (Interfaces above); append the three keys to `NOT_YET_USED`; add the three keys to the coverage `policyOnly` bullet's list. Write the three doc rows in `policy-schema.md`'s express block (columns `Key | Canonical home | Owner skill(s) | Default | Meaning`; owner `none yet (#5218)`; canonical home `policy.yml`). Each Meaning states, from the code: unset → the default; a valid set value → that value; malformed → the default with `invalid: true`; that a `--run` config never sets it (`policyOnly`) and why (ceilings bound autonomous spend; `express-driver` routes records to autonomous machinery). `express-driver` also states: `split` admits even issue numbers only; parity is a cheap split, not an unbiased one (numbers cluster by filing batch); `split` is temporary and is removed in favour of `on` or `off` once each arm has 20 merged records, owned by the design's Phase 4 parent record. The ceilings state their unit (minutes; whole dollars) and that `0` never means unlimited (`min: 1`). Keep each row short — the file has to stay ≤ 47,250.

- [ ] **Step 4: Run to verify all pass, and measure (AC9.1, AC9.2, AC10.1)**

Run: `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-control-mode.test.js "tests/bin-lib/skill-audit/*.test.js"`
Expected: PASS, 0 failures (AC9.2; the skill-audit half of AC9.1).

Run: `wc -c plugin/skills/_shared/policy-schema.md`
Expected: ≤ 47,250 (AC9.1). If over, apply move D from the Headroom arithmetic section (and only that) as part of this task and re-run.

Run: `git diff --name-only 688c93e31...HEAD -- plugin/skills`
Expected: exactly `plugin/skills/_shared/policy-schema-coverage.md`, `plugin/skills/_shared/policy-schema-read-path.md`, `plugin/skills/_shared/policy-schema.md` (AC10.1); `git diff 688c93e31...HEAD -- plugin/skills/_shared/policy-schema-coverage.md` changes only the `policyOnly` bullet line.

Prove discrimination: remove `policyOnly: true` from `express-driver-spend-ceiling-dollars`, re-run `tests/policy-schema.test.js`, see exactly its AC11 test red, restore.

- [ ] **Step 5: Record AC evidence** (AC9) — `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, write `wc -c` output to `$PIPELINE_RUN_DIR/evidence/ac9-policy-schema-bytes.txt` with a plain redirect, and log one `AC evidence` line via `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file` naming AC9, the command and the byte count. `$PIPELINE_RUN_DIR` = `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-12T104917-spec-5216` (literal path; plugin root `/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.165.0`).

- [ ] **Step 6: Commit** — `Register the express-driver policy keys — routing plus wall-clock and spend ceilings, all policyOnly` (the five files).

## Final checks (controller, after all tasks)

- AC10: `git diff --name-only 688c93e31...HEAD -- plugin/skills` lists exactly `plugin/skills/_shared/policy-schema.md`, `plugin/skills/_shared/policy-schema-read-path.md`, `plugin/skills/_shared/policy-schema-coverage.md`; and `git diff 688c93e31...HEAD -- plugin/skills/_shared/policy-schema-coverage.md` touches only the `policyOnly` bullet line.
- AC9 is re-measured after any `main` merge (Gotchas: other open records append rows here).
- Comment on #5218 only if any pinned name changed (none planned).
