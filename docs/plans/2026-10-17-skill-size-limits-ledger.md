# Open Items — Skill size limits (#3307, #3308, #3306, #3309, #3310, #3311)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Fresh minted run dir `2026-10-17T062549-spec-3307-…-3311` received one `skill_invoked` event (`superpowers:brainstorming`, `attribution: fallback`, 06:29:03Z) from another session within ~1 min of mint; `flow-preflight.js` then classified adoption as case 3 (recovery) instead of case 2 (minted-empty). Treated as case 2 manually. Fallback attribution should not count as "other run content" for adoption, or should not target a claim-only mint | open | — |
| 2 | ops | Multi-spec `manifest.yml` has no seeding writer: `multispec-run-dir-layout.md` says it is "written exclusively through `hooks.js spec-status`", but `spec-status` refuses with `no-manifest` until the file exists, and no flow step or CLI creates it. Seeded via `bin/lib/flow/manifest.js`'s `writeManifest` directly | open | — |
| 3 | test | Batch pre-flight sweep at base 3bf7d993: 11605 pass / 1 fail / 7 skipped. The one failure, `tests/bin-lib/gif/palette.test.js` "quantize: adversarial … stays bounded (#2769)" (3s wall-clock budget, took 4664ms under full-suite load), passes 7/7 in isolation — load-sensitive timing, not a code failure | observation | Pre-existing load flake; cite this row if a spec's `/test` hits it |
