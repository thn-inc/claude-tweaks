# 0006. Compute ceremony tiering in `/specify` Step 3, and stamp it as an always-explicit label

- **Status:** accepted
- **Date:** 2026-07-20
- **Context:** `docs/superpowers/specs/2026-07-20-lifecycle-ceremony-tiering-design.md` (deleted `70849915`)

**Note (2026-08-08):** the `effort:*` facet referenced below was renamed to `size:*` in spec #217 — this document's body is left as originally written to preserve the historical record.

**Note (2026-08-13):** `/review-backlog`, named below as the consumer of the ceremony tier, was retired and merged into `/claude-tweaks:backlog` in v6.18.0 (2026-07-26) — the equivalent is now `/backlog`'s risk-value-lens `Tier` column, not a `Suggested tier` column. This document's body is left as originally written to preserve the historical record.

**Note (2026-09-06):** the skip roster — every step each ceremony profile skips, and every step no profile may skip — now lives in `plugin/skills/_shared/ceremony-profile.md` (#1926), pinned by `tests/ceremony-profile-roster.test.js`; consumers cite it by tag rather than restating a skip. Two skips were added there: SDD's final whole-branch review for a single-task, non-batched fast-lane plan, and the polish phase under fast-lane. The two-call split (`build,test` then `review,polish,wrap-up`) is deliberately kept for fast-lane records: collapsing it saves only the second call's preflight and loses the clean-room review — the last independent judgment a fast-lane record gets (`[IL-07]`, `[IL-130]`).

## Context

The `ceremony-profile: fast-lane | standard` mechanism (2026-07-15) let small/clean records skip proportionate ceremony, but only in `/flow`'s materialize step and only for Build/Wrap-up — the underlying `ceremony-check` computation lived in `/flow` at build time, ran once per build, and the header field was omitted whenever the verdict was `standard` (mirroring `risk:*`/`effort:*`'s omit-when-unscored convention). A user encountering this friction via `/review-backlog` asked for "a full sweep of the process in terms of how minor changes are handled" — not a narrow extension of the existing mechanism. That meant `/specify`'s own Step 5 red-team breadth and `/review`'s fixed-cost steps also needed to scale with tier, which build-time computation in `/flow` couldn't reach without redoing the judgment per consumer.

## Decision

Relocate `ceremony-check`'s primary invocation into `/specify` Step 3 (Shaping mode and per-leaf decomposition mode), where it is computed once and stamped as an explicit `ceremony:fast-lane`/`ceremony:standard` label — never omitted, unlike `risk:*`/`effort:*`'s omit-when-unscored convention, because this axis has no unscored state: every record gets a verdict the first time it's shaped. `/specify`'s own Step 5 red-team persona count and `/review`'s step-skipping both read this label directly. `/flow`'s materialize step reads `facets.ceremony` as the normal path and falls back to invoking `ceremony-check` fresh (fallback-only, no label write-back) solely for records that reach `/flow` without ever having gone through `/specify` — preserving `/specify` as the label's sole owner.

## Alternatives considered

- **Keep computing ceremony in `/flow` at build time, widen only which downstream steps read it** — rejected: `/specify`'s Step 5 red-team runs before `/flow` ever exists for that record, so build-time computation can't reach it without either running `ceremony-check` a second time (duplicated judgment, possible drift between the two verdicts) or deferring Step 5's own breadth decision to a later pipeline stage that hasn't happened yet.
- **Keep the header field omit-when-standard, matching `risk:*`/`effort:*`** — rejected: `risk:*`/`effort:*` omit specifically to represent "not yet scored" (a real third state). Ceremony has no such state once `/specify` has run — omitting would make "judged standard" and "never judged" indistinguishable at every downstream reader, which is worse than the minor verbosity of always writing the label.
- **Have `/flow`'s materialize fallback write the computed label back onto the record** — rejected: this would let a build-time path acquire label-write authority explicitly reserved for `/specify` in the permission matrix, breaking single-ownership for no benefit — the fallback only needs the verdict for that run's own header, not to correct a record's permanent state.

## Consequences

Every record `/specify` shapes now carries a permanent, queryable `ceremony:*` label from the moment it's shaped, which `/review-backlog`'s advisory `Suggested tier` column and any future consumer can read directly instead of re-deriving. The tradeoff is that `/specify` now owns a fourth stamped label family (alongside Type, Risk, Effort) with its own always-explicit convention that diverges from the other two — a future contributor extending the label taxonomy should not assume every scoring-adjacent axis follows the same omit-when-unscored rule. Legacy records that never went through `/specify` (hand-authored spec files, or records created before this shipped) permanently lack the label and always take the fallback path in `/flow` — this is accepted as a one-time migration gap, not a bug to chase down.
