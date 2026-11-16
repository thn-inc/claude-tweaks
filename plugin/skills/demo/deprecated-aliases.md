# Demo — Deprecated Alias Removal Conditions

Referenced by `skills/demo/SKILL.md`, the alias stub. `/demo` was renamed to `/accept` (refs
#4613) — this file holds the removal condition the stub's notice quotes. Mirrors
`skills/specify/deprecated-aliases.md`'s shape.

## `/demo` (deprecated alias for `/claude-tweaks:accept`)

Identical observable behavior to `/claude-tweaks:accept` invoked with the same arguments — same
entry paths, same packet handling, same `accept:*` labels — with one warn-tier deprecation notice
per invocation. Removal condition:

`/demo` may be removed when all three hold, checked at each minor release: (a) `grep -rFn "claude-tweaks:demo" plugin docs README.md` finds no match outside the alias stub, the alias doc, `docs/incident-log.md`, `docs/decisions/` and `docs/plans/`; (b) at least two minor releases (versions of `plugin/.claude-plugin/plugin.json`) have shipped after the release containing this change; (c) the maintainer has confirmed Dispatch emits `accept:*` labels.
