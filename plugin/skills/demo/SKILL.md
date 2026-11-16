---
name: demo
description: Use when invoked as /demo — a deprecated alias that forwards to /claude-tweaks:accept. Keywords - demo, acceptance, sign-off, deprecated alias.
argument-hint: "[#N[,#M...]]"
---

# Demo — Deprecated Alias

Lifecycle: utility — forwards to `/claude-tweaks:accept`.

## When to Use

- Only when invoked as `/claude-tweaks:demo`; new invocations use `/claude-tweaks:accept`.

## Input

`$ARGUMENTS` is parsed as `[#N[,#M...]]` and forwarded unchanged.

## Step 1: Forward

Invoke `/claude-tweaks:accept` with the same `$ARGUMENTS`.

## Next Actions

`/claude-tweaks:accept` renders its own Next Actions block; this alias adds none.

## Component-Skill Contract

`/claude-tweaks:demo` is a **standalone-only** alias — it is never invoked by a parent skill.
There is no `PIPELINE_RUN_DIR` signal to check.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Adding acceptance logic here | This file only forwards; the procedure lives in `/claude-tweaks:accept` |
