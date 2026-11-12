# Open Items — Queue pull as a module and CLI, alongside the embedded scripts (#5227)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Script defect found by the oracle probe: queue-pull-script.md reuses a prior pull's session files when a later fetch returns empty (dispatch-eligible*.json survive, exit 0 on stale data). Module reproduces it per the spec's Non-Goals; file as its own record via /claude-tweaks:capture | open | — |
| 2 | build | Script defect found by the oracle probe: the target-missing Close proposal is staged from an extensionless mktemp file, so stage-item.js names it dispatch-target-missing-N.<random> instead of .md (non-deterministic, not markdown). Module reproduces it; file via /claude-tweaks:capture | open | — |
| 3 | build | Script defect found by the oracle probe: aliasMcpTimestamps coerces a non-array (wrapper object) queue or dep-freshness file to [] silently, giving an empty queue or a dep dropped from the cache freshness signal (stale cache). Module reproduces it; file via /claude-tweaks:capture | open | — |
| 4 | build | Doc/code mismatch found by the oracle probe: mcp-transport.md says a non-JSON claim-map string value counts as a failed read, but claimReaderFromMap treats it as unreadable content with no AUTO line; also mcp-transport.md gives DISPATCH_OPEN_NUMBERS no MCP mapping. File via /claude-tweaks:capture | open | — |
