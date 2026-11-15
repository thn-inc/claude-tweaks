# Open Items — Give the last six CLIs an injectable entry (#5386)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight branch-divergence-check: origin/main was 3 ahead of local main at Step 2.5 and 1 ahead at build Common Step 1; continued under auto mode | observation | Post-creation catch-up merged origin/main into the worktree branch (1eaac6d to cd306a7) |
| 2 | build | SDD ruling — T1 Step 0 baseline taken by the orchestrator, not re-run by the implementer: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — implementers never write the main checkout run dir; measurements go in task reports: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — residual Minor + nit after the final fix wave got one targeted fix (aecc2f52b): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — process.env.HOME gap in the install test folded into the targeted fix: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build/skill | diverges: _shared/subagent-dispatch-core.md 'Discrimination checks in a scratch checkout' makes the scratch copy a linked worktree, so a cwd-ignoring mutant of a writer CLI (sweep-stray-run-dirs.js) resolved the REAL main checkout through mainCheckoutRoot and made 600 archive commits; and an os.homedir mutant of install-statusline-wrapper.js wrote the real ~/.claude-tweaks wrapper — the procedure needs a writer-CLI rule (dry-run/fixture-root guard before the mutant, or an archive-extract copy) [skill: NEW - mutation-probe-writer-cli-containment] | open | — |
| 7 | build/skill | extends: .claude/skills/gh-api-module-pattern cli-wrapper-contract — injectedGhDeps returns a lazy homedir getter, and an object spread ({ ...injectedGhDeps(...) }) or a { ...deps } copy calls it eagerly; merge with repo-resolve.js withDescriptors so homeDir() runs only when the gh config-dir lookup falls through to the home | open | — |
