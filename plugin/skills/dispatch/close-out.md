# Dispatch — Close-out (`pending-review` PRs)

The gap this mode closes (#2364): `dispatch/reporting.md`'s `pending-review` parking outcome
gives a human two ways to resume a **still-active** dispatch session (`SKILL.md`'s Reporting
section, and `resume-confirmation.md`'s confirm-before-resume gate) — neither helps once that
session has already exited and a human later reviews and approves the PR directly on GitHub, days
or weeks on. Nothing else re-verifies CI is still green (rather than stale from an earlier
infrastructure blip), converts a still-draft PR to ready, flags a PR that quietly went from clean
to conflicting while it sat parked (and offers to update it, `close-out-update.md`), or performs
the merge (and any project deploy step) once approval is confirmed.
`_shared/github-pr-scan.md`'s `repo-wide` scope item 11 (`[pr-stale]`)
already detects the conflicting case on a schedule; this mode is the close-out process item 11's
own text names as acting on what it flags, an action item 11 itself, being flag-only, never performs.

**Trigger.** `/claude-tweaks:dispatch close-out [#N[,#M,...]]`:

| Form | Behavior |
|---|---|
| `close-out` (bare) | Discover every open, plugin-created PR carrying the `claude-tweaks-run` marker (the same marker `_shared/github-pr-scan.md` item 9/11 detect), excluding housekeeping-marker PRs (mechanical, never a parked record) — no draft-status filter, unlike item 9's own arm-ready scope, since a still-draft `pending-review` PR is exactly one of this mode's target cases (AC2). Run the per-candidate procedure below, one PR at a time. |
| `close-out #N[,#M,...]` | Direct — resolve `#N`'s (or the named group's) own `pending-review` PR from its still-held claim (`_shared/issue-claims.md`; parking never releases a claim) rather than searching the whole open-PR list, then run the same per-candidate procedure against just that one. |

**Preflight.** Same Detection Ladder as the rest of dispatch (`_shared/forge-detection.md` checks
1-3). `work-backend: local-files` stops the same way `SKILL.md`'s own Preflight does — there is no
PR concept to close out. Skip the bare form's discovery step entirely and report why when `gh` (or
its MCP fallback) cannot list PRs.

## Per-candidate procedure

Run one PR at a time, never batched or concurrent — the confirmation gate below is per-PR by
construction (a human answers once per PR), so batching would only serialize the asks anyway, and
`settle-and-merge.md`'s Auto-merge gate already sets the precedent that a merge-adjacent sequence
touching shared state runs one member at a time.

1. **Re-verify CI is currently green — never trust the parked state (AC1).** Read fresh via `gh pr
   checks {number}` (or `gh pr view {number} --json statusCheckRollup`), summarized as
   `passing`/`failing`/`pending`, plus `_shared/pr-first-merge.md` Step 2.5's head-run `gh run list`
   read (a not-yet-completed head run is `pending`, not green) — the identical read `resume-confirmation.md`'s own live-value-
   sourcing paragraph already performs for its confirmation, reused rather than re-implemented.
   `failing`: report the failure and stop for this candidate — do not treat a stale prior green as
   current. `pending`: report and stop for this candidate too; a headless close-out that waited on
   pending checks would just reinvent `--auto`, which is already armed or available in step 5 below.
2. **Re-check mergeability (AC3).** Reuse `resolvePrStateByNumber(repoRoot, number)`
   (`bin/lib/reconcile/pr-state.js` — two positional arguments: the main checkout's path, whose
   `origin` remote gives `gh` its host and repo, then the PR number) exactly as
   `_shared/github-pr-scan.md` item 11 already does for its own `mergeStateStatus` read — the same
   function, not a third PR-state-reading code path. It returns the PR's
   `{state, mergeable, mergeStateStatus, …}` object, or one of the strings `'gh-absent'` /
   `'network-failure'` (transport failure) / `'invalid-arguments'` (a misordered or malformed
   call) / `'pr-not-found'` (GitHub confirmed the queried number names no PR), or `null` for a
   missing number. Any string result (or `null`) stops this candidate — report
   it, and never read it as "not DIRTY".
   An existing `.worktrees/close-out-{number}` or a pending update marker (`close-out-update.md`'s **Update marker**: read that section and run its **Read** here for every candidate, whatever its `mergeStateStatus` — a failed read stops this candidate, `stopped: update failed — marker unreadable`)
   for this candidate is a prior run's update: it
   routes to `close-out-update.md`'s resume (its step 2) regardless of `mergeStateStatus`, from whichever checkout this run is in.
   `mergeStateStatus: DIRTY` or `mergeable: CONFLICTING`: this is item 11's own finding surfacing
   again at close-out time — read `close-out-update.md` in this skill's directory and follow it (an
   offer, then a re-verified merge of the base branch into the PR). `mergeStateStatus: BEHIND`:
   read `close-out-update.md` too (it offers `gh pr update-branch`); declining continues, since
   BEHIND was never a stop — except on a resume (the existing `.worktrees/close-out-{number}` or pending marker above), where `close-out-update.md` step 1 offers no skip: declining stops, since that head is unverified. `mergeStateStatus: BLOCKED` with nothing else wrong is the forge
   waiting on required checks/reviews, not a conflict — proceed.
3. **Convert draft to ready, if needed (AC2).** **Acceptance labeling first** — this check, and
   any Step 1 run it leads to, precedes the Mark-ready call below, keeping
   `_shared/pr-first-merge.md`'s own Step 1 → Step 2 order. Apply
   `_shared/acceptance-labeling-landed.md` to this PR (the run-dir resolution, the `verify.json`
   tier, the live-state tier and the failed-read rule all live there; its failed-read rule and
   at-least-one-record condition are deliberately stricter than this step's former copy, which was
   silent on both). Then act on its outcome:
   - **`no run dir`**: stop this candidate and report
     `stopped: acceptance labeling unverifiable — no run dir`, without running the live-state tier —
     never guess a run dir.
   - **`landed`** (either tier): no Step 1 run.
   - **Any other outcome**: run `_shared/pr-first-merge.md` Step 1 before the confirmation gate, with
     `PIPELINE_RUN_DIR` = the resolved run (or archive) dir and `CLOSING_SUB_ISSUES` = the PR's
     `Fixes` record numbers — in a multi-spec run, once per not-landed member, with
     `PIPELINE_RUN_DIR` = its `spec-{N}/` dir and `MULTISPEC_PARENT_DIR` = the parent.

   Then, when `isDraft`, run `_shared/pr-first-merge.md`'s Step 2 (Mark ready) now, before the
   confirmation gate — the gate's own question states the PR's current state, and "still draft"
   would already be stale by the time a human reads it otherwise.
4. **Confirmation gate.** Read `close-out-confirmation.md` in this skill's directory and follow it
   (AC4). Declining stops here — the PR stays `pending-review` as it was (an update that already ran stays pushed), and nothing below
   runs for this candidate.
5. **On confirmation — merge.** When `close-out-update.md` handed off a `{verified-sha}`, first re-read
   `gh pr view {number} --json headRefOid` immediately before Step 3 and stop on any sha other than
   that `{verified-sha}` (`stopped: update failed — head moved`); then pass `{verified-sha}`
   as Step 3's expected head, so its `--match-head-commit` accepts only that head.
   Run `_shared/pr-first-merge.md`'s Step 3 (Attempt auto-merge)
   directly against this PR — the second call site reaching Step 3 from outside a build or dispatch
   pipeline (the first is `actions-github-issues.md`'s `## Arm ready PR`), reusing that file's full
   degrade chain (`--auto` arm → immediate merge where auto-merge isn't enabled → ready-and-comment
   on any other failure) rather than reimplementing it, with `{tag}` = `human-approved` (that
   step's tag paragraph). Report the outcome (`armed`/`merged`) using that same vocabulary.
6. **Deploy, when the project has one (AC4).** When this project's CLAUDE.md Commands section
   documents a deploy command and step 5 reported `merged`, run it now and log the command, exit
   code, and one-line outcome — never invented when the project documents none, and never itself
   covered by the confirmation gate above (a project whose deploy step needs its own confirmation
   should say so in its own docs; this mode does not add a second gate on top of step 4's).
7. **On `merged` — release the claim and clean up.** First run
   `_shared/pr-first-merge-post-merge.md`'s Step 4.0, with `PIPELINE_RUN_DIR` = step 3's resolved run dir. Then reuse
   `wrap-up/cleanup-procedures-execution.md` Section E (claim release, `bot:in-progress` removal)
   and Section B (run-dir archival) exactly as they are cited elsewhere in this skill — never
   hand-roll the bookkeeping a canonical procedure already owns. Worktree removal (Section C, if
   the run's worktree still exists) defers to the reconciler on merged-PR evidence, the same
   outcome-independent convergence every other merge path in this skill already relies on
   (`settle-and-merge.md`'s worktree constraint) — this mode never runs `EnterWorktree` or
   `git worktree remove` against the run's own worktree. The one exception is the short-lived
   `.worktrees/close-out-{number}` that `close-out-update.md` creates for an update; its step 7
   removes it. On `armed`, none of Sections B/C/E run yet — same as every other
   `armed` outcome in this skill, they wait for `merged` evidence.
   When `close-out-update.md` handed off a `{verified-sha}`, clear its marker on `merged` (`cleared (merged)`, that file's **Update marker**);
   on `armed` it stays pending, so a re-run before the merge lands re-verifies first.

## Reporting

One line per candidate: `#{number} — {outcome}` where `{outcome}` is one of `merged`, `armed`,
`stopped: CI {status}`, `stopped: mergeStateStatus {DIRTY | BEHIND} — update declined`,
`stopped: update failed — {conflict not resolved | verification | push rejected | update-branch rejected | head moved | base not fetched | marker unreadable | marker not written | gh absent | command failed}`,
`stopped: CI {status} after update`, `stopped: mergeStateStatus {status} after update`,
`stopped: acceptance labeling unverifiable — no run dir`, or `declined at confirmation gate`.
The bare form's summary line names how many candidates were found, merged/armed, stopped, and declined. This mode is never headless-self-reporting like bare
`/dispatch`'s own Preflight failures (`_shared/headless-self-report.md`) — its confirmation gate
(step 4) requires a human present by construction (`close-out-confirmation.md`'s no-carve-out
note), so a Routine-fired invocation with nobody present would simply stall at the first candidate
reaching that gate; do not schedule `close-out` as a headless Routine for that reason.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|---------------|
| Rebasing or force-pushing a candidate, or updating one without a passing full suite | The branch is public behind its PR, so `close-out-update.md` merges `{base}` in and re-verifies; the no-update ban belongs to `_shared/github-pr-scan.md` item 11's headless sweep, where nobody is present to review a resolution, and to any update without a passing full-suite `verify.js` stamp on the new HEAD |
| Merging an updated PR on its pre-update CI read | The update made a new HEAD — only a stamp and a CI read on that HEAD count |
| Merging on a cached/prior CI result | The whole reason this mode exists — a `pending-review` PR can sit for weeks; step 1 always re-reads live state (AC1) |
| Silencing the confirmation gate under `unattended` | No `autonomy`-ceiling carve-out — see `close-out-confirmation.md`; a `pending-review` PR reaching this mode means nothing upstream has yet authorized this specific merge |
| Batching multiple candidates' confirmations into one `AskUserQuestion` | Each PR is a distinct merge decision on distinct content — batching would misattribute one answer to every candidate |
