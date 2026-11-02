# Open Items — Make routine self-heal, /init Step 15 and /routine create aware of declare-claude-tweaks: false

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at Step 2.5 (reason-not-auto: none — the pipeline resolved it itself) | fixed | Post-creation catch-up merged origin/main (b48193078) |
| 2 | build | SDD ruling — Release Note fixed by the controller on the record #4940 body: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — cost if wrong: one more issue edit |
| 3 | build | SDD ruling — residual re-review minors fixed via one targeted fix dispatch (b83107a5a): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — cost if wrong: one extra small dispatch |
| 4 | review | Step 15 opt-out notice paragraph sat after the Setup-script offer it says it comes before (lenses 3c + 3f, medium) | fixed | Moved before the offer; the ordering test now pins notice, offer, zero-candidates bullet in that order |
| 5 | review | docs/skill-graph.md /init row omits the Step 15 notice and the create --source init dedupe edge (lens 3a, low; routine/SKILL.md:109 same cause) | fixed | One clause added to the /init row |
| 6 | review | Materialized spec Release Note stale against the record body (lens 3a, low) | fixed | Release Note copied from the record body |
| 7 | review | Kernel strictness clause not pinned against the resolver (lens 3f, low) | fixed | Added a resolver test for trailing comment, quoted, commented-out and indented keys |
| 8 | review | Kernel reads policy.yml with a prose parser outside resolve-policy.js (lens 3a, medium reported, low confirmed) | accepted | That branch runs only when no plugin is installed, so the resolver is unavailable; the prose now matches the resolver as pinned by item 7's test |
| 9 | review | Kernel strictness go-red controls share one message (lens 3f, low) | accepted | Every mutation still goes red; diagnostics only, no behavior at risk |
| 10 | wrap-up | pr — PR #4984 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 11 | wrap-up | unknown — residue probe suite skipped via --no-suite; the suite state is the verification pass stamp for HEAD 7dd84a6a6 (tests 9925/9925, journeys 79/79 pass) | observation | — |
