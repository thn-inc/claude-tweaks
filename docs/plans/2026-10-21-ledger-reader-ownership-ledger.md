# Open Items — Ledger readers outside wrap-up: resolve this run's ledger through the ownership-aware probe, not a docs/plans glob

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `plugin/skills/build/dispatch.md`'s SDD carry-forward sentence restates the pre-#3687 ledger rule (`{ledger path}` = `"$PIPELINE_RUN_DIR/ledger.md"` when that file exists, else the repo-relative `docs/plans/…-ledger.md` path) instead of the probe-first resolution rule; pinned verbatim by `tests/build-sdd-ledger-residue-carryforward.test.js` (M5), excluded from #3687's scope by its plan | observation | Plan Global Constraints excluded it; final whole-branch review Minor 5 — candidate follow-up record at wrap-up |
