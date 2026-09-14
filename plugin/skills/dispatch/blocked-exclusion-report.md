# Dispatch Step 3 — Blocked-Exclusion Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited immediately after the zero-eligible-groups
case (refs #1101).

Read this run's session-scoped `dispatch-blocked-excluded.json` (`queue-pull-script.md`'s own
output, `{number, blockedBy: [ids]}[]`) — every otherwise-`auto:build`-eligible candidate the
queue pull dropped for an open blocked-by dependency, whether via a body-text `Blocked by #N`
line or (`work-links: native`) a native `blockedBy` link. When non-empty, render one line before
the rest of this step's own output:

`{n} excluded — blocked by an open dependency: #{a} (blocked by #{x}), #{b} (blocked by #{y}, #{z})`

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
