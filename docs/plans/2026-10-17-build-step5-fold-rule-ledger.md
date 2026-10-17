# Open Items — build: Common Step 5 fold rule — a folded plan task contributes only its runner checks (#3118)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: AC3.1 go-red `assert.throws` had no matcher — any thrown error would satisfy it | fixed | `dbdcd3e03` — now `assert.throws(..., assert.AssertionError)` |
| 2 | build | SDD task review minor: `assertFoldRule`'s "Skipped steps" / "A step that ran is never logged as `SKIP`" checks are file-wide, not scoped to the fold-rule text | accepted | Final review verified `dispatch.md` had zero "Skipped steps" at base and exactly one now, so the check is not vacuous; the ordering check is scoped to the fold sentence and the spec's go-red criterion is met |
| 3 | build | SDD task review minor: SKILL.md Common Step 5 pointer did not say to read `dispatch.md` for the exact SKIP entry (a `batched` executor never opens it otherwise) | fixed | `dbdcd3e03` — pointer now says "read `dispatch.md`'s "Folded verification task" rule for the exact entry" |
| 4 | build | SDD Ruling: final whole-branch review was ready-to-merge with 3 Minor tightenings; fixed them now in one fix wave rather than deferring (cheap, in-diff) — also added "re-run Step 5" after a folded-step defect fix (`dbdcd3e03`); scoped re-review: all addressed, no new breakage | observation | — |
