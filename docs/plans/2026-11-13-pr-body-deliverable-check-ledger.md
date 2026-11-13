# Open Items — Check spec deliverables that target the PR body against the live PR body at review Step 1

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — 3+ partial Step 1 items match no Gate row, left unchanged: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | house MCP read-repair-write drops HTML-comment markers: repairPrBody (plugin/bin/lib/flow/pr-body.js) counts a pair present from its plain-text companion alone, so an MCP write-back omits the <!-- --> forms, contradicting _shared/pr-checklist-refresh.md "both delimiter pairs survive"; HTML-only readers (github-pr-scan RUN_MARKER) may miss the PR. Outside this diff (Defer-reason: pre-existing-outside-diff). | observation | — |
| 3 | build | review-summary-template.md compact-form bullet does not name Step 1 item 5 (Current-State outcome reach): an outcome marked partial with every deliverable done and criterion met could still render PASS (clean); pre-existing gap noted by the residual re-review after the one targeted residual fix was spent. | observation | — |
| 4 | build | code-mode-steps.md Step 7 one-line summary of the compact clean-PASS conditions ("zero findings, zero actions, and zero manual steps") omits spec-compliance status; it defers to the template, pre-existing. | observation | — |
