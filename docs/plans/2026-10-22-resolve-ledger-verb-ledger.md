# Open Items — Add a read-side resolve-ledger verb (#3897)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — reword `_shared/ledger-format.md`'s `ambiguous` clause to name `hooks.js delete-ledger --ledger` (resolve-ledger accepts only `--run`) and say flippers ask which one: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | `describeRunLedgers` reads `docs/plans` twice (its own readdir + `resolveLedgerPath`'s) — a read-only race could leave one stale `other-run:` line | accepted | Plan-mandated to keep `resolveLedgerPath`'s `deepStrictEqual`-pinned return shape; read-only, microsecond window; final whole-branch review triaged it OK to leave |
| 3 | build | Conformance report-name check is a bare backticked substring; the AC2.1 go-red control throws on the first assertion only | accepted | Final whole-branch review verified the four backticked report names occur only on `ledger-format.md` line 23, so the substring cannot be satisfied elsewhere; the go-red control proves `assertRuleNamesVerb` can fail |
| 4 | build | Follow-up: `plugin/skills/build/dispatch.md:21` restates its own run-dir-else-`docs/plans` ledger-path rule instead of citing `hooks.js resolve-ledger` (surfaced by the final review's declined-to-judge list) | open | Defer-reason: pre-existing-outside-diff — file not in this build's diff, and outside AC3 (which covers `value.files`/`unattributedFiles` restatement); pinned by `tests/build-sdd-ledger-residue-carryforward.test.js` |
