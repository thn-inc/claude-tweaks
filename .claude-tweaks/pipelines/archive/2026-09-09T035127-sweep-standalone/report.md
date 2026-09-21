## Tidy Report — 2026-09-09

**Applied automatically**
```text
deleted      #1804  plan 2026-09-05-record-1804-stale-ledger-citation.md    commit 4c5331901
deleted      #1442  plan 2026-09-05-refine-mode-untrusted-record-content-1…  commit 4c5331901
deleted      #1921  plan 2026-09-05-runner-verify-stamp-1921.md             commit 4c5331901
deleted      #1596  plan 2026-09-05-subagent-output-contract-status-line-1…  commit 4c5331901
deleted      #1822  plan 2026-09-05-sweep-next-actions-tidy-approve-order-…  commit 4c5331901
deleted      #1932  plan 2026-09-06-auto-mode-ceremony-gate-and-console-re…  commit 4c5331901
deleted      #1988  plan 2026-09-06-compose-context-1988.md                 commit 4c5331901
deleted      #1990  plan 2026-09-06-composed-bytes-measurement-1990.md      commit 4c5331901
deleted      #1926  plan 2026-09-06-fast-lane-skip-roster-1926.md           commit 4c5331901
deleted      #1925  plan 2026-09-06-flaky-retry-allowlist-1925.md           commit 4c5331901
deleted      #1931  plan 2026-09-06-flow-preflight-pack-1931.md             commit 4c5331901
deleted      #1989  plan 2026-09-06-merge-path-markers-1989.md              commit 4c5331901
deleted      #1991  plan 2026-09-06-mode-attendance-markers-1991.md         commit 4c5331901
deleted      #1927  plan 2026-09-06-multi-session-drain-lease-export-1927.…  commit 4c5331901
deleted      #1928  plan 2026-09-06-per-phase-timing-telemetry-1928.md      commit 4c5331901
deleted      #1994  plan 2026-09-06-pipeline-step-call-sites-1994.md        commit 4c5331901
deleted      #1997  plan 2026-09-06-retire-per-file-byte-pins-1997.md       commit 4c5331901
deleted      #1995  plan 2026-09-06-subagent-boundary-1995.md               commit 4c5331901
deleted      #1929  plan 2026-09-06-tokens-per-phase-1929.md                commit 4c5331901
deleted      #1992  plan 2026-09-06-transport-markers-1992.md               commit 4c5331901
deleted      #1922  plan 2026-09-06-verify-scope-engine-1922.md             commit 4c5331901
deleted      #1924  plan 2026-09-06-verify-scope-starter-1924.md            commit 4c5331901
deleted      #1923  plan 2026-09-06-wire-scoped-verification-1923.md        commit 4c5331901
deleted      #1993  plan 2026-09-06-worktree-policy-markers-1993.md         commit 4c5331901
deleted      #1930  plan 2026-09-06-wrap-up-pack-1930.md                    commit 4c5331901
deleted      #1876  plan 2026-09-07-worktree-guard-false-positive-addenda-…  commit 4c5331901
deleted      #2014  plan 2026-09-08-artifact-overwrite-append-check-2014.md  commit 4c5331901
deleted      #1906  plan 2026-09-08-blast-radius-pipeline-artifact-exclusi…  commit 4c5331901
deleted      #2009  plan 2026-09-08-dispatch-skill-reporting-configuration…  commit 4c5331901
deleted      —      plan 2026-09-08-gh-available-helper.md (shipped)        commit 4c5331901
deleted      #1484  ledger 2026-09-04-record-1484-ledger.md                 commit 4c5331901
deleted      #1806  ledger 2026-09-05-record-1806-ledger.md                 commit 4c5331901
deleted      #1903  ledger 2026-09-08-record-1903-ledger.md                 commit 4c5331901
deleted      #1964  ledger 2026-09-08-record-1964-ledger.md                 commit 4c5331901
deleted      —      local branch dispatch-record-1684 (merged into main)    reversibility high
deleted      —      branch worktree-dispatch-resume-merges (cherry-equiv)   reconcile-converged
deleted      —      branch worktree-specify-1441-1100 (cherry-equivalent)   reconcile-converged
archived     —      run 20260809T143602-backlog-standalone (30 d)           reversibility high
archived     —      run 2026-08-06T224105-spec-141 (split copy merged)      reversibility high
archived     —      run 2026-08-07T171359-spec-176-… (split copy merged)    reversibility high
archived     —      run 2026-08-09T055441-spec-237-238-241 (split merged)   reversibility high
archived     —      run 2026-08-09T120112-causal-depth-contract (merged)    reversibility high
archived     —      run 2026-08-09T191318-spec-295-296-297 (split merged)   reversibility high
marked       #1135  needs:decision posted for the staged claim release      reversibility high
marked       #1537  needs:decision posted for the staged claim release      reversibility high
marked       #1570  needs:decision posted for the staged claim release      reversibility high
marked       #605   needs:decision posted for the staged claim release      reversibility high
   skipped by reconcile: archive-branches 21 (10 merged-pr-without-cherry-equivalence, 10 too-young, 1 pr-open)
   skipped by reconcile: remote-prune 86 (41 not-cherry-equivalent, 34 no-merged-pr, 11 pr-open)
   skipped by reconcile: claim release 9 (no-run-state), reap (budget-exceeded), mirror ff (dirty)
```

**Approve (6)**
```text
1  [git]       —      prune 23 merged remote branches (origin/worktree-record-* …)
   Delete 23 remote-tracking branches already merged into origin/main (pushed deletion)
   git push origin --delete {each of the 23 branches in staged/tidy-git-remote-prune-1.md}
2  [claim]     #1135  build: copy surviving SDD deferred-minor ledger lines i…
   Release stale claim (run 2026-09-05T101737-record-1135, PR #1895 silent since 2026-09-05)
   releasePayload swept: stale claim -> claims/issue-1135.json; gh issue edit 1135 --remove-label bot:in-progress
3  [claim]     #1537  CLAUDE.md drift: CLAUDE — Auto-Mode Contract + Bookend…
   Release stale claim (run 2026-09-05T132902-record-1537, PR #1902 silent since 2026-09-05)
   releasePayload swept: stale claim -> claims/issue-1537.json; gh issue edit 1537 --remove-label bot:in-progress
4  [claim]     #1570  /claude-tweaks:review's flow-context full-mode default…
   Release stale claim (run 2026-09-05T143054-record-1570, PR #1905 silent since 2026-09-05)
   releasePayload swept: stale claim -> claims/issue-1570.json; gh issue edit 1570 --remove-label bot:in-progress
5  [claim]     #605   Distinct bot:parked label for merge-verification parks…
   Release stale claim (run record-605, PR #1885 silent since 2026-09-05, test check failing)
   releasePayload swept: stale claim -> claims/issue-605.json; gh issue edit 605 --remove-label bot:in-progress
6  [registry]  —      docs/REGISTRY.md row docs/diagrams/*.html — directory does not exist
   Fix now: delete the row, or keep it as the placeholder /visualize creates on first use
   edit docs/REGISTRY.md:25
```

**Yours (54)**
```text
demo (17)
   #1987  Skill context composer — per-run bundles composed by…    judgment call, no mechanical fix
   #1904  dispatch / flow pipeline ceremony: a dispatched group…    judgment call, no mechanical fix
   #1870  release.js's install/update message should also show…    judgment call, no mechanical fix
   #1864  stampAdHocRunDir always writes its one-shot marker on…    judgment call, no mechanical fix
   #1861  run-integrity.js's checkRunIntegrity misses bareInteg…    judgment call, no mechanical fix
   #1860  hasNoUpstreamYet misfires on every fresh worktree, si…    judgment call, no mechanical fix
   #1802  dispatch Auto-merge gate + consoleAutoResolve: when a…    judgment call, no mechanical fix
   #1773  Dispatch headless self-report: flow-step-2.8-claim-co…    judgment call, no mechanical fix
   #1772  Dispatch headless self-report: flow-step-2.8-claim-co…    judgment call, no mechanical fix
   #1709  Add a byte-ceiling conformance test pinning plugin/sk…    judgment call, no mechanical fix
   #1637  Doc staleness: plans/2026-08-16-spec-686-687-688-689-…    judgment call, no mechanical fix
   #1633  validateShaped lacks the '## Original request' placeh…    judgment call, no mechanical fix
   #1566  record-worktree's shared resolveRunArg accepts any re…    judgment call, no mechanical fix
   #1558  detectIntegrationModel shells `gh repo view` directly…    judgment call, no mechanical fix
   #1546  Open question: materialize the dispatch queue ranked …    judgment call, no mechanical fix
   #1502  pre-compact hook can mark a live multi-spec run "clea…    judgment call, no mechanical fix
   #1457  worktree isolation: a run directory minted after work…    judgment call, no mechanical fix
   /claude-tweaks:demo #1987,#1904,#1870,#1864,#1861,#1860,#1802,#1773,#1772,#1709,#1637,#1633,#1566,#1558,#1546,#1502,#1457
git (7)
   —      [git] worktree agent-a97b6fa2589f7ca3f dirty (M docs/hooks.md)    dirty — manual review required
   —      [git] worktree dispatch-record-1337 dirty; its PR #1551 merged    dirty — manual review required
   —      [git] worktree dispatch-record-1725 dirty (?? run dir copy)       dirty — manual review required
   —      [git] worktree dispatch-record-457 dirty (?? ledger)              dirty — manual review required
   —      [git] worktree record-1471 dirty (9 untracked work/ files)        dirty — manual review required
   —      [git] main checkout: 23 staged archive renames + 2 deletions      stranded uncommitted state
   —      [git] main checkout: local main 405 behind / 4 ahead of origin    reconcile ff blocked (dirty)
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/agent-a97b6fa2589f7ca3f" status
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-1337" status
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-1725" status
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-457" status
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-1471" status
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" status
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" log --oneline origin/main..main
backlog refine (11)
   #1996  Subagent skill-tree read gate: pre-tool-use denies a …    bot:blocked — judgment call, no mechanical fix
   #1894  pre-tool-use find+variable gate over-triggers a git-w…    bot:blocked — judgment call, no mechanical fix
   #1890  Live-verify create_webhook_trigger request/response s…    bot:blocked — judgment call, no mechanical fix
   #1878  Doc staleness: plans/2026-08-28-record-1058-ledger — …    bot:blocked; flagged ledger no longer exists
   #1776  Doc staleness: plans/2026-08-26-record-327-ledger — O…    bot:blocked; flagged ledger no longer exists
   #666   permittedGrants contract phase — remove flat bornRead…    bot:blocked — judgment call, no mechanical fix
   #1970  CLAUDE.md structure: retire dead content in CLAUDE — …    by:harness-health still valid, needs a grant
   #2056  Skill drift: run-directory-fact-packs — The shape          by:harness-health still valid, needs a grant
   #2058  Doc staleness: plans/2026-09-05-record-1687-ledger — …    by:docs-health still valid, needs a grant
   #2059  Doc staleness: plans/2026-09-05-record-1775-ledger — …    by:docs-health still valid, needs a grant
   —      [queue] 22 pending authorization, 6 bot:blocked, 258 backlog   granting is refine's job, never tidy's
   /claude-tweaks:backlog refine
gh (7)
   —      [pr] PR #1885 Distinct bot:parked label — test check FAILURE     CI failing — local action, not auto
   —      [pr] PR #2089 Capture: dispatch MCP transport gap — awaiting rev…  informational, optional human look
   —      [pr] PR #2088 Confirm RemoteTrigger update persists — awaiting r…  informational, optional human look
   —      [pr] PR #2060 Instruction-prose diet — awaiting review             informational, optional human look
   —      [pr] PR #1986 dispatch/task-prompt.md warn agents — awaiting re…  informational, optional human look
   —      [pr] PR #1972 Port superseded review fixes forward — awaiting rev…  informational, optional human look
   —      [pr] PR #1908 plan-audit Check C unparseable Step 2 — awaiting …  informational, optional human look
   gh pr checks 1885
   gh pr view 2089 --web
   gh pr view 2088 --web
   gh pr view 2060 --web
   gh pr view 1986 --web
   gh pr view 1972 --web
   gh pr view 1908 --web
node (1)
   —      [calibration] decision-records and upstream rows: 0 findings…   report-only, judgment call
   node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.118.0/bin/calibration-report.js" --runs 50
review (11)
   —      [doctor] product-schema-legacy (route) — PRODUCT.md predates …   fix: /impeccable:impeccable init, user's call
   —      [health] record snapshot hit backlog-fetch-limit=1000 (5 open…   raise backlog-fetch-limit in policy.yml
   —      [health] parent-gate state map hit the 1000 cap — WARNING…       raise backlog-fetch-limit in policy.yml
   —      [health] velocity: 60 releases in 8w; 304 open (258 backlog)…   informational
   —      [health] plugin 6.118.0 installed, origin/main at v6.121.0…     run claude plugin update claude-tweaks
   —      [pattern] contract drift when a skill narrows a guarantee…      2 specs — below 3-review bar
   —      [pattern] second producer of an artifact must diff invariants…  2 specs — below 3-review bar
   —      [pattern] cross-file contract sweeps keyed on mentions miss…    2 specs — below 3-review bar
   —      [pattern] GitHub-side deliverables pass unmet through review…   2 specs — below 3-review bar
   —      [pattern] ceiling-gated files compress adjacent prose…          2 specs — below 3-review bar
   —      [calibration] read-out: 20 archived runs, 21 findings; console…  report-only
```

**Clean:**
```text
design docs        0 checked
backlog staleness  258 checked
parked triggers    7 checked
unsynced records   0 checked
ready scoring      39 checked
legacy labels      304 checked
record sizing      29 checked
issue claims       727 checked
claim backstops    4 checked
unfiled drafts     0 checked
doc registry       18 checked
parent-gate        4 checked
digest entries     9 checked
unarmed PRs        13 checked
unsettled runs     9 checked
build/* branches   0 checked
artifact residue   0 checked
release triple     1 checked
```

Full decision log: /Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-09-09T035127-sweep-standalone/decisions.md
