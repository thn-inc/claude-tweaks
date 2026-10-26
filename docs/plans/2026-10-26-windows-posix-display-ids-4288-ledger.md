# Open Items — #4288: Windows: tests and two display-ID producers compare backslash relative paths with / IDs

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 18 commits ahead of local main at /flow Step 2.5 (local main 19 ahead with reconcile archival commits); at worktree creation the stamp had moved and the re-check read origin/main 1 ahead, local not ahead | accepted | Post-creation catch-up fast-forwarded the worktree to origin/main 3ad36593f; nothing persists for this branch |
| 2 | build | impact-cli "selects the subset" other assertions (imp.listPath vs path.join(r.gitDir, ...)) may differ on win32; the AC3 per-file Windows read settles it. | observation | — |
| 3 | build | SDD ruling — Task 1 ships the four `/`-template producer edits without a new Linux test: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — artifacts.js keeps native separators for residue `subject`/`failed` paths (path.join(rel, entry.name), :187...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build/skill | windows-checkout-test-parity extends: when a producer composes a display ID from a fixed prefix plus a fs entry name, a `/` template (`` `${entry.name}/${child.file}` ``) is simpler than `toPosix(path.join(…))` (#4288's listPlanFiles and artifacts.js); and a test whose expected value is platform-quoted (impact-cli's subset command) derives it from the producer (`substituteFile`) whose own linux+win32 pins live in its own test file, instead of a POSIX-only regex | open | — |
