# Open Items — #4557 progress check at the wait bound for write-capable children

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 19 commits ahead of the resumed branch | fixed | Post-creation catch-up merged origin/main (daaed137a → ec1103398) before any build task |
| 2 | ops | Step 2.6 shape check: plan Task 1 touches 6 files (above the 5-file signal) | accepted | The six files are one atomic unit — verbatim-copy pins (express x2 == task-prompt first-call paragraph; handoff template == item 7) go red on any split; plan's Global Constraints state this |
| 3 | ops | Step 2.6 shape check (run 2026-11-01T115520): plan Task 1 still touches 6 files (above the 5-file signal) | accepted | Same signal as row 2, re-detected on resume; same atomic-unit rationale |
| 4 | build | SDD ruling — keep HANDOFF_PROGRESS alongside PROGRESS_CHECK (AC5 names the handoff test file): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — fixed the wait-line destination minor anyway; plan size target relaxed to 52,300 B: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
