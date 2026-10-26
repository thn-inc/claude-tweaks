# _shared/pr-first-merge.md park comment writes its body to a fixed shared /tmp path (#4173) Implementation Plan

**Goal:** Session-scope the fixed shared `/tmp` scratch paths in `plugin/skills/_shared/pr-first-merge.md` Step 2.5 (the Red path's park-comment body, and the bounded watch's `gh pr checks` capture the Red path reads its check names from) so two sessions parking records that share an `{n}` can no longer clobber each other's files.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T122851-record-4173/work/4173-spec.md` (materialized from GitHub issue #4173)

**Scope note (add-to-plan):** adding `_shared/pr-first-merge.md` to `MIGRATED_FILES` (Deliverable 2) puts the whole file under that suite's "no literal unscoped /tmp path" test, which also matches `/tmp/pr-checks-{n}.txt` (Step 2.5's bounded watch, the RC=1 bullet, and the Red path's `$REASON` note). That path carries the same shared-name hazard, so it is migrated in this same task; otherwise Deliverable 2's test cannot pass.

---

### Task 1: Session-scope Step 2.5's park-comment and checks-capture paths, and pin it

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md`
- Modify: `plugin/skills/_shared/session-tmp-root.md`
- Test: `tests/session-tmp-root-migration.test.js`

- [ ] **Step 1: Failing test** — in `tests/session-tmp-root-migration.test.js`: add `'_shared/pr-first-merge.md'` to `MIGRATED_FILES` (comment `// #4173: Step 2.5 park comment + checks capture`), and add a pin test that reads `_shared/pr-first-merge.md` and asserts (a) no `/tmp/park-comment-` substring remains, (b) the Red path resolves `PARK_COMMENT=park-comment-{n}.md` through `bin/session-tmp-resolve.js`, (c) both the `printf` redirect and the `--body-file` argument use the quoted `"{park-comment-path}"` placeholder, plus a go-red assertion against a frozen copy of the pre-change two-line fence (it carries `/tmp/park-comment-{n}.md` and no `session-tmp-resolve.js`). Run: `node --test tests/session-tmp-root-migration.test.js` — Expected: FAIL.
- [ ] **Step 2: Implement** — in `pr-first-merge.md` Step 2.5: before the bounded-watch fence, resolve `PR_CHECKS=pr-checks-{n}.txt` via `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js"` (cite `_shared/session-tmp-root.md`) and use the printed literal as `"{pr-checks-path}"` in the watch loop and in the two prose references; in the Red path, resolve `PARK_COMMENT=park-comment-{n}.md` the same way and use the printed literal `"{park-comment-path}"` in both the `printf` redirect and the `--body-file` argument (a worktree session refuses a runtime variable path, `_shared/scratch-worktree.md` section 7). In `session-tmp-root.md`'s Consumers section, add an `**Extended (#4173):**` paragraph naming `skills/_shared/pr-first-merge.md`'s Step 2.5 and both basenames.
- [ ] **Step 3: Run** `node --test tests/session-tmp-root-migration.test.js tests/merge-verification-gate-conformance.test.js tests/pr-first-merge.test.js tests/bin-lib/skill-audit/context-cost.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Session-scope pr-first-merge.md Step 2.5 park-comment and checks paths — refs #4173`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (park-comment path resolved through `session-tmp-resolve.js`, literal in both `printf` and `--body-file`) → Step 2. Deliverable 2 (`MIGRATED_FILES` entry, consumer list, pin test) → Steps 1-2. AC1 (no literal `/tmp/park-comment-`) → Step 1 (a). AC2 (pin asserts the session-scoped form and goes red against the old path) → Step 1 (b)-(c) + go-red. AC3 (`npm test` passes) → Common Step 5 full-suite verification.
- **Placeholders:** none.
