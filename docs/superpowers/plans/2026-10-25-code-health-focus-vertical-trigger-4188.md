# code-health-focus-vertical skill: trigger description should also cover adding a kind to an existing vertical (#4188) Implementation Plan

**Goal:** Reword `.claude/skills/code-health-focus-vertical/SKILL.md`'s frontmatter `description` so it triggers both on adding a `/code-health focus=<vertical>` candidate generator and on adding a candidate kind to an existing shipped vertical.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T114616-record-4188/work/4188-spec.md` (materialized from GitHub issue #4188)

---

### Task 1: Reword the skill description to name both triggers

**Files:**
- Modify: `.claude/skills/code-health-focus-vertical/SKILL.md` (frontmatter `description` line only)

- [ ] **Step 1: Failing test** — no committed test: the repo keeps no per-description pin for maintainer skills under `.claude/skills/` (no neighboring test file exists for this kind of change), so the check stays scratch. Scratch check (run before and after the edit): the frontmatter parses as YAML, `description` starts with "Use when", names both triggers (adding a vertical / candidate generator, and adding a candidate `kind` to an existing vertical), keeps every existing Keywords token (`require order`, `focus vertical`, `registerGenerator`, `FOCUS_GENERATORS`, `criteria fragment`), and is under 1,536 characters (`docs/skill-authoring.md` Frontmatter conventions). Before the edit it must fail on the "adding a kind" trigger.
- [ ] **Step 2: Implement** — rewrite the `description` value: one trigger sentence covering both cases, the body-section summary (registration set, extending-an-existing-vertical site list, import-source and anchor rules, real-input fixtures), and the Keywords list with every existing token preserved plus kind-extension keywords. Touch nothing else in the file.
- [ ] **Step 3: Run** the scratch check from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, `Reword code-health-focus-vertical trigger — cover adding a kind to an existing vertical`, `refs #4188`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (reword to trigger on both) and the Acceptance Criterion (names both triggers, within `docs/skill-authoring.md` frontmatter conventions) are both covered by Task 1's Steps 1-3.
- **Placeholders:** none.
