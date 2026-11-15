# Open Items — Give the wrap-up engine CLIs an injectable entry and run their tests in-process (#5379)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — R1: implementer revert-red proofs run in a scratch checkout, never an in-place Edit-and-restore in the shared worktree (contract beats plan text; cost if wrong: one extra scratch checkout per proof): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — R2: Task 2 re-review trivial Minors (committedRepo unused `parent` param; ghSync test stderr leak) fixed in Task 3 dispatch instead of a second Task 2 round (cost if wrong: Task 3 review scope grew ~3 lines): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — R3: Tasks 4 and 5 required an env/ctx wiring proof per spawning seam, beyond the plan single telemetry test (cost if wrong: a few extra in-process tests): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build/skill | gh-api-module-pattern cli-wrapper-contract.md (extends): the lib-env rule covers child processes but not gh host/config lookups (gateOriginRepo, ghConfigDir read GH_HOST/GH_CONFIG_DIR from process.env) — #5379 needed injectedGhDeps(ctx) in engine-verify.js/pack.js, and Task 2 took a fix round when a GH_HOST-only-in-deps.env mutant survived; worth one sentence in the contract | open | — |
