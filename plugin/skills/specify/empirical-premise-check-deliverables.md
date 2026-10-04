# Empirical Premise-Check Deliverables

Referenced from `spec-template.md`'s Empirical Premise-Check Deliverables pointer, in this skill's
directory (#2841's split). Read it when a record's technical approach rests on an assumption about
how an external system, harness, tool, or third-party CLI/API actually behaves, when the spec
carries any flagged-but-unvalidated assumption, or when a deliverable adds new binding skill prose
to a review/build gate. "This section"
below means that `spec-template.md` section, which this file carries in full.

When a spec's technical approach rests on an assumption about how an external system, harness, or tool actually behaves — an undocumented payload shape, an unconfirmed API contract, an assumed invocation path — write a blocking first deliverable ("Task 0") that captures the real behavior before any other deliverable's fixtures are written. Word its scope as an enumeration, not a single check, and cover every path that reaches the feature, not just every shape the resulting payload can take:

- **Who initiates it** — a person typing the trigger directly (a slash command, a manual action), the model invoking it as part of its own reasoning, a Task-dispatched subagent invoking it on the model's behalf, and a headless/non-interactive run (`claude -p`, a scheduled Routine) invoking it with no one watching. These are different code paths through the harness and can diverge in whether an event fires at all, not just in what it contains.
- **Every shape the payload can take once it does fire** — qualified vs. bare identifiers, success vs. failure, nested vs. top-level invocation.

Enumerating only the second list and skipping the first is the failure mode to design against: it reads as thorough (every input shape is covered) while silently leaving out an entire initiation path that never produces an event to shape-check in the first place — a gap no fixture built from the captured shapes can catch, because the missing case never got captured. Name each initiator path explicitly in the Task 0 deliverable's own text; do not let "covers all invocation shapes" stand in for it.

A Task 0 deliverable's captured behavior — or any other flagged-but-unvalidated assumption in this
spec's `## Gotchas` section, an inline `<!-- ambiguity: -->` marker, or an `## Open Questions` row —
is not fully resolved just because implementation happened. `skills/review/code-mode-steps.md`
Step 1's **Risk-Marker Verification** sub-check independently re-checks every such marker against
the artifact's real external validator/schema/tool at whole-branch review time, and routes an
unresolved one to `BLOCKED` — the review-side half of the same rule this section states from the
spec-authoring side.

**Plan-authoring corollary.** When a deliverable itself adds new *binding* skill prose to a
review/build gate — a Gate-table row, a forced-disposition instruction, not merely descriptive
prose — include a deliverable that pins it with a conformance test (`skill-prose-conformance-tests`'
"documented convention this project wants enforced against every future addition" case), the same
way a code path earns regression coverage. A plan that adds a Gate-table row with no test task is
the same brief-compliance gap this section already exists to close, one layer further in.

### Third-Party CLI/API Behavior Task 0

When the premise being checked is specifically how a **third-party CLI or API** behaves — not this project's own harness — name a blocking empirical Task 0 as a deliberate option rather than letting it get rediscovered per-record. Its three constituent parts, all required:

- **Safe probe target** — a throwaway/disposable target the probe can act against without touching real state (a scratch repo, an unprotected test branch, a sandboxed resource) — never the project's own production data or an artifact anyone else depends on.
- **Mandatory teardown** — the Task 0 deliverable itself includes tearing the probe target back down, unconditionally, whether the probe confirmed or reversed the assumed premise.
- **Literal-capture rule** — record the actually-observed behavior verbatim (the exact output, timing, or status — not a paraphrase) in the spec's `## Gotchas` or `## Technical Approach`, so a later reader can check the captured fact rather than re-trust the original assumption.

Example: #560's Task 0 probed `gh pr merge --auto`'s actual merge timing against a throwaway PR opened on a disposable base branch, tore that branch down unconditionally after capturing the result, and recorded the literal observed behavior — which reversed the plan's assumed premise (`gh pr merge --auto` does not wait for anything on an unprotected repo; it merges immediately) before any other deliverable's fixtures were written.
