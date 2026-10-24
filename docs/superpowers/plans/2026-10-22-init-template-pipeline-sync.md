# Init Template Pipeline-Section Sync (#3859) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `plugin/skills/init/claude-md-template.md`'s `## claude-tweaks Pipeline` section back in byte-sync with this repo's CLAUDE.md by adding the Integration model paragraph and the specify-auto-continue clause.

**Architecture:** Pure prose edit inside the template's fenced Initial Mode Template block, plus a live regression test that runs `checkConformance` (`plugin/bin/lib/init/claude-md-conformance.js`) on this repo's own CLAUDE.md against the live template, so the section cannot silently drift again.

**Tech Stack:** Markdown; Node `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T152539-record-3859/work/3859-spec.md`

## Global Constraints

- Text added to the template is copied verbatim from CLAUDE.md's `## claude-tweaks Pipeline` section (the record's Proposed block). No rewording: `checkConformance` compares the section body after `.trim()`, so even a whitespace change reads as drift.
- Don't touch any other template section, and don't change CLAUDE.md.
- Commit messages use the `{Verb} {what} — {detail}` style and say `refs #3859`, never `closes`/`fixes`.
- Byte headroom: the template is 19,851 B against the 52,500 B `RAIL_BYTES` rail, and this change adds about 0.9 KB. Prose-held pin grep (`git grep -F` of the edited phrase over `tests plugin`) finds only inline fixtures in `tests/bin-lib/harness-health/override-bypass.test.js`. Nothing reads the live template there, so nothing needs re-pointing.

## Review Focus

- A CLAUDE.md Pipeline edit with no matching template edit, or the reverse. Covered by the new live conformance test (Task 1, Step 1).
- A paragraph that matches but sits in the wrong place: Integration model has to go between `**Auto mode:**` and `**Superpowers overrides:**`, or the byte comparison fails. The same test covers this.
- A stale comment in `tests/superpowers-overrides-validate-precondition.test.js` that still calls the auto-continue clause something CLAUDE.md carries "beyond the shipped template". Task 1, Step 1 updates that test.

---

### Task 1: Sync the template's Pipeline section and pin it

**Files:**
- Modify: `plugin/skills/init/claude-md-template.md` (the `## claude-tweaks Pipeline` section inside the Initial Mode Template fence, around lines 98-100)
- Test: `tests/bin-lib/init/claude-md-conformance.test.js`
- Test: `tests/superpowers-overrides-validate-precondition.test.js`

**Interfaces:**
- Consumes: `checkConformance({ templateSource, projectClaudeMd }) -> { missing, drifted, conformant }` from `plugin/bin/lib/init/claude-md-conformance.js` (already imported in the conformance test file).
- Produces: nothing for other tasks.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/init/claude-md-conformance.test.js`, after the existing live-template tests (which use the `TEMPLATE` constant), add:

```js
test("this repo's own CLAUDE.md claude-tweaks Pipeline section conforms to the live template (#3859)", () => {
  const claudeMd = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'CLAUDE.md'), 'utf8');
  const r = checkConformance({ templateSource: fs.readFileSync(TEMPLATE, 'utf8'), projectClaudeMd: claudeMd });
  assert.ok(r.conformant.includes('claude-tweaks Pipeline'), /* message naming drift between CLAUDE.md and the template */);
  assert.ok(!r.drifted.some((d) => d.section === 'claude-tweaks Pipeline'));
});
```

In `tests/superpowers-overrides-validate-precondition.test.js`, replace the last test (`CLAUDE.md still carries its own specify-auto-continue clause ...`) with a loop over `TARGETS`. Each target's Superpowers overrides line must match `/specify-auto-continue/`. Rewrite the test name and the assertion message so they no longer call the clause "beyond the shipped template". Both files now have to carry it (#3859).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/init/claude-md-conformance.test.js tests/superpowers-overrides-validate-precondition.test.js`
Expected: FAIL. Two failures: the new conformance test (the Pipeline section is reported drifted) and the template target of the specify-auto-continue test.

- [ ] **Step 3: Edit the template**

In `plugin/skills/init/claude-md-template.md`'s `## claude-tweaks Pipeline` section:
- (a) Insert this paragraph, plus a blank line, before the `**Superpowers overrides:**` line, copied verbatim from CLAUDE.md:
  `**Integration model** (`plugin/skills/_shared/integration-model.md`): GitHub-backed projects default to `pr-first` — a worktree run is born public (draft PR at run start, every phase pushes, merge happens via `gh pr merge`); no-forge projects use `local-merge`, the permanent fallback. Never re-derive which one applies ad hoc — read the resolution, once, per that file.`
- (b) In the `**Superpowers overrides:**` line, replace `never `/superpowers:writing-plans`.` with `never `/superpowers:writing-plans`; when policy key `specify-auto-continue` resolves `true` (default `false`), invoke `/claude-tweaks:specify` on the approved doc immediately instead — see `specify/SKILL.md`'s Auto-continue section.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/init/claude-md-conformance.test.js tests/superpowers-overrides-validate-precondition.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/init/claude-md-template.md tests/bin-lib/init/claude-md-conformance.test.js tests/superpowers-overrides-validate-precondition.test.js
git commit -m "Sync init template Pipeline section with CLAUDE.md — add Integration model paragraph and specify-auto-continue clause, refs #3859"
```

---

## Self-review

- **Spec coverage:** Deliverables (the Proposed Integration model paragraph and the auto-continue clause) are covered by Step 3. The acceptance criterion (the template is no longer missing either piece) is pinned by Step 1's two tests.
- **Placeholders:** none.
- **Proportion:** one task for a two-hunk prose edit plus two test edits.
