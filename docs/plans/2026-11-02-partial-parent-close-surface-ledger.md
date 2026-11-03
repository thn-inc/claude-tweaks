# Open Items — Surface a partial Step 4.0b parent-close instead of recording a clean ran

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 30 commits ahead of the resumed branch | fixed | Post-creation catch-up merged origin/main (be1eb92bf → 7b0180d2a), bringing in #4897 |
| 2 | ops | Pre-flight branch-divergence-check (resume run 2026-11-03T093431): origin/main was 21 commits ahead of the resumed branch | fixed | Post-creation catch-up merged origin/main (e035108bb → 125baf12f) |
| 3 | ops | Pre-flight branch-divergence-check (resume run 2026-11-03T201056): origin/main was 29 commits ahead of the resumed branch | fixed | Post-creation catch-up merged origin/main (b55660bf7 → merge of db01beacd), bringing in #4781 (closing-links in-process core) |
| 4 | build | SDD ruling — a throw after closeParents keeps the Step 4.0b fields on a skipped/error entry: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — the line formatters reject a null element: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 6 | build | SDD ruling — merge mode and the CLI docs cover the error entry beside marker-write-failed: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 7 | build | SDD ruling — the error entry keeps parentsClosed and joins the unmarked parent-close count: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 8 | build | SDD ruling — the parents-left-open line uses an em dash before the backstop clause: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 9 | build | SDD ruling — the journey wording residual was fixed under the residual override: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 10 | build | Follow-up (final review's fix-wave re-review, out of scope): the reconcile CLI's compact `post-merge steps failed:` row does not count a `skipped / error` entry, while the background summary's `postMergeFailed` does, so the two surfaces disagree on whether a thrown run is a failure (pre-existing before this branch) | open | Defer-reason: pre-existing-outside-diff — the record's scope is Step 4.0b parent surfacing; which surface should count a thrown run is a separate counting decision for its own record |
| 11 | build/skill | `driver-skill-outcome-taxonomy` enrichment: when an engine attaches additive fields to several entry kinds (#4798's `parentFailures`/`stepSkips` on `ran`, `marker-write-failed` and `error` entries), the driver prose keys its report on the entry carrying the field, never on a list of reason words — merge-mode.md's IL-168 hand-list guard forced exactly this | observation | — |
