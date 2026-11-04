# Open Items — Host-qualify the origin-derived repo slug (#4794)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 40 commits ahead of the resumed branch at run start | fixed | Caught up by Post-creation catch-up merge a499ee880 |
| 2 | ops | Pre-flight branch-divergence-check (run 2026-11-03T083002): origin/main was 23 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge of origin/main 3ebed678f |
| 3 | ops | Shape check hard-fail signal: plan Task 4 declares 8 files (4 modified + 4 tests), over the 5-file ceiling; auto proceeded | fixed | Plan revised (commit 4140a9086); no task now declares more than 5 files — run 2026-11-04T045629's shape check passed |
| 4 | ops | Pre-flight branch-divergence-check (run 2026-11-03T163447): origin/main was 19 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge 094dd57b1 |
| 5 | ops | Pre-flight branch-divergence-check (run 2026-11-04T045629): origin/main was 25 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge deca56e82 |
| 6 | ops | Pre-flight branch-divergence-check (run 2026-11-04T061219): origin/main was 5 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge ccd22e5c7 |
| 7 | ops | Pre-flight branch-divergence-check (run 2026-11-04T100347): origin/main was 5 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge 0eddcac33 |
| 8 | build | SDD ruling — P1 Review Focus 11's "`--repo github.com/{owner}/{repo}`" clause for upstream-feedback is stale; Task 20 (n...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 9 | build | SDD ruling — P2 Task 16's repo-wide `git grep -n repoSlugOf` expectation excludes Task 10's own conformance guard lines ...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 10 | build | SDD ruling — P3 Task 16 rewrites `.claude/skills/gh-api-module-pattern/SKILL.md` :73's `repoSlugOf` mentions to past ten...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 11 | build | SDD ruling — P4 Task 6: when the pr-state not-found probe's gate refuses an origin, the by-number resolver returns `'unk...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 12 | build | SDD ruling — P5 Task 15 also modifies `plugin/bin/lib/hooks/teardown-run.js` so its refusal line carries the reason word...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 13 | build | SDD ruling — P6 One GH_HOST reader: Task 2 adds and exports `ghHostIn(env)` from repo-resolve.js (returns `normalizeHost...: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 14 | build | SDD ruling — P7 Task 14: drop the `HOST_DEFINITION.endsWith(...)` self-check (asserts nothing) and assert against the pr...: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 15 | build | SDD ruling — P8 Every task's new tests must go red against the pre-task code (dispatch-rules.md requires the proof): Tas...: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 16 | build | SDD ruling — P9 Task 18 also adds `stale-claim-pr.js` to `docs/plugin-structure.md` :140's gate roster and the journey's...: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 17 | build | SDD ruling — P6 extended — Task 17 also (a) makes `ghHostIn` return `normalizeHost(trimmed) \|\| null` (a GH_HOST like '.'...: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 18 | build | SDD ruling — the brief's "boundedError's 200-character bound still applies to the stored text" is overridden for the ref...: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 19 | build | SDD ruling — RECORD — ~14 gated CLIs still print the unresolved-origin hint "pass --repo owner/name" though they accept ...: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 20 | build | SDD ruling — RECORD — the three raw origin readers that refuse nothing (engine-verify carrier-commit and reference-repai...: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 21 | build | SDD ruling — RECORD — plugin/bin/lib/log-decision/claim-log.js's `resume-pr:` regex is github.com-only; it calls no gh, ...: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 22 | build | SDD ruling — RECORD — pr-merge-state.js:134 also reports a by-number `pr-not-found` as read-failed 'unparseable' (pre-ex...: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 23 | build | SDD ruling — RECORD — archive-merged.js:2773's clean-sweep `recordCheck: { repoRefusal }` (fix-wave item 9) is unpinned:...: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 24 | build | SDD ruling — reviewer Important confirmed — activity-gather.js:122's off-host check compares the raw `spec.host`, so `ht...: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 25 | build | SDD ruling — reviewer ⚠️ confirmed a real gap — stale-claim-pr.js:217's exit-3 stderr hint "pass --repo owner/name" and ...: ratify or reverse at the Review Console (staged/sdd-ruling-18.md) | open | — |
| 26 | build | SDD ruling — format-summary.js's boundDetail (ERR_TEXT_MAX 300) truncates a real SSH-remote gate refusal (330-343 chars)...: ratify or reverse at the Review Console (staged/sdd-ruling-19.md) | open | — |
| 27 | build | SDD ruling — P4's new `'unknown-host'` by-number state must not fall through archive-merged's closed `decideArchiveCore`...: ratify or reverse at the Review Console (staged/sdd-ruling-20.md) | open | — |
