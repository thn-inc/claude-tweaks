# Absence-Grep Run-Directory Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repo-root-scoped absence criteria exclude `.claude-tweaks/pipelines`, where `/flow` commits the materialized spec that quotes the target, at authoring time (`spec-template.md`) and as a plan-time correction (`plan-authoring-checks.md`), pinned by the existing prose suite and recorded in the absence-grep journey.

**Architecture:** Prose-only change to two shipped skill sub-files, each extended by one or two sentences inside its existing paragraph (no new section), plus two assertions in the existing conformance suite and one journey step. Follows the `## Delete + Tombstone Acceptance Criteria` precedent: scope out a structurally guaranteed self-match, keep the control run on the scoped form.

**Tech Stack:** Markdown skill files; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-31T165712-record-4579/work/4579-spec.md` (record #4579)

## Global Constraints

- The pathspec literal is exactly `':!.claude-tweaks/pipelines'` (same spelling as `plugin/bin/lib/release-tip/check.js:95`'s `RUN_DIR_PATHSPEC`). Never exclude all of `.claude-tweaks/` — `.claude-tweaks/policy.yml` is real configuration.
- Both new rules contain the sentence, verbatim: `A search already scoped to named paths outside `.claude-tweaks/` needs no exclusion.` (AC4).
- Both new rules cite `#4579`.
- The new `plan-authoring-checks.md` text must NOT contain the phrase `Absence-grep control check` (the suite asserts it occurs exactly once in the file) and must stay inside the existing paragraph (the suite slices the paragraph from its bold lead to the next `\n\n`).
- The exclusion is added to the search, never substituted for the control run: the control run applies to the excluded form.
- **Byte rail:** `plugin/skills/build/plan-authoring-checks.md` is 52,030 B at the merge base; `RAIL_BYTES` is 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`) — 470 B headroom. Remedy named up front: Task 2 replaces the paragraph's last sentence ("The plan copied it into its Global Constraints and Task 2 and plan audit passed it; only the Task 2 implementer caught it at dispatch, where `grep -rnF` matched line 56 of the old file and nothing at HEAD.") with "Plan audit passed it; only the Task 2 implementer caught it, at dispatch." (the dropped detail stays in the journey's Step 2). Final size must be ≤ 52,400 B (`wc -c`). `plugin/skills/specify/spec-template.md` is 26,116 B — no constraint.
- Governing project skill `.claude/skills/skill-prose-conformance-tests` applies to Task 1/2's test edits. Quoted rules: "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test." and the anti-pattern row "Proving a prose pin discriminates by mutating the tree (revert the fix, delete the pinned sentence) and re-running … `git show {base}:{file}` proves the same thing with zero mutation". Prose reads come from `tests/helpers/read-skill.js`'s `readText` (already used). AC3's revert proof therefore runs in a scratch mirror (Task 2 Step 6), never by editing the tree.
- Commits reference the record as `refs #4579`, never `closes`/`fixes`.

## Review Focus

- A search scoped to named non-`.claude-tweaks/` paths (e.g. `git grep -F x -- plugin/`) must not be told to add the exclusion — pinned by the shared "needs no exclusion" sentence in both assertions.
- A reader might exclude all of `.claude-tweaks/` — the rule names only `.claude-tweaks/pipelines`; pinned by the exact literal.
- The excluded search still gets a control run — the spec-template sentence states it; pinned by asserting `the control run applies to the excluded form`.
- The plan-time correction must read as a plan correction, not an SDD ruling or Review Console item — pinned by asserting `a plan correction, never an SDD ruling`.
- Other suites slicing `spec-template.md`'s `## Acceptance Criteria` (`tests/specify-consumer-facing-ac.test.js`, `tests/specify-count-relative-ac.test.js`) must stay green — the new sentence repeats none of their needles; verified by running them in Task 1 Step 4.

---

### Task 1: Authoring rule in `spec-template.md`

**Role:** integration

**Files:**
- Modify: `plugin/skills/specify/spec-template.md` (the absence-criterion paragraph in `## Acceptance Criteria`, currently line 68)
- Test: `tests/absence-grep-control-check-prose.test.js`

**Interfaces:**
- Consumes: the suite's existing `acSection()` helper.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test** — append to `tests/absence-grep-control-check-prose.test.js`:

```js
test('the AC template excludes the run directory from a repo-root absence search (#4579)', () => {
  const ac = acSection();
  assert.ok(ac.includes(":!.claude-tweaks/pipelines"), 'the AC section must name the run-directory pathspec');
  assert.ok(ac.includes('#4579'), 'the AC section must cite #4579');
  assert.ok(ac.includes('the control run applies to the excluded form'), 'the excluded search still gets the control run');
  assert.ok(ac.includes('A search already scoped to named paths outside `.claude-tweaks/` needs no exclusion.'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/absence-grep-control-check-prose.test.js`
Expected: FAIL — `the AC section must name the run-directory pathspec`

- [ ] **Step 3: Extend the paragraph** — append, at the end of the paragraph that begins "A criterion asserting that a search returns nothing", two sentences carrying: a returns-nothing search whose scope includes the repo root (a `git grep` with no pathspec or a `.` pathspec, or a recursive `grep`/`rg` over the root) excludes the pipeline run directory — `':!.claude-tweaks/pipelines'` appended to a `git grep` pathspec, or the equivalent directory exclusion for another search tool — because `/flow` commits the materialized spec under that directory on the feature branch and the spec quotes the target; the literal phrase "the control run applies to the excluded form"; a `#4579` citation; then the verbatim Global Constraints sentence "A search already scoped to named paths outside `.claude-tweaks/` needs no exclusion."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/absence-grep-control-check-prose.test.js tests/specify-consumer-facing-ac.test.js tests/specify-count-relative-ac.test.js tests/spec-template-generator-grep.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/spec-template.md tests/absence-grep-control-check-prose.test.js
git commit -m "Exclude the run directory from repo-root absence criteria in spec-template — refs #4579"
```

### Task 2: Plan-time correction in `plan-authoring-checks.md`

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md` (the **Absence-grep control check** paragraph, line 71)
- Test: `tests/absence-grep-control-check-prose.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the failing test** — append:

```js
test('the control check adds the run-directory exclusion as a plan correction (#4579)', () => {
  const start = CHECKS.indexOf('**Absence-grep control check');
  const paragraph = CHECKS.slice(start, CHECKS.indexOf('\n\n', start));
  assert.ok(paragraph.includes(":!.claude-tweaks/pipelines"), 'the paragraph must name the run-directory pathspec');
  assert.ok(paragraph.includes('#4579'), 'the paragraph must cite #4579');
  assert.ok(paragraph.includes('a plan correction, never an SDD ruling'), 'the exclusion is a plan correction, not an SDD ruling');
  assert.ok(paragraph.includes('A search already scoped to named paths outside `.claude-tweaks/` needs no exclusion.'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/absence-grep-control-check-prose.test.js`
Expected: FAIL — `the paragraph must name the run-directory pathspec`

- [ ] **Step 3: Edit the paragraph** — (a) replace its last sentence with "Plan audit passed it; only the Task 2 implementer caught it, at dispatch." (Global Constraints byte rail); (b) append: a plan step or pinned acceptance criterion carrying a repo-root-scoped absence search (a `git grep` with no or a `.` pathspec, or a recursive `grep`/`rg` over the root) without the run-directory exclusion gets `':!.claude-tweaks/pipelines'` added (or the tool's equivalent), with a note beside the control-run match that it was added per #4579 — the literal phrase "a plan correction, never an SDD ruling" and "never a Review Console item", with the reason (it keeps the record's intent; `/flow` commits the materialized spec, which quotes the target, under that directory); then the verbatim Global Constraints "needs no exclusion" sentence. Must not contain `Absence-grep control check`; no blank line inside.

- [ ] **Step 4: Run tests and the byte check**

Run: `node --test tests/absence-grep-control-check-prose.test.js` → Expected: PASS
Run: `wc -c plugin/skills/build/plan-authoring-checks.md` → Expected: ≤ 52400

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/plan-authoring-checks.md tests/absence-grep-control-check-prose.test.js
git commit -m "Add the run-directory exclusion to the absence-grep plan check — refs #4579"
```

- [ ] **Step 6: Go-red proof (AC3), zero tree mutation** — a scratchpad node script builds a mirror dir holding `tests/absence-grep-control-check-prose.test.js`, `tests/helpers/read-skill.js` and the five `plugin/skills/...` files the suite reads (copied from HEAD), then twice: overwrites one mirror copy with its pre-change bytes (`git show {merge-base}:plugin/skills/specify/spec-template.md`, then `git show {merge-base}:plugin/skills/build/plan-authoring-checks.md`), runs `node --test` on the mirror test, and records which test failed. Expected: run 1 fails only the `(#4579)` AC-template test; run 2 fails only the `(#4579)` control-check test; an unmodified mirror run passes. Quote raw output in the task report.

### Task 3: Journey step

**Role:** transcription

**Files:**
- Modify: `docs/journeys/prove-an-absence-grep-can-match-3571.md`

- [ ] **Step 1: Add `### 4. Exclude the run directory from a repo-root search`** after "### 3. Scope out a tombstone", in the file's step shape (URL / Action / Should feel / Should understand / Red flags): URL = `spec-template.md`'s `## Acceptance Criteria` and `plan-authoring-checks.md`'s control check; Action = append `':!.claude-tweaks/pipelines'` to a repo-root-scoped `git grep` (or the tool's equivalent) and run the control on the excluded form; Should understand = `/flow` commits the materialized spec (`.claude-tweaks/pipelines/<run>/work/<n>-spec.md`) on the feature branch and it quotes the target, so the unscoped search always matches it; a build that finds the exclusion missing adds it as a plan correction, not an SDD ruling; a search scoped to named paths outside `.claude-tweaks/` needs none; Red flags = excluding all of `.claude-tweaks/` (hides `policy.yml`), a pathspec substituted for the control run.
- [ ] **Step 2: Origin** — add a bullet: "Updated during build of #4579: Step 4, the run-directory exclusion for a repo-root-scoped search." 
- [ ] **Step 3: Commit**

```bash
git add docs/journeys/prove-an-absence-grep-can-match-3571.md
git commit -m "Add the run-directory exclusion step to the absence-grep journey — refs #4579"
```
