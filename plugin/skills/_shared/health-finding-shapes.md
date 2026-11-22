# Health Finding Shapes — Canonical Type-Expression and Bundling-Rule Shape

`code-health`, `harness-health`, `docs-health`, and `journey-health` each apply two shapes before
filing: a **type expression branch** (deciding native Issue Type vs. a `type:*` label) and a
**bundling rule** (consolidating a recurring root cause into one finding instead of one per
occurrence). Both are hand-duplicated across the four skills' own EMIT/FILE steps, worded against
each skill's own finding schema. This file is the one place the *shape* of both is defined, so a
fix to one skill's copy (a new `work-types` value, a tightened bundling condition) can be checked
against the same canonical shape in the other three. Per this project's own self-contained-skill-
file convention, each consumer still writes out its own version in full inline — this file is the
reference the four copies are kept in sync against, not a replacement for any of them.
`ci-health` carries a fifth copy of the type expression branch only (always `task`) and no
bundling rule, since its checklist allows one finding per subject per check — check its copy too
whenever the branch changes.

## Type expression branch

Read the project's `work-types` config key once before filing and branch — never re-probe
mid-flow (`_shared/work-record.md`'s config-key table; the key is written by `/init`).
`work-types: native` applies the payload's type via GitHub's native Issue Type;
`work-types: labels` adds the matching `type:*` label instead (the pairs live in `record.js`'s
`TYPE_LABELS`). Apply the same branch to every payload regardless of criterion/category — only
the `--type <x>` vs. `--label type:<x>` mechanics change; the rest of the `gh issue create`
invocation never does. Three of the four skills (`code-health`, `harness-health`, `docs-health`)
always emit a single fixed type (`task`); `journey-health` is the one skill whose type varies per
finding (`bug` for a suspected regression, `task` for drift/coverage) — that variation is its own
schema's business, not a difference in the branch's shape.

## Bundling rule (recurring root causes)

When two or more findings within the same firing share both the same category-like field (each
skill's own `criterion`/`category`) and the same root-cause explanation, file **one** finding, not
one per occurrence. Pick the clearest/most representative occurrence as the primary
anchor/section; list every other occurrence in the schema's `relatedAnchors`/`relatedSections`
field; make the evidence/reason field enumerate or state the shared root cause covering all of
them; make the acceptance/description field require every listed occurrence fixed, not just the
primary one. Only bundle occurrences that share both the category-like field AND the root cause —
never bundle unrelated findings together just because they're nearby. Each skill's own bundling
key and scope is its own business (e.g. `journey-health` only bundles `category: "coverage"`
findings within one coverage-scan firing; `harness-health` excludes `kind: "new-skill"`
candidates, which have no section to bundle by) — only the consolidation *shape* above is shared.

## Keeping the four copies in sync

Every one of the four skills' own EMIT/FILE steps carries both shapes, worded against its own
finding schema. When one skill's copy changes, check the other three against this file's
canonical shape rather than assuming the change was skill-specific.
