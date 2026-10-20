# Open Items — archive-run archives a closed run with no rendered console regardless of pending staged/ items (#3668)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | ENOTDIR literal in listStagedItems unit test assumes POSIX readdir-on-file code; CI ubuntu-only (existing hasStagedItems ENOTDIR tests share the assumption) | deferred | SDD Task 1 deferred minor |
| 2 | build | manifesto-authorized-merge.md:58-59 log template is hard-wrapped between `verdict` and `auto-merge`; an agent copying it literally across lines would not match the archive-run gate regex (fails safe: guard stays off) | deferred | SDD final re-review out-of-scope observation; disposed by item #5 |
| 3 | build | SDD ruling — gate signal = canonical 'auto-merge: issue #N, assess-agent-autonomy verdict auto-merge' line + terminal-decision exemption, not the free-form 'Auto-merge short-circuit: #N' marker: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 4 | build | SDD ruling — dispatch bundle Auto-merge gate lines not matched by the archive-run gate; routed as a follow-up record: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 5 | wrap-up | Disposition of item #2: the Manifesto-authorized log template in manifesto-authorized-merge.md was unwrapped to a single line, and archive-merged.test.js now pins all three producer templates against the detector | fixed | commit 876748473 |
| 6 | wrap-up | Disposition of item #1: the ENOTDIR literal assumes POSIX readdir-on-a-file; on Windows that call reports ENOENT, which the staged-items walk treats as absent by design, so the case is inherently POSIX | accepted | CI is ubuntu-only and the three existing ENOTDIR tests (#3249, #3416) share the assumption; changing only this one would leave the file inconsistent, and no probe-derived literal can express the Windows shape |
| 7 | wrap-up | pr — PR #3725 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | |
| 8 | wrap-up | Residue sweep ran with --no-suite (the wrap-up fact pack never re-runs the suite); suite state comes from the verify runner stamp: tests 13931, pass 13924, fail 0 at 108ed2199 | observation | |
