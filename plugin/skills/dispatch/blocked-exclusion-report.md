# Dispatch Step 3 — Blocked-Exclusion Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited immediately after the zero-eligible-groups
case (refs #1101).

Read this run's session-scoped `dispatch-exclusions.json` (`queue-pull-script.md`'s own output,
`bin/lib/dispatch/exclusions.js`'s `readExclusions`), filtered to `reason: 'blocked'` entries
(`records: [number], detail: {blockedBy: [ids]}` each) — every otherwise-`auto:build`-eligible
candidate the queue pull dropped for an open blocked-by dependency, whether via a body-text
`Blocked by #N` line or (`work-links: native`) a native `blockedBy` link. When non-empty, render
one line before the rest of this step's own output:

`{n} excluded — blocked by an open dependency: #{a} (blocked by #{x}), #{b} (blocked by #{y}, #{z})`

A `blockedBy` entry that is a string — `owner/name#N`, a blocker linked natively or declared by a
`Blocked by owner/name#N` line, optionally suffixed ` (state unreadable)` when its state could not be read (#4793) —
renders verbatim, never with a `#` prefix; a number renders as `#N`. The string
`native blockers (state unreadable)` (#5309) is not a dependency: it marks a record excluded
because the `work-links: native` blockers query failed and the pull failed closed. It renders
verbatim too, so the line names the failed query rather than an open dependency for that record.
A `Blocked by: {part} (left for owner/name)` line excludes the record under either `work-links` value
and renders verbatim as `{part} (left for owner/name)` (#6374): it has no issue and no state, so it
is never looked up and never suffixed.

Then read the same file's `reason: 'target-missing'` entries (`records: [number], detail: {path}`
each, #1983 — `queue-pull-script.md` names this report as their reader) and render one line per
record, under the same exception and empty-array rules below:

`#{number} excluded — named target {path} no longer exists at the integration tip (Close proposal staged)`

Then read the same file's `reason: 'unlanded-blocker'` entries (`records: [number], detail:
{blockers: [{blocker, commit}]}` each, #4792 — `queue-pull-script.md`'s unlanded-blocker pass) and
render one line per record, under the same exception and empty-array rules below:

`#{number} excluded — blocker not landed: #{blocker} (closing commit {commit}), … — eligible again once it reaches the integration branch`

An entry whose blocker carries `verdict: 'hollow'` (`{blocker, commit, verdict, pr}`; `bin/dispatch-unlanded-blockers.js` prints the same wording) renders instead `#{number} waits — blocker #{blocker} was closed by #{pr} with no implementation`; with `pr: null`, `closed by {commit}` in place of `#{pr}`. A mixed record (one exclusion whose `detail.blockers` holds both) renders one line, opening `excluded — blocker not landed:` (the unlanded line's), naming every blocker in `detail.blockers` order, each clause in its own verdict's wording (a hollow one: `#{blocker} was closed by #{pr} with no implementation`).

Then its `reason: 'malformed-blocker'` entries (`records: [number], detail: {cause}` each, #4792 —
the same pass, or the eligibility step for non-array labels, #5315), one line per record, under the same rules. An entry
whose cause is `its labels are not an array` names its labels instead, since no blocker declaration is at fault:
`#{number} excluded — its labels are not an array — eligible again once its labels are an array`. Every other entry:

`#{number} excluded — malformed blocker declaration: {cause} — eligible again once its blocker declaration can be checked`

**Exception — the headless drain steady state.** When this is drain (or `next`) and the
zero-eligible-groups case (`SKILL.md` Step 3) applies, render nothing here either, same as that
case's rule — a persistently-blocked queue must not turn an intended-silent Routine firing into
noise. Every other case (`#N`/`#N,#M,...`, or drain/`next` with at least one eligible group)
renders normally. Render nothing at all when the exclusion array is empty, the same
no-line-when-clean convention this skill already follows elsewhere.

A two-member dependency cycle needs no special detection: each member independently fails the
same open-blocker check the other does, so both appear here, each naming the other. This is where
the visibility `/claude-tweaks:backlog overview`'s now-retired per-record Dispatch paste block
used to carry directly disappeared to — this report is its replacement, at the one place blockers
are actually evaluated.
