# Open Items — Worktree shell constraint avoid-list misses the piped-git-into-node shape

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — subagent-dispatch-core.md is not edited; it cites _shared/scratch-worktree.md section 7 as canonical instead of restating the list: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | task-prompt.md item 6 says a runtime variable "anywhere" in a git command is refused — broader than the probe (only the node -e script text was probed); narrow to match the scratch-worktree.md section-7 row | deferred | — |
| 3 | build | new #3829 test pins the standalone merge-base line but does not couple it to the composition line (e.g. require {merge-base} on it) | deferred | — |
| 4 | build | ceremony-derivation.md step 2 (unchanged) uses node "${CLAUDE_PLUGIN_ROOT}/bin/set-config.js", the runtime-variable-script-operand shape section 7 lists as refused — repo-wide placeholder convention, follow-up | deferred | — |
