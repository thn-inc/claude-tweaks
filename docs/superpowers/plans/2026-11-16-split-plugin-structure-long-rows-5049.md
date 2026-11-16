# Split docs/plugin-structure.md rows over 4000 characters so concurrent PRs stop conflicting (#5049) Implementation Plan

**Goal:** Re-flow every `docs/plugin-structure.md` line longer than 4000 characters so each module entry sits on its own line, keeping every existing fact, so two PRs appending to the same row stop conflicting at merge.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231735-record-5049/work/5049-spec.md` (materialized from GitHub issue #5049)

---

### Task 1: Re-flow the over-4000-character lines and keep every row-locating test finding its entries

**Files:**
- Modify: `docs/plugin-structure.md`
- Test: `tests/ai-design-tells-lens-rows.test.js` (modify only if its row lookup stops finding the entry)
- Test: `tests/build-dispatch-subfile-table-completeness.test.js`, `tests/flow-subfile-table-completeness.test.js`, `tests/tidy-subfile-table-completeness.test.js`, and any other `tests/**/*.test.js` that reads `docs/plugin-structure.md` (modify only where a split moves text off the line the test reads)

At base, 21 lines exceed 4000 characters (the record counted 17 on 2026-11-03): lines in the `## Structure` tree code block (e.g. the `plugin/bin/hooks.js`, `plugin/bin/lib/`, `lib/issues/`, `lib/verify/`, `lib/dispatch/`, `lib/driver/`, `tools/` entries), rows of the `### Skills with sub-files` 3-column table (`build`, `review`, `specify`, `wrap-up`, `tidy`, `flow`, `dispatch`, `backlog`, `_shared`), and lines in the `## Commands` bash code block (`closing-links.js`, `post-merge-run.js`, `verify.js`).

- [ ] **Step 1: Failing check** — run `awk 'length>4000' docs/plugin-structure.md | wc -l`; it prints a non-zero count (21) at base. This is the acceptance criterion's own check; the spec asks for no new committed test, so none is added.
- [ ] **Step 2: Implement** — re-flow each over-4000 line, splitting at module-entry boundaries (before the clause that starts a new `name.js` / `name.md` / sub-module entry, e.g. after `; ` or `. `), so each module entry sits on its own line. Shape per region:
  - **Structure tree code block** (`path → description`): keep the first line as `path → ` + first entry; put each following entry on a continuation line indented with spaces to the column where the description starts. No marker characters.
  - **Skills with sub-files table**: a GFM row cannot span lines, so continue a long row with continuation rows of the same 3-column shape whose first two cells are empty — `| | | {next part of Purpose} |`. The first row keeps its `| {skill} | {full Sub-files list} | {first part of Purpose} |` shape unchanged, so `^\| {skill} \| ([^|]+) \|` and `startsWith('| {skill} |')` lookups still find it with the complete sub-file list. Never split the Sub-files cell. Any raw `|` in moved text stays escaped (`tests/skill-graph-table-structure.test.js` counts unescaped pipes per row).
  - **Commands bash code block** (`node plugin/bin/x.js … # comment`): keep the command and the opening of its `#` comment on the first line; continue the comment on following lines that begin with spaces then `# `, aligned with the first line's `#`.
  - **Fact preservation (verify before committing):** with a scratch script (not committed), tokenize base (`git show HEAD:docs/plugin-structure.md`) and the new file on whitespace, drop from the new file only the tokens this re-flow added (the empty `|` cells of continuation rows and the leading `#` of comment continuation lines), and assert the two token sequences are identical. Every fact stays, in order; nothing reworded.
  - Then find every test that reads `docs/plugin-structure.md` (`grep -rln plugin-structure tests`) and, for each one that locates a single line/row and asserts on text a split moved to a continuation line, update its lookup to read the entry together with its continuation lines (e.g. the row plus following `| | |` rows, or the tree line plus following indented lines). Never weaken or delete an assertion.
- [ ] **Step 3: Run** — `awk 'length>4000' docs/plugin-structure.md | wc -l` prints `0`; `npm test -- --full` passes (every file that reads the doc included).
- [ ] **Step 4: Commit** — one commit, `Split docs/plugin-structure.md rows over 4000 characters — refs #5049`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (re-flow each row over 4000 characters, keeping every fact) — Step 2 + its fact-preservation check; Deliverable 2 (update row-locating tests) — Step 2's last bullet; AC 1 (`awk` prints 0) — Step 3; AC 2 (`npm test` passes, no assertion weakened) — Step 3 + Step 2's last bullet.
- **Placeholders:** none.
