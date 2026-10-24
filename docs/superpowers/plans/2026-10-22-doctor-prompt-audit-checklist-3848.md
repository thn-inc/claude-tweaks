# Add a /doctor prompt-audit run over plugin/ to the model-version prompting checklist (#3848) Implementation Plan

**Goal:** Add a `/doctor prompt-audit plugin/` step to `docs/skill-authoring.md`'s Model-version prompting notes checklist, so the shipped `plugin/` library's prose gets an automated reader on each model release.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T173602-record-3848/work/3848-spec.md` (materialized from GitHub issue #3848)

---

### Task 1: Add the prompt-audit step to the Model-version prompting notes checklist

**Files:**
- Modify: `docs/skill-authoring.md`

- [ ] **Step 1: Failing test** — none committed: the record's Acceptance Criteria are content assertions on one docs file plus "`npm test` passes", and the repo keeps no per-paragraph pin tests for this section (no suite under `tests/` references "Model-version prompting"). Verify instead with the read-only checks in Step 3.
- [ ] **Step 2: Implement** — in `docs/skill-authoring.md`'s `## Model-version prompting notes` section, add one bold-led paragraph alongside the existing "Verification/self-check instruction audit (record #2679)" and "Description trim audit (record #2799)" paragraphs (before the "Claude Fable 5.1 vs. Fable 5" delta table), covering:
  1. On each new model release, run `/doctor prompt-audit plugin/` (and once with no path argument, for CLAUDE.md and `.claude/skills/`), and route each finding through the same three-bucket comparison #3056 used.
  2. The exact headless invocation: `claude -p "/doctor prompt-audit plugin/" --allowedTools "Read,Glob,Grep,Skill" --disallowedTools "Edit,Write,NotebookEdit,Bash"` (read-only tool set), and the note that the audit is the `prompt-audit [<path>]` argument of `/doctor`, not a standalone `/prompt-audit` command.
  3. The caveat that a nested `claude -p` must not run inside an active pipeline session until #3845 is fixed.
  4. That `/claude-tweaks:harness-health` does not reach `plugin/` by design — its discovery (`plugin/bin/lib/harness-health/scope.js`) reads only the project's own `.claude/skills/`, `.claude/rules/`, CLAUDE.md (plus memory and design artifacts) — so this run is the only automated reader of the shipped library's prose.
- [ ] **Step 3: Run** — `grep -n "doctor prompt-audit plugin/" docs/skill-authoring.md` (expect a hit inside the Model-version prompting notes section), `grep -n "scope.js" docs/skill-authoring.md` (expect a hit in the same paragraph), then the full suite via the verification runner — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3848`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2 item 1; Deliverable 2 → Step 2 items 2-3; Deliverable 3 → Step 2 item 4. AC 1 (step with invocation and tool restrictions) → Step 2 items 1-2, checked by Step 3's first grep; AC 2 (harness-health `.claude/`-only scope with a pointer to `scope.js`) → Step 2 item 4, checked by Step 3's second grep; AC 3 (`npm test` passes) → Step 3's full-suite run.
- **Placeholders:** none.
