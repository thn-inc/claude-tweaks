# Open Items — _shared/pr-run-comments.md: the Find step's gh --jq shape is refused in a worktree-isolated session (#3936)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: non-object comment-list elements (null/primitive) guard at plugin/bin/find-run-comment.js has no test | deferred | — |
| 2 | build | SDD minor: find-run-comment.js — a repeated flag silently takes the last value | deferred | — |
| 3 | build | SDD minor: pr-run-comments.md Find step — "Run the worktree-safe form first" vs "shortcut … outside a worktree-isolated session" vs tidy's "in a worktree-isolated session": two triggers, state one | deferred | — |
| 4 | build | SDD minor: pr-run-comments.md shortcut restriction is stronger than the guard fact (jq passes alone; only the unquoted-$? chain is refused) | deferred | — |
| 5 | build | SDD minor: tests/pr-run-comments.test.js AC2.1 prose test — /Trusted authors/ and /exit 1\|2/ assertions have no independent go-red line | deferred | — |
| 6 | build | SDD minor: pr-run-comments.md Find step — "the shortcut below" forward-references before the shortcut is introduced | deferred | — |
| 7 | build | SDD minor: tests/scratch-worktree-shell-constraint-table.test.js — frozen $TMPDIR row is abridged though commented "verbatim from git HEAD" | deferred | — |
| 8 | build | SDD minor: scratch-worktree §7 #3936 test's go-red control discriminates weakly (frozen rows lack every conjunct) — plan-mandated | deferred | — |
| 9 | build | SDD minor: scratch-worktree §7 #3936 test pins the date /^2026-10-24 \(#3936\)/ — a later live re-verification turns it red; match \(#3936\) only | deferred | — |
| 10 | build | SDD minor: scratch-worktree §7 #3936 row's Example shows only the --jq form, not the --repo github.com/… form | deferred | — |
| 11 | build | SDD minor: tidy/scan-procedures.md:124 uses a `{plugin-root}` placeholder where every sibling node call uses "${CLAUDE_PLUGIN_ROOT}/bin/…" | deferred | — |
| 12 | build | SDD ruling — final-review Minor 2 (§7 row Example/wording "unobserved") needs no row change: the exact Example was probed live and refused with the quoted wording, and the github.com form with `&& echo exit=$?` was probed and refused: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 13 | build | Implementer follow-up (pre-existing, outside this diff): plugin/bin/compose-pr-body.js parseArgs uses `a in FLAGS`, so inherited keys such as `--constructor` pass as known flags (find-run-comment.js uses Object.hasOwn) — route per the deferral gate | open | — |
| 14 | build/skill | gh-api-module-pattern's cli-wrapper-contract.md extends: plugin/bin/find-run-comment.js (#3936) joins the Payload-1/Invocation-2 exit family (list it beside wrap-up-engine.js/declined-learning.js/qa-report.js), and its `Object.hasOwn(FLAGS, a)` flag lookup is the fix for the `a in FLAGS` inherited-key acceptance a copied compose-pr-body.js parseArgs carries | open | — |
