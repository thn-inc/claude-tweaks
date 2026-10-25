# Open Items — #4140 release preflight pack: expose the pre-major bump flags it applied in proposedVersion

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch-divergence check: origin/main was 2 commits ahead of the worktree branch at Step 2.5 | fixed | Post-creation catch-up fast-forwarded the worktree branch 692faed76 → 7dbd58ad1 |
| 2 | build | plugin/skills/release/SKILL.md:107 documents proposedVersion's shape as {version, part, base, baseSource, tipRef} — already omitted preMajor before this change, now also omits the two new fields | fixed | Fixed at wrap-up Phase 3 fix-exhaust: SKILL.md:107 now lists preMajor, bumpMinorPreMajor, bumpPatchForMinorPreMajor |
| 3 | build | docs/plugin-structure.md:229 says "absent/unparseable" but readPreflightFlags also falls back when proposedVersion.ok !== true (pre-existing wording gap) | fixed | Fixed at wrap-up Phase 3 fix-exhaust: plugin-structure.md row now reads "absent, unparseable or not `ok`" |
| 4 | build | SDD ruling — AC 1's "false for a config that does not set them" read as the resolved defaults (bumpMinorPreMajor true, bumpPatchForMinorPreMajor false): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — implementer ran only the focused test files, not the full suite (Common Step 5 runs it centrally): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
