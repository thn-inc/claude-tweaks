---
files:
  - plugin/skills/wrap-up/verification-brief-parent-gate.md
  - plugin/skills/_shared/pr-first-merge-post-merge.md
  - plugin/skills/_shared/github-write-transport.md
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
  - plugin/bin/closing-links.js
  - plugin/bin/lib/reconcile/post-merge.js
  - plugin/bin/lib/issues/below-floor-parent-close.js
  - plugin/bin/parent-gate.js
  - plugin/bin/lib/issues/parent-gate.js
  - plugin/bin/lib/issues/mcp-parent-gate-shape.js
  - plugin/bin/lib/issues/local-parent-gate-shape.js
  - plugin/bin/lib/hooks/session-start.js
---

# Close a Below-Floor Decomposition Parent

**Persona:** a maintainer who split one feature into several low-risk sub-issues under a parent issue and shipped them one by one through `/claude-tweaks:flow`. The sub-issues sit below the oversight floor, so none of them got a demo gate. Until now the parent stayed open forever after the last one merged, and the tracker showed a finished feature as unfinished.

**Goal:** when the last sub-issue's merge lands, the parent closes on its own, with a comment saying what shipped. If that close is ever missed, tidy surfaces the parent so it can be closed with one approval.

**Entry point:** the merge of the parent's last open sub-issue, on any merge path: a pr-first `merged` outcome, dispatch close-out, wrap-up `merge` mode, or a local-merge push. Each reaches `_shared/pr-first-merge-post-merge.md`'s `### Step 4.0b: Close below-floor parents (#4466)`. A merge that no session saw land, such as an armed auto-merge GitHub completed after the session ended, reaches the same step later through the reconciler (step 3).

**Success state:** the parent is `CLOSED` and carries one `## Closed below the oversight floor` comment. The comment lists every sub-issue as `- #{n} {title} — closed by PR #{pr}`. The parent has no acceptance label in either spelling (`demo:*` or `accept:*`) and no Verification Brief.

## Steps

### 1. The last sub-issue's run finishes without closing the parent early
- **URL:** `wrap-up/verification-brief-parent-gate.md`, the `**\`exceeds: false\`**` bullet of `## Evaluate the gate`
- **Action:** wrap-up's acceptance labeling runs the Parent-Gate Procedure for the sub-issue, as one `bin/parent-gate.js --sub-issue {n} --closing {set}` call (`## Run the gate CLI`). The verdict's `state` is `due`, and the parent's highest sub-issue risk is under the floor (`exceeds: false`).
- **Should feel:** quiet. Nothing happens to the parent yet, because the merge has not landed.
- **Should understand:**
  - Under `github-issues` the parent stays open at this point; Step 4.0b closes it after the merge.
  - Under `local-files` the run closes the parent record in its own commit, so the closure reaches the integration branch no earlier than the merge.
  - Under `local-files` the same CLI call adds `--idempotence --backend local-files`. It reads the parent and sub-issue records from the record store (`bin/lib/issues/local-parent-gate-shape.js`) with no `gh` call, and any non-zero exit stops the entry instead of failing open.
  - Under `work-links: body-text`, the CLI reads the sub-issue's `Parent: #P` line and #P's task list. A sub-issue that #P's non-empty task list does not list resolves no parent (`state: 'no-parent'`), so it is labeled as its own record and never counted in #P's gate; an empty or missing task list still resolves #P. Wrap-up's closure check applies the same rule (#4551).
  - Under `github-issues`, wrap-up's closure check agrees: the `acceptance-labeling` row of `wrap-up-engine.js verify` (`plugin/bin/lib/wrap-up/engine-verify.js`) reads `skip (parent #P below oversight floor — closes after the merge lands (Step 4.0b))`, never a fail for the parent's missing `demo:pending`.
- **Red flags:** a `github-issues` parent closed by wrap-up Phase 4, the auto-merge short-circuit or dispatch's group gate, all of which run before the merge lands. A merge that never lands would then leave a closed parent over an open sub-issue.

### 2. The merge lands and Step 4.0b closes the parent with a listing comment
- **URL:** `_shared/pr-first-merge-post-merge.md`, `### Step 4.0b`, then the gate file's `## Close the parent below the floor`
- **Action:** Step 4.0b reads the merge's closing records: Step 4.0's `closing-links.js --mode post-merge` `closingSet`, or the merge commit's `Fixes #N` lines when there was no PR. It re-runs the gate as `bin/parent-gate.js --sub-issue {n} --closing {set} --idempotence`, adding `--merging-pr` after a PR merge and `--held` for the sub-issues Step 4.0 reopened or could not settle, then posts the comment and closes the parent with `--reason completed` (`"not planned"` when no sub-issue closed as completed).
- **Should feel:** finished. The parent reads like a changelog entry, with one line per sub-issue and its PR.
- **Should understand:**
  - The comment never cites a merge SHA, only PR numbers.
  - A sub-issue this merge closed is listed with the merging PR even if GitHub has not yet linked it.
  - Step 4.0b closes the parent after a PR merge on either branch: on a non-default base Step 4.0 closes the `Fixes` records itself, and `closingSet` lists only the ones it confirmed closed. After a no-PR local merge it still does nothing unless the integration branch is the repo's default branch, because GitHub only closes `Fixes #N` there.
  - It skips a parent carrying a `needs:*` label (the verdict's `needs`), and a parent with a non-empty `held`: a sub-issue Step 4.0 had to reopen, could not settle, or could not close (`closeFailed[]`).
  - With `gh` absent, the skill fetches the MCP reads into a facts file and hands it to the same CLI with `--facts-json`. `bin/lib/issues/mcp-parent-gate-shape.js` does the lowercase-to-uppercase state normalization, so no agent hand-normalizes it.
  - The CLI never falls back to the default `risk-floor`. An unreadable `.claude-tweaks/policy.yml`, or a `risk-floor` value it rejects, is exit 2, so Step 4.0b treats it as a failing call and leaves the parent open for tidy's `parent-gate` backstop (step 4).
  - After a PR merge, a Step 4.0 result with no `closingSet` (a non-zero exit, `not-merged`, `no-fixes-span`, `no-pr`, `gh-absent`, `base-unchecked`) skips the whole step with a logged `SKIP`; tidy's `parent-gate` backstop (step 4) recovers the parent.
  - A gh-absent run that has the GitHub MCP server, such as a cloud Routine on the local-merge path, closes the parent the same way. The gate file's **Transport (#4602).** paragraph routes every call through `_shared/github-write-transport.md`'s MCP rows: `issue_read` for reads, `add_issue_comment` for the comment, and `issue_write` with `state_reason` for the close. The default-branch check reads `git remote show origin`.
  - A token that cannot read its own identity does not stop the close. When `gh api user` fails or prints no login (a GitHub App installation token, say), or the facts file's `get_me` result carries no login, the parent still closes: only a trusted author's `## Closed below the oversight floor` comment counts as already posted. When none does, the step posts the comment before closing, and the verdict's `skipped` names `identity probe failed — close marker matched against trusted authors only`; a trusted comment already there means a plain close with no such note. The accepted cost is one duplicate comment when an earlier attempt posted under an untrusted association and its close then failed.
  - The close is one of the two named exceptions in `_shared/auto-mode-contract.md`'s never-reversible list (the other is Step 4.0's close of the `Fixes` records after a merge into a non-default base). Its restore contract is a human `gh issue reopen`.
- **Red flags:**
  - A second listing comment on a re-run.
  - A Try it block or `demo:pending` posted by this post-merge step.
  - A failed `gh` call that falls back to labeling the sub-issue as if it had no parent.
  - A due parent left open, or skipped as `gh-failed`, only because the identity read failed.
  - On the MCP path, a due parent left open because the facts file carried a lowercase `closed` state the CLI did not normalize. Another MCP-path red flag is a close call that passes `labels` and wipes the parent's labels.

### 3. A merge no session saw land is closed by the reconciler's post-merge check
- **URL:** `docs/reconcile-checks.md`'s `## Post-merge closes (#4599)`, the `post-merge` check in `bin/hooks.js`'s detached `reconcile-background` pass
- **Action:** the run armed an auto-merge and the session ended. GitHub merged the PR later. A later session starts. The first reconcile pass at least 10 minutes after the merge finds the run: a SessionStart's background pass, or any `hooks.js reconcile` call that runs `post-merge`. The run qualifies because its recorded PR is `MERGED` and its `decisions.md` has no Step 4.0b or `reconcile post-merge` marker. The pass runs Step 4.0 and Step 4.0b once for that PR, then logs `reconcile post-merge` as the run's marker.
- **Should feel:** invisible until it is reported. The parent is closed without anyone approving a tidy row, and the session after that pass says so.
- **Should understand:**
  - The SessionStart prior-pass line reads `post-merge steps ran for N merged run(s), closing M parent record(s) below the oversight floor`. A Step 4.0 failure, or a check that threw, reads `post-merge steps failed for N merged run(s) (tidy's parent-gate backstop recovers them)`.
  - A PR that merged no more than 10 minutes ago (`MERGE_GRACE_MS`) is left for its merging session, which may still be running Step 4.0b. Archive keeps a run whose steps are still pending (`post-merge-pending`) until a later pass runs them.
  - The late pass runs the same `bin/lib/issues/parent-gate.js` core the CLI does, and judges every closing record by its live state, so a sub-issue a human reopened since keeps its parent open (`selfInclude: false`).
  - It decides the parent-level skips before reading any sub-issue: the parent's labels first (`not-parent-issue-labeled`, `needs-label`), then its sub-issue list (`sibling-unsettled`). A parent skipped there costs no per-sub-issue `gh issue view`, so a catch-up pass over many skipped parents does not drain the REST core limit (#4799).
  - It applies the same rules as an in-session Step 4.0b after a PR merge. There is no default-branch check: on a non-default base the late Step 4.0 closes the PR's still-open `Fixes` records itself, and the parent closes over the ones it confirmed closed. A `Fixes` record it could not close (`closeFailed[]`) keeps its parent open. A `base-unchecked` result carries no closing set, so nothing closes and the next pass retries it, up to three attempts.
  - The late pass reads the `gh` identity at most once, however many parents it closes, and replays a failed read to every parent: each closes on trusted-author matching, and the summary marker lists the degrade note beside each parent that had no trusted close comment yet.
  - The first pass after this ships also catches up older merged runs once. Step 4.0's 10-minute reopen window and Step 4.0b's idempotence keep that harmless: no reopen of a record a human closed later, and no second comment.
  - The late pass applies the same policy rule to the whole pass: an unreadable `.claude-tweaks/policy.yml` or a rejected `risk-floor` skips every Step 4.0b close (`unreadable-policy`, `invalid-risk-floor`). Step 4.0 still runs and the marker is still written, so the run is not retried and tidy's backstop recovers the parent.
- **Red flags:**
  - A second `## Closed below the oversight floor` comment on a parent a session already closed.
  - A parent closed below the floor while `.claude-tweaks/policy.yml` could not be read, or held a `risk-floor` value the schema rejects.
  - A run processed twice: two `reconcile post-merge` marker lines in one `decisions.md`.
  - A run archived while its post-merge steps were deferred.

### 4. A parent the post-merge step could not close shows up in tidy
- **URL:** `/claude-tweaks:tidy` Step 4.8, `github-pr-scan-acceptance.md`'s `parent-gate` scope (Shape 7 under `local-files`)
- **Action:** the maintainer runs `/claude-tweaks:tidy`. An armed auto-merge that GitHub completed later is closed by the first reconcile pass at least 10 minutes after the merge (the `post-merge` check, `docs/reconcile-checks.md`'s Post-merge closes), so it normally never reaches tidy. A parent the reconciler could not close stays open: a `gh` failure, a Step 4.0 result with no closing set, or a `gh`-absent environment. It appears as `[parent-gate] #{n}: {title} — parent complete below the oversight floor, still open — Open parent gate (closes it; no brief owed)`.
- **Should feel:** a one-click cleanup, not an investigation.
- **Should understand:**
  - The row is staged at every `tidy-aggressiveness` tier. Approving it runs the same **Close the parent below the floor** section, with the same comment and idempotence checks.
  - Tidy's Step 7.5 checklist verifies the parent as `CLOSED`, carrying the heading comment and no acceptance label in either spelling (`_shared/work-record.md`).
  - A parent above the floor still gets the brief-and-`/claude-tweaks:demo` row instead.
- **Red flags:**
  - A stranded below-floor parent that tidy reports nowhere.
  - An approved row that Step 7.5 reports as FAILED.

### 5. The closed parent stays out of the acceptance-gap scope
- **URL:** `github-pr-scan-acceptance.md`, `## Scope: \`acceptance-gap\``, the `needsBackstop({…})` call's `isParent` field
- **Action:** on the next tidy run, the closed parent appears in the closed-record fetch.
- **Should feel:** settled. The closed parent does not come back as an "undisposed" record asking for `/claude-tweaks:demo`.
- **Should understand:** `needsBackstop` skips a decomposition parent unless the parent-gate sweep shows it closed above the floor with no #4466 close marker, because a parent's acceptance belongs to the parent gate.
- **Red flags:** an `[acceptance-gap]` row for a parent this journey closed.

## Origin

Built by `/claude-tweaks:flow` record #4466 (run `2026-10-30T045550-spec-4469-4466`). Updated by record #4597 (run `2026-10-31T030421-record-4597`): Step 4.0b reads Step 4.0's `closingSet` instead of its own hand-written `gh pr view` jq. Updated by record #4602 (run `2026-10-31T075610-record-4602`): a gh-absent run with the GitHub MCP server closes the parent through the MCP transport mapping. Updated by record #4549 (run `2026-10-31T095259-spec-4549-4550-4556`): after a PR merge into a non-default base, Step 4.0 closes the `Fixes` records itself, so Step 4.0b uses `closingSet` there instead of being a no-op.

The success state and the tidy step's checklist clause updated during build of #4610: the Step 7.5 checklist checks for no acceptance label in either spelling.

Updated by record #4599 (run `2026-10-31T135734-record-4599`): step 3 added. A merge no session saw land, such as an armed auto-merge, is closed by the reconciler's `post-merge` check, and tidy's backstop became step 4.

Updated by record #4600 (run `2026-10-31T190944-record-4600`): step 5's `needsBackstop` line. The parent-gate sweep reports a hand-closed parent above the floor itself, and this journey's #4466 close marker keeps the parent it closed out of that row (`catch-a-hand-closed-parent-with-no-sign-off-4600.md`).

Updated by record #4551 (run `2026-11-01T171342-record-4551`): under `work-links: body-text` the gate CLI reads `Parent:` through `parseParent` and resolves no parent for a sub-issue its parent's non-empty task list omits; step 1 notes it.

Updated by record #4603 (run `2026-10-31T211744-record-4603`): the gate's gather and evaluate moved from prose snippets into `bin/parent-gate.js`, which the reconciler's `below-floor-parent-close.js` shares through `bin/lib/issues/parent-gate.js`. Steps 1 and 2 name the CLI call. The review's fix wave added the local-files call (`--backend local-files`, `local-parent-gate-shape.js`) and the fail-closed policy read, which steps 1-3 now note.

Updated by record #4770 (run `2026-11-01T182348-spec-4770`): a failed or empty identity read no longer skips the parent. Steps 2 and 3 note the trusted-author-only fallback, its degrade note, and the reconciler's once-per-run identity read.

Updated by record #4799 (run `2026-11-01T205251-record-4799`): the reconciler's late pass decides the parent-level skips before any per-sub-issue read; step 3 notes it.
