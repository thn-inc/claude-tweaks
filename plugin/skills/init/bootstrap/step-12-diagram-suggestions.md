# Step 12 — Diagram Suggestions

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

claude-tweaks ships a native diagram-generation skill, `/claude-tweaks:visualize` — no install step, nothing external to set up. Soft-hook nudges in `/journeys`, `/specify`, and `/review` surface "consider a diagram here" recommendations when a journey, spec, or review finding describes flows or structures that benefit from a visual.

This recommendation is **offered for every project** — architecture, ER, sequence, and state diagrams help backend and infra specs equally, the same as frontend ones.

**Call `AskUserQuestion`:**

- `question`: `"Enable diagram suggestions? /journeys, /specify, and /review can suggest generating a themed diagram (via /claude-tweaks:visualize, a native skill — nothing to install) when they detect a state machine, data model, multi-actor flow, decision tree, or layered architecture."`, `header`: `"Diagram suggestions"`, `multiSelect`: `false`
- Option 1 — `label`: `"Enable (Recommended)"`, `description`: `"Writes diagram-suggestions: enabled."`
- Option 2 — `label`: `"Skip"`, `description`: `"Writes diagram-suggestions: disabled (silences future nudges)."`

**Write the flag to CLAUDE.md.** Extend (or create) the existing `## Design integration` section with a second line:

```markdown
## Design integration

design-integration: enabled
diagram-suggestions: enabled
```

Use the appropriate value:

| Choice | Flag value |
|--------|-----------|
| Option 1 (Enable) | `enabled` |
| Option 2 (Skip) | `disabled` |

The soft-hook nudges in `/journeys`, `/specify`, and `/review` read this flag and short-circuit when set to `disabled` (or absent). Missing flag is treated identically to `disabled`.

**Re-run behavior:** When `/init` is re-run on a project where `diagram-suggestions: enabled`, this step is a no-op. When the flag is `disabled`, offer the upgrade path back to `enabled`. When the flag is **missing** — including on a project whose CLAUDE.md still has a pre-visualize `diagram-integration:` line, which nothing reads anymore — present the first-run prompt, same as a fresh init.
