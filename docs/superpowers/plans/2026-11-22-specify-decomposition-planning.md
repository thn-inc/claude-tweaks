# Plan each sub-issue in /specify's decomposition mode after self-review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `plan-at-specify: on`, decomposition mode plans, reviews and stores a plan for every created non-parent sub-issue after Step 6, in specify's own session, never inside the mechanical handoff.

**Architecture:** `planning.md` gains a `## Decomposition` section — the multi-record entry for sub-issues that already exist on the forge — reusing its `## Batches` fan-out and `## Per-record step` steps 1-8, with its own write (one body write, then a separate label call for a hold). `decomposition-mode-closeout.md`, `mechanical-handoff.md` and `SKILL.md` each gain one gated `<!-- plan-at-specify:start -->` block that points at it; with the key `off`, every one of them is skipped and decomposition runs as written. `tests/specify-planning-conformance.test.js` extends its gate checks to the three new files and pins the new section.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite (`tests/specify-planning-conformance.test.js`, helpers in `tests/helpers/conformance-asserts.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-22T204254-spec-6057/work/6057-spec.md`

## Global Constraints

- With `plan-at-specify: off`, decomposition mode is byte-identical to today's (AC1.1): every new sentence naming the planning step sits inside one `<!-- plan-at-specify:start -->` / `<!-- plan-at-specify:end -->` block per file whose instruction is the gate, and the mechanical-handoff dispatch prompt's fenced block gains no text.
- The tokens `plan-at-specify`, `planning.md`, `plan-store`, `Planning Decisions` and `Plan: ` may appear in a specify file only inside that file's gated block (or anywhere in `planning.md`) — the suite's existing `PLANNING_TOKENS` rule.
- A parent (a record carrying the `parent-issue` label) is never planned.
- Cite `planning.md`; do not restate its per-record steps in the closeout or handoff files (spec Gotcha: `decomposition-mode-closeout.md` may be near the rail).
- Rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Current sizes and headroom after this plan's growth: `planning.md` 31,639 B (+~4,500 → ~36,100, ~16,400 headroom); `decomposition-mode-closeout.md` 20,140 B (+~1,100 → ~21,200); `mechanical-handoff.md` 8,080 B (+~1,500 → ~9,600); `SKILL.md` 41,106 B (+~700 → ~41,800, ~10,700 headroom); `_shared/policy-schema.md` 50,235 B, near the rail (2,265 B headroom) — Task 4 adds at most ~200 B there, nothing more. No per-file byte pin may be added (decision 0024).
- Governing project skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), quoted: "Read live prose only when the prose is the declared contract" and "`[IL-105]` says prove the assertion can go red". This suite already reads live prose as the declared contract (its header comment), and proves go-red through its `pinned()` helper (`assertEachPatternGoesRed`), so every new fact assertion goes through `pinned()`.
- No other project skill under `.claude/skills/` names `decomposition-mode-closeout.md`, `mechanical-handoff.md`, `planning.md`, `specify/SKILL.md` or `tests/specify-planning-conformance.test.js` (`git grep` returned nothing).
- Premise reversed (Deliverable 6): the spec says `planning.md` already has a "multi-record entry (from #6056), which takes N sub-issue numbers". It has none: its `## Batches` section defers *shaping-mode* writes inside Compose-then-write-once for records not yet written. Sub-issues exist on the forge before planning runs, so this plan adds the entry as `planning.md`'s `## Decomposition` section, built from `## Batches` and `## Per-record step` by citation.

## Review Focus

1. A kept parent appears in Step 9's Work Units Created table — it must be filtered by its re-fetched `parent-issue` label, never planned, and never get an outcome row (Task 1 test "Deliverable 6").
2. A sub-issue Step 5 left without `ready` (a staged red-team finding) — it is planned (plan review decision 1), and planning must never add `ready` back; a planned one stays as it was, a held one only gains `needs:decision` (Task 1 tests "Deliverable 6" and "Deliverable 2").
3. A held sub-issue whose sibling is blocked by it — the dependent is still planned (Task 1 test "Deliverable 2").
4. A delegated run with the key `on` — the subagent reads the closeout file and must skip its block because the dispatch prompt says so, not by resolving the key itself (Task 2 and Task 3 tests).
5. A run with no human reachable (`/sweep`'s specify drain, a Routine) — nothing is asked and every asked row holds (Task 1 test "Deliverable 9").

---

### Task 1: `planning.md`'s `## Decomposition` entry

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/planning.md` (new `## Decomposition` section between `## Batches` and `## Read-back and outcome`)
- Test: `tests/specify-planning-conformance.test.js`

**Interfaces:**
- Consumes: `planning.md`'s existing `## Which records are planned` (lane predicate, reuse check, hold-state capture), `## Per-record step` steps 1-8, `## Routing` (Asking, headless), `## Hold`, `## Batches`, `## Read-back and outcome`, `Logging`.
- Produces: the heading `## Decomposition`; the four outcome words `planned`, `held`, `skipped`, `no-ref`; a Step 9 section named `### Planning` with columns `| Record | Outcome | Detail |`. Tasks 2-4 cite the heading and the `### Planning` section by these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `tests/specify-planning-conformance.test.js`, using the file's existing `pinned`, `f` and `sectionOf` helpers:

```js
const decomposition = () => sectionOf(planning(), '## Decomposition');

test('Deliverable 6: the decomposition entry takes N sub-issues, never a parent, and returns one outcome each', () => {
  pinned(decomposition(), [
    f('Called by `decomposition-mode-closeout.md`\'s `plan-at-specify` paragraph, in specify\'s own session'),
    f('never inside `mechanical-handoff.md`\'s subagent'),
    f('every non-parent sub-issue Step 3 created this run'),
    f('A sub-issue Step 3 resumed rather than created is not planned this pass'),
    f('A sub-issue Step 5 left with a staged finding is planned too'),
    f('A record carrying the `parent-issue` label is never planned and gets no outcome row'),
    f('`planned`'), f('`held`'), f('`skipped`'), f('`no-ref`'),
  ], 'decomposition entry');
});

test('AC3.1 + Deliverable 7: each body is re-fetched from the forge after Step 6, so red-team edits are what the reviewer reads', () => {
  pinned(decomposition(), [
    f('re-fetch each sub-issue\'s body and labels from the forge'),
    f('after Step 6, or after the handoff returns'),
    f('so Step 5\'s red-team edits are in the body the planner and reviewer read'),
  ], 'decomposition body');
});

test('Deliverable 1: planners and reviewers fan out per ## Batches, with one question batch for every sub-issue', () => {
  pinned(decomposition(), [
    f('as `## Batches` runs them'),
    f('one batch table and one set of chunked questions covering every sub-issue'),
  ], 'decomposition fan-out');
});

test('Deliverable 2: one more body write, then the hold label edit as a separate call; a held sibling holds no dependent; ready is never added', () => {
  pinned(decomposition(), [
    f('one more body write per sub-issue'),
    f('`gh issue edit {n} --body-file "{body}"`'),
    f('then, as a separate call after it lands'),
    f('`--remove-label ready --add-label "needs:decision"`'),
    f('A held sibling does not hold the sub-issues that depend on it'),
    f('Planning never adds `ready`'),
  ], 'decomposition write');
});

test('Deliverable 9: headless decomposition asks nothing and holds', () => {
  pinned(decomposition(), [
    f('With no human reachable (`/sweep`\'s specify drain, a Routine)'),
    f('the question batch is not asked'),
  ], 'decomposition headless');
});

test('AC2.1 + Deliverable 4: the outcomes map to Step 9\'s ### Planning table', () => {
  pinned(decomposition(), [
    f('`### Planning`'),
    f('| Record | Outcome | Detail |'),
    f('A planning failure is `skipped`'),
  ], 'decomposition outcomes');
});
```

Also add `'## Decomposition'` to the `heads` array of the existing test `planning.md headings appear in order`, between `'## Batches'` and `'## Read-back and outcome'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL after Step 1 — `heading not found: ## Decomposition` in each new test and the headings-order test.

- [ ] **Step 3: Write `## Decomposition` in `plugin/skills/specify/planning.md`**

One section, placed after `## Batches` and before `## Read-back and outcome`, containing every pinned literal above and stating, in this order:
1. Who calls it and where (the two pinned sentences); input = every non-parent sub-issue Step 3 created this run; parent exclusion by the re-fetched `parent-issue` label. "A sub-issue Step 3 resumed rather than created is not planned this pass" (it gets no outcome row; `/claude-tweaks:specify #{n}` re-shapes and plans it — decomposition mode has no `needs:*` resolve for an earlier hold, plan review finding 4). "A sub-issue Step 5 left with a staged finding is planned too": its `ready` stays cleared, and resolving the finding later changes the body, so `plan-store.js check`'s spec hash makes the next shape or build re-plan rather than reuse the stale plan (plan review decision 1).
2. Body: re-fetch each sub-issue's body and labels from the forge (`gh issue view {n} --json body,labels`, or `issue_read` when `gh` is absent) after Step 6, or after the handoff returns, writing the body to the path `session-tmp-resolve.js --value specify-plan-body-{n}.md` prints — that file is the record's `{body}`; the lane file's labels are the re-fetched labels as they stand (Step 3 already stamped them). The pinned red-team sentence.
3. Run, as `## Batches` runs them: the hold-state capture, the lane predicate, the reuse check, then `## Per-record step` steps 1-8 for each sub-issue still to be planned, with the pinned one-batch sentence; `## Routing`'s Asking governs the questions, and its headless rule plus the pinned Deliverable 9 sentences govern a run with no human reachable.
4. Write (replaces step 9 and Compose-then-write-once's write for decomposition): the pinned one-more-body-write sentence and command; a held sub-issue then gets the pinned separate label call (bootstrap `needs:decision` per `_shared/label-bootstrap.md`; drop `--remove-label ready` when the sub-issue does not carry it) and `## Hold`'s comment; the held-sibling sentence; "Planning never adds `ready`" (a sub-issue Step 5 left without it stays without it).
5. Read-back per `## Read-back and outcome`'s Planned and Held bullets.
6. Outcomes: `planned` (a `Plan:` line was stored or a valid one kept), `held` (an asked-class question is unanswered, including `## Per-record step`'s held planning failure), `skipped` (a plan-less lane took it, Detail `{lane} lane ({reason})`; and the pinned "A planning failure is `skipped`", Detail `planning failed: {reason}`), `no-ref` (`plan-store.js write` exited non-zero). Step 9 renders them as a `### Planning` section with the pinned table header, one row per planned-or-not sub-issue.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/planning.md tests/specify-planning-conformance.test.js
git commit -m "Add planning.md's Decomposition entry — plan N existing sub-issues in one batch (#6057)"
```

### Task 2: Gated block in `decomposition-mode-closeout.md`

**Role:** integration

**Files:**
- Modify: `plugin/skills/specify/decomposition-mode-closeout.md` (after Step 6's "When all five checks come back clean, proceed to Step 7." line, before the `---` that opens Step 7)
- Test: `tests/specify-planning-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `## Decomposition` heading and `### Planning` section name.
- Produces: the `DECOMPOSITION_FILES` map in the test file (`{ rel: [gate phrases] }`), which Tasks 3 and 4 extend.

- [ ] **Step 1: Write the failing tests**

In the test file, below `SHAPING_FILES`, add:

```js
const DECOMPOSITION_FILES = {
  'plugin/skills/specify/decomposition-mode-closeout.md': ['Under `work-backend: github-issues` only, resolve `plan-at-specify` once', 'Any other backend, any other output, or a failed call skips this paragraph and decomposition runs as written.'],
};
```

Add every `DECOMPOSITION_FILES` key to the `skip` set of `AC1.1: no other specify file except planning.md names the planning step`, then append:

```js
test('AC1.1: each decomposition file holds one gated plan-at-specify block and no planning text outside it', () => {
  for (const [rel, phrases] of Object.entries(DECOMPOSITION_FILES)) {
    assert.deepEqual(gateProblems(shapingText(rel), phrases), [], rel);
  }
});

test('AC4.1: the closeout block runs after Step 6, before Step 7, and a delegated subagent skips it', () => {
  const rel = 'plugin/skills/specify/decomposition-mode-closeout.md';
  const text = shapingText(rel);
  const b = text.indexOf(GATE_START);
  assert.ok(b > text.indexOf('## Step 6: Record Self-Review') && b < text.indexOf('## Step 7:'), 'closeout block position');
  pinned(blockOf(rel), [
    f('Only when it prints `on`, and only in specify\'s own session'),
    f('run its `## Decomposition` entry now, before Step 7'),
    f('A subagent whose dispatch prompt says its caller plans skips this paragraph'),
    f('Step 9\'s summary then carries the `### Planning` section'),
    f('resolve-policy.js" --values plan-at-specify'),
  ], 'closeout block');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL after Step 1 — `block count` for the closeout file, and `closeout block position`.

- [ ] **Step 3: Insert the block**

Insert exactly, as its own paragraph after Step 6's last line:

```
<!-- plan-at-specify:start -->
**Planning at specify (#6057).** Under `work-backend: github-issues` only, resolve `plan-at-specify` once: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values plan-at-specify`. Only when it prints `on`, and only in specify's own session, read `planning.md` in this skill's directory and run its `## Decomposition` entry now, before Step 7. A subagent whose dispatch prompt says its caller plans skips this paragraph: `mechanical-handoff.md`'s caller runs the entry after the handoff returns. Step 9's summary then carries the `### Planning` section that entry names. Any other backend, any other output, or a failed call skips this paragraph and decomposition runs as written. Relay a stderr warning the call prints, which names a conflict with `planning-decisions`, as a one-line notice.
<!-- plan-at-specify:end -->
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/decomposition-mode-closeout.md tests/specify-planning-conformance.test.js
git commit -m "Plan sub-issues after Step 6 in decomposition mode under plan-at-specify (#6057)"
```

### Task 3: Gated block in `mechanical-handoff.md`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/mechanical-handoff.md` (after the `## Dispatch prompt` fence's closing line, before the `` `[Use: Standard]` `` paragraph)
- Test: `tests/specify-planning-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `## Decomposition` and `### Planning`; Task 2's closeout sentence "A subagent whose dispatch prompt says its caller plans skips this paragraph" (the sentence below is what tells it).
- Produces: a `DECOMPOSITION_FILES` entry for `mechanical-handoff.md`.

- [ ] **Step 1: Write the failing tests**

Add to `DECOMPOSITION_FILES`:

```js
  'plugin/skills/specify/mechanical-handoff.md': ['Under `work-backend: github-issues` only, resolve `plan-at-specify` before composing the prompt', 'With any other output the prompt is unchanged.'],
```

Append:

```js
test('AC4.1 + Deliverable 8: the handoff never plans — the dispatcher says so in the prompt, plans after it returns, and appends the outcomes', () => {
  const rel = 'plugin/skills/specify/mechanical-handoff.md';
  const text = shapingText(rel);
  const fence = fenceAfter(text, '## Dispatch prompt');
  for (const t of PLANNING_TOKENS) assert.ok(!fence.includes(t), `dispatch prompt names ${t}`);
  const b = text.indexOf(GATE_START);
  assert.ok(b > text.indexOf(fence) + fence.length && b < text.indexOf('`[Use: Standard]`'), 'handoff block position');
  pinned(blockOf(rel), [
    f('add this sentence as the last line of the prompt\'s Task scope'),
    f('Planning is not yours: your caller plans every sub-issue after you return, so skip the `plan-at-specify` paragraph in `decomposition-mode-closeout.md` and ask no planning question.'),
    f('Once the handoff returns `STATUS: DONE` or `DONE_WITH_CONCERNS`'),
    f('Any other status plans nothing: each sub-issue the summary lists as created gets a `skipped` row with Detail `handoff {status}`'),
    f('run `planning.md`\'s `## Decomposition` entry in this session'),
    f('append its `### Planning` section to the returned summary'),
    f('Planned in specify\'s own session after the handoff returned; the handoff planned nothing.'),
  ], 'handoff block');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL after Step 1 — `block count` for the handoff file, `handoff block position`.

- [ ] **Step 3: Insert the block**

Insert exactly:

```
<!-- plan-at-specify:start -->
**Planning at specify (#6057).** Under `work-backend: github-issues` only, resolve `plan-at-specify` before composing the prompt: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values plan-at-specify`. When it prints `on`, add this sentence as the last line of the prompt's Task scope:

> Planning is not yours: your caller plans every sub-issue after you return, so skip the `plan-at-specify` paragraph in `decomposition-mode-closeout.md` and ask no planning question.

With any other output the prompt is unchanged. Once the handoff returns `STATUS: DONE` or `DONE_WITH_CONCERNS`, read `planning.md` in this skill's directory, run `planning.md`'s `## Decomposition` entry in this session over the Work Units Created refs, and append its `### Planning` section to the returned summary before relaying it, opening with the line "Planned in specify's own session after the handoff returned; the handoff planned nothing." Any other status plans nothing: each sub-issue the summary lists as created gets a `skipped` row with Detail `handoff {status}`, since its body may not have reached Step 6. The returned summary's own shape is unchanged.
<!-- plan-at-specify:end -->
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-planning-conformance.test.js tests/specify-mechanical-handoff.test.js tests/specify-staged-for-caller.test.js`
Expected: PASS, all three files.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/mechanical-handoff.md tests/specify-planning-conformance.test.js
git commit -m "Keep planning out of the mechanical handoff — caller plans after it returns (#6057)"
```

### Task 4: `SKILL.md` pointer and the policy readers row

**Role:** integration

**Files:**
- Modify: `plugin/skills/specify/SKILL.md` (inside `## Decomposition mode (design doc into sub-issues, parent when Step 2.6 keeps one)`, after its `Read decomposition-mode.md …` paragraph)
- Modify: `plugin/skills/_shared/policy-schema.md` (the `plan-at-specify` row's readers cell)
- Test: `tests/specify-planning-conformance.test.js`

**Interfaces:**
- Consumes: Tasks 2 and 3's blocks (named, not restated).
- Produces: the last `DECOMPOSITION_FILES` entry.

- [ ] **Step 1: Write the failing tests**

Add to `DECOMPOSITION_FILES`:

```js
  'plugin/skills/specify/SKILL.md': ['Under `plan-at-specify: on`', 'Otherwise skip this paragraph.'],
```

Append:

```js
test('Deliverable 1: SKILL.md\'s decomposition paragraph points at the two blocks, and policy-schema names their readers', () => {
  const rel = 'plugin/skills/specify/SKILL.md';
  const text = shapingText(rel);
  const b = text.indexOf(GATE_START);
  assert.ok(b > text.indexOf('## Decomposition mode (') && b < text.indexOf('\n## ', text.indexOf('## Decomposition mode (') + 1), 'SKILL.md block position');
  pinned(blockOf(rel), [
    f('`decomposition-mode-closeout.md`\'s `plan-at-specify` paragraph plans each non-parent sub-issue after Step 6'),
    f('`mechanical-handoff.md`\'s `plan-at-specify` paragraph'),
  ], 'SKILL.md block');
  const row = readText(path.join(ROOT, 'plugin/skills/_shared/policy-schema.md')).split('\n').find((l) => l.startsWith('| `plan-at-specify` |'));
  for (const r of ['specify/decomposition-mode-closeout.md', 'specify/mechanical-handoff.md']) assert.ok(row.includes(r), `readers cell lacks ${r}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/specify-planning-conformance.test.js`
Expected: FAIL after Step 1 — `block count` for `SKILL.md`, and the readers-cell assertion.

- [ ] **Step 3: Insert the block and widen the row**

`SKILL.md`, its own paragraph:

```
<!-- plan-at-specify:start -->
**Planning at specify (#6057).** Under `plan-at-specify: on`, `decomposition-mode-closeout.md`'s `plan-at-specify` paragraph plans each non-parent sub-issue after Step 6, in this session; when the mechanical range is delegated, `mechanical-handoff.md`'s `plan-at-specify` paragraph plans them after the handoff returns. Otherwise skip this paragraph.
<!-- plan-at-specify:end -->
```

`policy-schema.md`: the `plan-at-specify` row's readers cell becomes `` `specify/shaping-mode.md`, `specify/planning.md`, `specify/decomposition-mode-closeout.md`, `specify/mechanical-handoff.md` ``, and its description sentence gains `, and decomposition mode plan each created non-parent sub-issue after Step 6 (#6057)` after "before its one write".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-planning-conformance.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/SKILL.md plugin/skills/_shared/policy-schema.md tests/specify-planning-conformance.test.js
git commit -m "Point SKILL.md's decomposition mode at its planning blocks; list their policy readers (#6057)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (after Step 6 / after handoff, own session, parallel, one batch) | 1, 2, 3, 4 |
| Deliverable 2 (one body write, separate label call, held sibling) | 1 |
| Deliverable 3 (handoff never plans; prompt and summary say so) | 3 |
| Deliverable 4 (Step 9 per-sub-issue outcomes) | 1, 2 |
| Deliverable 5 (tests pin placement and parent exclusion) | 1, 2, 3, 4 |
| Deliverable 6 (multi-record entry, four outcomes, parent never planned) | 1 |
| Deliverable 7 (re-fetch after Step 6) | 1 |
| Deliverable 8 (delegated: dispatcher sentence under on, unchanged under off) | 3 |
| Deliverable 9 (headless holds) | 1 |
| AC1.1 (off byte-identical) | 2, 3, 4 (gate tests; dispatch fence token check) |
| AC2.1 (every non-parent sub-issue ends planned/held/skipped/no-ref, Step 9 lists which) | 1 |
| AC3.1 (red-team edits in the reviewed body) | 1 |
| AC4.1 (no planning question inside the handoff subagent) | 2, 3 |
| AC5.1 (`npm test` passes) | Verified at /build Common Step 5 |
