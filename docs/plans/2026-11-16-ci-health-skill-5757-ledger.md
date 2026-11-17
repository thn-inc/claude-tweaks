# Open Items — Add a ci-health skill that audits where CI time goes and files findings

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 5 commits ahead of local main; local main also carried 10 unpushed [reconcile] archive commits that ride along into this worktree and its PR | observation | Continued under auto; the worktree merged origin/main at creation. The 10 reconcile commits predate this record's work. |
| 2 | build | SDD ruling — forge CLI and host-pin code lives in source.js, never ci-audit.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — repeated-work breach carries a step field and a null workflow: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 7 contract differences accepted (fingerprint step, payload signature, no Verified-as-of stamp): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — extra code sites for the by:ci-health origin (grouping.js, record-graph palette): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — agnostic scan allows _shared contract path citations and scans comments: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — health-sweep count words updated in CLAUDE.md and shared contracts: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build/skill | [skill: NEW - health-sweep-addition] Adding a sixth health sweep touched ~35 files and each task found one more roster site only when a suite or reviewer failed (timing-nested-parent-roster allowlist, docs/getting-started.md, skill-graph rows, "four health sweeps" consumer lists in _shared/health-*.md, init bootstrap step 17, CLAUDE.md counts, strip-comments callers twin); a project skill listing every site a new health sweep must land in would have made it one pass. | observation | — |
| 9 | review | Error Handling (low) at plugin/bin/ci-audit.js:213 | fixed | noData reason now names a partial read failure — a4c3f527c8 |
| 10 | review | Error Handling (low) at plugin/bin/ci-audit.js:299 | fixed | reopen with no issue number is held, never reopens:null — a4c3f527c8 |
| 11 | review | Error Handling (low) at plugin/bin/ci-audit.js:286 | fixed | dedup index built from the parsed --issues array (buildIssueIndex), no second read — a4c3f527c8 |
| 12 | review | Error Handling (low) at plugin/bin/lib/ci-audit/validate-finding.js:83 | fixed | under-sampled rows and unparsed workflows rejected — a4c3f527c8 |
| 13 | review | Error Handling (low) at plugin/bin/lib/ci-audit/issue-payload.js:73 | fixed | failed-reads block capped at 20 lines plus +N more — a4c3f527c8 |
| 14 | review | Performance (low) at plugin/bin/lib/ci-audit/source.js:314 | fixed | jobs reads stop after 5 consecutive failures, cut named in truncated — a4c3f527c8 |
| 15 | review | Convention (low) at plugin/bin/lib/ci-audit/source.js:328 | fixed | origin lookup uses the injected cwd — a4c3f527c8 |
| 16 | review | Architecture (low) at plugin/bin/lib/ci-audit/phases.js:59 | fixed | header states it reads the workflow-file expression syntax — a4c3f527c8 |
| 17 | review | Architecture (low) at plugin/bin/lib/ci-audit/aggregate.js:70 | fixed | header states it reads the shard name rendering — a4c3f527c8 |
| 18 | review | Convention (low) at plugin/bin/ci-audit.js:58 | fixed | exit-code family deviation documented in the header — a4c3f527c8 |
| 19 | review | Architecture (low) at plugin/bin/lib/ci-audit/validate-finding.js:55 | fixed | cross-check test ties METRICS.breach to evaluate output — a4c3f527c8 |
| 20 | review | Architecture (low) at plugin/bin/lib/ci-audit/source.js:97 | fixed | test ties the SKILL.md 600000 ms timeout to CI_HEALTH_DEADLINE_MS — a4c3f527c8 |
| 21 | review | Ownability (low) at plugin/bin/lib/ci-audit/aggregate.js:127 | fixed | criticalPath bridge and tie clause commented — a4c3f527c8 |
| 22 | review | Ownability (info) at plugin/bin/ci-audit.js:101 | fixed | DEFINITIONS comment cites checklist.md and the pinning test — a4c3f527c8 |
| 23 | review | Ownability (low) at plugin/bin/lib/ci-audit/validate-finding.js:208 | fixed | message-prefix coupling commented — a4c3f527c8 |
| 24 | review | Ownability (low) at plugin/bin/ci-audit.js:330 | fixed | unparsed-workflow filter pointer comment — a4c3f527c8 |
| 25 | review | Confirmed finding at plugin/bin/lib/ci-audit/source.js:106 | accepted | Don't fix: separate run-list page cap by design; sharing ci-health constant would couple two budgets |
| 26 | review | Confirmed finding at plugin/bin/lib/ci-audit/checks.js:89 | accepted | Don't fix: one-line pure helpers, no drift risk; fakeRunners serve different seams |
| 27 | review | Confirmed finding at tests/bin-lib/ci-audit/skill-md.test.js:87 | accepted | Don't fix: whole-row byte pin matches the repo prose-pin convention and fails safe |
| 28 | review | Confirmed finding at tests/bin-lib/ci-audit/validate-findings.test.js:547 | accepted | Don't fix: loadIssueIndex accepts both label shapes by design |
| 29 | review | Confirmed finding at plugin/bin/lib/ci-audit/workflow-facts.js:228 | accepted | Don't fix: readSteps is followable with existing comments; header states failure semantics |
| 30 | review | Confirmed finding at plugin/bin/lib/ci-audit/phases.js:11 | accepted | Don't fix: header states the exact boundary rule; checklist.md calls it a heuristic |
| 31 | review | Confirmed finding at plugin/bin/lib/ci-audit/source.js:109 | accepted | Don't fix: deadline split; correctness rests on the deadline and truncation reporting |
| 32 | review | Confirmed finding at plugin/bin/lib/ci-audit/checks.js:73 | accepted | Don't fix: defaults are overridable leads for the judge and listed in checklist.md |
| 33 | review | Confirmed finding at plugin/bin/ci-audit.js:286 (3a dedupAndDispatch) | accepted | Don't fix: helper fits a stateless producer badly; 2 of 4 producers hand-roll the loop; the real defect (double read) fixed |
| 34 | review | Architecture (medium) at plugin/bin/lib/ci-audit/workflow-facts.js:34 — workflow-file schema outside source.js; merge-verification import allowlisted | deferred | Staged record proposal staged/review-followup-1.md (Defer-reason: needs-human-decision); header wording corrected in a4c3f527c8 |
| 35 | review | Convention (low) at plugin/bin/lib/ci-audit/source.js:94 — ci-health name collision with harness-health check modules | deferred | Staged record proposal staged/review-followup-2.md (Defer-reason: genuinely-larger) |
| 36 | review/hindsight | [skill: bin-source-scan-conformance] conformance-scan allowlist entries need an inline reason and removal condition (agnostic scan waived the workflow-facts merge-verification import) | deferred | Staged staged/reflect-1.md for the Review Console (Skill updates) |
