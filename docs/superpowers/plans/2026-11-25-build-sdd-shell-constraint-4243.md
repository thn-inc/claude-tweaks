# Carry the worktree shell constraint into /build's SDD implementer and reviewer dispatches (#4243) Implementation Plan

**Goal:** `/claude-tweaks:build`'s subagent path tells every SDD dispatch it composes the harness worktree shell constraint, with the scratchpad-script workaround, citing the shared files rather than restating them.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T072335-record-3902/spec-4243/work/4243-spec.md` (materialized from GitHub issue #4243)

---

### Task 1: Add the shell-constraint instruction to build/dispatch.md and pin it with a conformance test

**Files:**
- Modify: `plugin/skills/build/dispatch.md`
- Test: `tests/build-dispatch-shell-constraint-prose.test.js`
- Waived `plugin/skills/_shared/subagent-dispatch-core.md`: reference only — its "One plain command per Bash call" rule is cited, not edited
- Waived `plugin/skills/_shared/scratch-worktree.md`: reference only — §7 ("Shell constraint") is cited, not edited

- [ ] **Step 1: Failing test** — write `tests/build-dispatch-shell-constraint-prose.test.js` beside `tests/build-dispatch-status-token-and-tree-immutability.test.js` (its nearest neighbour; match its shape and size) asserting the spec's `## Acceptance Criteria`: `plugin/skills/build/dispatch.md` carries a sentence matching `shell constraint` (case-insensitive) that names the implementer, task-review, re-review, final-review, fix-round, fix-wave and whole-branch-fix dispatches, cites `subagent-dispatch-core.md`'s "One plain command per Bash call" and `scratch-worktree.md` §7, and names the scratchpad-script workaround (Write the script, run `node <script>`). Run it before Step 2 — it must go red at base.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` item: one bold-lead paragraph in `plugin/skills/build/dispatch.md`, mirroring the existing "Forbid `git stash`" instruction, that directs `/superpowers:subagent-driven-development` to include the shell-constraint paragraph in every implementer, task-review, re-review, final-review, fix-round (resumed or fresh implementer), fix-wave, whole-branch-fix and NEEDS_CONTEXT/BLOCKED re-dispatch it composes. It names heredocs, `for`/`while` loops, `cd … &&` chains and the one-plain-command-per-call rule by citing `_shared/subagent-dispatch-core.md`'s "One plain command per Bash call" and `_shared/scratch-worktree.md` §7 — never a third copy of the refusal table — plus the scratchpad-script workaround for multi-step probes. Size headroom: `dispatch.md` is 49,720 bytes at the merge base against the 52,500-byte `RAIL_BYTES` rail (within 10%); keep the paragraph short (target well under 1,000 bytes), and if it would cross the rail, cut restated bytes from the same file rather than splitting it. If `docs/plugin-structure.md` describes `build/dispatch.md`'s contents in a way this paragraph makes incomplete, update that line.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS; also run the existing build-dispatch prose tests and the `rail:` budget test that measures `plugin/skills/**/*.md` against `RAIL_BYTES`. Show the new test failing with the paragraph removed, in a scratch checkout.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4243`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above (`npm test` is Common Step 5's verification run).
- **Placeholders:** none.
