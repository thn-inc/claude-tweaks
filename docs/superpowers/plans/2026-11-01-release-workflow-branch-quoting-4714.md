# Release workflow branch quoting (#4714) Implementation Plan

**Goal:** Stop `renderWorkflowYaml` from interpolating the integration-branch name bare into the rendered release-please workflow, so a git-legal but YAML/Actions-hostile name can neither inject a GitHub Actions expression nor break, re-type, or re-mean the workflow.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182335-spec-4714/work/4714-spec.md` (materialized from GitHub issue #4714)

---

### Task 1: Refuse `${{`, always quote the branch, and escape filter metacharacters in `renderWorkflowYaml`

**Files:**
- Modify: `plugin/bin/lib/init/release-bootstrap.js`
- Test: `tests/bin-lib/init/release-bootstrap.test.js`
- Waived `plugin/bin/lib/branch-name.js`: unchanged; its header comment's caller list stays accurate

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe: `${{` refusal (renderer throws; `bootstrapRelease` pr-first writes no file), exact quoted lines for `develop`, exact `target-branch` line equal to `'          target-branch: ' + JSON.stringify(name)` for each of `#main`, `&x`, `"x`, `{a}`, `@x`, `|x`, `>x`, `%x`, `1.10`, `true`, `null`, and the filter-escaping lines for `release+1` and `!x`; move the two existing regex pins to the quoted form.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** `node --test tests/bin-lib/init/release-bootstrap.test.js` — PASS. Then revert `plugin/bin/lib/init/release-bootstrap.js` to the merge base and re-run the same file to confirm every new test goes red; restore the change.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4714`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above (the empty-diff AC over `branch-name.js` and its other callers is held by the Waived line; the `npm test` AC runs at Common Step 5).
- **Placeholders:** none.
