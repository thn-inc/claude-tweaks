# PR-First Merge — the one canonical merge procedure

Canonical for every merge site under `integration-model: pr-first` (`_shared/integration-model.md`):
`dispatch/settle-and-merge.md`'s Auto-merge gate, `wrap-up/review-console.md`'s Auto-merge
short-circuit, `wrap-up/merge-mode.md`, `flow/worktree-merge.md`'s reconciliation, and
`release/execute.md` Step 5.

**The shape:** ready → merge-verification gate (Step 2.5: state read; red parks; pending waits or
arms only when the forge holds it) → `gh pr merge --auto` (arm) → degrade to immediate merge →
degrade to ready+comment. `gh pr merge` needs no local checkout, so the same cwd-pinned Task call that
already holds authorization, `merge-check`, and acceptance labeling runs the merge itself — no
`close-run`-before-merge relief, branch-switch guard, push-from-worktree rule or scratch-worktree
conflict procedure.

## Precondition

`run-state.json` carries a `pr` object (`_shared/pr-run-comments.md`'s gate) AND
`integration-model` resolves `pr-first` for this run. Absent either — fall to the citing file's
local-merge section instead of this procedure.

## Never rewrite the integration branch

Never force-push to, `git reset`, `commit-tree`-and-push, or otherwise rewrite the published `{integration-branch}` on `origin`, on any outcome and for any reason, including repairing a botched merge message. The PR's recorded `mergeCommit`, merged-PR landed-proofs and release tooling key on the commit GitHub created, so a rewrite orphans them and re-authors that commit (#3325 → `9c9f5e722`, #3347). On a malformed merge message (stray text, duplicated body, missing `Fixes` line), leave the commit as landed, log per `_shared/auto-decision-log.md` `AUTO {HH:MM:SS} — Step 3: merge commit {sha} message malformed ({defect}); left as landed, integration branch not rewritten. Reversibility: n/a.` to `decisions.md`, and report `DONE_WITH_CONCERNS` naming the sha and defect for a human. This covers the published branch only: `local-merge`'s undo of an unpushed local merge, and a local ref realigned *to* origin (`_shared/git-discipline.md`), are not rewrites of it.

## Step 1: Acceptance labeling — before the merge, unconditionally

Run `wrap-up/verification-brief.md` starting from its **Routing** section, exactly as the
citing file's own two-layer gate already directs (unchanged from today — this procedure does not
touch layers 1-2, only execution). **Order is load-bearing**: the merge closes the record(s) via
its `Fixes` lines, so labeling must land while every record is still open. A caller that merges
before labeling silently drops acceptance sign-off.
Labeling has not landed when `{run-dir}/verify.json` (each `spec-{N}/` copy, multi-spec) is missing
or its `acceptance-labeling` row's `result` is anything but `pass`/`skip` — the full predicate, live-state tier included, is `_shared/acceptance-labeling-landed.md` — whichever caller reached this merge.

## Step 1.5: Curation-apply completeness guard (#1465)

Before marking the PR ready, confirm Phase 2's curation-engine apply work has actually landed
(the ordering `wrap-up/curation-engine.md` section 2 states, enforced here).

Skip this guard entirely when `$PIPELINE_RUN_DIR/engine-state.json` does not exist — Phase 2 had
nothing open (every registry row closed), or the run took `curation-engine.md` section 6's prose
fallback (which writes no `engine-state.json` and commits inline, in the same single thread that
reaches this step). Otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --run-dir "$PIPELINE_RUN_DIR" --section trace --strict >/dev/null
```

Exit `0` → continue to Step 2: every worklist row Phase 2 opened has a recorded result (why that suffices: `pr-first-merge-appendix.md`'s "Rationale notes").

**Exit `2`** (a worklist row has no recorded result) — fail loud, per this issue's own Gotcha (a
defensive assertion that fires must abort/report, never silently retry or prompt mid-flow): STOP
this procedure before Step 2, log `AUTO {time} — Curation-apply completeness guard: worklist row(s)
unrecorded in engine-state.json — Phase 2 has not finished; merge blocked.`, and surface it to
this run's caller the same way any other HARD-GATE failure here is surfaced (no merge attempted,
no PR undrafted). Re-running Phase 2's own Step 2 (`wrap-up-engine.js record`) for the missing
row(s) is the remedy — this guard only detects the gap, it does not repair it.

## Step 2: Mark the PR ready

First, run `_shared/pr-checklist-refresh.md`'s "Pre-merge title/description refresh" section —
an unconditional `AUTO` step, never a stop — so the title and phase checklist are current before
the merge attempt below.

The PR was opened as a draft at run start (`_shared/pr-early-run-lifecycle.md`), but a re-entry
onto an already-undrafted PR (a retried merge attempt, or a second caller reaching this step for
the same run) must not re-issue the undraft call blind. Read state first:

```bash
gh pr view {pr-number} --repo {owner}/{repo} --json isDraft -q .isDraft
```

`true` → undraft it. GitHub blocks merging (auto or immediate) on a draft PR by default, and this
is the one procedure in the plugin that is allowed to clear that protection, since it only runs
after both authorization and content-judgment layers already passed:

```bash
gh pr ready {pr-number} --repo {owner}/{repo}
```

Log `AUTO {HH:MM:SS} — Step 2 (mark ready): undrafted PR #{n} (was draft). Reversibility: high (gh pr ready {n} --undo).`

`false` → skip the `gh pr ready` call and log the no-op instead:

`AUTO {HH:MM:SS} — Step 2 (mark ready): PR #{n} already ready — skipped gh pr ready. Reversibility: n/a (no state change).`

## Step 2.5: Merge-verification gate

The one canonical statement of how much CI verification a merge waits for — every citing site
applies it here, none restates it. The lever is `merge-verification` (`_shared/policy-schema.md`'s
key row and `_shared/policy-schema-coverage.md`'s coverage block own its meaning and derivation);
this step owns what a merge site *does* with the resolved value. Resolve it once, from the run's
own config overlay:

```bash
MERGE_VERIFICATION=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-verification)
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification
```

The project-level read (no `--run`; run it only when the first prints `off`) tells a **derived** `off` from an explicit one: explicit only when its `merge-verification` entry shows `source: policy`, or a run-level `off` over another project value; derived otherwise — `{"value":"off","source":"default"}`, or the read fails or is unparseable — a wait, never a blind merge.

When one session merges several runs sequentially (`flow/worktree-merge.md`'s reconciliation),
resolve the lever **per merged run** from that run's own directory (`--run "{that run's dir}"`) —
never from whichever `PIPELINE_RUN_DIR` the merging session happens to hold, which is one run's
overlay applied to another's merge.

<!-- when: transport=mcp -->
`gh` absent → the lever is unenforceable; proceed as `off` and disclose at **warn** tier per
`_shared/pr-checklist-refresh.md`'s "Merge-time gh-absent degrade" section. Under
pr-first this is near-unreachable: no `gh` means no PR, so this procedure's own precondition
already fails.
<!-- /when -->

`$MERGE_VERIFICATION` empty or not one of the three values (an invalid `policy.yml` value prints an
empty `--values` line — `invalid: true`, never silently re-derived; or a resolver error) → treat it
as `wait` for this merge and log `AUTO … Step 2.5: lever unresolved ("{raw}") — proceeding as wait`.
Never as `off`: an unreadable lever must not become the one value that skips the wait.

**Read state first — never parse stderr first.** Before any merge attempt, regardless of value, resolve this step's scratch paths (`_shared/session-tmp-root.md`)
and substitute the printed `PR_CHECKS`/`PR_RUNS`/`PARK_COMMENT`/`PR_READY`/`GATE_START` literals for `{pr-checks-path}`/`{pr-runs-path}`/`{park-comment-path}`/`{pr-ready-path}`/`{gate-start-path}`
below (`_shared/scratch-worktree.md` §7):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PR_CHECKS=pr-checks-{n}.txt PR_RUNS=pr-runs-{n}.json PARK_COMMENT=park-comment-{n}.md PR_READY=pr-ready-{n}.json GATE_START=gate-start-{n}.txt
```

Then, on entry from the top only, record the pass start (`date +%s > "{gate-start-path}"`; a mid-pass re-read never repeats it) and read state:

```bash
gh pr view {pr-number} --repo {owner}/{repo} --json state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup
```

Then read the workflow runs for the PR head. The rollup lists only the checks GitHub has registered so far, so a partial rollup — some workflows reported, others not yet registered — reads green while a sibling workflow is still pending. Pass the full 40-char sha (an abbreviated `--commit` returns `[]`):

```bash
gh run list --repo {owner}/{repo} --commit {headRefOid} --limit 100 --json name,workflowName,status,conclusion,url
```

A failed or unparseable runs read is the `state-read-failed` report, same as the first bullet. An empty runs list adds nothing. The code twin is `bin/lib/pr-checks/classify.js`'s `classifyRollup` (with `headRuns`), which applies the same order.

Then the ready-run read (#5153: the last `ReadyForReviewEvent`'s `createdAt`, the head's runs with `createdAt`, `event` and workflow `path`, and the head's workflow triggers):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ready-run.js" --pr {pr-number} --sha {headRefOid}
```

A non-zero exit or output with no `state` is the `state-read-failed` report.

**`StatusContext` entries are normalized first.** A legacy commit-status entry (`StatusContext` — `context`/`state`/`targetUrl`, no `status` or `conclusion`) is read by its `state` before the rules below apply: `FAILURE` or `ERROR` → red, `PENDING` or `EXPECTED` → pending (as is any other unfinished state), `SUCCESS` → green — completed, never pending. The code twin is `bin/lib/pr-checks/classify.js`'s `normalizeEntry`.

Classify from the three reads, in this order:

- The command failed, or its output is not parseable JSON with those five fields → report
  (`pending-review`, reason `state-read-failed`) and stop — never merge on a state this gate could
  not read (the same posture the bounded watch takes for an unknown `gh pr checks` exit). A read
  failure is not "no CI".
- `state` not `OPEN` → report (`pending-review`, reason `pr-not-open`) and stop; never merge — and
  never *park* — a closed or already-merged PR, whatever stale conclusions its rollup still carries.
- Any `statusCheckRollup[]` entry with `conclusion` in `FAILURE`, `TIMED_OUT`, `ERROR`, or `STARTUP_FAILURE`
  — or any head run whose `status` is `completed` and whose `conclusion`, compared case-insensitively (run conclusions are lowercase), is in that same list → **red** (the *PR being merged* has a failing check — distinct from #561's red *tip*, which is
  reconcile's concern). Take the **Red path** below now, before anything else. Under `off` this
  read still runs — an explicit `off` skips only the *wait* — but an explicit `off` merges anyway; a derived `off` takes the **Red path**. An explicit `off`'s red read is logged, not acted on.
- The ready-run read's `state` (code twin: `classify.js`'s `readyRunVerdict`): `read-failed` →
  `state-read-failed`; `red` → **red** (its `failing`); `draft-skip-without-ready-trigger` →
  **Red path**, reason `draft-skip-without-ready-trigger:{files}` — the workflow skips drafts but its
  `types` lack `ready_for_review`, so nothing runs after `gh pr ready`; fix: add `ready_for_review` to
  `types` (`_shared/ci-skips-drafts.md`); an explicit `off` logs it and merges; `awaiting` → **pending**
  (`awaitingReadyRun` names the workflows with no run since ready); `met`, `not-applicable` →
  no change. On `mergeStateStatus: DIRTY` or `mergeable: CONFLICTING` (a conflicting PR gets no run),
  `awaiting` and `draft-skip-without-ready-trigger` take the **Conflict path** first.
- Any entry with `status` not `COMPLETED` (or `conclusion` null while `status: IN_PROGRESS`/`QUEUED`/`PENDING`), or any head run whose `status` is not `completed`
  → **pending**. A partial rollup (some workflows reported, others not yet registered) is not green.
- An **empty rollup** → read the merge state first: `mergeStateStatus: DIRTY` (or `mergeable: CONFLICTING`)
  → **conflict** — take the **Conflict path** below now, under every lever value, with no bounded
  watch. A branch that conflicts with its base gets no `pull_request` workflow runs, so its rollup
  stays empty and waiting only parks it as `checks-pending-timeout` (#3607). Any other merge state
  depends on the lever: under `merge-when-green` or `wait` the repo has PR CI
  by construction (`_shared/policy-schema-coverage.md`'s coverage block derives those values only when a
  `pull_request`-triggered workflow exists, and an explicit value is a statement that CI is
  expected), so an empty rollup means the checks have not *reported yet* — GitHub populates it
  seconds after a push, not instantly — and reads as **pending**, never green; under `off` it is
  simply "no CI" and proceeds as green — derived `off` too, so a PR with no checks never waits.
- Otherwise (every entry `SUCCESS`/`NEUTRAL`/`SKIPPED`, and every head run `completed` without a failing conclusion) → **green**.

Then, per resolved value:

**`--auto` waits only when the forge holds the merge** — `mergeStateStatus: BLOCKED` while checks are pending; anywhere else arming *is* an immediate merge, which is why the pending column below keys on `mergeStateStatus` (capture and reasoning: `pr-first-merge-appendix.md`'s "Why `--auto` alone is not a wait").

| Value | Green | Pending | Red |
|---|---|---|---|
| `merge-when-green` | Step 3 as written — arm/merge (identical outcome when checks are already green) | `mergeStateStatus: BLOCKED` → Step 3 as written — arm `--auto` (the forge holds it; outcome `armed`). Any other value (`CLEAN`, `UNSTABLE`, `BEHIND`, `UNKNOWN`, …) → arming would merge immediately: **degrade to the `wait` row** — never to an immediate merge | Red path |
| `wait` | Re-read (`gh pr view … --json state,mergeStateStatus,headRefOid`); if `headRefOid` changed since the first read or `state` is no longer `OPEN`, re-enter this step from the top (one re-entry; a second change reports `pending-review`, reason `moving-target`) — never merge blind; otherwise merge via Step 3's immediate `--squash` form (CI-gate record, then re-run its composer call) | **Bounded watch** below | Red path |
| `off` | Step 3 as written (today's behavior, unchanged) | Derived `off` → **Bounded watch** below, logged `AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): derived off with pending checks on PR #{n} — bounded watch. Reversibility: n/a. [lever: merge-verification=off (default)]` Explicit `off` → Step 3 as written | Derived `off` → **Red path**. Explicit `off` → Step 3 as written; the red read is logged for the summary |

**CI-gate record.** Once per gate pass, before every merge on a gate-decided **green** (Green column, `wait` re-read, `RC=0`), never under an explicit `off`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ci-gate-record.js" --pr {pr-number} --head-sha {headRefOid} --verdict green --gate-start-epoch "$(cat "{gate-start-path}")" --run "$PIPELINE_RUN_DIR" --repo {owner}/{repo}
```

`--run` follows the per-merged-run rule above (a multi-spec bundle: `$MULTISPEC_PARENT_DIR`). A non-zero exit logs `SKIP {HH:MM:SS} — Step 2.5 (merge-verification gate): ci-gate not recorded ({error})` and the merge path continues unchanged — the writer never gates a merge. A Red-path resume or moving-target re-entry is a new gate pass with its own call; a Step 3 degrade into the `wait` row is the same pass, no second call. Dispatch close-out skips this step, so records nothing; so do an explicit `off`, an armed merge on pending checks and a failed read.

**Bounded watch (`wait`, `merge-when-green` when arming would not hold, and a derived `off` with pending checks) — 15 minutes, fixed.**
(Fixed by design, not a policy key — `pr-first-merge-appendix.md`'s "Rationale notes".) Poll
`gh pr checks` and key on its exit code — captured (Task 0): `0` all green, `8` at least one check
still pending, `1` at least one check failed — so a red result at any minute takes the Red path
immediately:

```bash
DEADLINE=$(( $(date +%s) + 900 ))
while :; do
  gh pr checks {pr-number} --repo {owner}/{repo} > "{pr-checks-path}" 2>&1; RC=$?
  grep -qx "no checks reported on the '.*' branch" "{pr-checks-path}" && RC=8  # none registered yet
  case "$RC" in
    0) gh run list --repo {owner}/{repo} --commit {headRefOid} --limit 100 --json status > "{pr-runs-path}" || { RC=2; break; }
       PENDING_RUNS=$(node -e "console.log(require(process.argv[1]).filter((r) => r.status !== 'completed').length)" -- "{pr-runs-path}") || { RC=2; break; }
       node "${CLAUDE_PLUGIN_ROOT}/bin/ready-run.js" --pr {pr-number} --sha {headRefOid} > "{pr-ready-path}" || { RC=2; break; }
       READY=$(node -e "console.log(require(process.argv[1]).state||process.exit(2))" -- "{pr-ready-path}") || { RC=2; break; }
       [ "$READY" = red ] || [ "$READY" = draft-skip-without-ready-trigger ] && { RC=3; break; }
       [ "$READY" = read-failed ] && { RC=2; break; }
       [ "$READY" = awaiting ] && PENDING_RUNS=1             # awaitingReadyRun: keep watching
       [ "${PENDING_RUNS:-x}" = 0 ] && break                 # all green — no head run still in progress
       [ "$(date +%s)" -ge "$DEADLINE" ] && RC=124 && break  # rollup green, a head run still pending at the bound
       sleep 30 ;;
    1) break ;;                                              # a check failed — red, stop watching
    8) [ "$(date +%s)" -ge "$DEADLINE" ] && RC=124 && break  # still pending at the bound
       sleep 30 ;;
    *) RC=2; break ;;                                        # gh/network error — do not merge on unknown state
  esac
done
```

The head runs are counted from the saved file, never through a `gh … --jq` program: the worktree
guard refuses a `--jq` program inside this loop (`_shared/scratch-worktree.md` §7).

- `RC=0` → **green** — every reported check passed **and** every head run completed (the `0)` branch
  breaks only at zero pending head runs). Re-read state (`gh pr view … --json state,mergeStateStatus,headRefOid`)
  and the head runs and ready run (the same reads as above): if
  `headRefOid` changed since the first read (a new push landed) or `state` is not `OPEN`, re-enter this
  step from the top (one re-entry; a second change reports `pending-review`, reason `moving-target`)
  — never merge blind; a failing head run takes the Red path, reason `check-failed:{names}` (names from
  its `workflowName`s); a head run not yet `completed` resumes the bounded watch at the same `DEADLINE`, as does an `awaiting` ready-run read (`awaitingReadyRun`); any other ready-run state routes per Step 2.5; otherwise merge via Step 3's immediate `--squash` form (CI-gate record, then re-run its composer call) (outcome `merged`,
  then Step 4).
- `RC=1` (a check failed during the watch) → **Red path**, reason `check-failed:{names}` (names from
  the `fail` rows of `{pr-checks-path}`).
- `RC=3` (ready-run `red` or `draft-skip-without-ready-trigger`) → **Red path**, reason from `{pr-ready-path}`: `check-failed:{names}` or `draft-skip-without-ready-trigger:{files}`.
- `RC=124` (still pending at the bound) → **Red path** with reason `checks-pending-timeout` —
  reserved strictly for checks, head runs or an awaited ready run still pending at the bound, never for a check that failed.
- `RC=2` (unknown `gh` exit) → report `pending-review`, reason `checks-read-failed`; never merge on
  a state this gate could not read.

**Red path — never merge; park.**

1. Do not run any `gh pr merge`. Leave the PR ready (already undrafted; never re-draft).
2. Park the run on the work-record issue(s): bootstrap-then-add `bot:parked` (`_shared/label-bootstrap.md`)
   on every record in `{issue-list}` — dispatch's existing `bot:*` home; `run-state.json` statuses are
   untouched (parking surfaces via label + log, not run-state) — and post one comment naming the
   failing check(s), the PR, and the reason:
   `Parked by merge-verification ({value}): {failing check names — or "checks still pending after 15m" for checks-pending-timeout, or "{files} skips drafts with no ready_for_review trigger — add ready_for_review to its types (_shared/ci-skips-drafts.md)" for draft-skip-without-ready-trigger} on PR #{n}. {resume}`
   `{resume}`: `Resume once green.`; for draft-skip-without-ready-trigger, `Resume once its workflow is fixed or a post-ready run lands.`
   Compose that body to a temp file and post it with `--body-file` — never inline the names into a
   shell string. Check names come from the PR's own workflow YAML (third-party-controlled on a fork
   PR), and every other comment site in this file already builds its body the same way:
   ```bash
   printf 'Parked by merge-verification (%s): %s on PR #%s. %s\n' "$VALUE" "$REASON" "$PR" "$RESUME" > "{park-comment-path}"
   gh issue comment "$ISSUE" --repo {owner}/{repo} --body-file "{park-comment-path}"
   ```
   (`$RESUME` holds `{resume}`; `$REASON` holds the check names — from `{pr-checks-path}`'s `fail` rows, or the failing
   head runs' `workflowName`s — or the pending-timeout or draft-skip phrase — passed as a `printf` argument, never expanded inside the format string, never a quoted literal: with file names in it, Write the body to `{park-comment-path}` instead. A timeout whose last ready-run read named `awaitingReadyRun` appends ` (no run since ready: {files})`; `unparsed`: ` ({files} unparsed: _shared/ci-skips-drafts.md)`. Under a derived `off`, the comment's `{value}`/`$VALUE` is `derived off`.)
   Then the **CI-gate record** call above with `--verdict timeout-park` for `checks-pending-timeout`, else `--verdict red`.
   **Verify the label landed** — re-read each record's labels (`gh issue view {n} --json labels`)
   after the add; a missing `bot:parked` is retried once. If it is still missing, the park has no
   lock the `[pr-unarmed]` sweep (`_shared/github-pr-scan.md`) would honor, so fall back to the one
   lock the sweep always honors: re-draft the PR (`gh pr ready {pr-number} --repo {owner}/{repo}
   --undo` — the sole exception to item 1's never-re-draft, taken only because the label failed) and
   say so in the log line below. Never report a park the label read did not confirm.
3. Log to `decisions.md` per `_shared/auto-decision-log.md` (an action taken autonomously — parked, not asked):
   `AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): parked — {reason: check-failed:{names} | checks-pending-timeout | draft-skip-without-ready-trigger:{files}} on PR #{n}; bot:parked applied to #{issue-list} {— or: bot:parked NOT applied to #{list} ({error}); PR re-drafted as the fallback lock}. Reversibility: high (label removal + resume). [lever: merge-verification={value} ({source})]`
4. Report outcome `pending-review`. This is a HARD-GATE-class stop written as park-and-surface — the
   `_shared/auto-mode-contract.md` strict rule holds: never a mid-pipeline prompt here; the human-facing
   surface is dispatch's resume confirmation (`dispatch/SKILL.md`, "Confirm before resuming").

**Log the armed outcome too** — one AUTO line per parked *or* armed merge, so `decisions.md`
accounts for every merge this gate influenced, not only the stopped ones:

`AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): armed — forge holds the merge (mergeStateStatus BLOCKED, checks pending) on PR #{n}; reconciler completes cleanup on merged evidence. Reversibility: high (gh pr merge --disable-auto). [lever: merge-verification={value} ({source})]`

**Forge-cooperation path.** A merge attempt rejected by *org-owned required checks* — the state read
shows `mergeStateStatus: BLOCKED` with every rollup entry green (required reviews or org-owned
required checks the forge is enforcing) — is the forge enforcing a stricter policy than the lever
(classified from the state read, never a stderr string — appendix capture (b)). Report it as such, arm `--auto`
(Step 3's own call — the merge lands when the forge is satisfied), and stop: never retry-loop,
never suggest bypassing protection.

**Signatures (Task 0 captures (a)-(f)):** the literal captured outputs behind the classification above live in `pr-first-merge-appendix.md`'s Signatures section — read them when a merge outcome needs its evidence.

**Resume-to-merge is one-shot.** `dispatch/resume-confirmation.md` applies this gate once, as a read-then-decide with no bounded watch — the rule lives in `pr-first-merge-appendix.md`'s "Resume-to-merge".

## Step 3: Attempt auto-merge, degrading on specific failure signatures

**Creation-time caller:** `tidy/SKILL.md`'s Step 7.5 `pr-first` branch invokes only this step's initial compose + `gh pr merge --auto` fences at PR-creation time, with the degrade chain below replaced by leave-unarmed + report — see that step's own text for the full routing.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --keep-open {keep-open} --pr {pr-number} --out-dir "{subject-dir}"
```

```bash
gh pr merge {pr-number} --repo {owner}/{repo} --auto --squash -t {title-arg} --body-file "{subject-dir}/body.md"
```

`{tag}` is `auto-merge` for the dispatch/headless path (`dispatch/settle-and-merge.md`'s Auto-merge
gate), `fast-lane` for the interactive single-record short-circuit triggered by a live `auto:merge`
label, or `manifesto-authorized` for the same short-circuit triggered instead by the
`merge-authorization` Manifesto lever with no label present (`wrap-up/review-console.md`,
`wrap-up/manifesto-authorized-merge.md`) — preserving all three tags' meanings — `/help`'s
auto-merged-this-week metric (`_shared/github-pr-scan-triage.md` `triage-queue` item 3) keys on all
three. `{issue-list}` is the record numbers — the manifest's `complete` specs only for a bundle
(#2015; rest release via their own `never-started:`/`abandoned:` reason). `human-approved`:
`dispatch/close-out.md`'s human-confirmed merge (that metric excludes it). `{scope}`
resolves inside the composer from the `commit-scope`/`commit-scope-paths` policy keys (`_shared/policy-schema.md`) over the PR's own changed files (`gh pr diff --name-only` behind the `--pr` above — no local branch or checkout needed, so `dispatch/close-out.md`'s and `tidy`'s later-session callers compose the same subject); an explicit `--scope {scope}` overrides both. The composer writes
the Conventional-Commits subject and one `Fixes #{n}` line per record, `Refs #{n}` for a
`{keep-open}` one: the comma-joined `{issue-list}` numbers on a `Refs` line of the post-refresh
PR body (`closing-links.js --mode pre-merge`'s `keepOpen`, or `parseFixesSpan(body).refs`);
omit `--keep-open {keep-open}` when none. (Why the `Fixes` lines are restated: `pr-first-merge-appendix.md`'s "Rationale notes".)
`--squash` keeps one conventional commit per PR.

When the caller supplies an expected head sha (today only `dispatch/close-out.md` after an update), append `--match-head-commit {expected-head}` to every `gh pr merge` command in this step, so a merge, or the arming of one, is accepted only against the head the caller verified; callers that supply none are unchanged.

Run each fence as its own Bash call, never chained; if the composer exits non-zero, stop before any
merge (its stderr names the reason). `{subject-dir}` is a literal path — resolve it once with
`node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SUBJECT_DIR=merge-subject-{key}`
(`{key}` is `{pr-number}` at a pr-first fence, the first number of `{issues}` at a local-merge fence; session-scoped,
`_shared/session-tmp-root.md`) and paste the path inside the printed `SUBJECT_DIR="…"` quotes. `{title-arg}` is the
composer's one stdout line pasted verbatim — already POSIX single-quoted, so a `$(…)`, backtick, or
`'` in the title stays inert.

**This call always either arms or performs the merge — `--auto` never blocks or polls.** Classify
the result:

1. **Command failed with an auto-merge-not-enabled signature** — stderr contains the literal
   captured GitHub GraphQL wording `Auto merge is not allowed for this repository` (captured
   verbatim on this repo, PR #1401, 2026-08-24: `GraphQL: Auto merge is not allowed for this
   repository (enablePullRequestAutoMerge)`), or the second literal
   `Protected branch rules not configured for this branch` (captured verbatim on this repo,
   PR #3450, 2026-10-18: `GraphQL: Pull request Protected branch rules not configured for this
   branch (enablePullRequestAutoMerge)`), or the third literal
   `Pull request is in clean status` (captured verbatim on this repo, PR #3427, 2026-10-18:
   `GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)` — GitHub
   refuses to arm a PR it could merge right now), or the looser paraphrase — `auto-merge` and
   (`not allowed` or `not enabled`) — for a differently-worded GitHub response to the same
   repository setting ("Allow auto-merge") being off. `enablePullRequestAutoMerge` alone in the
   error text also matches, unless item 3's or item 4's signature is also present: it is the arm
   mutation's name, which GitHub appends to every arm-unavailable failure of an `--auto` call.
   `allow_auto_merge: true` alone, without
   branch protection or a ruleset on the base branch, still fails this way — the setting by
   itself does not make `--auto` armable (the appendix's "Why `--auto` alone is not a wait"
   mechanism):

   - under `merge-verification: off` only — degrade to an immediate merge, no `--auto` (today's
     behavior):

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --keep-open {keep-open} --pr {pr-number} --out-dir "{subject-dir}"
     ```

     ```bash
     gh pr merge {pr-number} --repo {owner}/{repo} --squash -t {title-arg} --body-file "{subject-dir}/body.md"
     ```

   - under `merge-when-green` or `wait` — do not merge immediately: degrade to Step 2.5's `wait`
     row instead (the immediate merge is exactly the race both values exist to close; `wait`
     reaching here at all means arming was never its path — it lands in the same bounded watch).

   This either succeeds (→ outcome `merged`, go to Step 4) or fails on one of the signatures
   below (→ that signature's own degrade branch).

2. **Command failed with a checks-pending or checks-failing signature** (stderr contains
   `not mergeable` alongside `required status check`, `review`, or `checks`): checks are red or
   still running and this repo has no auto-merge to arm around it (already ruled out by reaching
   here from branch 1, or `--auto` itself isn't what failed — a plain `--squash` attempt hit this
   directly). → **degrade to ready+comment** (Step 5), outcome `pending-review`. If Step 2.5's
   state read had shown `mergeStateStatus: BLOCKED` with a green rollup, this rejection is the
   Forge-cooperation case — arm `--auto` per Step 2.5 (the forge holds the merge until it is
   satisfied) instead of degrading to ready+comment; item 2's degrade applies to the remaining
   signatures (checks genuinely red or still running with no forge hold).

3. **Command failed with a conflict signature** (stderr contains `not mergeable` alongside
   `conflict`, or a GraphQL `mergeable: CONFLICTING` reason): → **Conflict path** below.

4. **Command failed with a permission-denied signature** (stderr contains `403`, `not accessible`,
   or `must have write access`): → **degrade to ready+comment** (Step 5), outcome `pending-review`
   — same branch as checks-pending. A permission gap needs a human with the right access, not a
   retry.

5. **Command failed with anything else, or an error this procedure doesn't recognize**: →
   **degrade to ready+comment** (Step 5), outcome `pending-review`. Never guess at an unfamiliar
   error's meaning — the conservative branch is always safe (the PR stays ready, a human decides),
   while guessing wrong on a real failure (e.g. treating a genuine conflict as a transient blip and
   retrying) is not.

6. **Command succeeded**: confirm which of the two happened —

   ```bash
   gh pr view {pr-number} --repo {owner}/{repo} --json state,mergedAt,autoMergeRequest,statusCheckRollup
   ```

   - `state: MERGED`: outcome `merged`. **Read `statusCheckRollup` before reporting it green
     (#2705) — never infer "merged once CI passed" from `state` alone.** A `StatusContext` entry is read by its `state` first, as in Step 2.5 (`SUCCESS`, `FAILURE`, `ERROR` concluded; `PENDING`, `EXPECTED` not). All entries
     `COMPLETED`+`SUCCESS`/`NEUTRAL`/`SKIPPED` → report "merged, {names} concluded {conclusions}";
     any entry still non-`COMPLETED` → report "merged — {name} had not concluded at merge time;
     this repo has no required checks (see `pr-first-merge-appendix.md`'s Signatures), so `--auto` did not wait on it";
     empty rollup → "merged — no status checks on this PR." Go to Step 4.
   - `state: OPEN` with `autoMergeRequest` present (checks still pending, auto-merge armed):
     outcome `armed`. **Do not poll or wait** — this call is done. The reconciler
     (`bin/lib/reconcile`) completes cleanup later, on merged-PR evidence, the same convergent
     way it handles every other post-merge state. Nothing merge-dependent tears down here (no
     worktree removal, no claim release, no run-dir archival) — those wait for `merged` evidence,
     whether this same session later observes it (unlikely — sessions don't poll) or the
     reconciler does at its next trigger point (`_shared/pr-run-comments.md`'s consumer table).

## Step 4 and Step 5: post-merge (outcome `merged` only)

Reached only once Step 3 above confirms outcome `merged` — `armed`/`pending-review` never reach
this point. Read `pr-first-merge-post-merge.md` in this skill's directory and follow it in full:
Step 4's post-merge reconcile (release-carrier tracking via tag ancestry, Step 4.1,
then `bin/hooks.js reconcile`) and Step 5's
remote-branch delete (cited separately from
`wrap-up/cleanup-procedures-execution.md` Section C, after worktree teardown).

## Conflict path

Exactly **one** update-from-base attempt, from inside the run's own worktree — never inside the
main checkout, and never more than once:

```bash
git -C "{worktree-path}" fetch origin {integration-branch}
git -C "{worktree-path}" merge origin/{integration-branch}
```

- **Clean** (no conflict markers): push and retry the merge once, from the top of Step 3 — or,
  when this path was entered from Step 2.5 (no merge attempted yet), re-enter Step 2.5 from the top
  instead: the pushed head has its own CI to read before any merge:

  ```bash
  git -C "{worktree-path}" push origin {branch}
  ```

- **Conflict markers remain**: this is what "unresolvable headlessly" means — stop, do not
  attempt resolution. Leave the PR ready (already undrafted, never re-drafted) with a comment
  explaining the conflict, and report outcome `pending-review`. A human resolves it the ordinary
  way — check out the branch, resolve, push — no scratch-worktree ceremony.
- **Attended branch (merge mode only).** A human-confirmed merge (`/claude-tweaks:wrap-up #{n} merge`)
  resolves instead of stopping — procedure in `wrap-up/merge-mode.md`'s `## Conflict`. Every other
  caller keeps the stop-at-markers bullet above.

**Sequential multi-branch merges** are serialized one at a time (`flow/worktree-merge.md`'s reconciliation) — why each later branch's update-from-base sees real current state: `pr-first-merge-appendix.md`'s "Rationale notes".

## Outcome vocabulary

Replaces `ready-to-merge` (folded into `merged`/`armed`) and `pr-opened` (retired — the PR
exists from run start).

| Outcome | Meaning | Cleanup owed by this call |
|---|---|---|
| `merged` | Confirmed synchronously via `gh pr view` | Step 4's reconcile call |
| `armed` | `--auto` armed, checks still pending | None — reconciler completes it later |
| `pending-review` | Checks red, conflict unresolvable headlessly, permission denied, or an unrecognized error, checks red or still pending at Step 2.5's bound (parked with bot:parked, reason check-failed:{names}, checks-pending-timeout or draft-skip-without-ready-trigger:{files}), pr-not-open, moving-target | None — PR stays ready, human decides |
| `failed` | This run never reached the merge attempt at all (upstream HARD-GATE) | Handled entirely by Settle, before this procedure is ever invoked |

## Comment ordering

See `pr-first-merge-appendix.md`'s "Comment ordering" section for the posting-order rule
governing anything this procedure comments on the PR.

## Local-merge fallback

<!-- when: integration-model=local-merge -->
Not this file's concern under `pr-first` — see `pr-first-merge-appendix.md`'s "Local-merge
fallback" section for what `local-merge` projects keep instead.
<!-- /when -->
