# Multi-spec and design-wrapper materialized-header readers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the three remaining readers of a run's materialized spec header outside `wrap-up/` from the main-checkout run dir (empty before merge in a worktree run) to the worktree mirror, capture `parked-at-shaping` before the multi-spec shared worktree can disappear, and pin it with a conformance test that is proven able to go red.

**Architecture:** Prose-only change to two skill files plus one conformance test. The mirror path convention is the one #3365 already established in `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section C step 2 / Section E item 7 (`{worktree}/.claude-tweaks/pipelines/{run-id}/…/work/{id}-spec.md`, `{worktree}` = `run-state.json`'s `worktree`, else `worktreeAtClose`), mirrored in code by `plugin/bin/lib/wrap-up/pack.js`'s `resolveRecords` (own `work/` first, then `worktreeMirror`) and `readRunStateWithParent` (a `spec-{N}/` run dir takes `worktree` from the parent's `run-state.json`).

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183747-record-3395/work/3395-spec.md`

**Execution:** subagent

Scope keywords: $PIPELINE_RUN_DIR/work/*-spec.md, so it's read directly here

## Global Constraints

- No directive in `plugin/skills/flow/multispec-*.md` or `plugin/skills/_shared/design-wrapper-handling.md` reads a main-checkout `work/*-spec.md` path as its only source (AC1).
- Keep the run dir's own `work/` read for `current-branch` runs (Deliverable 1).
- Mirror path for a multi-spec spec: `{worktree}/.claude-tweaks/pipelines/{run-id}/spec-{id}/work/{id}-spec.md`, worktree from the **parent** `run-state.json`, `worktreeAtClose` for a closed run (Deliverable 1, verbatim).
- `tests/multispec-not-run-callsite.test.js:114` pins the literal `status: not-run` in `multispec-review-console.md` — keep it.
- Commit messages reference the record as `refs #3395`, never `closes`/`fixes`.

## Review Focus

1. A per-spec `spec-{N}/` run dir passed as `$PIPELINE_RUN_DIR` to the design-wrapper pre-check carries no `worktree` in its own `run-state.json` — the prose must say the worktree comes from the parent (pack.js `readRunStateWithParent`), or `--surface` is silently omitted again. Covered by Task 1's text; the AC1 pin checks only the mirror token, so the reviewer must read the sentence.
2. A `status: not-run` spec has no header anywhere (never materialized) — the multi-spec capture must not treat "no header" as an error; step 3 still releases it by manifest `id`. Task 2 keeps that branch.
3. A `current-branch` multi-spec run has no worktree and step 6 never runs — the capture must read `$MULTISPEC_PARENT_DIR/spec-{id}/work/{id}-spec.md` there. Task 2.
4. Deictic drift: the Per-issue label cleanup section sits *below* Shared teardown, so it must point "above" to the capture. Task 2.
5. A pin that only checks token presence passes even if the capture paragraph sits after step 6 — Task 2's AC2 test asserts position, with a mutation control.

---

## Behavioral claims and their mechanisms

- "A merged PR makes the shared worktree a reap candidate" — `plugin/bin/lib/reconcile/reap-merged.js` (reaps worktrees whose branch's PR merged, skipping locked worktrees and the caller's own cwd). Why the capture runs before step 2, not only before step 6.
- "A worktree run commits the header only on its branch" — `plugin/skills/flow/materialize.md` "When this runs" / `pack.js` `resolveRecords` comment.
- "A per-spec run dir takes `worktree` from the parent" — `pack.js` `resolveState` → `hooks/context.js` `readRunStateWithParent`.

### Task 1: design-wrapper `--surface` reads the worktree mirror

**Files:**
- Modify: `plugin/skills/_shared/design-wrapper-handling.md:53` (the `--surface` bullet)
- Test: `tests/wrap-up-record-resolution-conformance.test.js` (append)

**Interfaces:**
- Produces (test helpers, appended to the test file, reused by Task 2):
  - `const HEADER_PATH = /work\/(?:\*|\{[^}]+\})-spec\.md/;`
  - `const MIRROR = '{worktree}/.claude-tweaks/pipelines/{run-id}/';`
  - `function blocks(text): string[]` — splits on blank lines and on line starts that open a list item (`/\n\s*\n|\n(?=\s*(?:\d+\.|-) )/`), each block passed through `collapse`.
  - `function unmirroredHeaderReads(text): string[]` — blocks matching `HEADER_PATH` that do not include `MIRROR`.
  - `const SCOPE_FILES` — every `plugin/skills/flow/multispec-*.md` (via `fs.readdirSync`) plus `plugin/skills/_shared/design-wrapper-handling.md`.

- [ ] **Step 1: Write the failing tests** (append to `tests/wrap-up-record-resolution-conformance.test.js`)

```js
// Frozen pre-change excerpts (at d3c7fd26b) — the three directives #3395 retires.
const PRE_SURFACE = "- `--surface` — the record's materialized header `surface:` field (`flow/materialize.md`), when exactly one record is in scope (read from `$PIPELINE_RUN_DIR/work/*-spec.md`'s frontmatter).";
const PRE_STEP3 = 'For each `id` whose `spec-{id}/work/{id}-spec.md` exists (materialized from a record via `materialize.md`), read its header `record:` field to confirm the issue number. The materialized file is never deleted before this point — only archived once the run dir is archived — so it\'s read directly here; there is no separate pre-deletion capture.';
const PRE_PARKED = "AND that record's materialized header (`spec-{spec}/work/{issue}-spec.md` — read directly; per the release item above, the file is never deleted before this point) carries `parked-at-shaping: true`";

test('AC3.1: unmirroredHeaderReads flags each pre-change directive (the AC1 pin can go red)', () => {
  for (const pre of [PRE_SURFACE, PRE_STEP3, PRE_PARKED]) assert.equal(unmirroredHeaderReads(pre).length, 1, pre);
  assert.deepStrictEqual(unmirroredHeaderReads('read `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`, else the run dir\'s own `work/*-spec.md`'), []);
});

test('the #3395 scope corpus is non-empty (the sweep below is not vacuous)', () => {
  assert.ok(SCOPE_FILES.length > 10, `only ${SCOPE_FILES.length} scope files`);
  assert.ok(SCOPE_FILES.includes('plugin/skills/_shared/design-wrapper-handling.md'));
});

for (const rel of SCOPE_FILES) {
  test(`AC1.1: ${rel} never reads a main-checkout work/*-spec.md as its only source`, () => {
    assert.deepStrictEqual(unmirroredHeaderReads(read(rel)), []);
  });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
Expected: FAIL — `AC1.1: plugin/skills/_shared/design-wrapper-handling.md …` and `AC1.1: plugin/skills/flow/multispec-review-console.md …` (the latter stays red until Task 2); the AC3.1 control passes.

- [ ] **Step 3: Rewrite the `--surface` bullet's source clause**

Replace `(read from `$PIPELINE_RUN_DIR/work/*-spec.md`'s frontmatter)` with a clause that: reads the run dir's own `work/*-spec.md` frontmatter first (a `current-branch` run); else the worktree mirror `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`, `{worktree}` being `run-state.json`'s `worktree` (else `worktreeAtClose`; a per-spec `spec-{N}/` run dir takes it from the parent run's `run-state.json`) and `{run-id}` the run dir's path after its `.claude-tweaks/pipelines/` segment; and says why in one clause (a worktree run commits the header only on its branch, so the main-checkout run dir holds none until merge). Leave the rest of the bullet ("Omit when no single record is resolvable …") unchanged.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js tests/design-wrapper-caller-precheck.test.js`
Expected: only `AC1.1: plugin/skills/flow/multispec-review-console.md …` still fails.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/design-wrapper-handling.md tests/wrap-up-record-resolution-conformance.test.js
git commit -m "Repoint design-wrapper --surface to the worktree mirror — refs #3395"
```

### Task 2: multi-spec teardown captures headers before the shared worktree can go

**Files:**
- Modify: `plugin/skills/flow/multispec-review-console.md` — "### Shared teardown" lead (insert after the "These steps appear as visible …" paragraph, before step 1), step 3 (line ~181), step 6 (line ~184), "### Per-issue label cleanup" (line ~206)
- Test: `tests/wrap-up-record-resolution-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `blocks`, `MIRROR`, `unmirroredHeaderReads`, `collapse`, `read`.
- Produces: `function assertCaptureBeforeTeardown(text)` (test-local).

- [ ] **Step 1: Write the failing tests** (append to `tests/wrap-up-record-resolution-conformance.test.js`)

```js
const CAPTURE_ANCHOR = "**Before step 1 — capture each spec's header fields.**";
function assertCaptureBeforeTeardown(text) {
  const start = text.indexOf('### Shared teardown');
  const end = text.indexOf('### Per-issue label cleanup', start);
  assert.ok(start !== -1 && end !== -1, 'Shared teardown section anchors vanished');
  const section = text.slice(start, end);
  const capture = section.indexOf(CAPTURE_ANCHOR);
  assert.ok(capture !== -1, 'no header capture paragraph in Shared teardown');
  const block = blocks(section.slice(capture)).find((b) => b.includes(collapse(CAPTURE_ANCHOR)));
  assert.ok(block.includes('parked-at-shaping') && block.includes(MIRROR), 'capture must read parked-at-shaping from the worktree mirror');
  const finish = section.indexOf('2. **Finish the shared branch.**');
  const removal = section.indexOf('6. **Remove the shared worktree**');
  assert.ok(finish !== -1 && removal !== -1, 'step 2/6 anchors vanished');
  assert.ok(capture < finish && finish < removal, 'capture must precede step 2 (merge) and step 6 (worktree removal)');
}

test('AC2.1: the multi-spec teardown captures parked-at-shaping before the step that removes the shared worktree', () => {
  assertCaptureBeforeTeardown(read('plugin/skills/flow/multispec-review-console.md'));
});

test('AC3.1: assertCaptureBeforeTeardown goes red when the capture is removed or moved after step 6', () => {
  const live = read('plugin/skills/flow/multispec-review-console.md');
  const i = live.indexOf(CAPTURE_ANCHOR);
  const j = live.indexOf('\n\n', i);
  const para = live.slice(i, j);
  assert.throws(() => assertCaptureBeforeTeardown(live.replace(para, '')));
  const moved = live.replace(para + '\n\n', '').replace('7. **Branch + remote-ref cleanup', para + '\n\n7. **Branch + remote-ref cleanup');
  assert.throws(() => assertCaptureBeforeTeardown(moved));
});

test('Per-issue label cleanup uses the captured value, not a fresh header read', () => {
  const flat = collapse(read('plugin/skills/flow/multispec-review-console.md'));
  const s = flat.slice(flat.indexOf('### Per-issue label cleanup'));
  assert.match(s.slice(0, 1500), /captured/);
  assert.doesNotMatch(s.slice(0, 1500), /read directly/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
Expected: FAIL after Step 1 — `AC2.1 …` ("no header capture paragraph"), the AC3.1 mutation control (throws on `indexOf` of a missing anchor → `para` empty; acceptable red), `Per-issue label cleanup …`, and `AC1.1: …multispec-review-console.md`.

- [ ] **Step 3: Edit `multispec-review-console.md`**

1. Insert, as its own paragraph immediately before `1. **Tear down the shared ephemeral dev server**`, a paragraph opening with the exact anchor `**Before step 1 — capture each spec's header fields.**` stating: for each `id` in `manifest.yml`'s `specs[].id`, read `{worktree}/.claude-tweaks/pipelines/{run-id}/spec-{id}/work/{id}-spec.md` — `{worktree}` is `$MULTISPEC_PARENT_DIR/run-state.json`'s `worktree` (else `worktreeAtClose`), `{run-id}` is `basename "$MULTISPEC_PARENT_DIR"`; a `current-branch` run (no worktree, step 6 never runs) reads `$MULTISPEC_PARENT_DIR/spec-{id}/work/{id}-spec.md` instead; keep per `id` its `record:` value (step 3) and whether it carries `parked-at-shaping: true` ("Per-issue label cleanup" below); an `id` with no header (a `not-run` spec never materialized) simply has nothing captured. Why here: the header is committed only on the run's branch, so the main-checkout parent run dir holds no `spec-{id}/work/` file until merge; and from step 2 on a merged PR makes the worktree a reap candidate (`bin/lib/reconcile/reap-merged.js`), and step 6 removes it — nothing after this point re-reads a header.
2. Step 3: replace "not by globbing `spec-*/work/*-spec.md` alone" with "not by the captured headers alone"; "has no `work/` file to glob" → "has no header to capture"; replace the sentence pair "For each `id` whose `spec-{id}/work/{id}-spec.md` exists … there is no separate pre-deletion capture." with "For each `id` with a captured header (materialized from a record via `materialize.md`), its captured `record:` value confirms the issue number."; "with `status: not-run` and no `work/` file" → "with `status: not-run` and no captured header". Keep everything from "the manifest's own `id` IS the record/issue number" onward, including `status: not-run`.
3. Step 6: "step 3's claim release reads each spec's materialized header from inside this worktree" → "the header capture before step 1 reads each spec's materialized header from inside this worktree".
4. Per-issue label cleanup: replace "that record's materialized header (`spec-{spec}/work/{issue}-spec.md` — read directly; per the release item above, the file is never deleted before this point) carries `parked-at-shaping: true`" with "that record's header carried `parked-at-shaping: true` when captured before Shared teardown's step 1 (above)". Keep `(materialize.md's field for exactly this restore-on-abandon case)` and the rest.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js tests/multispec-not-run-callsite.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-review-console.md tests/wrap-up-record-resolution-conformance.test.js
git commit -m "Capture multi-spec headers from the worktree mirror before teardown — refs #3395"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (repoint readers, keep current-branch read) | Task 1 (design-wrapper), Task 2 items 1-4 |
| Deliverable 2 (capture `parked-at-shaping` before worktree removal) | Task 2 item 1 |
| Deliverable 3 (extend the absence pin) | Tasks 1 and 2 tests |
| AC1.1 | Task 1 `AC1.1` per-file tests |
| AC2.1 | Task 2 `AC2.1` |
| AC3.1 | Task 1 and Task 2 `AC3.1` controls |

Waived AC4.1: `npm test` passing is verified by `/build` Common Step 5 and `/test`, not by a unit test.

## Byte budget

`multispec-review-console.md` is 40,803 bytes against the shared 51,200 ceiling (no per-file pin found: `git grep multispec-review-console -- tests/bin-lib/skill-audit` hits only a comment); Task 2 adds ~1 KB. `design-wrapper-handling.md` is 6,611 bytes.

## As built (Common Step 4.5 — Beneficial deviations)

1. **Capture position.** Deliverable 2 asks for `parked-at-shaping` to be captured before the shared worktree is removed (step 6). As built, the capture paragraph opens Shared teardown — `**Before any step below — capture each spec's header fields.**` (renamed from this plan's "Before step 1" by the final-review fix wave e18e42f14, since step 1's dev-server row may run any time or be skipped). It therefore precedes step 2's merge too, which makes the worktree a reap candidate (`bin/lib/reconcile/reap-merged.js`). This is stronger than the spec's floor.
2. **Extra in-scope reader.** `plugin/skills/flow/multispec-console-template.md`'s Issue closures omit-condition keyed on "no materialized header present" — a same-class main-checkout header read with no path literal, so the AC1 path pin cannot see it. The final review found it, and e18e42f14 re-keyed it on `manifest.yml`'s `specs[].id`. It is within AC1's `multispec-*.md` scope.
