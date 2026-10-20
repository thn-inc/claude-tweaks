# Open Items — build-review-context.js: trim full-file sections from prose-heavy review bundles

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: `build.js` buildContext doc comment re-wrap left a ragged one-word line | fixed | Re-flowed in the final-review fix wave — `6c6b5cdea` |
| 2 | build | SDD Task 1 minor: no test for an unreadable-but-present `.md` path (e.g. a directory named `x.md`) or a small added `.md` file | deferred | Final whole-branch review traced both paths: the first is the same catch → `emptySections` route the `deleted markdown` test pins via `readOk`; the second is the stub path `AC2.1` covers — no separate test needed |
| 3 | build | SDD Task 2 minor: `step3-lens-dispatch.md` stub sentence over-broad ("every markdown file" / "markdown hunk stays whole") for deleted and over-cap added/deleted markdown | fixed | Upgraded to Important by the final review; now "every readable markdown file's section" / "a modified markdown file's hunk" — `6c6b5cdea` |
| 4 | build | SDD Task 2 minor: inserted diff-boundary sentence broke the "So the agent still sees" flow | fixed | Sentence moved after the elided-hunk clause — `6c6b5cdea` |
| 5 | build | SDD ruling — `docs/plugin-structure.md` markdown clause placed after `#3020` rather than right after "lockfiles and `.jsonl`" to avoid splitting "elides their added/deleted diff chunks" from its subject: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
