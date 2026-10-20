# Open Items — Stale-superpowers notice names no remedy for a record whose worktree directory was deleted

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | mkdir -p "{projectPath}" in the missing-path notice is not shell-safe for a path containing ", $ or a backtick | deferred | Origin: SDD task review of #3631 (minor). Files: plugin/bin/lib/superpowers-version.js (missing-path suffix). Trigger: a projectPath carrying a shell metacharacter is observed in installed_plugins.json; real paths here carry only spaces, and the spec asks only for quoting. |
| 2 | build | The missing-path superpowers notice is now a long single line | deferred | Origin: SDD task review of #3631 (minor). Files: plugin/bin/lib/superpowers-version.js. Trigger: a user reports the SessionStart banner as unreadable; it stays one line per the spec's inform-tier constraint. |
| 3 | build | SDD ruling — missing-path suffix says "run in this checkout", not the brief's "run from this checkout" (the brief's own test forbids "run from" in that notice): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | review | Missing-path notice put mkdir/uninstall/delete steps on the model-directed line, but its never-run guard covered only the update (spec Gotcha: the remove remedy falls under the same rule) — lenses 3b (medium) and 3c (low) | fixed | Suffix ends "; never run these removal steps yourself"; both missing-path tests assert it (red with the source fix reverted, green with it); journey red flag widened. |
