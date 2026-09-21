## Tidy Report — 2026-09-09

**Applied automatically**
```text
archived      —     2026-09-09T053703-backlog-standalone (clean run)    high (additive move)
reconcile     —     archive-branches: 21 skipped                        reconcile-converged
   skip: 9 merged-pr-without-cherry-equivalence, 11 too-young, 1 pr-open
reconcile     —     remote-prune: 64 skipped                            reconcile-converged
   skip: not-cherry-equivalent / no-merged-pr / pr-open
reconcile     —     release: 7 claims skipped (no-run-state)            reconcile-converged
```

**Approve (5)**
```text
1  [pr]        PR #1908  plan-audit: Check C needs a "Step 2 present but…
   Arm ready PR (record-linked): #1594 granted auto:merge, green, unarmed >24h
   gh pr merge 1908 --auto --repo thomasholknielsen/claude-tweaks
2  [pr]        PR #1885  Distinct bot:parked label for merge-verificatio…
   Close (GitHub): superseded by a newer draft for the same record (rebuilt run); comment first
   gh pr close 1885
3  [gh-issue]  #1878  Doc staleness: plans/2026-08-28-record-1058-ledge…
   Close (GitHub): flagged ledger deleted in #1969 (a40fbdc24) — nothing left to fix
   gh issue close 1878 --reason "not planned"
4  [gh-issue]  #1776  Doc staleness: plans/2026-08-26-record-327-ledger…
   Close (GitHub): flagged ledger deleted in #1819 (eda4fd7aa) — nothing left to fix
   gh issue close 1776 --reason "not planned"
5  [capture]   —      acceptance-gap closed-record fetch truncates at --li…
   Capture: file the spec-shaped record in staged/tidy-capture-1.md (971 closed/30d, 200 scanned)
   /claude-tweaks:capture --source tidy --defer-reason=tangential
```

**Yours (35)** — commands are relative to the repo root
```text
specify (1)
   #666   permittedGrants contract phase — remove flat bornRe…  judgment call, no mechanical fix
   /claude-tweaks:specify #666
demo (17)
   #1987  Skill context composer — per-run bundles composed b…  judgment call, no mechanical fix
   #1904  dispatch / flow pipeline ceremony: a dispatched gro…  judgment call, no mechanical fix
   #1870  release.js's install/update message should also sh…  judgment call, no mechanical fix
   #1864  stampAdHocRunDir always writes its one-shot marker …  judgment call, no mechanical fix
   #1861  run-integrity.js's checkRunIntegrity misses bareInt…  judgment call, no mechanical fix
   #1860  hasNoUpstreamYet misfires on every fresh worktree, …  judgment call, no mechanical fix
   #1802  dispatch Auto-merge gate + consoleAutoResolve: when…  judgment call, no mechanical fix
   #1773  Dispatch headless self-report: flow-step-2.8-claim-…  judgment call, no mechanical fix
   #1772  Dispatch headless self-report: flow-step-2.8-claim-…  judgment call, no mechanical fix
   #1709  Add a byte-ceiling conformance test pinning plugin/…  judgment call, no mechanical fix
   #1637  Doc staleness: plans/2026-08-16-spec-686-687-688-68…  judgment call, no mechanical fix
   #1633  validateShaped lacks the '## Original request' plac…  judgment call, no mechanical fix
   #1566  record-worktree's shared resolveRunArg accepts any …  judgment call, no mechanical fix
   #1558  detectIntegrationModel shells `gh repo view` direct…  judgment call, no mechanical fix
   #1546  Open question: materialize the dispatch queue ranke…  judgment call, no mechanical fix
   #1502  pre-compact hook can mark a live multi-spec run "cl…  judgment call, no mechanical fix
   #1457  worktree isolation: a run directory minted after wo…  judgment call, no mechanical fix
   /claude-tweaks:demo #1987,#1904,#1870,#1864,#1861,#1860,#1802,#1773,#1772
   /claude-tweaks:demo #1709,#1637,#1633,#1566,#1558,#1546,#1502,#1457
git (5)
   —      [git] .claude/worktrees/agent-a97b6fa2589f7ca3f       dirty (M docs/hooks.md), manual review
   —      [git] .claude/worktrees/dispatch-record-1337          dirty (?? ledger), manual review
   —      [git] .claude/worktrees/dispatch-record-1725          dirty (?? run dir), manual review
   —      [git] .claude/worktrees/dispatch-record-457           dirty (?? ledger), manual review
   —      [git] .claude/worktrees/record-1471                   dirty (?? work/*), manual review
   git -C ".claude/worktrees/agent-a97b6fa2589f7ca3f" status --porcelain
   git -C ".claude/worktrees/dispatch-record-1337" status --porcelain
   git -C ".claude/worktrees/dispatch-record-1725" status --porcelain
   git -C ".claude/worktrees/dispatch-record-457" status --porcelain
   git -C ".claude/worktrees/record-1471" status --porcelain
backlog refine (5)
   #1996  Subagent skill-tree read gate: pre-tool-use denies …  bot:blocked, judgment call
   #1894  pre-tool-use find+variable gate over-triggers a git…  bot:blocked, judgment call
   #1890  Live-verify create_webhook_trigger request/response…  bot:blocked, judgment call
   #666   permittedGrants contract phase — remove flat bornRe…  bot:blocked, judgment call
   #1909  Instruction-prose diet: operative skill text states…  its PR is ready, no auto:merge grant
   /claude-tweaks:backlog refine
gh (4)
   —      [pr] PR #2089 Capture: dispatch MCP transport gap     awaiting review, optional look
   —      [pr] PR #2088 Confirm RemoteTrigger update persists…  awaiting review, optional look
   —      [pr] PR #1986 dispatch/task-prompt.md: warn dispatch…  awaiting review, optional look
   —      [pr] PR #1972 Port non-duplicate review fixes forwa…  awaiting review, optional look
   gh pr view 2089 --web
   gh pr view 2088 --web
   gh pr view 1986 --web
   gh pr view 1972 --web
node (2)
   —      [calibration] decision-records: 0 findings / 21 runs  narrow the gate — judgment call
   —      [calibration] upstream: 0 findings / 21 runs          narrow the gate — judgment call
   node plugin/bin/calibration-report.js --runs 50
review (1)
   —      [warning] parent-gate state map hit fetch limit      1000 fetched; 0 unknown sub-issues
```

**Clean:**
```text
work records       305 checked
design docs        0 checked
plans              0 checked
ledgers            10 checked
doc registry       19 checked
build branches     0 checked
artifact residue   0 checked
release triple     1 checked
issue claims       732 checked
claim backstops    4 checked
health issues      7 checked
parent-gate        4 checked
digest             1 checked
patterns           29 checked
```

Full decision log: .claude-tweaks/pipelines/2026-09-09T145100-sweep-standalone/decisions.md
