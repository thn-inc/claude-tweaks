# Review lens dispatch tells agents to use a shell shape the worktree-isolation guard refuses (#3675) Implementation Plan

**Goal:** Lens agents stop tripping the worktree-isolation Bash guard on their scratch files: the dispatch contract names the one-plain-command rule once, and the lens Scratch path cites it.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T162315-record-3675/work/3675-spec.md` (materialized from GitHub issue #3675)

**Base-state note:** #3519 already replaced the `mkdir -p` + redirect/heredoc recipe in `step3-lens-dispatch.md` with a shell-safe recipe, pinned by `tests/subagent-contract-clauses.test.js`. The remaining delta is the contract rule and the citations.

**Size headroom:** `plugin/skills/review/step3-lens-dispatch.md` is 48,602 bytes against `RAIL_BYTES` 52,500 (near ceiling). Its edit is a citation swap, net growth kept under ~250 bytes.

---

### Task 1: Name the one-plain-command rule in the dispatch contract and cite it from the lens Scratch path

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Working Directory Discipline: generalize the existing `EnterWorktree`-implementer shell paragraph into one named rule for any worktree-isolated dispatched agent, citing `_shared/scratch-worktree.md` §7)
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (Scratch path: cite that rule and `_shared/scratch-worktree.md` §7; `Write` allowed when the scratch path is inside the agent's own worktree)
- Test: `tests/subagent-contract-clauses.test.js`

- [ ] **Step 1: Failing test** — assert the core names the rule exactly once, the lens Scratch path cites both the core rule and `scratch-worktree.md` §7, plus a go-red control against the frozen pre-#3675 Scratch path excerpt.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3675`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
