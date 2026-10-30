---
files:
  - plugin/skills/wrap-up/verification-brief-parent-gate.md
  - plugin/skills/_shared/pr-first-merge-post-merge.md
  - plugin/skills/_shared/github-pr-scan-acceptance.md
  - plugin/skills/tidy/actions-github-issues.md
  - plugin/skills/tidy/actions-local-files.md
  - plugin/skills/tidy/step-1-records.md
  - plugin/skills/dispatch/close-out.md
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/skills/wrap-up/merge-mode.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/skills/flow/worktree-merge.md
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/bin/lib/issues/acceptance.js
  - plugin/bin/lib/wrap-up/engine-verify.js
---

# Close a Below-Floor Decomposition Parent

**Persona:** a maintainer who split one feature into several low-risk sub-issues under a parent issue and shipped them one by one through `/claude-tweaks:flow`. The sub-issues sit below the oversight floor, so none of them got a demo gate. Until now the parent stayed open forever after the last one merged, and the tracker showed a finished feature as unfinished.

**Goal:** when the last sub-issue's merge lands, the parent closes on its own, with a comment saying what shipped. If that close is ever missed, tidy surfaces the parent so it can be closed with one approval.

**Entry point:** the merge of the parent's last open sub-issue, on any merge path: a pr-first `merged` outcome, dispatch close-out, wrap-up `merge` mode, or a local-merge push. Each reaches `_shared/pr-first-merge-post-merge.md`'s `### Step 4.0b: Close below-floor parents (#4466)`.

**Success state:** the parent is `CLOSED` and carries one `## Closed below the oversight floor` comment. The comment lists every sub-issue as `- #{n} {title} — closed by PR #{pr}`. The parent has no `demo:*` label and no Verification Brief.

## Steps

### 1. The last sub-issue's run finishes without closing the parent early
- **URL:** `wrap-up/verification-brief-parent-gate.md`, the `**\`exceeds: false\`**` bullet of `## Evaluate the gate`
- **Action:** wrap-up's acceptance labeling runs the Parent-Gate Procedure for the sub-issue. The gate is `due`, and the parent's highest sub-issue risk is under the floor (`exceeds: false`).
- **Should feel:** quiet. Nothing happens to the parent yet, because the merge has not landed.
- **Should understand:**
  - Under `github-issues` the parent stays open at this point; Step 4.0b closes it after the merge.
  - Under `local-files` the run closes the parent record in its own commit, so the closure reaches the integration branch no earlier than the merge.
  - Under `github-issues`, wrap-up's closure check agrees: the `acceptance-labeling` row of `wrap-up-engine.js verify` (`plugin/bin/lib/wrap-up/engine-verify.js`) reads `skip (parent #P below oversight floor — closes after the merge lands (Step 4.0b))`, never a fail for the parent's missing `demo:pending`.
- **Red flags:** a `github-issues` parent closed by wrap-up Phase 4, the auto-merge short-circuit or dispatch's group gate, all of which run before the merge lands. A merge that never lands would then leave a closed parent over an open sub-issue.

### 2. The merge lands and Step 4.0b closes the parent with a listing comment
- **URL:** `_shared/pr-first-merge-post-merge.md`, `### Step 4.0b`, then the gate file's `## Close the parent below the floor`
- **Action:** Step 4.0b reads the merge's closing records: the PR's `closingIssuesReferences`, or the merge commit's `Fixes #N` lines when there was no PR. It re-runs the gate, then posts the comment and closes the parent with `--reason completed` (`"not planned"` when no sub-issue closed as completed).
- **Should feel:** finished. The parent reads like a changelog entry, with one line per sub-issue and its PR.
- **Should understand:**
  - The comment never cites a merge SHA, only PR numbers.
  - A sub-issue this merge closed is listed with the merging PR even if GitHub has not yet linked it.
  - Step 4.0b does nothing unless the integration branch is the repo's default branch, because GitHub only closes `Fixes #N` there.
  - It skips a parent carrying a `needs:*` label, and a parent whose sub-issue Step 4.0 had to reopen or could not settle.
  - The close is the one named exception in `_shared/auto-mode-contract.md`'s never-reversible list. Its restore contract is a human `gh issue reopen`.
- **Red flags:**
  - A second listing comment on a re-run.
  - A Try it block or `demo:pending` posted by this post-merge step.
  - A failed `gh` call that falls back to labeling the sub-issue as if it had no parent.

### 3. A parent the post-merge step missed shows up in tidy
- **URL:** `/claude-tweaks:tidy` Step 4.8, `github-pr-scan-acceptance.md`'s `parent-gate` scope (Shape 7 under `local-files`)
- **Action:** the maintainer runs `/claude-tweaks:tidy`. A merge no session saw land (for example an armed auto-merge that GitHub completed later) leaves the parent open. It appears as `[parent-gate] #{n}: {title} — parent complete below the oversight floor, still open — Open parent gate (closes it; no brief owed)`.
- **Should feel:** a one-click cleanup, not an investigation.
- **Should understand:**
  - The row is staged at every `tidy-aggressiveness` tier. Approving it runs the same **Close the parent below the floor** section, with the same comment and idempotence checks.
  - Tidy's Step 7.5 checklist verifies the parent as `CLOSED`, carrying the heading comment and no `demo:*` label.
  - A parent above the floor still gets the brief-and-`/claude-tweaks:demo` row instead.
- **Red flags:**
  - A stranded below-floor parent that tidy reports nowhere.
  - An approved row that Step 7.5 reports as FAILED.

### 4. The closed parent stays out of the acceptance-gap scope
- **URL:** `github-pr-scan-acceptance.md`, `## Scope: \`acceptance-gap\``, the `needsBackstop({…})` call's `isParent` field
- **Action:** on the next tidy run, the closed parent appears in the closed-record fetch.
- **Should feel:** settled. The closed parent does not come back as an "undisposed" record asking for `/claude-tweaks:demo`.
- **Should understand:** `needsBackstop` skips every decomposition parent, because a parent's acceptance belongs to the parent gate.
- **Red flags:** an `[acceptance-gap]` row for a parent this journey closed.

## Origin

Built by `/claude-tweaks:flow` record #4466 (run `2026-10-30T045550-spec-4469-4466`).
