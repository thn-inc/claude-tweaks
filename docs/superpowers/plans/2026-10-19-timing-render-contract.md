# Timing Render Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Pipeline Summary's `### Timing` render rules into one new `_shared/timing-render.md` contract that the three summary templates cite instead of restating.

**Architecture:** One new markdown contract under `plugin/skills/_shared/` holds the phase-table paragraph, the archive-path `--run` rule, the table skeletons, and the #3375 Dispatches paragraph and tables. Each template keeps its `### Timing` heading and its own `phase-timing.js` invocation (the `--run` variable differs per template) and replaces everything else with one citation line. `tests/timing-prose-conformance.test.js` pins the contract once, pins each template's citation and the retired body's absence, and asserts the contract's tier/role vocabularies equal `derive.js`'s `TIERS` / `ROLE_PATTERNS`.

**Tech Stack:** Markdown skill prose; `node --test` (built-in) with `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T044738-record-3413/work/3413-spec.md` (record #3413)

Scope keywords: sums each dispatch's span, blank token columns are a fact, Timing section's rule, as for Timing

## Global Constraints

- The contract's citation in each template uses the backticked form `` `_shared/timing-render.md` `` (the form these templates already use for `_shared/try-it.md`).
- The `unattributed`-row wording is normalized to "below the phase rows, above `total`" (two-of-three form).
- The Dispatches paragraph and both Dispatches tables are copied byte-for-byte from the current templates.
- `wrap-up/verification-brief.md` is out of scope (its line ~360 is pinned separately by `#3375 M3`).
- `docs/journeys/attribute-agent-cost-to-dispatches-3375.md` needs no edit; the `#1929 AC5` journey entries stay as they are.
- `tests/console-resolve-conformance.test.js` pins `console-residue\.js" --run "\$(PIPELINE_RUN_DIR|MULTISPEC_PARENT_DIR)"` in both flow templates' Needs-a-human paragraph — the repoint must leave that literal intact.
- Commit subjects: `{Verb} {what} — {detail}`, body references `refs #3413` (never `closes`/`fixes`).

## Review Focus

1. A template regaining the retired Dispatches paragraph on a re-wrap (absence checks must run on whitespace-collapsed text) — Task 2 pins it with a collapsed haystack and a frozen control.
2. A profile added to `PROFILES` without updating the contract — Task 1's set-equality test, proven red by an in-memory extra tier.
3. The tier/role parser silently extracting an empty set (vacuous equality) — Task 1 asserts each parsed set is non-empty and proves the parser on a mutated copy.
4. The multispec template's invocation drifting to `$PIPELINE_RUN_DIR` — Task 2 pins each template's own variable exactly.
5. The archive-path back-references pointing at a Timing paragraph that no longer exists — Task 2's AC5 test.

---

### Task 1: Create the `_shared/timing-render.md` contract and pin it

**Files:**
- Create: `plugin/skills/_shared/timing-render.md`
- Modify: `tests/timing-prose-conformance.test.js`
- Test: `tests/timing-prose-conformance.test.js`

**Interfaces:**
- Produces: the contract file path `plugin/skills/_shared/timing-render.md`; test-file helpers `contractTiers(text) -> string[]` and `contractRoles(text) -> string[]` (Task 2 does not use them); a bold-led paragraph opening `**Archive-path rule.**` that Task 2's back-references name as "`_shared/timing-render.md`'s archive-path rule".

- [ ] **Step 1: Write the failing tests** (append to `tests/timing-prose-conformance.test.js`; add `const { TIERS, ROLE_PATTERNS } = require('../plugin/bin/lib/timing/derive.js');` and `const CONTRACT = 'plugin/skills/_shared/timing-render.md';` at the top)

`test('#3413 AC2: the timing-render contract carries the phase-table and Dispatches render rules', …)` — covers AC2.1 and AC2.2; reads `CONTRACT` and asserts, each with its own message:
  - every pattern the current `#3375 AC10.1` test asserts (Tier header, Role header, `dispatches: subagent transcripts not found`, the scope-line literal, the per-dispatch literal, the excluded literal, `not comparable to phase minutes`, `never summed with the phase table`, the placement literal) plus its `doesNotMatch(/rendered verbatim below the Guard denials line/)`;
  - `/tokens: transcript not found/`, `/\| Phase \| Minutes \| Verify \|/`, `/^Guard denials: /m`;
  - the archive rule: `/\*\*Archive-path rule\.\*\*[^\n]*archive\/\{run-id\}\/` as `--run`/`;
  - the normalized placement `/\(below the phase rows, above `total`\)/` and the absence of `/total`'s neighbor rows/`;
  - the header names all three consumers: `wrap-up/summary-template.md`, `flow/summary-template.md`, `flow/multispec-summary.md`.

`test('#3413 AC4: the contract's tier and role sets equal derive.js TIERS and ROLE_PATTERNS', …)` — covers AC4.1, AC4.2, and AC3.1 (in-memory half; Task 2 Step 6 is the revert-and-rerun half):
  - `contractTiers(text)`: slice from `one by model tier (` to the next `), one by role`, return every backticked token (`/`([^`]+)`/g`).
  - `contractRoles(text)`: slice from `one by role (` to the next `)`, split on `, `, trim.
  - `assertVocabMatches(text, tiers, roles)` asserts both parsed arrays non-empty, then `assert.deepStrictEqual(new Set(contractTiers(text)), new Set(tiers), 'contract tier set')` and the same for roles with message `'contract role set'`.
  - Live: `assertVocabMatches(read(CONTRACT), TIERS, [...ROLE_PATTERNS.map((p) => p.role), 'unlabelled'])`.
  - Go-red controls (in memory, each preceded by `assert.notEqual(mutated, original)`): dropping `` `frontier`, `` from the tier list throws `{ message: /contract tier set/ }`; dropping `, lens reviewer` throws `{ message: /contract role set/ }`; the live text against `[...TIERS, 'ultra']` throws `{ message: /contract tier set/ }` (stands in for a new `PROFILES` key).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/timing-prose-conformance.test.js`
Expected: FAIL — `ENOENT` on `plugin/skills/_shared/timing-render.md` in both new tests.

- [ ] **Step 3: Write `plugin/skills/_shared/timing-render.md`**

Structure, in order:
1. `# Timing Render — the Pipeline Summary's Timing Section` and a header paragraph: what it governs (how `bin/phase-timing.js --markdown --auto-transcript` output renders under a `### Timing` heading); `Consumers:` the three templates; each keeps its own heading and invocation line because the `--run` value differs (the citing template's run dir — `$PIPELINE_RUN_DIR`, or `$MULTISPEC_PARENT_DIR` for the multi-spec summary) and cites this file for everything else, restating none of it (#3413).
2. `## Phase table` — the phase-table paragraph from `flow/summary-template.md` line 41 with: the opening rewritten to "Rendered verbatim from the citing template's `phase-timing.js` invocation (#1928) — never composed by hand; …"; the `unattributed`-row parenthetical normalized to `(below the phase rows, above `total`)`; the archive sentence removed from it and placed as its own following paragraph opening `**Archive-path rule.**` — "When wrap-up's cleanup item 8 has already archived the run directory (`wrap-up/cleanup-procedures.md`), pass `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run` instead of the citing template's run dir — the events and manifest travel with the archive. The rule only fires once the run is archived, so it is inert for a summary rendered before cleanup." Then the phase table skeleton (4 lines) and the `Guard denials:` line, byte-identical to today.
3. `## Dispatches` — the Dispatches paragraph and the Tier and Role tables, byte-for-byte from `flow/summary-template.md` lines 51-61.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/timing-prose-conformance.test.js`
Expected: PASS (all tests; the pre-existing template tests still pass because templates are untouched in this task).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/timing-render.md tests/timing-prose-conformance.test.js
git commit -m "Add _shared/timing-render.md contract — one home for the Timing/Dispatches render rules" -m "refs #3413"
```

### Task 2: Migrate the three templates to cite the contract; retarget pins; add graph edges

**Files:**
- Modify: `plugin/skills/wrap-up/summary-template.md` (`### Timing` body, ~lines 101-123)
- Modify: `plugin/skills/flow/summary-template.md` (line 7 Needs-a-human paragraph; `### Timing` body, ~lines 39-61)
- Modify: `plugin/skills/flow/multispec-summary.md` (line 7 Needs-a-human paragraph; `### Timing` body, ~lines 35-57)
- Modify: `tests/timing-prose-conformance.test.js`
- Modify: `docs/skill-graph.md` (`## flow` and `## wrap-up` sections)
- Test: `tests/timing-prose-conformance.test.js`

**Interfaces:**
- Consumes: `CONTRACT`, the `**Archive-path rule.**` paragraph (Task 1).

- [ ] **Step 1: Write the failing tests and retarget the old pins**

Add `const TEMPLATES = { 'plugin/skills/wrap-up/summary-template.md': '$PIPELINE_RUN_DIR', 'plugin/skills/flow/summary-template.md': '$PIPELINE_RUN_DIR', 'plugin/skills/flow/multispec-summary.md': '$MULTISPEC_PARENT_DIR' };`, `const collapse = (s) => s.replace(/\s+/g, ' ');`, and a frozen control `PRE_3413_DISPATCHES` (a string literal holding today's Dispatches paragraph opening through "with overlap kept;", plus today's phase paragraph sentence ending "not a formatting error (#1929).", plus the Tier header row).

`const RETIRED = [/sums each dispatch's span with overlap kept/, /blank token columns are a fact about the run/, /\| Tier \| Dispatches \|/, /rendered verbatim below the Guard denials line/];`

`test('#3413 AC1: each Timing template cites the contract, keeps its own invocation, and no longer restates the body', …)` — covers AC1.1, AC1.2, AC3.2, AC3.3; for each `[f, runVar]`: `### Timing` heading present; `` /`_shared\/timing-render\.md`/ `` present; the invocation regex built from `runVar` (escape `$`) matching `bin/phase-timing.js" --run "{runVar}" --markdown --auto-transcript`; for each `RETIRED` pattern `assert.doesNotMatch(collapse(t), re, `${f} still restates ${re}`)`. Control in the same test: every `RETIRED` pattern except the stale-placement one matches `collapse(PRE_3413_DISPATCHES)` (proves each absence check can go red).

`test('#3413 AC5: the Needs-a-human archive back-references name the contract', …)` — covers AC5.1, AC5.2; for `flow/summary-template.md` and `flow/multispec-summary.md`: `doesNotMatch(/Timing section's rule|as for Timing/)`; slice from `**Needs-a-human residue` to the next `\n\n` and assert it matches `` /`_shared\/timing-render\.md`'s archive-path rule/ ``; and still matches `/console-residue\.js" --run "\$(PIPELINE_RUN_DIR|MULTISPEC_PARENT_DIR)"/`.

Retarget existing tests:
- `#1928 AC6` (both templates) and the multispec `#1928` test: keep the heading and invocation assertions; delete the `| Phase | Minutes | Verify |` assertion from both (now pinned on the contract by Task 1).
- `#1929 AC5`: add the three templates to `noteExempt` with a comment that the note now lives in `_shared/timing-render.md` (#3413) and is pinned by `#3413 AC2`.
- `#3375 AC10.1`: delete it — its patterns now live in `#3413 AC2` (contract) and `#3413 AC1` (per-template stale-placement absence).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/timing-prose-conformance.test.js`
Expected: FAIL after Step 1 — `#3413 AC1` (no citation in any template; retired phrases present) and `#3413 AC5` (`Timing section's rule` / `as for Timing` present).

- [ ] **Step 3: Edit the three templates**

In each template, replace everything between `### Timing` and the next `### ` heading with one placeholder line (keeping one blank line on each side), with the template's own variable:

`{stdout of `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "{runVar}" --markdown --auto-transcript` (#1928), rendered verbatim per `_shared/timing-render.md` — the phase table, its notes, the archive-path `--run` rule, and the Dispatches section; never composed by hand}`

Repoint the back-references:
- `flow/summary-template.md` line 7: `(the Timing section's rule)` → ``(`_shared/timing-render.md`'s archive-path rule)``.
- `flow/multispec-summary.md` line 7: `(the archive path when already archived, as for Timing)` → ``(the archive path when already archived, per `_shared/timing-render.md`'s archive-path rule)``.

- [ ] **Step 4: Add the graph edges in `docs/skill-graph.md`**

- `## flow`: new row `` | `_shared/timing-render.md` | `summary-template.md`'s and `multispec-summary.md`'s `### Timing` sections keep their own `bin/phase-timing.js` invocation (the `--run` value differs per template) and cite this contract for how its output renders — the phase table, the archive-path `--run` rule (which both templates' Needs-a-human residue paragraph also cites), and the Dispatches section (#3413). | `` placed directly after the existing `bin/phase-timing.js` row; append to that row: `` How the output renders is `_shared/timing-render.md` (#3413). ``
- `## wrap-up`: new row `` | `_shared/timing-render.md` | `summary-template.md`'s `### Timing` section keeps its own `bin/phase-timing.js` invocation and cites this contract for how its output renders (#3413) — including the archive-path `--run` rule, which this template did not carry before the extraction. | `` after the existing `bin/phase-timing.js` row; append the same sentence to that row.
- No `|` inside any new cell other than the delimiters.

- [ ] **Step 5: Run tests to verify they pass, then the graph suites and the rail**

Run: `node --test tests/timing-prose-conformance.test.js tests/console-resolve-conformance.test.js tests/skill-graph-dangling-pointer.test.js tests/skill-graph-table-structure.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures.

AC6.1 is covered by `/build` Common Step 5's full `npm test` run (this step runs the named suites only).

- [ ] **Step 6: Prove go-red by reverting (AC3.1, AC3.2, AC3.3)**

For each case, make the edit, run `node --test tests/timing-prose-conformance.test.js`, confirm the named test fails, then restore with `git checkout -- {file}` (restore only the file you edited):
- contract loses `dispatches: subagent transcripts not found` → `#3413 AC2` red;
- contract tier list loses `` `frontier`, `` → `#3413 AC4` red;
- contract role list loses `, plan review` → `#3413 AC4` red;
- `flow/multispec-summary.md` drops `` `_shared/timing-render.md` `` from its Timing line → `#3413 AC1` red;
- `wrap-up/summary-template.md` regains the old Dispatches paragraph (paste it under `### Timing`) → `#3413 AC1` red.

- [ ] **Step 7: Verify AC5's grep**

Run: `grep -n "Timing section's rule\|as for Timing" plugin/skills/flow/`
Expected: no output (grep exit 1).

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/wrap-up/summary-template.md plugin/skills/flow/summary-template.md plugin/skills/flow/multispec-summary.md tests/timing-prose-conformance.test.js docs/skill-graph.md
git commit -m "Cite _shared/timing-render.md from the three summary templates — retire the triplicated Timing prose" -m "wrap-up/summary-template.md now inherits the archive-path --run rule through the contract; it never carried it before, so this is new text in effect for wrap-up (inert until the run dir is archived). refs #3413"
```
