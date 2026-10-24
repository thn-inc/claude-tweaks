# Open Items — reconcile ledger-residue claims parity with tidy's orphan-ledger rule but skips the referencing-record check

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — implementer runs only the focused ledger-residue suite, full npm test runs centrally at Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 2 | build | SDD ruling — stale keep-rule restatements in tidy/step-6-auto.md:42 and docs/plugin-structure.md:27 are in scope and were fixed in round 1: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 3 | build | SDD ruling — omitted-loader assertion calls classifyLedgerCandidate directly instead of via the helper default (equivalent): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 4 | build | namedTarget branch of referencingRecords has no isolating test — any namedTarget-resolving docs-health body also contains the ledger slug, so the branch is subsumed by the substring checks; kept for word-for-word tidy parity | accepted | Nothing to defer: no body can resolve a namedTarget ledger path without also containing its {feature} slug (both the docs/…-ledger.md and pre-#1851 bare-id forms carry it), so no isolating test exists; the branch is kept only to mirror tidy's scan-procedures.md rule word for word (SDD minor, Task 1) |
