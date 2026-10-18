# Open Items — Derive reader inventories from read call sites in /build plan-authoring checks

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: `tests/plan-authoring-reader-inventory-prose.test.js` pins the six #3358 missed-reader file paths as literals, so a later rename of any of them fails the pin even though the rule still holds | accepted | Intentional — the literals keep the paragraph's cited incident accurate; a rename that moves a cited file should force the citation to be re-checked, which is the pin's job. Reviewer also called it "arguably intended". |
