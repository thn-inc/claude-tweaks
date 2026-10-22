# Open Items — #3870: log-decision.js rejects the "enum (note)" reversibility the skill-prose decision-log templates prescribe

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — tighten the merge-verdict pass-line note to exclude `). ` so a tail behind a note fails closed: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | AC3.1 pass-line test covers only `n/a` notes; the regex segment is token-agnostic | deferred | Origin: SDD batch review (minor); files: tests/bin-lib/dispatch/merge-verdict.test.js; whole-branch review triaged it as mostly resolved (the tail test's loop covers `high (commit abc.def)`); revisit only if PASS_ACTION_RE ever becomes token-specific |
| 3 | build | claim-log `COMPLETE_RE` and merge-verdict `PASS_ACTION_RE` accept a line cut right after a period / `).` inside a note | deferred | Origin: SDD final review + fix-wave re-review (minor, out-of-scope); files: plugin/bin/lib/log-decision/claim-log.js, plugin/bin/lib/dispatch/merge-verdict.js; tolerated because append.js writes via writeFileAtomic; revisit if decisions.md ever gains a non-atomic writer |
| 4 | build/skill | parse-signal-discipline extension: widening a fail-closed, end-anchored reader to a writer's optional free-text group (`\(.+\)`) reopens the tail it guarded against; exclude the tail's boundary sequence (here `). `) inside the group and pin a tail-after-group test (#3870, merge-verdict.js PASS_ACTION_RE) | observation | — |
