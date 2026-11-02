# Open Items — pr-scan item 4 wrongly calls PR states exclusive

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/docs | docs/journeys/compose-a-per-run-context-bundle-1988.md step 8 quotes measured bundle bytes that this build's +169 B item-4 edit moves: `pr-scan` is now 52,252 B (`gh`, 248 B under the 52,500 B rail) / 38,823 B (`mcp`) / 52,260 B (`unresolved`), measured live with `plugin/bin/context-cost-report.js` at dc62c70ff (the journey still says 50,501 / 37,072, and its `claims` figures were already stale before this build: now 47,548 / 46,236). Staged in wrap-up as staged/wrap-up-journey-1.md (carries this row's Ledger: back-reference; applied at the Review Console). | open | |
