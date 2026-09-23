---
record: 883
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build, merge]
surface: backend
---
# 883: test: SKILL.md context overhead — measured mode-split pass

Surface: backend

## Current State

`test/SKILL.md` is ~20.8KB and always-loaded; a bare `/test types` pays for the full QA argument surface, pipeline tables, and fix-mode prose it never uses.

## Deliverables

- An IL-72-style split arithmetic pass on `test/SKILL.md`, done at design time (not implementation time): measure sub-file headers + routing stubs against bytes skipped per hot path, and split only where the split is net-positive.

## Acceptance Criteria

- [ ] A measured comparison exists (per record) showing, for each candidate split point, the bytes a hot path (e.g. `/test types`) would skip versus the bytes added by sub-file headers and routing stubs.
- [ ] Any split actually made is net-positive by that measurement — no split is made where the routing overhead would exceed the bytes saved.
- [ ] `npm test` passes; `/test`'s existing modes are unaffected in behavior.

## Technical Approach

Follow this repo's existing IL-72 split-arithmetic precedent: measure `test/SKILL.md`'s current always-loaded size, identify candidate split points along its mode boundaries (types-only, pipeline, fix-mode, QA-story argument surface), and for each candidate compute bytes-skipped-per-hot-path against bytes-added-by-routing. Only implement splits that come out net-positive; document the arithmetic for any candidate rejected as not worth it, per this repo's "no silent caps" convention (log what was measured and dropped, not just what was done).

### Key Files

- `plugin/skills/test/SKILL.md` — the file being measured and potentially split
- new sub-file(s) under `plugin/skills/test/`, if a split is implemented, following this repo's existing `plugin/skills/{name}/*.md` lazy-loading convention

## Gotchas

- Related to #657 — check its scope before starting to avoid overlapping work.
- The deliverable is explicitly the measurement-then-conditional-split, not a split by default — a record that "does the split" without first showing the arithmetic is net-positive doesn't satisfy this record's own stated scope.

## Original request

test: SKILL.md context overhead — measured mode-split pass

**Related:** #657

Context: test/SKILL.md is ~20.8KB always-loaded; a bare `/test types` pays for the full QA argument surface, pipeline tables, and fix-mode prose it never uses.

Scope: IL-72-style split arithmetic at design time (sub-file headers + routing stubs vs bytes skipped per hot path); split only where net-positive.

