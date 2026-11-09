# Closing-records array fill is not portable to zsh (#4107) Implementation Plan

**Goal:** Under zsh, `/wrap-up` Section C step 2's `ISSUES=($CLOSING)` does not word-split, so a multi-record local-merge close-out writes one malformed `Fixes #101 202` line; fill the array portably instead.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4107/work/4107-spec.md` (materialized from GitHub issue #4107)

---

### Task 1: Fill ISSUES portably and pin it with an executable bash/zsh snippet test

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md`
- Modify: `tests/wrap-up-record-resolution-conformance.test.js`
- Test: `tests/wrap-up-closing-records-array-fill.test.js`
- Waived `plugin/bin/lib/wrap-up/pack.js`: read-only reference — `closingRecords` are validated integers

- [ ] **Step 1: Failing test** — create `tests/wrap-up-closing-records-array-fill.test.js`. Extract Section C step 2's fenced bash block from the live `cleanup-procedures-execution.md` by its anchor (`2. **Stamp the closing-keyword carrier commit`), cut it before the `if [ "${#ISSUES[@]}" -gt 0 ]` commit guard (never run `git commit`), substitute `${RUN_DIR}` with a temp dir holding `wrap-up-pack.json` (`{"inputs":{"closingRecords":[...]}}`), append `printf 'count=%s\n' "${#ISSUES[@]}"` plus one `el=%s` line per element, and run it under `bash` and under `zsh` (zsh case `{ skip: 'zsh not on PATH' }` when absent — visible skip, never a vacuous pass). Cases per shell: `[101, 202]` → count=2, `101`, `202`; `[101]` → count=1; `[]` → count=0. Expected now: FAIL under zsh for `[101, 202]` (count=1).
- [ ] **Step 2: Implement** — in Section C step 2, change `console.log(c.join(" "))` to `console.log(c.join("\n"))` and replace `ISSUES=($CLOSING)` with `while IFS= read -r n; do [ -n "$n" ] && ISSUES+=("$n"); done <<<"$CLOSING"`. Leave the worktree-mirror fallback `for f in "${MIRROR}"/work/*-spec.md` loop unchanged. Update `tests/wrap-up-record-resolution-conformance.test.js`'s Section C step 2 pins to the new snippet text (`c.join("\n")` and the `while IFS= read -r` loop), keeping the mirror-fallback pin.
- [ ] **Step 3: Run** `node --test tests/wrap-up-closing-records-array-fill.test.js tests/wrap-up-record-resolution-conformance.test.js` — PASS, including the zsh cases locally. Revert proof: restore the old block text in a scratch copy (or `git stash`-free temporary edit, restored in the same step) and observe the zsh `[101, 202]` case fail with count=1; restore and confirm `git diff` shows only the intended change.
- [ ] **Step 4: Commit** — one commit, `Fill closing-records array portably in wrap-up Section C — bash and zsh both split per record`, body `refs #4107`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2 (snippet change); Deliverable 2 → Step 2 (pin update); Deliverable 3 → Step 1. AC1 → Step 2; AC2 → Steps 1 + 3 revert proof; AC3 → Step 1's `[101]` and `[]` cases; AC4 → Step 2's unchanged-fallback instruction plus the kept mirror pin; AC5 → Common Step 5's full-suite verification.
- **Placeholders:** none.
