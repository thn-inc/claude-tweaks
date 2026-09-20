# 0017. The diff-facts model ceiling is a downward bound, never a risk signal

- **Status:** accepted
- **Date:** 2026-09-08
- **Context:** #1912; precedent — `review/review-effort-derivation.md`'s "Decision: no independent UI-surface risk signal" (#361)

## Context

`build/dispatch.md` resolves SDD's final whole-branch review via `resolve-profile.js capable`
unconditionally — a ~20-line, one-file diff (record #1535) got the same Opus review as a
multi-file change, and the actual review verdict was 4 Minor findings on a diff that small.
`resolve-profile.js` already resolves a requested profile against `model-ceiling`,
`frontier-run-cap`, and stance, but nothing about the diff itself. `bin/lib/dispatch/
ceremony-derive.js`'s `computeDiffFacts` (file count, impl/test/docs classification, total
lines) already exists for the same purpose `wrap-up/ceremony-derivation.md` puts it to:
narrowing ceremony from measured diff shape rather than record labels.

## Decision

`resolve-profile.js` accepts `--diff-facts <json>` (the `computeDiffFacts` shape). When the
requested profile is `capable`, no explicit `cliOverride` named a field, and the diff facts show
at most one implementation file and under 60 total lines, the resolver caps the result to
`standard` and names `source: 'diff-ceiling'`. This is wired into `build/dispatch.md`'s
whole-branch-review resolution (`bin/lib/model-profiles/profiles.js`'s new stage 8, after
session-failure avoidance). It never raises a tier, never applies to a `frontier` request
(the SDD frontier singleton is a distinct, unchanged judgment call), and never applies when an
explicit `cliOverride` already named a value — matching the `model-ceiling` stage's own
precedent for "an explicit ask always wins".

**Not wired into reflect.** #1912's Deliverables also named "wrap-up/SKILL.md's reflect
dispatch" as a second Capable-pinned site to bound. On inspection, reflect's full-mode
component-invoked path (the one `/claude-tweaks:wrap-up` actually uses) never calls
`resolve-profile.js` at all — `reflect/SKILL.md`'s Component-Skill Contract states, and
`tests/reflect-transcript-judge-prose.test.js` pins, that the component-invoked path runs the
lens procedure inline in the main thread with **no dispatch** (record #221's frontier singleton
is standalone-only). Wiring a diff-facts ceiling there would require converting that inline
path into an actual sub-dispatch — a materially larger, deliberately-scoped-differently change
than this record's stated size (`size:low`) — and would contradict the pinned "no dispatch"
invariant. Left as-is; a follow-up would need its own record if that architecture is revisited.

## Why this is a downward bound, not a risk signal (see #361)

`review/review-effort-derivation.md`'s #361 decision declined to let a diff *shape* signal
(UI-surface) raise review rigor, on the grounds that the layer meant to catch that class of
finding (Steps 6/6.5, effort-independent) already does — bumping a shared tier table for one
observed shape risks calibrating a tier system off n=1. This decision is the mirror case in the
other direction: bounding rigor *downward* from a diff too small to plausibly need Opus-tier
judgment carries none of that risk, because the floor tier (`standard`) still runs a real review
— nothing is skipped, only the model tier for an already-cheap review shrinks. The two decisions
share the same discipline (don't let one diff-shape heuristic silently reweight a shared risk
table upward) while reaching opposite defaults, because raising cost on a false-positive is a
one-run waste and lowering it on a false-negative still leaves a real review in place.

## Alternatives considered

- **Apply the ceiling to `frontier` too** — rejected; the frontier singleton is an explicit,
  deliberate spend decision (record #221), not something a file-count heuristic should silently
  narrow.
- **Let the ceiling raise a tier on a large diff** — out of scope; `model-ceiling` and
  `frontier-run-cap` already exist for upward-affecting policy, and stacking a second upward
  path from the same diff-facts input duplicates that surface for no stated benefit.
