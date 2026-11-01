# Open Items — Tolerate a failed identity probe when closing a below-floor parent

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/skill | `mcp-agent-fetch-node-compute` extended: rule 3 (an agent-recorded error object is a failure, never data) now has a key-level variant — a key whose failure has a safe degrade (`me` in `mcp-parent-gate-shape.js`) maps any login-less shape to the degraded value instead of a `FactsError`; the skill's row 19 was updated, but its rule 3/4 prose still describes only the fail-closed form | open | — |
