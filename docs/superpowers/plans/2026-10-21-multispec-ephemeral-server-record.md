# Multi-spec ephemeral-server record location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a multi-spec `/flow` run, every writer and reader of `ephemeral-server.txt` should resolve one shared path, the parent run dir. A later spec's review fix wave and the consolidated teardown then find the shared server.

**Architecture:** `_shared/dev-url-detection.md`'s Ephemeral server start item 4 becomes the one definition of the **server record**: `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` when `MULTISPEC_PARENT_DIR` is set, `{run-dir}/ephemeral-server.txt` otherwise. Every reader names that same resolution. Dispatch's prompt templates already write to `{minted-run-dir}`, which is the parent for a bundle. They gain one sentence stating that, so nobody "fixes" it to a `spec-{N}/` path. A new conformance suite pins writer and readers to the same path.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T091243-record-3656/work/3656-spec.md`

Scope keywords: ephemeral-server.txt

## Global Constraints

- Single-spec runs behave exactly as today: with `MULTISPEC_PARENT_DIR` unset, the server record is `{run-dir}/ephemeral-server.txt`.
- The record is still written via a plain Bash redirect into the main checkout's run dir, never Edit/Write and never a worktree-relative path (`[IL-127]`).
- The `dispatch/task-prompt.md` fenced templates must not cite a raw `_shared/` path (`tests/dispatch-prompt-bundle-citations.test.js`, `tests/ephemeral-server-handoff-conformance.test.js`), and the file keeps exactly two fenced blocks.
- `plugin/skills/flow/multispec-review-console.md` is at 48,872 B, which is 93% of `RAIL_BYTES` (52,500). Its edit must stay within +10 bytes.
- `npm test` passes in full.

## Review Focus

1. Interactive multi-spec run (`MULTISPEC_REVIEW_DEFER` unset, `MULTISPEC_PARENT_DIR` still exported per `flow/multi-spec.md`'s table): each spec's wrap-up runs Section D against the parent record. This stops the shared server at each spec's end, and the next browser step restarts it lazily. Section D must say it reads the server record, not `{run-dir}`.
2. Parallel-wave members (`flow/multispec-parallel-waves.md`) are invoked without `MULTISPEC_PARENT_DIR`, so their record falls back to their own `spec-{N}/` dir. That is pre-existing and outside this record. Note it as a follow-up and do not change it here.
3. A dispatched bundle's second call re-checks liveness at `{minted-run-dir}/ephemeral-server.txt`. That path must equal the parent (`MULTISPEC_PARENT_DIR`), and the template sentence pins it.
4. Wrap-up's cleanup-applicability check (`wrap-up/SKILL.md`, item 6 condition) must test the server record, or a multi-spec interactive wrap-up would skip Section D.
5. A stale `{parent-run-dir}/ephemeral-server.txt` mention left anywhere in `plugin/skills/` (the original defect) is caught by Task 2's repo-wide scan.

---

### Task 1: Define the server record at the writer; pin the dispatch templates

**Files:**
- Modify: `plugin/skills/_shared/dev-url-detection.md` (Ephemeral server start item 4, ~line 138; Cleanup section first bullet, ~line 178)
- Modify: `plugin/skills/dispatch/task-prompt.md` (first template's Ephemeral dev server paragraph ~line 171-181; second template's liveness paragraph ~line 331-338)
- Create: `tests/multispec-ephemeral-server-record-conformance.test.js`

**Interfaces:**
- Produces: the literal term **server record**, and its resolution text containing both `` `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` `` and `` `{run-dir}/ephemeral-server.txt` ``. Task 2's readers cite it as "the server record (`dev-url-detection.md`'s Ephemeral server start item 4)".

- [ ] **Step 1: Write the failing tests** in the new file. Style: copy `tests/review-fix-ephemeral-server-conformance.test.js`'s `read`/`section` helpers. Tests:
  - `AC3.1: dev-url-detection item 4 defines the server record with the single-spec fallback`: the line starting `4. **Record the PID + port + detach state**` includes `server record`, `` `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` ``, `` `{run-dir}/ephemeral-server.txt` `` and `every reader resolves this same path`. It does not include `> "{run-dir}/ephemeral-server.txt"`, because the printf example redirects to `"{server-record}"`.
  - `dev-url-detection Cleanup reads the server record`: the `### Cleanup` subsection's `**In a pipeline**` bullet includes `server record`.
  - `dispatch templates write and re-check the bundle parent, never a spec-{N}/ dir`: in each of `task-prompt.md`'s two fenced blocks, the ephemeral paragraph includes `` `{minted-run-dir}/ephemeral-server.txt` `` and `never a \`spec-{N}/\` subdirectory`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/multispec-ephemeral-server-record-conformance.test.js`
  Expected: FAIL (3 failing tests: `server record` absent).

- [ ] **Step 3: Edit the prose.**
  - In item 4, replace "write `{run-dir}/ephemeral-server.txt` (one line: …) when a pipeline run dir exists — via a plain Bash redirect, e.g. `printf … > "{run-dir}/ephemeral-server.txt"`" with: write the **server record** (same one-line format) when a pipeline run dir exists. Then state that the server record is `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` when `MULTISPEC_PARENT_DIR` is set (a multi-spec `/claude-tweaks:flow` run: its specs share one server, while each spec's own `{run-dir}` is `{parent}/spec-{N}/`), and `{run-dir}/ephemeral-server.txt` otherwise, and that every reader resolves this same path. The printf example redirects to `"{server-record}"`. Keep the rest of item 4 (the Edit/Write refusal rationale and the liveness handle) unchanged.
  - In the Cleanup `**In a pipeline**` bullet, change "(`{run-dir}/ephemeral-server.txt` was written)" to "(the server record, Ephemeral server start item 4, was written)".
  - In `task-prompt.md`'s first template, after the printf sentence, add: "`{minted-run-dir}` is the run's server-record location for a bundle too -- the parent run dir `/flow` exports as `MULTISPEC_PARENT_DIR`, never a `spec-{N}/` subdirectory." Put the same sentence in the second template's liveness paragraph, after "(only if `{minted-run-dir}/ephemeral-server.txt` exists)". Use ASCII `--`, matching the template.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/multispec-ephemeral-server-record-conformance.test.js tests/ephemeral-server-handoff-conformance.test.js tests/dev-url-detection-lease-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** both prose files and the test, with message `Define multi-spec ephemeral server record at the writer — refs #3656`.

### Task 2: Point every reader at the server record; pin agreement repo-wide

**Files:**
- Modify: `plugin/skills/review/step3-routing.md` (Fix-wave server coordination items 1 and 3)
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section D intro + step 2)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (line 7 ordering rule text; table row 6)
- Modify: `plugin/skills/wrap-up/SKILL.md` (~line 235 condition list, item 6)
- Modify: `plugin/skills/flow/multispec-review-console.md` (Shared teardown step 1, ~line 176)
- Modify: `plugin/skills/flow/multispec-console-template.md` (Cleanup actions row 15)
- Modify: `plugin/skills/_shared/auto-mode-contract.md` (~line 141, Always-reversible ephemeral server bullet)
- Test: `tests/multispec-ephemeral-server-record-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's "server record" term and resolution text.

- [ ] **Step 1: Write the failing tests** (append):
  - `AC1.1: a later spec's fix wave reads the server record`: step3-routing's `## Fix-wave server coordination (pipeline runs)` section includes `read the server record` and `` `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` ``. Item 3 includes `rewrites the server record`.
  - `AC2.1/AC2.2: consolidated teardown kills the recorded shared server, so none outlives the run`: the `multispec-review-console.md` line starting `1. **Tear down the shared ephemeral dev server**` includes `` `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` ``. The `multispec-console-template.md` line starting `| 15 |` includes the same.
  - `AC2.1: Section D reads the server record`: the `## D. Ephemeral dev server` section includes `server record` and `` `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` ``, and its step 2 starts `2. Read the server record`.
  - `wrap-up cleanup applicability tests the server record`: `wrap-up/SKILL.md`'s condition sentence includes `the server record exists (6)`. `cleanup-procedures.md` line 7 includes `reads the server record`.
  - `writer and readers agree repo-wide`: walk `plugin/skills/**/*.md`. Fail on any occurrence of `{parent-run-dir}/ephemeral-server.txt`. Every file containing `{run-dir}/ephemeral-server.txt` or `${RUN_DIR}/ephemeral-server.txt` must also contain `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` or `server record`. Exempt `wrap-up/standalone-fast-path.md`, which is never multi-spec (its own line 14 precondition), and assert that exemption's precondition text (`MULTISPEC_REVIEW_DEFER`/`MULTISPEC_PARENT_DIR` are unset) is still present.
  - Go-red control for the scan: run the same scan function on a synthetic map `{ 'x.md': 'read `{parent-run-dir}/ephemeral-server.txt`' }` and on `{ 'y.md': 'read `{run-dir}/ephemeral-server.txt`' }`, and assert both report a violation.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/multispec-ephemeral-server-record-conformance.test.js`
  Expected: FAIL (the five new reader tests fail; the go-red control passes).

- [ ] **Step 3: Edit the readers.** Each one names the resolution once, citing item 4: "the server record (`_shared/dev-url-detection.md`'s Ephemeral server start item 4: `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in a multi-spec run, else `{run-dir}/ephemeral-server.txt`)". Write the cite path the way each file already cites that doc (e.g. step3-routing says `_shared/dev-url-detection.md`). Later mentions in the same section say "the server record".
  - step3-routing item 1: replace "read `{run-dir}/ephemeral-server.txt`" with "read the server record (…)". Change "With no run directory or no such file" to "With no run directory or no server record". Item 3: change "writes the new pid to `ephemeral-server.txt` with a plain Bash redirect into the main checkout's run dir" to "rewrites the server record with the new pid, via a plain Bash redirect into the main checkout's run dir".
  - Section D intro: "recorded … in `{run-dir}/ephemeral-server.txt`" becomes "recorded … in the server record (…)". Step 2: "Read `{run-dir}/ephemeral-server.txt` (…)" becomes "Read the server record (…)". Step 4 keeps `delete \`ephemeral-server.txt\``, which the existing AC2.1 pin in `tests/review-fix-ephemeral-server-conformance.test.js` holds.
  - cleanup-procedures.md line 7: "the ephemeral-server teardown reads `${RUN_DIR}/ephemeral-server.txt`" becomes "the ephemeral-server teardown reads the server record (`_shared/dev-url-detection.md`'s Ephemeral server start item 4 — `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in a multi-spec run)". Row 6: "tracked in `{run-id}/ephemeral-server.txt`" and the "exists" column become "tracked in the server record".
  - wrap-up/SKILL.md: "`${RUN_DIR}/ephemeral-server.txt` exists (6)" becomes "the server record exists (6) (`$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in a multi-spec run, else `${RUN_DIR}/ephemeral-server.txt`)".
  - `_shared/auto-mode-contract.md` line 141 (scope-creep add-to-plan from Check B): "with PID/port tracked in `{run-id}/ephemeral-server.txt`" → "with PID/port tracked in the server record (`_shared/dev-url-detection.md`'s Ephemeral server start item 4)". Add `_shared/auto-mode-contract.md` to this task's commit.
  - multispec-review-console step 1: `{parent-run-dir}/ephemeral-server.txt` becomes `$MULTISPEC_PARENT_DIR/ephemeral-server.txt` (+5 B, a byte-pin check against the rail). multispec-console-template row 15 gets the same substitution.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/multispec-ephemeral-server-record-conformance.test.js tests/review-fix-ephemeral-server-conformance.test.js tests/ephemeral-server-handoff-conformance.test.js tests/ephemeral-server-handoff-fixture.test.js`
  Expected: PASS. Then `wc -c plugin/skills/flow/multispec-review-console.md` should print ≤ 48,882.

- [ ] **Step 5: Commit** the six prose files and the test, with message `Point multi-spec ephemeral server readers at the parent record — refs #3656`.

### Final

AC4.1 (`npm test` passes in full): full `npm test` runs at `/build`'s Common Step 5 via the shared verification procedure. It is not a plan task.

Check B's remaining unplanned hits are deliberately left alone: `wrap-up/standalone-fast-path.md` (never multi-spec; exempted and its precondition pinned in Task 2); `docs/skill-graph.md` (its edge text names no path); the dated `docs/superpowers/plans/*` (historical); the existing ephemeral tests (re-run in Task 1/2 Step 4); and the #3021 journey (Common Step 6's journey pass owns it).
