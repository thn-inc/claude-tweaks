# Claude's Native `/design` Skill vs. Impeccable — comparison and routing decision

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

`design-wrapper` exists to encapsulate Impeccable invocation for other skills and for
direct human invocation (see `SKILL.md`'s opening line and the full "When to Use" section
for the actual dispatch callers and human-typed commands). The key constraint is not
"agents vs. humans" — the wrapper itself is invoked by both (`/build`, `/flow`, `/test`,
`/review`, `/visual-review`, `/specify`, `/tidy` dispatch it programmatically; humans type
`/claude-tweaks:design-wrapper <mode> <target>` and `/claude-tweaks:design-wrapper explore`
directly). The constraint is *invocation mechanism*: the wrapper dispatches skills via the
Skill tool, and the native `/design` skill has been explicitly configured to refuse Skill
tool invocation. The wrapper's own dispatch logic (what it does when invoked, by agent or
human) is carried out by a model reading the skill's instructions and using the Skill tool
to call downstream skills. That dispatch path is blocked for native `/design`.

The only way to actually run native `/design` is for a human to type the `/design` command
directly themselves, outside of and independent from any `design-wrapper` dispatch — which
breaks `design-wrapper`'s return-value contract (every mode returns a structured result its
caller or the human consumes) and breaks `explore`'s lock-in mechanism (the wrapper's
`explore` mode reaches into Impeccable's own browser-based worlds tournament to compare
competing visual-identity directions; upstream's `document --seed` writes `DESIGN.md`
directly from the wrapper's tournament flow). A native `/design` invocation from outside
`design-wrapper` cannot feed results back into the wrapper's own contracts or state.

The mismatch is not "agent-only callers vs. human-only skill" — it's "a dispatch performed
via the Skill tool vs. a skill that refuses Skill-tool invocation entirely," which applies
equally whether design-wrapper was itself invoked by another skill or directly by a human
typing `/claude-tweaks:design-wrapper`. This holds regardless of how good native `/design`'s
artboard workflow turns out to be — the mismatch is structural (how invocation is routed),
not qualitative (how good its output is), so no amount of output quality on either side
changes the answer.

## Impeccable side: why it already covers the comparison dimension

Impeccable has the structural properties that native `/design` lacks and that a routing
decision depends on:

- **Programmatic invocation:** Impeccable's `/impeccable:impeccable` skill is callable via
  the Skill tool — that is the entire reason `design-wrapper` can wrap it. A human typing
  `/design` directly cannot work for callers that need a return value to consume.
- **Partially version-pinned where it matters most:** The wrapper verifies an exact
  plugin-version pin before dispatching Impeccable's bundled scripts (`doctor`, `explore`'s
  `concept-seed.mjs` and `document --seed`) and its CLI (`test` mode) — see `SKILL.md`'s
  Step 2 availability check. Its LLM-dispatched commands (`review`, `polish`, and others)
  are unpinned by design, same as any Skill-tool invocation. Native `/design` has no
  pinning story at all — it's an unversioned research preview.
- **Deterministic tooling:** Impeccable provides deterministic CLI commands (`test` mode —
  see `impeccable-cli.md`) and LLM-dispatched critique/audit/refinement (`review`, `polish`
  modes). The wrapper depends on this contract.
- **Browser-based worlds/layout tournament:** `design-wrapper`'s own `explore` mode —
  which deals competing directions via Impeccable's `concept-seed.mjs` and locks the pick
  through Impeccable's `document --seed` — offers the closest analog to native `/design`'s
  "artboard workflow built on artifacts". This browser-based visual-identity worlds
  tournament handles both genesis-moment direction pick and layout-variant comparison once
  a direction is locked, integrating the winner directly into the spec's own `DESIGN.md`
  and design history. This is the wrapper's actual competing feature against native
  `/design`'s artboard workflow, and it is already in production and pinned.

## Decision

**Stay Impeccable-only.** No routing change is made to `design-wrapper`. This is not a
judgment that native `/design` is worse than Impeccable — no such judgment could be made
from this environment, since the native skill could not be exercised at all. It is a
judgment that the Skill-tool invocation path (the only path `design-wrapper` has available)
cannot reach native `/design`, while Impeccable already covers the artboard-workflow
dimension via its own `explore` mode with full version pinning and state integration.

## Maturity note

Native `/design` is explicitly a research preview, per the record's own Gotchas. Even
setting aside the invocation restriction, a routing decision based on a preview feature
would need revisiting as it matures. The invocation restriction is the more immediate and
more structural blocker of the two, and is the one this note is based on.

## Revisit when

- The Skill-tool invocation restriction on the native `/design` skill is lifted (a future
  harness or Claude API release that permits Skill-tool invocation), **or**
- A human manually runs `/design` on a representative UI task in an interactive session and
  shares the real output/workflow for comparison against `design-wrapper`'s own `explore`,
  `review`, and `polish` modes — at that point a genuine side-by-side becomes possible and
  this decision should be re-opened with real evidence instead of a structural argument.

Until one of those holds, re-running this same probe will reproduce the same
`disable-model-invocation` result, and the structural argument above still applies.
