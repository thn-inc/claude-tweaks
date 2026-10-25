# Open Items — Run the test-perf workflow once on main and confirm it goes green

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Proof run 40179953240 of `.github/workflows/test-perf.yml` logged a runner warning: "Node.js 20 is deprecated. actions/checkout@v4, actions/setup-node@v4 target Node.js 20 but are being forced to run on Node.js 24" — workflow passes today, but the pinned action majors (and possibly sibling workflows) will need a bump before GitHub removes the Node 20 action runtime; tangential to #4161 (no code change in this diff) | open | — |
