# Drop dated model-version fossils and emphasis wrappers from shipped skill prose (#3844) Implementation Plan

**Goal:** Remove four spans of shipped skill prose that pin a fact to one model version or wrap a sentence in information-free emphasis, keeping the rule each passage carries.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T090017-record-3844/work/3844-spec.md` (materialized from GitHub issue #3844)

---

### Task 1: Drop the dated probe narrative, tokenizer ratio, thinking-depth phrase, and `<IMPORTANT>` wrapper

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md`
- Modify: `plugin/skills/build/dispatch.md`
- Modify: `plugin/skills/_shared/subagent-output-contract.md`
- Modify: `plugin/skills/capture/SKILL.md`
- Modify: `plugin/skills/build/SKILL.md`

- [ ] **Step 1: Failing check** — run the Acceptance Criteria grep (scratch check, not a committed test — the repo keeps no test pinning these strings; `tests/` was grepped for every removed string and nothing pins them):
  Run: `grep -rn 'Probed 2026-08-17\|probed 2026-08-17\|tokenizer emits\|overthink\|<IMPORTANT>' plugin/skills/`
  Expected: FAIL — five hits, one in each file above.
- [ ] **Step 2: Implement** — five in-place edits, nothing else in each file touched:
  1. `plugin/skills/_shared/subagent-dispatch-core.md`, `**Overrides.**` paragraph: replace the span starting `Probed 2026-08-17 (one throwaway Agent dispatch, …): an explicit per-invocation` through the end of the sentence `Single-observation confidence (…).` with the rule alone: `An explicit per-invocation \`model\` value **does** override the session's own ambient model — "the plugin defers to them" describes a choice not to pass \`model\`, not a structural limit on passing it.` The paragraph's following sentence (`This is what licenses \`build/SKILL.md\`'s whole-branch-review model-resolution step …`) stays.
  2. `plugin/skills/build/dispatch.md`, the `**Whole-branch review model.**` passage: `(that file's Overrides section, probed 2026-08-17)` → `(that file's Overrides section)`.
  3. `plugin/skills/_shared/subagent-output-contract.md`, `**Inherited project context is the dominant per-agent cost.**` paragraph: delete the final sentence `Sonnet 5's tokenizer emits roughly 30% more tokens … the lever is unchanged: keep CLAUDE.md lean.` The preceding sentence (`… the lever for the inherited term is keeping \`CLAUDE.md\` itself lean.`) already states the rule.
  4. `plugin/skills/capture/SKILL.md`, `## Adding an Entry`: `Both drivers run Backend Selection above; don't overthink — capture the essence.` → `Both drivers run Backend Selection above; capture the essence.`
  5. `plugin/skills/build/SKILL.md`, Design Step 3: replace the three-line `<IMPORTANT>` … `</IMPORTANT>` block with the unwrapped sentence, reason folded in: `Because design mode has no spec with structured acceptance criteria, extract testable outcomes from the design doc's decisions and recommendations when providing context to \`/superpowers:writing-plans\`. If the design doc lacks clear success criteria, ask the user to confirm what "done" looks like before proceeding.`
- [ ] **Step 3: Run** the Step 1 grep — PASS (no output, exit 1). Then `grep -n "explicit per-invocation" plugin/skills/_shared/subagent-dispatch-core.md`, `grep -n "itself lean" plugin/skills/_shared/subagent-output-contract.md`, `grep -n "extract testable outcomes" plugin/skills/build/SKILL.md` — each still prints one line (the rule survives).
- [ ] **Step 4: Commit** — one commit, explicit paths, message `Drop dated model-version fossils and emphasis wrappers from shipped skill prose — refs #3844`.

---

## Self-review

- **Spec coverage:** Deliverables 1-5 map to Step 2 edits 1-5; AC 1 (grep returns nothing) is Step 3's first command; AC 2 (each passage still states its rule) is Step 3's three greps plus capture's kept "capture the essence"; AC 3 (`tests/` grepped before editing, `npm test` passes) — the grep ran during planning with no pins found, and `npm test` runs centrally at Common Step 5.
- **Placeholders:** none.
