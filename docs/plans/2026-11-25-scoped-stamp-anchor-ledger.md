# Open Items — A bookkeeping-only commit after a scoped build verify re-runs the whole impact-selected suite (#5075)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 2 docs name the anchor as any clean, passing non-full pass (Reading B): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the spec Decision (Reading B) is binding over the plan sample text |
| 2 | build | SDD ruling — keep the empty-delta exclusion on the bookkeeping-only shortcut: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — an empty delta (HEAD equals S) is already verified by the prior pass, so the exclusion leaves the repeat-run behaviour unchanged |
| 3 | build | SDD ruling — no output change when the shortcut replaces an explicit --base with S: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | accepted | ratified at Review Console — the Scope line names the base actually diffed and no other --base is accepted, so replacing an explicit --base with S changes no output |
