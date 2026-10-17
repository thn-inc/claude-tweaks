# Dispatch Task calls pass `auto` explicitly to /flow (#3335) Implementation Plan

**Goal:** `/claude-tweaks:dispatch`'s two Task-call `/claude-tweaks:flow` command forms pass `auto` explicitly, so a project with `auto-mode: default-off` no longer resolves every dispatched (headless) `/flow` call to `interactive`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T093021-record-3335/work/3335-spec.md` (materialized from GitHub issue #3335)

---

### Task 1: Append `auto` to all 8 dispatch `/claude-tweaks:flow` command forms, add the rationale sentence, and pin it with a prose-conformance test

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md`
- Modify: `plugin/skills/dispatch/SKILL.md`
- Test: `tests/dispatch-flow-explicit-auto-mode.test.js` (Create)

- [ ] **Step 1: Failing test** — create `tests/dispatch-flow-explicit-auto-mode.test.js` (live-corpus read, mirror `tests/dispatch-model-profile-conformance.test.js`'s style: `'use strict'`, `node:test`, CRLF-normalized read, slice `task-prompt.md` at `## First call — build,test` / `## Second call — review,polish,wrap-up`, take each section's first fenced block). Collect every `/claude-tweaks:flow` form in the two blocks with a whitespace-tolerant regex (`\s+` must span the second call's line break between `#{issue}` and `review,polish,wrap-up`). Slice `SKILL.md` to the lines starting `**Singleton group**` and `**Bundle group**`. Assert: exactly 4 forms in task-prompt.md's two blocks (2 per block), exactly 4 on the two SKILL.md lines (2 per line) — the count guard — and each form's step list (`build,test` or `review,polish,wrap-up`) is followed by whitespace then `auto`. Also assert task-prompt.md (outside the fenced blocks) carries the rationale sentence: it names headless/cannot answer interactive prompts, and that an explicit mode argument outranks the `auto-mode` policy. Run: `node --test tests/dispatch-flow-explicit-auto-mode.test.js` — Expected: FAIL (no form carries `auto` yet).
- [ ] **Step 2: Implement** —
  1. `task-prompt.md` first-call fenced block: `… /claude-tweaks:flow #{issue} build,test auto` and `… /claude-tweaks:flow "#{n1},#{n2},..." build,test auto`.
  2. `task-prompt.md` second-call fenced block: put `auto` on the step-list line — `review,polish,wrap-up auto` — for both the singleton (wrapped) and bundle forms. Edit only the step-list tail; never reword the surrounding block text (blocks are inlined verbatim into every Task call).
  3. `SKILL.md` **Singleton group** and **Bundle group** lines: append ` auto` after each of the 4 step lists.
  4. `task-prompt.md`: add ONE sentence outside the fenced blocks, beside the first call's "**Before substituting this template**" paragraph, stating: a dispatched call is headless and cannot answer `interactive` prompts, so both calls pass `auto` explicitly; an explicit mode argument outranks the project's `auto-mode` policy (`_shared/auto-mode-contract.md`'s precedence: CLI arg > pipeline config > project policy > skill default); the `autonomy` ceiling still bounds what the run may do. Note the `DISPATCH_HEADLESS=1 ` prefix goes before `/claude-tweaks:flow`, the `auto` suffix after the step list — independent.
  5. Do NOT touch `two-call-gate.md` §5's `/claude-tweaks:wrap-up {target} cleanup-only` teardown path, `sequential-execution.md:58`, or `_shared/policy-schema.md` (out of scope per spec Gotchas).
- [ ] **Step 3: Run** `node --test tests/dispatch-flow-explicit-auto-mode.test.js` — PASS. Then prove discrimination (AC 4): in a scratch copy (never edit-and-restore in the shared tree), remove `auto` from one single form and observe the test go red; quote the failing output.
- [ ] **Step 4: Commit** — one commit, message `Pass auto explicitly on dispatch's flow Task calls — headless calls can't answer interactive (refs #3335)`.

---

## Self-review

- **Spec coverage:** Deliverables 1-4 → Step 2.1-2.4 + Step 1. AC 1-2 → Step 2.1-2.3; AC 3 → Step 1's count guard; AC 4 → Step 3's discrimination check; AC 5 → Step 2.4 + Step 1's rationale assertion; AC 6 → `/build` Common Step 5 full suite.
- **Placeholders:** none.
