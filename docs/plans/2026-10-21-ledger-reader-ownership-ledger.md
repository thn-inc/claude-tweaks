# Open Items — Ledger readers outside wrap-up: resolve this run's ledger through the ownership-aware probe, not a docs/plans glob

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `plugin/skills/build/dispatch.md`'s SDD carry-forward sentence restates the pre-#3687 ledger rule (`{ledger path}` = `"$PIPELINE_RUN_DIR/ledger.md"` when that file exists, else the repo-relative `docs/plans/…-ledger.md` path) instead of the probe-first resolution rule; pinned verbatim by `tests/build-sdd-ledger-residue-carryforward.test.js` (M5), excluded from #3687's scope by its plan | observation | Plan Global Constraints excluded it; final whole-branch review Minor 5 — candidate follow-up record at wrap-up |
| 2 | build | ledger-format.md resolution rule — "empty value.files ... not a cue to look further" overstates the probe after the branch merges (merge base = HEAD puts own ledger in unattributedFiles) | deferred | final-review triage: leave (errs toward the safe direction; readers in scope run pre-merge) |
| 3 | build | ledger-format.md resolution rule — value.unattributedFiles is absent on the run-dir ledger.md path (optional key, listing completeness only) | deferred | final-review triage: leave |
| 4 | build | go-red for assertRuleIsProbeFirst uses bare assert.throws (no message matcher) — proves only the first pin goes red | deferred | final-review triage: leave |
| 5 | build | auto-merge-short-circuit.md over-long unwrapped line in a hard-wrapped paragraph (cosmetic) | deferred | final-review triage: leave |
| 6 | build | ALLOWED_RE sentence-level lexical escape (narrowed to "fallback" in 3ef406d48; a sentence naming fallback/inherited still exempts a glob) | deferred | final-review triage: leave |
| 7 | build | SDD ruling — writer clause scoped to "when a run dir resolves, a caller that flips or deletes"; appends and no-run-dir callers take the fallback; ledger resolve stops on a probe failure: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 8 | build | SDD ruling — probe command uses a "{run-dir}" placeholder, never a bare $PIPELINE_RUN_DIR: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 9 | build | SDD ruling — auto-merge short-circuit deletes through hooks.js delete-ledger with Item 2 report handling: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 10 | build | SDD ruling — ALLOWED_RE narrowed to "fallback" plus a pre-#3687 must-fail fixture: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 11 | build | SDD ruling — deferred minors: fix "same glob", leave the rest per final-review triage: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 12 | build | SDD ruling — build/dispatch.md restatement recorded as observation row 1: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 13 | build | SDD ruling — untracked-ledger git rm gap in auto-merge-short-circuit.md (drops Item 2's "only a tracked" qualifier) left for /review, no second SDD fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 14 | build | SDD ruling — wrap-up/SKILL.md:211 ok:false fallback launching a gate that now stops on probe failure left as is: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
