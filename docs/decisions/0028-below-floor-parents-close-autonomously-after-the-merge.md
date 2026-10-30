# 0028. Below-floor decomposition parents close autonomously, only after the last merge lands

- **Status:** accepted
- **Date:** 2026-10-30
- **Context:** #4466 (PR #4562)

## Context

The Parent-Gate Procedure (`plugin/skills/wrap-up/verification-brief-parent-gate.md`) said
that when a decomposition's last sub-issue closed below the oversight floor (`exceeds: false`),
"the parent closes cleanly". No step actually closed it. `/claude-tweaks:demo`'s Approve action was
the only code path that closed a parent, and a below-floor parent never gets a demo gate. Tidy's
`parent-gate` scope also filtered below-floor parents out, so nothing surfaced them either. The
parents stayed open forever.

Closing the parent automatically ran into `plugin/skills/_shared/auto-mode-contract.md`. Its
Never-reversible list puts "Closing or deleting work records" out of reach of `auto` in every mode,
and "Network calls beyond reads" is on the same list. Before this change, no record close had ever
been exempted from that list.

## Decision

Make one narrow exception to the never-silenced record-close rule. The Parent-Gate Procedure's
**Close the parent below the floor** runs without a human, but only from a sub-issue-side entry:

- Under `work-backend: github-issues`, the entry is `_shared/pr-first-merge-post-merge.md` Step 4.0b.
  It runs only after the merge has landed, and only when that merge landed on the repo's default
  branch. The six merge paths share this one step.
- Under `local-files`, the entries are wrap-up's execution step, the auto-merge short-circuit and
  dispatch's group auto-merge gate. Each one writes the close in-branch, in the same commit as the
  sub-issue's own close, so it reaches the integration branch only with the merge.

The close makes two writes: a `## Closed below the oversight floor` comment (a body section under
`local-files`) and the close itself. Its restore contract is what clears the Reversibility floor's
`high` for this one write. The pipeline never restores the parent itself. Under `github-issues`, a
human runs `gh issue reopen {parent}` and the comment stays as the audit trail. Under `local-files`,
a human clears the parent record's `closed`/`closedAt` facets and commits.

`/claude-tweaks:tidy`'s parent-side `Open parent gate` runs the same section but is not covered by
the exception, so it stays a staged tidy action. Tidy's `parent-gate` scope now emits a stranded
below-floor parent as a row instead of filtering it out. It acts as the backstop for any parent the
post-merge step misses, such as an armed PR that GitHub merges after the session has ended.

## Alternatives considered

- **Keep every parent close staged for a human.** This leaves the contract untouched. It was
  rejected because stranded parents were the bug: a below-floor decomposition is by definition
  work nobody needs to look at again, so a staged close only moves the stranding to an approval
  queue.
- **Close at the pre-merge callers** (wrap-up Phase 4, the auto-merge short-circuit, dispatch's
  group auto-merge gate). The user rejected this at plan review. Those callers treat the in-run
  sub-issue as closed before its merge lands, so the parent would close ahead of a merge that might
  never happen. Doing it there would also require a reopen path that the post-merge timing avoids
  entirely.
- **Let tidy's parent-side close run autonomously too.** Not adopted. The tidy backstop can fire
  long after the last merge, with no delivering run behind it. Tidy's actions are an approved batch
  anyway, so a human already sees that close.

## Consequences

- A decomposition below the floor now finishes on its own. The parent's comment lists each
  sub-issue and the PR that closed it.
- The never-silenced list now has one record-close exception. Any future proposal to auto-close
  records should be held to this one's bar: a narrow entry point, a post-merge trigger and a stated
  human restore contract. The fact that this exception exists does not justify widening it.
- A merge into a branch other than the default one, or a merge that no session sees land, leaves
  the parent open. Recovering it is tidy's job.
- Revisit this decision if `closedByPullRequestsReferences` or the default-branch-only closing
  behaviour of `Fixes #N` changes on GitHub. Also revisit it if the Parent-Gate evaluation moves
  into a tested CLI (the run's reflect proposal), which would change where the exception's guard
  lives.
