# Gate-Authoring Deliverables

Referenced from `spec-template.md`'s Gate-Authoring Deliverables pointer, in this skill's directory. Read it when a record's plan adds a new gate.

When a spec's plan adds a new gate — a PreToolUse/PostToolUse hook check, a permission rule, or a teardown/cleanup guard — write a plan-time deliverable that traces the gate's proposed condition against two enumerations before implementation begins, not after:

- **Every sanctioned caller of the operation being gated** — every documented or in-repo code path that legitimately invokes the operation the gate is about to restrict (a cleanup procedure, a companion skill's step, a CLI the operation is wrapped by).
- **Every non-destructive/safe mode of the gated tool or operation** — a flag or field value that makes an otherwise-gated call harmless (e.g. a read-only or `keep`-style mode).

For every item in both lists, check it against the proposed gate condition and confirm it is not denied.

Spec #373's plan skipped this trace, and its whole-branch review had to catch — after implementation — two collisions the enumeration above would have caught at plan time: the new teardown gate denied the plugin's own documented cleanup sequence (a sanctioned caller), and it separately denied a non-destructive mode of the gated tool that an earlier task in the same plan had already pinned. Both collisions are already fixed in the current codebase; this section exists so the trace happens while the plan is being written, not after review finds what it missed.
