# Reference repairs staged prefix (#4585) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reference repair the Broken references row stages resolves in the Review Console's Reference repairs section instead of `pending (unmapped-prefix)`.

**Architecture:** `wrap-up-reference-` joins `SECTION_MAP` and `CANONICAL_PREFIXES` as a new prefix in an existing section, and `reference-sweep.md` names the filename a judge writes. The section, its stance, its templates and its executor already exist.

**Tech Stack:** Node 18+, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T113108-spec-4585/work/4585-spec.md`

## Global Constraints

- The prefix is exactly `wrap-up-reference-`; the staged filename is exactly `staged/wrap-up-reference-{n}.md`.
- From the governing project skill `review-console-section-addition`, verbatim: "**A new prefix in an existing section is a smaller change.** The section, its stance and its templates already exist, so only sites 2 and 3 move, plus the known-prefix case in `resolve.test.js`."
- From the same skill, site 2, verbatim: "Rows are ordered and the first match wins, so no earlier, broader row may catch the prefix."
- From the same skill, site 3, verbatim: "Every alternative of the new row, with its trailing `-`".
- `reference-sweep.md` is 5,696 B against the 52,500 B rail, so this edit leaves ample headroom.

## Review Focus

1. A staged `wrap-up-reference-1.md` the engine names once must produce one console item, not two. `engineItems` skips it only when `stagePath`'s basename is in `staged/`; Task 1's AC test asserts the item count.
2. A staged reference finding with no `staged/` file must keep resolving through the engine-row path. The existing "every ENGINE_ROW_SECTIONS row" test already pins it, unchanged.
3. An older run's `references-1.md` stays `pending (unmapped-prefix)`. This plan adds no alias and does not reclassify it: nothing but a past hand-written judge prompt ever wrote that name.

## Prose and pin inventory

- `git grep -n -F "wrap-up-adr-" -- plugin docs/plugin-structure.md docs/journeys tests` lists every site naming the sibling prefix: `resolve.js`, `adr-curation.md`, `resolve.test.js`, and the journey `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` (Common Step 6 updates the journey, not this task).
- Naming the file in `reference-sweep.md` makes the #2773 scan (`resolve.test.js:226`) find a new row, whose pinned set at `resolve.test.js:247` must gain `references`. That scan's `ENGINE_ROW_SECTIONS` branch then also proves the filename routes to Reference repairs.
- Absence control for AC2: `grep -c -F "wrap-up-reference-" plugin/skills/wrap-up/reference-sweep.md` printed `0` at the base, so the positive grep can tell the two trees apart.

---

### Task 1: Route the reference-repair staged prefix to Reference repairs

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js`
- Modify: `plugin/skills/wrap-up/reference-sweep.md`
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Consumes: `classifyStagedItem`, `resolveAll`, `SECTIONS.REF`, the test file's `fixture` and `deps` helpers.
- Produces: the staged filename contract `staged/wrap-up-reference-{n}.md`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/resolve.test.js`

Add `'wrap-up-reference-1.md': 'Reference repairs'` to the `expect` table in "classifyStagedItem maps every known prefix". Add `'references'` to the sorted pinned list in the #2773 test (`['claude-md', 'decision-records', 'journeys', 'memory', 'references', 'skills', 'upstream']`). Add this test after "every ENGINE_ROW_SECTIONS row classifies a staged finding":

```js
test('AC1.1: a staged wrap-up-reference- repair the engine names resolves once, in Reference repairs, with approve (#4585)', () => {
  const engineState = { results: { references: { result: 'findings', findings: [{ targetPath: 'docs/a.md', action: 'staged', stagePath: 'staged/wrap-up-reference-1.md' }] } } };
  const r = resolveAll({ runDir: fixture({ engineState, staged: { 'wrap-up-reference-1.md': 'repair' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.strictEqual(r.items.length, 1, 'the engine finding and its staged file are one item');
  assert.strictEqual(r.items[0].id, 'wrap-up-reference-1.md');
  assert.strictEqual(r.items[0].section, 'Reference repairs');
  assert.strictEqual(r.items[0].resolution, 'approve');
});
```

AC2.1 is the literal grep in Step 4.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL. The known-prefix case and AC1.1 fail on `Pending review`; the #2773 pin fails because `references` is not found yet.

- [ ] **Step 3: Implement**

In `resolve.js`, add a `SECTION_MAP` row `[/^wrap-up-reference-/, SECTIONS.REF]` directly after the `wrap-up-claude-md|wrap-up-adr` row, with a comment in that row's style naming #4585, `reference-sweep.md` and the `references` registry row. Add `'wrap-up-reference-',` to `CANONICAL_PREFIXES` on its own line after the `'wrap-up-claude-md-', 'wrap-up-adr-',` line.

In `reference-sweep.md` Step 4, replace the paragraph opening "When staging a candidate, pack the repair" so it reads:

```markdown
When staging a candidate, write its full proposal to `staged/wrap-up-reference-{n}.md` and name that path in the finding's `stagePath`, so the Review Console files it under Reference repairs. Pack the repair (`{old} → {new}`), the `brokenBy` path, and — at
`trusted`/`unattended` — `permittedInitiative`'s own reason string into the finding's `summary`
field. `engine-render.js`'s Change column is a plain string copy of `summary`; that column is the
only place this detail can surface on an engine-rendered console.
```

- [ ] **Step 4: Run the tests and the grep**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS, including the #3370 tests that expand each `SECTION_MAP` row against `CANONICAL_PREFIXES`.

Run: `grep -n -F "wrap-up-reference-" plugin/skills/wrap-up/reference-sweep.md`
Expected: one match, in Step 4.

- [ ] **Step 5: Commit**

Stage the three files by explicit path and commit with `git -C`:

`Route staged reference repairs to Reference repairs — wrap-up-reference- prefix`, then `Refs #4585`, then the session trailer.

---

## Self-review

- **Spec coverage:** the Deliverables (prefix in `SECTION_MAP` and `CANONICAL_PREFIXES`, filename in `reference-sweep.md`) are Step 3. AC1.1 is Step 1's named test. AC2.1 is Step 4's grep.
- **Placeholders:** none.
- **Whole-branch review:** this is one task because the three files change as one unit, not to reach the fast-lane skip.
