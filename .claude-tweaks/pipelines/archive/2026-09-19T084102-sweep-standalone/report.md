## Tidy Report — 2026-09-19

**Applied automatically**
```text
deleted      —     worktree-backlog-refine (net-empty vs fork point) + branch -D    commit n/a (local)
deleted      —     worktree-init (fully merged into main) + branch -d               commit n/a (local)
archived     —     10 clean pipeline-run dirs (no tracked content, plain mv)        n/a (untracked)
archived     —     5 clean pipeline-run dirs (tracked work/*-spec.md headers)       PR #2606 (merged)
deleted      —     2 orphaned ledgers (no open row, no matching run dir)            PR #2607 (merged)
```

**Approve (14)**
```text
1  [git]    —     origin/worktree-capture-mcp-gap
   Delete merged remote branch (outward git push — never auto per reversibility floor)
   git push origin --delete worktree-capture-mcp-gap
2  [claim]  #2502  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2502 --remove-label bot:in-progress
3  [claim]  #2492  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2492 --remove-label bot:in-progress
4  [claim]  #2488  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2488 --remove-label bot:in-progress
5  [claim]  #2484  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2484 --remove-label bot:in-progress
6  [claim]  #2472  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2472 --remove-label bot:in-progress
7  [claim]  #2449  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2449 --remove-label bot:in-progress
8  [claim]  #2364  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2364 --remove-label bot:in-progress
9  [claim]  #2267  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 2267 --remove-label bot:in-progress
10 [claim]  #1826  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 1826 --remove-label bot:in-progress
11 [claim]  #1768  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 1768 --remove-label bot:in-progress
12 [claim]  #1728  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 1728 --remove-label bot:in-progress
13 [claim]  #1400  bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 1400 --remove-label bot:in-progress
14 [claim]  #496   bot:in-progress present, no active claim
   Remove orphaned bot:in-progress label
   gh issue edit 496 --remove-label bot:in-progress
```

**Yours (55)**
```text
specify (12)
   #2269  Migrate status-line instruction: browse, simplify, help, ...            judgment, no mechanical fix
   #2268  Migrate status-line instruction: test, docs-health, tidy, ...          judgment, no mechanical fix
   #2266  Migrate status-line instruction: design-wrapper + dispatch + ...       judgment, no mechanical fix
   #2265  Migrate Subagent Contract canonical status-line rule and ...          judgment, no mechanical fix
   #2257  Release lifecycle wiring                                              judgment, no mechanical fix
   #2080  parseLedger silently counts an unrecognized Status value ...          judgment, no mechanical fix
   #1839  materialize-format.js: PLACEHOLDER_RE flags a TODO inside ...         judgment, no mechanical fix
   #1837  bin/verify.js: vitest counts parse as null on colour-coded ...        judgment, no mechanical fix
   #1800  pr-early-run-lifecycle and open-items ledger creation have ...        judgment, no mechanical fix
   #1796  escalate-residue: removal-failed escalation body names the ...        judgment, no mechanical fix
   #1752  dispatch/next-ranking.md: unify ad hoc per-reason exclusion ...       judgment, no mechanical fix
   #2533  dispatch task-prompt's foreground-execution warning doesn't ...       judgment, no mechanical fix (missing risk/size score too)
   too-large — recommend splitting; #2533 also missing risk/size score
   /claude-tweaks:specify 2269,2268,2266,2265,2257,2080,1839,1837,1800,1796,1752,2533
backlog refine (2)
   #1890  Live-verify create_webhook_trigger request/response shape ...         outward, no mechanical fix (hit retry ceiling)
   #2466  reconcile: manually archive the seven 1811 run directories ...        outward, no mechanical fix (hit retry ceiling)
   /claude-tweaks:backlog refine
review (41)
   6 dirty worktrees — manual review before removal (uncommitted changes)
     .claude/worktrees/agent-a97b6fa2589f7ca3f (branch merged, but dirty)
     .claude/worktrees/dispatch-record-1337 (branch merged, but dirty)
     .claude/worktrees/dispatch-record-1725 (branch merged, but dirty)
     .claude/worktrees/dispatch-record-457 (branch merged, but dirty)
     .claude/worktrees/record-1471 (branch merged, but dirty)
     .claude/worktrees/record-1686-1733-1734-1737-1738-2225 (dirty)
   28 worktrees with real unmerged commits (1-19 ahead of main) — judgment call
     record-1676(1) record-1686-1733-1734-1737-1738-2225(2) record-1752(10) record-1796(3)
     record-1798(4) record-1800(7) record-1837-1839-1840-1851-1873-2026-2029-2265-2294-2333-2335-2341(16)
     record-1890(2) record-1936-1996-2008-2063-2080-2282-2332-2344-2345(5) record-1982(3)
     record-2041-friction-events-overreport(7) record-2051(6) record-2259(3) record-2271(5)
     record-2280-2281(3) record-2283-2338(3) record-2314(9) record-2326(10) record-2328(5)
     record-2329(2) record-2330-2346(2) record-2348(9) record-2364(5) record-2366(3)
     record-2433(3) record-2472(19) record-2502-bundle(11) sweep(6)
     review each: git -C "{REPO_ROOT}" log main..{branch} --oneline, then finish/merge or discard by hand
   #2531  impeccable-plugin-contract.test.js's version-pin test fails ...       (too-small, absorb candidate)
   #2332  wrap-up/pack.js recordLabels: unbounded concurrent gh fan-out ...      (too-small, absorb candidate)
   #2041  friction-events.js's contract-violation detector over-reports ...      (too-small, absorb candidate)
   #1798  worktree-isolation guard: refuses non-git Bash commands as ...        (too-small, absorb candidate)
   #1236  wrap-up engine-verify.js acceptance-labeling check spawns ...         (too-small, absorb candidate)
   [health] high velocity: 80+ specs shipped in last 8 weeks — no review-summary artifacts found in 4-week window
   [calibration] decision-records (0/21 runs) and upstream (0/21) rows look over-wide — consider narrowing
     node "${CLAUDE_PLUGIN_ROOT}/bin/calibration-report.js" --runs 50
```

**Clean:**
```text
backlog              36 checked
parked                6 checked
design docs           0 checked
plans                10 checked
ledgers              11 checked
registry               1 checked
harness/docs-health    4 checked
digest                 1 checked
in-flight PR           1 checked
ready sizing          56 checked
claims backstops       3 checked
```
All fresh or exempt decomposition parents (backlog); no trigger met (parked); no `*-design.md`
files exist (design docs); all recent, <3 days old (plans); open rows or a matching live run dir
(ledgers — 2 further orphaned ledgers with no matching run dir are listed separately below,
outside this count); every entry resolves and every doc is covered (registry); still-valid, no
action needed (harness/docs-health); 15/100 comments, healthy (digest); `flow/spec-2589-2592`,
PR #2602 open, correctly left alone (in-flight PR); well-scoped, no outlier flagged (ready
sizing); parked-restoration/empty-audit-log/unfiled-drafts backstops all found nothing (claims
backstops). `doctor` skipped silently (design-integration not configured — no row by design).

**Concern:** Step 4.7's primary issue-claims listing (`claims/` blob keyspace on `claims-registry`) reported ~1000 entries but the scanning agent sampled only 10 rather than classifying every one — the primary Release-eligible-claim scan is incomplete. The four backstop scans (parked-restoration, bot:in-progress, empty-audit-log, unfiled-drafts) each ran their own complete, non-sampled query and are trustworthy; only the primary claim-by-claim classification is a partial result. Recommend a follow-up full pass if claim-registry hygiene matters here.

**Concern:** the Step 4.5 git/worktree scan agent's own recommendations were unreliable — it reported all 30 "clean, unlocked" worktrees as safe to auto-remove with no mechanical fix needed, but independent re-verification (git branch --merged, and a net-empty diff check against each fork point) found only 2 of the 30 were actually safe (1 merged, 1 net-empty); the other 28 carry 1-19 real unmerged commits each. This report's Applied/Approve/Yours sections above reflect the independently re-verified classification, not the scanning agent's own summary.

Full decision log: .claude-tweaks/pipelines/2026-09-19T084102-sweep-standalone/decisions.md
