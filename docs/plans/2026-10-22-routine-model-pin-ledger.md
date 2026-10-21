# Open Items — Decide and move the routine templates off the claude-sonnet-5 model pin

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: template line edits applied via a one-off node -e script rather than the Edit tool — diff verified correct, process note only | deferred | Origin: SDD task review (Task 1). Files: plugin/skills/*/routine-template.yml. Trigger: none expected — the final whole-branch review independently verified the diff and recommended dismissal. |
| 2 | build | SDD final-review minor: no test asserts every shipped routine template shares one model value, so a half-done future model migration would pass the suite | deferred | Origin: SDD final whole-branch review. Files: tests/routine-template-schema.test.js:92 (already loops every template's model). Trigger: the next routine model migration, or a wrap-up decision to capture it as a backlog record. |
| 3 | build | SDD final-review minor: plan Task 3 labels the run ledger docs/plans/2026-10-22-routine-model-pin-ledger.md as a "Test:" file | deferred | Origin: SDD final whole-branch review. Files: docs/superpowers/plans/2026-10-22-routine-model-pin.md:128. Trigger: none — cosmetic in an executed maintainer-side plan; the "Test:" bullet is what tells plan-audit Check B the file is planned. |
| 4 | build | SDD ruling — batch Tasks 1-3 into one implementer dispatch and one task review: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
