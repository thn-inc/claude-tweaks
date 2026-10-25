# Open Items — Stop worktree-isolation refusals: emit only guard-accepted command forms (#4028)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | tools/guard-refusals transcripts.js: a fork subagent's "run in force at dispatch" uses its first-entry timestamp, which may be a replayed parent entry, so attribution is approximate for forks (falls back to a parent run) | deferred | Defer-reason: blocked-external — the transcript format carries no subagent start field; revisit if Claude Code adds one |
| 2 | build | tools/guard-refusals shapes.js: unprobed detector boundaries — `\|` counted as a gh compound, `>>`/`2>` counted as variable redirects, case-insensitive node-git-text — all flag conservatively | deferred | Defer-reason: genuinely-larger — probed as part of #4217's per-fence migration (listed in #4217's Current State) |
| 3 | build | guard-rewrite.js residual risks the command text cannot show: a shell-snapshot function/alias (incl. via a zsh glob qualifier) setting an uppercase variable between assignment and reference; a same-named file in another plugin's bin/; IDENT[ arithmetic check also declines plain globs (rewrite coverage only) | observation | Documented in the module header; all fail toward declining or are outside what the hook can observe |
| 4 | build | SDD ruling — Defer migration of ~70 fences with four newly verified refused shapes to #4217 (ratchet allowlist): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — Exempt the step-14 cloud Setup fence and user-run blocks from the guard-shape scan: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 6 | build | SDD ruling — Accept node-eval-separator divergence when the runtime value starts with "-": ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
