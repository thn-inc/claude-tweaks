# Worktree shell constraint avoid-list misses the piped-git-into-node shape (#3829) Implementation Plan

**Goal:** Make the Worktree shell constraint avoid-list name the shapes that actually refuse `wrap-up/ceremony-derivation.md`'s documented diff-facts one-liner, and rewrite that one-liner to a pre-split form that satisfies the corrected rule.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T100301-record-3829/work/3829-spec.md` (materialized from GitHub issue #3829)

**Premise correction (live-probed in this guard-isolated worktree, 2026-10-22):** piping `git`/`gh` output into `node -e` PASSES. The documented one-liner is refused for two other reasons: (a) a `git` call inside a `$(...)` substitution (`"$(git merge-base HEAD origin/main)"`) — already a row in `_shared/scratch-worktree.md` §7 — and (b) a runtime variable (`${CLAUDE_PLUGIN_ROOT}`, which is also unset in the Bash tool) inside the `node -e` script text of a command that runs `git` (the identical command with literal paths passes). `_shared/subagent-dispatch-core.md` does not restate the list; it cites §7 canonically, so it needs no change. The enumerated avoid-list dispatch prompts actually carry is `dispatch/task-prompt.md` context-pack item 6.

---

### Task 1: Name the refused shapes in the avoid-list and pre-split ceremony-derivation's one-liner

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md` (§7 table — add one row for shape (b), live-verified `2026-10-22 (#3829)`, its Shape cell noting that a plain `git`/`gh` pipe into `node -e` passes)
- Modify: `plugin/skills/dispatch/task-prompt.md` (context-pack item 6 "Avoid these shapes:" list — add shape (a) and shape (b))
- Modify: `plugin/skills/wrap-up/ceremony-derivation.md` (step 1 — replace the one-liner with two separate Bash calls: a plain `git merge-base HEAD origin/main`, then `git diff --numstat -z {merge-base} | node -e "..."` with the printed sha pasted in and the literal plugin root substituted for `${CLAUDE_PLUGIN_ROOT}`; cite §7. Keep a single line carrying `parseNumstatZ`, `| node -e` and the `${CLAUDE_PLUGIN_ROOT}` placeholder — `tests/diff-facts-parse-numstat-conformance.test.js` splices and runs it)
- Test: `tests/diff-facts-parse-numstat-conformance.test.js` (add an assertion that the composition line carries no `$(` substitution and that the doc shows `git merge-base HEAD origin/main` as its own command)

- [ ] **Step 1: Failing test** — add the assertion above; run `node --test tests/diff-facts-parse-numstat-conformance.test.js` — Expected: FAIL (the current line contains `"$(git merge-base`).
- [ ] **Step 2: Implement** — the three Modify edits above.
- [ ] **Step 3: Run** `node --test tests/diff-facts-parse-numstat-conformance.test.js tests/scratch-worktree-shell-constraint-table.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Name the refused worktree shell shapes and pre-split ceremony-derivation's diff-facts call — refs #3829`.

---

## Self-review

- **Spec coverage:** Deliverable 1 / AC clause 1 (avoid-list names the shape, or a general rule covering it) → task-prompt.md item 6 + the §7 row. Deliverable 2 / AC clause 2 (ceremony-derivation's invocation satisfies the corrected rule, or is rewritten to a pre-split form that does) → the ceremony-derivation.md rewrite, pinned by the new test.
- **Placeholders:** none.
