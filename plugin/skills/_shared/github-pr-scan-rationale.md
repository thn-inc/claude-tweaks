# GitHub PR Scan — Rationale Appendix

Cited from `_shared/github-pr-scan.md`; holds the why behind rules stated there, never a rule an agent must follow.

## Item 1 — the awaiting-review row carries a command

but "informational" describes the *severity*, not whether the row carries a command: the trailing `gh pr view {n} --web` is what a human runs to actually look at the PR, and its absence was a confirmed gap (a bare summary sentence with zero per-PR follow-up), not a deliberate no-command finding.

## Item 9 — the `bot:blocked`/`bot:parked` exclusion

The `bot:blocked`/`bot:parked` exclusion is what keeps this sweep from un-parking a parked run: a record carries `bot:blocked` because dispatch hit its retry ceiling, or `bot:parked` because `_shared/pr-first-merge.md`'s Step 2.5 (Merge-verification gate) took the red path, and both mean a human owes a re-triage before anything arms that PR — a later-green rollup does not retract the park.

## Item 9 — the `allow_auto_merge` state on every row

(`ALLOW_AUTO_MERGE`, read once above via `gh api repos/{owner}/{repo} -q .allow_auto_merge`) whenever it's `false`, so a recommendation to "arm" never implies a live `--auto` arm will succeed on a repo where it can't — the degrade path still applies.

## Item 11 — flag-only, never auto-rebase

The lower-risk default consistent with this scope's report-only posture (`/tidy`'s documented posture for most of its scans) — an unattended rebase changes PR content without the PR author present and would need the same unconditional-at-every-`autonomy`-tier confirmation gate `dispatch/resume-confirmation.md` already establishes elsewhere in this codebase, not a weaker one just because it's a background sweep. This check's job is detection only: it feeds a human, or #2364's own close-out process, which already reuses `assess-agent-autonomy`'s `merge-check` and `_shared/pr-first-merge.md` for the approved-and-ready case and, with the human present, may offer a re-verified update (`dispatch/close-out-update.md`) — this check never re-implements that merge path or performs that update.

## Anti-pattern — a self-scheduled per-PR check-in loop

GitHub's own `--auto` merges the moment checks pass, with no session watching, and this scheduled sweep catches the cases `--auto` alone can't: unarmed PRs and unsettled claims — neither depends on any session surviving. A per-PR loop dies with the session that started it and duplicates what the sweep already covers on a schedule nothing has to remember to run.
