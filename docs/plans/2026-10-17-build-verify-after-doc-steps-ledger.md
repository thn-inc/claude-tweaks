# Open Items — Make build's full verify the last tree change before /test (#3060)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Ruling: AC4 size check runs against RAIL_BYTES 52,500 B (budgets.js, tests/bin-lib/skill-audit/context-cost.test.js) — the spec's 46,080 B CEILING_BYTES was decommissioned by #3311; if wrong, a reviewer flags a size rule nobody enforces | observation | SKILL.md 46,888 B after build, under RAIL_BYTES |
| 2 | build | Ruling: fix all three final-review Minors (intro order, Steps 3+4.5 paragraph, re-check before re-running verification) in one fix wave — <100 B prose; if wrong, costs ~100 B of wording | observation | Fixed in c570bcd6b; scoped re-review: all 3 ADDRESSED |
