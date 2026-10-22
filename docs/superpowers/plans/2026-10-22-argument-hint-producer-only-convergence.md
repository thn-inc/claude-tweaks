# Argument-hint producer-only convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove caller-only flags from five skills' `argument-hint` and its mirrors, mark their `## Input` entries `(producer-only)`, tighten the rule from "may be left out" to "stays out", and enforce it with an inverse check.

**Architecture:** The hint is the grammar a person types. `tests/argument-hint-input.test.js` already checks Input→hint (`undocumentedHintFlags`, which exempts marked entries); this plan adds the converse: `markedHintFlags(content)` returns every `--flag` from a marked `## Input` entry (table first cell or bullet leading code span) that also appears in the hint as a whole token. Asserted `[]` per skill across the corpus.

**Tech Stack:** Markdown skill files, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T042950-record-3504/work/3504-spec.md`

## Global Constraints

- Removed hint flags: `visual-review` `[--source <parent-skill>]`, `design-wrapper` `[--source <parent-skill>]`, `visualize` `[--source <caller>]`, `tidy` `[--source sweep]`, `specify` `[--chained] [--source sweep]` — drop each bracket group plus its one leading space; every other byte of each hint is unchanged.
- Mirrors come from `docs/skill-authoring.md`'s "Argument-hint mirror surfaces" table (rows: `frontmatter`, `input-parse-line`, `usage-line`, `syntax-block`, `reference-card-takes`). Grep for these five skills: `git grep -n -E "usage: /claude-tweaks:(visual-review|design-wrapper|visualize|tidy|specify)|^## Syntax" -- plugin/skills/{those five}` → no hits, so only `frontmatter`, `input-parse-line` (each skill's `$ARGUMENTS` line) and `reference-card-takes` (`plugin/skills/help/reference-card.md` rows for the five) change. `tests/argument-hint-mirrors.test.js` checks byte equality.
- Marker placement (existing rule, unchanged): ` (producer-only)` right after the code span in a table row's first cell, or right after a bullet's leading code span. Never inside the code span.
- Both marks tighten together: the `argument-hint` bullet's single sentence covers `(producer-only)` and `(deprecated alias)`, and AC3 bans "may be left out" from both files, so the rule reads "a marked flag stays out of the hint and its mirrors" and the inverse check uses `EXEMPT_MARKERS` (both marks). Corpus today: no `(deprecated alias)`-marked `--flag` sits in any hint (dispatch's `--batch-size`/`--concurrent` are absent from its hint), so this adds zero offenders.
- **Premise refinement (AC1):** AC1 says no `argument-hint` contains `--source`. `backlog`'s hint carries `[--source <human|routine|sweep>]`, a person-typed presence switch (`backlog/SKILL.md` line 46: "absent or `human` → human-present posture"; line 103: "a human standing in for a Routine types `--source routine`"). It is not caller-only, the record's Current State lists five skills and not backlog, so backlog stays unchanged. AC1 is checked over the five named skills. Logged to `decisions.md` as `premise reversed`.
- `plugin/skills/build/plan-authoring-checks.md` is 52,427 B against `RAIL_BYTES` 52,500 (73 B headroom): its edit must be net ≤ 0 bytes.
- Governing skill `skill-prose-conformance-tests` (quoted): "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3504` (never closes/fixes), trailer `Claude-Session: https://claude.ai/code/session_01KgcR6LoXvNG7Gjw4bjj4un`.

## Review Focus

1. A bullet whose marker sits after a description, not right after the code span — must not exempt (already pinned by existing tests; the inverse check reuses the same parse so it inherits it).
2. A marked flag whose hint carries a longer flag with the same prefix (`--source-x` vs `--source`) — whole-token match, covered by Task 1's `longer hint flag` test.
3. Reference-card cell escaping: `\|` inside Takes cells — removing a bracket group must not leave a dangling `\|` or double space (mirrors test byte-compares).
4. `specify`'s Input prose still saying "Three optional flags" after `--source sweep` gets its own bullet — Task 3 keeps the three-flag list and places `--source sweep` as a separate bullet under the drain paragraph.
5. Tests that pin the old hints by content (`tests/sweep-orchestrator.test.js` test (7), `tests/tidy-residue-markers.test.js` line 236) — Task 3 re-points both.

Scope keywords: producer-only

No-change classifications (behavior-change prose sweep, `git grep -n -E -e "--chained|--source sweep|--source <caller>|--source <parent-skill>" -- plugin/skills/help docs README.md`): `docs/getting-started.md`, `docs/skill-graph.md`, `docs/journeys/run-a-hands-off-hygiene-sweep.md`, `docs/journeys/shape-several-records-in-one-specify-call.md`, `docs/journeys/see-a-catch-up-advance-with-no-run-dir-2704.md`, `docs/journeys/refuse-to-shape-a-decomposition-parent.md`, `docs/journeys/tidy-standalone-auto-report.md`, `docs/skill-authoring.md:122`, `plugin/skills/help/context-flow.md` describe a caller passing the flag, which still works — not mirrors. `plugin/skills/capture/SKILL.md` and `plugin/skills/routine/SKILL.md` already mark their `--source` rows and keep them out of the hint.

---

### Task 1: Inverse check + visualize migration

**Files:**
- Modify: `tests/argument-hint-input.test.js`
- Modify: `plugin/skills/visualize/SKILL.md` (line 4 hint, line 26 `$ARGUMENTS` line, line 49 bullet)
- Modify: `plugin/skills/help/reference-card.md` (visualize row, line 32)

**Interfaces:**
- Produces: `markedHintFlags(content: string): string[]` and `assertNoMarkedHintFlags(name: string, content: string): void` (throws `AssertionError` with message ``skills/${name}/SKILL.md: ## Input marks flags that still appear in argument-hint — remove them from the hint and its mirrors: ${flags.join(', ')}``) in `tests/argument-hint-input.test.js`. Tasks 2-3 rely on the per-skill corpus test going green once their skills are migrated.

- [ ] **Step 1: Write the failing tests** in `tests/argument-hint-input.test.js`:
  - Factor the row/bullet parse loop of `undocumentedHintFlags` into a shared `inputEntries(body)` → `[{ flagText, marked }]` (marked = an `EXEMPT_MARKERS` entry in the first cell, or opening the bullet's rest); `undocumentedHintFlags` keeps its behavior on top of it.
  - `markedHintFlags(content)`: flags from `marked` entries whose whole token (`flag + '(?![a-z0-9-])'`) matches the hint, first-seen order, deduplicated.
  - `test('#3504 inverse: no (producer-only) or (deprecated alias) flag appears in its skill\'s argument-hint', …)` — `assertNoMarkedHintFlags(name, read(name))` for every skill in `SKILLS`.
  - `test('#3504 AC2.1 go-red: re-adding --source to visualize\'s hint fails the inverse check naming visualize', …)` — `mutated = read('visualize').replace('[topic] [--ephemeral]', '[topic] [--source <caller>] [--ephemeral]')`; `assert.notEqual(mutated, read('visualize'))`; `assert.throws(() => assertNoMarkedHintFlags('visualize', mutated), { message: /skills\/visualize\/SKILL\.md: ## Input marks flags that still appear in argument-hint.*--source/ })`.
  - Synthetic pairs: `markedHintFlags("---\nargument-hint: '[--b]'\n---\n## Input\n\n- `--b` (producer-only) → x\n")` deep-equals `['--b']`; same with `[--b-x]` in the hint deep-equals `[]` (longer hint flag); same with the table row form ``| `--b` (producer-only) | x |`` deep-equals `['--b']`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/argument-hint-input.test.js`
Expected: FAIL — the go-red test fails because visualize is not migrated yet (its `--source` bullet is unmarked and its hint already carries `--source`, so the replace matches nothing and `notEqual` throws).

- [ ] **Step 3: Migrate visualize**
  - Hint and `$ARGUMENTS` line: `... [topic] [--source <caller>] [--ephemeral]` → `... [topic] [--ephemeral]`.
  - Bullet: ``- `--source <caller>` — set by`` → ``- `--source <caller>` (producer-only) — set by``.
  - Reference card visualize row Takes cell: drop ` [--source <caller>]`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js`
Expected: PASS — all tests, including the inverse corpus test (no other skill has a marked flag in its hint yet; the five target skills' rows are still unmarked).

- [ ] **Step 5: Commit** — `git add` the three files; message `Add inverse argument-hint check and migrate visualize — marked flags stay out of the hint`.

### Task 2: Migrate visual-review and design-wrapper

**Files:**
- Modify: `plugin/skills/visual-review/SKILL.md` (line 4 hint, line 31 `$ARGUMENTS` line; add one bullet after line 31)
- Modify: `plugin/skills/design-wrapper/SKILL.md` (line 4 hint, line 43 `$ARGUMENTS` line, line 63 Flags row)
- Modify: `plugin/skills/help/reference-card.md` (rows at lines 30, 31)
- Waived `plugin/skills/design-wrapper/modes/explore.md`: line 3's caller-facing invocation shape (`[--source <parent-skill>]`) describes what parent skills pass; not a mirror row, and the flag still works — no change.

**Interfaces:**
- Consumes: Task 1's inverse corpus test.

- [ ] **Step 1: Mutate-first check** — Run: `node -e "const c=require('fs').readFileSync('plugin/skills/design-wrapper/SKILL.md','utf8');process.exit(/\| \x60--source <parent-skill>\x60 \(producer-only\) \|/.test(c)?0:1)"` Expected: FAIL (exit 1 — row not yet marked).
- [ ] **Step 2: Edit**
  - visual-review hint and `$ARGUMENTS` line: drop ` [--source <parent-skill>]`. After the `$ARGUMENTS` line, add a blank line then: ``- `--source <parent-skill>` (producer-only) — a parent skill with no `$PIPELINE_RUN_DIR` of its own names itself; see Fallback signal (`--source`) below.``
  - design-wrapper hint and `$ARGUMENTS` line: drop ` [--source <parent-skill>]`. Flags row first cell: ``| `--source <parent-skill>` (producer-only) | any | …`` (rest of row unchanged).
  - Reference card rows for both: drop ` [--source <parent-skill>]` from each Takes cell.
- [ ] **Step 3: Verify** — Run: `node --test tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js` Expected: PASS. Re-run Step 1's command: exit 0.
- [ ] **Step 4: Commit** — message `Move --source out of visual-review and design-wrapper hints — mark the Input entries producer-only`.

### Task 3: Migrate tidy and specify, re-point their content pins

**Files:**
- Modify: `plugin/skills/tidy/SKILL.md` (line 4 hint, line 29 `$ARGUMENTS` paragraph)
- Modify: `plugin/skills/specify/SKILL.md` (line 4 hint, line 36 `$ARGUMENTS` line, line 40 drain paragraph's last sentence, line 50 `--chained` bullet)
- Modify: `plugin/skills/help/reference-card.md` (rows at lines 13, 42)
- Modify: `tests/sweep-orchestrator.test.js` (test (7), lines 291-306)
- Modify: `tests/tidy-residue-markers.test.js` (lines 233-239)

**Interfaces:**
- Consumes: Task 1's inverse corpus test.

- [ ] **Step 1: Rewrite the content pins first (red)**
  - `tests/sweep-orchestrator.test.js` test (7) → `test('tidy and specify document --source sweep as producer-only and keep it out of argument-hint', …)`: for each of tidy/specify, the hint (`extractArgumentHint`) does not include `--source`, and `inputSectionBody` contains the literal ``- `--source sweep` (producer-only)``. Update the discrimination comment: the pre-change hints carried `[--source sweep]` (base `354119ff3`).
  - `tests/tidy-residue-markers.test.js` line 236 literal → `argument-hint: "[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]]"`; message `tidy/SKILL.md argument-hint must carry --approve [run-dir]`.
- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/sweep-orchestrator.test.js tests/tidy-residue-markers.test.js`
Expected: FAIL — both rewritten tests.

- [ ] **Step 3: Edit**
  - tidy hint and `$ARGUMENTS` code span: drop ` [--source sweep]`. In the paragraph, delete the sentence ``"`--source sweep` — parent-only flag from `/claude-tweaks:sweep` Step 1; forces auto-mode regardless of `auto-mode` policy — see Component-Skill Contract."`` and add after the paragraph a blank line then ``- `--source sweep` (producer-only) — passed only by `/claude-tweaks:sweep` Step 1; forces auto-mode regardless of `auto-mode` policy — see Component-Skill Contract.``
  - specify hint and `$ARGUMENTS` line: drop ` [--chained] [--source sweep]`. Drain paragraph: delete its last sentence (``"`--source sweep` (from `/claude-tweaks:sweep` Step 2) runs this drain as a component step — see Component-Skill Contract, `next-mode-closeout.md`."``) and add after the paragraph a blank line then ``- `--source sweep` (producer-only) — passed only by `/claude-tweaks:sweep` Step 2; runs this drain as a component step — see Component-Skill Contract, `next-mode-closeout.md`.`` `--chained` bullet: ``- `--chained` (producer-only) — component-mode invocation …`` (rest unchanged). Keep "Three optional flags" — the list still has three.
  - Reference card rows for both: drop the same bracket groups from each Takes cell.
- [ ] **Step 4: Verify**

Run: `node --test tests/sweep-orchestrator.test.js tests/tidy-residue-markers.test.js tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js tests/specify-batch-input.test.js tests/specify-next-mode.test.js tests/batch-ref-argument.test.js tests/tidy-report-rules.test.js`
Expected: PASS.

- [ ] **Step 5: AC1 evidence (scratch)** — `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, then `git grep -n -E -e "--source|--chained" -- plugin/skills/visual-review/SKILL.md plugin/skills/design-wrapper/SKILL.md plugin/skills/visualize/SKILL.md plugin/skills/tidy/SKILL.md plugin/skills/specify/SKILL.md | grep ":4:argument-hint" > "$PIPELINE_RUN_DIR/evidence/ac1-hint-grep.txt"` (expect empty; the same grep at base `354119ff3` matched all five — confirm with `git grep -n -E -e "--source|--chained" 354119ff3 -- plugin/skills/visualize/SKILL.md`). Log `#3504 AC1.1` evidence via `log-decision.js --step "AC evidence"`.
- [ ] **Step 6: Commit** — message `Move --source sweep and --chained out of tidy and specify hints — mark the Input entries producer-only`.

### Task 4: Tighten the rule wording

**Files:**
- Modify: `docs/skill-authoring.md` (line 17 parenthetical, line 132 `argument-hint` bullet)
- Modify: `plugin/skills/build/plan-authoring-checks.md` (line 59 parenthetical; net ≤ 0 bytes)
- Modify: `docs/journeys/document-a-flag-a-person-never-types-2964.md` (line 36)
- Modify: `tests/argument-hint-input.test.js` (header comment lines 27-34; new AC3 test)

- [ ] **Step 1: Write the failing test** — `test('#3504 AC3.1/AC3.2: the rule says a marked flag stays out of the hint, nowhere "may be left out"', …)`: the `docs/skill-authoring.md` `- **\`argument-hint\`**` bullet includes `stays out of the hint`; neither `docs/skill-authoring.md` nor `plugin/skills/build/plan-authoring-checks.md` includes `may be left out`.
- [ ] **Step 2: Run** — `node --test tests/argument-hint-input.test.js` Expected: FAIL on the new test.
- [ ] **Step 3: Edit**
  - line 132: `and a marked flag may be left out of the hint and its mirrors — marking is the condition for absence, not a requirement to remove it. \`tests/argument-hint-input.test.js\` checks this direction too, reading every \`--flag\` from table rows' first cells and bullets' leading code spans.` → `and a marked flag stays out of the hint and its mirrors. \`tests/argument-hint-input.test.js\` checks both directions, reading every \`--flag\` from table rows' first cells and bullets' leading code spans: an unmarked flag must be in the hint, a marked one must not.`
  - line 17: `may be left out of the hint and therefore of its mirrors` → `stays out of the hint and therefore out of its mirrors`.
  - `plan-authoring-checks.md` line 59: `may be left out of the hint and so of its mirrors` → `stays out of the hint and so out of its mirrors` (−1 B net).
  - Journey line 36 → `  - A marked flag stays out of the hint and its mirrors. The inverse check fails when a marked entry's flag is still in the hint.`
  - Test header comment: replace "which the user-facing hint may leave out" with "which stays out of the user-facing hint", and add one line naming `markedHintFlags` as the converse.
- [ ] **Step 4: Verify** — `node --test tests/argument-hint-input.test.js`; `wc -c plugin/skills/build/plan-authoring-checks.md` ≤ 52427. Expected: PASS; size ≤ base.
- [ ] **Step 5: Commit** — message `Tighten the argument-hint marker rule to stays-out — docs, plan check, journey`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (hints, mirrors, marks) | Tasks 1-3 |
| Deliverable 2 (rule wording) | Task 4 |
| Deliverable 3 (inverse check) | Task 1 |
| AC1.1 | Task 3 Step 5 (evidence) + Task 1 inverse test |
| AC2.1 | Task 1 go-red test |
| AC3.1, AC3.2 | Task 4 test |
