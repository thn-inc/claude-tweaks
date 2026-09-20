# Fast-Lane Digest — `/claude-tweaks:review` and `/claude-tweaks:wrap-up` at `ceremony-profile: fast-lane`

One condensed lookup, read once instead of opening every sub-file below just to learn what
`fast-lane` skips or narrows (#1765). This file restates it, never overrides it — every fact
below is a literal restatement of what its cited canonical source already states. A drift
between this file and its cited source is a bug in this file, never authority to change
behavior on its own. The single roster of every profile's skips — this file's review/wrap-up
subset included — is `_shared/ceremony-profile.md`; consult it directly for anything not
covered below.

**When to read this file:** `/claude-tweaks:review` (`code`/`full` mode) or `/claude-tweaks:wrap-up`,
once a pipeline run directory's `config.yml` reads `ceremony-profile: fast-lane`. Standalone
invocations (no run directory) and `standard`-profile runs get no benefit here — proceed to the
full procedure documented in each skill's own `SKILL.md` instead.

## Review — Ceremony-Aware Step Selection (`code`/`full` mode)

| Step | Fast-lane | Sub-file (open only once you actually reach this step) |
|---|---|---|
| Step 1 — Spec Compliance Check | **skip** | n/a |
| Step 1.5 — Test Gate | run | `code-mode-steps.md` |
| Step 1.6 — Cross-Spec Promise Check | **skip** | n/a — `cross-spec-promise-check.md` never opens |
| Step 2 — Identify What Changed + Merge-Provenance Check | run | `code-mode-steps.md`, `merge-provenance-check.md` |
| Step 2.5 — Derive Review Effort | run | `review-effort-derivation.md` |
| Steps 3 / 3.5 / 3.6 / Step 3 Routing — Code Review, debate, refutation, routing | run | `code-mode-steps.md`, `step3-lens-dispatch.md`, `step3-debate-and-refutation.md`, `step3-doc-freshness-lens.md`, `step3-routing.md` |
| Step 4 — Implementation Hindsight | **skip** | n/a |
| Step 5 — Simplify Changed Code | run | `code-mode-steps.md` |
| Step 6 — Visual Review | run (browser/dev-server permitting) | `code-mode-steps.md` |
| Step 6.5 — Design Quality Pass | run (per `design-critique` lever) | `code-mode-steps.md`, `ux-analysis.md` |
| Step 6.7 — Late Findings Routing | run | `code-mode-steps.md` |
| Step 7 — Present Review Summary | run | `code-mode-steps.md`, `review-summary-template.md` |

A finding at any severity in Step 3 (or a Safety-regression finding at wrap-up's Reflect step
below) trips the ceremony escape hatch documented in the wrap-up section below — review itself
never re-derives ceremony.

Canonical source: `review/code-mode-steps.md`'s "Ceremony-Aware Step Selection" section.

## Wrap-up — narrowed rows and escape hatch

**Reflect (Phase 1):** `light` mode — Near-misses, Fresh start, Friction only, no tradeoff
review, no Surprises/Approach lenses. Canonical: `reflect/light-mode.md`.

**Registry rows (Phase 2), domain-overlap caps only — gate/existence unaffected:**

| Row | Standard cap | Fast-lane cap | Judge file (open only if the row's gate is open and you must actually curate it) |
|---|---|---|---|
| Skills | top 5 | top 2 | `skill-curation.md` |
| Docs | top 3 | top 1 | `docs-health-integration.md` |

Every other registry row (Journeys, CLAUDE.md & rules, Decision records, Broken references,
Memory, Upstream feedback) is unaffected by ceremony — same gate, same scope, at every profile.

**Ceremony escape hatch (fast-lane only):** after Reflect, downgrade `ceremony-profile` to
`standard` for the rest of the run when either:
- `/claude-tweaks:review`'s summary carried a finding at any severity, or
- the Reflect pass above produced a Safety-regression finding.

Canonical: `wrap-up/SKILL.md`'s "Ceremony escape hatch" section.

**Diff-derived ceremony default (headless firings only):** a `standard` header default can
itself narrow to `fast-lane` before Reflect runs, when the diff is low-surface (0 production
files changed). Canonical: `wrap-up/ceremony-derivation.md` — open it only when this run's
header-fold default is `standard` and you need to check whether it narrows; once `config.yml`
already reads `fast-lane`, there is nothing left to derive and this file never needs to open.

## What this file does not replace

- Each cited sub-file's actual step **content** (the code review itself, the curation
  judgment, the reflect lenses) — this digest names whether a step runs and where its
  procedure lives, never the procedure itself.
- `SKILL.md`'s own mode dispatch (`code`/`full`/`visual`/`journey`/`discover` for review;
  Phase 1-4 structure for wrap-up) — read the owning `SKILL.md` first to resolve mode/phase,
  then this digest for the ceremony-aware branch within it.
