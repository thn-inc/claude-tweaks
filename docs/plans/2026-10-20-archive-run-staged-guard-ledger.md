# Open Items — archive-run archives a closed run with no rendered console regardless of pending staged/ items (#3668)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | ENOTDIR literal in listStagedItems unit test assumes POSIX readdir-on-file code; CI ubuntu-only (existing hasStagedItems ENOTDIR tests share the assumption) | deferred | SDD Task 1 deferred minor |
| 2 | build | manifesto-authorized-merge.md:58-59 log template is hard-wrapped between `verdict` and `auto-merge`; an agent copying it literally across lines would not match the archive-run gate regex (fails safe: guard stays off) | fixed | Unwrapped the template to one line in wrap-up; the live-template twin pin in archive-merged.test.js covers it |
| 3 | build | SDD ruling — gate signal = canonical 'auto-merge: issue #N, assess-agent-autonomy verdict auto-merge' line + terminal-decision exemption, not the free-form 'Auto-merge short-circuit: #N' marker: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 4 | build | SDD ruling — dispatch bundle Auto-merge gate lines not matched by the archive-run gate; routed as a follow-up record: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
