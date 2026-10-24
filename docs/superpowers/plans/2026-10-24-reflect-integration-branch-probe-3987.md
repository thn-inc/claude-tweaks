# Probe the integration branch before reflect files a skill-gap record (#3987) Implementation Plan

**Goal:** Before `reflect` stages a tangential record claiming a repo file lacks something, it probes `origin/{integration-branch}` for that absence, cites the probe in the record's Current State, and drops the finding (one decisions.md line) when the content is already there.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T064828-record-3987/work/3987-spec.md` (materialized from GitHub issue #3987)

---

### Task 1: Add the integration-branch probe and drop-when-present rule to reflect's tangential filing path

**Files:**
- Modify: `plugin/skills/reflect/SKILL.md`
- Test: `tests/reflect-integration-branch-probe.test.js`

- [ ] **Step 1: Failing test** — create `tests/reflect-integration-branch-probe.test.js` (same shape as `tests/absence-grep-control-check-prose.test.js`, using `./helpers/read-skill`'s `readText`). It locates the `**Integration-branch probe` paragraph in `plugin/skills/reflect/SKILL.md` Step 3 (exactly once, after the tangential stage-file header paragraph and before the `Number {n}` sentence), then asserts: (a) the probe rule: `git fetch origin {integration-branch}`, a `git grep` and a `git log -S` against `origin/{integration-branch}`, a citation of `_shared/integration-branch.md`, and a requirement to cite the probe command and result in the record's Current State; (b) the drop rule: the finding is not filed when the content is already on the integration branch, plus the one-line decisions.md entry text.
- [ ] **Step 2: Implement.** Add the paragraph to `plugin/skills/reflect/SKILL.md` Step 3, directly after the tangential header paragraph ("Without this header the Console's record-creation step…") and before "Number `{n}` is a per-run sequence counter". It must cover both Deliverables: the probe with its Current State citation, and the drop rule with its decisions.md line.
- [ ] **Step 3: Run** `node --test tests/reflect-integration-branch-probe.test.js`. Expect PASS. Then prove each assertion group can fail: delete the probe sentence alone and re-run (FAIL expected), restore it; delete the drop sentence alone and re-run (FAIL expected), restore it. Restore each sentence in the same command that ran the test.
- [ ] **Step 4: Commit.** One commit, `Probe the integration branch before reflect files a skill-gap record — {detail}`, with `refs #3987`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (probe and citation) maps to Step 2's probe sentence and assertion group (a). Deliverable 2 (drop with decisions.md note) maps to Step 2's drop sentence and assertion group (b). AC1 (the SKILL.md path names both rules) is Step 2. AC2 (a conformance test that went red without each rule) is Steps 1 and 3.
- **Placeholders:** none.
