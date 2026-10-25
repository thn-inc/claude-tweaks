# Open Items — reconcile: sweep main-checkout ad-hoc session dirs by session liveness (#4179)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — T1 adds isMainCheckoutAdHoc as a new helper and leaves isAdHocIntrinsicSkip untouched; T2 removes its copy: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 2 | build | SDD ruling — PR #4256 body fixed in the controller; every other final-review item sent to one fix dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 3 | build | SDD ruling — comment-only edit of plugin/bin/lib/run-liveness/index.js:4 allowed despite the run-liveness read-only constraint: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 4 | build | SDD ruling — T1 minor 'swap isStaleDir before isMainCheckoutAdHoc' dropped (name check already rejects non-ad-hoc dirs first): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | |
| 5 | build | isMainCheckoutAdHoc duplicated isAdHocIntrinsicSkip's mainRoot/resolveLeaf comparison until Task 2 | fixed | Task 2 (118a5dda4) deleted the copy; confirmed by the Task 2 review and the whole-branch review |
| 6 | build | adhoc-session-ended calls isMainCheckoutAdHoc before the cheaper isStaleDir stat | accepted | Current order is cheaper: isAdHocRunDir's name check rejects every non-ad-hoc dir before any stat (whole-branch review triage; ruling #4) |
| 7 | build | No test pins an unresolvable-but-not-missing linked-worktree stamp staying exempt while adhoc-superseded claims it | accepted | adhoc-superseded matches against the worktree list by string, independent of resolveLeaf; only a registered-but-unresolvable worktree stays unswept, which is pathological (Task 2 review + whole-branch review triage) |
| 8 | build | Journey 2724 line 45 'keeps escalating too' lost its referent | fixed | ab3f1794a — now 'still escalates' |
| 9 | build | Journey 2724 success-state line and red flag narrowed to 'linked worktree' | fixed | ab3f1794a — narrowing dropped |
| 10 | build | docs/reconcile-checks.md:280/:287 uneven mid-paragraph wraps | accepted | Cosmetic, below the materiality floor (whole-branch review triage) |
