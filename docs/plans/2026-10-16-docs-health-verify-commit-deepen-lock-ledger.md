# Open Items — docs-health verify-commit: parallel judges can race the shallow-clone deepen fetch (#2988)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | wrap-up | residue-6ad53fd0 — release — CHANGELOG entry for v6.143.0 — tag v6.143.0 exists but CHANGELOG.md at this branch's HEAD has no version heading for 6.143.0 | accepted | False alarm, not this run's residue: origin/main's own CHANGELOG.md already carries the v6.143.0 heading (added by its own merged release PR #3345) — this branch simply hadn't caught up yet, which is expected for any open PR and resolves naturally once this PR actually merges. Re-merging origin/main to force the entry in now pulled in an unrelated pre-existing defect (multi-spec.md over its byte ceiling, confirmed already present at origin/main's own tip) — reverted that merge rather than hand-fix a feature file with no first-hand context. |
