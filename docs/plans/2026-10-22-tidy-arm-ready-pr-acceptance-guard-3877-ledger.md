# Open Items — Guard tidy's Arm ready PR on acceptance labeling (#3877)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | actions-github-issues.md 'If every gate still holds' line runs past the ~100-col wrap (cosmetic) | deferred | SDD Task 1 review minor; final review: no fix needed (file already carries many >100-char lines) |
| 2 | build | guard paragraph reads dense — 'When it has not, and also when no valid marker...' conditional could be clearer (brief-verbatim) | deferred | SDD Task 1 review minor; final-review fix wave c6b84f8ef rewrote the conditional to mark the close-out departure explicitly |
| 3 | build | skill-graph test regex '.*' across collapsed slice could match cell and Arm ready PR from different rows (theoretical) | deferred | SDD Task 2 review minor; final review: only one `dispatch/close-out.md` row exists in the tidy section, so no cross-row match is possible today |
| 4 | build | SDD ruling — final-review #7 pr-first-merge Step 1 caller clause left as is (merge bundle 52195/52500 bytes): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — final-review #6 scan-time routing of held record-linked PRs deferred to a follow-up record; fix wave only logs the hold: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 6 | build | SDD ruling — final-review #1-#5 and #8 fixed in one fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 7 | build | SDD ruling — re-review residual minors (KEPT-PROMPT→SKIP status, {run-dir} placeholder, 'when a marker names one') routed to /build Common Step 4.5 Fix-now: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
