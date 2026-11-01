# wrap-up Section C step 2's worktree-mirror fallback aborts under zsh when no spec file matches (#4740) Implementation Plan

**Goal:** Make Section C step 2's worktree-mirror fallback in `plugin/skills/wrap-up/cleanup-procedures-execution.md` behave the same under bash and zsh when no `work/*-spec.md` file matches, instead of aborting under zsh's default `NOMATCH`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T154422-spec-4740/work/4740-spec.md` (materialized from GitHub issue #4740)

---

### Task 1: Replace the fallback glob loop with a shell-neutral read, and pin the fallback branch under bash and zsh

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md`
- Test: `tests/wrap-up-closing-records-array-fill.test.js`
- Waived `tests/wrap-up-record-resolution-conformance.test.js`: keep the mirror-path pin passing (no change expected)

- [ ] **Step 1: Failing test** — in `tests/wrap-up-closing-records-array-fill.test.js`, add fallback-branch cases that run the extracted live block with **no** `wrap-up-pack.json` and the block's `MIRROR="{worktree}/.claude-tweaks/pipelines/{run-id}"` placeholder substituted with a temp mirror directory, under both `bash --noprofile --norc` and `zsh -f` (zsh skipped visibly when not on PATH, as the existing cases do):
  - empty mirror `work/` directory → exit 0, `count=0` (AC1)
  - two mirror spec files carrying `record: 101` / `record: 202` → two elements `101`, `202` (AC2)
  Keep a frozen copy of the pre-change fallback loop as a go-red control: under `zsh -f` with an empty `work/`, it exits non-zero with `no matches found`; under bash it exits 0 with `count=0`.
- [ ] **Step 2: Implement** — replace the `for f in "${MIRROR}"/work/*-spec.md; do … done` loop in Section C step 2's fenced block with a form that does not depend on the shell's glob behavior: a `node -e` that lists `{mirror}/work/*-spec.md` headers' `record:` values one per line (an absent `work/` directory or no match prints nothing), filled through the same `while IFS= read -r n; do [ -n "$n" ] && ISSUES+=("$n"); done <<<"…"` loop the pack branch uses. No `setopt NULL_GLOB` / `(N)` qualifiers (zsh-only). Leave the pack branch and every pin from #4107 unchanged (AC3). Do not introduce any `${RUN_DIR}/work/` spelling (the record-resolution conformance test's retired list).
- [ ] **Step 3: Run** `node --test tests/wrap-up-closing-records-array-fill.test.js tests/wrap-up-record-resolution-conformance.test.js` — PASS (the zsh cases must actually run locally, not skip).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4740`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (shell-neutral fallback) → Step 2; Deliverable 2 (fallback-branch cases) → Step 1; AC1/AC2 → Step 1's two cases; AC3 → Step 2's unchanged-pack constraint and Step 3's run of the existing cases; AC4 (`npm test`) → Common Step 5's full verification.
- **Placeholders:** none.
