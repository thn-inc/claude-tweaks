# PR-First Merge — the one canonical merge procedure

Canonical for every merge site under `integration-model: pr-first` (`_shared/integration-model.md`):
`dispatch/settle-and-merge.md`'s Auto-merge gate, `wrap-up/review-console.md`'s Auto-merge
short-circuit, `flow/worktree-merge.md`'s reconciliation, and `release/execute.md`
Step 5. Supersedes and closes
#335 (the two independently-authored auto-merge implementations these three files carried) and
#299 (the fast-lane `git -C "$RUN_DIR"` worktree/branch anchoring defect — obsolete once merge
needs no checkout at all).

**The shape:** ready → merge-verification gate (Step 2.5: state read; red parks; pending waits or
arms only when the forge holds it) → `gh pr merge --auto` (arm) → degrade to immediate merge →
degrade to ready+comment. `gh pr merge` needs no local checkout, which is what deletes the two-thread split
every pr-first caller used to need: the same cwd-pinned Task call that already holds
authorization, `merge-check`, and acceptance labeling can run the merge itself. No
`close-run`-before-merge relief, no branch-switch guard, no push-from-worktree rule, no
scratch-worktree conflict procedure — all four existed only because a *local* `git merge` +
`git push` needed the main checkout. `local-merge` projects keep all four; see each converted
file's own local-merge fallback section.

## Precondition

`run-state.json` carries a `pr` object (`_shared/pr-run-comments.md`'s gate) AND
`integration-model` resolves `pr-first` for this run. Absent either — fall to the citing file's
local-merge section instead of this procedure.

## Step 1: Acceptance labeling — before the merge, unconditionally

Run `wrap-up/verification-brief.md` starting from its **Routing** section, exactly as the
citing file's own two-layer gate already directs (unchanged from today — this procedure does not
touch layers 1-2, only execution). **Order is load-bearing**: the merge closes the record(s) via
its `Fixes` lines, so labeling must land while every record is still open. A caller that merges
before labeling silently drops acceptance sign-off the same way the pre-#410 fast-lane path once
did for a different reason (`wrap-up/review-console.md`'s own "console content is not all of
Phase 4" note) — this procedure states the ordering explicitly so it is never re-dropped.

## Step 1.5: Curation-apply completeness guard (#1465)

Before marking the PR ready, confirm Phase 2's curation-engine apply work has actually landed —
a defensive assertion against an ordering `wrap-up/curation-engine.md`'s own "Ordering is not
advisory" note (section 2) states as prose but does not itself mechanically enforce at the merge
boundary. One occurrence (Dispatch hub run #9, 2026-08-26, group [#251]) reached this merge step
with a curation-row commit still pending, landing after the merge instead of before it.

Skip this guard entirely when `$PIPELINE_RUN_DIR/engine-state.json` does not exist — Phase 2 had
nothing open (every registry row closed), or the run took `curation-engine.md` section 6's prose
fallback (which writes no `engine-state.json` and commits inline, in the same single thread that
reaches this step). Otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --run-dir "$PIPELINE_RUN_DIR" --section trace --strict >/dev/null
```

This is the exact check Phase 2's own Step 3 already ran once (`curation-engine.md` section 2) —
re-running it here is idempotent (`render` performs no writes) and catches a Phase 2 that was
skipped, interrupted, or that this merge step is reached ahead of, out of documented order. Exit
`0` means every worklist row Phase 2 opened has a recorded result — and, by
`curation-engine.md` section 4's own sequencing (the serial-commit pass runs, and every applied
finding's commit lands, strictly **before** the `record` call that produces that recorded
result), every applied finding's commit has therefore already landed too. Nothing further to
check: nothing this procedure could add to a `git status` scan tells it more than `render
--strict`'s own exit code already does.

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

(Empirically, `gh pr ready` on an already-ready PR is itself a harmless no-op — exit 0, a `!
Pull request … is already "ready for review"` warning on stderr, no error — so this guard is not
error-avoidance. It exists to keep the decision log accurate: an unconditional call would log
"undrafted" every re-entry even when nothing changed.)

## Step 2.5: Merge-verification gate

The one canonical statement of how much CI verification a merge waits for — every citing site
applies it here, none restates it. The lever is `merge-verification` (`_shared/policy-schema.md`'s
key row and `_shared/policy-schema-coverage.md`'s coverage block own its meaning and derivation);
this step owns what a merge site *does* with the resolved value. Resolve it once, from the run's
own config overlay:

```bash
MERGE_VERIFICATION=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-verification)
```

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

**Read state first — never parse stderr first.** Before any merge attempt, regardless of value:

```bash
gh pr view {pr-number} --repo {owner}/{repo} --json state,mergeStateStatus,headRefOid,statusCheckRollup
```

Classify from the JSON, in this order:

- The command failed, or its output is not parseable JSON with those four fields → report
  (`pending-review`, reason `state-read-failed`) and stop — never merge on a state this gate could
  not read (the same posture the bounded watch takes for an unknown `gh pr checks` exit). A read
  failure is not "no CI".
- `state` not `OPEN` → report (`pending-review`, reason `pr-not-open`) and stop; never merge — and
  never *park* — a closed or already-merged PR, whatever stale conclusions its rollup still carries.
- Any `statusCheckRollup[]` entry with `conclusion` in `FAILURE`, `TIMED_OUT`, `ERROR`, or `STARTUP_FAILURE`
  → **red** (the *PR being merged* has a failing check — distinct from #561's red *tip*, which is
  reconcile's concern). Take the **Red path** below now, before anything else. Under `off` this
  read still runs — `off` skips the *wait*, not the read — but the value `off` merges anyway
  (today's behavior); the red classification is logged and shown, not acted on.
- Any entry with `status` not `COMPLETED` (or `conclusion` null while `status: IN_PROGRESS`/`QUEUED`/`PENDING`)
  → **pending**.
- An **empty rollup** → depends on the lever: under `merge-when-green` or `wait` the repo has PR CI
  by construction (`_shared/policy-schema-coverage.md`'s coverage block derives those values only when a
  `pull_request`-triggered workflow exists, and an explicit value is a statement that CI is
  expected), so an empty rollup means the checks have not *reported yet* — GitHub populates it
  seconds after a push, not instantly — and reads as **pending**, never green; under `off` it is
  simply "no CI" and proceeds as green.
- Otherwise (every entry `SUCCESS`/`NEUTRAL`/`SKIPPED`) → **green**.

Then, per resolved value:

**Why `--auto` alone is not a wait (Task 0, captured on this repo).** On a repository with no
required status checks, `gh pr merge --auto --squash` **merges immediately** — exit `0`, empty stdout
and stderr, `autoMergeRequest: null`, the PR `MERGED` while its `test` check was still `pending`.
There is no distinguishing signature: `--auto`'s success looks identical whether it armed or merged.
That is the #540 mechanism itself. So "arm `--auto`" is a genuine wait **only when the state read
shows the forge would hold the merge** — `mergeStateStatus: BLOCKED` while checks are pending
(required checks / rulesets configured); anywhere else, arming *is* an immediate merge and this gate
must not lean on it. That is why the pending column below keys on `mergeStateStatus`, not on
`--auto`'s exit code.

| Value | Green | Pending | Red |
|---|---|---|---|
| `merge-when-green` | Step 3 as written — arm/merge (identical outcome when checks are already green) | `mergeStateStatus: BLOCKED` → Step 3 as written — arm `--auto` (the forge holds it; outcome `armed`). Any other value (`CLEAN`, `UNSTABLE`, `BEHIND`, `UNKNOWN`, …) → arming would merge immediately: **degrade to the `wait` row** — never to an immediate merge | Red path |
| `wait` | Re-read (`gh pr view … --json state,mergeStateStatus,headRefOid`); if `headRefOid` changed since the first read or `state` is no longer `OPEN`, re-enter this step from the top (one re-entry; a second change reports `pending-review`, reason `moving-target`) — never merge blind; otherwise merge via Step 3's immediate `--squash` form (re-run its composer call first) | **Bounded watch** below | Red path |
| `off` | Step 3 as written (today's behavior, unchanged) | Step 3 as written (today's behavior — this is the #540-shaped race the lever exists to close; a repo derives `off` only when it has no PR CI or a non-default integration branch, `_shared/policy-schema-coverage.md`'s coverage block) | Step 3 as written; the red read is logged for the summary |

**Bounded watch (`wait`, and `merge-when-green` when arming would not hold) — 15 minutes, fixed.**
Not a policy key: `merge-when-green` (arming) is the no-wait path, `wait` is its fallback, and a
repo where 15 minutes is chronically wrong should enable required checks/auto-merge rather than
tune a knob (parent #558's one-lever decision; this paragraph is the timeout's own rationale). Poll
`gh pr checks` and key on its exit code — captured (Task 0): `0` all green, `8` at least one check
still pending, `1` at least one check failed — so a red result at any minute takes the Red path
immediately:

```bash
DEADLINE=$(( $(date +%s) + 900 ))
while :; do
  gh pr checks {pr-number} --repo {owner}/{repo} > /tmp/pr-checks-{n}.txt 2>&1; RC=$?
  case "$RC" in
    0) break ;;                                              # all green
    1) break ;;                                              # a check failed — red, stop watching
    8) [ "$(date +%s)" -ge "$DEADLINE" ] && RC=124 && break  # still pending at the bound
       sleep 30 ;;
    *) RC=2; break ;;                                        # gh/network error — do not merge on unknown state
  esac
done
```

- `RC=0` → **green**: re-read state (`gh pr view … --json state,mergeStateStatus,headRefOid`); if
  `headRefOid` changed since the first read (a new push landed) or `state` is not `OPEN`, re-enter this
  step from the top (one re-entry; a second change reports `pending-review`, reason `moving-target`)
  — never merge blind; otherwise merge via Step 3's immediate `--squash` form (re-run its composer call first) (outcome `merged`,
  then Step 4).
- `RC=1` (a check failed during the watch) → **Red path**, reason `check-failed:{names}` (names from
  the `fail` rows of `/tmp/pr-checks-{n}.txt`).
- `RC=124` (still pending at the bound) → **Red path** with reason `checks-pending-timeout` —
  reserved strictly for checks still running at the bound, never for a check that failed.
- `RC=2` (unknown `gh` exit) → report `pending-review`, reason `checks-read-failed`; never merge on
  a state this gate could not read.

**Red path — never merge; park.**

1. Do not run any `gh pr merge`. Leave the PR ready (already undrafted; never re-draft).
2. Park the run on the work-record issue(s): bootstrap-then-add `bot:parked` (`_shared/label-bootstrap.md`)
   on every record in `{issue-list}` — dispatch's existing `bot:*` home; `run-state.json` statuses are
   untouched (parking surfaces via label + log, not run-state) — and post one comment naming the
   failing check(s), the PR, and the reason:
   `Parked by merge-verification ({value}): {failing check names — or "checks still pending after 15m" for checks-pending-timeout} on PR #{n}. Resume once green.`
   Compose that body to a temp file and post it with `--body-file` — never inline the names into a
   shell string. Check names come from the PR's own workflow YAML (third-party-controlled on a fork
   PR), and every other comment site in this file already builds its body the same way:
   ```bash
   printf 'Parked by merge-verification (%s): %s on PR #%s. Resume once green.\n' "$VALUE" "$REASON" "$PR" > /tmp/park-comment-{n}.md
   gh issue comment "$ISSUE" --repo {owner}/{repo} --body-file /tmp/park-comment-{n}.md
   ```
   (`$REASON` holds the check names read from `/tmp/pr-checks-{n}.txt`'s `fail` rows, or the
   pending-timeout phrase — passed as a `printf` argument, never expanded inside the format string.)
   **Verify the label landed** — re-read each record's labels (`gh issue view {n} --json labels`)
   after the add; a missing `bot:parked` is retried once. If it is still missing, the park has no
   lock the `[pr-unarmed]` sweep (`_shared/github-pr-scan.md`) would honor, so fall back to the one
   lock the sweep always honors: re-draft the PR (`gh pr ready {pr-number} --repo {owner}/{repo}
   --undo` — the sole exception to item 1's never-re-draft, taken only because the label failed) and
   say so in the log line below. Never report a park the label read did not confirm.
3. Log to `decisions.md` per `_shared/auto-decision-log.md` (an action taken autonomously — parked, not asked):
   `AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): parked — {reason: check-failed:{names} | checks-pending-timeout} on PR #{n}; bot:parked applied to #{issue-list} {— or: bot:parked NOT applied to #{list} ({error}); PR re-drafted as the fallback lock}. Reversibility: high (label removal + resume). [lever: merge-verification={value} ({source})]`
4. Report outcome `pending-review`. This is a HARD-GATE-class stop written as park-and-surface — the
   `_shared/auto-mode-contract.md` strict rule holds: never a mid-pipeline prompt here; the human-facing
   surface is dispatch's resume confirmation (`dispatch/SKILL.md`, "Confirm before resuming").

**Log the armed outcome too** — one AUTO line per parked *or* armed merge, so `decisions.md`
accounts for every merge this gate influenced, not only the stopped ones:

`AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): armed — forge holds the merge (mergeStateStatus BLOCKED, checks pending) on PR #{n}; reconciler completes cleanup on merged evidence. Reversibility: high (gh pr merge --disable-auto). [lever: merge-verification={value} ({source})]`

**Forge-cooperation path.** A merge attempt rejected by *org-owned required checks* — the state read
shows `mergeStateStatus: BLOCKED` with every rollup entry green (required reviews or org-owned
required checks the forge is enforcing) — is the forge enforcing a stricter policy than the lever
(Task 0 capture (b): not captured — this repo has no branch protection or rulesets, so
classification rests on the state read, never on a stderr string). Report it as such, arm `--auto`
(Step 3's own call — the merge lands when the forge is satisfied), and stop: never retry-loop,
never suggest bypassing protection.

**Signatures (Task 0, captured on this repo — literal, 2026-08-16, probe PR #591 against a throwaway base):**

- (a) `gh pr merge {n} --auto --merge -t … -b …` on this repo (`allow_auto_merge: false`, no branch protection, no rulesets): stdout empty, stderr empty, `exit=0` — and the PR **merged immediately** (`gh pr view … --json state,mergedAt,autoMergeRequest` → `{"autoMergeRequest":null,"mergedAt":"2026-08-16T11:40:57Z","state":"MERGED"}`) while its `test` check was still `pending`. No signature distinguishes "armed" from "merged" — only the follow-up `gh pr view` does (Step 3.6).
- (b) merge rejected by required checks: not captured — this repo has no branch protection or rulesets (`gh api repos/{owner}/{repo}/branches/main/protection` → HTTP 404 "Branch not protected"; `…/rules/branches/main` → `[]`); classification for this path rests on the state read (`mergeStateStatus: BLOCKED` with a green rollup), never on a stderr string.
- (c) `gh pr checks {n} --watch --fail-fast` on a failing check: rows like `test	fail	35s	https://github.com/…/actions/runs/…` (each check name / `pass`|`fail`|`pending`|`skipping` / duration / URL), `exit=1`. (c2) `gh pr checks {n}` while a check is still running: `test	pending	0	https://…`, `exit=8`.
- (d) `gh pr view {n} --json state,mergeStateStatus,statusCheckRollup` — green (open draft PR #588, read-only): `{"mergeStateStatus":"CLEAN","rollup":[{"conclusion":"SUCCESS","name":"label-fix-branch","status":"COMPLETED"},{"conclusion":"SUCCESS","name":"test","status":"COMPLETED"},{"conclusion":"SKIPPED","name":"cleanup-fix-labels","status":"COMPLETED"}],"state":"OPEN"}`; failing rollup entry: `{"conclusion":"FAILURE","name":"test","status":"COMPLETED"}` (observed on #591 after merge, `mergeStateStatus: UNKNOWN` — the value GitHub reports once a PR is `MERGED`); the `mergeStateStatus` value of an *open* PR with failing checks was not captured (the probe merged via (a) before its checks failed) — which is why red is classified from `statusCheckRollup[].conclusion`, not from `mergeStateStatus`.
- Also captured: `gh pr merge` against an already-merged PR: stderr `! Pull request {owner}/{repo}#{n} was already merged`, `exit=0` — a no-op, not an error; the state read (`state: MERGED`) catches it first.

**Resume-to-merge is one-shot.** `dispatch/SKILL.md`'s "Confirm before resuming" confirmation applies
this same lever as a single read-then-decide (green → proceed; red → surface in the confirmation;
pending with `mergeStateStatus: BLOCKED` → arm `--auto`, since the forge is what holds it; pending
with any other `mergeStateStatus` → do **not** arm — on an unprotected repo arming *is* an immediate
merge (capture (a)), so the confirmation itself carries the choice: wait for green, or leave parked)
— a human is present on resume, so it never runs the bounded watch.

## Step 3: Attempt auto-merge, degrading on specific failure signatures

**Creation-time caller:** `tidy/SKILL.md`'s Step 7.5 `pr-first` branch invokes only this step's initial `gh pr merge --auto` call at PR-creation time, with the degrade chain below replaced by leave-unarmed + report — see that step's own text for the full routing.

```bash
SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --shell) || exit 1
eval "$SUBJECT_EXPORTS"
gh pr merge {pr-number} --repo {owner}/{repo} --auto --squash \
  -t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"
```

`{tag}` is `auto-merge` for the dispatch/headless path (`dispatch/settle-and-merge.md`'s Auto-merge
gate), `fast-lane` for the interactive single-record short-circuit triggered by a live `auto:merge`
label, or `manifesto-authorized` for the same short-circuit triggered instead by the
`merge-authorization` Manifesto lever with no label present (`wrap-up/review-console.md`,
`wrap-up/manifesto-authorized-merge.md`) — preserving all three tags' meanings — `/help`'s
auto-merged-this-week metric (`_shared/github-pr-scan.md` `triage-queue` item 3) keys on all
three. `{issue-list}` is the record numbers — the manifest's `complete` specs only for a bundle
(#2015; rest release via their own `never-started:`/`abandoned:` reason). The composer writes
the Conventional-Commits subject and one `Fixes #{n}` line per record. Same set the
PR body's own `Fixes` lines already carry (`_shared/pr-checklist-refresh.md`'s pre-merge
refresh), restated here because the merge commit's own message is what GitHub scans for
closing keywords on a non-default integration branch, where the PR body's keywords don't
fire (GitHub only auto-closes from a merge commit's message, or a PR body merged into the
*default* branch — an explicit merge commit message is what makes closing work on any
integration branch). `--squash` keeps one conventional commit per PR.

**This call always either arms or performs the merge — `--auto` never blocks or polls.** Classify
the result:

1. **Command failed with an auto-merge-not-enabled signature** — stderr contains the literal
   captured GitHub GraphQL wording `Auto merge is not allowed for this repository` (captured
   verbatim on this repo, PR #1401, 2026-08-24: `GraphQL: Auto merge is not allowed for this
   repository (enablePullRequestAutoMerge)`), or the looser paraphrase — `auto-merge` and
   (`not allowed` or `not enabled`) — for a differently-worded GitHub response to the same
   repository setting ("Allow auto-merge") being off:

   - under `merge-verification: off` only — degrade to an immediate merge, no `--auto` (today's
     behavior):

     ```bash
     SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --shell) || exit 1
     eval "$SUBJECT_EXPORTS"
     gh pr merge {pr-number} --repo {owner}/{repo} --squash \
       -t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"
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
   gh pr view {pr-number} --repo {owner}/{repo} --json state,mergedAt,autoMergeRequest
   ```

   - `state: MERGED` (checks were already green, or this was the no-`--auto` immediate-merge
     degrade branch): outcome `merged`. Go to Step 4.
   - `state: OPEN` with `autoMergeRequest` present (checks still pending, auto-merge armed):
     outcome `armed`. **Do not poll or wait** — this call is done. The reconciler
     (`bin/lib/reconcile`) completes cleanup later, on merged-PR evidence, the same convergent
     way it handles every other post-merge state. Nothing merge-dependent tears down here (no
     worktree removal, no claim release, no run-dir archival) — those wait for `merged` evidence,
     whether this same session later observes it (unlikely — sessions don't poll) or the
     reconciler does at its next trigger point (`_shared/pr-run-comments.md`'s consumer table;
     session-start, dispatch queue-pull, routine kickoffs, tidy, all converge on this
     eventually).

## Step 4 and Step 5: post-merge (outcome `merged` only)

Reached only once Step 3 above confirms outcome `merged` — `armed`/`pending-review` never reach
this point. Read `pr-first-merge-post-merge.md` in this skill's directory and follow it in full:
Step 4's post-merge reconcile (release-carrier tracking via `bin/release.js`, then
`bin/hooks.js reconcile`) and Step 5's remote-branch delete (cited separately from
`wrap-up/cleanup-procedures-execution.md` Section C, after worktree teardown).

## Conflict path

Exactly **one** update-from-base attempt, from inside the run's own worktree — never inside the
main checkout, and never more than once:

```bash
git -C "{worktree-path}" fetch origin {integration-branch}
git -C "{worktree-path}" merge origin/{integration-branch}
```

- **Clean** (no conflict markers): push and retry the merge once, from the top of Step 3:

  ```bash
  git -C "{worktree-path}" push origin {branch}
  ```

- **Conflict markers remain**: this is what "unresolvable headlessly" means — stop, do not
  attempt resolution. Leave the PR ready (already undrafted, never re-drafted) with a comment
  explaining the conflict, and report outcome `pending-review`. A human resolves it the ordinary
  way — check out the branch, resolve, push — no scratch-worktree ceremony needed, since the
  conflict already surfaced inside the run's own real worktree, not a throwaway one.

**Sequential multi-branch merges** (`flow/worktree-merge.md`'s reconciliation): the invoking
session serializes them one at a time. Each later branch's own single update-from-base attempt
merges from whichever tip the just-advanced integration branch now has — a genuinely later
branch's conflict is checked against real current state, not a stale snapshot from before the
earlier branches merged.

## Outcome vocabulary

Replaces `ready-to-merge` (folded into `merged`/`armed` — see Step 3.6) and `pr-opened` (retired
— under pr-first the PR already exists from run start, so there is no longer a distinct
"finish reached, PR opened just now" transition to report).

| Outcome | Meaning | Cleanup owed by this call |
|---|---|---|
| `merged` | Confirmed synchronously via `gh pr view` | Step 4's reconcile call |
| `armed` | `--auto` armed, checks still pending | None — reconciler completes it later |
| `pending-review` | Checks red, conflict unresolvable headlessly, permission denied, or an unrecognized error, checks red or still pending at Step 2.5's bound (parked with bot:parked, reason check-failed:{names} or checks-pending-timeout), pr-not-open, moving-target | None — PR stays ready, human decides |
| `failed` | This run never reached the merge attempt at all (upstream HARD-GATE) | Handled entirely by Settle, before this procedure is ever invoked |

## Comment ordering

Anything that must land on the PR posts **before** the merge call (Step 3) — the verdict/brief
comments from `_shared/pr-run-comments.md` already do, per their own citing sites' phase-exit
ordering. Anything this procedure itself posts (the conflict/degrade comment) is
**after**-the-fact information about why the merge didn't complete, so it posts once the outcome
is known, never speculatively before.

## Local-merge fallback

<!-- when: integration-model=local-merge -->
Not this file's concern — `local-merge` projects keep each citing file's own pre-#411 procedure
in substance: the branch-switch guard, the `close-run` E1 relief, the push-from-worktree rule,
and (for `flow/worktree-merge.md`) the scratch-worktree conflict procedure. Each citing file
keeps a compact section stating this rather than duplicating the old prose here.
<!-- /when -->
