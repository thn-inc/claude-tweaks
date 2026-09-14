# Dispatch — Settle + Auto-merge Gate

Loaded by `/claude-tweaks:dispatch` Step 6 (a `/flow` HARD-GATE failure) and the Auto-merge gate (a group whose every member carries `auto:merge` or a matured `auto:merge-pending`, reaching `/wrap-up`'s Review Console) — both are conditional branches that don't run on the common clean-pending-review path, so they're kept out of `SKILL.md`'s always-loaded body.

**The Auto-merge gate splits across two threads; Settle does not.** Settle (below) runs entirely inside whichever Task call hits the failure, as it always has. The Auto-merge gate's authorization check, content judgment, and acceptance labeling also run inside the second Task call — but its actual merge execution cannot: a Task-tool subagent is cwd-pinned to the worktree it inherited at launch and cannot reach the main checkout (`dispatch/SKILL.md` Step 5's sequential-execution note: "A Task-tool subagent is always launched cwd-pinned to the dispatching session's own worktree"). That final step runs in the *dispatching session's own thread* instead, per **Dispatching-session merge execution** at the end of this file.

**The `ExitWorktree`/worktree-removal constraint is structural, when it applies, and
outcome-independent within its scope.** A Task-tool subagent that did not itself `EnterWorktree`
a worktree can never run `ExitWorktree` or `git worktree remove` on it, regardless of which
outcome that call ultimately reports — the cwd-pinning fact above already explains why the merge
itself can't run there either; worktree teardown is blocked for the identical structural reason
on every Task-call branch below (Settle, and the Auto-merge gate's own Task-call branches), not
only the merge path. The `Dispatching-session merge execution` section further down runs outside
any Task call, so this constraint does not apply there at all — its own conflict-abort branch
states a distinct, non-structural reason for parking worktree teardown alongside claim release
and run-dir archival. Wherever this constraint DOES apply, the branch below still states its own
claim-release and run-dir-archival disposition separately — neither is inherited from this
constraint.

**MCP path, file-wide.** Every label read/edit and comment operation in this file that isn't called out individually below (e.g. the `gh issue view --json labels` / `gh issue edit --remove-label` pair in Settle step 3, and the failure-comment post in step 5) uses the standard CRUD mapping from `_shared/github-write-transport.md`: `issue_write` (update mode) for label edits, `add_issue_comment` for comments, `issue_read` for reads. The one call site with special MCP-path handling — the retry-ceiling comment fetch (step 4 below) — already has its own dedicated note.

This blanket mapping also covers the `gh` calls the Auto-merge gate's acceptance-labeling step
delegates to per member (`wrap-up/verification-brief.md`'s Routing section onward, and its
Parent-Gate Procedure in `wrap-up/verification-brief-parent-gate.md`) — `#205`: neither of those
files states its own MCP path, and every `gh` call either one issues (`gh issue view --json
labels`/`--json comments`, `gh issue comment`, `gh issue edit --add-label`) is one of the three
standard shapes this paragraph already names — `issue_read`, `add_issue_comment`, `issue_write`.
No separate mapping table entry is needed for them; a gh-absent group auto-merge gate resolves
the same way the rest of this file does.

## Step 6: Settle — on pipeline failure

A group is dispatched as **two** sequential Task calls (Step 5). This procedure runs inside whichever of them handles the outcome being settled — the first call (`build,test`) when that call hits a HARD-GATE, the second (`review,polish,wrap-up`) on any path that reaches wrap-up — against that call's own record(s), never in dispatch's main thread.

When a handed-off `/flow` run fails a HARD-GATE (never reaches `/wrap-up`):

**Claim-contest special case (before the numbered steps below).** When the failure this call is
settling is a Step 2.8 claim-loop stop that renders as a static card with no `AskUserQuestion` of
its own — either `flow/claim-targets.md`'s "Claim contested" stop, or its "Claim in-flight" stop
(#315/#958/#974's in-flight-tombstone variant — reached here only when that card's own routing into
`dispatch/resume-confirmation.md` was itself skipped under `DISPATCH_HEADLESS=1`, since that
routing's own headless skip is what leaves the card as this Task call's terminal output) — no
build or test ever ran, the pipeline stopped before the Config Manifesto, this record was never
claimed by this run at all, so step 1 below's ownership check will correctly find no claim to
release (skip is the right outcome there, not an error). The one thing this case adds: **when
`DISPATCH_HEADLESS=1` was set on this Task call's invocation** (`dispatch/task-prompt.md`'s first
template — set only for a Routine-fired headless firing (bare drain or its `next` alias), where
nobody is present to read the stop directly),
read `_shared/headless-self-report.md` and follow its dedup-and-file procedure (caller =
`dispatch`), using failing-check-name `flow-step-2.8-claim-contest` for the contested-claim stop
or `flow-step-2.8-claim-in-flight` for the in-flight-tombstone stop — distinct names, since the
two are different stop shapes and must dedup separately — and that stop's own card text as the
diagnostic body. This is the one Settle branch that runs *before* any release/classification
logic, since there is nothing to release or classify — it is a pre-flight stop, not a build/test
failure. When `DISPATCH_HEADLESS` is unset (a human-present dispatch form), skip this — the stop
message the Task call already produced is sufficient; nobody headless needs a durable trace of
it.

1. The CLI in step 2 performs the ownership read itself (`claims/issue-{n}.json` on `claims-registry`, per `_shared/issue-claims.md`'s "The lock" and Ownership rule) and exits `4` — writing nothing — when the blob's `runId` doesn't match `basename($PIPELINE_RUN_DIR)` — the group directory dispatch minted before claiming and this Task call received directly (`dispatch/task-prompt.md`): a mismatch means a successor already broke the stale claim and now holds the lock. Skip the rest of this step for that record and move to the next one — no manual read.
2. Release the claim and remove `bot:in-progress` in one command — `node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" "$ISSUE" --run "$PIPELINE_RUN_DIR" --reason "failed: {gate}" --remove-in-progress --section "/dispatch" --step "Settle"` (reason per `_shared/issue-claims.md`'s Release triggers table; label removal best-effort, the CLI logs a warning and continues on failure). Same CLI `wrap-up/cleanup-procedures-execution.md` Section E uses — the exit-code contract lives there, not restated here.
3. **Classify the failure and act on `auto:merge`/`auto:merge-pending` accordingly.** Invoke `/claude-tweaks:assess-agent-autonomy` in `failure-check` mode: `Skill(skill: "claude-tweaks:assess-agent-autonomy", args: "failure-check #{n}")`. If `CLASSIFICATION` is `correctness` or `ambiguous`, revoke whichever of `auto:merge` / `auto:merge-pending` is present — today's behavior for this class, unchanged for `auto:merge`, extended so a still-maturing grant is equally revocable (a record carries at most one of the two per `_shared/work-record.md`'s Grant semantics, so at most one check fires — check both rather than assuming which):

   ```bash
   LIVE_LABELS=$(gh issue view "$ISSUE" --json labels -q '.labels[].name')
   if echo "$LIVE_LABELS" | grep -qx auto:merge; then
     gh issue edit "$ISSUE" --remove-label auto:merge
   fi
   if echo "$LIVE_LABELS" | grep -qx auto:merge-pending; then
     gh issue edit "$ISSUE" --remove-label auto:merge-pending
   fi
   ```

   If `CLASSIFICATION` is `transient`, **preserve** `auto:merge`/`auto:merge-pending` — do not remove either. This is the one behavior change from the old rule: a transient/infrastructure failure no longer permanently strips merge trust from a record that was never at fault. If `NOTIFY_NOW` is `true`, send a `PushNotification` immediately ("Record #{n} may be stuck — same failure recurred: {rationale}"), in addition to (not instead of) the retry-ceiling notification in step 6 below if the ceiling is also hit on this same attempt.

   Log this decision to `{run-dir}/decisions.md`, the same `Rationale:`-suffixed shape
   `grant-check`'s two callers already use (`backlog/refine-headless.md`, `backlog/refine-mode.md`) —
   carrying `CLASSIFICATION`, `NOTIFY_NOW`, and `RATIONALE` verbatim regardless of whether
   `RATIONALE` holds a content judgment or names a could-not-gather failure class (the field name
   is the same either way, only its prose shape differs):

   ```
   AUTO {time} — Settle: failure-check classified #{n} as {CLASSIFICATION} (NOTIFY_NOW={NOTIFY_NOW}) — {revoked | preserved} auto:merge/auto:merge-pending. Rationale: {RATIONALE}.
   ```

4. Fetch existing comments and compute this attempt's number and whether it hits the ceiling (read `dispatch-retry-ceiling` via the canonical resolver), in one pass — fetching comments *before* posting this attempt's comment is what makes the attempt number and ceiling check correct.

   **Comment sources: the issue, plus every PR ever linked to it, open or closed** (`_shared/pr-run-comments.md`) — step 5 below always posts the full failure comment to the **issue** now, regardless of pr-first, but a record whose attempts predate this fix, or whose PR closed between runs, can still have earlier "Attempt N failed" comments scattered across the issue and one or more now-closed PRs (`#1963`: record 1302 showed exactly this split — an `attempt=1` marker on PR 1783 and a second independent `attempt=1` marker on the issue, so the ceiling of 3 was never reached). Merge comments from the issue and every linked PR before counting, rather than trusting one source alone — this is what makes the count immune to which source any individual past attempt happened to land on.

   Resolve this run's session-scoped temp paths first (`_shared/session-tmp-root.md`) — these carry the existing `${ISSUE}` suffix, since two different records settling concurrently (a dispatch loop over a bundle group's members) still need per-record disjoint files even within one session, exactly as `_shared/session-tmp-root.md`'s "Record-suffixed callers keep both suffixes" section states:

   ```bash
   eval "$(node -e "
     const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
     const os = require('os'); const path = require('path');
     const issue = process.argv[1];
     const files = {
       DISPATCH_COMMENTS: 'dispatch-comments-' + issue + '.json',
       DISPATCH_LINKED_PRS: 'dispatch-linked-prs-' + issue + '.json',
       DISPATCH_PR_COMMENTS_DIR: 'dispatch-pr-comments-' + issue,
       ATTEMPT_INFO: 'attempt-info-' + issue + '.json',
     };
     for (const [varName, filename] of Object.entries(files)) {
       const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
       console.log(varName + '=' + JSON.stringify(p));
     }
   " "$ISSUE")"
   DISPATCH_RETRY_CEILING=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values dispatch-retry-ceiling)
   gh api "repos/{owner}/{repo}/issues/${ISSUE}/comments?per_page=100" > "$DISPATCH_COMMENTS"
   gh pr list --repo {owner}/{repo} --state all --json number,closingIssuesReferences --limit 200 \
     --jq "[.[] | select(.closingIssuesReferences[]?.number == ${ISSUE}) | .number]" > "$DISPATCH_LINKED_PRS" 2>/dev/null \
     || echo '[]' > "$DISPATCH_LINKED_PRS"
   rm -rf "$DISPATCH_PR_COMMENTS_DIR" && mkdir -p "$DISPATCH_PR_COMMENTS_DIR"
   for PRN in $(node -e "console.log(require(process.argv[1]).join(' '))" "$DISPATCH_LINKED_PRS"); do
     gh api "repos/{owner}/{repo}/issues/${PRN}/comments?per_page=100" > "$DISPATCH_PR_COMMENTS_DIR/${PRN}.json" 2>/dev/null \
       || echo '[]' > "$DISPATCH_PR_COMMENTS_DIR/${PRN}.json"
   done
   node -e "
     const fs = require('fs');
     const { countFailedAttempts } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/retry.js');
     const issueComments = require(process.argv[1]);
     const prDir = process.argv[2];
     const path = require('path');
     const prComments = fs.existsSync(prDir)
       ? fs.readdirSync(prDir).flatMap((f) => JSON.parse(fs.readFileSync(path.join(prDir, f), 'utf8')))
       : [];
     const comments = issueComments.concat(prComments);
     const attemptNumber = countFailedAttempts(comments) + 1;
     const ceiling = Number(process.argv[3] || 3);
     const ceilingHit = attemptNumber >= ceiling; // equivalent to hasHitRetryCeiling if comments included this attempt's own (not-yet-posted) comment
     console.log(JSON.stringify({ attemptNumber, ceilingHit }));
   " "$DISPATCH_COMMENTS" "$DISPATCH_PR_COMMENTS_DIR" "$DISPATCH_RETRY_CEILING" > "$ATTEMPT_INFO"
   ```

**MCP path** (`gh` unavailable, same live-as-of-Task-10 status as `dispatch/SKILL.md`'s Step 4): use the confirmed "list issue comments" mapping from `_shared/github-write-transport.md` for the issue's own comments. Linked-PR discovery and per-PR comment fetches have no MCP equivalent (`_shared/github-pr-scan.md`'s Transport note on PR-backed items) — count from the issue's comments alone in that case, and log the degrade to `decisions.md` (a record with genuinely split legacy attempts may undercount until a `gh`-present run re-settles it) rather than silently treating it as a full count. `countFailedAttempts` and the rest of this step's logic consume the same comment-body-string shape regardless of transport or source count.

5. Compose the failure comment, using the `attemptNumber` and `ceilingHit` just computed — content unchanged regardless of routing below. Resolve this run's session-scoped temp paths first (`_shared/session-tmp-root.md`; `ATTEMPT_INFO` re-derived here since a fresh bash invocation does not inherit step 4's shell variables — `sessionTmpPath` is idempotent per session+filename, so this resolves to the same path):

   ```bash
   # Negative-evidence persist point (#268): passing classification here (from
   # step 3's $CLASSIFICATION) is what persists the marker — attemptFailedCommentBody
   # embeds a line-anchored `<!-- trust-negative-evidence: attempt=N classification=... -->`
   # only when classification is 'correctness'/'ambiguous', never 'transient', satisfying
   # trust.js's classification gate by construction. bin/lib/issues/trust.js's grading reads
   # this marker back from the record's comments as known-bad evidence for the record's class
   # (see its "Operational outcome evidence" section and _shared/autonomy-ceiling.md's
   # Revocation section for the full semantics).
   eval "$(node -e "
     const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
     const os = require('os'); const path = require('path');
     const issue = process.argv[1];
     const files = {
       ATTEMPT_INFO: 'attempt-info-' + issue + '.json',
       ATTEMPT_COMMENT_BODY: 'attempt-comment-body-' + issue + '.md',
     };
     for (const [varName, filename] of Object.entries(files)) {
       const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
       console.log(varName + '=' + JSON.stringify(p));
     }
   " "$ISSUE")"
   node -e "
     const { attemptFailedCommentBody } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/retry.js');
     const { attemptNumber, ceilingHit } = require(process.argv[1]);
     console.log(attemptFailedCommentBody({ attemptNumber, reason: process.argv[2], ceilingHit, classification: process.argv[3] }));
   " "$ATTEMPT_INFO" "$REASON" "$CLASSIFICATION" > "$ATTEMPT_COMMENT_BODY"
   ```

   **Post the full comment to the issue, always** (`#1963`) — regardless of `run-state.json`
   carrying a `pr` object or not. This is what keeps every attempt discoverable from one place
   no matter which run posted it, and what step 4 above now counts from directly (merged with
   every linked PR, for the legacy-split records that predate this fix). `bin/lib/issues/trust.js`
   — which reads only the record issue's comments and is not modified by this design — sees the
   `trust-negative-evidence` marker (when present) the same way, with no separate extraction step
   needed:

   ```bash
   gh issue comment "$ISSUE" --body-file "$ATTEMPT_COMMENT_BODY"
   ```

   **`run-state.json` carries a `pr` object — this is the failure tombstone** (`_shared/pr-run-comments.md`):
   post a short pointer comment to the PR — never the full attempt narrative, which already landed
   on the issue above — then close the PR: a visible tombstone with a resume command (the PR
   body's own `### Resume` section from `_shared/pr-early-run-lifecycle.md`) instead of an
   invisible dead worktree. Leave the branch and worktree in place; nothing else in this step tears
   them down.

   ```bash
   eval "$(node -e "
     const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
     const os = require('os'); const path = require('path');
     const issue = process.argv[1];
     const files = { FAILURE_POINTER: 'failure-pointer-' + issue + '.md' };
     for (const [varName, filename] of Object.entries(files)) {
       const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
       console.log(varName + '=' + JSON.stringify(p));
     }
   " "$ISSUE")"
   printf '<!-- run-comment: failure -->\n\nAttempt failed — see the full comment on #%s.\n' "$ISSUE" > "$FAILURE_POINTER"
   # find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=failure
   gh pr close {pr-number} --repo {owner}/{repo}
   ```

6. **If `ceilingHit` was `true`:** bootstrap `bot:blocked` if it doesn't already exist:

   ```bash
   # Bootstrap per _shared/label-bootstrap.md — LABELS_JSON is the single ['bot:blocked', <description>]
   # pair, with <description> read from that file's canonical LABELS_JSON fence (the one source
   # tests/bin-lib/issues/labels.test.js pins); never restate the description text here.
   ```

   Then remove `auto:build` and, if still present (a `transient`-classified attempt preserves it per step 3 above, so it can still be there at the ceiling), `auto:merge` or `auto:merge-pending` too — per `_shared/issue-claims.md`'s canonical rule, the retry ceiling removes **all** `auto:*` labels, not just whichever one step 3 didn't already strip. Add `bot:blocked`, and send a `PushNotification` ("Record #{n} hit its retry ceiling — needs a look: {title}").
7. **If `false`:** leave `auto:build` in place — the next `dispatch next` firing pulls it again naturally (the claim was already released). There is nothing further to downgrade in the common case: step 3 revoked `auto:merge` unless the failure was classified transient, and that conditional revocation *is* the failure-downgrade rule in this model. Unlike the pre-grants design there is no separate two-tier label to step down between — a record either still has `auto:build` (and can retry) or, at the ceiling, has neither.

A `correctness`- or `ambiguous`-classified failure revokes `auto:merge` before the next retry, per step 3 above — that record doesn't get another unsupervised shot at auto-merge until a human re-grants it at `/claude-tweaks:backlog refine`. A `transient`-classified failure preserves `auto:merge` — the retry-ceiling counting below still runs unconditionally regardless of classification (an attempt is an attempt), but classification alone no longer determines merge trust the way it did before.

## Auto-merge gate (`auto:merge` or matured `auto:merge-pending` groups only)

Because a bundle shares one branch/worktree, the merge decision is necessarily group-wide even though blast radius is attributed per record below: **every member of the group must carry `auto:merge`, either already or via a matured `auto:merge-pending`** (see Authorization below) for the gate to apply at all — a group with even one `auto:build`-only member falls back to the normal pending-review path for the whole group; mixed grants inside one bundle are never split at merge time, and a group with even one still-pending, not-yet-matured member falls back the same way (the group's *slowest* member's veto window governs the whole group, same as its slowest member's review verdict already does below).

When a qualifying group's `/flow` run reaches `/wrap-up`'s Review Console, check two layers before presenting it for approval — but first, a live-drain overlap hold (refs #1985):

**Drain-overlap hold, before `merge-check`.** Read `drain-pr-overlap.md`'s "Step 6 (Auto-merge
gate)" section, this skill's directory, and follow it before Authorization/Content judgment below
— extracted to keep this file under the 40 KB ceiling (`[IL-153]`).

1. **Authorization** — a two-phase check: evaluate every group member first (fresh labels +
   comments, `evaluateMaturation` per member), act only if every one cleared. A member already
   carrying `auto:merge` clears immediately (`already-mature`); a `matured` `auto:merge-pending`
   member is promoted — label swap plus the merge-lane circuit breaker's `watched.json` seed,
   the moment merge trust actually activates. Any member `within-veto-window`, `not-pending`
   (a permanent human veto), or `unknown-age` fails Authorization for the **whole group** —
   apply zero promotions this firing, even for another member that independently cleared; mixed
   grants are never split at merge time, the same rule an `auto:build`-only member already gets.
   Evaluation and promotion never interleave (an early promotion has no rollback path if a later
   member then fails), which is why this is a two-phase check and not a per-member loop. Full
   procedure — the `evaluateMaturation`/promotion code, both phases' log-line shapes, and the
   interleaving hazard in full: `grant-maturation-gate.md` in this skill's directory.
2. **Content judgment** — for each member of the group, invoke `/claude-tweaks:assess-agent-autonomy` in `merge-check` mode: `Skill(skill: "claude-tweaks:assess-agent-autonomy", args: "merge-check #{n}")`. This weighs the diff's content, `/review`'s findings, and a test-exclusion-aware blast-radius summary (`bin/lib/issues/blast-radius.js`) holistically, replacing the old three independent mechanical checks (scoring eligibility, runtime cleanliness, blast radius) that stood in for one real question — was `docs/superpowers/specs/2026-08-03-mechanical-vs-substantive-merge-judgment-design.md`, deleted `d83f0720`. **Every member's verdict must be `auto-merge`** for the group to proceed — a single `needs-human` verdict anywhere in the group falls the whole group back to the normal pending-review path. That verdict is authoritative all the way down: it survives into the Review Console's Auto-resolution short-circuit, where `consoleAutoResolve`'s default-merge never overrides it (the Needs-human carve-out in `wrap-up/review-console.md` and `flow/multispec-review-console.md`).

   **Log the fall-back when a verdict is `needs-human`,** before falling back — one entry per such member, written to `{run-dir}/decisions.md` via `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js"` (`_shared/auto-decision-log.md`'s "One command per entry," the sole append path). Unlogged, the verdict never reaches `decisions.md`, and the Review Console's own short-circuit — `wrap-up/review-console.md`, mechanized by `bin/console-resolve.js`'s `needsHumanVerdict` read — finds no verdict to honour and resolves the merge half to `merge`, exactly the override the carve-out exists to prevent. The same shape `wrap-up/auto-merge-short-circuit.md` writes on its own single-record path, with this path's own step and outcome:

   ```
   AUTO {time} — Auto-merge gate: #{n} assess-agent-autonomy verdict needs-human — group falls back to the Review Console. Reversibility: n/a.
   ```

**Both layers pass — acceptance labeling runs first, for every member of the group.** This gate bypasses `/wrap-up`'s Phase 4 execution step, which is where acceptance labeling normally happens, so this gate must perform it itself. For each record in the group, run `wrap-up/verification-brief.md` starting from its **Routing** section — **one record at a time, never batched or concurrent.** Sequencing is what makes the once-per-parent idempotence below hold: each invocation re-reads the parent's labels, so a second member of the same parent sees the first's `demo:pending` and no-ops. Run two concurrently and both read no label, both compose, and both post — two briefs on one parent. That file owns the routing: a record with a resolvable parent goes to its Parent-Gate Procedure (the parent gets the one gate; this sub-issue gets none), and everything else goes through its Steps 1-4 — bootstrap, observation-plan authoring, the safety-net gate, sourcing, posting, then `demo:pending`. Do not apply `demo:pending` to a group member independently of that routing: an `auto:merge`'d sub-issue is exactly the population `_shared/github-pr-scan-acceptance.md`'s `parent-gate` backstop scope exists to catch. One brief and one label per record with no resolvable parent — the merge decision is group-wide, but acceptance is a per-record judgment and a group's members can differ in observation-plan kind and in what shipped for each. A parent-linked sub-issue is routed to the Parent-Gate Procedure instead. **Pass the whole group's record numbers as `$CLOSING_SUB_ISSUES` on every one of these per-member invocations** — not just the member in hand. That is the set `verification-brief.md`'s **Self-inclusion rule** reads: every number in it counts as `CLOSED` when the parent's `leaves` array is built (it overrides state, never adds sub-issues — a group member from another parent, or from none, is simply irrelevant to this parent). The whole group is the correct set here because the single merge below carries one `Fixes #{issue}` line per record, so the group closes together; every record is still open at this point (label before merge, below), and counting only the member in hand would make a group holding two or more sub-issues of one parent evaluate `incomplete` on every one of them, labeling nothing at all — sub-issue or parent — and leaving the parent to `/tidy`'s backstop that the eager gate exists to pre-empt. With the group's set passed, the first such member reaches `due` and gates the parent; the parent's remaining members re-fetch the parent's labels, read `gated`, and no-op — one brief and one `demo:pending` per parent, never a second. `/tidy`'s `parent-gate` sweep stays the backstop for parents this gate never sees at all: a sub-issue closed by hand, or a dispatch run that ended before this gate.

Order is load-bearing: the merge carries one `Fixes #{issue}` line per record, so once it lands every member is closed and this gate has moved on. Label before merging, while the records are still open.

`auto:merge` governs merge timing only and has no bearing on whether a record gets `demo:pending` — `_shared/work-record.md` states that an `auto:merge`'d record still gets it on its now-closed issue, enabling retrospective sign-off, and this gate is the only place on the group path that can honor it.

**Both layers pass — merge (`integration-model: pr-first`, `_shared/integration-model.md`):**
run `_shared/pr-first-merge.md`'s procedure now, in this same Task call — its Step 2.5
(Merge-verification gate) applies the resolved merge-verification lever before any merge attempt:
green arms or merges, pending waits or arms, red parks the group with bot:parked and reports
pending-review, never merges (this is where a #540-shaped red merge is stopped) —
`tag: auto-merge`, `issue-list` the group's full record set, `summary` the lowest-numbered
record's title for a singleton or a semicolon-joined list of every member's title for a bundle.
`gh pr merge` needs no checkout, so this same cwd-pinned call performs the merge itself;
there is no second thread, no `OUTCOME: ready-to-merge` relay, and no
`close-run`/branch-guard/push-from-worktree dance — those existed only for a *local* merge. Report the outcome that procedure returned
(`merged` / `armed` / `pending-review`) (pending-review now also covers a red or timed-out check
per that gate) per `task-prompt.md`'s updated second-call template. On
`merged`, this call also owes the cleanup a merge unlocks for the two items it can actually run
directly — claim release and run-dir archival (wrap-up's Items 7, 8) — citing the same canonical
procedures Settle already cites: `wrap-up/cleanup-procedures-execution.md` Section E (claim),
Section B (run dir). Worktree removal (Item 4) is NOT run directly here, `merged` included: this
call inherited the worktree and never itself `EnterWorktree`'d it, so `ExitWorktree` is a
documented no-op for it — the same structural constraint stated at the top of this file, which
applies to every Task-call branch without exception. Worktree removal instead defers to the
reconciler on merged-PR evidence — the identical mechanism `armed`/`pending-review` already rely
on below, and already unconditional across every path that reaches `merged` (`reap-merged.js`'s
PR-state check reaps regardless of which branch produced the merge). On `armed` or
`pending-review`, none of the three run yet — they wait for `merged` evidence, which the
reconciler picks up convergently at its next trigger point, same as `_shared/pr-first-merge.md`
states.

**Both layers pass — merge (`integration-model: local-merge`):** this Task call never touches
the main checkout — a Task-tool subagent launched by dispatch is cwd-pinned to the worktree it
inherited at launch and cannot reach a sibling directory (see the note at the top of this file).
This call cannot run `git merge`, `ExitWorktree`, or `git worktree remove` — the structural,
outcome-independent constraint stated at the top of this file. Separately, wrap-up's own Item 7
(issue claim release) and Item 8 (run-dir archival) stay deferred on this branch specifically
because the merge that would make them safe has not happened yet and this outcome is not
terminal — not because they inherit the worktree constraint. Item 4 (worktree removal) is
blocked here by that constraint itself, exactly as on the pr-first branch above, and is
merge-dependent besides; the dispatching session runs all three after it merges. Items 1, 2, 3,
5, and 6 are unaffected (not merge-dependent) and may still run normally as part of this call's
own wrap-up execution. Report `OUTCOME: ready-to-merge` (see `task-prompt.md`'s second-call
template) and return — `Dispatching-session merge execution (local-merge fallback)`, below, is what actually
merges, in `dispatch/SKILL.md` Step 6, in the dispatching session's own thread, immediately after
this call's report is read.

**Any layer fails:** proceed exactly as the `auto:build`-only path would — present the normal Review Console, wait for a human.

## Dispatching-session merge execution (local-merge fallback — `OUTCOME: ready-to-merge` only)

<!-- local-merge-fallback -->

`integration-model: pr-first` groups never reach this section — their merge already ran above, inside the Task call itself. This section is the `local-merge` fallback only, preserved in full for projects with no GitHub forge to integrate through (`_shared/integration-model.md`).

Runs in `dispatch/SKILL.md` Step 6, in the dispatching session's own thread — never inside a Task call. This is the one part of the Auto-merge gate that needs main-checkout access, which only a top-level session has, never a Task-tool subagent.

Nothing is threaded back from the second Task call beyond its `OUTCOME: ready-to-merge` line itself (per `_shared/subagent-output-contract.md`'s no-echo rule — a resolution trigger, not a summarized finding). The dispatching session already holds everything else it needs:

- **`{group-worktree}` and `{branch}`** — this session created and entered both for this group in Step 5; it is still inside it (or can `cd` back — the path was captured then). Neither is derived from the Task call's report.
- **`{run-dir}`** — the same value this session minted for the group in Step 4 and passed as `PIPELINE_RUN_DIR` on both Task calls; nothing to derive from either call's report.
- **the group's issue numbers and titles** — already in this run's session-scoped `dispatch-groups.json` (`_shared/session-tmp-root.md`; `queue-pull-script.md`'s Step 2 queue pull wrote it under the same session id). The issue numbers are what `bin/compose-subject.js` takes as positional arguments below — the composer derives the subject and body itself; no title-derived summary is composed by hand.

Clear this run's worktree assignment before merging, the same way `flow/worktree-merge.md`'s reconciliation does:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"
```

so the merge itself, landing in the main checkout, isn't denied as a wrong-checkout commit (E1). That only satisfies E1, though — if the project also has `worktree-always: true` set, the separate, run-independent `checkWorktreeRequired` policy gate in `bin/lib/hooks/pre-tool-use.js` still applies, and it denies any `git push` issued from the main checkout regardless of `close-run` (that gate keys off whether the command's target is a linked worktree, not run state — `close-run` never touches it). `git merge` itself is never flagged by that gate (only `commit`/`push` targets are), so the merge below is safe to run from the main checkout either way. The push after it is not — it must run from inside this group's own linked worktree instead, as a **separate** Bash call: chaining merge-then-push into one compound command still gets the whole invocation denied before either half runs, since the gate inspects the full command string up front (see CLAUDE.md's Don'ts list on this exact shape).

**Shell state does not survive between these calls** — each Bash invocation gets a fresh shell, so a variable assigned in one is empty in the next. Read `{integration-branch}` first and substitute it, and every other placeholder, **literally** into the calls below; do not carry them in shell variables.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch
git remote show origin | sed -n '/HEAD branch/s/.*: //p'   # only when the line above came back empty
```

The two commands together resolve `{integration-branch}`: take the resolver's output when it is non-empty, otherwise the `git remote show origin` fallback — local repository metadata that works regardless of transport, and this skill's rank-6 behavior per `skills/_shared/integration-branch.md`. See that file for the full precedence. It also deliberately skips that ladder's git-inference rank, which would consider the branch the main checkout currently has checked out — the one value this procedure must never trust, since a concurrent session switching it underfoot is exactly what the guard below exists to catch.

**First call — merge, from the main checkout.** `{integration-branch}` and `{branch}` are the values just read:

```bash
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "{integration-branch}" ]; then
  echo "Main checkout is on '$CURRENT', not '{integration-branch}' — a concurrent session switched it. Abort, do not merge." >&2
  exit 1
fi
SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} {second-issue} --tag auto-merge --shell) || exit 1
eval "$SUBJECT_EXPORTS"
git merge --no-ff {branch} -m "$SUBJECT_TITLE

$SUBJECT_BODY"
```

The guard's job is catching a concurrent session switching the shared checkout out from under this merge.

**Second call — push, from inside the worktree** — not the main checkout, which the `worktree-always` gate denies a push from even after `close-run`. Both checkouts share the same underlying `.git`, so pushing the just-merged integration branch from the worktree publishes exactly what the main checkout just merged:

```bash
git -C "{group-worktree}" push origin {integration-branch}
```

The composer emits one `Fixes #{issue}` line per record passed. The explicit `--no-ff` guarantees a real merge commit exists even when the branch would otherwise fast-forward — this is what the `[auto-merge]` tag lands on, and the same commit message carries the closing keyword per "Close-via-merge" in `_shared/issue-claims.md`, so no separate carrier commit is needed for this path.

After the push, run `_shared/pr-first-merge-post-merge.md` Step 4.1 against the local merge commit (`git rev-parse {integration-branch}` immediately after the merge) with `--ref {integration-branch}` — same outcomes and staged file, closing-report line only (no PR to comment on).

**On success**, this call still owes the cleanup the second Task call deliberately skipped (worktree removal, claim release, run-dir archival — Items 4, 7, 8, all merge-dependent). Run them directly, citing the same canonical procedures Settle already cites for claim release rather than re-inventing them: remove the worktree per `wrap-up/cleanup-procedures-execution.md` Section C (`ExitWorktree`, or `git worktree remove` once unlocked), release the claim per that file's Section E, and archive the run directory per its Section B. This is required, not optional — `dispatch/SKILL.md` Step 5 only enters the next group's worktree once this one "has been torn down," so skipping this stalls every later group in the same firing.

Log to `{run-dir}/decisions.md`:
`AUTO {time} — Auto-merge: group [{issues}], assess-agent-autonomy verdict auto-merge for every member (see each member's RATIONALE). Merge commit: {sha}. Reversibility: high (git revert). [lever: auto-merge-max-lines={value} ({source}); auto-merge-max-files={value} ({source}); merge-sensitive-paths={value} ({source})]`

The trailing `[lever: …]` field follows `_shared/auto-decision-log.md`'s Lever attribution section — these are the levers the gate's `merge-check` invocation reads (`skills/assess-agent-autonomy/merge-check.md`); `{value}` comes from that invocation's `blast-radius.js` CLI output (its `config` object); `{source}` needs the envelope form — re-resolve with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-sensitive-paths auto-merge-max-lines auto-merge-max-files` (no `--values`) when writing the line.

Attach the full Review-Console-equivalent summary (whatever `/wrap-up` already produced and reported) to a `PushNotification` as a non-blocking FYI — nothing wrap-up found is dropped, only the wait for a click is skipped.

**That claim covers what wrap-up *found*, not everything its Phase 4 execution step *does*.** Acceptance labeling is an action the second Task call already performed, before ever reporting `ready-to-merge` — not something this section repeats.

**If the composer call exits non-zero (the `|| exit 1` before any merge — nothing has been merged), the merge conflicts, or the branch guard aborts:** `git merge --abort` if a merge is actually in progress. Conflict resolution requires judgment a headless run can't supply. Unlike the Task-call branches above, this session (the dispatching session's own thread — see this section's own opening) has no structural barrier to tearing the worktree down itself; it chooses not to, for the same reason it defers claim release and run-dir archival here: the run genuinely isn't finished, and a human needs to resolve the conflict before any of the three is safe to run — exactly the ordinary un-pushed `pending-review` case `dispatch/SKILL.md`'s Reporting section already parks for. Leave the worktree and run dir parked accordingly; a human resuming the parked run handles all three normally. **One accepted residual:** `close-run` already ran, above, before this conflict was discovered — unlike a normal `pending-review` outcome, this run is no longer E1-protected while parked. Not fixed here; there is no "reopen-run" mechanic to reverse it. Report this group's outcome as `pending-review` (not `ready-to-merge`, which is a transient signal, never terminal), and log why the auto-merge path was abandoned.
