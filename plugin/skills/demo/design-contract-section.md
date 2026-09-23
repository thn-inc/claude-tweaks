# Demo Step 2 — The Design Contract Section

Referenced by `skills/demo/SKILL.md` Step 2's `### The design contract this was built against`
subsection. Read only after `../_shared/design-contract.md`'s locate-and-parse procedure has run
over Step 1's changed-path list **and** it resolved a contract or reported one malformed — when
nothing resolves, `SKILL.md` renders nothing and never reads this file. In the body below, "this
heading" means `SKILL.md`'s `### The design contract this was built against`, and `### What
shipped` is the brief section `SKILL.md` Step 2 already rendered.

Design work built through Impeccable carries a **direction contract** in the opening comment of the
artifact it produced — five blocks, written *before* the code. That is the one thing an acceptance
gate cannot reconstruct afterward: once the artifact exists, the intent behind it is only inferable
from the result, which is circular. Surfacing it here is what lets a human answer "is this what it
was trying to be?" instead of only "does this look fine?".

**When a contract resolves,** render this section under exactly this heading, above the verdict
question, with the five blocks reproduced **verbatim** — never summarized, re-worded, or reordered.
Introduce it as *what this was promising to be*, and make the direction of the check explicit: the
human is comparing the result against a promise made beforehand, not reading a description of what
shipped. `### What shipped` already covers the latter, and collapsing the two wastes the only
section here that carries pre-build intent.

Then a `Design-seed:` line, when there is one — the record body's own `Design-seed:` metadata line
(fetched with the record in Step 1) if present, otherwise the seed the parse just read out of the
artifact. If both exist and disagree, render the artifact's and say in one line that the record's
differs, which means the artifact was rebuilt on a different roll after the record was stamped.
Omit the line entirely when neither source has one — upstream carries a seed key only *"when the
seed dealt stagings,"* so a contract without one is complete, not truncated.

**The malformed case is the one exception, and only barely.** The section is still omitted entirely
— never a heading with only the blocks that parsed, since a half-rendered contract reads as complete
— but that procedure requires the downgrade leave a trace, and `/claude-tweaks:demo` is standalone-only, so there
is no `$PIPELINE_RUN_DIR` and no `decisions.md` to write it to. Say it instead in **one plain line**
above the verdict, naming the file and which labels were found. Without it, an upstream block rename
is indistinguishable from a record that simply never had a contract — which is exactly the silent
failure the drift assertions in `tools/upstream-drift/manifest.yml` exist to catch, and this line is
what makes it visible to the one human already looking at this build.

This section never becomes a reason to block, and it is never audited here. Whether the render
actually honors the contract is `impeccable-finish-reviewer`'s job upstream — this skill puts the
promise in front of a human and asks them.
