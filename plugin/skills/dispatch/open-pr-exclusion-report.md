# Dispatch Step 3 — Open-PR Exclusion Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited immediately after the Blocked-exclusion
report (refs #1224).

Read `dispatch-open-pr-excluded.json` (`queue-pull-script.md`'s output, `{number, pr}[]`) —
every otherwise-`auto:build`-eligible candidate the queue pull dropped because it already has
an open, unmerged PR that will close it (GitHub's own `closedByPullRequestsReferences`
connection). Non-empty: render one line alongside the Blocked-exclusion line, same position:

`{n} excluded — already has an open PR: #{a} (PR #{x}), #{b} (PR #{y})`

Same drain+zero-eligible silence exception as the Blocked-exclusion report (`SKILL.md` Step 3);
omit when empty. This exclusion is computed once, unconditionally, inside `queue-pull-script.md`'s
own run — by the time any selection form (bare, `next`, `#N`, `#N,#M,...`) reads
`dispatch-groups.json`, an excluded candidate is already absent from it. `#N`/`#N,#M,...`'s own
re-verification against Step 2's live queue catches the absence, then reads this same
`dispatch-open-pr-excluded.json` to report the specific reason (`SKILL.md`'s `#N` / `#N,#M,...`
bullets, refs #1973) instead of a generic not-found.
