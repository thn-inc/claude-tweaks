# Open Items — Review tiebreak: pick the judge tier from the finding's severity

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at Step 2.5 (a7367eeb26) | fixed | Merged origin/main into the worktree at Post-creation catch-up, commit 46a6c09642 |
| 2 | build | SDD ruling — T1-M3: an unparsed standard block is not escalated (not a defect): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — whole-branch review ran in parallel with the queued catch-up verification: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — T3-M4: chunkTierProblems sharing judgeTier is not a defect: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — catch-up verification stopped, subsumed by Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — F1 severity floor put in code (finding.severityFloor): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — severity floor narrowed to unsettled re-judges (targeted fix): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build/skill | Skill observation (single-source-constant-guard): tests/skill-size-single-source.test.js AC3.1 flagged `assert.ok(chunk.indexes.length <= CHUNK_MAX)` in tests/bin-lib/tiebreak.test.js because the scanner taints every name in a file that also holds plugin/skills paths, so any UPPER_CASE operand on a tainted line reads as an unclassified skill-size constant; the fix wave used the literal 8 with a message — the skill could document this false-positive shape and its accepted remedy | observation | — |
