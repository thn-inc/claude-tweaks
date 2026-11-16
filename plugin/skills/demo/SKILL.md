---
name: demo
description: Use only when invoked as /demo — a deprecated alias for /claude-tweaks:accept that prints one notice and forwards. Keywords - demo, acceptance, sign-off, deprecated alias.
argument-hint: "[#N[,#M...]]"
---

# Demo — Alias of Accept (deprecated)

Lifecycle: utility — forwards to `/claude-tweaks:accept`. The removal condition is recorded in `deprecated-aliases.md`.

## When to Use

- Only when invoked as `/claude-tweaks:demo` from old muscle memory; new invocations use `/claude-tweaks:accept`.

## Input

`$ARGUMENTS` is parsed as `[#N[,#M...]]` (or empty) and forwarded unchanged — a `#N,#M` list stays a list, in the same order.

## Step 1: Notice

Print exactly one warn-tier notice, once per invocation, with this text:

```text
Deprecated: /claude-tweaks:demo is now /claude-tweaks:accept. `/demo` may be removed when all three hold, checked at each minor release: (a) `grep -rFn "claude-tweaks:demo" plugin docs README.md` finds no match outside the alias stub, the alias doc, `docs/incident-log.md`, `docs/decisions/` and `docs/plans/`; (b) at least two minor releases (versions of `plugin/.claude-plugin/plugin.json`) have shipped after the release containing this change; (c) the maintainer has confirmed Dispatch emits `accept:*` labels.
```

## Step 2: Forward

Invoke `/claude-tweaks:accept` via the Skill tool with the same `$ARGUMENTS`, unchanged.

This alias never renders a `## Next Actions` block — `/claude-tweaks:accept` renders its own.

## Component-Skill Contract

`/claude-tweaks:demo` is a **standalone-only** alias — it is never invoked by a parent skill, so there is no `PIPELINE_RUN_DIR` signal to check.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Printing the notice twice, or reimplementing acceptance logic here | The user sees one notice per invocation; the procedure lives only in `/claude-tweaks:accept`, so a copy here drifts from it |
