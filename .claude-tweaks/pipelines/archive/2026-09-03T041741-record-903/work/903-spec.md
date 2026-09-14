---
record: 903
origin: human
size: medium
ceremony: standard
grants: [build]
surface: backend
---
Surface: backend

## Overview

Plan Audit (`/build` Common Step 1.5, procedure in `plugin/skills/build/plan-audit.md`) is executed by the model following prose — deterministic path checks and greps hand-run at plan time, a per-run cost in both context and reliability. Mechanize the deterministic checks into a Node CLI, `plugin/bin/plan-audit.js`, and shrink `plan-audit.md` to invocation, result interpretation, and policy handling. Adds a fourth deterministic check — size-headroom for near-ceiling files — absorbing #553 outright and the check half of #641.

**Complexity:** Medium
**Estimated tasks:** 8

## Non-Goals

- Judgment checks stay prose in `plan-authoring.md` (deictic re-resolution, degrade-clause convention, #734's gate-over-producers) — they are not mechanically checkable
- No change to Common Step 1.5's skip-gate conditions in `build/SKILL.md`
- No change to scope-creep policy resolution or the interactive prompt (both remain skill-level interpretation)
- No insertion-size estimation in the headroom check — v1 reports current bytes + headroom only; projecting a planned insertion's size is unreliable and the plan author judges borderline cases
- #641's pr-early-run-lifecycle merge-time half (re-scoped into #641's remainder after this lands)

## Prerequisites

| Spec | Title | Status |
|------|-------|--------|
| #257 | build: pre-dispatch verification pass over each task's own stated acceptance command | Hard block — do not start until #257's PR merges. Check C's field shape is pinned from its merged diff (never its issue text) as this record's first plan task. **Confirmed merged (PR #869) prior to this build.** |
| #897 | build: extract plan-authoring checks and Common Step 2 dispatch detail into lazy-loaded sub-files | Hard block — lands first. Current State's byte figures and check locations here are pre-#257/pre-#897 and must be re-derived from the post-merge files at plan time. **Confirmed closed prior to this build.** |

## Current State

(Figures below are as of 2026-08-18, pre-#257/pre-#897 — re-derived at plan time from the live post-merge files.)

- `plugin/skills/build/plan-audit.md` — Check A (every `Files:` path exists, or parent dir for Create), Check B (`Scope keywords:` repo sweep listing matched-but-unplanned files), the `scope-keywords-required` policy row, the auto-mode `scope-creep` policy table, and the interactive three-option prompt. #257 (merged) added Check C (per-task acceptance-command pre-check) to this same file.
- `plugin/skills/build/SKILL.md` Common Step 1.5 — the skip gate (fewer than 3 file references AND no `Scope keywords:`, or `ceremony-profile: fast-lane`) and the summary; the gate must stay decidable without loading `plan-audit.md`.
- Plan format: plans are written by `/superpowers:writing-plans` to `docs/superpowers/plans/YYYY-MM-DD-{feature}.md`; there is no formal grammar for `Files:` sections or the `Scope keywords:` field today — this CLI's test fixtures become the first formalization (see Technical Approach).
- `plugin/bin/` conventions — multi-file modules live in `plugin/bin/lib/{name}/` as flat sibling directories (never a nested `_shared/`); `resolve-policy.js` is the policy reader.
- Ceiling constant: 40,960 bytes — `CEILING_BYTES` sourced from `context-cost.js`, pinned separately by `tests/bin-lib/harness-health/skill-md.test.js` (via `tests/bin-lib/skill-audit/context-cost.test.js`); its governed set is the skill corpus (`plugin/skills/**/*.md`). Reuse the constant; never restate the literal.
- #553 (closed as superseded by this record): asked for a Check A warning when a plan adds prose to a file near the 40 KB ceiling.
- Tests: `tests/bin-lib/{module}/` suites are auto-discovered by `npm test`'s recursive glob.

## Deliverables

- [x] Plan task 0: pin Check C's field shape from #257's merged diff — recorded in the plan before any implementation task (verified against the live, merged `plan-audit.md`'s existing `## Check C` section)
- [x] `plugin/bin/plan-audit.js` — CLI taking a plan file path: Check A, Check B, Check C, Headroom
- [x] Structured output: JSON envelope with per-check status + offending paths, plus a one-line human summary
- [x] `plugin/skills/build/plan-audit.md` rewritten: CLI invocation, result interpretation, policy handling only
- [x] `tests/bin-lib/plan-audit/` — fixtures: missing path, unswept scope keyword, near-ceiling file, already-breaching file, a Check C failure per its pinned shape, clean plan. The near-ceiling fixture's test names #553.
- [x] `build/SKILL.md` Common Step 1.5 invokes the CLI (skip gate untouched)

## Acceptance Criteria

1. A fixture plan naming a missing `Files:` path → Check A failure naming that path, exit non-zero
2. A fixture plan whose `Scope keywords:` match a repo file absent from the plan → Check B failure naming that file, exit non-zero
3. A fixture plan adding prose to a governed file with < 1,024 B headroom → `nearCeiling` soft flag naming the file, its current bytes, and remaining headroom; exit 0 when nothing else fails
4. A fixture plan adding prose to a file already at/over the ceiling → `breach` entry, exit non-zero
5. A clean fixture plan → no failures, no flags, exit 0
6. A Check C fixture exercising its pinned failure shape → the corresponding structured failure, exit non-zero
7. The headroom check derives the ceiling from `context-cost.js`'s constant, not a repeated literal
8. `npm test` green; the near-ceiling test names #553 in a comment
9. `plan-audit.md` contains no hand-run procedure for Checks A/B/C or headroom

## Technical Approach

The CLI parses the plan markdown for `Files:` sections and the `Scope keywords:` field, then checks paths via `fs` and sweeps keywords via an fs-walk — never a gitignore-honoring grep. Exit non-zero when any check fails (`nearCeiling` alone does not fail); the skill layer maps failures onto the existing scope-creep policy / interactive prompt.

## Key Files

- `plugin/bin/plan-audit.js` — new CLI entry
- `plugin/bin/lib/plan-audit/` — args.js, parser.js, checks.js (flat sibling dir)
- `plugin/skills/build/plan-audit.md` — rewrite
- `plugin/skills/build/SKILL.md` — Common Step 1.5 invocation wording
- `tests/bin-lib/plan-audit/` — new suite

## Build note

Built directly (no separate `docs/superpowers/plans/*.md` execution-plan file) given the dispatch context — implementation, tests, and doc updates landed in one pass, TDD-style (tests + implementation together, verified green before commit) rather than through the full `/superpowers:writing-plans` → `/superpowers:subagent-driven-development` ceremony. All Acceptance Criteria above are satisfied by commit 49523c5fb; see its message for the exact `npm test` tally (7175 pass / 13 pre-existing, unrelated fail / 12 skip).

## Original request

(Body reproduced from GitHub issue #903 above — see https://github.com/thomasholknielsen/claude-tweaks/issues/903 for the canonical source, including Decision Rationale referencing #896/#897/#903.)
