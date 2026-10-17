# Open Items — visual-review recommendation mode should require a frontend-surface signal, not files: overlap alone (#2927)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Pre-flight: origin/main was 35 commits ahead of local main at run start (local 1 ahead: a reconcile archive commit) | fixed | Post-creation catch-up merged origin/main into the worktree branch (b8e62fa28) before materializing |
| 2 | build | Review summary template had no slot for the journeys Step 0.5 suppresses, so the names — the main mitigation for a legacy no-`Surface:` consumer record — would be dropped (whole-branch review I1) | fixed | New "If skipped because … no frontend surface" bullet in review-summary-template.md, test-pinned — 7020bc28e |
| 3 | build | Step 0.5 cites frontend-detection.md's Layer 2 → 3 order but deliberately treats a declared web/mobile/desktop as sufficient without a sniff match — unstated, so an "alignment" edit would reintroduce the risk (whole-branch review M2) | fixed | Sufficiency clause stated and pinned — 7020bc28e |
| 4 | build | materialize.md's header reader table `surface` row omitted visual-review Step 0.5 (whole-branch review M3) | fixed | Row names it — 7020bc28e |
| 5 | build | No negative assertion on the no-surface branch: an appended `> Recommended follow-up:` line passed all 9 tests (SDD Task 1 minor (deferred); whole-branch review mutation M1) | fixed | doesNotMatch on the no-surface paragraph — 7020bc28e |
| 6 | build | Suppressed status `Skipped — no UI changes` carried no reason (e.g. `Surface: terminal` with UI-extension files) (whole-branch review M5) | fixed | The summary records the reason and the journey names — 7020bc28e |
