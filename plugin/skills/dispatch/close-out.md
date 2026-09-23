# Dispatch — Close-out (`pending-review` PRs)

The gap this mode closes (#2364): `dispatch/reporting.md`'s `pending-review` parking outcome
gives a human two ways to resume a **still-active** dispatch session (`SKILL.md`'s Reporting
section, and `resume-confirmation.md`'s confirm-before-resume gate) — neither helps once that
session has already exited and a human later reviews and approves the PR directly on GitHub, days
or weeks on. Nothing else re-verifies CI is still green (rather than stale from an earlier
infrastructure blip), converts a still-draft PR to ready, flags a PR that quietly went from clean
to conflicting while it sat parked, or performs the merge (and any project deploy step) once
approval is confirmed. `_shared/github-pr-scan.md`'s `repo-wide` scope item 11 (`[pr-stale]`)
already detects the conflicting case on a schedule; this mode is the close-out action item 11's
own text names but never performs itself — "flag-only… a human, or #2364's own close-out process,
acts on it."

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
   `passing`/`failing`/`pending` — the identical read `resume-confirmation.md`'s own live-value-
   sourcing paragraph already performs for its confirmation, reused rather than re-implemented.
   `failing`: report the failure and stop for this candidate — do not treat a stale prior green as
   current. `pending`: report and stop for this candidate too; a headless close-out that waited on
   pending checks would just reinvent `--auto`, which is already armed or available in step 5 below.
2. **Re-check mergeability (AC3).** Reuse `resolvePrStateByNumber`
   (`bin/lib/reconcile/pr-state.js`) exactly as `_shared/github-pr-scan.md` item 11 already does for
   its own `mergeStateStatus` read — the same function, not a third PR-state-reading code path.
   `mergeStateStatus: DIRTY`: this is item 11's own finding surfacing again at close-out time —
   report it with that scope's own recommendation (rebase and re-verify: typecheck, lint, full test
   suite) and stop for this candidate. Rebasing changes PR content without the author present, so
   this mode never performs it any more than item 11's own sweep does — flag-only holds at
   close-out time too, not just at discovery time. `mergeStateStatus: BLOCKED` with nothing else
   wrong is the forge waiting on required checks/reviews, not a conflict — proceed.
3. **Convert draft to ready, if needed (AC2).** When `isDraft`, run `_shared/pr-first-merge.md`'s
   Step 2 (Mark ready) now, before the confirmation gate — the gate's own question states the PR's
   current state, and "still draft" would already be stale by the time a human reads it otherwise.
   Step 1 (Acceptance labeling) needs no separate run here: a `pending-review` PR only exists
   because `/wrap-up`'s own Phase 4 execution already ran it for every member before the group
   could reach the Review Console at all (same precondition `actions-github-issues.md`'s `## Arm
   ready PR` action states for its own already-green candidates).
4. **Confirmation gate.** Read `close-out-confirmation.md` in this skill's directory and follow it
   (AC4). Declining stops here — the PR stays `pending-review` exactly as it was, and nothing below
   runs for this candidate.
5. **On confirmation — merge.** Run `_shared/pr-first-merge.md`'s Step 3 (Attempt auto-merge)
   directly against this PR — the second call site reaching Step 3 from outside a build or dispatch
   pipeline (the first is `actions-github-issues.md`'s `## Arm ready PR`), reusing that file's full
   degrade chain (`--auto` arm → immediate merge where auto-merge isn't enabled → ready-and-comment
   on any other failure) rather than reimplementing it. Report the outcome (`armed`/`merged`) using
   that same vocabulary.
6. **Deploy, when the project has one (AC4).** When this project's CLAUDE.md Commands section
   documents a deploy command and step 5 reported `merged`, run it now and log the command, exit
   code, and one-line outcome — never invented when the project documents none, and never itself
   covered by the confirmation gate above (a project whose deploy step needs its own confirmation
   should say so in its own docs; this mode does not add a second gate on top of step 4's).
7. **On `merged` — release the claim and clean up.** Reuse
   `wrap-up/cleanup-procedures-execution.md` Section E (claim release, `bot:in-progress` removal)
   and Section B (run-dir archival) exactly as they are cited elsewhere in this skill — never
   hand-roll the bookkeeping a canonical procedure already owns. Worktree removal (Section C, if
   the run's worktree still exists) defers to the reconciler on merged-PR evidence, the same
   outcome-independent convergence every other merge path in this skill already relies on
   (`settle-and-merge.md`'s worktree constraint) — this mode never runs `EnterWorktree` or
   `git worktree remove` itself. On `armed`, none of Sections B/C/E run yet — same as every other
   `armed` outcome in this skill, they wait for `merged` evidence.

## Reporting

One line per candidate: `#{number} — {outcome}` where `{outcome}` is one of `merged`, `armed`,
`stopped: CI {status}`, `stopped: mergeStateStatus DIRTY — rebase and re-verify first`, or
`declined at confirmation gate`. The bare form's summary line names how many candidates were
found, merged/armed, stopped, and declined. This mode is never headless-self-reporting like bare
`/dispatch`'s own Preflight failures (`_shared/headless-self-report.md`) — its confirmation gate
(step 4) requires a human present by construction (`close-out-confirmation.md`'s no-carve-out
note), so a Routine-fired invocation with nobody present would simply stall at the first candidate
reaching that gate; do not schedule `close-out` as a headless Routine for that reason.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|---------------|
| Rebasing a `DIRTY` candidate to clear it automatically | Changes PR content without the author present — flag-only holds at close-out time exactly as it does at `_shared/github-pr-scan.md` item 11's discovery time (AC3) |
| Merging on a cached/prior CI result | The whole reason this mode exists — a `pending-review` PR can sit for weeks; step 1 always re-reads live state (AC1) |
| Silencing the confirmation gate under `unattended` | No `autonomy`-ceiling carve-out — see `close-out-confirmation.md`; a `pending-review` PR reaching this mode means nothing upstream has yet authorized this specific merge |
| Batching multiple candidates' confirmations into one `AskUserQuestion` | Each PR is a distinct merge decision on distinct content — batching would misattribute one answer to every candidate |
