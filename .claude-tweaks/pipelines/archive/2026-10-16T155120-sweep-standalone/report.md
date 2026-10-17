## Tidy Report — 2026-10-16

**Applied automatically**
```text
deleted      —     20 orphaned plans + 3040 ledger (records closed)       commit 58df808a9
filled-note  #3204 Flaky-retry's unattributedFailureCount has no acc…   snapshot saved
   Flaky-test retries no longer hide unaccounted failures in summary-style test output.
filled-note  #3160 flow Manifesto's ceremony-profile fold defaults to…   snapshot saved
   Pipeline runs on records filed by health sweeps now get a ceremony level matched to the work…
```

**Approve (6)**
```text
1  [git]  #—  17 clean run dirs never archived
   Archive each (status clean); list in staged/tidy-archive-runs-1.md
   node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run <dir> (x17, per .md)
2  [ledger]  #—  2026-10-02-flow-spec-2701-2705-ledger.md
   Delete orphan ledger (run archived, no open rows)
   git rm docs/plans/2026-10-02-flow-spec-2701-2705-ledger.md
3  [ledger]  #3010  Doc staleness: 2701-2705 ledger, Item 1
   Close (GitHub), moot once the ledger is deleted
   gh issue close 3010 --reason "not planned"
4  [ledger]  #3011  Doc staleness: 2701-2705 ledger, Item 2
   Close (GitHub), moot once the ledger is deleted
   gh issue close 3011 --reason "not planned"
5  [ledger]  #—  2026-10-02-record-2740-bundle-ledger.md
   Delete orphan ledger (run archived, no open rows)
   git rm docs/plans/2026-10-02-record-2740-bundle-ledger.md
6  [ledger]  #3037  Doc staleness: 2740 bundle ledger, Item 5
   Close (GitHub), moot once the ledger is deleted
   gh issue close 3037 --reason "not planned"
```

**Yours (33)**
```text
/claude-tweaks:specify (4)
   #3191 /claude-tweaks:capture should search open PRs for…  judgment call: missing risk/size
   #3030 check-sibling-sessions: --record N reads only loc…  judgment call: too large, 16 items
   #3028 compose-subject.js: handled issueType rejection     judgment call: too large, 21 items
   #3005 test: QA dispatch rewrites a story url origin       judgment call: too large, 15 items
   /claude-tweaks:specify #3191,#3030,#3028,#3005
/claude-tweaks:demo (3)
   #3125 Skill drift: node-test-output-evidence — Key Patt…  closed, no acceptance disposition
   #2914 Two-call /flow dispatch handoff: config.yml missi…  closed, no acceptance disposition
   #2859 Ledger-acknowledged pre-existing test failures bl…  closed, no acceptance disposition
   /claude-tweaks:demo #3125,#2914,#2859
git (11)
   —     worktree agent-a97b6fa2589f7ca3f                    dirty, manual review
   —     worktree dispatch-record-1337                       dirty, manual review
   —     worktree dispatch-record-1725                       dirty, manual review
   —     worktree dispatch-record-2785                       dirty, manual review
   —     worktree dispatch-record-3062                       dirty, manual review
   —     worktree dispatch-record-457                        dirty, manual review
   —     worktree record-1471                                dirty, manual review
   —     worktree record-1686-1733-1734-1737-1738-2225       dirty, manual review
   —     worktree backlog-refine                             unmerged, manual review
   —     worktree backlog-refine-2718-2730                   unmerged, manual review
   —     worktree record-2840                                unmerged, manual review
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f status --short
   git -C .claude/worktrees/dispatch-record-1337 status --short
   git -C .claude/worktrees/dispatch-record-1725 status --short
   git -C .claude/worktrees/dispatch-record-2785 status --short
   git -C .claude/worktrees/dispatch-record-3062 status --short
   git -C .claude/worktrees/dispatch-record-457 status --short
   git -C .claude/worktrees/record-1471 status --short
   git -C .claude/worktrees/record-1686-1733-1734-1737-1738-2225 status --short
   git log --oneline origin/main..worktree-backlog-refine
   git log --oneline origin/main..worktree-backlog-refine-2718-2730
   git log --oneline origin/main..worktree-record-2840
/claude-tweaks:backlog refine (1)
   #3200 Skill best-practice: prose-code-twin-pin — Anti-P…  still-valid harness-health issue
   /claude-tweaks:backlog refine
gh (2)
   #3211 chore(main): release 6.142.0                        awaiting review, CI clean
   #3203 Byte-budget tests count CRLF bytes on Windows       awaiting review, CI clean
   gh pr view 3211 --web
   gh pr view 3203 --web
node (1)
   —     [calibration] decision-records, upstream rows: 0 …  consider narrowing the gate
   node "$CLAUDE_PLUGIN_ROOT/bin/calibration-report.js" --runs 50
review (11)
   #2448 Dispatch/tidy: a swept stale claim with a still-o…  parked: trigger not machine-judged
   #2247 npm test has no live hard gate on the 40KB ceiling  parked: trigger not machine-judged
   #1597 Consider a state-machine plan-markdown parser       parked: trigger not machine-judged
   #986  Live-verify the chunked Instructions-fill procedu…  parked: trigger not machine-judged
   #794  GitHub App installation identity for the fleet      parked: trigger not machine-judged
   #279  Event-driven dispatch via GitHub webhook trigger    parked: trigger not machine-judged
   #159  Decide whether work-backend keys move to policy.y…  parked: trigger not machine-judged
   #127  Scope harness-health's run log + churn-report       parked: trigger not machine-judged
   #126  Reconsider a grouping-by-blocker affordance         parked: trigger not machine-judged
   —     [digest] Step 5.6 sweep returned no result          unverified, re-run --scope=github
   —     [claim] Step 4.7 backstops not separately reported  unverified, re-run --scope=claims
```

**Clean:**
```text
records            160 checked
design docs        0 checked
registry           1 checked
claims             10 checked
sizing             137 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-16T155120-sweep-standalone/decisions.md
