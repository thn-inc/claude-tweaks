# /specify Next Actions recommends /flow on a record with an open blocked-by edge (#4703) Implementation Plan

**Goal:** `/claude-tweaks:specify`'s Next Actions stops recommending a `/claude-tweaks:flow` that cannot run because the shaped record has an open blocker.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T124904-spec-4702-4703/spec-4703/work/4703-spec.md` (materialized from GitHub issue #4703)

---

### Task 1: Add a blocker-aware row to `/specify`'s Next Actions

**Files:**
- Modify: `plugin/skills/specify/next-actions.md`
- Test: `tests/specify-next-actions-blocked.test.js` (Create)

- [ ] **Step 1: Failing test** — create `tests/specify-next-actions-blocked.test.js` (style: `tests/specify-near-duplicate-prose.test.js` / `tests/batch-ref-argument.test.js` — `node:test`, `node:assert`, whitespace-flattened read of `plugin/skills/specify/next-actions.md`). Pin, each as its own `assert` with a message:
  - a table row whose Situation cell starts `| Any shaped or produced record has an open blocker` exists;
  - the file names `bin/resolve-blockers.js` and cites `materialize.md`'s `blocked-by` reader as the one reused (literal `` `skills/flow/materialize.md`'s `blocked-by` `` substring), plus `parseDependencies` (body-text) and `facets.blockedBy` (local-files);
  - inside that row's cell, the bolded `**(Recommended)**` entry is not a `/claude-tweaks:flow #{N}` line for the blocked record — assert the row contains `` `gh issue view #{blocker}` `` with `**(Recommended)**` on the same option, and that the blocked record's line reads `` `/claude-tweaks:flow #{N}` `` followed by `once #{blocker} closes` with no `**(Recommended)**` in that option;
  - the six pre-existing rows are byte-identical to today's (pin each existing row line verbatim as a constant copied from today's file — AC "unchanged rendering");
  - a mutation control: factor the blocked-row pins into `assertBlockedRow(text)`, then assert `assert.throws(() => assertBlockedRow(text.replace(<the new row line>, '')), /<that assert's own message>/)`, so removing the row is what fails it and not some other pin.
  Run `node --test tests/specify-next-actions-blocked.test.js` — FAIL (row absent).
- [ ] **Step 2: Implement** — edit `plugin/skills/specify/next-actions.md` in place, keeping every existing row and sentence unchanged:
  1. Add a **Blocker check** paragraph before the table: before choosing a row, read each record the table would recommend with the existing reader — `skills/flow/materialize.md`'s `blocked-by` reader, never a parallel one: `work-links: native` → `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-blockers.js" {N1},{N2}` (one JSON line keyed by record number: `blockedBy`, `openBlocker`, `openBlockerIds`); `work-links: body-text` → `parseDependencies(body)` (`bin/lib/issues/record.js`) plus each blocker's state; `work-backend: local-files` → `facets.blockedBy` plus each blocker record's `closed`. A blocker that is itself one of the records in the recommended command does not count (`/claude-tweaks:flow`'s multi-spec ordering builds it first). A non-zero exit or unparseable output never reads as unblocked: render the matching row unchanged, then one line under it naming the failure — `Blocker check failed ({reason}) — confirm with gh issue view #{N} before running /claude-tweaks:flow.`
  2. Add the table row `| Any shaped or produced record has an open blocker (Blocker check above) | …` with options: 1. `gh issue view #{blocker}` — see what #{N} is waiting on **(Recommended)**, or, when the blocker carries `ready` and no `bot:in-progress` claim, `/claude-tweaks:flow #{blocker}` — clear the blocker first **(Recommended)** instead; 2. `/claude-tweaks:flow #{N}` — once #{blocker} closes (never bolded); 3. for a multi-record run, `/claude-tweaks:flow #{unblocked Ns}` — pipeline only the unblocked records; 4. `/claude-tweaks:help` — pipeline dashboard. Under `work-backend: local-files` the existing id-form note applies (bare ids; the `gh issue view` option becomes reading the blocker record file).
  3. Add one sentence to the render rules: this row takes precedence over the mode rows whenever the Blocker check finds an open blocker; with no open blocker, the mode rows render exactly as before.
- [ ] **Step 3: Run** `node --test tests/specify-next-actions-blocked.test.js tests/batch-ref-argument.test.js tests/specify-next-mode.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Add blocker-aware row to /specify Next Actions — never recommend a /flow that cannot run (refs #4703)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2.1 (reader reuse per backend); Deliverable 2 → Step 2.2 (runnable step first, unbolded `/flow` "once #{blocker} closes", multi-record over unblocked only). AC1 → row + `bin/resolve-blockers.js` citation pins; AC2 → bold-recommendation pin; AC3 → existing-rows-unchanged pins + Step 2.3; AC4 → the new prose test with its mutation control.
- **Placeholders:** none.
