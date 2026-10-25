# Open Items — #4140 release preflight pack: expose the pre-major bump flags it applied in proposedVersion

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch-divergence check: origin/main was 2 commits ahead of the worktree branch at Step 2.5 | fixed | Post-creation catch-up fast-forwarded the worktree branch 692faed76 → 7dbd58ad1 |
| 2 | build | plugin/skills/release/SKILL.md:107 documents proposedVersion's shape as {version, part, base, baseSource, tipRef} — already omitted preMajor before this change, now also omits the two new fields | deferred | Origin: SDD task review (minor, deferred). Files: plugin/skills/release/SKILL.md. Trigger: the review step of this run, or the next edit to the release skill's Step 1 pack description |
| 3 | build | docs/plugin-structure.md:229 says "absent/unparseable" but readPreflightFlags also falls back when proposedVersion.ok !== true (pre-existing wording gap) | deferred | Origin: SDD fix-round re-review (out-of-scope, minor). Files: docs/plugin-structure.md. Trigger: the review step of this run, or the next edit to the release-tip-check.js row |
| 4 | build | SDD ruling — AC 1's "false for a config that does not set them" read as the resolved defaults (bumpMinorPreMajor true, bumpPatchForMinorPreMajor false): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — implementer ran only the focused test files, not the full suite (Common Step 5 runs it centrally): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
