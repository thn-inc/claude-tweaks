# Native `/design` vs. Impeccable — comparison and routing decision

Decision record for #2690. Read this if revisiting whether `design-wrapper` should route
any mode to Anthropic's native `/design` skill instead of (or alongside) Impeccable.

## What this record asked

Anthropic (via the official ClaudeDevs account) announced a native `/design` skill
(research preview) with an artboard workflow built on artifacts. The record asked: try it
on a sample UI task, compare its output/workflow against Impeccable's, and decide whether
`design-wrapper` should route artboard-style exploration to it while keeping Impeccable for
deeper critique/audit passes, or stay Impeccable-only.

## What was actually verified

A side-by-side output comparison was **not possible** in this environment, and this note
does not fabricate one. What was verified directly, live, in the environment this record
was built in:

A skill literally named `design` **is** registered in the Claude Code skill registry here.
Invoking it via the Skill tool (the only mechanism an agent has to invoke a skill) returns:

> Skill design cannot be used with Skill tool due to disable-model-invocation. Ask the user
> to run /design themselves — it cannot be invoked via the Skill tool. Do not replicate this
> skill's workflow by other means — it is reserved for explicit user invocation.

This is categorically different from "unknown skill" (which is what an unregistered name
returns). The skill exists, but is deliberately scoped **out** of any agent- or
model-driven invocation path. Only an interactively-typed `/design` command, typed by a
human in their own session, can run it.

## Why this settles the routing question without a feature comparison

`design-wrapper` exists to be invoked *by other skills* — every one of its callers
(`/build`, `/flow`, `/test`, `/review`, `/visual-review`, `/specify`, `/tidy`) dispatches it
programmatically, with no human in the loop at the point of dispatch. That is the entire
reason the wrapper exists (see `SKILL.md`'s opening line). A skill that refuses invocation
by anything other than a human typing the command directly cannot be a dispatch target for
a wrapper whose only callers are agents. This holds regardless of how good native `/design`'s
artboard workflow turns out to be — the mismatch is structural (who is allowed to invoke it),
not qualitative (how good its output is), so no amount of output quality on either side
changes the answer.

## Decision

**Stay Impeccable-only.** No routing change is made to `design-wrapper`. This is not a
judgment that native `/design` is worse than Impeccable — no such judgment could be made
from this environment, since the native skill could not be exercised at all. It is a
judgment that an agent-invoked wrapper cannot route to a human-invocation-only skill.

## Maturity note

Native `/design` is explicitly a research preview, per the record's own Gotchas. Even
setting aside the invocation restriction, a routing decision based on a preview feature
would need revisiting as it matures. The invocation restriction is the more immediate and
more structural blocker of the two, and is the one this note is based on.

## Revisit when

- The model-invocation restriction on the native `/design` skill is lifted (a future harness
  or CLI release that permits non-interactive, subagent, or programmatic invocation), **or**
- A human manually runs `/design` on a representative UI task in an interactive session and
  shares the real output/workflow for comparison against Impeccable's `review`/`polish`/
  `survey` modes — at that point a genuine side-by-side becomes possible and this decision
  should be re-opened with real evidence instead of a structural argument.

Until one of those holds, re-running this same probe will reproduce the same
`disable-model-invocation` result, and the structural argument above still applies.
