## Tidy Report — 2026-09-30

**Applied automatically**
```text
compacted    —       2026-08-12T204800-tidy-standalone                   index-2026-08
compacted    —       2026-08-20T065433-record-546                        index-2026-08
compacted    —       2026-08-26T191436-record-573                        index-2026-08
compacted    —       2026-08-28T041646-record-903                        index-2026-08
archived     —       2026-09-21T032454-release-standalone                high
archived     —       2026-09-29T105522-dispatch-standalone               high
archived     —       2026-09-29T115439-backlog-standalone                high
archived     —       2026-09-29T140150-dispatch-standalone               high
archived     —       2026-09-29T154218-backlog-standalone                high
archived     —       2026-09-29T162837-dispatch-standalone               high
archived     —       2026-09-29T183019-dispatch-standalone               high
archived     —       2026-09-29T183057-spec-2827-2828                    high
removed wt   #2756   thn-inc-owner-refs                                  PR merged at tip; branch kept
removed wt   #2824   dispatch-record-2735                                PR merged at tip; branch kept
removed wt   #2833   dispatch-record-2736                                PR merged at tip; branch kept
removed wt   #2831   dispatch-record-2792                                PR merged at tip; branch kept
removed wt   #2818   dispatch-record-2811                                PR merged at tip; branch kept
removed wt   #2817   dispatch-record-2816                                PR merged at tip; branch kept
removed wt   #2754   fix-cloud-setup-browser-deps                        PR merged at tip; branch kept
removed wt   #2463   pr2463-triage                                       PR merged at tip; branch kept
removed wt   #2570   pr2570-triage                                       PR merged at tip; branch kept
removed wt   #2635   pr2635-triage                                       PR merged at tip; branch kept
removed wt   #2637   pr2637-triage                                       PR merged at tip; branch kept
removed wt   #2378   record-1936-1996-2008-2063-2080-2282-2332-2344-23…  PR merged at tip; branch kept
removed wt   #2450   record-2259-resume                                  PR merged at tip; branch kept
removed wt   #2752   release-please-token-wire                           PR merged at tip; branch kept
removed wt   #2814   resolve-ledgers                                     PR merged at tip; branch kept
removed wt   #2535   worktree-record-1728                                PR merged at tip; branch kept
removed wt   #2712   worktree-record-2563                                PR merged at tip; branch kept
removed wt   #2715   worktree-record-2567                                PR merged at tip; branch kept
removed wt   —       dispatch-record-2573 (+ branch -D, net-empty)       tip b0cb081d
deleted plan #2792   2026-09-29-prose-code-twin-pin-skill.md             commit e5f6d32fb
deleted plan #2593   2026-09-21-plan-audit-checkc-vcs-refusal.md         commit ca5ff478b
deleted plan #2621   2026-09-20-harness-health-premise-check.md          commit dcaf1a5ed
deleted plan #2541   2026-09-19-multispec-freshness-unattended-default…  commit 0e7d4d573
deleted plan #2472   2026-09-17-pr-bookkeeping-precondition-check.md     commit db8405023
deleted plan #2266   2026-09-16-status-line-migration-wu2.md             commit 86a2b25db
deleted plan #2523   2026-09-16-reconcile-mcp-gap-docs.md                commit e82b7c94d
deleted plan #2492   2026-09-16-flow-step-2.8-claim-audit-trail.md       commit cbb1a0dac
deleted plan #1752   2026-09-14-dispatch-unified-exclusions.md           commit dc0315bf1
deleted plan #1676   2026-09-14-curation-engine-git-mutation-carveout.…  commit 8aba6dc4a
```

**Approve (7)**
```text
1  [capture]  #—  readClaimBlobsGitBatch rejects string input + bu…
   Capture defect: batch runner string input + encoding buffer → every blob fails
   /claude-tweaks:capture (body: staged/tidy-capture-1.md)
2  [capture]  #—  github-pr-scan item 10 PR fetch exceeds GraphQL n…
   Capture defect: bulk PR fetch exceeds the 500k GraphQL node cap above ~50 PRs
   /claude-tweaks:capture (body: staged/tidy-capture-2.md)
3  [capture]  #—  acceptance-gap counts NOT_PLANNED closures as gaps
   Capture defect: needsBackstop ignores stateReason (188 of 581 not-planned)
   /claude-tweaks:capture (body: staged/tidy-capture-3.md)
4  [parked]  #2668  Add XSS / upload / webhook-signature checks to se…
   Promote — parked trigger met (#2624 closed 2026-09-23)
   /claude-tweaks:specify #2668
5  [parked]  #2667  Add an AI-generated-design-tells checklist
   Promote — parked trigger met (#2655 closed)
   /claude-tweaks:specify #2667
6  [parked]  #2664  Add check-pr-bookkeeping.js CLI-level regression …
   Promote — parked trigger met (its blocker PR merged 2026-09-20)
   /claude-tweaks:specify #2664
7  [parked]  #2633  Self-validate a health-skill Premise-check comman…
   Promote — parked trigger met (#2621 closed 2026-09-23)
   /claude-tweaks:specify #2633
```

**Yours (39)**
```text
specify (2)
   #2663   Add legal/compliance pre-launch questions to the …  missing risk+size labels
   #2666   Add secrets-manager + rotation check to the secur…  missing risk+size labels
   /claude-tweaks:specify #2663,#2666
git (10)
   —       agent-a97b6fa2589f7ca3f                             dirty — manual review
   —       dispatch-record-1337                                dirty — manual review
   —       dispatch-record-1725                                dirty — manual review
   —       dispatch-record-2785                                dirty — manual review
   —       dispatch-record-457                                 dirty — manual review
   —       record-1471                                         dirty — manual review
   —       record-1686-1733-1734-1737-1738-2225                dirty — manual review
   —       design-2786-release-note-remediation                locked, pid 55091 gone — review
   —       backlog-refine                                      unmerged, 9 ahead, no PR — review
   —       backlog-refine-2718-2730                            unmerged, 1 ahead, no PR — review
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f status --short
   git -C .claude/worktrees/dispatch-record-1337 status --short
   git -C .claude/worktrees/dispatch-record-1725 status --short
   git -C .claude/worktrees/dispatch-record-2785 status --short
   git -C .claude/worktrees/dispatch-record-457 status --short
   git -C .claude/worktrees/record-1471 status --short
   git -C .claude/worktrees/record-1686-1733-1734-1737-1738-2225 status --short
   git -C .claude/worktrees/design-2786-release-note-remediation status --short
   git -C .claude/worktrees/backlog-refine status --short
   git -C .claude/worktrees/backlog-refine-2718-2730 status --short
backlog refine (15)
   #1350   Verify /specify red-team fan-out batching at next…  bot:blocked — retry ceiling hit
   #2051   Concrete near-miss on the open-linked-PR exclusio…  bot:blocked — retry ceiling hit
   #2566   reconcile: worktree reap fails with "Filename too…  bot:blocked — retry ceiling hit
   #2573   upstream-drift checkOneFixture cannot assert plai…  bot:blocked — retry ceiling hit
   #2628   Add App Store rejection checklist for vibecoded a…  bot:blocked — retry ceiling hit
   #2657   Add JWT algorithm-confusion checks to the securit…  bot:blocked — retry ceiling hit
   #2663   Add legal/compliance pre-launch questions to the …  bot:blocked — retry ceiling hit
   #2666   Add secrets-manager + rotation check to the secur…  bot:blocked — retry ceiling hit
   #2676   wrap-up verify: carrier-commit check only matches…  bot:blocked — retry ceiling hit
   #2688   bin/wrap-up-engine.js: render fails silently when…  bot:blocked — retry ceiling hit
   #2705   pr-first-merge: auto-merge reporting doesn't read…  bot:blocked — retry ceiling hit
   #2710   /test: migrate qa-prompts.md and qa-procedures.md…  bot:blocked — retry ceiling hit
   #2737   Skill drift: skill-prose-conformance-tests — Bind…  harness-health issue, still valid
   #2738   Skill best-practice: skill-prose-conformance-test…  harness-health issue, still valid
   #2785   Doc staleness: decisions/0019-vendored-gif-codec-…  docs-health issue, still valid
   /claude-tweaks:backlog refine
flow (1)
   #2564   dispatch: queue-pull-script.md's multi-line `node…  unsettled: live claim 25h, no closing PR
   /claude-tweaks:flow #2564
gh (3)
   #2822   Split issues/record.js into cohesive sub-modules    draft PR silent 25h — unsettled
   #2843   Add GDPR account-deletion vs. backup-retention ch…  green, unarmed, no auto:merge grant
   #2846   Audit skill-authoring guidance for Claude Fable 5…  green, unarmed, no auto:merge grant
   gh pr view 2822 --web
   gh pr view 2843 --web
   gh pr view 2846 --web
release (1)
   #2849   chore(main): release 6.132.0                        release PR green, awaiting review
   /claude-tweaks:release
review (7)
   —       [health] acceptance-gap: 581 closed, no dispositi…  scan/acceptance.txt; see capture 3
   —       [health] 49 aged run dirs collide with archive/     compaction skipped; shells only
   —       [health] plan 2026-09-18-declined-learning-… kept   cited by declined-learning/store.js
   —       [health] reconcile skipped all checks (budget)      18 kept branches await archive-branches
   —       [health] 4 non-canonical run-dir names skipped      e.g. 20260829T220736-tidy-standalone
   —       [health] Fast scan agents sampled/truncated output  4.5/4.7/4.8 re-run centrally
   —       [calibration] 0 findings in 21 runs: 2 registry r…  decision-records, upstream — narrow?
```

**Clean:**
```text
design docs        0 checked
ledgers            0 checked
registry           19 checked
issue claims       1293 checked
claim backstops    4 checked
unfiled drafts     0 checked
parent gate        100 checked
digest             1 checked
sizing             106 checked
patterns           5 checked
```

Full decision log: .claude-tweaks/pipelines/2026-09-30T172538-tidy-standalone/decisions.md
