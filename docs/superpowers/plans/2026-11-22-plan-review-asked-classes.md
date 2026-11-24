# Plan-review asked classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `planning-decisions: ask-all | asked-classes` policy value and a shared rule so build-time plan review settles every needs-human spec gap except design-level, hard-to-undo and contradictory ones, while the default `ask-all` leaves today's plan review byte-identical.

**Architecture:** One shared rule file (`plugin/skills/_shared/planning-decisions.md`) owns the three asked classes, the settled path, the doubt rule, line forms and asking format. `plugin/skills/build/plan-review.md` gains one marker-delimited pointer paragraph; the `asked-classes` routing lives in a new lazily read sub-file, `plugin/skills/build/plan-review-asked-classes.md`. Class (b) adds a missing risk flag through a new `add` verb on `plugin/bin/risk-flags.js`, which wraps the lib's existing add-only writer `addRiskFlags` (no classifier floor — `settle --add` was probed on this spec and re-added `auth` from the spec's own prose).

**Tech Stack:** Markdown skill prose, Node 18+ CommonJS CLI, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T122522-spec-6051/work/6051-spec.md` (worktree copy)

## Global Constraints

- Base for every byte comparison: `483adc1d58d370d20e8dc54512884ae94f061994` (origin/main after this worktree's catch-up). `plugin/skills/build/plan-review.md` there is 27,585 B.
- Default `ask-all` (today). With `planning-decisions` unset, every plan-review path, prompt and log line is byte-identical to today's (spec AC1). The reviewer's dispatch prompt is never changed (spec Non-Goals: "Changing the reviewer's brief beyond what the routing needs").
- `_shared/planning-decisions.md` is the only file stating the three classes; plan-review.md cites it (spec AC5).
- The live record body is never edited (spec Deliverable 3).
- Do not set `planning-decisions: asked-classes` in this repository's `.claude-tweaks/policy.yml` (spec Gotcha: not before #6054 has merged).
- Rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Measured at base: `plugin/skills/_shared/policy-schema.md` 51,733 B (767 B headroom — the new doc row must stay ≤ 500 B); `plugin/skills/_shared/auto-mode-contract.md` 47,732 B (spec Gotcha: "keep the narrowed HARD-GATE row to a short pointer at `_shared/planning-decisions.md`"); `plugin/skills/_shared/policy-schema-coverage.md` 44,519 B; `plugin/skills/build/plan-review.md` 27,585 B. Re-measure with `wc -c` after each edit and record the headroom in the task's commit message body.
- Expand-contract (spec Deliverable 11), probed during planning: the installed 6.175.0 `resolve-policy.js`, run in a repo whose `policy.yml` carries `planning-decisions: asked-classes`, printed nothing for `--values planning-decisions` (exit 0), still resolved `auto-mode` normally, and `--audit` returned only `{"error":"unknown-key"}` for the bad key name. An older build therefore ignores the value and keeps today's behaviour.
- Commit style: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01QXpjcVrZPTQPxJpVC8FWwR`.

Governing project skills, quoted verbatim:

- `.claude/skills/policy-key-addition` (Task 2):
  - "**The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived"
  - "`summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)."
  - "**The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
  - "**The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin."
  - "**The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s \"Canonical read path carve-outs\", which lists every key carrying the flag"
  - "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record."
  - "A key whose every consumer reads `policy.yml` directly, never through `resolve-policy.js --run`, is `policyOnly`: an overlay would let `resolve-policy.js --run` report a value no consumer reads." … "Say the decision in the comment above the row, as both of those do."
  - "\"Lands\" means merges: a key whose first consumer arrives in a later task of the same PR merges together with it, so it takes no marker" (so no `Not yet used.` opener and no `NOT_YET_USED` entry).
  - "An invalid value resolves to the default with `invalid: true`."
- `.claude/skills/skill-prose-conformance-tests` (Tasks 3-5):
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message**"
  - "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself." (`tests/helpers/conformance-asserts.js`: `missingFactsOf`, `assertEachPatternGoesRed`.)
  - "Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice."
  - "Freeze the input" for a byte-identity comparison: "commit the file verbatim at the last pre-deletion commit as a fixture under `tests/fixtures/`".
- `.claude/skills/gh-api-module-pattern`, `bin-source-scan-conformance`, `parse-signal-discipline`, `record-body-line-addition` name `risk-flags.js` but add no rule for this change: Task 1 adds no `gh`/`git` call, no spawn, no new body line kind and no new signal parser — it reuses the CLI's existing `run(argv, deps)` seam, exit-code vocabulary (0 done / 1 body unreadable / 2 malformed invocation or policy / 3 body unwritable) and `addRiskFlags`.
- `.claude/skills/shared-contract-extraction` concerns moving existing prose into `_shared/`; Task 3 creates a new shared file from new prose, so only its "cite, never restate" rule applies, carried by spec AC5.

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC6.1 | Task 6 — Common Step 5's verification run and the PR's CI full run |

Waived .claude-tweaks/policy.yml: read only — Global Constraints forbids setting `planning-decisions: asked-classes` there before #6054 merges; no task writes it, and Task 4's Step 4 confirms the file is untouched with `git diff --quiet 483adc1d58d370d20e8dc54512884ae94f061994 -- .claude-tweaks/policy.yml`.

## Review Focus

1. `resolve-policy.js --values planning-decisions` prints nothing, an invalid value, or exits non-zero → plan review takes today's `ask-all` path, never `asked-classes` (fail toward asking). Pinned in Task 4.
2. The worktree spec's `Risk-flags:` line is unreadable or names an unknown slug when class (b) adds a flag → `add` still only adds (the lib widens a malformed line, never drops), exits 0. Tested in Task 1.
3. `risk-flags.js add` exits non-zero during class (b) → the question is still asked and a `SKIP` is logged; a failed add never turns an asked row into a settled one. Pinned in Task 4.
4. A dispatched call under `asked-classes` whose every needs-human row settles → no `BLOCKED`, no question comment, the build continues to Task 1 with the settled lines committed. Pinned in Task 4.
5. A row for which no reading keeps every Acceptance Criterion and recorded decision intact (class (c)) → asked, never settled by the closer-to-intent rule. Pinned in Tasks 3 and 4.

---

### Task 1: `risk-flags.js add` — add-only flag writer for plan review

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/risk-flags.js` (header comment block, `USAGE`, `VERB_FLAGS`, `parseArgs`, `run`)
- Modify: `docs/plugin-structure.md:421` (the `risk-flags.js <classify|settle|confirm>` command line — add `add`)
- Test: `tests/risk-flags-cli.test.js`

**Interfaces:**
- Produces: `node bin/risk-flags.js add --body-file <f> --add a,b [--repo-root <dir>]`. Rewrites `--body-file` in place through `record.addRiskFlags(body, slugs, { unconfirmed: true, extraCategories })` and prints one JSON line `{ flags, added, unconfirmed, status }`: `flags` = the body's flags after the write (`record.parseRiskFlags(next, { extraCategories }).flags`), `added` = the `--add` slugs the body did not already carry, `unconfirmed` = the written marker state, `status` = the entry status of the body as read (`ok` | `unknown` | … as `settle` reports it). Runs no classifier. Never removes a flag. `--add` is required for `add`; an `--add` slug outside `known` (built-ins plus policy `risk-categories`) exits 2 with the existing `--add names "…", which is not a known category (…)` message. Exit codes unchanged: 1 body unreadable, 2 malformed/policy, 3 body unwritable.

- [ ] **Step 1: Write the failing tests** in `tests/risk-flags-cli.test.js`, through the file's existing `exec`/`rawFile` helpers and `NO_POLICY_ROOT`:
  - `test('AC4.2: add appends the named slug to an existing flag set and never drops one', …)` — body `# t\n\nSurface: infra\nRisk-flags: migrations\n\n## Overview\nmentions auth tokens\n`; `exec(['add', '--body-file', f, '--add', 'public-contract', '--repo-root', NO_POLICY_ROOT])` → exit 0; envelope `flags` deepEqual `['migrations', 'public-contract']`, `added` deepEqual `['public-contract']`; the rewritten file's `parseRiskFlags(...).flags` is the same set.
  - `test('AC4.2: add runs no classifier floor — prose naming auth adds nothing beyond --add', …)` — body `Risk-flags: none` plus Overview prose `rotate the auth session token` (it trips the keyword floor under `classify`); `add --add migrations` → `flags` deepEqual `['migrations']`.
  - `test('AC4.2: add on a slug the body already carries is a no-op for the flag line', …)` — `Risk-flags: auth`, `--add auth` → `flags` `['auth']`, `added` `[]`.
  - `test('add on an unreadable flag line widens it and still only adds', …)` — `Risk-flags: ???` → exit 0, `flags` includes every built-in (`migrations`, `auth`, `public-contract`, `irreversible-side-effect`) and `added` names the `--add` slug only when it was not already in the widened set.
  - `test('add refuses an unknown slug and a missing --add', …)` — `--add zzz-unknown` → exit 2, stderr matches `/not a known category/`; `add --body-file f` with no `--add` → exit 2, stderr matches `/--add/`; in both the file is byte-unchanged.
  - `test('add writes the unconfirmed marker', …)` — after any successful add the file contains a line `Risk-flags-unconfirmed: true` and the envelope's `unconfirmed` is `true`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/risk-flags-cli.test.js`
Expected: FAIL — the new tests report exit 2 with `unknown verb: add`.

- [ ] **Step 3: Implement the `add` verb in `plugin/bin/risk-flags.js`.** Add `add: ['--body-file', '--add', '--repo-root']` to `VERB_FLAGS`; in `parseArgs`, for `add` require `--add` (`'add needs --add a,b'`) after the existing `--body-file` check; in `run`, treat `add` like `confirm` for the classifier (skip `classifyRiskFlags`) but keep the `unknownAdd` check, then `next = record.addRiskFlags(body, o.add, { unconfirmed: true, extraCategories })`, write it when it differs, and emit the envelope above. Extend the header comment with an `add` paragraph (what it writes, that it runs no classifier and never removes, and that `/build`'s plan review is its caller — `build/plan-review-asked-classes.md`), the `USAGE` string, and the "a verb is required" error's verb list. Update `docs/plugin-structure.md:421` to `<classify|settle|confirm|add>` with `add` named as plan review's add-only verb in that line's trailing comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/risk-flags-cli.test.js tests/risk-flags-writer-conformance.test.js tests/risk-flags-prose-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/risk-flags.js docs/plugin-structure.md tests/risk-flags-cli.test.js
git commit -m "Add risk-flags.js add — an add-only flag writer with no classifier floor" -m "Claude-Session: https://claude.ai/code/session_01QXpjcVrZPTQPxJpVC8FWwR"
```

### Task 2: `planning-decisions` policy key

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new `POLICY_KEYS` row, with a decision comment above it)
- Modify: `plugin/skills/_shared/policy-schema.md` (one doc row, ≤ 500 B)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (`policyOnly` bullet in "Canonical read path carve-outs")
- Modify: `docs/journeys/resolve-a-policy-key.md:48` (step 3 Red flags `policyOnly` list: add `planning-decisions`, #6051)
- Test: `tests/policy-schema.test.js` (count 118 → 119, `Last bump: 118 -> 119, #6051`), `tests/policy.test.js`

**Interfaces:**
- Produces: `POLICY_KEYS` row `{ key: 'planning-decisions', type: 'enum', values: ['ask-all', 'asked-classes'], default: 'ask-all', policyOnly: true, summary: …, category: 'pipeline-behavior', tier: 'advanced' }`. `node bin/resolve-policy.js --values planning-decisions` prints `ask-all` when unset or invalid, and `asked-classes` only when `policy.yml` sets it. Task 4's sub-file and pointer read it with exactly that command, no `--run`.
- Decision comment (above the row, verbatim intent): read only by `build/plan-review.md`'s pointer with `--values` and no `--run`, so `policyOnly` (no per-run route, not a Manifesto lever — `_shared/auto-mode-contract.md`'s new-lever checklist does not apply); not `policySourceExcluded` (a standing opt-in is the point); factory-settable (a user-wide preference for fewer planning questions is safe: it only changes which gaps are asked, and an unknown-key older build ignores it); first consumer lands in this PR, so no `Not yet used.` marker.

- [ ] **Step 1: Write the failing tests**
  - In `tests/policy.test.js`: `test('planning-decisions is policyOnly, defaults to ask-all and offers exactly ask-all and asked-classes (#6051)', …)` — find the row; `assert.strictEqual(row.policyOnly, true)`; `assert.strictEqual(row.default, 'ask-all')`; `assert.deepStrictEqual(row.values, ['ask-all', 'asked-classes'])`; `assert.ok(!row.summary.startsWith('Not yet used'))`; `assert.ok(!row.policySourceExcluded)`.
  - In `tests/policy.test.js`: `test('planning-decisions resolves ask-all when unset and when invalid (#6051)', …)` — through `require('../plugin/bin/lib/policy-schema').resolvePolicyKeys(['planning-decisions'], { policyRaw, runConfigRaw: null })` (the form `tests/policy-schema.test.js:52` uses) with `policyRaw` `''` → `{ value: 'ask-all', source: 'default' }`; with `planning-decisions: ask-some\n` → value `ask-all` and `invalid: true`; with `planning-decisions: asked-classes\n` → value `asked-classes`, source `policy`.
  - In `tests/policy-schema.test.js`: bump the pinned count to 119 and the `Last bump` line to `// Last bump: 118 -> 119, #6051`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/policy.test.js tests/policy-schema.test.js`
Expected: FAIL — no `planning-decisions` row; count is 118.

- [ ] **Step 3: Add the row, doc row, coverage bullet and journey entry.** The doc row in `_shared/policy-schema.md` sits in the table holding the other `pipeline-behavior` enum rows, starts `` | `planning-decisions` | ``, states `ask-all` (default) and `asked-classes`, says unset or invalid resolves `ask-all` (invalid carries `invalid: true`), says `policyOnly`, and names `_shared/planning-decisions.md` and `build/plan-review.md` as where it acts. Its summary text must differ from the schema row's `summary`. Run `wc -c plugin/skills/_shared/policy-schema.md`: it must print ≤ 52,500; if it does not, stop and report `NEEDS_CONTEXT` with the measured size (do not cut other rows). Append `planning-decisions` (#6051) to the coverage file's `policyOnly` bullet and to the journey's Red flags `policyOnly` list, each in the format its neighbours use.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/policy.test.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-coverage.md docs/journeys/resolve-a-policy-key.md tests/policy.test.js tests/policy-schema.test.js
git commit -m "Add the planning-decisions policy key — ask-all by default, policyOnly" -m "Claude-Session: https://claude.ai/code/session_01QXpjcVrZPTQPxJpVC8FWwR"
```

### Task 3: `_shared/planning-decisions.md` — the shared rule

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/_shared/planning-decisions.md`
- Create: `tests/helpers/planning-decisions-clauses.js` (exports `CLASS_CLAUSES`, `classStatementSites`)
- Test: `tests/planning-decisions-conformance.test.js` (new sibling suite, sized like `tests/plan-review-hard-gate-conformance.test.js`)

**Interfaces:**
- Produces the file with these `## ` sections, in this order, which Task 4 cites by name: `## Asked classes`, `## Settled path`, `## Doubt rule`, `## Line forms`, `## Asking`, `## Worked examples`.
- Exact literals (copy into both the file and the test; Task 4's sub-file uses the line forms verbatim):
  - (a): `**(a) Design-level.** Settling it changes what the record or its design doc says the work is for, who it serves, its shape, or a goal, non-goal or anti-goal.`
  - (b): `**(b) Hard to undo.** The question falls in a risk category the record keeps in \`Risk-flags:\`.` followed by: `When it plainly falls in a category the record does not flag, the flag is added first through \`bin/risk-flags.js add\` (add, never drop), the question is asked, and the plan owes that flag's Check G proof.`
  - (c): `**(c) Contradiction.** No reading keeps every Acceptance Criterion and recorded decision intact.`
  - Settled: `Every other question is settled: among readings that keep every Acceptance Criterion and recorded decision intact, take the one closer to stated intent` plus `(the criterion-as-written reading when the row came from a criterion change)`.
  - Tie-break: `When two readings keep every Acceptance Criterion and recorded decision intact and sit equally close to the stated intent (the record body and its design doc), take the one that changes fewer observable contracts.`
  - Doubt rule: `Class (b) is bounded to the declared categories: the four built-ins (\`migrations\`, \`auth\`, \`public-contract\`, \`irreversible-side-effect\`) plus policy \`risk-categories\`. A question that does not plainly fall in one is settled, never asked.`
  - Line forms: `Settled at planning: {finding} — chose {reading}; not {other reading}` and `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`, both under an additive `## Planning Decisions` section that never edits an existing criterion's line.
  - Asking: `One \`AskUserQuestion\` per question set, at most four questions per call: the recommended reading first, labelled \`(Recommended)\`, then the other reading, then \`Stop the build\` (build) or \`Leave for later\` (specify).` followed by the recommendation rule (decided by the user at plan review, spec `## Plan Review Clarifications`): `The recommended reading is the one \`## Settled path\` would pick; for a class (c) row, where that rule cannot choose, it is the reviewer's Reading A.`
  - Worked examples: settled — #4265 (which `error` string a release returns) and #4786 (which file holds a one-sentence pointer), each with its two readings and the chosen one; asked — a migration question (whether a schema change drops the old column in this release or the next: class (b), `migrations`) and an auth question (whether an unauthenticated caller may read a run's decisions: class (b), `auth`); borderline — `Doubt example:` a question about whether a `decisions.md` line says `skipped` or `not run` touches a file the Review Console reads but does not plainly fall in `public-contract`, so it is settled.
- Also state: the classifier is the build's plan review (the controller), never the reviewer; a row whose readings all break an Acceptance Criterion or recorded decision is (c) whatever its topic.

- [ ] **Step 1: Write the failing test file** `tests/planning-decisions-conformance.test.js`, reading through `readText` and slicing with `sectionOf`. One `missingFactsOf` pattern list per section, with an `assertEachPatternGoesRed` control per list:
  - `test('AC5.1: planning-decisions.md states the three asked classes and the settled path', …)` — patterns for (a), (b), (c), Settled, Tie-break over `## Asked classes` + `## Settled path`.
  - `test('AC5.1: no other file under plugin/ states the three classes', …)` — import `{ CLASS_CLAUSES, classStatementSites }` from a new `tests/helpers/planning-decisions-clauses.js` (Create, this task; Task 4 imports it too): `CLASS_CLAUSES` = the three defining clauses (`says the work is for, who it serves, its shape`, `falls in a risk category the record keeps in`, `No reading keeps every Acceptance Criterion and recorded decision intact`), `classStatementSites(files: Map<relPath, text>) → string[]` returns every file whose whitespace-collapsed text includes any of them; walk `plugin/**/*.md`; assert the result deepEqual `['plugin/skills/_shared/planning-decisions.md']`. Control: the same function over the live map plus `plugin/skills/build/zzz-no-such-file-6051.md` holding the (a) clause returns two entries.
  - `test('AC8.1: the doubt rule bounds class (b) to the declared categories and settles the rest', …)` and `test('AC8.2: one borderline row is worked as settled under the doubt rule', …)` — patterns over `## Doubt rule` and `## Worked examples` (`Doubt example:`, `public-contract`, `so it is settled`).
  - `test('line forms: Settled at planning and Decided by the user at planning under ## Planning Decisions', …)` — the two forms and `never edits an existing criterion's line` in `## Line forms`.
  - `test('AC3.1: asking puts the recommended reading first, then the other, then Stop the build or Leave for later', …)` — the Asking literal in `## Asking`, with an ordering control that swaps `(Recommended)` onto the second reading and expects the assertion's own message; plus `test('AC3.1: the recommended reading is the Settled-path pick, the reviewer\'s Reading A for a class (c) row', …)` pinning the recommendation-rule literal in `## Asking`.
  - `test('worked examples: #4265 and #4786 settled, a migration and an auth question asked', …)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/planning-decisions-conformance.test.js`
Expected: FAIL — `readText` throws ENOENT for `plugin/skills/_shared/planning-decisions.md`.

- [ ] **Step 3: Write `plugin/skills/_shared/planning-decisions.md`** with a one-paragraph header (what it is, who cites it: `build/plan-review-asked-classes.md` today, specify-time planning later; that it applies only under `planning-decisions: asked-classes`), then the six sections above.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/planning-decisions-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/planning-decisions.md tests/helpers/planning-decisions-clauses.js tests/planning-decisions-conformance.test.js
git commit -m "Add _shared/planning-decisions.md — the three asked classes and the settled path" -m "Claude-Session: https://claude.ai/code/session_01QXpjcVrZPTQPxJpVC8FWwR"
```

### Task 4: asked-classes routing — sub-file, pointer and the ask-all byte-identity pin

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/build/plan-review-asked-classes.md`
- Create: `tests/fixtures/plan-review-ask-all-6051.txt` (verbatim `plugin/skills/build/plan-review.md` at `483adc1d58`, 27,585 B; `.txt` so markdown walkers do not see its `<!-- HARD-GATE: plan-review-needs-human -->` marker)
- Modify: `plugin/skills/build/plan-review.md` (one marker-delimited pointer paragraph between `## Reading the reply`'s last bullet and `## Handling by class`; nothing else)
- Modify: `docs/plugin-structure.md:192` (add `plan-review-asked-classes.md` to the `| build |` row's file list — `tests/build-dispatch-subfile-table-completeness.test.js`)
- Test: `tests/build-plan-review-conformance.test.js`, `tests/log-decision-text-file-sites-conformance.test.js` (append site `R4`)

**Interfaces:**
- Consumes: Task 1's `add` verb and envelope; Task 2's `--values planning-decisions` output; Task 3's section names, line forms, and `tests/helpers/planning-decisions-clauses.js`'s `classStatementSites`.
- Pointer paragraph, exactly (Task 4's test strips from the start marker through the end marker and the blank line after it):

```
<!-- planning-decisions:start -->
**Planning decisions (#6051).** Before routing, resolve `planning-decisions` once: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values planning-decisions`. When it prints `asked-classes`, read `plan-review-asked-classes.md` in this directory and route every needs-human row by it; the asked classes are `_shared/planning-decisions.md`'s. Any other output, or a failed call, leaves this file as written.
<!-- planning-decisions:end -->

```

- Sub-file content, each as its own paragraph or numbered step (the test pins every literal in backticks below):
  1. Scope: applies after `plan-review.md`'s Reading the reply, to every needs-human row (the reviewer's and every promoted one). Under `asked-classes`, `plan-review.md`'s `### Converged round (#4958)` does not apply and its `Settled by plan review after an answered round:` lines are not written; every amendment line goes under `## Planning Decisions` instead of `## Plan Review Clarifications`. Everything else in `plan-review.md` (dispatch, prompt, Reading the reply, the intent-resolvable sequence, the HARD-GATE branches) applies as written.
  2. Classify each row against `_shared/planning-decisions.md`'s `## Asked classes` and `## Doubt rule`. Read the kept flags from the worktree spec's `Risk-flags:` line; the declared categories are `known` from `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" classify --body-file "{worktree spec}" --repo-root "{worktree root}"` (it writes nothing).
  3. Answered round: a row that a recorded decision already answers (a `Decided by the user at planning:` or `Decided by the user at plan review:` line, a `**Decision**` paragraph, or a Closed rule) is settled with a `Decided by the user at planning:` line quoting that decision and never asked again.
  4. Class (b), unflagged category: run `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" add --body-file "{worktree spec}" --add {slug} --repo-root "{worktree root}"` before the question is asked, add a `Proof({slug}):` line to the plan, and commit both with the other amendments. Add, never drop: no other `risk-flags.js` verb runs here. A non-zero exit still asks the question and logs one `SKIP` (`--text-file`, condition `risk-flags.js add exited {code} ({stderr line})` → fallback `question asked without the flag`).
  5. Settled rows (outside (a), (b) and (c)): pick the reading by `## Settled path`, apply it through `plan-review.md`'s intent-resolvable sequence (one commit, one record comment, one re-audit with every other amendment). In that sequence's step 1, the settled line stands in for the Evidence quote, and the criterion check there judges only the chosen reading, which keeps every Acceptance Criterion by construction, so a settled row never returns to needs-human. Write the line `Settled at planning: {finding} — chose {reading}; not {other reading}` under `## Planning Decisions`; the record comment carries that line verbatim; log one `AUTO` per settled row with `--step "Common Step 1.6 (plan review)"` and `--text-file "{text-file}"` holding that same line (path from `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value decision-text-{run-id}-planning-settled-{k}.md`; `_shared/auto-decision-log.md`'s Text from git or a user rule). A settled row produces no `AskUserQuestion`, no question comment and no `failed: plan-review-needs-human`. This holds in every mode — `auto`, `confirm`, `interactive` and `hybrid` — and in a dispatched call or `parallel`-wave member: when every needs-human row settles, the build continues to Common Step 1.7.
  5b. Mixed reply (some rows settle, at least one is asked): the settled rows are applied, logged and commented in the one intent-resolvable commit before the HARD-GATE branch runs, in every branch — present human, dispatched call and `parallel`-wave member alike — so a blocked call still leaves its settled lines committed; the question set and the question comment list only the asked rows.
  6. Asked rows ((a), (b), (c)): reach `plan-review.md`'s `### Spec gap — needs-human` HARD-GATE exactly as today, in every posture, as one question set, except that each question's options are the recommended reading first, labelled `(Recommended)`, then the other reading, then `Stop the build` (`_shared/planning-decisions.md`'s `## Asking`; the question comment lists them in the same order), and an answer is recorded as `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`.
  7. Standalone `/build` (no run dir): settled rows are listed in the handoff's `### Plan review amendments (standalone build, if any)` section, as `plan-review.md` already does for its amendments.

- [ ] **Step 1: Freeze the fixture before touching plan-review.md**

Run: `cp plugin/skills/build/plan-review.md tests/fixtures/plan-review-ask-all-6051.txt` then `wc -c tests/fixtures/plan-review-ask-all-6051.txt`
Expected: `27585`. Then `git diff --quiet 483adc1d58d370d20e8dc54512884ae94f061994 -- plugin/skills/build/plan-review.md` exits 0 (the live file still equals the base, so the copy is the base's bytes).

- [ ] **Step 2: Write the failing tests** in `tests/build-plan-review-conformance.test.js`:
  - Factor `stripPointer(text) → string`: remove from `<!-- planning-decisions:start -->` through `<!-- planning-decisions:end -->\n\n`; throw `'pointer markers missing'` when either marker is absent or they occur out of order.
  - `test('AC1.1/AC9.1: with the pointer removed, plan-review.md is byte-identical to the frozen ask-all fixture', …)` — `assert.strictEqual(stripPointer(readText(REVIEW_PATH)), readText(FIXTURE))`. Control: `stripPointer` on the live text with one character of the `## Dispatch prompt` block changed is not equal to the fixture.
  - `test('AC5.2: the pointer cites _shared/planning-decisions.md and the sub-file and resolves planning-decisions once', …)` — `missingFactsOf` over the pointer block: `--values planning-decisions`, `plan-review-asked-classes.md`, `_shared/planning-decisions.md`, `Any other output, or a failed call, leaves this file as written.`; each pattern goes red alone.
  - `test('AC2.1: under asked-classes a settled row writes Settled at planning, an AUTO line and a record comment, and asks nothing', …)` — sub-file facts: `Settled at planning: {finding} — chose {reading}; not {other reading}`, `under \`## Planning Decisions\``, `--step "Common Step 1.6 (plan review)"`, `the record comment carries that line verbatim`, `no \`AskUserQuestion\`, no question comment and no \`failed: plan-review-needs-human\``, `the settled line stands in for the Evidence quote`, `judges only the chosen reading`, `so a blocked call still leaves its settled lines committed`, `list only the asked rows`.
  - `test('AC7.1: settling holds in every mode and in a dispatched call', …)` — `in every mode — \`auto\`, \`confirm\`, \`interactive\` and \`hybrid\``, `when every needs-human row settles, the build continues to Common Step 1.7`.
  - `test('AC3.1: an asked row reaches the needs-human HARD-GATE exactly as today, recommended reading first', …)` — `\`### Spec gap — needs-human\` HARD-GATE exactly as today`, `the recommended reading first, labelled \`(Recommended)\`, then the other reading, then \`Stop the build\``.
  - `test('AC4.1: an unflagged category adds the flag through risk-flags.js add before asking, add never drop', …)` — the `risk-flags.js" add --body-file` command, `before the question is asked`, `Add, never drop`, `A non-zero exit still asks the question`.
  - `test('asked-classes retires the converged round and the Plan Review Clarifications heading only under asked-classes', …)` — `does not apply`, `instead of \`## Plan Review Clarifications\``, and the answered-round literal `never asked again`.
  - `test('AC5.1: the sub-file cites the shared rule rather than restating the classes', …)` — the sub-file contains `_shared/planning-decisions.md`, and `classStatementSites(new Map([[SUB_FILE, subText]]))` from `tests/helpers/planning-decisions-clauses.js` (Task 3) returns `[]`.
  - Append `{ id: 'R4', file: 'plugin/skills/build/plan-review-asked-classes.md', content: 'Settled at planning: {finding} — chose {reading}; not {other reading}' }` to `SITES` in `tests/log-decision-text-file-sites-conformance.test.js`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/build-plan-review-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js`
Expected: FAIL — `pointer markers missing`; ENOENT for the sub-file.

- [ ] **Step 4: Write the sub-file, insert the pointer, add the structure-row entry.** Insert the pointer block exactly as in Interfaces (followed by one blank line, before `## Handling by class`). Run `wc -c plugin/skills/build/plan-review.md` and record it (expected ≈ 27,960 B). Grep `tests/` for suites that slice `## Reading the reply` or `## Handling by class` (`git grep -n -F 'Reading the reply' -- tests`, `git grep -n -F 'Handling by class' -- tests`) and confirm the pointer sits outside each slice or re-prove that suite's controls. Confirm `git diff --quiet 483adc1d58d370d20e8dc54512884ae94f061994 -- .claude-tweaks/policy.yml` exits 0.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/build-plan-review-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js tests/plan-review-convergence-conformance.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/build-resume-common-steps.test.js tests/build-dispatch-subfile-table-completeness.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/plan-review-asked-classes.md plugin/skills/build/plan-review.md tests/fixtures/plan-review-ask-all-6051.txt docs/plugin-structure.md tests/build-plan-review-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js
git commit -m "Route plan-review needs-human rows by asked class under planning-decisions: asked-classes" -m "Claude-Session: https://claude.ai/code/session_01QXpjcVrZPTQPxJpVC8FWwR"
```

### Task 5: narrowed HARD-GATE row and the consumer audit

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/auto-mode-contract.md:212` (the `| HARD-GATE / BLOCKED / STOP conditions` row's plan-review parenthetical)
- Modify: `docs/journeys/answer-a-plan-review-question-3377.md` (one `Should understand` line in step 1 or 2)
- Modify: `.claude-tweaks/pipelines/2026-11-22T122522-spec-6051/work/6051-spec.md` (worktree copy only: an additive `Consumers audited — unchanged:` sub-list under `### Key Files`)
- Test: `tests/plan-review-hard-gate-conformance.test.js`, `tests/plan-review-convergence-conformance.test.js` (re-point `CONTRACT_QUALIFIER`)

**Interfaces:**
- Contract row change: inside the parenthetical `(\`build/plan-review.md\`, #3377; after one answered round, only a gap no reading settles without altering a criterion or contradicting a recorded decision, #4958)`, append `; under \`planning-decisions: asked-classes\`, only a row \`_shared/planning-decisions.md\` asks, #6051` before the closing `)`. Nothing else in the row changes (≈ +95 B; record `wc -c`).
- Consumer audit (spec Deliverable 10), commands and their base-sha hits, run during planning with the #4579 exclusions:
  `git grep -n -F 'plan-review-needs-human' -- ':!.claude-tweaks/pipelines' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'` and `git grep -n -F 'Plan Review Clarifications' -- ':!.claude-tweaks/pipelines' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'` (both matched at base `483adc1d58`: 27 and 34 lines, counted with `git grep -n -F … 483adc1d58 -- {same exclusions} | wc -l`). Verdicts:
  - updated: `plugin/skills/_shared/auto-mode-contract.md` (restates the trigger); `docs/journeys/answer-a-plan-review-question-3377.md` (restates the trigger and the heading for the default path — gains one line naming the `asked-classes` variant).
  - stays, with reason: `plugin/skills/dispatch/reporting.md`, `plugin/skills/dispatch/settle-and-merge.md`, `docs/skill-graph.md:122` (react to the gate's failure word, which is unchanged, not its trigger); `plugin/skills/specify/spec-template.md:209` (describes the reviewer's needs-human classification, which is unchanged); `docs/journeys/close-a-state-list-before-plan-review-4727.md` (historical #4588 incident); every `plugin/bin/**` and `tests/**` hit on `Plan Review Clarifications` (cites a past spec's section by name, never reads the heading); `tests/**` hits on `plan-review-needs-human` (fixture and failure-word strings, unchanged); `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (design history); `tools/pipeline-cost-report/reviews.js` (counts Common Step 1.6 human stops from log lines naming the gate; a settled row's `AUTO` line never names `needs-human`, so its count stays correct); `plugin/skills/build/plan-review.md` (restates the trigger for the default path; `asked-classes` overrides it through Task 4's pointer, and AC1/AC9 freeze its text).
  - Re-run both greps after Task 4 lands: the only new hits are this PR's files.

- [ ] **Step 1: Write the failing test** in `tests/plan-review-hard-gate-conformance.test.js`: `test('the HARD-GATE row narrows the plan-review gate under asked-classes by pointing at _shared/planning-decisions.md (#6051)', …)` — `contractRow()` includes `under \`planning-decisions: asked-classes\`, only a row \`_shared/planning-decisions.md\` asks, #6051)`; control: the row with that clause removed fails the same assertion with its own message. Re-point `CONTRACT_QUALIFIER` in `tests/plan-review-convergence-conformance.test.js` to the new full parenthetical (ending `#6051)`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/plan-review-hard-gate-conformance.test.js tests/plan-review-convergence-conformance.test.js`
Expected: FAIL — the row lacks the `#6051` clause.

- [ ] **Step 3: Edit the contract row, the journey line and the worktree spec's Key Files sub-list** per Interfaces. The journey line: `- **Should understand:** Under \`planning-decisions: asked-classes\`, only a design-level, hard-to-undo or contradictory gap is asked; every other one is settled with a \`Settled at planning:\` line under \`## Planning Decisions\` (\`_shared/planning-decisions.md\`).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/plan-review-hard-gate-conformance.test.js tests/plan-review-convergence-conformance.test.js tests/build-plan-review-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/auto-mode-contract.md docs/journeys/answer-a-plan-review-question-3377.md .claude-tweaks/pipelines/2026-11-22T122522-spec-6051/work/6051-spec.md tests/plan-review-hard-gate-conformance.test.js tests/plan-review-convergence-conformance.test.js
git commit -m "Narrow the plan-review HARD-GATE row under asked-classes — and record the consumer audit" -m "Claude-Session: https://claude.ai/code/session_01QXpjcVrZPTQPxJpVC8FWwR"
```

### Task 6: Full-suite verification (folded into Common Step 5)

**Role:** transcription

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite** — `test('AC6.1: npm test passes', …)` is this step: Common Step 5's verification run (`skills/test/verification.md`), not a new test file.

Run: the verification procedure Common Step 5 runs (`verify.js`, scoped by this run's declaration, then CI's full run on the PR).
Expected: exit 0, 0 failures.
