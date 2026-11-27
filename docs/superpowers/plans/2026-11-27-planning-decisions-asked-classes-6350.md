# Ask only design-level, hard-to-undo and contradiction questions at plan review here (`planning-decisions: asked-classes`) (#6350) Implementation Plan

**Goal:** Switch this repository's plan review from `ask-all` to `asked-classes`, so it asks only design-level, hard-to-undo and contradiction questions and settles and lists the rest.

**Spec:** `.claude-tweaks/pipelines/2026-11-27T155227-record-6350/work/6350-spec.md` (materialized from GitHub issue #6350)

---

### Task 1: Set `planning-decisions: asked-classes` in `.claude-tweaks/policy.yml`

**Files:**
- Modify: `.claude-tweaks/policy.yml`
- Waived `plugin/skills/_shared/planning-decisions.md`: read only — confirms the value's spelling (`asked-classes`) and that nothing else must be set with it (confirmed at planning: the schema entry in `plugin/bin/lib/policy-schema.js` is `enum ['ask-all', 'asked-classes']`, `policyOnly: true`; `control-mode` only widens class (b) and is not required).
- Waived `plugin/skills/build/plan-review-asked-classes.md`: read only.

- [ ] **Step 1: Failing check** — run `node plugin/bin/resolve-policy.js --values planning-decisions` from the worktree root. Expected before the change: prints `ask-all`. This is a scratch check, not a committed test: the repo keeps no test pinning `policy.yml` rows (neighbouring rows such as `implementer-tier`, `release-tip-moves` have none).
- [ ] **Step 2: Implement** — in `.claude-tweaks/policy.yml`, insert these three lines immediately after the `release-tip-moves: 6` row (before the `# release-hook:` comment), matching the file's existing comment-then-row convention:

  ```yaml
  # planning-decisions (#6350): plan review asks only design-level, hard-to-undo and contradiction questions and settles every other gap by plugin/skills/_shared/planning-decisions.md, listed in the acceptance packet.
  # Revert signal: delete this row if the two-week share of dispatched builds stopping at plan review (counted on #6350's parent) does not fall below 12 of 15, or a settled call is overturned at acceptance.
  planning-decisions: asked-classes
  ```

  Change nothing else in the file.
- [ ] **Step 3: Run** — `node plugin/bin/resolve-policy.js --values planning-decisions` prints exactly `asked-classes` with empty stderr (`2>` captured separately and shown empty).
- [ ] **Step 4: Commit** — one commit, `Set planning-decisions: asked-classes in policy.yml — plan review asks only three classes`, body `refs #6350`.

---

## Self-review

- **Spec coverage:** Deliverable 1 and Acceptance Criterion 1 are Task 1. Deliverable 2 and Acceptance Criteria 2-3 (a comment after the first qualifying dispatched build, and the two-week count on the parent) are post-merge observations no code change can satisfy; they stay open on the record after merge and are carried as ledger rows by the controller. The Gotchas' PR-body note (first release carrying #6051 is v6.177.0; whether an older release warns on the value) is written by the controller, not this task.
- **Placeholders:** none.
