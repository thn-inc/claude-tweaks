# Open Items — Keep the station-event log from dirtying a project's main checkout (#5957)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — exclude presence check normalizes like git (trailing spaces + one CR), not plain trim: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — non-directory .git returns false; doc names the limit (superseded premise): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — correct the .git-is-a-file doc limit (event dropped, nothing written): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | final-review recommendations not taken: (a) call ensureLocalExclude before withLock to close a sub-ms first-append lock-dir window — self-healing on the next append, and moving it outside the lock widens the accepted duplicate-line race; (b) a '# claude-tweaks' comment label in info/exclude — not asked by the spec; (c) re-review note: an exclude file starting with a UTF-8 BOM before one of our entries gets that entry appended once more (harmless, non-repeating) | observation | — |
