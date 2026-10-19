# Open Items — docs/incident-log.md ends mid-sentence — the IL-162 entry's Removal condition is truncated (#3187)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `docs/incident-log.md:1783`: "such regex call sites" has no clear antecedent for "such". "helper that such regex call sites are required to route through" would read more cleanly (cosmetic; from the SDD task review) | deferred | — |
| 2 | build | SDD ruling: accepted the implementer's rewrap that moves "such" to the next line. The plan's Step 3 grep `such$` would otherwise match the plan's own wrap. No words changed; if wrong, it costs nothing (wrap only) | observation | Wrap-only deviation from the plan's replacement text; the task reviewer confirmed it was the right call |
