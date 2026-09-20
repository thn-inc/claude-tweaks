# Changelog

Every version this plugin has shipped, newest first. "Shipped" means a value the
`version` field in `.claude-plugin/plugin.json` held at the tip of `main` — the
marketplace `source` is an unpinned git URL, so an install tracks that tip, and
every distinct value it reported is a build someone could be running.
`tests/changelog-coverage.test.js` fails the suite if any of them is missing here.

Which versions those are is **recorded, not inferred** — `docs/shipped-versions.tsv`
is appended in the same commit as each version bump. It replaced a
`git rev-list --first-parent` reconstruction that turned out to be unstable rather
than merely lossy: a branch that merges `main` into itself and is then pushed as
`main` moves everything `main` carried since the fork point onto the merge's second
parent, where the walk never looks, so versions *left* the reconstructed set as
later merges landed (#144). Two releases were written up as never-shipped on that
evidence before anyone checked it against a source outside this repo's topology.

Three conventions follow from how this repo works, and all are visible below:

- **A `###` subsection labelled "branch-numbered vX.Y.Z"** is work that was
  developed and written up under one number but reached users under another,
  because a concurrent worktree session claimed the number first (`[IL-12]`).
  `main`'s tip never reported the branch number, so the entry lives under the
  build that actually carried it. The original write-up is kept verbatim.
  Only three entries are genuinely of this kind — v6.3.0, v6.5.0 and v6.25.0.
  Thirteen more carried the label until v6.45.0 and did not deserve it.
- **A `###` subsection labelled "also carried in this build"** documents work that
  reached users under a version whose own entry describes something else. The record
  landed on `main` without bumping, so the build that carried it was already numbered
  for other work, and the release step that would have written it up never ran
  (`[IL-12]`). These are backfilled after the fact — labelled, rather than folded into
  the surrounding entry, so nothing here is mistaken for a contemporaneous release
  note. Distinct from the branch-numbered case above: there the write-up existed and
  the number moved; here the number was right and the write-up was missing.
- **Entries from v1.0.0 (2026-02-20) through v5.29.0 are reconstructed** from
  commit history rather than written at release time — the changelog step was
  not part of the release convention until v6.41.0, and 103 of the first 145
  releases went undocumented (`[IL-94]`). They are summaries of what each version
  contained, not contemporaneous release notes, and they are thinner than the
  entries written since.

## v6.128.0 — Sibling-PR premise-disproof dedup check for dispatch/materialize (#2590); browser automation migrated from agent-browser to Playwright CLI across qa-agent, stories, visual-review, demo/test, and install/detect plumbing (#2645-#2649); shallow-clone git-show guard fix across 5 test files (#2532); check-pr-bookkeeping.js multi-spec Step-0-gate fix (#2571); skill-prose-conformance-tests Anti-Patterns addition (#2605); record-worktree bookkeeping-stamp-deny recovery investigation (#2585); doc staleness fix for the record-1892 ledger (#2587)

Sibling-PR premise-disproof dedup check for dispatch/materialize (#2590); browser automation migrated from agent-browser to Playwright CLI across qa-agent, stories, visual-review, demo/test, and install/detect plumbing (#2645-#2649); shallow-clone git-show guard fix across 5 test files (#2532); check-pr-bookkeeping.js multi-spec Step-0-gate fix (#2571); skill-prose-conformance-tests Anti-Patterns addition (#2605); record-worktree bookkeeping-stamp-deny recovery investigation (#2585); doc staleness fix for the record-1892 ledger (#2587).

## v6.127.0 — Release notes authoring contract: per-record public release notes threaded through compose-record/spec-template/compose-subject/release-local changelog rendering (#2580, #2581); worktree-always gate exemption for integration-branch fast-forward pushes (#2542); review-console systemic-verdict U# items default to filed under Approve all (#2551); wrap-up engine-verify.js combines acceptance-labelings two gh issue view calls into one (#1236); set-config.js multi-key config.yml writes (#2081); bookkeeping-stamps gate misattributed-scratch-worktree fix (#1460); reconcile structurally-stuck escalate/resolve dedup (#2504) and re-fetch fix (#2505); parseRepo --repo CLI flag non-github.com host fix across 10 call sites (#2444, #2476); wrap-up verify acceptance-labeling check fixes (#2477, #2485); console-resolve.js SECTION_MAP reflect-category misrouting fix (#2473); verify.js --changed-files --integration-branch worktree-checkout fix (#2486); residue-sweeps own-pr carve-out fix (#2462); pipeline-shadow guard carve-out fix (#1778); flaky allowlist tests/reconcile.test.js fix (#2499, #2500); flow test verification skip-if-recent ordering fix (#2527); pre-tool-use.js captureDebugPayload debug-scaffolding removal plus dangling citations fix (#1739, #2336); Impeccable CLI Rust-engine migration audit (#2480); 9 pre-existing npm test failures unrelated to any single record (#2512); npm test 3 sandbox-only failures split out of #1853, Impeccable pin plus 2 whole-file (#2436); docs drift fixes (#2491, #2516, #2506); dispatch firing-exclusion read-before-pick and PR-batch-merge run-state verification prose fixes. Plus a whole-branch pre-release review pass: clean, no findings.

Release notes authoring contract: per-record public release notes threaded through compose-record/spec-template/compose-subject/release-local changelog rendering (#2580, #2581); worktree-always gate exemption for integration-branch fast-forward pushes (#2542); review-console systemic-verdict U# items default to filed under Approve all (#2551); wrap-up engine-verify.js combines acceptance-labelings two gh issue view calls into one (#1236); set-config.js multi-key config.yml writes (#2081); bookkeeping-stamps gate misattributed-scratch-worktree fix (#1460); reconcile structurally-stuck escalate/resolve dedup (#2504) and re-fetch fix (#2505); parseRepo --repo CLI flag non-github.com host fix across 10 call sites (#2444, #2476); wrap-up verify acceptance-labeling check fixes (#2477, #2485); console-resolve.js SECTION_MAP reflect-category misrouting fix (#2473); verify.js --changed-files --integration-branch worktree-checkout fix (#2486); residue-sweeps own-pr carve-out fix (#2462); pipeline-shadow guard carve-out fix (#1778); flaky allowlist tests/reconcile.test.js fix (#2499, #2500); flow test verification skip-if-recent ordering fix (#2527); pre-tool-use.js captureDebugPayload debug-scaffolding removal plus dangling citations fix (#1739, #2336); Impeccable CLI Rust-engine migration audit (#2480); 9 pre-existing npm test failures unrelated to any single record (#2512); npm test 3 sandbox-only failures split out of #1853, Impeccable pin plus 2 whole-file (#2436); docs drift fixes (#2491, #2516, #2506); dispatch firing-exclusion read-before-pick and PR-batch-merge run-state verification prose fixes. Plus a whole-branch pre-release review pass: clean, no findings..

## v6.126.0 — Design-ceremony hardening: /capture brainstorm route wiring (#2347); reconcile structurally-stuck consolidated escalation (#1811); dispatch settle-parked batch command + merge-check policy lever (#2428); dispatch drain-PR overlap hold visible to console-resolve (#2299); release-please bump-minor-pre-major honored on 0.x lines (#2327); release-bootstrap conflict detection + --release-type/--extra-file override (#2323, #2324); fact-pack siblings crash-exit/empty-only-list fixes (#2325); wrap-up-pack.js integration-branch fixes for residue/state/blastRadius probes and resolveRecords worktree-mirroring (#2385, #2391); wrap-up verify Oversight-floor exemption fix (#2383); flow Step 3 Manifesto config.yml write fix on two-call dispatch resume (#2413); EnterWorktree record-worktree bypass fix (#2362); design-detect Layer 3 Next.js API route exclusion (#1786); pipeline-shadow guard tidy/sweep-standalone carve-out (#1778); compose-subject CLI hardening (#2319); merge-subject-composer-conformance test re-baseline (#2320); archive-branches young squash-merged branch confirmation (#2322); CLAUDE.md doc drift/structure/staleness fixes (#2404, #2405, #2407). Plus a whole-branch pre-release review pass over this batch: design-surface gate diff-parser correctness fix for +++/--- content lines misread as headers, plus release-preflight/pack.js and wrap-up/pack.js dedup fixes.

Design-ceremony hardening: /capture brainstorm route wiring (#2347); reconcile structurally-stuck consolidated escalation (#1811); dispatch settle-parked batch command + merge-check policy lever (#2428); dispatch drain-PR overlap hold visible to console-resolve (#2299); release-please bump-minor-pre-major honored on 0.x lines (#2327); release-bootstrap conflict detection + --release-type/--extra-file override (#2323, #2324); fact-pack siblings crash-exit/empty-only-list fixes (#2325); wrap-up-pack.js integration-branch fixes for residue/state/blastRadius probes and resolveRecords worktree-mirroring (#2385, #2391); wrap-up verify Oversight-floor exemption fix (#2383); flow Step 3 Manifesto config.yml write fix on two-call dispatch resume (#2413); EnterWorktree record-worktree bypass fix (#2362); design-detect Layer 3 Next.js API route exclusion (#1786); pipeline-shadow guard tidy/sweep-standalone carve-out (#1778); compose-subject CLI hardening (#2319); merge-subject-composer-conformance test re-baseline (#2320); archive-branches young squash-merged branch confirmation (#2322); CLAUDE.md doc drift/structure/staleness fixes (#2404, #2405, #2407). Plus a whole-branch pre-release review pass over this batch: design-surface gate diff-parser correctness fix for +++/--- content lines misread as headers, plus release-preflight/pack.js and wrap-up/pack.js dedup fixes..

## v6.125.0 — Security fix: gate materialize.js Premise-check execution on GitHub-attested author association (#2471); wrap-up CLAUDE.md over-budget curation with mechanical Premise-check (#1829); hooks.js adopt-run-dir subcommand (#2409, #2419); pre-tool-use worktree guard refuses data-writing/read-only commands containing the VCS name or a runtime-computed value (#1785, #2432); permittedGrants contract phase removes flat bornReady/bornAuthorized/reason (#666, #2456); flow multi-spec PR phase-checklist gains a polish row (#1712, #2437, #2439); reconcile structurally-stuck fix (#2231); timing/derive.js NESTED_PARENT roster fix (#2249, #2288, #2339); wrap-up verify acceptance-labeling fix (#1841); init Step 14 claude-cloud-setup.sh fix (#1779); worktree-setup.md stale-claim fix (#1751, #2420); flow Step 2.5 branch-divergence unpushed-commit check (#1780); worktree-setup.md Windows filename-too-long guidance (#1782); wrap-up-state.js UNPUSHED-no-upstream fix for pr-first branches (#1869); instruction-prose diet loaded-bytes budget (#1909); repo-resolve.js GitHub Enterprise Server support (#2240)

Security fix: gate materialize.js Premise-check execution on GitHub-attested author association (#2471); wrap-up CLAUDE.md over-budget curation with mechanical Premise-check (#1829); hooks.js adopt-run-dir subcommand (#2409, #2419); pre-tool-use worktree guard refuses data-writing/read-only commands containing the VCS name or a runtime-computed value (#1785, #2432); permittedGrants contract phase removes flat bornReady/bornAuthorized/reason (#666, #2456); flow multi-spec PR phase-checklist gains a polish row (#1712, #2437, #2439); reconcile structurally-stuck fix (#2231); timing/derive.js NESTED_PARENT roster fix (#2249, #2288, #2339); wrap-up verify acceptance-labeling fix (#1841); init Step 14 claude-cloud-setup.sh fix (#1779); worktree-setup.md stale-claim fix (#1751, #2420); flow Step 2.5 branch-divergence unpushed-commit check (#1780); worktree-setup.md Windows filename-too-long guidance (#1782); wrap-up-state.js UNPUSHED-no-upstream fix for pr-first branches (#1869); instruction-prose diet loaded-bytes budget (#1909); repo-resolve.js GitHub Enterprise Server support (#2240).

## v6.124.0 — Post-v6.123.2 batch: reconcile structurally-stuck fallback fix for MERGED PRs and no-worktree runs (#2226, #2228, #2229); reconcile structurally-stuck no-worktree fix (#2230, #2354, #2355); reconcile structurally-stuck no-branch fix (#2356, #2357, #2358, #2359); splitFrontmatterFence CRLF-checkout spec-materialization backfill (#2306); impeccable-cli-contract test re-pinned to installed 4.1.0 (#2321); verify.js --cwd flag for per-check working directory (#2411); dispatch bare-drain no-AskUserQuestion rule documented with no infra-outage carve-out (#2415); tidy deleted 22 orphaned execution plans whose specs already closed (#2377). Plus a whole-branch pre-release review pass over this batch: policy.yml project-maturity/housekeeping-auto-merge sync, node_modules Read allowlist seed, CLAUDE.md Spec close-out paragraph re-sync, 6 stale routine records removed.

Post-v6.123.2 batch: reconcile structurally-stuck fallback fix for MERGED PRs and no-worktree runs (#2226, #2228, #2229); reconcile structurally-stuck no-worktree fix (#2230, #2354, #2355); reconcile structurally-stuck no-branch fix (#2356, #2357, #2358, #2359); splitFrontmatterFence CRLF-checkout spec-materialization backfill (#2306); impeccable-cli-contract test re-pinned to installed 4.1.0 (#2321); verify.js --cwd flag for per-check working directory (#2411); dispatch bare-drain no-AskUserQuestion rule documented with no infra-outage carve-out (#2415); tidy deleted 22 orphaned execution plans whose specs already closed (#2377). Plus a whole-branch pre-release review pass over this batch: policy.yml project-maturity/housekeeping-auto-merge sync, node_modules Read allowlist seed, CLAUDE.md Spec close-out paragraph re-sync, 6 stale routine records removed..

## v6.123.2 — Post-v6.123.1 batch: ad-hoc run dir stamp for a PreToolUse gate denial with no owned run dir (#2374); contract-violation over-counting fix migrating qa-prompts.md/qa-agent.md to the canonical trailing STATUS line (#2373); build's Common Step 7 bookkeeping assertion for continuous /flow sessions (#2372); qa-agent default viewport for below-the-fold controls (#2371).

Post-v6.123.1 batch: ad-hoc run dir stamp for a PreToolUse gate denial with no owned run dir (#2374); contract-violation over-counting fix migrating qa-prompts.md/qa-agent.md to the canonical trailing STATUS line (#2373); build's Common Step 7 bookkeeping assertion for continuous /flow sessions (#2372); qa-agent default viewport for below-the-fold controls (#2371)..

## v6.123.1 — Post-v6.123.0 batch: release-bootstrap write-time TOCTOU fix from this batch's own whole-branch review (#2369); escalate-residue.js reopen-branch comment correction (#2370); reconcile archival + stale issue-claim release sweep (#2360, #2352, #2353, #2361, #2368)

Post-v6.123.0 batch: release-bootstrap write-time TOCTOU fix from this batch's own whole-branch review (#2369); escalate-residue.js reopen-branch comment correction (#2370); reconcile archival + stale issue-claim release sweep (#2360, #2352, #2353, #2361, #2368).

## v6.123.0 — Health-core library functions return exit codes instead of calling process.exit() (#2053); design-ceremony policy key propagates ceremony-profile into /specify's brainstorming/writing-plans handoff (#1886); merge-time conventional subject + breaking label, and the /claude-tweaks:release skill family for consumer projects (#2251-#2258)

Health-core library functions return exit codes instead of calling process.exit() (#2053); design-ceremony policy key propagates ceremony-profile into /specify's brainstorming/writing-plans handoff (#1886); merge-time conventional subject + breaking label, and the /claude-tweaks:release skill family for consumer projects (#2251-#2258).

## v6.122.0 — Post-v6.121.0 batch: near-duplicate open-record detection before build (#1944) with dispatch-time pre-build checks for already-shipped deliverables (#1984) and cross-PR overlap on the same drain (#1985); distinct bot:parked label for merge-verification parks (#605); dispatch claim/bot:in-progress persistence across the two-call handoff (#2073) and a tidy stale-claim release CLI (#2090); Subagent Contract status-line rule migrated to a trailing line with subagent-stop.js detection (#2265), SubagentStop blocking-decision platform support + forced in-run retry (#1936), and its status-line check confirmed post-parent-transcript-fallback (#2008); section-scoped review/test context bundles restructuring subagent-output-contract.md and pipeline-run-dir.md (#2019), with the composed merge bundle brought under the composed-bytes ceiling (#2002), multi-spec Review Console short-circuit routed through console-resolve.js (#2007), and its readMembers fallback fixed for multi-spec parent run dirs (#2028); SubagentStop hook misattribution of contract-violation to main-session narration fixed (#2036); plan-audit Check A/C false-positive fixes for append-to-existing-file and new-directory plans (#1999) plus a control-byte check (#2000); backlog/tidy UX: sweep close-out renders tidy's staged Approve set (#1883), attention per-group batch launcher lines (#1884), refine's bare-sweep/#N fold-in (#1887); reconcile archive-merged ENOTEMPTY split-state fix (#1892), a build-time branch-reuse guard (#1957), and a structural write-guard for research-scoped forks sharing a live worktree (#2278); dev-url-detection survival across the dispatch two-call hand-off (#1937); EnterWorktree(path=) limitation for Task-tool subagents documented (#2050); impeccable-cli pin drift resolved via version-mode: floor (#2277); coordination.js reproduction-pair location-only false-merge fix (#1980); docs-health/tidy cleanup-sweep coordination (#1983); friction-events.js over-report fix (#2041) and Friction-lens vocabulary filter (#2016); RemoteTrigger update persistence + guided-creation close-out (#1301, #1890); review flow-context full-mode self-enforcement (#1570); resolve-linked-prs.js/resolve-blockers.js deduplicated into number-list-cli.js (#1981); PR run-comment find on GitHub Enterprise (#2021); dispatched review-fan-out agents get a mandated scratch location (#2022, #2245); timing/derive.js NESTED_PARENT corpus-scanning test (#2030); ports/ensure.js double-parse fix (#2031); recordLabels/ghReadGrants batched via Promise.all (#2032); crossReferenceKeyFiles word-boundary + re-parse fix (#2067); verify-cleanup.js pipe-character escaping (#2068); pipeline-smoke-test literal invocation + conformance test (#2069); set-config.js multi-lever writes (#2081); specify drain digest-container exclusion (#2218); acceptance-gap closed-record fetch truncation fix (#2217); archiveOrphanedMint git-tracked fs-rename fixed to use git mv (#2227); session-start.js envWriteError surfacing (#2027) and CLAUDE_PLUGIN_ROOT double-resolve fix (#2070); bin/verify.js Windows cmd.exe example fix (#2043) and test:perf Windows portability (#2270); CLAUDE.md drift on the Auto-Mode Contract section (#1537); build-review-context.js mint prose corrected to name its actual JSON-line output (#1893); doc staleness fixes for two ledger files (#2058, #2059); skill-drift fix on run-directory-fact-packs (#2056); report.js's writeReportAtomic wired into verify.js (#2004); /review Step 1.5's belt-and-braces re-trigger decision (#2003); fast-lane bundle-membership cache-hit fix (#2066); plan-audit Check C no-parse diagnostic (#1594, #2026) and flaky.js glob-engine reuse (#2029); splitFrontmatterFence CRLF fix (#1882). Plus a whole-branch pre-release review pass over this batch (270 commits): the shared dispatch contract's inline templates were still telling agents the status word goes first, contradicting the canonical trailing-line rule the detector actually enforces -- fixed across subagent-dispatch-core.md, dispatch/task-prompt.md, review/step3-lens-dispatch.md, and four more pre-existing sites (design-wrapper/modes/{explore,review}.md, specify/{mechanical-handoff,red-team}.md); two dangling citations from #2002's file split fixed; number-list-cli.js's gh runner given a maxBuffer; a dead ctx param dropped from checkGitStashWarn; and the shipped SKILL.md byte ceiling raised from 40 KB to 45 KB after flow/SKILL.md crossed it (#2020's central-ceiling gate stays, only the number moves) -- #2328-#2339 filed as backlog for the review's remaining non-blocking findings.

Post-v6.121.0 batch: near-duplicate open-record detection before build (#1944) with dispatch-time pre-build checks for already-shipped deliverables (#1984) and cross-PR overlap on the same drain (#1985); distinct bot:parked label for merge-verification parks (#605); dispatch claim/bot:in-progress persistence across the two-call handoff (#2073) and a tidy stale-claim release CLI (#2090); Subagent Contract status-line rule migrated to a trailing line with subagent-stop.js detection (#2265), SubagentStop blocking-decision platform support + forced in-run retry (#1936), and its status-line check confirmed post-parent-transcript-fallback (#2008); section-scoped review/test context bundles restructuring subagent-output-contract.md and pipeline-run-dir.md (#2019), with the composed merge bundle brought under the composed-bytes ceiling (#2002), multi-spec Review Console short-circuit routed through console-resolve.js (#2007), and its readMembers fallback fixed for multi-spec parent run dirs (#2028); SubagentStop hook misattribution of contract-violation to main-session narration fixed (#2036); plan-audit Check A/C false-positive fixes for append-to-existing-file and new-directory plans (#1999) plus a control-byte check (#2000); backlog/tidy UX: sweep close-out renders tidy's staged Approve set (#1883), attention per-group batch launcher lines (#1884), refine's bare-sweep/#N fold-in (#1887); reconcile archive-merged ENOTEMPTY split-state fix (#1892), a build-time branch-reuse guard (#1957), and a structural write-guard for research-scoped forks sharing a live worktree (#2278); dev-url-detection survival across the dispatch two-call hand-off (#1937); EnterWorktree(path=) limitation for Task-tool subagents documented (#2050); impeccable-cli pin drift resolved via version-mode: floor (#2277); coordination.js reproduction-pair location-only false-merge fix (#1980); docs-health/tidy cleanup-sweep coordination (#1983); friction-events.js over-report fix (#2041) and Friction-lens vocabulary filter (#2016); RemoteTrigger update persistence + guided-creation close-out (#1301, #1890); review flow-context full-mode self-enforcement (#1570); resolve-linked-prs.js/resolve-blockers.js deduplicated into number-list-cli.js (#1981); PR run-comment find on GitHub Enterprise (#2021); dispatched review-fan-out agents get a mandated scratch location (#2022, #2245); timing/derive.js NESTED_PARENT corpus-scanning test (#2030); ports/ensure.js double-parse fix (#2031); recordLabels/ghReadGrants batched via Promise.all (#2032); crossReferenceKeyFiles word-boundary + re-parse fix (#2067); verify-cleanup.js pipe-character escaping (#2068); pipeline-smoke-test literal invocation + conformance test (#2069); set-config.js multi-lever writes (#2081); specify drain digest-container exclusion (#2218); acceptance-gap closed-record fetch truncation fix (#2217); archiveOrphanedMint git-tracked fs-rename fixed to use git mv (#2227); session-start.js envWriteError surfacing (#2027) and CLAUDE_PLUGIN_ROOT double-resolve fix (#2070); bin/verify.js Windows cmd.exe example fix (#2043) and test:perf Windows portability (#2270); CLAUDE.md drift on the Auto-Mode Contract section (#1537); build-review-context.js mint prose corrected to name its actual JSON-line output (#1893); doc staleness fixes for two ledger files (#2058, #2059); skill-drift fix on run-directory-fact-packs (#2056); report.js's writeReportAtomic wired into verify.js (#2004); /review Step 1.5's belt-and-braces re-trigger decision (#2003); fast-lane bundle-membership cache-hit fix (#2066); plan-audit Check C no-parse diagnostic (#1594, #2026) and flaky.js glob-engine reuse (#2029); splitFrontmatterFence CRLF fix (#1882). Plus a whole-branch pre-release review pass over this batch (270 commits): the shared dispatch contract's inline templates were still telling agents the status word goes first, contradicting the canonical trailing-line rule the detector actually enforces -- fixed across subagent-dispatch-core.md, dispatch/task-prompt.md, review/step3-lens-dispatch.md, and four more pre-existing sites (design-wrapper/modes/{explore,review}.md, specify/{mechanical-handoff,red-team}.md); two dangling citations from #2002's file split fixed; number-list-cli.js's gh runner given a maxBuffer; a dead ctx param dropped from checkGitStashWarn; and the shipped SKILL.md byte ceiling raised from 40 KB to 45 KB after flow/SKILL.md crossed it (#2020's central-ceiling gate stays, only the number moves) -- #2328-#2339 filed as backlog for the review's remaining non-blocking findings..

## v6.121.0 — Post-v6.120.0 batch: dispatch open-PR exclusion reporting (#1973) and stale-run-dir mint fix (#1962); foreground-execution instruction + em-dash cleanup (#1965); retry-attempt counting across issue/linked-PRs + cross-platform path.join fix (#1963); blast-radius journey field list + pipeline-artifact exclusion (#1906); record-snapshot union-cap fix (#1919); mechanize #1802 ungranted-member merge-grant check (#1966); simplify #1876 addendum; test fixture + CLI pin drift (#1900); process.exit conformance test (#1903); node -e backtick fix (#1964); CLAUDE.md dead-content retirement (#1970); ledger status-enum + verify-gate conformance fixes (#1971); wrap-up/SKILL.md and dispatch/SKILL.md byte-ceiling splits (#2006, #2009); skill-drift fix (#2023)

Post-v6.120.0 batch: dispatch open-PR exclusion reporting (#1973) and stale-run-dir mint fix (#1962); foreground-execution instruction + em-dash cleanup (#1965); retry-attempt counting across issue/linked-PRs + cross-platform path.join fix (#1963); blast-radius journey field list + pipeline-artifact exclusion (#1906); record-snapshot union-cap fix (#1919); mechanize #1802 ungranted-member merge-grant check (#1966); simplify #1876 addendum; test fixture + CLI pin drift (#1900); process.exit conformance test (#1903); node -e backtick fix (#1964); CLAUDE.md dead-content retirement (#1970); ledger status-enum + verify-gate conformance fixes (#1971); wrap-up/SKILL.md and dispatch/SKILL.md byte-ceiling splits (#2006, #2009); skill-drift fix (#2023).

## v6.120.0 — Merge sweep + hygiene pass: dispatch fast-lane bundling shares one preflight/wrap-up tail across small records (#1910); port-services policy key + SessionStart lease ensure (#1875); Design CLI gate reads git diff --name-only instead of verify.js --changed-files (#2005); pipeline-smoke-test cross-session integration test for capture/specify/backlog/dispatch (#44); SessionStart reports the resolved build from additionalContext unconditionally (#137); integration-branch.md consumer rank-set narrowing plus a stale record-freshness citation fix (#193); /specify decomposition cross-references forward-declared facet/behavior changes into sibling Key Files (#490); decided execution-mode policy for /flow -- no interactive-direct third path beyond subagent/batched dispatch (#491); confirmed #360's parent-AC-forwarding instruction surfaces in live per-task SDD dispatch prompts (#496); wrap-up verify's engine-verify.js converges remaining process.cwd() sites onto the threaded cwd param (#1477); digest URL/count summary surfacing wired into the remaining materiality-floor.md adopters (#1611); skill-graph.md's dangling section-pointer convention gets mechanical enforcement (#1705); task-prompt.md forbids git stash in dispatched calls since the stash stack is shared across worktrees (#1967). Also fixes a SessionStart additionalContext bug (duplicated claude-tweaks prefix) caught by this release's own whole-branch review gate.

Merge sweep + hygiene pass: dispatch fast-lane bundling shares one preflight/wrap-up tail across small records (#1910); port-services policy key + SessionStart lease ensure (#1875); Design CLI gate reads git diff --name-only instead of verify.js --changed-files (#2005); pipeline-smoke-test cross-session integration test for capture/specify/backlog/dispatch (#44); SessionStart reports the resolved build from additionalContext unconditionally (#137); integration-branch.md consumer rank-set narrowing plus a stale record-freshness citation fix (#193); /specify decomposition cross-references forward-declared facet/behavior changes into sibling Key Files (#490); decided execution-mode policy for /flow -- no interactive-direct third path beyond subagent/batched dispatch (#491); confirmed #360's parent-AC-forwarding instruction surfaces in live per-task SDD dispatch prompts (#496); wrap-up verify's engine-verify.js converges remaining process.cwd() sites onto the threaded cwd param (#1477); digest URL/count summary surfacing wired into the remaining materiality-floor.md adopters (#1611); skill-graph.md's dangling section-pointer convention gets mechanical enforcement (#1705); task-prompt.md forbids git stash in dispatched calls since the stash stack is shared across worktrees (#1967). Also fixes a SessionStart additionalContext bug (duplicated claude-tweaks prefix) caught by this release's own whole-branch review gate..

## v6.119.0 — verify.js gains a runner-owned JSON pass stamp + diff-aware scoping engine (verify-scope.json, changed-files.js, scope.js) wired into re-verify sites, /test affected, and QA story scoping (#1921, #1922, #1923); init generates a starter verify-scope.json (#1924); flaky retry allowlist with hit-counter escalation (#1925); fast-lane cost-shedding for single-task ceremony/SDD-review/polish (#1926); multi-session CLAUDE_TWEAKS_LEASE test-db isolation (#1927); per-phase timing + token telemetry in phase-timing.js (#1928, #1929); wrap-up-pack.js and flow-preflight.js consolidate wrap-up/preflight reads into one fact pack each (#1930, #1931); reflect-depth-from-diff + console-resolve.js batched unattended auto-resolution (#1932); port-services policy key + SessionStart lease ensure (#1792). Plus a whole-branch pre-release review pass: verify.js's --stamp-status fullSha now derives via stamp.js's shared anchorOf(), and extract.js's TAP-frame regex now matches Windows-native paths so #1925's flaky retry actually engages on this repo's own environment (#2033) -- #2026/#2027/#2028/#2029/#2030/#2031/#2032 filed as backlog for the review's remaining non-blocking findings.

verify.js gains a runner-owned JSON pass stamp + diff-aware scoping engine (verify-scope.json, changed-files.js, scope.js) wired into re-verify sites, /test affected, and QA story scoping (#1921, #1922, #1923); init generates a starter verify-scope.json (#1924); flaky retry allowlist with hit-counter escalation (#1925); fast-lane cost-shedding for single-task ceremony/SDD-review/polish (#1926); multi-session CLAUDE_TWEAKS_LEASE test-db isolation (#1927); per-phase timing + token telemetry in phase-timing.js (#1928, #1929); wrap-up-pack.js and flow-preflight.js consolidate wrap-up/preflight reads into one fact pack each (#1930, #1931); reflect-depth-from-diff + console-resolve.js batched unattended auto-resolution (#1932); port-services policy key + SessionStart lease ensure (#1792). Plus a whole-branch pre-release review pass: verify.js's --stamp-status fullSha now derives via stamp.js's shared anchorOf(), and extract.js's TAP-frame regex now matches Windows-native paths so #1925's flaky retry actually engages on this repo's own environment (#2033) -- #2026/#2027/#2028/#2029/#2030/#2031/#2032 filed as backlog for the review's remaining non-blocking findings..

## v6.118.0 — Skill context composer (parent #1987): bin/compose-context.js + bin/lib/compose-context/ with a marker grammar and six-key condition resolver composing per-run _shared bundles (#1988); merge-path bundle at both /wrap-up merge sites (#1989); composed-bytes gate per call site replaces the per-file 40 KB test as the hard ceiling (#1990); manifesto bundle at flow Step 3 for adopted runs (#1991); claims and pr-scan transport bundles at tidy and flow (#1992); worktree-setup bundle at build Common Step 1 (#1993); review-code/test-verify bundles found not composable as named, nothing built (#1994); dispatch task prompts cite the run-dir claims/merge bundles, _shared/dispatch-waiting.md extracted (#1995); thirteen per-file byte pins retired under IL-153, plan-audit reports composed headroom, ADR-0016 records composition over per-file ceilings (#1997); context-cost CRLF normalization (#1880). #1996 stays open pending the post-release subagent-read measurement. Console follow-ups filed as #2014-#2020.

Skill context composer (parent #1987): bin/compose-context.js + bin/lib/compose-context/ with a marker grammar and six-key condition resolver composing per-run _shared bundles (#1988); merge-path bundle at both /wrap-up merge sites (#1989); composed-bytes gate per call site replaces the per-file 40 KB test as the hard ceiling (#1990); manifesto bundle at flow Step 3 for adopted runs (#1991); claims and pr-scan transport bundles at tidy and flow (#1992); worktree-setup bundle at build Common Step 1 (#1993); review-code/test-verify bundles found not composable as named, nothing built (#1994); dispatch task prompts cite the run-dir claims/merge bundles, _shared/dispatch-waiting.md extracted (#1995); thirteen per-file byte pins retired under IL-153, plan-audit reports composed headroom, ADR-0016 records composition over per-file ceilings (#1997); context-cost CRLF normalization (#1880). #1996 stays open pending the post-release subagent-read measurement. Console follow-ups filed as #2014-#2020..

## v6.117.0 — Dispatch excludes records with an already-open linked PR from the queue-pull (#1224); /claude-tweaks:routine gains create_webhook_trigger integration (#1302); set-config.js gains a --set batch-write mode (#1580); release.js prints the /plugin slash-command install/update form alongside the CLI form (#1870). Multi-agent coordination: fix a reproduction-pair severity-bucket false negative so a same-substance finding straddling a severity boundary is confirmed, not lost (#733). New parse-signal-discipline skill for deterministic prose checks (#1595). Contract hardening: exempt third-party agent types from subagent-stop.js's contract-violation detection, with a status-line dispatch-template fix and a Friction lens over-report staleness fix (#1596); extend the untrusted-record-content contract to refine-mode.md's grant-check call site (#1442); thread session id into reconcile-background so its archive sweep's ownership gate actually engages (#1687); fix a compute-then-exit truncation risk in build-review-context.js (#1535); resolve CLAUDE.md's 150-line budget overage (#1634); document orchestrator narration as a third non-violating contract-violation case (#1480); fix spec materialization to land under the run dir, not repo-root work/ (#1484); document real agent-browser v0.27.0 press command support (#1503). Wrap-up/ledger housekeeping batch from continuous pipeline operation: #1475, #1765, #1774, #1775, #1787, #1804, #1806, #1822, #1864, #1865. Plus a whole-branch pre-release review pass: archive-merged.js's directory-tracked-check bug (isTracked() on staged/ matched on ONE tracked file, not all), coordination.js's severity-undefined leak in reconcileSeverity, hasNoUpstreamYet's redundant second git spawn, and two DRY dedups (partitionByOpenLinkedPR, the audit-file archival loop) fixed -- #1980/#1981/#1982 filed as backlog for the review's remaining architectural findings.

Dispatch excludes records with an already-open linked PR from the queue-pull (#1224); /claude-tweaks:routine gains create_webhook_trigger integration (#1302); set-config.js gains a --set batch-write mode (#1580); release.js prints the /plugin slash-command install/update form alongside the CLI form (#1870). Multi-agent coordination: fix a reproduction-pair severity-bucket false negative so a same-substance finding straddling a severity boundary is confirmed, not lost (#733). New parse-signal-discipline skill for deterministic prose checks (#1595). Contract hardening: exempt third-party agent types from subagent-stop.js's contract-violation detection, with a status-line dispatch-template fix and a Friction lens over-report staleness fix (#1596); extend the untrusted-record-content contract to refine-mode.md's grant-check call site (#1442); thread session id into reconcile-background so its archive sweep's ownership gate actually engages (#1687); fix a compute-then-exit truncation risk in build-review-context.js (#1535); resolve CLAUDE.md's 150-line budget overage (#1634); document orchestrator narration as a third non-violating contract-violation case (#1480); fix spec materialization to land under the run dir, not repo-root work/ (#1484); document real agent-browser v0.27.0 press command support (#1503). Wrap-up/ledger housekeeping batch from continuous pipeline operation: #1475, #1765, #1774, #1775, #1787, #1804, #1806, #1822, #1864, #1865. Plus a whole-branch pre-release review pass: archive-merged.js's directory-tracked-check bug (isTracked() on staged/ matched on ONE tracked file, not all), coordination.js's severity-undefined leak in reconcileSeverity, hasNoUpstreamYet's redundant second git spawn, and two DRY dedups (partitionByOpenLinkedPR, the audit-file archival loop) fixed -- #1980/#1981/#1982 filed as backlog for the review's remaining architectural findings..

## v6.116.0 — Mechanize plan-audit Checks A/B/C + size-headroom into bin/plan-audit.js (#903); harden pre-tool-use worktree/session-ownership + git-plumbing gate coverage (#976, #1012, #1099, #1431); fix #1688 shared-resolver blast radius across its 4 original call sites plus a 5th missed one caught by this release's whole-branch review (#1861), narrowly scoped to avoid a staleness regression, + IL-131 no-remote default-branch resolution (#1688); guard claims-registry writes against undefined-coerced content (#821); hooks.js errors loudly on an unrecognized subcommand instead of silently no-op'ing (#1586); run-state ownership contract docs + CLAUDE.md drift fixes (#1100, #1429, #993); post-teardown re-anchor backstop + feedback Step 3 no-git fallback (#703); reconcile hardening -- move-failed stuck on stale run dirs (#1290), archiveOrphanedMint ENOTEMPTY on a pre-existing archive twin (#1713, #1714), reconcile-cache.json's lastRunAt per-checks-subset map + fresh GitHub-health preflight reuse (#873); materiality digest Defer-reason exception, dedup, and summary surfacing + MCP fingerprint dual-marker for health-sweep dedup (#1279, #1700); resolve stale local branch names against origin before blast-radius (#1592); hoist release-claim.js's run-dir anchoring check before the destructive write (#1710); revert GraphQL owner/repo variables back to -f, not -F (#1724); root-cause #815's missing record-worktree call, regression test only (#1520); route dispatch's cleanup-only teardown call directly through wrap-up instead of flow (#1766)

Mechanize plan-audit Checks A/B/C + size-headroom into bin/plan-audit.js (#903); harden pre-tool-use worktree/session-ownership + git-plumbing gate coverage (#976, #1012, #1099, #1431); fix #1688 shared-resolver blast radius across its 4 original call sites plus a 5th missed one caught by this release's whole-branch review (#1861), narrowly scoped to avoid a staleness regression, + IL-131 no-remote default-branch resolution (#1688); guard claims-registry writes against undefined-coerced content (#821); hooks.js errors loudly on an unrecognized subcommand instead of silently no-op'ing (#1586); run-state ownership contract docs + CLAUDE.md drift fixes (#1100, #1429, #993); post-teardown re-anchor backstop + feedback Step 3 no-git fallback (#703); reconcile hardening -- move-failed stuck on stale run dirs (#1290), archiveOrphanedMint ENOTEMPTY on a pre-existing archive twin (#1713, #1714), reconcile-cache.json's lastRunAt per-checks-subset map + fresh GitHub-health preflight reuse (#873); materiality digest Defer-reason exception, dedup, and summary surfacing + MCP fingerprint dual-marker for health-sweep dedup (#1279, #1700); resolve stale local branch names against origin before blast-radius (#1592); hoist release-claim.js's run-dir anchoring check before the destructive write (#1710); revert GraphQL owner/repo variables back to -f, not -F (#1724); root-cause #815's missing record-worktree call, regression test only (#1520); route dispatch's cleanup-only teardown call directly through wrap-up instead of flow (#1766).

## v6.115.1 — Fix wrap-up Auto-merge short-circuit skipping ledger-file deletion (#939); persist merge-check needs-human verdict so reconciler-side consoleAutoResolve can't override it (#1294); auto-decision-log test-gate failure-cause completeness rule (#1058)

Fix wrap-up Auto-merge short-circuit skipping ledger-file deletion (#939); persist merge-check needs-human verdict so reconciler-side consoleAutoResolve can't override it (#1294); auto-decision-log test-gate failure-cause completeness rule (#1058).

## v6.115.0 — Adopt Fable 5.1 prompting-guide scope, edit, and unattended rules — Working Approach block test-volume and surgical-changes rules, /build implementer injection quoting them verbatim, /routine-kickoff unattended-firing standing constraint (#1809)

Adopt Fable 5.1 prompting-guide scope, edit, and unattended rules — Working Approach block test-volume and surgical-changes rules, /build implementer injection quoting them verbatim, /routine-kickoff unattended-firing standing constraint (#1809).

## v6.114.1 — Hotfix: subagent Working Directory Discipline forbids the `cd` form that trips the harness's permission checker (IL-151)

Hotfix: subagent Working Directory Discipline forbids the `cd` form that trips the harness's permission checker (IL-151).

## v6.114.0 — Adopt-or-create worktree gate for flow multi-spec + dispatch/init/routine reuse (#1711); dispatch bare-drain firing-scoped re-selection exclusion for claim-contest/build-fail non-terminal stops (refs #833); flow multi-spec shared-worktree refusal fix + inherited-run-dir sanctioned-writer cross-reference (refs #1457); backlog-grant-gate 30s timeout concern resolved upstream, no code change (#1669); run-ledger row 1 resolved -- findDuplicate --limit widening already shipped (#1726). Plus a whole-branch pre-release review pass: hooks.js --run anchoring gap closed for an initialized-but-arbitrary directory outside .claude-tweaks/pipelines/ (refs #1566), docs/skill-graph.md missing _shared/worktree-setup.md row added -- #1751/#1752/#1753 filed as backlog for the review's remaining non-blocking findings.

Adopt-or-create worktree gate for flow multi-spec + dispatch/init/routine reuse (#1711); dispatch bare-drain firing-scoped re-selection exclusion for claim-contest/build-fail non-terminal stops (refs #833); flow multi-spec shared-worktree refusal fix + inherited-run-dir sanctioned-writer cross-reference (refs #1457); backlog-grant-gate 30s timeout concern resolved upstream, no code change (#1669); run-ledger row 1 resolved -- findDuplicate --limit widening already shipped (#1726). Plus a whole-branch pre-release review pass: hooks.js --run anchoring gap closed for an initialized-but-arbitrary directory outside .claude-tweaks/pipelines/ (refs #1566), docs/skill-graph.md missing _shared/worktree-setup.md row added -- #1751/#1752/#1753 filed as backlog for the review's remaining non-blocking findings..

## v6.113.0 — Whole-branch batch since v6.111.0: dispatch/queue — bare invocation --budget queue drain for specify/dispatch (#1491, #1492), two-call context pack + reconcile double-run fix (#1542, #1543, #1544), mega-bundle group-size ceiling before headless build (#1557), queue ranking git-ref cache (#1571), headless ceremony-profile derivation (#1545); backlog/refine — single human attention list + refine #N resolver + --reset-breaker (#1489), retire grant mode into refine's headless posture (#1490), byte-ceiling headroom extraction (#1512); reconcile/archive — 3 move-failed stuck run dirs repaired (#1446, #1447, #1649), ad-hoc-standalone eventual-cleanup path (#1604), structurally-stuck escalation path (#1613), stale-interrupted auto-close via shipped-unclosed evidence (#1673), pre-compact live-multi-spec-run false-clean race (#1502); claims — repair-claim.js CLI mirroring release-claim.js (#1608), parseRepo owner/repo traversal guard audited across 8 callers (#1443), claims-git-cas CAS-primitive dedup follow-up (#1466), group claim/release fetch amortization (#1467), dispatch two-call claim-persistence fix (#1486), missing claims-registry entry diagnosis (#1505); worktree/session guards — worktree-always wrap-up-outcomes.tsv commit fix (#1561), classifyOwnership owner-absent foreign-classification fix (#1563), EnterWorktree fresh-baseRef staleness fix (#1464), stale-same-name remote-branch collision (#1470), false-positive complete Bash guard fix (#1651), SessionStart freshly-created-worktree false positive (#1463), pre-tool-use hasMaterializeCommit range bound (#1674), run-integrity torn-down-worktree fallback evidence (#1672); new: /claude-tweaks:sweep orchestrator (#1494), /claude-tweaks:intake braindump gatekeeper (#1704, #1703); misc fixes — github-pr-scan.md graphql -f/-F placeholder bug (#626), materialize.js gh MCP-fallback gap (#1459), file-feedback.js gh ENOBUFS dedup fix (#1564), detectIntegrationModel gh-absent MCP fallback (#1558), grant-veto-window-hours 0 documentation (#1469), specify Key Files generator-module miss (#1321), framing-check declined-rationale encoding (#1276), review-lens degrade-path naming (#1449), wrap-up post-merge curation-fix ordering (#1465), tidy residue needs:decision + committed staged/ + --approve (#1493), webhook trigger live-verify (#1485), LITERAL_TMP_RE placeholder-span fix (#1511), PR #1506/#327 merge-authorization diagnosis (#1507), doc staleness fixes (#1698, #1699), build/worktree-setup pr-early lifecycle push/PR-open fix (#1456), subagent-stop.js contract-violation ownedRun scoping fix (#1425), bookkeeping-stamps gate first-push exemption fix (#1501). Plus a whole-branch pre-release review pass: repair-claim.js path-traversal parity, ad-hoc-standalone archival tracked-entry guard, teardown-run live-worktree refusal fix (#1731, #1736) -- #1732/#1733/#1734/#1737/#1738/#1739 filed as backlog for the review's remaining architectural findings.

Whole-branch batch since v6.111.0: dispatch/queue — bare invocation --budget queue drain for specify/dispatch (#1491, #1492), two-call context pack + reconcile double-run fix (#1542, #1543, #1544), mega-bundle group-size ceiling before headless build (#1557), queue ranking git-ref cache (#1571), headless ceremony-profile derivation (#1545); backlog/refine — single human attention list + refine #N resolver + --reset-breaker (#1489), retire grant mode into refine's headless posture (#1490), byte-ceiling headroom extraction (#1512); reconcile/archive — 3 move-failed stuck run dirs repaired (#1446, #1447, #1649), ad-hoc-standalone eventual-cleanup path (#1604), structurally-stuck escalation path (#1613), stale-interrupted auto-close via shipped-unclosed evidence (#1673), pre-compact live-multi-spec-run false-clean race (#1502); claims — repair-claim.js CLI mirroring release-claim.js (#1608), parseRepo owner/repo traversal guard audited across 8 callers (#1443), claims-git-cas CAS-primitive dedup follow-up (#1466), group claim/release fetch amortization (#1467), dispatch two-call claim-persistence fix (#1486), missing claims-registry entry diagnosis (#1505); worktree/session guards — worktree-always wrap-up-outcomes.tsv commit fix (#1561), classifyOwnership owner-absent foreign-classification fix (#1563), EnterWorktree fresh-baseRef staleness fix (#1464), stale-same-name remote-branch collision (#1470), false-positive complete Bash guard fix (#1651), SessionStart freshly-created-worktree false positive (#1463), pre-tool-use hasMaterializeCommit range bound (#1674), run-integrity torn-down-worktree fallback evidence (#1672); new: /claude-tweaks:sweep orchestrator (#1494), /claude-tweaks:intake braindump gatekeeper (#1704, #1703); misc fixes — github-pr-scan.md graphql -f/-F placeholder bug (#626), materialize.js gh MCP-fallback gap (#1459), file-feedback.js gh ENOBUFS dedup fix (#1564), detectIntegrationModel gh-absent MCP fallback (#1558), grant-veto-window-hours 0 documentation (#1469), specify Key Files generator-module miss (#1321), framing-check declined-rationale encoding (#1276), review-lens degrade-path naming (#1449), wrap-up post-merge curation-fix ordering (#1465), tidy residue needs:decision + committed staged/ + --approve (#1493), webhook trigger live-verify (#1485), LITERAL_TMP_RE placeholder-span fix (#1511), PR #1506/#327 merge-authorization diagnosis (#1507), doc staleness fixes (#1698, #1699), build/worktree-setup pr-early lifecycle push/PR-open fix (#1456), subagent-stop.js contract-violation ownedRun scoping fix (#1425), bookkeeping-stamps gate first-push exemption fix (#1501). Plus a whole-branch pre-release review pass: repair-claim.js path-traversal parity, ad-hoc-standalone archival tracked-entry guard, teardown-run live-worktree refusal fix (#1731, #1736) -- #1732/#1733/#1734/#1737/#1738/#1739 filed as backlog for the review's remaining architectural findings..

## v6.112.0 — Whole-branch batch since v6.111.0: dispatch/queue — bare invocation --budget queue drain for specify/dispatch (#1491, #1492), two-call context pack + reconcile double-run fix (#1542, #1543, #1544), mega-bundle group-size ceiling before headless build (#1557), queue ranking git-ref cache (#1571), headless ceremony-profile derivation (#1545); backlog/refine — single human attention list + refine #N resolver + --reset-breaker (#1489), retire grant mode into refine's headless posture (#1490), byte-ceiling headroom extraction (#1512); reconcile/archive — 3 move-failed stuck run dirs repaired (#1446, #1447, #1649), ad-hoc-standalone eventual-cleanup path (#1604), structurally-stuck escalation path (#1613), stale-interrupted auto-close via shipped-unclosed evidence (#1673), pre-compact live-multi-spec-run false-clean race (#1502); claims — repair-claim.js CLI mirroring release-claim.js (#1608), parseRepo owner/repo traversal guard audited across 8 callers (#1443), claims-git-cas CAS-primitive dedup follow-up (#1466), group claim/release fetch amortization (#1467), dispatch two-call claim-persistence fix (#1486), missing claims-registry entry diagnosis (#1505); worktree/session guards — worktree-always wrap-up-outcomes.tsv commit fix (#1561), classifyOwnership owner-absent foreign-classification fix (#1563), EnterWorktree fresh-baseRef staleness fix (#1464), stale-same-name remote-branch collision (#1470), false-positive complete Bash guard fix (#1651), SessionStart freshly-created-worktree false positive (#1463), pre-tool-use hasMaterializeCommit range bound (#1674), run-integrity torn-down-worktree fallback evidence (#1672); new: /claude-tweaks:sweep orchestrator (#1494), /claude-tweaks:intake braindump gatekeeper (#1704, #1703); misc fixes — github-pr-scan.md graphql -f/-F placeholder bug (#626), materialize.js gh MCP-fallback gap (#1459), file-feedback.js gh ENOBUFS dedup fix (#1564), detectIntegrationModel gh-absent MCP fallback (#1558), grant-veto-window-hours 0 documentation (#1469), specify Key Files generator-module miss (#1321), framing-check declined-rationale encoding (#1276), review-lens degrade-path naming (#1449), wrap-up post-merge curation-fix ordering (#1465), tidy residue needs:decision + committed staged/ + --approve (#1493), webhook trigger live-verify (#1485), LITERAL_TMP_RE placeholder-span fix (#1511), PR #1506/#327 merge-authorization diagnosis (#1507), doc staleness fixes (#1698, #1699), build/worktree-setup pr-early lifecycle push/PR-open fix (#1456), subagent-stop.js contract-violation ownedRun scoping fix (#1425), bookkeeping-stamps gate first-push exemption fix (#1501). Plus a whole-branch pre-release review pass: repair-claim.js path-traversal parity, ad-hoc-standalone archival tracked-entry guard, teardown-run live-worktree refusal fix (#1731, #1736) -- #1732/#1733/#1734/#1737/#1738/#1739 filed as backlog for the review's remaining architectural findings.

Whole-branch batch since v6.111.0: dispatch/queue — bare invocation --budget queue drain for specify/dispatch (#1491, #1492), two-call context pack + reconcile double-run fix (#1542, #1543, #1544), mega-bundle group-size ceiling before headless build (#1557), queue ranking git-ref cache (#1571), headless ceremony-profile derivation (#1545); backlog/refine — single human attention list + refine #N resolver + --reset-breaker (#1489), retire grant mode into refine's headless posture (#1490), byte-ceiling headroom extraction (#1512); reconcile/archive — 3 move-failed stuck run dirs repaired (#1446, #1447, #1649), ad-hoc-standalone eventual-cleanup path (#1604), structurally-stuck escalation path (#1613), stale-interrupted auto-close via shipped-unclosed evidence (#1673), pre-compact live-multi-spec-run false-clean race (#1502); claims — repair-claim.js CLI mirroring release-claim.js (#1608), parseRepo owner/repo traversal guard audited across 8 callers (#1443), claims-git-cas CAS-primitive dedup follow-up (#1466), group claim/release fetch amortization (#1467), dispatch two-call claim-persistence fix (#1486), missing claims-registry entry diagnosis (#1505); worktree/session guards — worktree-always wrap-up-outcomes.tsv commit fix (#1561), classifyOwnership owner-absent foreign-classification fix (#1563), EnterWorktree fresh-baseRef staleness fix (#1464), stale-same-name remote-branch collision (#1470), false-positive complete Bash guard fix (#1651), SessionStart freshly-created-worktree false positive (#1463), pre-tool-use hasMaterializeCommit range bound (#1674), run-integrity torn-down-worktree fallback evidence (#1672); new: /claude-tweaks:sweep orchestrator (#1494), /claude-tweaks:intake braindump gatekeeper (#1704, #1703); misc fixes — github-pr-scan.md graphql -f/-F placeholder bug (#626), materialize.js gh MCP-fallback gap (#1459), file-feedback.js gh ENOBUFS dedup fix (#1564), detectIntegrationModel gh-absent MCP fallback (#1558), grant-veto-window-hours 0 documentation (#1469), specify Key Files generator-module miss (#1321), framing-check declined-rationale encoding (#1276), review-lens degrade-path naming (#1449), wrap-up post-merge curation-fix ordering (#1465), tidy residue needs:decision + committed staged/ + --approve (#1493), webhook trigger live-verify (#1485), LITERAL_TMP_RE placeholder-span fix (#1511), PR #1506/#327 merge-authorization diagnosis (#1507), doc staleness fixes (#1698, #1699), build/worktree-setup pr-early lifecycle push/PR-open fix (#1456), subagent-stop.js contract-violation ownedRun scoping fix (#1425), bookkeeping-stamps gate first-push exemption fix (#1501). Plus a whole-branch pre-release review pass: repair-claim.js path-traversal parity, ad-hoc-standalone archival tracked-entry guard, teardown-run live-worktree refusal fix (#1731, #1736) -- #1732/#1733/#1734/#1737/#1738/#1739 filed as backlog for the review's remaining architectural findings..

## v6.111.0 — compare-shell: restyle the judged candidate when a tweak lever moves (#1336); sweep capture's headless absorb bar (#1296); document escalate-residue.js's minimal-label posture (#1216); fix stale redTip claim in docs/reconcile-checks.md

compare-shell: restyle the judged candidate when a tweak lever moves (#1336); sweep capture's headless absorb bar (#1296); document escalate-residue.js's minimal-label posture (#1216); fix stale redTip claim in docs/reconcile-checks.md.

## v6.110.1 — Fix ENOBUFS crash in backlog-grant-gate.js gh/git runners (#1658); consolidate maxBuffer literal into shared-primitives.js and drop a risky timeout per review (#1661)

Fix ENOBUFS crash in backlog-grant-gate.js gh/git runners (#1658); consolidate maxBuffer literal into shared-primitives.js and drop a risky timeout per review (#1661).

## v6.110.0 — Merged-record batch: resolve-policy merge-verification/integration-model dedup regression-testable (#604); tidy net-empty branches canonical section (#613); auto-decision-log.md Entry schema CLI signature fix (#815); init pnpm node_modules permission allowlist (#836); build: extract plan-authoring checks + Common Step 2 dispatch detail into lazy-loaded sub-files (#897); in-flight-tombstone claim stop wired into Settle/gh-absent MCP transport (#974); hooks.js subcommand --help-as-real-argument guard (#1143); archiveRunDir multi-pair commit-failure revert test coverage (#1214); AskUserQuestion background-dispatch narration rule (#1219); review-console.md Step 10 populates verify-expectations.json issues key (#1223); dispatch groupByFileOverlap false-giant-bundle fix via directory-level Key Files tokens (#1228); wrap-up ledger closeout for #1308 (#1308); recent-commit overlap check for health-sweep/capture filing (#1316); gh-absent MCP fallback for backlog grant mode (#1352); pr-early run lifecycle missing success-path decisions.md trail (#1356); skill-prose-conformance-tests Instances list fix (#1359); #1259 contract-violation dispatch site confirmed third-party-exempt (#1368); tidy Yours-section actionable commands + why-not-auto reasoning (#1383); events.jsonl cross-run contamination fix via worktree-aware fallback attribution (#1410); mcpReachable override wired into resolve-policy.js CLI (#1421). Plus a whole-branch pre-release review pass: policy-derived-defaults.js local-merge pin defeat under mcpReachable, close-run foreign-worktree reporting regression, tidy-report-lint condensed-surface Yours-row gap, runGitAsync stderr shape parity, and a preflight.test.js flake removal (#1655) -- #1652/#1653/#1654 filed as backlog for the review's remaining architectural findings.

Merged-record batch: resolve-policy merge-verification/integration-model dedup regression-testable (#604); tidy net-empty branches canonical section (#613); auto-decision-log.md Entry schema CLI signature fix (#815); init pnpm node_modules permission allowlist (#836); build: extract plan-authoring checks + Common Step 2 dispatch detail into lazy-loaded sub-files (#897); in-flight-tombstone claim stop wired into Settle/gh-absent MCP transport (#974); hooks.js subcommand --help-as-real-argument guard (#1143); archiveRunDir multi-pair commit-failure revert test coverage (#1214); AskUserQuestion background-dispatch narration rule (#1219); review-console.md Step 10 populates verify-expectations.json issues key (#1223); dispatch groupByFileOverlap false-giant-bundle fix via directory-level Key Files tokens (#1228); wrap-up ledger closeout for #1308 (#1308); recent-commit overlap check for health-sweep/capture filing (#1316); gh-absent MCP fallback for backlog grant mode (#1352); pr-early run lifecycle missing success-path decisions.md trail (#1356); skill-prose-conformance-tests Instances list fix (#1359); #1259 contract-violation dispatch site confirmed third-party-exempt (#1368); tidy Yours-section actionable commands + why-not-auto reasoning (#1383); events.jsonl cross-run contamination fix via worktree-aware fallback attribution (#1410); mcpReachable override wired into resolve-policy.js CLI (#1421). Plus a whole-branch pre-release review pass: policy-derived-defaults.js local-merge pin defeat under mcpReachable, close-run foreign-worktree reporting regression, tidy-report-lint condensed-surface Yours-row gap, runGitAsync stderr shape parity, and a preflight.test.js flake removal (#1655) -- #1652/#1653/#1654 filed as backlog for the review's remaining architectural findings..

## v6.109.1 — Statusline: Nerd Font octocat glyph replaces the octopus emoji; the project-folder link gains a trailing slash so it opens the folder itself

Statusline: Nerd Font octocat glyph replaces the octopus emoji; the project-folder link gains a trailing slash so it opens the folder itself.

## v6.109.0 — Statusline: project-name segment is now clickable — the name opens the local folder (OSC 8 file:// link, Finder/Explorer), and an octopus glyph appears when origin is a github.com remote, opening the repo page. Merged-record batch also carried: label-rename CHANGELOG ops note (#255); run-integrity repoRootOf coupling test (#374); EnterWorktree PostToolUse dead-code check (#457); deferred live-verification AC documentation (#769); local-merge auto-mode finishing-a-development-branch awareness (#771); issue-claims lock-read 404 branch spellout + tidy claim-read migration (#780); auto-decision-log degrade-trace SKIP entries adopted in /build (#904); session temp-root convention sweep (#923); decision-doc staleness fixes (#1197, #1198); materialize.js main-checkout-anchored --run-dir (#1210); build-review-context tmp-deny collision fix (#1213); wrap-up engine lookup/parsing dedup (#1237); tidy digest-sweep dispatch wiring (#1273); stale .superpowers/sdd plan debris cleared (#1307); resolve-blockers per-blocker open state (#1309); compute-then-exit truncation fixes in release.js/review-coordination.js (#1313); veto-window-hours resolver fallback fix (#1315); teardown-run archive path doubling fix (#1323); wrap-up standalone-run friction-events backfill (#1333); friction-events test-fixture pollution filter (#1337); declined-learning store Minor-findings sweep (#1399); skill-graph table conformance lint (#1432); specShapedBody replacement-string splice fix (#1435); needs:decision residue sweep (#1488).

Statusline: project-name segment is now clickable — the name opens the local folder (OSC 8 file:// link, Finder/Explorer), and an octopus glyph appears when origin is a github.com remote, opening the repo page. Merged-record batch also carried: label-rename CHANGELOG ops note (#255); run-integrity repoRootOf coupling test (#374); EnterWorktree PostToolUse dead-code check (#457); deferred live-verification AC documentation (#769); local-merge auto-mode finishing-a-development-branch awareness (#771); issue-claims lock-read 404 branch spellout + tidy claim-read migration (#780); auto-decision-log degrade-trace SKIP entries adopted in /build (#904); session temp-root convention sweep (#923); decision-doc staleness fixes (#1197, #1198); materialize.js main-checkout-anchored --run-dir (#1210); build-review-context tmp-deny collision fix (#1213); wrap-up engine lookup/parsing dedup (#1237); tidy digest-sweep dispatch wiring (#1273); stale .superpowers/sdd plan debris cleared (#1307); resolve-blockers per-blocker open state (#1309); compute-then-exit truncation fixes in release.js/review-coordination.js (#1313); veto-window-hours resolver fallback fix (#1315); teardown-run archive path doubling fix (#1323); wrap-up standalone-run friction-events backfill (#1333); friction-events test-fixture pollution filter (#1337); declined-learning store Minor-findings sweep (#1399); skill-graph table conformance lint (#1432); specShapedBody replacement-string splice fix (#1435); needs:decision residue sweep (#1488)..

## v6.108.0 — Merged-PR batch: claims-registry transport consolidation onto git-CAS with contents-API fallback (#787); veto-window maturation for machine-granted auto:merge grants (#309); merge-check needs-human carveout takes precedence over consoleAutoResolve (#1179); dispatch worktree-entry cwd-pinned-subagent fallback (#447); untrusted-record-content contract extended to grant-check (#1391, #1119); trust-table.md routes through session scratchpad instead of bare /tmp (#1386); fetch-sub-issues.js gains --resolve-retries, migrating the retry ladders (#1153); harness-health detects a bypassed CLAUDE.md pipeline override (#809); dispatch grouping excludes bare-directory Key Files entries from union bridging (#1420); tidy scan-procedures dirty-worktree override fix (#1424); context.js acquireRunStateLock not-vulnerable documentation (#1348); specify decomposition-mode.md split under the 40KB ceiling (#611); wrap-up light fragment routing fast-path (#797); review Risk-Marker Verification sub-check for self-flagged-risk specs (#361, #362); harness-health-analysis check-9 snippet zsh nomatch abort fix (#1292); pre-release whole-branch review fix batch hardening the claims/release-claim safety net (writeTombstone ghApi classification, unreadable re-verification fallthrough, git-CAS exhausted-retry fallback, FETCH_HEAD race, self-write misclassification)

Merged-PR batch: claims-registry transport consolidation onto git-CAS with contents-API fallback (#787); veto-window maturation for machine-granted auto:merge grants (#309); merge-check needs-human carveout takes precedence over consoleAutoResolve (#1179); dispatch worktree-entry cwd-pinned-subagent fallback (#447); untrusted-record-content contract extended to grant-check (#1391, #1119); trust-table.md routes through session scratchpad instead of bare /tmp (#1386); fetch-sub-issues.js gains --resolve-retries, migrating the retry ladders (#1153); harness-health detects a bypassed CLAUDE.md pipeline override (#809); dispatch grouping excludes bare-directory Key Files entries from union bridging (#1420); tidy scan-procedures dirty-worktree override fix (#1424); context.js acquireRunStateLock not-vulnerable documentation (#1348); specify decomposition-mode.md split under the 40KB ceiling (#611); wrap-up light fragment routing fast-path (#797); review Risk-Marker Verification sub-check for self-flagged-risk specs (#361, #362); harness-health-analysis check-9 snippet zsh nomatch abort fix (#1292); pre-release whole-branch review fix batch hardening the claims/release-claim safety net (writeTombstone ghApi classification, unreadable re-verification fallthrough, git-CAS exhausted-retry fallback, FETCH_HEAD race, self-write misclassification).

## v6.107.0 — Batch: dispatch fixes (#989, #1118, #1365), grant-mode CLI + docs (#1384, #1385, #1387, #1388), payload boundary test (#419), flake adjudication (#882), untrusted-content hardening (#1274, #1275), demo/verification gates (#808, #1194), feedback tooling (#834, #835, #1094), run-dir/archival fixes (#990, #1073, #1376), policy audit (#839), declined-learning store (#1033), console teardown fix (#819), changelog gate fix (#1373)

Batch: dispatch fixes (#989, #1118, #1365), grant-mode CLI + docs (#1384, #1385, #1387, #1388), payload boundary test (#419), flake adjudication (#882), untrusted-content hardening (#1274, #1275), demo/verification gates (#808, #1194), feedback tooling (#834, #835, #1094), run-dir/archival fixes (#990, #1073, #1376), policy audit (#839), declined-learning store (#1033), console teardown fix (#819), changelog gate fix (#1373).

## v6.106.0 — Bookkeeping-stamps gate hardened — deny a covered write when record-worktree/record-pr never stamped run-state.json after materialize, IL-131 (#991); strengthen the record-worktree branch with a ctx.ownedRun foreign-session signal (#1259). Subagent fan-out contract: pin the single-assistant-message rule and cite it at 9 dispatch sites, closing the 18-serial-agent defect class (#649). framing-check: weigh supplied ## Gotchas evidence when re-judging a previously-flagged record (#772); close the untrusted-content boundary's escapable-delimiter and verdict-parse holes (#1041). Materiality floor: new contract + digest + tidy sweep (#1261), migrate the ten exhaust channels onto it (#1262), and carry the Original-request placeholder exemption through shapeGate (#1240). /specify: decomposition collapse rules (#1263); /capture: absorb-by-default (#1264). Archival/residue fix wave — remove the existence-only archive-skip, add revert-on-mid-loop-failure and restore concurrent-archival protection (#1103); materialize.js now writes work/{n}-spec.md under the main-checkout-anchored --run-dir, never inside the invoking worktree (#1158); fix residue.js's suiteRun() ENOBUFS false-failure on large passing suites (#1160); pin the no-judge-commit rule and serial-commit pass, attributing Initiative-Fix commits to the controller (#1140); pipeline-run archival residue sweep (#1164). Consolidate 6 CLIs onto the canonical parseRepo (#1177). Also: /tidy scan step for orphaned docs/plans/*-ledger.md files (#113); code-health durable wontfix fork decision synced to health-state.md (#171); routine notifications field + empirical-blocker docs + build-time record snapshots (#68, #211); track-issue-fixes.yml edge-case hardening (#326); demo verdict provenance distinguishing batch sign-off from walkthrough-backed approval (#431); dispatched /flow no longer silently skips the worktree stamp + PR bootstrap (#778); release-claim.js gets a distinct exit code for an unreadable/corrupt claim blob (#817); PR body HTML-comment MCP-strip root cause + dual-marker fallback (#929); assess-agent-autonomy SKILL.md router trimmed ~21% plus merge-check plugin-repo-detection fix (#739, #116); staged-inventory reconciliation ledger resolved (#1269); also #257, #352, #357, #434, #614, #735, #759, #1034, #1051, #1059, #1060, #1068, #1123, #1129, #1130, #1131, #1137, #1138, #1139, #1145, #1146, #1147, #1148, #1167, #1170, #1171, #1172, #1174, #1175, #1176, #1181, #1183, #1184, #1185, #1186, #1207, #1248, #1250, #1270, #1295, #1297, #1305. Plus a whole-branch pre-release review pass (specify red-team's stage-item.js/log-decision.js call fixed to not fire with no run directory; docs/plugin-structure.md's stale --run subcommand count and health-core listing; 4 fan-out sites missing the #649 citation; a stale repo-resolve.js header comment; 9 orphaned merged-issue ledgers removed).

Bookkeeping-stamps gate hardened — deny a covered write when record-worktree/record-pr never stamped run-state.json after materialize, IL-131 (#991); strengthen the record-worktree branch with a ctx.ownedRun foreign-session signal (#1259). Subagent fan-out contract: pin the single-assistant-message rule and cite it at 9 dispatch sites, closing the 18-serial-agent defect class (#649). framing-check: weigh supplied ## Gotchas evidence when re-judging a previously-flagged record (#772); close the untrusted-content boundary's escapable-delimiter and verdict-parse holes (#1041). Materiality floor: new contract + digest + tidy sweep (#1261), migrate the ten exhaust channels onto it (#1262), and carry the Original-request placeholder exemption through shapeGate (#1240). /specify: decomposition collapse rules (#1263); /capture: absorb-by-default (#1264). Archival/residue fix wave — remove the existence-only archive-skip, add revert-on-mid-loop-failure and restore concurrent-archival protection (#1103); materialize.js now writes work/{n}-spec.md under the main-checkout-anchored --run-dir, never inside the invoking worktree (#1158); fix residue.js's suiteRun() ENOBUFS false-failure on large passing suites (#1160); pin the no-judge-commit rule and serial-commit pass, attributing Initiative-Fix commits to the controller (#1140); pipeline-run archival residue sweep (#1164). Consolidate 6 CLIs onto the canonical parseRepo (#1177). Also: /tidy scan step for orphaned docs/plans/*-ledger.md files (#113); code-health durable wontfix fork decision synced to health-state.md (#171); routine notifications field + empirical-blocker docs + build-time record snapshots (#68, #211); track-issue-fixes.yml edge-case hardening (#326); demo verdict provenance distinguishing batch sign-off from walkthrough-backed approval (#431); dispatched /flow no longer silently skips the worktree stamp + PR bootstrap (#778); release-claim.js gets a distinct exit code for an unreadable/corrupt claim blob (#817); PR body HTML-comment MCP-strip root cause + dual-marker fallback (#929); assess-agent-autonomy SKILL.md router trimmed ~21% plus merge-check plugin-repo-detection fix (#739, #116); staged-inventory reconciliation ledger resolved (#1269); also #257, #352, #357, #434, #614, #735, #759, #1034, #1051, #1059, #1060, #1068, #1123, #1129, #1130, #1131, #1137, #1138, #1139, #1145, #1146, #1147, #1148, #1167, #1170, #1171, #1172, #1174, #1175, #1176, #1181, #1183, #1184, #1185, #1186, #1207, #1248, #1250, #1270, #1295, #1297, #1305. Plus a whole-branch pre-release review pass (specify red-team's stage-item.js/log-decision.js call fixed to not fire with no run directory; docs/plugin-structure.md's stale --run subcommand count and health-core listing; 4 fan-out sites missing the #649 citation; a stale repo-resolve.js header comment; 9 orphaned merged-issue ledgers removed)..

## v6.105.0 — Wrap-up verify verb (#900) and closure-gate hardening, autonomy-ceiling auto-resolve for backlog batch-confirm (#1178), session-tmp-root shared-contract migration (#266), design-wrapper compare-shell template+seeder (#1203) and visual-decision contract rewrite (#1204) on the visual-decide serve-and-capture CLI (#1202/#1205), overview per-stage batch commands (#1101), apply-refine-labels empty --run fix (#1173), and 4 whole-branch-review correctness fixes (#1229-#1232); also carries #172, #230, #316, #343, #344, #345, #652, #899

Wrap-up verify verb (#900) and closure-gate hardening, autonomy-ceiling auto-resolve for backlog batch-confirm (#1178), session-tmp-root shared-contract migration (#266), design-wrapper compare-shell template+seeder (#1203) and visual-decision contract rewrite (#1204) on the visual-decide serve-and-capture CLI (#1202/#1205), overview per-stage batch commands (#1101), apply-refine-labels empty --run fix (#1173), and 4 whole-branch-review correctness fixes (#1229-#1232); also carries #172, #230, #316, #343, #344, #345, #652, #899.

## v6.104.1 — Whole-branch pre-release review fixes (hooks.js worktree-local-fallback disclosure, declined-learning store race + atomic writes, sweep-shadow TOCTOU race, fetch-sub-issues zero-arg contract, pr-state bulk-query pagination guard, code-health dot-dir scan-failure fail-safe, worktree-name empty-segment fix, wrap-up-residue-pr sweep backstop, repo-resolve/json-store dedup); reconcile archival catch-up also carries #244, #478, #486, #522, #959

Whole-branch pre-release review fixes (hooks.js worktree-local-fallback disclosure, declined-learning store race + atomic writes, sweep-shadow TOCTOU race, fetch-sub-issues zero-arg contract, pr-state bulk-query pagination guard, code-health dot-dir scan-failure fail-safe, worktree-name empty-segment fix, wrap-up-residue-pr sweep backstop, repo-resolve/json-store dedup); reconcile archival catch-up also carries #244, #478, #486, #522, #959.

## v6.104.0 — Review-gated batch: pre-release fixes — legacy-root artifact auto-delete capped at record (#1078), env-flag git gate bypass closed incl. attached -C form + EnterWorktree PostToolUse seam registered (#590); specify parent-record guard (#1071); multispec boundary freshness gate (#1076); QA artifact relocation + residue probe (#1077); backlog refine batch-dispatch (#844); declined-learning fingerprint store (#849); batched sub-issue fetch (#1097); classifyOwnership predicate (#1098); reconcile bulk PR + archive-branches screens (#1082, #1083); pr-state prefer-open (#664); also #194, #196, #205, #227, #231, #355, #375, #380, #435, #458, #488, #499, #539, #549, #550, #551, #596, #628, #642, #657, #659, #660, #672, #696, #706, #786, #802, #814, #826, #827, #838, #843, #951, #1011, #1065

Review-gated batch: pre-release fixes — legacy-root artifact auto-delete capped at record (#1078), env-flag git gate bypass closed incl. attached -C form + EnterWorktree PostToolUse seam registered (#590); specify parent-record guard (#1071); multispec boundary freshness gate (#1076); QA artifact relocation + residue probe (#1077); backlog refine batch-dispatch (#844); declined-learning fingerprint store (#849); batched sub-issue fetch (#1097); classifyOwnership predicate (#1098); reconcile bulk PR + archive-branches screens (#1082, #1083); pr-state prefer-open (#664); also #194, #196, #205, #227, #231, #355, #375, #380, #435, #458, #488, #499, #539, #549, #550, #551, #596, #628, #642, #657, #659, #660, #672, #696, #706, #786, #802, #814, #826, #827, #838, #843, #951, #1011, #1065.

## v6.103.0 — Merged-PR batch: worktree-always gate verb-aware read-only allowlist + delete-only push exemption (#658); non-canonical run-dir timestamps surfaced in reconcile, dash format pinned at mint (#848); /help acceptance-queue local-files twin (#203); anchored-staged-path invariant hoisted into pipeline-run-dir.md (#737); specify option-block cost/effort/churn admissibility rule (#639); design-wrapper explore layout-scope render-set widened

Merged-PR batch: worktree-always gate verb-aware read-only allowlist + delete-only push exemption (#658); non-canonical run-dir timestamps surfaced in reconcile, dash format pinned at mint (#848); /help acceptance-queue local-files twin (#203); anchored-staged-path invariant hoisted into pipeline-run-dir.md (#737); specify option-block cost/effort/churn admissibility rule (#639); design-wrapper explore layout-scope render-set widened.

## v6.102.0 — Headless shaping unit: specify next mode with framing-check guard and shaped:headless label (#967, #968), grant-gate oversight floor for shaped:headless records (#969), specify routine template + fleet row 9 (#970); dispatch local-merge resume question-string template (#545); help policy mode renders Shape-B derived defaults as computed (#636); build plan-authoring checks extracted to sub-file (ceiling breach)

Headless shaping unit: specify next mode with framing-check guard and shaped:headless label (#967, #968), grant-gate oversight floor for shaped:headless records (#969), specify routine template + fleet row 9 (#970); dispatch local-merge resume question-string template (#545); help policy mode renders Shape-B derived defaults as computed (#636); build plan-authoring checks extracted to sub-file (ceiling breach).

## v6.101.0 — Merged-PR batch: one-off Routine cadence via run_once_at, exempt from the daily cap (#212); bin/stage-item.js staged/ writer CLI (#637); reconcile archive-tag namespace collision fix with injective suffix encoding (#548); statusline wrapper honors CLAUDE_CONFIG_DIR (#633); Subagent Contract path-reference fix (#744); dispatch resume-gate no-carve-out rationale

Merged-PR batch: one-off Routine cadence via run_once_at, exempt from the daily cap (#212); bin/stage-item.js staged/ writer CLI (#637); reconcile archive-tag namespace collision fix with injective suffix encoding (#548); statusline wrapper honors CLAUDE_CONFIG_DIR (#633); Subagent Contract path-reference fix (#744); dispatch resume-gate no-carve-out rationale.

## v6.100.2 — Merged-PR batch: CLAUDE.md/template writing-plans contradiction narrowed to multi-phase files (#643); stray NUL byte stripped from initiative-budget.js + payload UTF-8 conformance guard (#859); eval fixtures frozen at pre-6.48.0 policy shape (#631); ADR-0010 stale Consequences bullet fix

Merged-PR batch: CLAUDE.md/template writing-plans contradiction narrowed to multi-phase files (#643); stray NUL byte stripped from initiative-budget.js + payload UTF-8 conformance guard (#859); eval fixtures frozen at pre-6.48.0 policy shape (#631); ADR-0010 stale Consequences bullet fix.

## v6.100.1 — Merged-PR batch: worktree gate same-command shell-variable resolution (#630); cloud-setup drift check resolves sha-pinned catalog entries (#860 follow-up); backlog overview needsYou overlay skips parent records (#766); Shape 2 prose-only trigger false-premise guard; IL-141/IL-115 citation fixes

Merged-PR batch: worktree gate same-command shell-variable resolution (#630); cloud-setup drift check resolves sha-pinned catalog entries (#860 follow-up); backlog overview needsYou overlay skips parent records (#766); Shape 2 prose-only trigger false-premise guard; IL-141/IL-115 citation fixes.

## v6.100.0 — Merged-PR batch: reconcile compact default output + --json (#638); worktree PreToolUse guard over-match fix (#861); worktree-always write-shape docs (#640); RENAMED_KEYS conformance pin (#629); auto-mode severity ceiling vocabulary (#332); capture duplicate-CLI cross-session signal (#789); archiveRunDir engine-state residue (#893); resolve-profile session-failure blacklist follow-ups parked (#841); ledger post-hoc drift fast-lane (#879); tidy scan-procedures gh-absent description fix (#172 follow-up); EnterWorktree retry branch-collision fast-lane; verify-mode entry-grammar dedup

Merged-PR batch: reconcile compact default output + --json (#638); worktree PreToolUse guard over-match fix (#861); worktree-always write-shape docs (#640); RENAMED_KEYS conformance pin (#629); auto-mode severity ceiling vocabulary (#332); capture duplicate-CLI cross-session signal (#789); archiveRunDir engine-state residue (#893); resolve-profile session-failure blacklist follow-ups parked (#841); ledger post-hoc drift fast-lane (#879); tidy scan-procedures gh-absent description fix (#172 follow-up); EnterWorktree retry branch-collision fast-lane; verify-mode entry-grammar dedup.

## v6.99.0 — Dispatch batch: routine pause/resume + sampling floor for the trust ladder (#213, #310); github-pr-scan MCP fallback (#172); Section E ownership-check fix (#226); Impeccable Rule 5 fail/skip prose (#206); mutation-probe discipline for test tasks (#250); residue-probe header restoration + wrap-up prose fixes (#229); docs/donts.md IL-nn dedup + grammar fix (#244); multi-spec.md #724 budget fix

Dispatch batch: routine pause/resume + sampling floor for the trust ladder (#213, #310); github-pr-scan MCP fallback (#172); Section E ownership-check fix (#226); Impeccable Rule 5 fail/skip prose (#206); mutation-probe discipline for test tasks (#250); residue-probe header restoration + wrap-up prose fixes (#229); docs/donts.md IL-nn dedup + grammar fix (#244); multi-spec.md #724 budget fix.

## v6.98.1 — Windows: hide console windows on the reconcile lib's own gh/git spawns — completes the v6.98.0 fix (#931, PR #955)

Windows: hide console windows on the reconcile lib's own gh/git spawns — completes the v6.98.0 fix (#931, PR #955).

## v6.98.0 — Windows: hide console windows on background reconcile git subprocesses — ends the WT window storm; blast-radius CLI (#888), transport-aware autonomy gathers (#889), verify.js runner (#892), calibration readers + report (#901), run-archival enumeration + archive-run verb (#902), tidy unfiled-drafts backstop (#905), reversibility-tiered console patch display (#906)

Windows: hide console windows on background reconcile git subprocesses — ends the WT window storm; blast-radius CLI (#888), transport-aware autonomy gathers (#889), verify.js runner (#892), calibration readers + report (#901), run-archival enumeration + archive-run verb (#902), tidy unfiled-drafts backstop (#905), reversibility-tiered console patch display (#906).

## v6.97.0 — Review objective-audit batch — SKILL.md dispatcher split, dispatch-template lazy-load fix, collision-free scratch dirs, build-review-context + review-coordination CLIs, verify-pass stamp, low-tier single-read; design-detect.js extraction, /deepen objective fruits, scope-resolution ladder, ledger ops-triage contract

Review objective-audit batch — SKILL.md dispatcher split, dispatch-template lazy-load fix, collision-free scratch dirs, build-review-context + review-coordination CLIs, verify-pass stamp, low-tier single-read; design-detect.js extraction, /deepen objective fruits, scope-resolution ladder, ledger ops-triage contract.

### also carried in this build

Records #552 (merge `31850b64`) and #890 (merge `68bea79e`) reached `main` under v6.97.0 without
a bump of their own — the release step that would have written them up never ran, so the build
that first carried them is numbered for other work. Backfilled after the fact.

## v6.96.0 — Reconcile() latency reduction, fast-lane transcript-judge extraction, backlog trust-signal + merge-lane circuit breaker, and an 8-finding pre-release review-fix batch

Reconcile() latency reduction, fast-lane transcript-judge extraction, backlog trust-signal + merge-lane circuit breaker, and an 8-finding pre-release review-fix batch.

## v6.95.0 — Cut plugin payload over to plugin/ with git-subdir marketplace source

Cut plugin payload over to plugin/ with git-subdir marketplace source.

## v6.94.0 — Hand-scripted procedure CLIs — release-claim + log-decision with anchoring guards (#686); multi-spec run infrastructure — spec-status/manifest atomic writes, sanitizeWorktreeName, two-AskUserQuestion-stop cap, PR-first console merge-decision fold (#687-#693); Multi-Spec Review Console applied fixes for #741-#743; capture --batch multi-entry filing + character-budget cap + session-scoped temp paths (#781, #783, #784); bare /feedback session-evaluation guarantee + rubric sharpening (#785, #805); backlog refine dependency-repair log fix (#792); anchoring-guard bypass fixes in run-dir/decisions.md structural checks (#813)

Hand-scripted procedure CLIs — release-claim + log-decision with anchoring guards (#686); multi-spec run infrastructure — spec-status/manifest atomic writes, sanitizeWorktreeName, two-AskUserQuestion-stop cap, PR-first console merge-decision fold (#687-#693); Multi-Spec Review Console applied fixes for #741-#743; capture --batch multi-entry filing + character-budget cap + session-scoped temp paths (#781, #783, #784); bare /feedback session-evaluation guarantee + rubric sharpening (#785, #805); backlog refine dependency-repair log fix (#792); anchoring-guard bypass fixes in run-dir/decisions.md structural checks (#813).

## v6.93.0 — Claim-infrastructure family: one-command group claim + preflight CLIs on a shared claim store with contested/transient exit codes, UTC run-dir stamps + mint hygiene, contest-card liveness verdicts, flow read-budget extractions (#720, #721, #722, #723, #724); hand-scripted procedure CLIs — materialize, claims, log-decision (#676 family); flow resume freshness probe (#749); run-dir archival on every console path (#717); wakeup-parking cap + controller context rules (#712); funnelBuckets parent exclusion (#616); worktree compound-refusal cross-reference + merge-then-suite rule (#713); /challenge bare-#N evidence mode (#726); blast-radius glob segment fix (#727); design-critique dispatch docs (#600); tidy arm-at-creation (#581)

Claim-infrastructure family: one-command group claim + preflight CLIs on a shared claim store with contested/transient exit codes, UTC run-dir stamps + mint hygiene, contest-card liveness verdicts, flow read-budget extractions (#720, #721, #722, #723, #724); hand-scripted procedure CLIs — materialize, claims, log-decision (#676 family); flow resume freshness probe (#749); run-dir archival on every console path (#717); wakeup-parking cap + controller context rules (#712); funnelBuckets parent exclusion (#616); worktree compound-refusal cross-reference + merge-then-suite rule (#713); /challenge bare-#N evidence mode (#726); blast-radius glob segment fix (#727); design-critique dispatch docs (#600); tidy arm-at-creation (#581).

## v6.92.0 — Post-merge release-carrier check + backfill journey (#678); premise-verified release row in flow's Next Actions (#680); argv-safe /feedback filing with read-back verification (#681); worktree-always twin keyed on the running build + session-start verdict banner (#682, IL-133); scratch-worktree teardown check + pr-first remote-branch cleanup (#683); /feedback evaluation watermark for delta re-judging (#679)

Post-merge release-carrier check + backfill journey (#678); premise-verified release row in flow's Next Actions (#680); argv-safe /feedback filing with read-back verification (#681); worktree-always twin keyed on the running build + session-start verdict banner (#682, IL-133); scratch-worktree teardown check + pr-first remote-branch cleanup (#683); /feedback evaluation watermark for delta re-judging (#679).

## v6.91.0 — Terminal Next Actions on the auto-mode not-silenced list — navigation affordance outside consoleAutoResolve, recommended line is the actual next command (#716); reconcile remote-prune for merged plugin branches + tidy Mark-as-specified routing (#570)

Terminal Next Actions on the auto-mode not-silenced list — navigation affordance outside consoleAutoResolve, recommended line is the actual next command (#716); reconcile remote-prune for merged plugin branches + tidy Mark-as-specified routing (#570).

## v6.90.0 — Staged-patch stage-time validation + description fallback (#674), curation-judge stagePath verification + shadow sweep (#675), framing:baked → solution:unjustified rename un-dormanting the backlog needs-you lane (#677), specify/demo #N,#M batch argument (#695), tidy report rendering width discipline + batch-pasteable commands (#685), consolidated console AUTO-RESOLVED rendering under consoleAutoResolve (#714), Next Actions omission-only recommended-slot rule (#730)

Staged-patch stage-time validation + description fallback (#674), curation-judge stagePath verification + shadow sweep (#675), framing:baked → solution:unjustified rename un-dormanting the backlog needs-you lane (#677), specify/demo #N,#M batch argument (#695), tidy report rendering width discipline + batch-pasteable commands (#685), consolidated console AUTO-RESOLVED rendering under consoleAutoResolve (#714), Next Actions omission-only recommended-slot rule (#730).

## v6.89.0 — Refine funnel redesign — refineWorklist helper with priority-keyed budget (#654, absorbs #460), ceiling-gated trust fetch with --trust, Step 4 decision lanes in refine-lanes.md with consequence-line trust and the first refine journey (#655, parent #574); reference-card --chained sync; deferral gate contract (#620-#625); terminal Next Actions as paste-ready markdown (#646)

Refine funnel redesign — refineWorklist helper with priority-keyed budget (#654, absorbs #460), ceiling-gated trust fetch with --trust, Step 4 decision lanes in refine-lanes.md with consequence-line trust and the first refine journey (#655, parent #574); reference-card --chained sync; deferral gate contract (#620-#625); terminal Next Actions as paste-ready markdown (#646).

## v6.88.0 — Routine fleet status/off + routine-kickoff kernel (#276, #528-530), reconcile red-tip detection (#561), --unattended reserved for headless invocations (#648), specify native sub_issues/blocked_by linking (#608, #610), backlog overview funnel + refine worklist fixes (#563, #575, #576), housekeeping-auto-merge ceiling-derived default

Routine fleet status/off + routine-kickoff kernel (#276, #528-530), reconcile red-tip detection (#561), --unattended reserved for headless invocations (#648), specify native sub_issues/blocked_by linking (#608, #610), backlog overview funnel + refine worklist fixes (#563, #575, #576), housekeeping-auto-merge ceiling-derived default.

## v6.87.1 — Statusline acct segment labels every account, incl. default ~/.claude via .claude.json email

Statusline acct segment labels every account, incl. default ~/.claude via .claude.json email.

### also carried in this build

The policy read-path family's Phase 4 gate closed under this number: PR #603 (records #332,
#602, #334) merged into `main` at `f061ad86`, minutes before the v6.87.1 patch bump landed
for the statusline fix above, so the build that first carried it is numbered for other work.
Backfilled during the run's own `/claude-tweaks:feedback` session.

**#332 — the policy-key naming convention, and seven renames through it.** Every
`POLICY_KEYS` name is now a flat kebab-case identifier — no dots, grouping lives in the
`category` metadata, never the key — stated once in `skills/_shared/policy-key-naming.md`
(stubbed from `policy-schema.md`'s `## Key naming`, which sits at the sub-file ceiling) and
pinned by `tests/policy-key-naming.test.js`. Seven keys renamed through `RENAMED_KEYS`
identity aliases with recorded removal conditions in `_shared/policy-deprecations.md`:
`review-severity-floor` → `review-auto-apply-ceiling` (it is the *maximum* severity
auto-applied — a ceiling, and it collided with the genuine floor `review-effort-floor`),
`automerge-max-lines`/`-files` → `auto-merge-max-*` (one spelling, matching the
`auto:merge` label), and `project.maturity`, `harness-health.scoped-rule-budget`,
`harness-health.always-loaded-budget`, `doc-convention.adr` → dashed. An un-migrated
`policy.yml` keeps resolving under the new name with `renamed-from` attribution and is
reported by `auditPolicy`; the deprecation predicate became fixed-string so a dotted old
name can actually clear it. `auto-mode` was deliberately *not* renamed (orthogonal to
`autonomy`; the categories disambiguate) — recorded so it is not re-opened.

**#602 — `worktree.always` → `worktree-always`, including the hook's own read.** The one
key the resolver's aliases could not reach: `bin/lib/policy.js`'s `isWorktreeAlwaysOn`
read the literal. It now reads through `rawValue`, which consults `RENAMED_KEYS` for the
mapping and applies new-name-wins in any file order (old alone still ON, verified against
every hook fixture on the old spelling), so no un-migrated project loses the worktree
gate. `/claude-tweaks:init`'s opt-in no longer re-asks a project on the old spelling and
migrates the line in place instead of appending a second key. This repo's own
`policy.yml` keeps **both** spellings until the installed plugin build carries the alias —
the installed build reads the old literal, and a new-name-only file would have disarmed
the gate for this repo on merge (ADR 0014, a new Don't in `docs/donts.md`).

**#334 — the six remaining `config.yml` direct reads use the resolver's `--run` overlay.**
`test`, `tidy`, `review` (×2), `specify` (×2) no longer restate a schema default inline
and now honor a `policy.yml` value between the run's Manifesto answer and the schema
default; review's ceiling-conditional default keys off the resolver envelope's `source`.

## v6.87.0 — Policy.yml gate exemption (worktree.always allows isolated policy.yml edits + allowlisted policy-only commits from a main checkout); tidy report rows render commands on their own line and the staged-items option is named for the Approve section

Policy.yml gate exemption (worktree.always allows isolated policy.yml edits + allowlisted policy-only commits from a main checkout); tidy report rows render commands on their own line and the staged-items option is named for the Approve section.

## v6.86.0 — Policy introspection: resolve-policy --all metadata, /help policy mode, init delegation; backlog overview funnel polish

Policy introspection: resolve-policy --all metadata, /help policy mode, init delegation; backlog overview funnel polish.

## v6.85.0 — Tidy report redesign + reconcile-backed auto-apply (#517-#519), /feedback session-evaluation mode (#509), resume-to-merge confirmation gate (#531), Review Console lever attribution (#535), needs:definition taxonomy, /init Enhancement filter tokens for Steps 18-20 + step-range drift fix, and closed-issue plan cleanup

Tidy report redesign + reconcile-backed auto-apply (#517-#519), /feedback session-evaluation mode (#509), resume-to-merge confirmation gate (#531), Review Console lever attribution (#535), needs:definition taxonomy, /init Enhancement filter tokens for Steps 18-20 + step-range drift fix, and closed-issue plan cleanup.

The reconcile-backed auto-apply work (#517-#519) also flips `tidy-aggressiveness`'s default from `conservative` to `moderate`: `/claude-tweaks:tidy` now auto-applies reversible git-tracked judgment cleanups (`local-files` deletes/absorbs/defers) that previously only staged for approval; outward-facing GitHub writes still stage regardless of aggressiveness. `conservative` remains available as an explicit opt-down in `.claude-tweaks/policy.yml`.

## v6.84.0 — Merge #369 (policy.yml key fix), #484 (CLAUDE.md/rules size-budget check), #479 (SKILL.md ceiling early-warning tier), and archive record #368's spec

Merge #369 (policy.yml key fix), #484 (CLAUDE.md/rules size-budget check), #479 (SKILL.md ceiling early-warning tier), and archive record #368's spec.

## v6.83.0 — Isolate /init's file writes in a worktree unconditionally, regardless of the worktree.always policy setting

Isolate /init's file writes in a worktree unconditionally, regardless of the worktree.always policy setting.

## v6.82.0 — Add a Friction reflect lens for hook/AskUserQuestion friction (#452); fold /version into /help (#440); reclassify ledger as a _shared format spec (#437); flow run-dir anchoring + oversight-floor backstop fixes (#421, #368, #388) — plus a pre-release whole-branch review fixing 8 cross-task doc/pointer defects

Add a Friction reflect lens for hook/AskUserQuestion friction (#452); fold /version into /help (#440); reclassify ledger as a _shared format spec (#437); flow run-dir anchoring + oversight-floor backstop fixes (#421, #368, #388) — plus a pre-release whole-branch review fixing 8 cross-task doc/pointer defects.

## v6.81.0 — Ship the pr-first integration model (#405-#415): GitHub-backed runs born public with a background reconciler converging state, PR-checkbox Review Console, local-merge fallback retained — plus a pre-release whole-branch review fixing 3 reconciler defects and a CI-breaking Node-version-dependent test-glob bug

Ship the pr-first integration model (#405-#415): GitHub-backed runs born public with a background reconciler converging state, PR-checkbox Review Console, local-merge fallback retained — plus a pre-release whole-branch review fixing 3 reconciler defects and a CI-breaking Node-version-dependent test-glob bug.

## v6.80.0 — Skill-invocation ledger, run-integrity detection, and teardown gate (#364/#371-373); oversight-floor predicate generalizing risk/size gates (#365-368); Frontier tier bundle (#179/#220/#221/#223); #350/#351 console fold into ledger route-remainder; #348/#349 autonomy-console + headless wrap-up; #342 residue-sweep blast-radius default — plus a pre-release whole-branch-review fix closing a teardown-gate global-flag bypass

Skill-invocation ledger, run-integrity detection, and teardown gate (#364/#371-373); oversight-floor predicate generalizing risk/size gates (#365-368); Frontier tier bundle (#179/#220/#221/#223); #350/#351 console fold into ledger route-remainder; #348/#349 autonomy-console + headless wrap-up; #342 residue-sweep blast-radius default — plus a pre-release whole-branch-review fix closing a teardown-gate global-flag bypass.

## v6.79.0 — Parent-issue vocabulary rename: `family:parent` → `parent-issue`, permanent read-side fallback for un-migrated adopters

The decomposition-acceptance vocabulary this plugin coined as "family" is renamed to "parent-issue" throughout the code contract, the skills prose, and this repo's own living docs. The GitHub label `family:parent` becomes `parent-issue`; the `local-files` facet `familyParent` becomes `isParentIssue` (frontmatter `family-parent:` becomes `is-parent-issue:`); `acceptance.js`'s `familyGateState` becomes `parentGateState`; `record.js`'s `parseFamilyLeaves` becomes `parseSubIssues`. Every scan-scope token and report-row prefix that carried `[family-gate]` now carries `[parent-gate]`, and `wrap-up/verification-brief.md`'s "Family-Gate Procedure" is now the "Parent-Gate Procedure" everywhere it's cited.

**Adopters migrate their own repo's label with one command:**

```
gh label edit "family:parent" --name "parent-issue"
```

Un-migrated repos are not broken by skipping this — every driver-side reader treats a `family:parent`-labeled issue exactly as it treats a `parent-issue`-labeled one, permanently. Unlike a normal compatibility path this one carries no removal condition short of a major version that drops pre-rename repo support outright (`[IL-85]`: a compatibility path with no stated removal condition is never collected, so this one states it up front rather than accumulating silently). `/claude-tweaks:tidy` now surfaces the retired label as its own finding shape — `[legacy] {title} — carries retired label {label} — recommend: gh label edit "family:parent" --name "parent-issue"` — so an adopter who never reads this entry still gets nudged toward running the command.

## v6.78.0 — Builder-authored observation plans in Verification Briefs and a show-first /demo: canonical schema with a pre-schema compatibility path, Prepare → Validate → Show → single verdict, repo-wide retired-prose sweep

Builder-authored observation plans in Verification Briefs and a show-first /demo: canonical schema with a pre-schema compatibility path, Prepare → Validate → Show → single verdict, repo-wide retired-prose sweep. Verification Briefs gain a builder-authored `### Observation plan` section against the canonical schema in `skills/_shared/observation-plan.md`, added expand-contract with a compatibility path for briefs written before the schema existed. `/demo` is rewritten show-first — Prepare, Validate, Show, then one verdict — replacing the old ask-first flow. Also sweeps the repo for retired ask-first demo prose and aligns the skill-graph and plugin-structure docs.

## v6.77.0 — Policy read-path unification: resolve-policy CLI as the canonical read path, prose-grep migration to it, and key collapse (execution merge, branch-divergence-check rename, three retirements)

Policy read-path unification: resolve-policy CLI as the canonical read path, prose-grep migration to it, and key collapse (execution merge, branch-divergence-check rename, three retirements).

## v6.76.1 — Add Hard gate to tidy Step 6 interactive report; fix REPO_SLUG derivation claim and code-simplifier plugin-status docs; restore dispatch routine's tightened 2-hour cadence as the template default — closes gaps found by the pre-release whole-branch review

Add Hard gate to tidy Step 6 interactive report; fix REPO_SLUG derivation claim and code-simplifier plugin-status docs; restore dispatch routine's tightened 2-hour cadence as the template default — closes gaps found by the pre-release whole-branch review.

## v6.76.0 — Self-maintaining fleet: backlog grant machine-grant unit, trust-ladder negative evidence, fleet on provisioning, test-hygiene/abstraction-police/experiment-cleanup verticals

Self-maintaining fleet: backlog grant machine-grant unit, trust-ladder negative evidence, fleet on provisioning, test-hygiene/abstraction-police/experiment-cleanup verticals.

## v6.74.0 — Canonical logging cloud-setup Setup-script line with self-upgrading field procedure, routine-preamble setup-log evidence + self-heal-to-execution fallback (dispatch/tidy excluded), cloud-parity Routine-scope corrections (IL-117)

Canonical logging cloud-setup Setup-script line with self-upgrading field procedure, routine-preamble setup-log evidence + self-heal-to-execution fallback (dispatch/tidy excluded), cloud-parity Routine-scope corrections (IL-117).

## v6.75.0 — never shipped; the causal-depth-contract build's premature bump, reverted the same session

`main`'s tip briefly reported this version (`cd2a4d8a`) before being reverted the same
session (`a4096509`, "versioning happens at release time via `bin/release.js`, not
per-build") — but the revert commit still landed on `main`'s first-parent chain, so the
coverage gate's git walk sees the number regardless. Recorded here and in
`docs/shipped-versions.tsv` (source `wip-never-shipped`), same reasoning as v6.64.3:
a walk-visible version with no entry is indistinguishable from a skipped changelog step,
and the record's failure asymmetry deliberately prefers one unnecessary entry over an
erasable release. No install ever ran this version; the manifest stayed at v6.74.0
throughout.

## v6.73.1 — Close the claim deprecation window, retire the per-run record cache, fix the writeRunState CI flake

Close the claim deprecation window, retire the per-run record cache, fix the writeRunState CI flake.

## v6.73.0 — Harness lever wave: substrate fold, re-read cuts, sync-surface tests, record cache, claim-store unification

Harness lever wave: substrate fold, re-read cuts, sync-surface tests, record cache, claim-store unification.

## v6.72.0 — Release automation CLI and CLAUDE.md context-budget shrink

Release automation CLI and CLAUDE.md context-budget shrink.

## v6.71.1 — the routine preamble self-heals before attempting a skill it already knows is missing

Live-testing a Routine on a freshly-fixed environment surfaced a second, cheaper gap on top of `[IL-115]`'s
fix: on a container where the plugin genuinely isn't installed, the standard preamble's resolved-build
check correctly reports `unresolved`, but the prompt still attempted the skill kickoff first — a
predictable "Unknown skill" failure — before investigating and self-healing via
`bash scripts/claude-cloud-setup.sh`, observed costing several extra exploratory commands every firing.
The preamble now runs `claude plugin list --json` unconditionally (verbose, so a transcript shows every
installed plugin up front, not just claude-tweaks) and, when all four resolution rungs come up empty,
self-heals immediately rather than after a wasted invocation attempt. Mirrored into the canonical block in
`_shared/routine-template-schema.md` and all six `skills/*/routine-template.yml` templates, each with its
`template_version` bumped — existing live routines pick this up via `/claude-tweaks:routine update <skill>`.

## v6.71.0 — wrap-up rebuilt as four phases: a code engine now runs curation and renders the report

The wrap-up skill's 17 numbered steps become four phases (ESTABLISH → ROUTE → SETTLE → CLOSE), and the seven-plus hand-written curation steps collapse into one declarative registry (`bin/lib/wrap-up/registry.js`, 8 rows) driven by a new engine (`bin/wrap-up-engine.js`: `plan` computes gates and scopes deterministically, `record` validates judge payloads and writes the single uniform `SCANNED` audit line plus a per-row outcomes TSV, `render` emits the phase-trace tables and console sections — so the report can no longer drift, because the model never formats it). The Review Console now runs in every mode: Phase 1 creates a pipeline run directory unconditionally, retiring the fragmented standalone path (Step 9 batch decision + per-item asks) and the standalone-has-no-console branches. A pinning test (`tests/wrap-up-registry-pin.test.js`) locks the SKILL.md registry table to the code registry; `config-updates.md` split into `claude-md-curation.md` + `adr-curation.md`; six judge files slimmed to judgment-only; a repo-wide sweep re-pointed every step-number reference to the phase architecture. The motivating failure was v6.70.0's own wrap-up report: seven mandatory `SCANNED` templates rendered in seven drifted formats.

## v6.70.1 — a cold sandbox's non-install could pass `claude-cloud-setup.sh`'s own verify loop as "ok"

The verify-and-repair loop `claude-cloud-setup.sh` runs after installing plugins (added for `#129`
to catch a script that reports success without actually landing anything) gated its drift check on
whether a catalog version could be resolved to compare against. On a sandbox's first-ever cold run,
the marketplace catalog lookup can fail for the same underlying reason nothing installed — which
degrades to the same "nothing to compare against" sentinel a marketplace with no declared version
legitimately produces, and the guard silently treated both as "nothing to repair." Confirmed live:
the first Routine firing on a freshly-provisioned dedicated environment showed all four
provisioning steps (including "Ran setup script") completed successfully, yet the plugin was not
installed. Fixed by making "nothing installed on disk" an unconditional drift signal, independent
of whether a catalog version was resolvable. See `[IL-115]`.

## v6.70.0 — the Setup script, not the declaration, is what installs a plugin in the cloud

A project could declare `claude-tweaks` in its `.claude/settings.json`, have `/init` Step 14
generate `scripts/claude-cloud-setup.sh`, and still get `Unknown command` for every skill in a
claude.ai/code session. Measured inside a live sandbox whose clone carried the declaration, with
network access **Full** and the marketplace repo clonable from the VM: `~/.claude/plugins/` did
not exist at all. The declaration is a permission; the Setup script is the installer — and the
only flow that attached it did so for environments it created *for routines*. Interactive
sessions use whichever environment the composer has selected, which nothing here had ever
touched `[IL-113]`.

- `routine/guided-environment-creation.md` gains an **Ensure-setup-script** procedure that opens
  an existing environment from the session composer (chip → Cloud → hover → gear) and attaches
  the invocation, appending rather than overwriting when the field already holds unrelated
  content. Also records that extension pairing can drop between `list_connected_browsers` and
  `select_browser`, so the listing must be re-read immediately before selecting.
- `/init` Step 14 now offers to run that procedure after generating the script, instead of only
  telling the user to paste it by hand.
- Step 14's prose no longer implies declaring is sufficient, and its "First exposure" caveat no
  longer advises waiting for a self-heal: it gives `ls ~/.claude/plugins/` as the discriminator
  between "nothing installed, waiting won't help" and the genuinely transient case.
- This repo now runs its own Step 14: `scripts/claude-cloud-setup.sh`, a `## Cloud parity`
  CLAUDE.md section, and `superpowers@claude-plugins-official` added to a declaration that
  previously named only `claude-tweaks` — a hard dependency its own skills call constantly.

## v6.69.0 — wrap-up computes what it leaves outstanding, instead of narrating it

A session's leftovers used to survive only as prose in a transcript: a red suite, an
unreaped branch, a PR missing its release triple. Nothing read that prose, so the items
were rediscovered later or not at all.

`bin/residue.js` and `bin/lib/residue/` now compute them. Six probes — worktrees,
branches, claim refs, open PRs, the test suite, this repo's release triple — produce a
shared finding shape carrying a `remedy` (`auto` or `record`) and an honest `ran` flag:
a probe that could not run renders `unknown` with its reason and is never folded into a
clean verdict. `/wrap-up` runs the sweep ahead of Step 8.5, writing each finding as a
ledger item so that gate's existing per-item forced disposition resolves it — the sweep
became the producer the standalone case never had, rather than a second disposition
mechanism beside it. `/tidy` Step 4.5 consumes the same probes.

The report gains `Outstanding` (no row may render without `Fixed` / `Filed as #N` /
`Accepted — reason`), `Routed` (destinations named, never their content restated), and a
one-line `Verdict`. `skills/_shared/scratch-worktree.md` documents the provision → merge
→ act → ff-merge → tear-down path a `worktree.always` project needs once its feature
worktree is gone.

Two conflated signals were separated across four wrap-up files: *a record was identified*
(from an argument, branch name, or commit trailer) versus *a materialized header exists on
disk*. Before this, `/claude-tweaks:wrap-up #N` run standalone silently skipped record
closure, acceptance labeling, unblocked-records, and claim release — every one of them
gated on a header a standalone run never has.

## v6.68.2 — the /research deps fallback stops naming context7

context7 is retired from this user's toolchain, and the deps-fallback sentence in
`skills/research/source-registry.md` was its one functional citation in the plugin: it now
names WebFetch of the dependency's public documentation as the mechanism. The pinned test
regex in `tests/research/skill-md.test.js` is tightened in step — its alternation would
otherwise keep passing on a term the prose no longer contains. All shadcn support is
untouched: the dead MCP the cleanup started from was a user-level `shadcn.io` entry,
unrelated to `/init` Step 13's official `npx shadcn@latest mcp` wiring.

## v6.68.1 — the convention-detection contract loses its patent-law jargon

`_shared/prior-art-detection.md` is now `_shared/existing-convention-detection.md`, and the concept it names is "the repo's existing convention" rather than "prior art". Six live references swept — `_shared/decision-records.md`, `_shared/diataxis-genre-templates.md`, `_shared/policy-schema.md`, `wrap-up/config-updates.md`, `wrap-up/SKILL.md`, `docs/skill-graph.md`.

Renamed because the maintainer read the term and asked what it meant. "Prior art" is precise borrowed jargon — patent law, meaning evidence that something existed before a claimed invention — and precision is not the same as legibility. An agent meeting that reference cold in a lazy-loaded `_shared/` fragment has no surrounding context to recover the meaning from, which is the specific failure the plugin's own naming conventions exist to prevent. The cost of renaming rises with every skill that cites it, so it was worth paying before Phase 2 (#194) adds more consumers.

The term also collided inside this repo. `/claude-tweaks:research` does prior-art lookup in the ordinary sense — external libraries, standards, vendors — and `docs/skill-graph.md` carried both meanings a hundred lines apart. Only one of them was about documentation genres.

Behavior is unchanged: same procedure, same three outcomes, same `doc-convention.adr` key. The dated design doc and plan keep the old vocabulary as the historical record they are, with a pointer at the top of the spec naming the current file so the reference does not dangle. ADR 0013 keeps its filename and title for the same reason — an accepted decision record is dated evidence, superseded rather than edited — and gains a pointer note instead.

## v6.64.3 — never shipped; the number the rename WIP carried before landing as v6.68.1

`main`'s tip never reported this version, so no install could ever have run it. The
preserved-WIP commit that carried it (`e2a583f0`, an `[IL-46]` preservation) was renumbered
to v6.68.1 at the merge — but that merge put the WIP commit on `main`'s first-parent chain,
so the coverage gate's git walk sees the number anyway. Recorded here and in
`docs/shipped-versions.tsv` (source `wip-never-shipped`) because a walk-visible version with
no entry is indistinguishable from a skipped changelog step, and the record's failure
asymmetry deliberately prefers one unnecessary entry over an erasable release
(`bin/lib/shipped-record.js`). The work itself is written up under v6.68.1.

## v6.68.0 — /research gains a verify mode that grounds a design before it is written

Closes the loop `/claude-tweaks:challenge` used to open: assumptions were surfaced and then nothing
checked them. `/claude-tweaks:research verify` answers them against real sources first.

- **`verify` mode on `/claude-tweaks:research`** (#176) — a leading positional mode token, following
  `assess-agent-autonomy`'s precedent rather than overloading `--mode=`, which already means depth
  tier. New `skills/research/verify-mode.md` carries input resolution, the consequence filter, the
  question-shape split, and auto-mode behavior; the bare-topic web-survey path is untouched.
  - The **consequence filter** is the whole cost-control mechanism: for each candidate question,
    *if the answer surprised me, would the design change?* Two outcomes only — research it, or drop
    it and log the drop. No budget knob and no per-source authorization, so a topic where nothing
    diverges costs nothing and a topic on new ground authorizes more work automatically.
  - Depth tiers (`quick|standard|deep|ultradeep`) are rescoped to bound **survey breadth only**;
    they do not govern falsifiable questions, which are settled by whether a source falsifies them.
  - Resolved deferred decision: `verify` is **not** reachable from `/claude-tweaks:flow`. `/flow`
    consumes ready leaf records, which are post-design by construction, so grounding there is
    structurally too late.
- **Source registry, parallel dispatch, and verdict shape** (#177) — new
  `skills/research/source-registry.md`. Nine sources keyed by **what each can falsify**, not by which
  tool they use, so three entries that all run `grep` stay distinct. A question routes to every source
  that could falsify it; multiple sources per question is the normal case. `human` is an exclusive
  terminator that dispatches no agent. Verdicts carry `claim`, `outcome`, `source`, per-source
  `confidence`, `provenance`, and the `checked-at` sha — confidence per source, never per report, so a
  grep-verified fact cannot lend its credibility to a blog post beside it.
- **IL-45 now prescribes a content check** (#106) — `git diff <branch> <default-branch>` returning
  empty, rather than SHA identity. A rebase- or squash-merge rewrites the commits, so a SHA check can
  never pass however cleanly the branch landed, and this repo's merge convention favors rebase.
- **Three new rules from the build itself** — `[IL-105]` gains its mechanism for content assertions
  (negate the prose and assert the regex fails; 11 assertions in one run survived a presence check),
  plus `[IL-106]` (no long-running command between an implementer's last edit and its commit — 4 of 4
  stalled there) and `[IL-107]` (a record's stated facts expire while it waits its turn in a long
  batch — 11 upstream releases during one run destroyed one record and falsified two others').

Record #178 was closed as obsolete during this build: upstream reshaped `/claude-tweaks:challenge`
mid-run and deleted the Brainstorming Brief it existed entirely to modify. Its surviving idea — a
three-value verification outcome — shipped in #177's verdict shape instead. The write-back half is
recorded as unowned in `verify-mode.md`'s Output section.
## v6.67.1 — dispatch can group /specify-produced records again

Closes #154. `extractKeyFiles` branched on the four health-sweep origin labels and fell
through to `return []` for everything else, so every `/claude-tweaks:specify` leaf and
every `/claude-tweaks:capture` record reported zero key files. `groupByFileOverlap` then
emitted singletons regardless of real overlap — defeating the collision guard
`/claude-tweaks:dispatch` relies on to keep two agents out of the same files.

Measured against live records rather than argued: #146 and #150 both returned `[]` while
genuinely sharing `skills/design-wrapper/SKILL.md` and
`skills/design-wrapper/impeccable-plugin.md`. Dispatch would have built them in two
separate worktrees, both editing those two files. Not hypothetical — it is why this
repository's own nine-record dispatch program was scheduled by hand instead.

Now parses the `### Key Files` subsection `spec-template.md` already documents: first
backticked span per list item, trailing `(modify — …)` annotations discarded, section
terminated at the next heading so backticked paths in Gotchas are not scraped. Placed
strictly below the four health branches, which all return early, so an origin-labelled
record whose body happens to carry a `### Key Files` heading still reads from its own
header line (`[IL-83]`).

Tested against frozen fixtures of the two record bodies rather than live issue text, so
the test does not become a scheduled failure the next time someone edits an issue
(`[IL-80]`). Re-verified against the live records after the fix: 6 and 5 paths, two
shared, one group instead of two singletons.

Originally authored on `worktree-fix-154-extract-key-files` (PR #182), which had drifted
173 commits behind `main` while its session ended. Cherry-picked onto current `main`
unchanged, and renumbered from 6.65.3 when `main` shipped past it mid-flight.

## v6.67.0 — the acceptance backstops both work on the local-files driver

`/claude-tweaks:tidy` has two acceptance backstops: `family-gate` (a decomposition family is
complete but its parent carries no disposition) and `acceptance-gap` (a closed record carries
no disposition at all). Both lived in `_shared/github-pr-scan.md`, a file the Detection Ladder
gates on `gh` reachability, and both queried GitHub labels — so under `work-backend:
local-files` neither existed. v6.63.0 gave `family-gate` a local twin. This closes the other
one, and pays the structural debt that made room for it.

- **`acceptance-gap` gains a local-files twin** as Shape 8 in `/claude-tweaks:tidy` Step 1,
  emitting the same `[acceptance-gap]` prefix every consumer is already wired for. It feeds
  `needsBackstop` from `bin/lib/issues/acceptance.js` rather than reimplementing the
  disposition taxonomy, translating `facets.closed` → CLOSED, `facets.acceptance` → the label
  form, and `facets.parent !== null` → `hasParent`. Decomposed leaves stay suppressed on this
  driver too: their acceptance lives on the family's parent, and surfacing them would flood the
  report. A closed *parent* does surface — leaves are suppressed, parents never are, matching
  the GitHub twin.
- **`skills/tidy/scan-procedures.md` was 549 bytes from the ceiling**, so Shape 8 could not be
  appended — the file would have overshot by 5,155 bytes and failed
  `bin/lib/skill-audit/tests/context-cost.js`'s gate outright. Step 1's rules were extracted to
  `skills/tidy/step-1-records.md`, split by step because every external citation names a step or
  one of its shapes and none names a driver. The record scan now loads 20,747 bytes instead of
  40,411 (-49%), and the eight non-record scopes load 27,402 (-32%). The honest cost:
  `--scope=specs` and a full unscoped run load both files, since Step 5 stayed behind — those
  paths are +19%.
- Corrected a duplicate `## v6.61.2` heading that had reached `main` and was failing
  `tests/changelog-coverage.test.js` for every session. The renumbered work's content lives
  under **v6.64.2**; the 6.61.2 slot keeps the restoration record that points at it, and the
  one detail the duplicate carried that its stub did not — the recovered text's `[IL-104]`
  citation, which shipped as `[IL-105]` — was re-homed rather than dropped.
## v6.65.2 — the reaper's staleness check looks at the whole worktree

Closes #199, a defect in v6.65.0 found by its own whole-branch review.

The check that decides whether a dead-PID lock means "abandoned" read the worktree root
and its immediate entries only. Directory mtimes do not propagate upward, so an in-place
write to `wt/a/b/c.js` moves nothing above it — depth was never a safe proxy for activity.

Measured against this repository's live worktrees rather than argued: `fix-132-routine-branch`
reported 25.3h idle while its newest write was 22.5h old, four levels down in
`.claude-tweaks/pipelines/{run}/events.jsonl`, which the hooks touch on every tool call.
Under the 24-hour grace period that is the difference between keeping a worktree and
unlocking and deleting it.

Now recursive, skipping `.git` (git's own bookkeeping — and `hasLocalOnlyContent` runs
`git status` inside the worktree, so an admin-dir signal would be perturbed by the reaper
itself) and `node_modules`. Bounded at 5000 entries; exhausting the budget returns null,
which reads as **not** stale and keeps the worktree, because a partial answer is precisely
the defect being replaced.

The cheaper signal tried first — the worktree's git index mtime — was measured and
rejected: it reported 25.3h, identical to the shallow scan, because that session's recent
activity was hook writes rather than git commands. A full walk costs ~900 entries and
20-50ms here, against the ~0.64s per candidate the two git calls already cost, behind a
cap of three.

## v6.65.1 — the renumber rule stops erasing releases that already shipped

The Releasing section told you to renumber a CHANGELOG heading whenever a collision forced a new
version, justified by "an entry naming a version that never reached `main` is an orphan." That
justification only holds for a number that never shipped.

It happened **twice in one day**, to two different sessions. `e4a79904` applied the rule literally
to 6.62.0 — which *had* reached `main`'s tip — so moving its heading to 6.64.0 deleted the record of
a real release, and step 3's "renumber this line too" took the `docs/shipped-versions.tsv` line with
it. The identical thing had already happened to 6.61.2 (`a5476a4b`), renumbered to 6.64.2. Both were
found the same way: `tests/changelog-coverage.test.js` failing on a version the git walk can still
see with nothing to match it against. 6.62.0 was restored in 6.64.1; 6.61.2 is restored here, both
from their original release commits rather than reconstructed.

The recurrence is the argument. One session mis-applying a rule is a mistake; two independent
sessions doing it inside 24 hours is the rule being wrong.

- **Steps 2 and 3 now split on whether the old number reached `main`'s tip.** Never shipped →
  renumber, as before. Shipped → keep the old entry and add a second one for the new number,
  pointing at it rather than duplicating the body, since a duplicate heading is its own parse
  failure in that same test. Step 3 carries the matching split for the tsv line, and says which
  half of the mistake is the damaging one: that file is the authority for what shipped (`[IL-95]`),
  so a deleted line is the real loss and the changelog gap is merely what surfaces it.

No new Don't. The person who erased 6.62.0 was following the Releasing section literally, and that
section is already in the always-loaded file — a Don't bullet would be a second copy of the same
instruction, and an incident-log entry with no rule behind it is an orphan by this repo's own
definition.

## v6.65.0 — a worktree stops being the only place its pipeline state lives, and finished ones get reaped

Closes #185. Removing a git worktree was dangerous for one reason: it could hold the
only copy of a run's `config.yml`, `decisions.md`, `events.jsonl` and `staged/`. So
nothing dared, and 21 accumulated here in a month while three files disagreed about
which command was even allowed.

**Run directories now anchor to the main checkout at creation.** Resolved from a linked
worktree's `.git` file — which is a plain file naming the shared checkout — so it costs
no subprocess on a path every hook invocation crosses. This changes *when* run state
reaches the main checkout, not *where* it ends up: `wrap-up` already copied it out at
cleanup, and doing that at cleanup is precisely why a skipped cleanup lost it. That
copy-out is now **deleted**, along with the ordering rule protecting it, rather than
duplicated into a second consumer. `work/{n}-spec.md` stays in the worktree — it is
git-tracked and reaches `main` by merge.

**`SessionStart` reaps worktrees that are finished.** Five conditions, all required: a
linked worktree under `.claude/worktrees/`; not the caller's own directory or a
subdirectory of it; no live owner; content-identical to the resolved integration branch;
and nothing in `git status --porcelain --ignored`. Any ambiguity surfaces instead of
acting. There is no policy key to disable it — the predicate is the safety mechanism, so
every branch of it fails closed.

Two things made this decidable that were not obvious:

- **The owning PID is in the lock reason.** `git worktree list --porcelain` reports
  `locked claude session <name> (pid 29881 start …)`, so "is this in use, or did its
  session die?" is a `process.kill(pid, 0)` call rather than a guess. A dead PID alone
  is still not enough — a session resumed after a process restart carries a stale one —
  so an orphaned lock must also be untouched for 24 hours.
- **Merge state is content identity, not ancestry.** `git merge-base --is-ancestor`
  returns false for a branch merged with `gh pr merge --rebase`, permanently, because
  rebasing rewrites the SHAs while the content lands intact. This repository favors
  rebase merges, so an ancestry check would have refused to reap the common case, and
  no test would have failed. See #106, the same trap one layer over.

**`[IL-58]` is narrowed to the locked case.** The incident was real but generalized a
locked worktree's failure into a claim about `EnterWorktree` provenance; seven unlocked
harness-created worktrees removed cleanly with the raw git form on the first attempt.
`/tidy` Step 4.5 is correct as written again, and `ExitWorktree` is named as the remedy
for a session's own worktree — the case the reaper deliberately never touches.

A transitional guard in `wrap-up` copies out any run directory that still resolves inside
a worktree, for runs created before this shipped. It is dated for removal, and it is the
one piece here that could not be covered by a test, so it was executed against a
multi-spec fixture instead — which is how it was caught copying a fixed list of filenames
and missing the per-record `spec-{n}/` directories beside them.

## v6.64.2 — the wrap-up helper stops claiming a fact it did not measure, and a rule for checks that cannot fail

Follow-ups deferred from v6.60.0's reviews, plus the rule the whole build kept demonstrating.

- `bin/lib/wrap-up/state.js` — `pushed` returned a definite `false` when the upstream resolved
  but the paired `rev-list` did not, making "not pushed" indistinguishable from "could not tell".
  It is now `boolean | null`, and `render.js` prints `push status unknown ({upstream})` for the
  null case rather than borrowing `UNPUSHED` — claiming unpushed when you do not know is the
  same defect facing the other way.
- `bin/wrap-up-state.js` — `parseArgs` consumed a following flag as `--since`'s value, so
  `--since --json HEAD~5` silently dropped both. It now exits 2 instead.
- `skills/wrap-up/summary-template.md` — the exit-2 path added in v6.60.0 had no consumer-side
  instruction, so a wrong `{base}` could cost the whole State block; and the record-mode closure
  line still asserted "its plans and ledger have been deleted" unconditionally, while the
  conversation-mode line beside it was already measured. Both fixed.
- `skills/wrap-up/verification-brief.md` — the `{base}` pointer named the wrong step.
- `[IL-105]` — **Don't treat a check's green as evidence before naming what its red would look
  like.** Five checks in the v6.60.0 build reported success while the thing they checked was
  false: a `grep -c` that a failing test satisfies identically, four mechanical checks green on a
  feature whose one required value was undefined, a deleted-line sweep that dropped every input
  line beginning with `-`, and a reviewer who examined a command and judged it correct without
  checking the branch it named. Four of the five were introduced while fixing one of the others.

## v6.64.1 — /claude-tweaks:routine reads its records from the branch they live on

`.claude-tweaks/routines/*.yml` is a committed artifact, but all three of `/claude-tweaks:routine`'s
modes read it straight from the working checkout with no fetch. A checkout behind its integration
branch therefore reported drift that did not exist — and then fed that stale read into real writes
(#190). Reported from a live run where all six of a project's routines showed as needing an update
while the integration branch already had every one of them current; the checkout was 119 commits
behind, with nothing in `git status` indicating it.

- **`skills/routine/record-freshness.md`** — one procedure, cited by all three call sites. Resolves
  the branch of record per `_shared/integration-branch.md` (starting at rank 3: `--branch` and
  `template.branch` name the branch a routine *audits*, which is a different question), then compares
  the working copy against it over the **union** of both sides.
- **`compareRoutineRecords` / `readRoutineRecordsAtRef`** (`bin/lib/routine-template-parser.js`) —
  the comparison itself, so the fix is testable rather than prose-only. Reads records at a ref via
  `git ls-tree`/`git show` without touching the working tree.
- **CREATE Step 3 is the one that mattered.** A record committed upstream was invisible to a
  working-tree read, so the idempotency check routed to CREATE and minted a *second live routine* —
  the duplicate the skill's own Anti-Patterns table forbids, which `RemoteTrigger` has no delete
  action to undo. Existence is now the union, and an upstream-only record hard-stops with both
  recovery commands. UPDATE stops on the same evidence (every step past it writes). STATUS never
  stops: it enumerates the union, computes each verdict against the authoritative copy, and names
  which tree it read.
- **Fail-open by construction.** No remote, no network, a fetch past its timeout, or no branch
  resolved all degrade to the pre-#190 working-checkout read and print one line saying so. Both
  stops are gated on a *verified* comparison, so `/claude-tweaks:routine status` still works offline
  — a naive fetch at the top of three steps would have been a worse regression than the bug.

Distinct from #11 (the cloud sandbox's checkout at firing time) and #132 (which branch a routine
audits); this is the local skill invocation reading stale project state.


## v6.64.0 — the plugin's doc conventions notice when a repo already has its own

- **Prior-art detection for documentation genres** — new `skills/_shared/prior-art-detection.md` is the canonical contract for the question no doc-creating path used to ask: does this repo already have its own convention for the genre about to be written? `/claude-tweaks:wrap-up` Step 6.2 now resolves an ADR's path through it instead of asserting `docs/decisions/NNNN-{kebab-slug}.md`, so a repo whose decision records follow a different grammar gets one three-way Review Console choice — conform forward, migrate, or keep the project's form — rather than a second grammar in the same directory. A repo with no decision records, or one already matching, never sees a prompt. The answer records in the new `doc-convention.adr` policy key, which stores which source wins rather than a grammar, keeping it flat-encodable. `_shared/diataxis-genre-templates.md` gains a per-genre declaration table; only ADR is wired, and rows marked Phase 2 say so explicitly, since a row claiming detection with no consumer is a promise nothing keeps. The evidence behind the corpus-versus-project-skill split: a 16-ADR corpus measured 16/16 consistent on filename grammar but 9/5/2 on one heading's casing, so filenames may be inferred and sections may not. Review Console numbering gained its first per-item row inside a batch section, and its Approve-all rules were amended to cover it. Recorded as ADR 0013.

## v6.63.0 — the family gate reaches dispatched groups and the local-files driver

Four follow-ups to v6.61.0's parent-record acceptance gate, two of them behavioral.

- **A dispatched multi-leaf family now gets its eager gate.** `/claude-tweaks:dispatch`
  labels before the single merge that carries every `Fixes #{issue}`, and the gate's
  self-inclusion rule was singular — "the leaf this run is closing counts as `CLOSED`" —
  so every sibling evaluated with its siblings still open, `familyGateState` returned
  `incomplete` for all of them, and nothing was labeled: not the leaves, not the parent.
  The rule now takes a caller-supplied `$CLOSING_LEAVES` set, and a leaf-side entry that
  supplies none defaults to the one-element set rather than the empty one — so the group
  case is a strict widening of the old rule, not a replacement that can silently no-op.
- **`work-backend: local-files` gains a `family-gate` backstop.** Both sweeps lived in
  `_shared/github-pr-scan.md`, a file the Detection Ladder gates on `gh` reachability, so
  a local-files family whose last leaf closed outside `/claude-tweaks:wrap-up` had no
  eager path *and* no backstop. `/claude-tweaks:tidy` Step 1 gains Shape 7, alongside the
  driver-scoped shapes already there, emitting the same `[family-gate]` prefix every
  consumer is already wired for, with an `Open family gate` counterpart in
  `actions-local-files.md`. Staged at every tier, like its GitHub twin: opening a gate
  **latches** — once written, `familyGateState` reads `gated` forever and both paths
  no-op — so an auto-applied brief would become the input to a human sign-off with its
  own cause erased from the data (`[IL-96]`'s shape).
- Corrected the driver-specific claims the above made stale: Step 7.5's verification row
  (unrunnable on the driver it was meant to verify), Shape 1's parent exemption (which
  named the wrong sibling and, on that driver, a sibling running in its own agent), and
  five restatements of a `gh`-reachability justification that conflated the Detection
  Ladder's three checks with `work-backend` — the Ladder never checks the driver
  (`[IL-24]`).
- Doc repairs: the design doc's Problem section no longer contradicts its own
  Measured-state table about how many callers write `demo:pending`, and `README.md`,
  `docs/plugin-structure.md` and `docs/skill-graph.md` stop describing the procedure as
  Step-10-only or as labeling "the record" when for a decomposed leaf it labels the
  parent.

## v6.62.0 — prior-art detection, first shipped under this number

Bookkeeping restoration, not new work. The prior-art-detection feature was released as 6.62.0 in
`8275bfa5` and reached `main`'s tip under that number. A later collision renumbered it to 6.64.0
and moved the CHANGELOG heading with it — correct for a version that never shipped, but 6.62.0
*had* shipped, so the move erased the record of a real release rather than an orphan. The git walk
in `tests/changelog-coverage.test.js` still sees 6.62.0 and had no entry to match it against.

See **v6.64.0** above for what the release actually contains; the two numbers carry the same work.
Restored while merging #190 — see `[IL-95]` for why `docs/shipped-versions.tsv` is the authority
here, and the renumber note in CLAUDE.md's Releasing section for the rule this case sits just
outside: renumber the heading when the old number never reached `main`, and add a second entry
when it did.


## v6.61.2 — the wrap-up helper's fix, first shipped under this number

Bookkeeping restoration, not new work — the same renumber-after-ship loss as v6.62.0 below.
Released as 6.61.2 in `a5476a4b` and reached `main`'s tip under that number; a later collision
renumbered the work to 6.64.2 and moved its CHANGELOG heading and `docs/shipped-versions.tsv`
line along with it, erasing the record of a real release.

See **v6.64.2** above for what the release contains; the two numbers carry the same work.
Restored in 6.65.1, which also fixed the rule that caused both losses. The recovered text
carried one correction: it cited `[IL-104]` for the checks rule, which shipped as `[IL-105]`
after a collision renumber — `IL-104` is a different incident. This is the `[IL-94]`/`[IL-99]`
shape the coverage gate exists to catch, and it caught it.

## v6.61.3 — skill files stop citing a design doc that was deleted a month ago

Seven citations across six live skill files pointed at
`docs/superpowers/specs/2026-07-15-fast-lane-pipeline-profile-design.md`, deleted under
ADR-0007. Every agent reading those skills was sent to a file that does not exist (closes
#114). `docs/skill-graph.md` cited it too, as live rationale — that one was in neither the
record's list nor its historical-exclusion list.

**Nothing was blanket-repointed at the amending doc**, which is the obvious fix and the wrong
one. `2026-07-20-lifecycle-ceremony-tiering-design.md` *references* the escape hatch but never
defines it — it says those parts "still apply as written", pointing back at the deleted file.
Repointing there would have produced a second dangling pointer that reads as fixed.

So each site was resolved by what it actually cited:

- **Behavior** now points at the skill that implements it — the ceremony escape hatch is
  `wrap-up/SKILL.md` Step 3.5, the `ceremony-check` contract is
  `assess-agent-autonomy/SKILL.md`'s own mode section.
- **Rationale** was restated inline where it was short enough to carry — why `/reflect`'s light
  mode keeps Near-misses and Fresh-start and drops the rest: those two can still produce the
  Safety regression finding the escape hatch keys on, and the others are narrative.
- **Lever definitions** point at `_shared/policy-schema.md`.

This follows a precedent already sitting one row above the replaced `skill-graph.md` entry:
*"Calibration cases live in `merge-check` Step 2, deliberately not in the design doc — the
previous anchor was a design doc, and it was pruned."* Anchoring live prose to a dated design
doc is the defect, not the particular doc that got deleted.

References remaining in `docs/superpowers/plans/`, `CHANGELOG.md`, and the amending design doc
are historical record and stay. The amending doc's own stale citations are flagged at the live
pointer in `skill-graph.md` rather than rewritten in place — a dated design doc says what was
true when it was written.

## v6.61.0 — a decomposition's parent record is the family's acceptance checkpoint

`/claude-tweaks:specify` cuts a design along layer lines, which produces a serial chain
of leaves where no single leaf is demoable and every failure lands on the seam *between*
them — the one place per-leaf review cannot see by construction. The record that should
have held the family-level verdict, the parent, held nothing: it sat in a double blind
spot, invisible to `/help` Stage 4.7 (which needs `demo:pending`, and parents never
reached `/wrap-up` to get it) and to `/tidy` Step 4.8 (whose `needsBackstop` requires
`CLOSED`, and nothing anywhere closed a parent).

- **The parent now carries one gate for the whole family.** A leaf with a resolvable
  parent no longer receives its own `demo:pending`; when the last leaf closes,
  `/claude-tweaks:wrap-up` composes the parent's Verification Brief — one item per
  `## Cross-Spec Promises` row, plus a walkthrough of the feature's primary path — and
  applies `demo:pending`. `/claude-tweaks:demo` resolves the verdict and, on approve,
  **closes the parent**, which nothing in the system previously ever did.
- **A backstop for the families the eager path misses.** `/claude-tweaks:tidy` gains a
  `family-gate` scope and an `Open family gate` action: a leaf closed via `auto:merge`,
  by hand, or by a dispatch that ended early never runs `/wrap-up`, so the sweep finds
  complete-but-un-gated families and opens the gate. The gate is opened, never resolved
  — the disposition stays staged and human-only at every `tidy-aggressiveness` tier,
  because the auto-mode contract forbids unattended API writes.
- **The family is the unit of evidence, not just of acceptance.** `needsBackstop` and
  `trustRows` both gained an explicit-boolean `hasParent` check, so a decomposed family
  contributes one graded record — its parent — rather than N un-dispositioned leaves.
  Without it, seven unexamined leaves plus one approved parent would have satisfied the
  trust table's sample floor on the strength of a single click.
- Parents become enumerable via a `family:parent` label (`github-issues`) and a
  `familyParent` facet (`local-files`); `bin/lib/issues/record.js` gains
  `parseFamilyLeaves`, and `bin/lib/issues/acceptance.js` gains `familyGateState`.

This narrows v6.50.0's guarantee deliberately: every closed record **that is not a
decomposed leaf**, plus every completed family, reaches an explicit disposition. The
unit moves from record to family; silence is still not a valid outcome for a family.

The branch's own history is the argument for the feature. Its whole-branch review caught
a defect that existed in neither side alone — v6.57.1 added two callers of
`verification-brief.md` that bypass Step 10, where the leaf-skip condition lived, so
merging upstream would have reinstated per-leaf labeling and silently defeated the
design. The condition now lives in that procedure's own header, where every caller
inherits it (`[IL-02]`).

## v6.60.0 — the wrap-up report states what is true of the repository, not what the run remembers

`skills/wrap-up/summary-template.md` rendered exactly one shape, keyed to `## Wrap-Up: Record #{n}`.
`SKILL.md` declares two modes and told conversation-based runs only what to *skip*, never what their
summary looks like — so a run with no record had no template to follow and composed its report from
the steps it had just executed. That is why one read as a step log: internal `D1`-`D5` route codes as
a table column, five lines of scan telemetry at the same weight as the one scan that found something,
decisions mixed with settled cleanup, a `git rebase` disclosed inside a table cell's rationale column,
and the fact that the commit had never left the machine arriving as a postscript below the table.

- **New `bin/wrap-up-state.js` + `bin/lib/wrap-up/`** — reads branch, commit count, and pushed-vs-unpushed
  from git, and classifies `git reflog` into report-worthy history operations (a rebase collapses to one
  row; `reset` always reports, since reflog cannot distinguish `--hard` from `--soft`; fast-forward merges
  drop). Every field is present even when unknown, because a field that disappears reads as an absent fact
  rather than an unknown one — the mechanism behind the original "it landed."
- **The report is now State / Actions Performed / Decisions / Evidence.** State is rendered from the helper
  rather than composed; a new `History` action type carries git operations that were previously disclosed,
  if at all, as a rationale for something else. Route codes never reach the reader — destinations are named.
  Full `SCANNED` lines stay in `decisions.md`; the summary carries a one-line roll-up.
- **A conversation-mode variant**, which is the gap that caused all of the above.
- Scope base resolves against the **integration branch** (`_shared/integration-branch.md`'s ladder), not
  GitHub's default-branch pointer — the display-fact distinction `[IL-91]`'s neighbours already record.

`skills/wrap-up/SKILL.md` shrank while the feature grew.

## v6.59.1 — two rules from the framing-gate build, where a written instruction outran its mechanism

Wrap-up capture for v6.58.0. Both rules come from defects that survived per-task review and
were caught only by someone opening the file the prose pointed at.

- `[IL-102]` — an instruction was added to `/claude-tweaks:specify`'s procedure three times
  while the mechanism a few lines below (a `gh issue edit` block, a `gh issue create` block,
  and `local-store.js`'s frontmatter serializer) never carried it. Two of the three landed
  *while fixing the first*. The new Don't: find the nearest thing that executes and confirm it
  carries the item — "the step above says to do it" is not a mechanism.
- `[IL-103]` — the `risk:*`/`ceremony:*` omit-rule idiom was copied for a presence-only marker
  whose common case is absence, producing a command block that stamped it on every record. The
  new Don't: state a neighbouring convention's common case before adopting it; where yours
  differs, the default must invert.

No behavior change — CLAUDE.md, `docs/incident-log.md`, and two project memory files only.

## v6.59.0 — a run can repair the references its own change broke

Phase 4 of the earned-autonomy design. `CLAUDE.md`'s Don'ts prescribe the same sweep by hand
in five separate rules (`[IL-10]`, `[IL-17]`, `[IL-21]`, `[IL-52]`, `[IL-93]`), every one
recording the same failure: when a change renames or removes something, references to the old
name survive in files the change never touched, and task-scoped review cannot see them by
construction. `/claude-tweaks:wrap-up` now runs that sweep itself.

- **Step 7.12, the broken-reference sweep** (`wrap-up/reference-sweep.md`) — computes the run's
  rename/move/delete set, greps for surviving references to the old names, and reports every
  hit. At `autonomy: supervised`, the default, it stages all of them and applies nothing, so
  the step is pure detection for any project that has not opted in.
- **The in-run initiative budget** (`_shared/initiative-budget.md`,
  `bin/lib/issues/initiative-budget.js`) — at `trusted`/`unattended`, up to three of those
  repairs apply during the run instead of waiting for approval, capped at 2 files and 20 lines
  each, in their own commit with an `Initiative-Fix:` trailer so `/claude-tweaks:review` is
  never handed unrequested edits mixed into the diff it was asked to review.

**The carve-out is causal, not size-based.** `_shared/auto-mode-contract.md` keeps "code
modifications outside the skill's documented scope" in what `auto` never silences, because that
row exists to stop a skill reaching outward to make its own work succeed. A pointer repair is
the inverse: the reference is broken *because of* this run, and the change is not finished while
it still points at what the run moved. A gap the run merely *noticed* is still filed, never
fixed, at every ceiling — losing that distinction would turn the budget into a licence to make
small edits anywhere.

This is the ceiling's second authorized behavior and the first that is **not** trust-gated. An
unfiled repair generates no record, so it has no provenance class and can never appear in the
trust table; requiring a `clean` verdict would ship it permanently inert. Its safety comes from
being mechanically checkable and capped instead — `_shared/autonomy-ceiling.md` states this
explicitly so a later reader does not "fix" the asymmetry by adding a floor nothing could clear.

Ambiguity always stages: two plausible targets, or an old name that still legitimately exists,
means the repair is judged rather than checked, and the budget's premise does not hold. Test
files are excluded outright — retargeting an assertion at a renamed path is how "repair" becomes
"silence the check".

Also extracts `wrap-up` Steps 7.10 and 7.11 to `memory-curation.md` and `upstream-feedback.md`.
The new step pushed `SKILL.md` past the 40 KB per-invocation ceiling that
`bin/lib/skill-audit/tests/context-cost.test.js` enforces; two separate sub-files rather than
one shared bucket, since two stubs citing sections of a single file makes every stub pay for
the whole thing.

## v6.58.0 — /challenge becomes an inline framing gate instead of a brief producer

`/claude-tweaks:challenge` was a human-run stage that dispatched seven parallel proposers
plus an aggregator and saved a Brainstorming Brief to `docs/plans/*-brief.md`. It had
produced exactly one brief in the repo's history, and its nominal primary consumer
(`/superpowers:brainstorming`, a third-party skill) never read the file — its documented
deletion step had never fired either. The judgment was sound; the shape was wrong.

- `/claude-tweaks:challenge` is now two modes. `framing-check` is a component invoked only
  by `/claude-tweaks:specify`, rendering `FRAMING: open | solution-baked` plus a rationale.
  `--lens=<n[,n...]>` is a human-invoked escape hatch that applies one of the seven
  debiasing lenses in conversation. The seven lenses survive; only the machinery around
  them is gone. The file dropped from 19.3 KB to under 10 KB.
- A `solution-baked` verdict now stamps a presence-only `framing:baked` marker and folds
  the surfaced assumptions into the record's own `## Gotchas` — read by `/specify`,
  `/build`, and `/flow` by construction, rather than a separate file needing discovery.
  Absence is the clean state; there is no `framing:open`.
- The verdict surfaces as an informational `Framing` column in `/claude-tweaks:backlog
  refine`'s existing batch table and a flag in `/claude-tweaks:help`'s scan, which now
  reads the stamped verdict instead of guessing from record titles. **Net new user-facing
  prompts: zero.** Three flows lost an option; none gained one.
- Both drivers carry the verdict: a `framing:baked` label under `work-backend:
  github-issues`, a `framing` facet under `work-backend: local-files`, bridged through
  `sharedFacetDefaults()` and `parseRecordFacets` so the two shapes agree.
- Mode 4 (Layered MoA) is removed from `_shared/multi-agent-coordination.md` and
  `bin/lib/coordination.js` — `/challenge` was its only consumer. Three coordination modes
  remain. `docs/plans/2026-07-08-worktree-directory-convention-brief.md` is deliberately
  retained on disk; ADR 0004 cites it.

## v6.57.1 — auto-merged records get their acceptance label instead of closing silently

Both auto-merge short-circuits bypass `/claude-tweaks:wrap-up` Step 10, which is where
acceptance labeling lives — so a record that auto-merged closed with no `demo:pending`
and no Verification Brief. `_shared/work-record.md` says the opposite: an `auto:merge`'d
record still gets the label on its now-closed issue, to enable retrospective sign-off.
Nothing enforced it, and `#141` is the case that made it visible.

- `wrap-up/review-console.md`'s single-record fast-lane short-circuit and
  `dispatch/settle-and-merge.md`'s group Auto-merge gate now each run
  `verification-brief.md`'s procedure and apply `demo:pending` **before** merging. The
  merge carries the closing keyword, so after it lands the record is closed and the
  branch has moved on — order is the fix, not an implementation detail. On the group
  path it is one brief and one label per record: the merge decision is group-wide, but
  acceptance is per-record and members differ in testability.
- `--dry-run` covers the new writes. That branch's skip list named only `git merge` and
  `git push`, which would have let a live label write and brief comment escape preview
  mode — the same shape as the defect being fixed, in mirror image.

The defect survived because it sat between three separately-true completeness claims:
the console's "nothing this console would have shown is discarded" (about console
content), dispatch's "nothing wrap-up found is dropped" (about findings), and the
console's rule covering "every cleanup action that would otherwise run in Step 10"
(about cleanup items). Acceptance labeling is an action, not console content, not a
finding, and not a cleanup item — so every claim stayed true while the category none of
them covered was dropped on every auto-merge. Both claims now state what they do not
cover, so the next thing added to Step 10 has to be checked rather than assumed.

Found by measuring Phase 4's premises before planning it: 129 closed records across 10
provenance classes, zero acceptance verdicts, 0% coverage in every cell.

## v6.57.0 — the autonomy ceiling becomes real, and the trust verdict becomes safe to read

Phase 3 of the earned-autonomy design. Phase 2 shipped a per-class trust table that
nothing acted on; this release wires the `autonomy` policy lever to it, and hardens the
verdict first, because the shipped rule was not sound enough for a machine to read.

**The verdict now floors on verdicts, not records.** The old rule graded a cell on
`total >= MIN_SAMPLES` plus a *single* disposition. Measured against this repo, one
`demo:approved` on a 40-record class produced `verdict: clean` — fine for a table a human
reads beside the counts, a live grant once a governor reads it alone. A second floor,
`MIN_VERDICTS` (5), now counts the acceptance verdicts inside a cell rather than the
records. `notPlanned` also leaves the clean test: a record closed `NOT_PLANNED` was
declined, so no work product exists to judge, and with no time window in the table it was
pinning two of this repo's four real classes to `mixed` permanently. Both counts are still
rendered, and a new Coverage column says what fraction of a class was ever verified.

**`bin/lib/issues/autonomy.js`** resolves the ceiling (CLI arg > run config > project
policy > `supervised`) and maps `(ceiling, trust row)` to a permission set. Unrecognized
input always fails toward less autonomy: an unknown ceiling falls back to `supervised`, and
gradable kinds are an allowlist rather than a denylist naming `unstructured` — a denylist
granted to every kind it had not been taught, including a case-variant `PRODUCER`.

**`trusted` unlocks born-`ready` for `/claude-tweaks:capture`**, and only when
`producer:capture` carries a `clean` verdict. That skips `/claude-tweaks:specify`, never the
human grant gate — `ready` asserts shape, and `/claude-tweaks:backlog refine` re-derives
shape from the body before granting anyway. Human-filed classes are excluded by
construction: born-`ready` authorizes an *agent's* filing, and `human:human` is this repo's
largest provenance, so a governor that graded it would have fired there first on the weakest
possible justification.

**`unattended` is defined and shut.** Its machine-originated grant contradicts the standing
invariant that `auto:*` labels come only from an interactive human session — an invariant
written after a real run treated a low-risk `ready` record as license to run a full
build-to-close lifecycle. Reaching the top tier is not by itself an amendment of that, so
the grant path sits behind a second explicit opt-in that nothing sets.

`/claude-tweaks:backlog refine` gains an advisory `Trust` column beside its existing
recommendation, which it never drives — a class's history is not evidence about this
record's shape, and on a repo that has not run `/claude-tweaks:demo` every cell reads
`insufficient evidence`, which must not become a de facto freeze on granting.

Inert on arrival, deliberately: every trust cell in this repo still reads
`insufficient-evidence` with zero acceptance verdicts. The ceiling exists so that nothing
can exceed it later.

## v6.56.0 — the retired polish vocabulary leaves the files that restated it

The last leaf of the Impeccable upstream-contract program's Phase 3 (#148). #147 changed
how `/claude-tweaks:design-wrapper` dispatches during the polish phase; this release
makes the rest of the repo stop describing the old way.

"Auto-fit" and "issue-driven" were never internal names local to `command-map.md` —
they were this plugin's published vocabulary for the polish phase, restated in their
own words across `/flow`, `/ledger`, `_shared/auto-mode-contract.md`, `README.md` and
the user-facing docs. None of those files appeared in #147's diff, and a keyword grep
for the *new* vocabulary finds nothing wrong with any of them, because they never used
the new words. Their claims were true when written and went quietly stale (`[IL-93]`).

| Was | Is |
|---|---|
| Auto-fit (polish phase) | **Refinement set** |
| Issue-driven | **Suggestion-driven** — reads each `audit` finding's own `suggestion` field instead of keyword-matching four fixed categories |
| Intent-driven | unchanged |

**Two things the sweep found that the record specifying it did not know about.**

#147 shipped a fourth term the record's replacement table never listed: **Phase-fixed**,
covering the pre-spec (`/specify` shape) and review-phase (`/review` critique + audit)
rows that were also called auto-fit. Renaming only the polish row would have orphaned
the other two. The authority for a sweep like this is the landed diff, never the
specifying record.

`skills/flow/polish-execution.md` consumed only one of the two `staged_suggestions`
kinds. #147 added an `unclassified` kind for a finding carrying no usable `suggestion`,
and `modes/polish.md`'s output contract requires consumers to branch on `kind` — this
one did not, so an unclassified observation would reach `{run-dir}/staged/` labelled as
a manual-only *command* that no finding ever named. Fixed here rather than deferred,
because that wrong label is what a human reads at the Wrap-Up Review Console.

Also restated against signals that still exist: `/ledger`'s `design`-phase row keyed
`fixed` off "auto-fit successes", a category that no longer exists, and now keys `fixed`
off a `commands_invoked` entry and `observation` off a `staged_suggestions` entry.
`_shared/auto-mode-contract.md`'s polish row keeps its `AUTO` classification and now
names the staging path it previously left out.

Deliberately not swept: `CHANGELOG.md`, `docs/superpowers/**`, and one audit-trail
comment in `bin/lib/skill-audit/tests/anti-patterns.test.js` that records *what #147
retired*. Rewriting a historical note about a removal to use the post-removal names
would falsify it (`[IL-28]`). `docs/plugin-structure.md`, which the record listed as
needing a sweep, already carried the new vocabulary and needed no edit.

## v6.55.0 — the finishing review runs at code-review time, and third-party agents are exempt by structure

Two changes with one root, landed together because they pull on the same paragraphs
(#153, absorbing #124).

**`/claude-tweaks:review`'s design pass now dispatches `impeccable-finish-reviewer`** —
Impeccable's own shipped reviewer — whenever the changed artifact carries a direction
contract. v6.53.0 taught this repo to *find* that contract; it deliberately judges
nothing about it, because the block labels are upstream's and so are the criteria for
a good one. This release hands the found contract to the agent upstream wrote to audit
a render against it (`design-wrapper/modes/review.md` Step 3.7). No contract, no
dispatch — most reviews are not of design work.

Three things that were easy to get wrong, and are specified rather than left to
judgment:

- **Availability is checked at the agent level.** The existing precondition resolves
  `/impeccable:impeccable*`, a Skill-tool surface that proves the plugin is installed
  and says nothing about which agents it ships. Agents are added and removed between
  versions of one plugin, so the check resolves the agent's own definition file under
  the pinned plugin root. Absent, the pass degrades to the existing critique + audit
  path and never hard-fails.
- **The output is adapted at the boundary, not passed through.** Upstream returns four
  named sections (`persistence` / `ceiling` / `material_fixes` / `keep`); Step 4 maps
  them into this wrapper's existing finding shape under a new `source: "finish-review"`.
  Severities are assigned by the wrapper rather than invented from a fix's rank, and
  `keep` travels as a constraint on the other findings rather than being filed as one
  nobody should "resolve".
- **A dispatch that failed is not a review that passed.** With no status line to route
  on, unavailable / failed / empty / unparseable are kept apart, and none of them may
  report a clean design review. Only a parsed reply with no material fixes may say the
  render met its contract.

**Third-party agents are now explicitly exempt from the Subagent Contract**, on a
structural condition: the agent's definition lives outside this plugin's `agents/`
directory. Read as universal — which is how it read — that contract made the dispatch
above look non-compliant, and the next person to notice would have "fixed" it by
wrapping someone else's agent in a shim forcing it to speak our protocol, which means
paraphrasing its output into a shape it never promised. The exemption releases the
agent and binds the caller: normalize at the boundary, check agent-level availability,
and handle the outcomes the status line would have carried. A claude-tweaks-authored
agent is never exempt, however awkward its output is to parse.

**The contract's own rationale is reframed as dispatch correctness** (#124, absorbed
here). It read as a token-saving measure, down to an unmeasured "cuts output by 60-80%"
claim. Its load-bearing value is correctness: a clean room is what makes N agents
independent evidence rather than N echoes, the status line stops a failed dispatch
aggregating as a clean result, and the templates keep aggregation mechanical rather
than paraphrased. Cost is acknowledged as a side effect, never the justification. The
two changes had to land together — an exemption arguing "the contract buys dispatch
correctness" while the surrounding prose still called it a cost optimization would
leave the file arguing against itself. `tests/subagent-contract-clauses.test.js` fails
if either clause later goes missing from either file, because "read #124 before
editing" protects only the person who reads it.

## v6.54.0 — native surfaces stop being graded by a web-only detector

`/claude-tweaks:design-wrapper` accepted `Surface: web | mobile | desktop` and then
proceeded identically for all three. A record declaring `mobile` therefore ran the
bundled HTML rule engine over native app code. The likely outcome was zero findings
— reported as a pass, meaning nothing. A gate that cannot fail is not a gate, and
this was that defect on the surface axis rather than the CLI-contract axis where it
was last found.

Upstream states the constraint itself, in its own `reference/routing.md`: *"`live`
and the bundled `detect.mjs` are web-only."* This release acts on it.

**Track resolution** now sits between Layers 2 and 3 and runs for every mode.
`setup.platform` crossed with the record's `Surface:` line resolves to exactly one
of `web` / `ios` / `android` / `adaptive` — one decision, not an exemption bolted
after a web-path return. `test` and `live`, the two web-only surfaces, skip
explicitly on the native track; `test` returns `{skipped: "native surface — CLI
detector is web-only"}` and can no longer return `pass` there. Every other mode
dispatches with the platform named, having first read that platform's own upstream
reference (`ios.md`, `android.md`, or **both** for `adaptive` — there is no
`reference/adaptive.md`, so the obvious `reference/{platform}.md` template is wrong
for exactly the value this wrapper infers most often).

Three resolutions worth stating, because each is a judgment rather than a lookup:

- **`platform: null` + `Surface: mobile` infers `adaptive`.** `null` is the common
  case by construction — `extractPlatform` returns it for a missing `Platform`
  section, for prose, and for any unrecognized value — so a design whose only native
  trigger were a non-null platform would close the reported hole in the one case that
  already had an answer. Upstream has no unnamed-native track to route to, and a bare
  `mobile` names neither platform, which is the same statement upstream's own
  resolver collapses `ios, android` into `adaptive` for. Recorded as inferred, never
  as declared; the correction path is a `Platform` section in `PRODUCT.md`.
- **`desktop` takes the web path**, on the stated assumption that desktop surfaces
  here are HTML-based. Upstream's enum has no desktop value, so a genuinely native
  desktop surface takes the web path too — a known, accepted limitation, not an
  oversight.
- **A `setup.platform` / `Surface:` disagreement is recorded, not applied silently.**
  `setup.platform` wins, and `surface_track_override` names both values and which
  one did. A stale `PRODUCT.md` must not quietly overrule a record's own declaration.

Layer 3 keeps running on the web track unchanged, and on the native track whenever
no `Surface:` was declared — so a native project's backend-only diff still skips
rather than being widened onto the design path. It is skipped only when the record
declared a native surface, because its trigger table holds no native extension and
would return `non-frontend (sniff)` on exactly the records this routing exists to
serve.

Web-surface behavior is unchanged. The native track's detail — the reference
mapping, the reasoning behind the two inferred rows, and a four-row routing
walkthrough — lives in the new `design-wrapper/native-routing.md`, loaded only when
the track resolves native.

## v6.53.0 — Impeccable's direction contract reaches the human acceptance gate

`/claude-tweaks:demo` is the human sign-off gate, and until now it had nothing
design-specific to check against. It could describe what changed; it could not say
what the change was *trying* to be. That gap is structural, not an oversight — by
the time an artifact exists, the intent behind it is only inferable from the result,
which is circular.

Impeccable writes a **direction contract** into the opening comment of what it
builds, in five blocks, *before* the code. That is upstream's own statement of
intent, authored ahead of the work, which is exactly what an acceptance gate needs
and exactly what a reviewer cannot reconstruct afterward (#152).

**`/demo` Step 2 now renders those blocks** under `### The design contract this was
built against`, above the verdict question, framed as the promise the result is
being checked against rather than a description of what shipped. It re-parses the
shipped artifact rather than reading a copy captured at build time, so the human
sees the contract that is actually in the file they are signing off on.

**The seed key is recorded on the work record** as a `Design-seed:` body-metadata
line, because Impeccable 4.x is deliberately non-deterministic by dice and a build's
direction is unreproducible without it. `/claude-tweaks:design-wrapper`'s `review`
mode writes it — the one point in the pipeline where a built artifact and its record
are both in hand. The value is treated as an opaque token throughout: it defaults to
eight hex characters but is freely user-supplied via `--from`, so nothing validates,
normalizes, or pattern-matches it, and a `FORM` block naming a whole reproduction
recipe survives intact rather than being trimmed to a bare key.

`/specify` **declares** `Design-seed:` in `spec-template.md`'s body-metadata block
but never writes a value — it runs before code exists, so there is no contract to
read yet. Materialization lifts it like `Surface:`/`Design-intent:`, with one
difference now stated where a reader would otherwise go looking: on the very run
that *produces* a seed, materialization has already happened and correctly omits the
line. The field is never required, and a `ready` leaf without one stays valid.

claude-tweaks does not define, validate, reformat, or paraphrase the contract
anywhere — it finds the comment, splits on the five labels, and passes the text
through. Auditing the render against the contract remains `impeccable-finish-reviewer`'s
job upstream. The five block labels are the only upstream literal this repo
hard-codes, so they are pinned by three assertions in `tools/upstream-drift/manifest.yml`
(verified to fail when mutated, not merely to pass today) — a rename upstream surfaces
as drift instead of quietly producing an empty brief.

Three absence cases have three defined outcomes: no contract renders exactly as
before with no placeholder; a malformed one is treated as absent and logged, because
a half-rendered contract is worse than none; and a contract with no seed key renders
its blocks with the line omitted entirely rather than written empty — upstream carries
a seed only "when the seed dealt stagings," so that is normal and not drift.

Because both `/demo` and the wrapper need the same rules, the locate-and-parse
procedure lives once in `skills/_shared/design-contract.md` and both cite it.

## v6.52.0 — Impeccable's own doctor findings reach /tidy, surfaced and never applied

Impeccable ships a `doctor.mjs` that audits a project's own design record — `PRODUCT.md`,
`DESIGN.md` and its sidecar, `.impeccable/config.json`, surface briefs, the design hook.
Nothing in claude-tweaks had ever run it. `/claude-tweaks:tidy` now does, as Step 4.9,
through a new thin `doctor` mode on `/claude-tweaks:design-wrapper` that delegates
wholesale rather than reimplementing a single check. Run against this repo during
implementation it surfaced two real findings against `PRODUCT.md` — a retired
`## Register` section and a record predating the current schema — so the integration
shipped with a live case rather than a constructed fixture.

- `skills/design-wrapper/modes/doctor.md` **owns the finding schema** and is the single
  source of truth for it; `skills/tidy/scan-procedures.md` references that section rather
  than restating it. Two properties were read off Impeccable 4.0.2's own source rather
  than trusted from a summary, and neither is obvious: a finding's `path` is nullable and
  may be a *comma-joined list* of paths, and its `artifact` is a human label
  (`hook manifest`, `live state`, `surface brief`) that is not always a filename. Both
  decide what the report's `Path:Line` column can render, so the mapping falls back to
  `artifact` rather than emitting an empty cell.
- `skills/design-wrapper/impeccable-plugin.md` grows the shared
  `resolveImpeccablePlugin({searchRoot}) -> {root, version} | null`, with a per-consumer
  script-path table underneath it. Layer 0 and `doctor` need the same answer — which
  plugin root sits at the pin — so it is specified once and each consumer appends its own
  script path, rather than shipping two resolvers for one root (`[IL-32]`). The pin is
  load-bearing for both: neither `context-signals.mjs` nor `doctor.mjs` exists at 3.0.6,
  the other version cached alongside 4.0.2.
- `--fix` is never passed, and the file says why in one sentence so a later reader does
  not add it as an obvious convenience: it rewrites `PRODUCT.md`, and
  `_shared/auto-mode-contract.md` reserves file-modifying decisions for explicit human
  approval. That upstream calls `auto` migrations "the ones with no judgment in them"
  answers a different question than whether *this* wrapper may apply them unattended.
- Upstream's `route` / `mention` / `auto` severities are carried through verbatim — the
  `--fix` boundary is defined in terms of those exact strings. `/tidy` maps them onto its
  own urgency scale for display only and keeps the original word inside the rendered row.
- `[doctor]` rows route to their own Design Record Drift section, deliberately **not**
  `/tidy`'s Actions table: every Action Vocabulary row mutates something and these never
  do, at any aggressiveness tier. On a skip — no plugin, off-pin, no `PRODUCT.md`, or
  `doctor.mjs` failing outright — the scan step renders nothing at all, since a step that
  reports its own absence on every run trains users to skim the report.
- `doctor` runs the wrapper's Layer 1 kill-switch only. Layers 2 and 3 are structurally
  inapplicable: there is no spec to read a `Surface:` line from and no file list to sniff,
  and a diff-based sniff would skip `doctor` on exactly the clean-tree runs `/tidy`
  performs.

Closes #150.

## v6.51.1 — wontfix suppression survives a gh-absent firing, and the build diagnostic says how it resolved

Two defects found by test-firing six live cloud Routines against a real project on
2026-08-07 and reading the transcripts.

**`wontfix` suppression silently lapsed whenever `gh` was absent (#163).**
`harness-health`, `journey-health` and `docs-health` all instructed the run to *skip*
the dedup issue-index fetch and set `ISSUES_FILE=""` when `gh` was unavailable — which
directly contradicted `_shared/github-write-transport.md`, whose detection is "a
capability probe, not an environment classification." With no issue index, a finding
whose matching issue carried `wontfix` was re-filed as brand new. That fails hardest in
the unattended cloud Routine firing where `gh` is reliably absent, and these findings are
born `ready`, so a re-filed false positive is reachable by an unattended implementer.
Observed live: of four firings that all reported `gh` missing, three improvised the MCP
tools and deduped correctly while `journey-health` followed the documented skip path — so
whether a standing suppression held depended on whether the agent improvised a transport
the skill never mentioned.

Fixed on both axes, because they cover different failures:

- **Transport.** The skip instruction is replaced across all four health sweeps by the
  MCP `list_issues` fallback the shared transport doc already mandated. The canonical
  procedure now lives once in `_shared/health-issue-index.md` rather than in four
  divergent inline copies — four copies where only one had a fallback is what produced
  this bug. It also separates the two cases the old wording conflated: a repo with no
  `by:*` issues yet has a legitimately *empty* index, which is not the same as an
  *unavailable* one, and only the latter is a degraded run that must say so.
- **Durability.** A firing that *can* read the index now hands its readings forward: any
  finding suppressed by a `wontfix` label is persisted to the durable `declined` slice on
  the `health-state` branch, which survives a Routine's fresh container. `decide()` tags
  the two suppress outcomes with an explicit `reason` so callers gate on provenance rather
  than inferring it from an issue number being present.

Note on the premise: `code-health` was excluded from #163 because it persists
`status: 'wontfix'` to its local cache. That holds for repeat *local* runs only — its own
`cache.js` documents that the local cache does not survive a Routine container recycle, so
in the headless case its cache is empty on every firing. It gets the MCP transport fix
here; the durable slice it still lacks is tracked separately.

**The plugin-build diagnostic couldn't report what it was for (#164).** Every
`routine-template.yml` told the agent to read `${CLAUDE_PLUGIN_ROOT}`, which is unset in
the cloud Routine sandbox — confirmed in all four observed firings, each of which
improvised a different fallback. The diagnostic exists precisely to distinguish "sandbox
pinned to a stale build" from "real bug in the current build" (it is what revealed a
sandbox running v6.23.6 against a v6.50.0 install), so leaving its resolution to
improvisation defeated it. All six templates now carry an ordered resolution ladder — env
var, then the SessionStart hook's harness-resolved path, then a plugin-cache glob — and
the emitted line must name which rung produced the answer, so a hook-derived version is
visibly stronger evidence than a directory guess. The hook path is deliberately *not* the
primary fallback: it is only logged when unfinished pipeline runs exist, so the four runs
that used it did so by coincidence of that project's state.

`template_version` bumped on all six templates. A live Routine holds a frozen copy of the
prompt it was created from, so **existing routines keep running the old text until they are
re-provisioned** with `/claude-tweaks:routine update <skill>`; drift detection
(`routine/status.md` Step 3) keys off that integer and would otherwise report nothing.

## v6.51.0 — A trust table that measures acceptance evidence and acts on nothing

v6.50.0 gave closed records an acceptance disposition. Nothing yet asked what that
evidence adds up to per class of work — so `/claude-tweaks:help` and
`/claude-tweaks:backlog overview` now render a supervised trust table: closed records
grouped by `(provenance × risk band)` and tallied against their `demo:*` labels. Run
against this repo today: 118 closed records across 10 cells, zero approved, zero
changes-requested, every cell `insufficient-evidence`. The plugin had no acceptance
evidence at all, and now it says so measurably instead of silently.

- `bin/lib/issues/provenance.js` resolves a record's origin to one of four kinds —
  `producer` (a `by:*`-labelled health-sweep filing), `side-effect` (an unlabelled
  `Origin:` body line from another skill's flow), `unstructured` (an Origin line too
  long to classify reliably, or one that normalizes to empty — the latter was added
  in the fix wave to stop such records from falsely merging into `human`), or `human`
  (neither signal — absence is the signal).
- `bin/lib/issues/trust.js` groups closed records into `(provenance × risk band)`
  cells and assigns each a verdict — `unstructured` cells are pinned to
  `insufficient-evidence` at every sample count, since a bucket defined by "could not
  be classified" has no coherent class to earn trust for; every other cell reads
  `insufficient-evidence` below an 8-sample floor and `clean` or `mixed` above it.
  Undispositioned is never hidden or folded into another column: it is the count of
  how blind the system currently is, and today it is every cell's largest number.
- `skills/_shared/trust-table.md` is the one fetch/render procedure both consuming
  skills inline rather than duplicate — `/help` Stage 4.8 (subagents cannot read the
  file directly, so its Fetch/Render sections are inlined into the dispatch prompt)
  and `/backlog overview` Step 1.5 (rendered inline, no subagent). When every cell
  reads `insufficient-evidence`, the table collapses to one summary line instead of
  ten identical rows.
- The `autonomy` policy lever gains its default value, `supervised`, alongside the
  `trusted`/`unattended` ceiling values declared in
  `docs/superpowers/specs/2026-08-07-earned-autonomy-tier-design.md`. It is a ceiling
  on autonomous action, not a level — the trust table moves the level, this lever only
  ever caps it.

Nothing in this release acts on a verdict. `trusted` and `unattended` exist so the
ceiling is in place before anything can exceed it, but no consumer reads either value
yet, and the table itself never grants a label, changes one, merges anything, or
attaches a recommendation to what it renders. That wiring is Phase 3.

## v6.50.2 — the same fixes as v6.51.1, under the number they first shipped as

Backfilled by the v6.53.0 release, which the coverage gate blocked until this
entry existed. Not a separate body of work: commit `a373a178` bumped the manifest
to 6.50.2 and reached `main` carrying the #163 and #164 fixes, then merged with
the concurrently-landed 6.51.0 and re-emerged as 6.51.1. Only 6.51.1 got an entry,
so the number the tip actually held in between had none.

For what it contains, read **v6.51.1** above — the two are the same change set.
This entry exists because a version that reached the tip of `main` is a build
someone could be running, whether or not a later merge renumbered it, and the
gate deliberately cannot tell "renumbered" from "forgotten" (`[IL-94]`). It sits
here rather than beside 6.51.1 because this file is ordered by version, and 6.50.2
is the one recent release whose version order and ship order disagree — it reached
the tip at 16:40, after 6.51.0 did at 15:21.

## v6.50.1 — Skill frontmatter stops double-prefixing the plugin namespace

Every `SKILL.md` carried the plugin name inside its own `name:` field
(`name: claude-tweaks:wrap-up`). The harness prepends the plugin namespace on top
of whatever `name:` holds, so all 33 skills rendered in the command list as
`/claude-tweaks:claude-tweaks:wrap-up`.

The prefix arrived in `e9d5cb4a` ("Prefix all skill names and cross-references with
claude-tweaks:"), a sweep that was right about **cross-references in prose** —
`/review` → `/claude-tweaks:review`, still required — and over-reached into the
frontmatter, where the namespacing is the harness's job. Skills originally shipped
bare, as `name: wrap-up`. `04a63c4f` later codified the accident as a CLAUDE.md
convention, which is what held it in place across 33 skills and five test assertions.

`name:` is now the bare skill name everywhere. Nothing else moves: the resolved name
stays `claude-tweaks:{skill}` — the same shape `superpowers:brainstorming` resolves
through, from `name: brainstorming` — so every `/claude-tweaks:{skill}` reference in
skill bodies remains correct and is untouched. This repo's own `agents/qa-agent.md`
was already bare and had always rendered correctly; that within-plugin contrast is
what identified the cause.

The four health-sweep `skill-md` tests asserted the prefixed name through an
unanchored `/name:\s*claude-tweaks:{skill}/`. They now assert `/^name: {skill}$/m`,
which actually fails on the doubled form.

### also carried in this build

Three records from the Impeccable upstream-contract program landed while `main`'s tip
still read 6.50.1, each without a bump of its own. Backfilled during #148's wrap-up.

**#146 — `/claude-tweaks:design-wrapper` gained a plugin contract seam.** Mirroring the
CLI seam Phase 1 built: resolve the installed Impeccable **plugin**, compare it to a
recorded pin, execute `context-signals.mjs`, and consume its signals as an enrichment
layer beneath the existing detection layers. New `skills/design-wrapper/impeccable-plugin.md`
carries the pin comment, the resolution procedure, the executed output shape and the
per-signal trust rules; `tests/impeccable-plugin-contract.test.js` probes it with the
same skip/fail asymmetry as the CLI test — skips when absent, **fails** at a version
other than the pin, because a probe that silently declines to run reads exactly like
one that passed. Layer 3 survives unchanged as the frontend predicate: nothing upstream
computes one, so the enrichment sits beneath it rather than replacing it.

**#147 — the auto-fit and issue-driven dispatch tables were retired.** Two tables in
`command-map.md` re-derived by keyword what Impeccable's `audit` already states. They
are replaced by the suggestion-driven model the file's own Anti-Pattern section already
precedented: every finding carries a `suggestion` field naming its own remediation, and
the wrapper dispatches what the finding names rather than matching four fixed category
keywords — keywords that never matched upstream's documented Category enum anyway. A
finding whose `suggestion` names a manual-only command is staged, not run; a finding
with no usable `suggestion` is staged as an unclassified observation carrying its
id/category/description, never keyword-mapped and never dropped. The published
vocabulary this renamed is swept out of the rest of the repo in v6.56.0 (#148).

**#143 — the upstream-drift auditor became runnable.** `tools/upstream-drift/run.js`
reads the manifest, runs the deterministic checks, hands their output plus the
contract-path diff to the judge, and files deduplicated `by:upstream-drift` issues. Its
trigger model is where this auditor departs from the four shipped health sweeps: those
rotate through targets on a cursor because there is always more repo to audit, whereas
here there is nothing to look at until a version changes and everything to look at the
moment one does.

## v6.50.0 — Closed records reach an explicit acceptance disposition

Work records were closing with no acceptance verdict at all, and nothing noticed.
`demo:pending` had been applied 11 times ever — all closed still carrying it, none
since 2026-07-23 — while `demo:approved` and `demo:changes-requested` did not exist
in the repository, because `/claude-tweaks:demo` had never once run to resolution.
Zero of ten sampled recently-closed records carried a Verification Brief.

The cause is structural, not neglect. `/claude-tweaks:wrap-up`'s acceptance labeling
is gated on record mode, but most work here is fixed ad hoc in a session and closed
by a `Fixes #N` commit, which never materializes a run header — so the step never
fires. The heavy pipeline is instrumented; the lane that carries most of the work
is not.

- `bin/lib/issues/acceptance.js` is the single classifier for acceptance state and
  verification surface — `dispositionState`, `verificationSurface`, `needsBackstop`.
  `wrap-up/verification-brief.md`'s inline path-pattern list is retired in favor of
  calling it, so the classification exists in one place.
- `/claude-tweaks:tidy` Step 4.8 gains an `acceptance-gap` scope
  (`_shared/github-pr-scan.md`) that finds closed records carrying no `demo:*` label.
  Findings are `info` and always staged, never auto-applied: whether shipped work
  solved its problem is a judgment `auto` does not silence.
- `/claude-tweaks:demo` can now act on those findings. Given `#N` with no
  `demo:pending`, it recovers the record's closing commit from git history and
  composes a Verification Brief from the commit message and its changed paths,
  falling back to session-recall only when no closing commit exists. The brief is
  labeled a reconstruction and never claims verification nobody performed.
- Records with no interactive UI surface — nearly all of this repository — get
  manual verification steps instead of silently losing their verification path,
  on both the record-backed and session-recall entry points (closes #135).

The classifier deliberately does not try to detect "backend code with no route or
component touched." Any path prefix broad enough to catch `src/services/payments.ts`
also catches `src/components/Button.tsx`, and the errors are asymmetric: a missed
match costs a wasted browser walk, while a wrong match silently skips acceptance —
the exact failure this release exists to close.

### also carried in this build

**#142 — the upstream-drift capability-triage skill.** Landed while `main`'s tip still
read 6.50.0, without a bump of its own. Backfilled during #148's wrap-up.

A project-local skill (`.claude/skills/upstream-drift/`) that reads the deterministic
checks' output, then diffs an upstream dependency's contract paths between the installed
and latest tags to triage **new capability** — upstream surface this repo could use but
does not know exists. This half is what the deterministic checks structurally cannot do:
every assertion tests a claim someone already wrote down, and new capability has nothing
to assert against. In the audit that motivated the design, source diffing found the
contract drift, while only a human-style read of the upstream file tree found
`context-signals.mjs`, `doctor`, and an entire iOS/Android track — none of which any
assertion could have surfaced. The skill never edits anything, including the
dependencies themselves.

## v6.49.0 — One classifier decides where a learning goes

Learnings had five possible destinations, three writers, and nothing deciding
between them. Two of the five — a memory file, and the plugin's own issue
tracker — had no writer at all, so any lesson that outlived the current project
either landed in whichever store the producing skill happened to name, or
nowhere.

`skills/_shared/learning-routing.md` is now the single source of truth: an
ordered, first-match-wins classifier over D1 (CLAUDE.md Don'ts), D2 (project
skills and docs), D3 (work records), D4 (memory) and D5 (upstream). Producers —
`/claude-tweaks:reflect`, `/claude-tweaks:review`, `/claude-tweaks:build`, and
the four health sweeps — cite it instead of carrying their own destination
tables, which retires `reflect`'s row routing "a fundamentally better approach
exists" to both a skill update and a memory file, the mechanism that put the
same lesson in two stores in different words.

`/claude-tweaks:feedback` is the new D5 writer, filing defect and gap reports
against the plugin itself with an unconditional scrub gate and an explicit
confirmation in every mode, including `--dry-run`. `/claude-tweaks:wrap-up`
Steps 7.10 and 7.11 stage memory and upstream proposals to two new per-item
Review Console sections; `auto` silences neither.

Three gaps that work left behind are closed here rather than in a follow-up
release, since none of it ever shipped separately. Interactive-mode wrap-up now
has a Queue writes surface (#156): the ledger resolve gate stages a record
proposal whenever a run directory exists, but routed it to a Review Console that
only runs in `auto`/`hybrid`, so in interactive mode the proposal had no reader.
The evals harness gains a `git-remote` fixture-seed step (#157), without which
the self-reference scenario could not present its own precondition, and a matrix
construct (#158), without which four of seven frozen corpus lessons were
exercised by nothing — a fixture that reads as coverage while measuring nothing.

## v6.48.1 — /init stops writing work-links to the file nothing reads

v6.48.0 moved every `work-links` **reader** to `.claude-tweaks/policy.yml` and left the
**writer** behind. `/claude-tweaks:init` bootstrap Step 17b probes the org's Issue
capabilities and wrote both `work-types` and `work-links` "beside the flag" in CLAUDE.md —
so on a newly bootstrapped project in an org with sub-issues and dependencies enabled, the
probe returned `native`, recorded it where nothing looks, and every consumer fell back to
`body-text`. Parent links landed as body-text task lists instead of sub-issue relationships,
with nothing objecting. The next `/claude-tweaks:init --update` would then flag the key
`/init` had just written as Config Home Drift: the skill fighting its own output on every
cycle.

Found by the whole-branch review, which is the only pass that could have found it — the
writer and the readers are in different files, and each task's own diff was self-consistent.
The scope list that kept Step 17b out of the migration excluded it for naming `work-backend`;
nobody noticed the same file writes `work-links` fifty lines further down.

- Step 17b now splits the write: `work-types` to CLAUDE.md, `work-links` to
  `.claude-tweaks/policy.yml`, with the failure mode stated inline so the next editor sees why.
- `_shared/auto-mode-contract.md`'s **skill-integration template** — the block skills are told
  to copy when implementing an auto branch — still read project policy from CLAUDE.md. Its
  descriptive twin three sections up was fixed in 6.48.0; the prescriptive copy, the one that
  actually gets copied, was not.
- The auto-FORBIDDEN list now names `policy.yml`'s keys, not just CLAUDE.md's. The old wording
  stayed literally true while its subject moved out from under it, so nothing contradicted it.
- Update Mode's Work-Record Backend Drift row looked for `work-links` in CLAUDE.md, which
  after 6.48.0 fires on every correctly-configured project, forever.
- The Config Home Drift "promote the CLAUDE.md value" remedy appended to `policy.yml` even
  when the key was already present. Consumers read `| head -1`, so the append was inert and the
  old value silently kept winning — a no-op the user had no way to notice. It now replaces
  in place.
- Root `CLAUDE.md` still said project policy lives "in CLAUDE.md or `.claude-tweaks/policy.yml`".

## v6.48.0 — policy.yml is the single home for project config

`.claude-tweaks/policy.yml` is now the only file claude-tweaks reads for config keys.
Before this, eight levers were readable from either CLAUDE.md or `policy.yml`, four more
were documented as CLAUDE.md-only, and one — `merge-sensitive-paths` — was documented as
`policy.yml`-only while the skill that reads it grepped CLAUDE.md anyway.

- Every lever in `_shared/policy-schema.md` resolves from `.claude-tweaks/policy.yml`. The
  five remaining dual-read greps now name one file, and pick up the inline-comment strip the
  rest of the codebase already used — a value like `5  # raised for the migration` no longer
  carries its comment into the command it is interpolated into.
- `depth-survey`, `creative-survey`, `backlog-fetch-limit`, and `promise-register-min-leaves`
  gain the `policy.yml` path they never had. Defaults are unchanged.
- `auditPolicy()` stops validating CLAUDE.md values and starts reporting recognized keys found
  there under a new `migratableKeys` field. A value in a file nobody reads cannot be wrong,
  only misplaced — so the remedy is to move the key, not correct the value.
- `/claude-tweaks:init --update` gains a **Config Home Drift** check that shows a diff and
  offers to move those keys, removing only exactly-matched lines. It is a staged offer, never
  an autonomous edit: CLAUDE.md is the file users hand-tune most, and `parseFlatLines`
  deliberately matches key-shaped lines inside fenced blocks, so a CLAUDE.md that *documents*
  these levers can produce rows that must not be applied.
- `/claude-tweaks:harness-health`'s policy check reports migrations alongside unrecognized
  keys and invalid values.

**If your project sets levers in CLAUDE.md, run `/claude-tweaks:init --update`.** Those keys
stop applying in this release; the check finds them and offers the move. The work-record keys
`work-backend`, `work-types`, and `record-staleness-weeks` are unaffected and stay in
CLAUDE.md — `_shared/work-record-config.md` states why, and they are absent from `POLICY_KEYS`
so the migration never touches them.

## v6.47.0 — Run bookkeeping stops writing to other sessions' runs (closes #62)

When `PIPELINE_RUN_DIR` was absent, hooks resolved "the newest non-terminal run under cwd."
That is correct while exactly one pipeline run is in flight, and this project runs several
concurrently as standard practice. Reported from a downstream project: run directories whose
`events.jsonl` had accumulated commits from three unrelated worktrees, and runs whose issues
were closed hours earlier still stamped `status: "interrupted"` days later, so the
session-start hook kept warning about finished work.

The stuck status was self-perpetuating, which is why it never cleared. `session-end` resolved
a run it did not own, saw a non-`clean` status, and wrote `interrupted` — and that write is
what makes a run non-terminal, so it kept winning the same fallback for every session that
followed. Nothing in the loop degrades.

The fix is not a better heuristic. The distinction that mattered is between **reading** a run
and **writing** to one:

- **Enforcement still reads the newest non-terminal run regardless of owner.** E1's
  working-directory gate has to resolve runs it does not own — its foreign-session branch
  exists to warn a bystander that the checkout belongs to someone else's worktree. Scoping
  resolution to the caller broke that gate the first time it was tried, and the suite caught it.
- **Everything that writes uses the new ownership-scoped `ctx.ownedRun`.** A run owned by
  another session is never written to. An unowned run still is — ownership is stamped only by
  `record-worktree`, so a run that never provisioned a worktree may well be ours — but the
  event carries `attribution: "fallback"` so a contaminated log stays filterable, and the
  sticky `interrupted`/`lastEvent` stamps are withheld.
- `context.js` exports `resolveRun(cwd, env, sessionId)` returning `{dir, attribution}` —
  `env` / `session` / `fallback`. `resolveRunDir` keeps its signature; called without a session
  id (as `record-worktree` and `close-run` do, deliberately resolving runs they don't own so
  they can report that) it behaves exactly as before.

13 tests, each verified by reverting the resolver. Recorded as `[IL-96]`: before letting a
fallback path write, check whether the write is one of that path's own future inputs — if it
is, the failure mode is not a wrong value but a latch.

## v6.45.1 — /code-health sees the files again when run from a worktree (closes #111)

`bin/lib/code-health/scope.js`'s `sourceFiles()` excluded `SKIP_DIRS` by passing `find` a
`-not -path "*/<dir>/*"` argument per entry, against an **absolute** start point. `find`'s
`-path` matches the whole path string, so the scanned root's own ancestors sat in front of
every candidate — and a checkout living under any segment named in `SKIP_DIRS` excluded
itself entirely.

A linked worktree lives at `<repo>/.claude/worktrees/<name>`, and `.claude` is in the list.
Every sweep run from one found **zero source files while still emitting every slice**: it
judged nothing, filed nothing, and reported success. Measured on the same commit and repo,
35 slices / 208+ files / 1.5 MB from the main checkout became 11 slices / 0 files / 0 bytes
from a worktree.

The scan now runs with `cwd` set to the slice root and a `.` start point, so paths are
relative and cannot name an ancestor. The exclusions keep the meaning their comment always
claimed — a skip-directory is excluded wherever it appears *inside* the tree.

- `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo` carry the identical shape,
  so any repo cloned under e.g. `~/build/` was equally invisible. All are covered.
- Sibling engines are unaffected and were checked rather than assumed: this is the only
  `find` invocation in `bin/lib/`, and `docs-health`/`harness-health` match directory names
  through `readdirSync` entries, which are relative by construction.
- 10 regression tests across four ancestor shapes, each verified by reverting the anchoring
  and confirming it fails. `sourceFiles` is exported for them — asserting on slice ids alone
  cannot tell "found the files" from "emitted an empty slice".

## v6.46.0 — One classifier decides where a learning goes

Learnings had five possible destinations, three writers, and nothing deciding
between them. Two of the five — a memory file, and the plugin's own issue
tracker — had no writer at all, so any lesson that outlived the current project
either landed in whichever store the producing skill happened to name, or
nowhere.

`skills/_shared/learning-routing.md` is now the single source of truth: an
ordered, first-match-wins classifier over D1 (CLAUDE.md Don'ts), D2 (project
skills and docs), D3 (work records), D4 (memory) and D5 (upstream). Producers —
`/claude-tweaks:reflect`, `/claude-tweaks:review`, `/claude-tweaks:build`, and
the four health sweeps — cite it instead of carrying their own destination
tables, which retires `reflect`'s row routing "a fundamentally better approach
exists" to both a skill update and a memory file, the mechanism that put the
same lesson in two stores in different words.

`/claude-tweaks:feedback` is the new D5 writer, filing defect and gap reports
against the plugin itself with an unconditional scrub gate and an explicit
confirmation in every mode, including `--dry-run`. `/claude-tweaks:wrap-up`
Steps 7.10 and 7.11 stage memory and upstream proposals to two new per-item
Review Console sections; `auto` silences neither.

> Restored in 6.50.1. This entry and its `docs/shipped-versions.tsv` row shipped
> in `707c89c2` and were both lost in a later merge — `main` carried 6.46.0 at its
> tip across two commits with no record of it, which is the gap
> `tests/changelog-coverage.test.js` went red on. The text above is `707c89c2`'s
> verbatim.

## v6.45.0 — Which versions shipped is recorded, not reconstructed (closes #144)

`tests/changelog-coverage.test.js` reconstructed the shipped set by walking
`git rev-list --first-parent origin/main`. One day after it shipped, `main` was red on it,
reporting that six entries — including v6.41.0, the release that added the gate — named
versions that never shipped.

The walk is not lossy. It is **unstable**. A merge's first parent is the branch you were on,
so when a feature branch merges `main` into itself and is then pushed as `main`, everything
`main` carried since the fork point moves to the second parent, where the walk never looks.
Asked from three refs that had each genuinely been `main`'s tip, the same function on the same
repository gave three non-nested answers: 6.40.0 and 6.41.0 shipped per `65531d88` and absent
from the tip, 6.39.0 the reverse. Versions *leave* the set as later merges land.

- **`docs/shipped-versions.tsv`** now records the answer directly — appended in the same commit
  as each version bump, alongside the CHANGELOG entry. `shippedVersions()` reads it and unions
  the walk in as a supplement, so a release that forgets the append is still caught, and an
  inverted merge no longer subtracts anything.
- **Backfilled from two independent sources**: the union of first-parent walks from three known
  historical tips, plus the marketplace repo's per-commit `plugins[0].version` — a separate
  repository, one commit per release, written at ship time. The mirror alone accounts for 11
  versions no walk from any vantage point can see.
- **13 `### … branch-numbered vX.Y.Z` subsections promoted back to `##` headings.** All 13
  shipped, and all 13 have marketplace mirror commits proving it. Six were demoted the previous
  day to make the red gate pass; the other seven were mislabelled by v6.41.0's own backfill.
  Three entries — v6.3.0, v6.5.0, v6.25.0 — are genuinely branch-numbered and keep the form.
- **Four releases that had no entry at all** (v6.1.0, v6.14.0, v6.14.1, v6.23.3) written up.
- **The release-follow-up hook now checks instead of reminding.** It reads the commit's own
  CHANGELOG and record blobs and names only what is actually outstanding, rather than restating
  three steps every time — the shape `[IL-94]` records as the one that gets skimmed.
- **`tests/shipped-record.test.js`** builds the inverting topology as a fixture (branch merges
  main into itself, renumbers past it, becomes main). The suite had no case where a first-parent
  chain leaves the branch it started on, which is why this shipped undetected.

Recorded as `[IL-95]`, which also supersedes the closing paragraph of `[IL-94]` — it asserts
the soundness of exactly the walk this removes.

## v6.44.0 — The Impeccable design gate can fail again

`/claude-tweaks:test`'s Impeccable gate had been unable to fail. The installed CLI was
2.1.8, which writes findings JSON to **stderr** and leaves stdout empty, while
`skills/design-wrapper/impeccable-cli.md` documented stdout and treated an empty one as
malformed output. Every real finding therefore fell through to a skip, and skips are not
failures. The gate returned `pass` on a clean file and `skipped` on a dirty one; the `fail`
branch was unreachable.

The document claimed verification against CLI **3.2.1** — a version the machine had never
run. Two deliberate re-verification passes both missed it, because nothing ever compared
the claim to what was installed (`[IL-89]`). Both the pin and the contract are now
machine-checked: `tests/impeccable-cli-contract.test.js` replays committed fixtures against
the installed binary, with stdout and stderr captured separately, and fails when the CLI is
present at the wrong version rather than skipping. The wrapper's own availability check does
the same comparison, which is the only pin enforcement a consumer of the published plugin
ever gets.

The gate also read the wrong field. It classified on `severity`, but upstream's blocking
decision rides on a separate `advisory` boolean stamped on each finding, and the two are
near-inverted: a finding can carry `severity: "warning"` with `advisory: true` (upstream
exits 0, non-blocking) or `severity: "advisory"` with no flag (upstream exits 2, blocking).
Classifying on `severity` was wrong for 12 of the 59 registry rules in both directions —
design-token violations on a project with a `DESIGN.md` would have been waved through, while
em-dash overuse, upstream's own worked example of something safe to ignore, would have
failed the build. Three independent verifications agreed the advisory path was impossible to
reproduce before a fourth found the fixture is three lines of HTML (`[IL-90]`).

Alongside: `--fast` is dropped from the invocation (deprecated and ignored at the pin, and it
writes a deprecation note into a stream the parser reads), the `category` field is documented,
the enumerated advisory rule-id list is deleted rather than corrected — enumerating upstream's
data is what drifted the file three times — and three files that restated the invocation now
point at the one that owns it.
## v6.43.0 — `sed -i` no longer walks past the worktree gate (closes #70)

The gate never saw `sed -i` at all. `hooks/hooks.json`'s PreToolUse `Bash` matcher
fired the hook on nine `if:` predicates — six git forms plus `cp`, `mv`, `tee` — and
`sed -i 's/x/y/' /abs/path/in/main-checkout/file.js` matched none of them, so the hook
process never spawned. `fileWriteTargets` was never reached. Anyone starting from the
module would have found nothing wrong with it.

The result was a silent write to the un-isolated main checkout while the agent believed
it was working inside its worktree: no deny, no warning, no `events.jsonl` entry.

**Now covered:** `sed -i` / `perl -i` (in-place forms only, including GNU's attached
suffix `-i.bak`, BSD's separate `-i ''`, and bundled short flags like `-pi`/`-ni`),
plus `install`, `ln`, `truncate`, and `dd of=`. A read-only `sed -n '…p' file` is not a
write and stays allowed in the main checkout — that distinction is what keeps ordinary
inspection working, and it has its own test.

**Still not covered, now with numbers instead of an assertion.** Bare shell redirection
(`>`, `>>`) has no command word for an if-matcher to key on, so catching it needs an
unconditional `Bash` matcher that spawns the hook on every Bash call: measured at
**42.0 ms idle, 67.9 ms under three concurrent test suites**. Declined on that cost.
`python -c` / `sh -c` / `awk` program strings are not statically analyzable at any cost.
Both are recorded in `_shared/policy-schema.md`'s coverage block so the next reader
inherits a measurement rather than a claim.

**The cost this does pay:** an if-matcher keys on a command name, not its flags, so
`Bash(sed *)` spawns the hook for every `sed` — read-only ones included. Breadth beat
precision deliberately: `Bash(sed -i*)` would miss `sed -ni`, `sed --in-place`, and
`perl -pi -e`, reintroducing the exact silent-gap class being closed. A false negative
here is invisible; 42 ms is not.

New guard: `tests/hooks-gate-coverage.test.js` now asserts every `WRITE_SHAPES` entry has
a matching `hooks.json` predicate. A parser branch without one is dead code that reads
exactly like a fix — that asymmetry is what hid this bug. The deny message is also built
from `GATE_COVERAGE` now rather than spelling the list out, so it cannot describe an old
reach. 10 new tests, each verified by mutation.

## v6.42.0 — Routines and merges follow the branch you name, not the GitHub default (closes #132)

Four places independently resolved "which branch is this project's current state" — which tree a
routine audits, where a task forks from, where finished work merges, and what a change's blast
radius is measured against. All four asked GitHub for its default branch. On a `dev` → `staging` →
`main` model that is the one branch nobody develops on: on the reporting repo it was 102 commits
behind the active branch **and 51 ahead of it**, divergent rather than merely stale, because urgent
fixes are cherry-picked straight onto it.

They failed differently, and the worst one had never been reported. Auto-merge aborted, which is
visible. But `merge-check` sizes a record's change by diffing against the merge base with the
default branch — and against a branch that diverged long ago, that base is ancient, so the diff
spans every commit since the fork. Blast radius came back enormous, the verdict was `needs-human`,
and the stated reason was "too many files changed." Auto-merge could never fire on such a repo, and
the log looked like the gate working correctly.

One `integration-branch` key in `.claude-tweaks/policy.yml` now answers all four, resolved through
`skills/_shared/integration-branch.md`: an explicit argument, then the key, then a branching model
documented in CLAUDE.md prose, then git — where a current branch differing from the GitHub default
is surfaced rather than silently picked, and a linked worktree's throwaway branch is never proposed
at all. Unset reproduces the old behavior per consumer, so a project that sets nothing sees no
change. A conformance test now fails on any new site that resolves the default branch without
citing the fragment — the check that would have caught this originally.

`/claude-tweaks:init` now treats `worktree.baseRef: head` as required, not merely recommended,
whenever `integration-branch` is set and differs from the repo's GitHub default: under `fresh`,
every worktree would otherwise fork from the wrong branch by construction. The plugin cannot set
that value itself — it lives in the harness's `settings.json` — so init states the requirement
explicitly and asks.

Naming the branch was only half of it: the routine preamble previously told a container that
started on the wrong branch to fast-forward, never to switch. It now says to check the target
branch out.

Existing live routines hold a frozen copy of their creation-time prompt and do not pick this up on
their own. Every `template_version` is bumped, so `/claude-tweaks:routine status --all` reports
them as Drifted and `update <skill>` rewrites the live prompt in place;
`_shared/routine-template-schema.md` documents the case that recourse cannot reach — a routine
created outside this skill, with no record.

## v6.41.0 — Every shipped version has a changelog entry, and a gate that keeps it that way

This file documented 59 of the 145 versions that had shipped. The other 103 —
whole features, not only patches — had no entry, and 11 entries named versions
`main`'s tip never reported. It had been accumulating since v1.0.0 in February
2026, and nothing had gone wrong from the repo's point of view, because nothing
was checking.

The step was never written down. CLAUDE.md's "Releasing (two repos)" specified
the version bump and the marketplace mirror in detail and did not mention the
changelog once; its only occurrence of the word sat in a parenthetical about
where *not* to write a version number early. So entries were not being forgotten
against a procedure — there was no procedure, and whether a release got one
depended on whether someone happened to think of it.

Three changes, of which only the first is enforcement:

- **`tests/changelog-coverage.test.js`** reconstructs every version `main`'s tip
  ever reported and fails the suite on any that lacks an entry, on a heading the
  parser can't read or that appears twice, and on an entry naming a version that
  never shipped. The reconstruction walks the release branch's own first-parent
  chain and reads each commit's manifest blob (`bin/lib/changelog-git.js`);
  walking `git log --first-parent -- <manifest>` instead finds bump commits on
  side branches, which is a different set whenever two sessions bump
  concurrently — this repo's normal mode. The first version of the analysis used
  that wrong walk and disagreed with the right one about 11 versions. On a
  shallow clone the check skips and says so rather than passing silently.
  (Superseded by v6.45.0: the "right" walk was unsound too, and this backfill
  mislabelled 7 shipped releases as branch-numbered. See `[IL-95]`.)
- **`checkPluginVersionBump`** now names the changelog alongside the marketplace
  mirror. It had fired on exactly the right event since 6.12.1 — any commit
  touching `plugin.json` — while mentioning only half of what that event obliges,
  and its test asserted `/marketplace/i` and passed throughout. Both halves are
  asserted separately now.
- **CLAUDE.md's Releasing section** gained the step as step 2, including why the
  heading shape is load-bearing rather than cosmetic.

The backfill fills all 103 gaps, back to the initial scaffold on 2026-02-20.
Entries through v5.29.0 are reconstructed from commit history and are thinner
than those written since. Two second-order defects surfaced while doing it and
are also fixed. Six early headings (`## v4.1`, `## v4.2 — Token Saver`) matched
neither the parser's strict `X.Y.Z` nor its em-dash title, so
`/claude-tweaks:init`'s upgrade notice had been silently omitting those releases
from every range it reported; they are normalized. And the 11 orphans are the
residue of version collisions (`[IL-12]`) — the manifest got renumbered, the
heading kept the branch's number, and a user on 6.38.3 was reading about
"v6.39.0" under a number no install ever reported. Each is folded into the
version that carried it, verbatim, as a `###` subsection labelled with its
branch number.

Recorded as `[IL-94]`.

## v6.40.0 — One statement of what the worktree gate covers, pinned to the code (closes #138, #139)

The `worktree.always` gate was widened twice on 2026-07-20 — `c8f929e1` added `git push`
beside `git commit`, `cab6142b` added Bash `cp`/`mv`/`tee`. Both correct, both tested,
neither swept the prose. Five skill files went on describing the pre-widening gate, and three
of them prescribed procedures the widened gate denies:

- `wrap-up/cleanup-procedures.md` claimed a bare `cp` wasn't gated, so every
  `worktree.always` project silently lost `decisions.md` and `config.yml` at every wrap-up.
  Issue #32 had *closed* that same data-loss bug by adding the `cp` — its verification never
  ran under the policy.
- `wrap-up/review-console.md`'s headless fast-lane auto-merge pushed from the main checkout,
  where the push is denied and no human is present to see it.
- `flow/materialize.md` told the pipeline to commit the materialized record on the
  pre-worktree branch, which cannot execute under the policy at all (#139).
- `flow/worktree-merge.md` and `_shared/git-discipline.md` both stated flatly that
  `git push` is never gated.

All five corrected. The durable part is the binding: `pre-tool-use.js` exports a
`GATE_COVERAGE` constant it actually branches on, `_shared/policy-schema.md` carries the
single prose statement between marker comments, every other file cites it rather than
restating it, and `tests/hooks-gate-coverage.test.js` fails when the two diverge. Widening
the gate again now breaks a test until the canonical block is updated — and one edit
suffices, because nothing else holds a copy.

Also new: the gate's one path-prefix exemption. File writes under a repo's own
`.claude-tweaks/pipelines/` are allowed from anywhere, since that directory is plugin-owned,
gitignored bookkeeping rather than the project work the gate isolates. It applies to
file-write targets only — a `git commit`/`git push` target is the command's *working
directory*, so exempting those by prefix would permit any commit issued from inside a run
dir — and it fails closed on any path it cannot prove.

Found by grepping the *procedure shape* (`git push`, `cp`/`mv`/`tee`), not the keyword:
`materialize.md` and `review-console.md` never mention the gate, so their defect is silence.
That sweep turned up the fifth site after four were already known. Recorded as `[IL-93]`.

## v6.39.4 — The worktree gate stops failing open under load (closes #134)

`bin/lib/hooks/git-exec.js` ran every git query with a fixed 3000 ms budget and a bare
`catch { return null }`. That `null` reached `repoInfo()`, which returned `repoRoot: null`,
which `pre-tool-use.js` read as `// not a git repo at all -> allow`. The comment named one
cause. A `rev-parse` that timed out under load was a second, and it landed on the same
branch — so on a busy machine the `worktree.always` gate silently stopped denying.

This surfaced as `tests/hooks-*` flakiness and was originally filed as a test problem. It
was not. Four of the reproduced failures are precisely the tests asserting the gate *denies*;
they failed because it allowed.

Measurement drove the fix rather than intuition. The enforcement-critical `rev-parse`'s
maximum duration scales monotonically with load — 411 ms idle, 752 ms under one competing
suite, 1856 ms under three, 2492 ms under 24 workers plus two suites. That last figure is
83% of the old budget, on a repo whose normal working mode is several parallel worktree
sessions. Across 1000+ instrumented spawns at every load level there were zero `EAGAIN` and
zero `ENOMEM`: the OS never declined to fork, so this is latency against a fixed ceiling,
not resource exhaustion. The clinching datum was a test doing `mkdtemp` + `git init` +
`git commit` + one `repoInfo` call taking 5904 ms — fixture spawns peak at 2884 ms, and
2.9 s plus a fully consumed 3.0 s timeout is 5.9 s.

Three changes follow from that:

- **`execGit` became `runGit`**, returning `{ stdout, failure }` where `failure` distinguishes
  `timeout` / `spawn` / `no-git` from `git-error`. Only the last is an *answer*; the others
  mean the question went unasked. The rename is load-bearing: with a richer return, a call
  site left un-migrated would keep parsing and read an always-truthy object as success —
  failing silently in the dangerous direction (`[IL-31]`). A rename makes any miss a
  `ReferenceError`. The budget is now 10000 ms, ~4x the measured peak, and it is a ceiling
  rather than a cost (the normal case is ~45 ms).
- **`repoInfo` gained a third state.** `indeterminate: true` means `repoRoot: null` carries no
  information; `indeterminate: false` means git genuinely answered. Two independent routes to
  a null root — the git failure, and a `safeReal` that throws — now both report it honestly.
- **The gate still allows on indeterminate, deliberately** — CLAUDE.md's hooks contract is
  never-break-a-session, and denying on a transient load spike would freeze unattended runs.
  What changed is that it is no longer *silent*: it emits a `systemMessage` naming the paths it
  could not check. That warning is attached in a wrapper around `run()` rather than at its
  dozen return sites, because enumerating termination paths is how the omission in `[IL-14]`
  happened.

`tests/helpers/git-fixtures.js` also passed no `timeout` at all, making fixture setup
unbounded by construction; it now carries a 30 s ceiling whose only job is to turn a hang into
an error that names itself.

The hooks e2e suites stay in `npm test` rather than moving to `perf/` as v6.38.1 did for the
statusline render budget. That precedent does not transfer: v6.38.1 relocated a *performance*
assertion, which is what `perf/` is for, whereas these assert behavior. Applying its remedy
here reflexively would have silenced the flake and left the enforcement gap live and
undetectable — the tests were not misbehaving, they were correctly reporting a production
defect.

## v6.39.3 — Correct the gh-CLI dependency claim; record IL-91

Wrap-up findings from the #129 investigation. No behavior change.

- **The Stack table called `gh` "required" whenever `work-backend: github-issues` is active.**
  That has been overstated since 6.24.0: `_shared/github-write-transport.md` maps the whole
  work-record CRUD surface (list-by-label, create, edit/label, comment, close) onto GitHub MCP
  equivalents, and `_shared/issue-claims.md`'s file-blob claim lock stands in for the ref-level
  one. Narrowed to "default transport, not a hard requirement," naming the MCP path. The row
  mattered because it told a reader that a `gh`-less environment cannot do this work — which is
  precisely the cloud-sandbox shape #129 is about, and it had been wrong since the release whose
  absence caused #129's symptom.
- **`[IL-91]`** — in zsh, `"$ref:path"` applies the `:s` parameter-expansion modifier and
  silently mangles the ref; with `2>/dev/null` the command returns empty rather than erroring. A
  `git show` loop over three refs reported zero matches for a string that was plainly present,
  and nearly pinned #129's root cause on the wrong repository.

## v6.39.2 — One broken journey no longer pins journey-health's rotation (closes #131)

`journey-health`'s Phase 0 force-picks any journey declaring a `files:` path that no longer
exists — a certain, judgment-free drift signal, and the right thing to surface ahead of
staleness and churn. It consulted no cursor at all, by design, which meant a journey whose
declared file was *genuinely* deleted was re-picked on every firing indefinitely: the file
stays deleted until a human edits the frontmatter, so the condition that selected it never
clears. Its within-batch `alreadyPicked` guard only dedups inside one `--budget` call.

Measured on the reporting repo: 17 journeys, ~9 days of daily firings, and a persisted cursor
map containing exactly one journey plus `__coverageScan`. Sixteen were never audited. Fixing
the pinned journey's frontmatter only moved the pin to the next journey alphabetically, which
had three missing declared files behind it. The starvation was also invisible in the issue
stream — dedup swallowed the repeat finding every time, so nothing surfaced the repetition.

The force-pick now fires once per distinct missing set rather than once per firing. The
light-tier `validate-findings` call records the audited journey's missing set on its cursor
(`deletedFileSig`, recomputed from the tree as it stands when the audit finishes), and Phase 0
skips a journey whose live missing set already matches what's recorded. The signal is kept in
full: a *new* file going missing behind an already-reported one is a different set and still
force-picks immediately, a restored file clears the acknowledgement, and an unfixed journey
still comes back around on Phase 1's normal 30-day staleness floor. Deep-tier audits never
write the field — Phase 0 is light-tier only, so a deep audit must not suppress a light
force-pick that never happened.

This is distinct from #73, which fixed the adjacent *glob* false-positive (a `files:` entry
like `docs/**/*.md` reading as missing). That was a wrong signal; this was a correct signal
with no off switch. It is also distinct from #130 (v6.39.1, immediately below), which fixed the
shared rotation core's Phase 1: the two compose — Phase 0 now hands a journey off to the
rotation, and Phase 1 now actually rotates. Neither one alone gives the coverage both were meant
to provide; all 184 journey-health tests were verified green against #130's rewritten
`rotation.js` before either landed.

## v6.39.1 — Health rotation reaches past its alphabetical prefix (closes #130)

`health-core/rotation.js`'s Phase 1 returned on the *first* candidate past `staleDays`
rather than the most overdue one. Since every engine's `scope.js` sorts candidates by id
and each run advances exactly one slice, coverage was a strict alphabetical march at one
slice per run — and by run number `staleDays` the head of the list had re-crossed the
threshold and was force-picked again, long before the march reached the tail.

Everything ranked past position ≈ `staleDays` was therefore permanently unreachable. Not
a slow rotation: an unreachable one. Measured on a real repo, docs-health could never
audit ~59% of its 146 docs (`staleDays` 60), and code-health >90% of its several hundred
slices (`MAX_STALE_DAYS` 30). One repo's docs-health had spent 19 days on `REGISTRY` plus
`decisions/ADR-001` through `ADR-004`, still inside the alphabetically-first directory.

Phase 1 now selects `max(daysSince)`, applying the existing `tieBreakKey` to equal
staleness — which matters more here than in Phase 2, since every never-audited candidate
sits at `Infinity` and a fresh repo's whole pool is one big tie. All four engines share
this module, so all four are fixed at once.

A consequence worth naming: each engine's explicit candidate sort is now a determinism
detail rather than the coverage mechanism. Selection no longer depends on the order
candidates arrive in. `code-health/scope.js`'s comment, which justified its sort on
first-qualifying-wins grounds, is corrected to match.

The regression test runs the starvation model forward — 90 candidates against a 30-day
threshold, one pick per simulated day — and asserts the full set is covered with no
repeats. It fails on the old implementation at 31 of 90.

## v6.39.0 — Routines report which build they resolved (closes #129)

A scheduled `dispatch next` Routine hard-gated on `gh` being absent — the gate 6.24.0 had
already replaced with an MCP branch — and described `dispatch/SKILL.md` as having no MCP
claim path at all. Both statements are accurate about 6.23.7 and false about the build the
marketplace was serving. The sandbox had been running pre-fix code for days while its setup
script's `claude plugin update` reported success on every firing.

`claude plugin update` compares the installed version *string* against the *local* marketplace
catalog and inspects nothing else. Emptying a cached plugin directory of its files and
re-running it yields `already at the latest version (6.38.1)` and exit 0, repairing nothing;
pointing an installation record at an older directory yields the same line; so does a catalog
that failed to refresh, since the comparison then measures the sandbox against itself. Three
broken states and one healthy one produce identical logs — which is why the investigation
behind #129 first concluded `dispatch`'s gate was still wrong.

- **Every routine prompt now opens by printing the build it resolved**, read from
  `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — the directory the running skill files
  were loaded from, and the only source that cannot disagree with them. Added to the standard
  preamble in `_shared/routine-template-schema.md` and to all six `routine-template.yml`
  files, each with its `template_version` bumped so `/claude-tweaks:routine status` reports
  the drift. Live routines carry a frozen copy of their prompt and pick this up only via
  `/claude-tweaks:routine update {skill}`.
- **`dispatch`'s headless self-report records the resolved build** on the issue it files, and
  on a deduplicated re-file adds one comment per *distinct* build. The marker asks "has this
  check been reported," whose answer stays yes forever; the build line asks "has this build
  been seen failing it," whose answer changes when a sandbox is repaired or silently rolls
  back. #129's own self-report issue sat silent through three later firings without it.
- **The generated cloud setup script verifies instead of trusting.** Marketplace `update`
  failures are no longer silenced to `/dev/null` — a catalog that failed to refresh is the
  precondition that makes every version check downstream meaningless. After the install loop,
  each plugin's version is resolved from the directory a session would actually load,
  compared against the catalog, and reinstalled on drift. `claude plugin list`'s recorded
  `version` and `installed_plugins.json`'s `gitCommitSha` are deliberately not used: the
  former is metadata beside the directory rather than out of it, and the latter is not
  refreshed by `claude plugin update` at all.
- New regression test asserting all six templates' preambles still match the canonical block
  in `_shared/routine-template-schema.md`, and `[IL-89]` recording the general rule.

## v6.38.3 — journey-health's deleted-file pick fires once per missing set (2026-08-06)

The #131 fix reached `main` under this number and was then renumbered to 6.39.2
after a collision, so both versions shipped and both carry it. The write-up is
in the 6.39.2 entry above.

## v6.38.1 — Timing budgets leave the correctness suite (closes #107)

`tests/statusline.test.js`'s render-time assertion failed whenever another agent session ran
its own `npm test` in a sibling worktree — a routine occurrence in this repo, not an edge
case. Best-of-7 at a 1000 ms threshold was already a load mitigation and was not enough.

Measuring the problem rather than retuning the threshold showed the assertion was mostly not
about the renderer. A bare `node -e ""` spawn with the same temp-HOME setup costs ~34 ms
against a ~58 ms full statusline spawn, so ~59% of what it timed was Node process startup —
and startup is also the term that inflates under load. A competing `npm test` pushed that
control spawn from 34 ms to 566 ms, a 16x swing in something the renderer neither owns nor
can influence.

Subtracting a control spawn was tried first and rejected on evidence: under a real competing
suite the *difference* still reached 573 ms against a 250 ms budget, because contention
inflates both terms unequally. A ratio bound was rejected for the opposite reason — it is
stable under load (1.7x idle, 1.8-2.5x saturated) but a fixed-size regression becomes
proportionally invisible as the baseline grows, so it would miss under load exactly the
regression it catches when idle.

The assertion therefore moves to `perf/`, run via `npm run test:perf` and excluded from
`npm test`. Correctness runs are now deterministic under concurrent load; the performance
bound is kept, not deleted. It also got stricter in the move: the budget is now 250 ms of
render cost above a bare-Node control rather than 1000 ms absolute, and a 300 ms injected
stall fails it at 335 ms of render cost — while its 422 ms absolute would have passed the
threshold it replaces.

Removing it also takes ~21 s off every full run under load, and ~450 ms idle.

## v6.38.0 — The last two legacy families (closes #128)

v6.36.0 claimed nine legacy families removed and shipped seven. The two it missed
are gone now, with every consumer they reached, not just their defining sections.

**The retired Auto-mode-policy block.** `LEGACY_CLAUDE_MD_LEVER_KEYS` and the
`legacyClaudeMdLevers` field are gone from `bin/lib/policy-schema.js`, so
`auditPolicy` returns `{unrecognizedKeys, invalidValues}` and nothing else. That
field had reached further than the defining constant: `/claude-tweaks:harness-health`
filtered its policy-schema findings by the eight legacy lever names and explicitly
deferred to `/init`'s migration offer; `/tidy` and `/build` each resolved a lever
through a CLAUDE.md fallback; `/flow` documented two survey levers as living under
the retired section. All re-pointed. `/init` Update Mode's `### Auto-Mode-Policy
Migration` section is removed outright — with the block no longer generated and the
alias no longer read, a migration offer had nothing left to migrate.

**The legacy `auth.yml` split and v1 stories format.** `skills/stories/migration.md`
is deleted, along with `/stories`' v1 detection step, its `migrate` argument, and the
`auth.yml` detection branch in `auth-resolution.md`. `/test`'s legacy path went with
it — including the prompt template that passed plaintext credentials to the model,
which the vault-based path (`auth: { vault: "<name>" }`) has superseded since v3.

That file reached further than #128's own list: `_shared/dev-url-detection.md` still
described `auth.yml` as a credential home beside the vault and offered to gitignore
it, `/init`'s gitignore template seeded the entry, and `/demo` and `/help` both named
it as a live auth source. All re-pointed at the vault. The wider surface was found by
sweeping centrally after the listed sites were done, not from the issue body.

The plan's STOP condition was honoured rather than assumed: no tracked `auth.yml` or
story file exists, so nothing live depended on the removed form. The reverse
fixture obligation was checked too — no eval asserts on `legacyClaudeMdLevers`, so
removing it left no assertion to repair. `evals/fixtures/*/CLAUDE.md` still carry a
`## Auto-mode policy` block and are deliberately untouched: they are frozen test
inputs, and a fixture that tracks live content fails exactly when the next migration
makes it riskiest (`[IL-80]`).

The 19 `legacyClaudeMdLevers` tests in `tests/policy-schema.test.js` are removed
rather than skipped — three named blocks plus sixteen generated by an eight-lever
loop, taking the suite from 406 to 387. One survivor was rewritten to keep proving
that both config sources are audited, which was the only non-legacy thing it tested.

## v6.37.1 — Fix six dangling "check 10" references shipped in 6.37.0

Resolving the legacy-purge merge retired harness-health's old check 9 and
renumbered the new context-cost bloat scan from 10 to 9. The numbered list item was
renumbered; the prose references to it were not. `_shared/harness-health-analysis.md`
and `harness-health/judge-procedure.md` each shipped three sentences pointing a judge
agent at "check 10" in a list that now ends at 9.

Prose-only, so no test caught it — and `harness-health-analysis.md` is inlined into
every dispatched judge agent, so the dangling reference reached every one of them.

The renumbering discipline this violates (`[IL-55]`: verify topic-consistency after a
renumber rather than expecting a grep to return nothing) was applied to `/help`'s
Priority Order in the same release and skipped here.

## v6.37.0 — Skill-bloat reduction Phase 3: Anti-Pattern compression, extraction, and a detector

Closes the three-phase effort. The shipped `SKILL.md` payload — the context re-emitted on
every skill invocation and once per dispatched subagent — is down from **931.1 KB to
727.8 KB, a 203.3 KB (21.8%) reduction**, and **no file is over CLAUDE.md's 40 KB ceiling**
for the first time (the largest is now `init` at 39.2 KB, from 58 KB).

**Anti-Patterns compressed in place, never evicted.** All 32 tables tightened for 13.6 KB
(18.9%) with every row preserved and every backticked identifier intact — verified
mechanically, because an Anti-Pattern row is a negative instruction and deleting one
degrades silently: nothing observable happens when the model stops being told not to do
something. The guard was built and deliberately falsified *before* any rewriting.

This is short of the ~40% the design projected, and the projection was the thing that was
wrong. Six agents worked disjoint file sets, could not see each other, and all six landed
between 18% and 21% with the same finding: a Pattern cell names the forbidden thing, so
compressing it spends specificity rather than bytes, and the Why cells were already one
clause carrying identifiers and enumerations. The remaining lever — merging semantically
overlapping rows — needs a human deciding which guardrails may share a row, so nobody took
it silently.

**Five oversized files extracted** (#119, re-scoped). Its premise was a prose diet
estimated at ~150 KB; measuring first — the issue's own deliverable, never done — found the
four named species occur **26 times** in total. The size was structural: `review`'s Step 3
alone was 17.7 KB. Extraction followed the citation-shape rule, one sub-file per unit a stub
actually names, with every extracted heading left as a stub so external references still
resolve in one hop. Verified per file that every substantive original line survives
somewhere in that skill's file set.

**A detector so none of it regrows** (#120). A harness-health bloat criterion covering
over-ceiling files, over-long rows, provenance narration, and degenerate tables, calibrated
against the cleaned corpus rather than the old one — which is why it was sequenced last.
Plus an eval context-cost regression check that reports and skips rather than silently
passing when there is no baseline.

The house-structure check now runs corpus-wide, and migrating the three duplicate copies onto
the shared helper fixed a check that had been passing vacuously: every `SKILL.md`'s
interaction directive contains the backticked text `## Next Actions`, so the old
`body.indexOf()` matched that mention — position 906 in `code-health` — instead of the real
heading at 35835, making the ordering assertion trivially true. Proven by breaking three
skills so the order really was wrong: the old check passed on every one.

`/help` also gained the two behaviours it had documented but never implemented (#121, #122).

## v6.36.0 — Most backward-compatibility paths removed

Nine legacy families and no deprecation policy documented anywhere. The marketplace
source is an unpinned git URL tracking `main` HEAD, so there were never pinned
versions in the wild to support.

Removed: the legacy spec-file alias (a bare number resolving to `specs/{N}-*.md`
alongside `#N`), the `specs/` tracking files, the four `triage-*` policy aliases,
the `backlog-backend` flag alias, and the legacy-taxonomy scan.

**Correction (2026-08-05).** This entry as first published also claimed the retired
Auto-mode-policy block migration "and its supporting machinery" and the legacy
`auth.yml` split and v1 stories format were removed. Neither was — both families
are still live, and the heading said "Every" when it should have said "Most". The
entry was written from the plan's prewritten text rather than verified against the
tree, the exact failure `[IL-71]` describes. Both families were tracked in #128 and
removed in v6.38.0 — the heading here stays "Most", because it describes what this
release actually shipped.

`backlog-backend` was the one that had already crossed into wrong behavior: three
skills read it, every other consumer silently defaulted to `local-files`, and
`README.md` documented that rather than fixing it. Partial aliasing is worse than
either full aliasing or none.

Removing the spec-file alias took two changes past renaming. `/flow`'s pre-flight
2.4 (spec-committed check) was gated "legacy spec-file alias only" and lost its
last consumer, so the check and its `validation.md` section are gone. `/init`'s
Step 3 wrote `specs/INDEX.md`, its only starter file; the step keeps its number
(repurposed to the work-record-storage note) so surrounding references still
resolve. Bare ids under `work-backend: local-files` are untouched throughout —
that is a current input form, not the alias.

The `status:in-progress` label was deleted after resolving a contradiction — it is
retired vocabulary, but its GitHub label description pointed at
`_shared/issue-claims.md`, which uses `bot:in-progress` and never mentions it.
`[IL-85]` records the general lesson: a compatibility path with no stated removal
condition is never collected.

## v6.35.0 — Adopter CLAUDE.md carries only what always-loaded context needs

`/claude-tweaks:init` wrote byte-identical boilerplate into every adopting project's
CLAUDE.md, inherited by every dispatched subagent and competing against the
`harness-health.always-loaded-budget` before the project contributed a word. The
template now carries only content that must reach the model on a turn where no
claude-tweaks skill was invoked. `## Working Approach` (1,561 B) and `## Philosophy`
(200 B) are untouched — they govern ad-hoc work where no skill gate fires. The
Pipeline section keeps its four routing paragraphs and loses the bookend-architecture
detail, the run-dir mechanics, and the auto-mode flag explanation, all of which are
only consulted once `/flow` is already running, dropping from 2,468 B to 847 B.

`## Project Defaults` is deleted outright (1,287 B to 0 B). `markdown-mode` and
`directory` had no reader anywhere — confirmed structurally, not inferred from a
keyword search (the `directory` result is consistent with
`step-06-worktree-configuration.md` requiring worktree detection to use `git worktree
list` rather than a configured name). `execution-strategy` and `git-strategy` gained
`policy.yml` paths and `POLICY_KEYS` entries, which had never validated them.
`section-confirmation`, `merge-check`, and `scope-keywords-required` turned out to
already be in `POLICY_KEYS`, contradicting the schema doc's claim that they had no
`policy.yml` path.

`execution.always` is corrected. It was documented as locking the execution axis "to
`subagent` only" while typed as `enum ['subagent','batched']`. `build/SKILL.md`
confirms the lock generalizes to whichever value is set; both rows now state the
distinction from `execution-strategy` (a lock versus an overridable default).

Resolution chains are repointed. `/flow`'s `git-strategy` and `execution-strategy`
chains, and `/build`'s own default-resolution section they defer to, named CLAUDE.md
as the source for keys the template no longer writes. `auto-mode` keeps both sources
named — it is genuinely dual-homed.

Measured across the whole Initial Mode Template body — exiting at the first
subsequent `## ` heading rather than one section past it — the total drops from
6,462 B to 3,554 B, a 2,908 B (-45%) reduction that reconciles exactly against the
two changes above: 2,468 - 847 = 1,621, plus the 1,287 from Project Defaults, equals
2,908.

`/claude-tweaks:init` Update Mode detected CLAUDE.md drift with four hand-maintained
greps for contract-version markers. `Working Approach` and `Philosophy` appeared zero
times in `update-mode.md`, so a project adopting the plugin with an existing
CLAUDE.md reliably got the pipeline plumbing offered as patches and never the two
sections that shape how the model behaves. The replacement
(`bin/lib/init/claude-md-conformance.js`) is deterministic and reads the template
live, so a future template change needs no edit here. It reports *drift* as well as
absence — an edited plugin-authored section was previously invisible. A completeness
assertion fails if any template section belongs to neither the plugin-authored nor
project-authored list, so a newly added section cannot silently escape the check.

`/claude-tweaks:wrap-up` gains Step 7.9, a CLAUDE.md audit behind an applicability
gate, opening on a Don't candidate, a renamed command, a contradicted convention, or
a recorded incident, and reusing `_shared/harness-health-analysis.md` — the
procedure Step 7 already applies to skills. Its closed-gate summary reports "audit
not run" rather than "no findings", since a gate that never opened is otherwise
indistinguishable from a clean CLAUDE.md. Findings surface at the Review Console's
Configuration updates section and are always offered, never auto-applied.

## v6.34.0 — Skill-bloat reduction Phase 2: the Relationship table leaves the payload

Every `skills/*/SKILL.md` carried a `## Relationship to Other Skills` table describing
how that skill related to the others. All 32 are gone, removing **130,677 bytes —
127.6 KB, 13.8% of every SKILL.md byte in the plugin** — from the context re-emitted on
each invocation. Measured before and after across the 32 files, not projected; Phase 1's
figures went stale exactly by carrying a projection forward.

The removal rests on reading all 510 rows against the files they described and asking one
question of each: does this bind what the model does while executing *this* skill? Twenty
rows did — 3.9%, with 24 of the 32 skills at zero. Those moved into the step bodies that
use them, rewritten as instructions rather than third-person description. The rest
documented relationships a running model never acts on, and they now live once in
`docs/skill-graph.md`, which ships to nobody: `PLUGIN_SNAPSHOT_DIRS` covers
`.claude-plugin`, `skills`, `agents`, `hooks`, `bin`, and `commands`, not `docs/`.

Collapsing 212 navigational rows into 173 graph entries merged 39 reciprocal pairs — the
direct cost of the bidirectional cross-reference convention this replaces, which required
every edge in two places. That convention is retired; `CLAUDE.md` now requires each edge
stated once in the graph, and `bin/lib/skill-audit`'s parser, written to perform the
migration, stays on as the guard against the tables creeping back one skill at a time.

Stating each edge once immediately exposed drift the two copies had been hiding. `/tidy`
queried `--label by:code-health` while its own table claimed the bare form. `/backlog`
credited `overview` mode's recommendations to `groupByFileOverlap`, which it never calls.
`/tidy` credited `extractFingerprint` to its Sync payload; it is a dedup helper.
`/design-wrapper` and `/ledger` appeared to contradict each other about ledger writes —
neither was wrong, `/flow` does the writing. And `DESIGN.json` turned out to be a phantom:
three files promised token extraction from it while the one procedure they all delegate to
reads `DESIGN.md` only. Two behaviours `/help` documented but never implemented are filed
as #121 and #122 rather than quietly deleted with their rows.

## v6.33.0 — Skill-bloat reduction Phase 1: directive compression + one-line lifecycle markers

Two independent levers against the same 32 `skills/*/SKILL.md` files, both re-emitted
verbatim on every invocation. The interaction-style directive was byte-identical
across all 32 skills; compressing it from 570 B to 327 B initially dropped its
"resolve each before showing the next" sequencing clause — a rule that now lives
only in the shipped skill files, since CLAUDE.md does not ship with the plugin. A
final review caught the drop and restored the clause, landing the directive at
357 B and saving 6,816 B in total. Ten of the skills — `capture`, `challenge`,
`design-wrapper`, `init`, `review`, `specify`, `stories`, `test`, `version`,
`wrap-up` — carried a linear ASCII lifecycle diagram whose only informational
content was that skill's position in the pipeline; each is now a one-line
`Lifecycle:` marker, saving a further 2,685 B. The same review widened `/help`'s
own diagram to list all ten pipeline skills instead of seven (+467 B) and removed
a self-contradicting sentence from `version` and `design-wrapper`'s subtitles
(−82 B). Net across the 32 files: 9,116 bytes (8.9 KB) removed from
per-invocation context, measured directly rather than estimated.

The directive stays inline in each skill rather than moving to a single
CLAUDE.md-hosted copy. CLAUDE.md is a repo file, not a shipped plugin asset — the
plugin distributes only `.claude-plugin`, `skills`, `agents`, `hooks`, `bin`, and
`commands` — so a pointer there would resolve to nothing for an installed user.

## v6.32.0 — Token-audit batch: bounded tool output, split fragments, corrected cardinalities (closes #90, #91, #100; refs #96)

Four records from the token/context optimization audit. The through-line is that
every one of their issue bodies was factually wrong, and re-deriving each claim
against the live files — rather than implementing what the record asked for —
changed the deliverable in all four.

External tool output is now bounded at the point of invocation. `/code-health`'s
tool-assist commands carry `jq` projections or `head`/`tail` caps instead of
emitting raw JSON that routinely runs past 200 KB; `/docs-health`'s executed
command blocks redirect to a temp file and inspect exit status plus `tail -20`,
since the check is whether a documented command still works, not what it prints.
The `gh` list calls that inherited `gh`'s implicit default of 30 now carry an
explicit `--limit` — that default silently truncated rather than erroring, making
it a correctness bug as much as a cost one. The unbounded-execution instruction
turned out to live in `docs-health/judge-procedure.md`, the file inlined verbatim
into each judge agent's prompt, not in `SKILL.md` where the record placed it.

Two `_shared/` fragments were read whole by consumers needing one section. The
config-key table and the memory-specific checks now live in their own fragments,
so a config-key-only consumer loads 4.8 KB instead of 22.7 KB and a memory audit
loads 5.2 KB instead of 34.3 KB. Both parents keep the original heading as a stub
naming the child, so citations still resolve in one hop. Two further splits the
record proposed were measured and skipped: every citation of the permission matrix
and of the new-skill-gap steps reads them alongside their parent, so both would
have been net-negative on every path.

Template A gained a 15-row cap with a mandatory `+N more` overflow row — ordering
by severity is what makes truncation safe, and the marker is non-optional so no
finding is silently dropped. Two dispatch sites that omitted a model tier now
declare one.

Roughly thirty restated cardinalities were corrected, most by replacing the number
with a by-reference deferral rather than a new literal. Three files contradicted
themselves and now state each fact once. `IL-77` records the case that shaped the
approach: the lifecycle diagram's title said "18 core labels" against a true count
of 24, but its own table lists 18 rows, so writing the correct number would have
contradicted the data printed directly beneath it.

## v6.31.0 — merge-check judges behavior delta, not diff size or file path (closes #78)

`merge-check`'s instruction-file floor named `skills/**` and `agents/**` — this
repository's own layout. In any project where the plugin is the harness it never
matched `.claude/skills/`, missed `.claude/agents/`, and never covered
`.claude/rules/` at all, leaving `CLAUDE.md` — the highest-leverage instruction
file a project has — with weaker merge protection than a single skill file. The
floor now resolves by role: any file the harness loads as instruction rather than
as subject matter.

The floor also gained an escape. Previously every instruction-file change was
`needs-human` regardless of content, so a backlog refine run over harness-health
drift fixes returned a uniform withhold — a caution that fires on everything stops
carrying information. The escape is a refutation attempt rather than a
mechanical-or-substantive classification: name a behavior an agent could take
differently after the edit, and pass only when the attempt comes up empty.

Blast radius stopped being a proxy for risk on its own. `automerge-max-lines`/
`automerge-max-files` now bind only once a diff is judged to carry behavior change
at all. `blastRadiusSummary` reports whole-diff totals with no per-hunk breakdown,
so that judgment is deliberately a binary on the whole diff rather than an attempt
to size some fraction of it. A large diff in which every hunk is the same
behavior-preserving transformation, with a clean review, is no longer leaned
against for its size alone.

`grant-check` recommends on content and states plainly that `merge-check` re-judges
the real diff, so a grant authorizes an attempt rather than promising a merge. Its
Anti-Patterns row — which said "new-or-changed … regardless of how clean or small"
and silently overrode Step 2's own "substantially editing" qualifier — is replaced.
Calibration cases now live in the skill rather than in a design doc, since the
previous anchor was a design doc and it was pruned.

## v6.30.0 — Mode-conditional and headless-path content stops loading unconditionally (closes #89, #82; refs #93)

Three independent passes at the same defect: procedure that only one branch of a
run will ever execute, loaded on every run.

`/claude-tweaks:routine`, `/specify`, `/tidy` and `/dispatch` inlined
mutually-exclusive mode bodies. Each now resolves its mode first and reads only
that branch, across 11 new sub-files. Every step number and section heading stays
in place as a stub, so the ~15 external references that name them
(`CREATE Step 4`, `STATUS Step 2`, `SKILL.md`'s Shaping mode, the Action
Vocabulary) still resolve in one hop. Measured per-mode: `/routine status --all`
-26.8 KB, `/specify` shaping -26.0 KB, `/dispatch`'s common gh-present path
-6.7 KB, `/tidy` -0.9 to -7.3 KB depending on mode and backend.

Two deliberate deviations from #89's plan. `/routine`'s CREATE and UPDATE share
one file rather than the proposed two, because UPDATE reuses five of CREATE's
nine steps by name and splitting them would make an `update` run read CREATE's
file anyway. `/dispatch`'s local-files Preflight stop stays inline — it is a
safety gate and must be seen before any action.

`/code-health`'s `next-slice` went exactly one level deep, so with no workspace
manifest this repo's `bin` was a single 1,181,325 B slice across 208 files, which
Step 3 told the judge to read in full. Slices are now capped at 30 KB by bytes,
splitting recursively; every file still lands in exactly one slice and total bytes
are conserved (12 -> 35 slices here, worst case down to 210,202 B).

The four health skills each inlined the whole ask-before-file gate, which is
interactive-only by its own rule — so every scheduled Routine firing, their
primary path, carried 2.1-2.4 KB it would never execute. Each consumer now
carries a short interactive-only pointer instead.

## v6.29.0 — Behavior-delta merge judgment, in progress (2026-08-03)

The design and first implementation of merge-check judging behavior delta rather
than diff size or file path (refs #78). `main` briefly reported 6.29.0 before a
concurrent bump moved the release to 6.31.0, where the finished feature is
written up.

## v6.28.0 — Dispatched agents get their procedure inlined, not a pointer (closes #94, #101, #110)

Both `/claude-tweaks:docs-health` and `/claude-tweaks:harness-health` told parallel
Task agents to apply a procedure they were handed only a *path* to. Agents see
nothing but their own prompt, so a path reaches nothing — docs-health's references
(`"Step 3 above"`, its SKILL.md by path) were unresolvable outright, making agents
emit malformed output rather than merely expensive output; harness-health's
resolved, but made every agent in a `--budget` batch independently read a 34,314 B
fragment.

Each skill now owns a self-contained `judge-procedure.md` that its dispatch inlines
verbatim, with a meta lead above a horizontal rule and the agent-facing body below.
Neither shared criteria fragment changed — `_shared/criteria-docs-diataxis.md` keeps
all 7 of its consumers and `_shared/harness-health-analysis.md` all 13, none touched.
A test in each skill enforces the self-containment invariant the extraction rests on,
and both were verified to discriminate by injecting the exact regression.

Also in this release:

- **Payload de-duplication (#101).** `harness-health` and `docs-health` returned
  `oldString`/`newString` as top-level fields *and* embedded both in the composed
  `body`. A finding carrying ~2.6 KB of patch text serialized 38-43% duplicate. `body`
  is now the sole carrier (it is what ships to GitHub); all four health skills' payload
  shapes agree. `harness-health` keeps `intent`, the only remaining signal
  distinguishing a removal from a replacement once `newString` is gone.
- **docs-health read cap (#92).** A 40,000-byte cap with a stated partial-read strategy,
  and a carve-out so every fenced command block is still executed regardless. The
  archive-exclusion half of that issue had already shipped in `8d7d3419`, two weeks
  before it was filed; a new test pins the full-path match so the near-identically-named
  `docs/plans/` correctly stays in scope.
- **`harness-health/SKILL.md` back under the 40 KB ceiling.** Step 7's filing procedure
  moved verbatim into `filing.md` (46,813 → 36,880 B), with a test now guarding the
  ceiling directly so it cannot silently regress.
- **Two new CLAUDE.md Don'ts** (`[IL-71]` extended, `[IL-72]` added): verify a filed
  issue's premise and not just its acceptance criteria, and extract-then-inline rather
  than inlining into a size-capped file and extracting afterwards.

## v6.27.0 — Live record-graph visualization (closes #28)

`/claude-tweaks:visualize` gains a `record-graph` type: a deterministic diagram of
this project's own live open work-record queue — stage columns (backlog/parked/
ready), `Blocked by #N` dependency edges, and a six-axis color/badge encoding
(Origin, Bot state, Type, Scoring, Authorization, Acceptance). No topic argument;
always persisted to `docs/diagrams/record-graph.html`, regenerated on demand. The type
currently requires `work-backend: github-issues` — `local-files` records carry no
`.number` field to key nodes and edges on, so `record-graph.md` Step A gates on the
backend and stops rather than rendering a collapsed diagram; `local-files` support is
follow-up work.

A new `bin/record-graph.js` CLI (backed by pure, unit-tested `bin/lib/record-graph/`
modules) does all data-shape work deterministically — stage bucketing, six-axis
encoding, and Blocked-by edge resolution reuse the existing, tested
`bin/lib/issues/record.js` facet/dependency parsing rather than any model-authored
transcription of issue numbers, titles, or labels. Content is a point-in-time
snapshot, not a live-refreshing view — the diagram carries a "Generated {timestamp}
— re-run to refresh" note rather than a client-side data fetch.

## v6.26.0 — CLAUDE.md context budget: rules and evidence split (closes #95, #102)

`CLAUDE.md` was 94 KB, and its `## Don'ts` section alone was 53,939 B — 57% of the file. That cost
is paid per *agent*, not per session: every Task-dispatched subagent inherits the whole file, so a
13-agent `/review` fan-out carried it thirteen times, at measured ratios of 13:1 to 38:1 against the
prompts those agents were actually given.

CLAUDE.md is now 44 KB (-53%). The Don'ts are 20 KB (-63%), compressed to rule-plus-one-clause with
every rule kept and three bundled bullets split rather than shrunk. The 69 post-mortem narratives
behind them moved **verbatim** to `docs/incident-log.md`, tagged `[IL-nn]` — a move, not a delete, so
the evidence survives where its length costs nothing. The directory tree, per-skill sub-file table,
and command reference moved to `docs/plugin-structure.md`.

Ten wrong facts were corrected first (#95) — a stale version literal, a `_shared` inventory naming
~22 of 49 files, four health-CLI subcommand lists that had all drifted, and a retired `/reflect`
claim. Four of them were retired by deferral rather than correction, since a corrected count drifts
again. The same idiom was applied to the three highest-multiplicity restated counts across 23 files
(#102), following `/visualize`'s numeral-free precedent.

Rules can now also *leave*. `/claude-tweaks:harness-health` gains a rule-expiry check — the
complement of its "guardrails, not wishes" check — that proposes removing a rule whose hazard can no
longer occur, guarded by an explicit rule that absence of recurrence is not evidence of death. This
needed a new `intent: "remove"` finding shape, scoped to `assetType: claude-md`; deletion had been
unmodelled across every health validator. `/reflect` and `/wrap-up` now direct that the incident
account be written before the rule, and `/init`'s CLAUDE.md template teaches the same shape to newly
initialized projects. See ADR-0010.

### Live proof the eval harness's OS sandbox denies a Bash escape (closes #46) — branch-numbered v6.25.0

`evals/actor.js`'s scope guard denies path-bearing tool inputs outside a scenario's fixture
`repoDir`, but by design never inspects `Bash` command text — the real containment for Bash
escapes has always been `runner.js`'s `managedSettings.sandbox`, documented as a belief, not
verified by an executable test. This closes that gap: a new `actor-escape-attempt` scenario
prompts a real model to attempt a Bash-executed write outside the fixture repo and asserts the
OS sandbox denies it — run for real (not just fake-queryFn unit coverage, which structurally
cannot exercise real OS-level sandboxing), confirmed `allPassed: true`.

Fixing this also surfaced a tool-count accuracy gap: `managedSettings.sandbox`'s own
`autoAllowBashIfSandboxed` defaults to `true` (confirmed against Anthropic's public sandboxing
docs — an installed-SDK `node_modules` read was denied by this project's own permission
settings), letting many sandboxed Bash calls bypass `canUseTool` entirely and silently
undercount `toolCalls`. `runner.js` now explicitly sets it `false`.

A follow-up code review found the new scenario's assertions only confirmed *some* Bash call
happened, not the specific escape command — fixed with a new `tool-input-includes` assertion
(backed by a `toolInputs` context field capturing `{name, input}` per call, parallel to the
existing bare-name `toolCalls` array so `tool-called`/`tool-count` are unaffected), validated
with a second live run. Also fixed in the same pass: a fail-open `absolute-path-exists`
assertion that silently passed on a missing/typo'd context field (now fails closed and cannot
crash a live run uncaught), and a stale wrap-up cleanup instruction that would have deleted
`docs/superpowers/plans/*.md` files this project actually keeps as a permanent archive.

## v6.24.0 — /dispatch's gh-CLI/MCP bridge (closes #61)

This number shipped twice. `main`'s tip first reported 6.24.0 on 2026-07-30, then
rolled back to 6.23.2 and worked forward through 6.23.7 before returning to
6.24.0 on 2026-08-02 — the only backwards step in the plugin's history, and the
reason this file is ordered by ship date rather than by semver.

`/claude-tweaks:dispatch`'s Preflight previously hard-gated on `gh` CLI presence
unconditionally — its entire queue/claim/settle/merge read path was `gh`-only end to end, so
running headless in a Claude Code cloud Routine sandbox (no `gh` CLI, GitHub MCP tools only)
was never possible. A prior attempt at this bridge (`274e30e`, reverted the next day as
`d4bdfb9`) shipped the gate flip before finishing the read-path bridge, producing an
unstructured `gh: command not found` crash instead of a clean stop.

This time: a real diagnostic Routine fired against a live cloud sandbox first confirmed every
needed GitHub MCP tool name and semantics (including the create-only/conditional-write
sha-gated CAS primitive a claim lock's correctness depends on, and branch creation via
`create_branch`) — via a new reusable shared procedure,
`skills/_shared/routine-diagnostic-probe.md`, for firing ad hoc diagnostics against any
project's cloud Routine environment without hand-building a one-off `RemoteTrigger` call each
time. Only once every primitive was confirmed did the plan write MCP-path documentation into
every read-path call site (`dispatch/SKILL.md`, `settle-and-merge.md`, `issue-claims.md`), and
only then flip the Preflight gate: `gh` present → proceed exactly as always; `gh` absent →
proceed via the now-documented, verified MCP path. The `gh`-CLI path is unchanged everywhere.

## v6.23.7 — cloud-setup.sh fixes (2026-08-02)

Fixes to `cloud-setup.sh` (#74, #75), plus ADR 0009 recording that guided
environment creation attaches the caller's real routine rather than a throwaway.
The bulk of the version is the `/dispatch` gh-CLI/MCP bridge work that shipped
as 6.24.0.

## v6.23.6 — Wrap-up reflection insights (2026-07-31)

Whole-branch review fixes: repo selection in guided routine creation, `/init`
Step 15's unreachable fresh-project resolution, and environment resolution that
was blind to locally-recorded routines.

## v6.23.5 — Cloud routine environment freshness + per-project dedication (2026-07-31)

Routine environments got freshness handling and per-project dedication, with a
plan amendment covering stale Rolling-digest references and an orphaned module.

## v6.23.4 — Remove the tidy github-triage routine (2026-07-31)

Retired `/tidy`'s `github-triage` routine variant.

## v6.23.3 — journey-health expands `files:` globs before the deleted-file check (refs #73)

Phase 0's stale-selection heuristic ran a literal `fs.existsSync` against each declared
`files:` frontmatter entry, so a glob entry (`docs/research/competitors/*.md`) always
reported "missing" even when it resolved to real files — permanently force-picking that
journey as deleted-file on every firing. `journeyFileExists` now resolves a final-segment
wildcard against the directory listing before falling back to the literal check. A wildcard
outside the final segment stays unsupported and is treated as always-present, rather than
risking a false "missing".

## v6.23.2 — /init Update Mode: Routine Drift & Relevance Audit

- `/claude-tweaks:routine` gains `status --all` (bulk drift check across every instantiated
  routine in the project, including ones whose skill was renamed or retired) and
  `update --defaults` (non-interactive re-sync, for batch-confirmed use).
- `/claude-tweaks:init`'s Update Mode gains two new Phase 1u.5 checks: Routine Drift (stages
  a batch re-sync offer for drifted routines) and Routine Relevance (a new harness-health-
  owned judgment pass, invoked only by `/init`, surfacing routines whose underlying skill has
  changed enough to warrant a second look).

## v6.23.1 — durable-state writes are git-native; code-health's `.` slice no longer sweeps the whole repo

`bin/lib/health-core/durable-state.js`'s `writeState()` shelled out to `gh api` for every
`health-state` branch write; v6.21.0's documented GitHub-MCP fallback for cloud Routine
sandboxes (no `gh` CLI there) was never actually exercised across 12 live firings — one skill
instead improvised an undocumented `git push` workaround that worked cleanly, proving plain git
push credentials are available in that exact sandbox. `writeState` now builds every commit from
plain git plumbing (`hash-object`/`ls-tree`/`mktree`/`commit-tree`) and publishes with a single
`git push`, which both creates and fast-forward-updates the branch — no `gh` CLI, no MCP
dependency, no separate bootstrap step, working identically local or in a cloud sandbox. The
entire now-unexercised MCP-fallback layer (`mcp-pending.js`, `retry-durable-write.js`, and every
`needsMcpWrite` branch across the 4 health CLIs) is deleted.

Separately, `code-health`'s `next-slice` rotation always included `.` as a candidate
representing the *entire* repo root scanned recursively — overlapping every subdirectory and
workspace slice, and, since it always sorted first, always force-picked as the very first slice
on any never-before-swept repo (returning ~4,200 files as "one slice" in the reported case). `.`
now scans direct root-level files only.

## v6.23.0 — /init: new Step 9 (Establish GitHub Remote)

Projects with no git remote configured at all previously had no way for `/init` to help set
one up — every GitHub-gated Optional Enhancement step (issue-form template, cloud/Routine
parity, non-default-branch issue tracking, work-record backend) silently fell back to
degraded or local-only behavior. `/init` now offers a new, interactive-only Step 9
("Establish GitHub Remote"): when no remote exists at all, it can get the `gh` CLI installed
and authenticated, then offer to create a GitHub repository (personal account or an org,
confirmed name, private/public visibility) and link it as `origin` — so the rest of the same
bootstrap run gets the enriched GitHub-backed path instead of falling back. Never runs under
`auto` mode. Required renumbering the existing Optional Enhancement Steps 9-16 to 10-17 across
every skill file that cross-references them.

## v6.22.1 — Tidy two doc nits from the /init argument-handling final review

Standardized on "goal-based Phase scope" throughout `skills/init/SKILL.md` (five pre-existing
spots still said "goal-based scope" after v6.22.0 introduced the more precise term in one
place), and made `bootstrap-steps.md`'s Core Bootstrap Version Check decision bullets re-cite
the `bootstrap`-scope Exception inline instead of relying on the reader to hold it from a few
lines above. Both were left as non-blocking Minor findings by v6.22.0's final whole-branch
review; no behavior change.

## v6.22.0 — /init argument-handling: enhancement filter tokens + bootstrap-state versioning

`/claude-tweaks:init --routines` previously fell silently through to the free-text
"project description" branch, since `--routines` wasn't a recognized scope keyword — Phase 0's
Optional Enhancements (Steps 9-16) were all-or-nothing (`--core-only` or everything), so there
was no way to ask for just one. `/init`'s `## Input` section now recognizes eight Enhancement
filter tokens (one per Optional Enhancement step; `cloud-parity`/`routines` split Steps 13/14
since wanting cloud parity without ever scheduling a Routine is a real, separate case), narrows
Phase 0 to only the named step(s) when present, and composes freely with goal-based Phase
scopes and modifier flags. An unrecognized token now stops and asks instead of silently
guessing (matching the existing `/tidy`/`/capture`/`/version` precedent) rather than being
misread as descriptive text. Separately, a new local `.claude-tweaks/init-state.yml` marker
records the plugin version that last verified Steps 1-8 (Core Bootstrap), letting an
unchanged-version re-run skip that re-verification entirely; a version mismatch instead
re-runs Steps 1-8 and surfaces a filtered summary of `CHANGELOG.md` entries relevant to
`/init`'s own behavior since the recorded version. New `bin/lib/changelog.js` provides the
semver comparison and range-extraction the version check needs.

## v6.21.0 — GitHub-MCP fallback for gh-CLI-only write paths

`bin/lib/health-core/durable-state.js` (the code-health/harness-health/journey-health/docs-health
cursor and retry-queue writer) and `bin/lib/issues/claims.js`'s issue-claim lock both shelled out
to `gh` unconditionally, which fails outright in a Claude Code cloud Routine sandbox — no `gh`
CLI there, only GitHub MCP tools. Since MCP tools can only be invoked from the calling agent's own
turn, never from `durable-state.js`'s spawned Node subprocess, the durable-state writer now
signals a pending write (`needsMcpWrite`) on stderr instead of attempting one, and the calling
skill's own documented procedure (`skills/_shared/health-state.md`) drives the MCP write and CAS
retry loop externally; the issue-claim lock (`skills/_shared/issue-claims.md`) gained an
equivalent MCP claim/release path, including a read-then-branch reclaim so a released claim
doesn't wedge permanently. `/claude-tweaks:dispatch`'s Preflight still hard-gates on `gh` being
installed — its read path (queue pull, dependency checks, contested-claim resolution) isn't
bridged yet, so cloud-Routine dispatch remains future scope. **Known open risk:** the MCP
procedures' branch-bootstrap step (via `create_branch`) has not been verified against a live
GitHub MCP connection — no such connection was available during development — verify before
relying on this in an actual cloud deployment.

## v6.20.1 — Harden local-files Preflight-stop against auto-mode rationalization

`/claude-tweaks:backlog refine`'s grant sub-stage and `/claude-tweaks:dispatch`'s Preflight
already stopped explicitly under `work-backend: local-files`, but a live run against a
realistic, `/claude-tweaks:init`-generated `CLAUDE.md` (one that documents this project's own
auto-mode/hands-off pipeline conventions) found the stop didn't hold — the model ran a full
build-to-close lifecycle on a low-risk-looking record instead. Both Preflight paragraphs
(`skills/_shared/local-files-preflight-stop.md`'s canonical pattern, applied to
`skills/backlog/SKILL.md` and `skills/dispatch/SKILL.md`) now explicitly state the stop is not
superseded by the project's own documented auto-mode conventions elsewhere in CLAUDE.md — those
conventions govern behavior *within* an already-authorized pipeline run, not whether this gate
may authorize new work in the first place. Confirmed via a real re-run: cost dropped from
$17.47/49 tool calls (violation) to $0.37-0.59/0-8 tool calls (compliant, verified with a new
`evals/` scenario fixture that models a realistic onboarded project instead of a bare repo).

## v6.20.0 — Policy schema consolidation

`.claude-tweaks/policy.yml` is now the canonical home for all of claude-tweaks' project-config
levers, indexed in one place at `skills/_shared/policy-schema.md` (mirrored in code by
`bin/lib/policy-schema.js`'s `auditPolicy()`). `/claude-tweaks:init` no longer writes 8
default-valued lever lines into every generated CLAUDE.md — omitting a lever already meant "use
the default," so writing it explicitly was always redundant, and it silently bloated every
project's CLAUDE.md. Existing projects get a one-time cleanup offer via Update Mode; a new
`/claude-tweaks:harness-health` check flags malformed or unrecognized `policy.yml` keys.

## v6.19.0 — Shared record-staleness threshold + bucket predicates

The record-stage and bot-state predicates (`isBacklog`, `isParked`, `isBotBlocked`,
`isBotInProgress`) and the staleness classifier that `/claude-tweaks:help`'s Stage 1 and
`/claude-tweaks:tidy`'s Step 1 each reimplemented independently now live in one place,
`bin/lib/issues/record-buckets.js`. Both scans read the same definitions, so a backlog record
counted stale on the dashboard is the same record `/tidy` recommends acting on.

How old a record must be to count as stale is now project-configurable via a new
`record-staleness-weeks` key (default `4`, documented in `_shared/work-record.md`'s Config keys
table and resolved by `_shared/record-queue-fetch.md`'s Threshold resolution section). The
three-band scale scales with it — `fresh` below half the threshold, `review` up to and including
it, `stale` beyond — so a project with a slower cadence can widen the window without every
consumer drifting apart.

## v6.18.0 — /claude-tweaks:backlog replaces /triage and /review-backlog (2026-07-26)

Two overlapping skills collapsed into one `/claude-tweaks:backlog` with refine
and overview modes. Includes the cross-repo sweep for stale `/demo` references
that the final review surfaced.

## v6.17.0 — /demo single-item scope + pre-flight self-verification

`/claude-tweaks:demo` no longer sweeps the `demo:pending` backlog or renders a batch table — it
resolves exactly one item per invocation (this session's own recall-detected work, or one
explicit `#N`, with a session-recall fallback when a record was never labeled). Discovery of
what's outstanding moves to `/claude-tweaks:help`'s dashboard (Stage 4.7), which now lists every
outstanding `#N` instead of a bare count.

`/demo`'s per-item walkthrough gained a pre-flight self-verification step — resolve a dev server,
confirm the target page actually renders, attempt login if credentials are resolvable — before
ever handing a human a live browser session or manual instructions. The former "Show me live"
option is renamed "See it yourself" and, once pre-flight passes, offers a follow-up choice between
a live session and copy-paste-ready manual steps (self-contained, no inline comments, proactive
about surprising-but-correct states). A once-per-session scope-fork checkpoint and task-anchor
discipline keep a pending verdict from getting silently lost mid-tangent.

## v6.16.3 — Maturity-aware build & specify discipline

Project maturity (greenfield / pre-launch / early-production / established) is now a durable
`project.maturity` value in `.claude-tweaks/policy.yml`, instead of living only as CLAUDE.md
Philosophy prose. `/claude-tweaks:init` writes it the moment Phase 3's Project Classification gate
confirms a value, and re-detects it on every Update Mode pass to catch drift.

`/claude-tweaks:build` folds a maturity-scaled characterization-test instruction into its task
dispatch, and `/claude-tweaks:specify` biases decomposition toward strangler-fig-shaped leaves —
implement-behind-a-flag then remove-the-old-path, or parallel-implementation/cutover/decommission —
when a design doc proposes replacing an existing, in-use subsystem on early-production or
established projects.

## v6.16.1 — Step 13's live branch-mismatch warning (2026-07-25)

`/init` Step 13 warns when the branch it is about to act on isn't the one
expected. The version also carries the journey drift-audit step (record #58) and
the journeys evidence checklist (#57).

## v6.15.0 — Parallel skill-audit fix pass (2026-07-24)

A wide parallel fix pass over the skill set, plus the shared facet-default shape
extracted into `facet-shape.js`.

## v6.14.1 — argument-hint reference card sync (2026-07-23)

`skills/help/reference-card.md` still carried the pre-6.14.0 argument grammar for every
skill. Re-synced all 33 rows against the `argument-hint:` values that had just landed.

## v6.14.0 — `argument-hint` frontmatter on every skill (2026-07-23)

Each `SKILL.md` gained an `argument-hint:` frontmatter field, so typing
`/claude-tweaks:{skill}` shows its argument grammar as greyed-out placeholder text in the
terminal. Purely cosmetic — it has no effect on how `$ARGUMENTS` is parsed. The convention
(derive the hint from the skill's own `## Input` section, always quote the value) is
recorded in CLAUDE.md.

## v6.13.0 — Smoke-test follow-through: dispatch diagnostics, audit-log hardening, grant-time disclosure

A live cross-terminal smoke test of `/capture` → `/specify` → `/triage` → `/dispatch` (real repo,
real GitHub issues, four independently-session'd agents with no shared context) validated the
claim-race concurrency mechanism cleanly, but surfaced a repo config gap (`work-backend` missing
alongside the legacy `backlog-backend` alias) that had made `/claude-tweaks:dispatch` completely
non-functional until discovered by accident, plus a silently-skipped `/claude-tweaks:triage`
audit-log write under `worktree.always`. Both fixed, and hardened: a new harness-health evidence
check catches the legacy-alias-without-replacement config gap proactively, and
`_shared/auto-decision-log.md` now documents a `worktree.always`-safe Bash-append mechanism for
every standalone-auto skill's `decisions.md` write.

Six process optimizations followed from the same analysis: `/claude-tweaks:dispatch --claim-only`
(claim without building, for safely testing or operating the claim mechanism); Preflight now
distinguishes an incomplete `work-backend` migration from a deliberate `local-files` choice and
reports the exact fix; a headless `dispatch next` firing self-files a `by:dispatch` issue on
Preflight failure instead of failing silently with nobody present; `/claude-tweaks:tidy` gained a
backstop for a completed standalone run with an empty `decisions.md`; `grant-check`'s `RATIONALE`
now discloses when a `ceremony:fast-lane` `auto:merge` recommendation means self-review only, not
the full review lens matrix — the actual tradeoff a human granting merge trust is taking, previously
invisible at grant time; `/claude-tweaks:triage`'s batch-confirm gained an explicit "grant
`auto:build` only, hold merge" option for supervising a pipeline's first autonomous run.

## v6.12.1 — Warn-tier hook nudge for plugin.json version bumps (2026-07-22)

Added `checkPluginVersionBump` to `post-tool-use.js` — a warn-tier reminder,
fired on any commit touching the manifest, to mirror the version into the
marketplace repo. v6.41.0 extended the same check to name the changelog, which
it had been silent about since this release (`[IL-94]`). Also added the
`work-backend` key alongside the legacy `backlog-backend` alias, and six process
optimizations from a live cross-terminal smoke test.

## v6.12.0 — Review effort tiering (2026-07-22)

`/claude-tweaks:review` gained a `review-effort` argument, Step 2.5 derivation,
and tier-gated lens dispatch and debate — with unconfirmed and contested
findings surfaced inline at the `xhigh` and `max` tiers.

## v6.11.3 — 256-finding full-plugin code-review remediation (2026-07-21)

The second and larger of two remediation passes over findings from a
full-plugin code review.

## v6.11.2 — 158-finding code-review remediation (2026-07-21)

The first remediation pass, merged in twelve themed batches — hooks/policy,
issues/state, code-health, the health siblings, shared fragments and agent
definitions, the lifecycle skills, component skills, the utility skills, and the
shared criteria fragments.

## v6.11.1 — Wrap-up follow-through on v6.11.0's ceremony tiering

Wrap-up reflection on v6.11.0 found `ceremony:fast-lane`/`ceremony:standard` was never added
to `_shared/label-bootstrap.md`'s canonical `LABELS_JSON` despite `/claude-tweaks:specify`
citing it as the bootstrap source — fixed, along with the resulting label-count drift in
`_shared/work-record.md` and both `/claude-tweaks:init` files. Also fixes two stale
descriptions the original branch's review missed: `/claude-tweaks:flow`'s Relationship-table
row still described `ceremony-check` as its primary caller instead of fallback-only, and
`_shared/multi-agent-coordination.md` — the canonical primitive for Multi-Persona Red-Team —
still documented "3 fixed personas" with no mention of the new ceremony-tiered 1-or-3 count.
Adds ADR 0006 documenting the ceremony-tiering design's two central decisions.

## v6.11.0 — Lifecycle ceremony tiering

`ceremony-check` (the fast-lane/standard verdict introduced in v6.7.0) now runs at
`/claude-tweaks:specify`'s record-creation step instead of waiting until `/claude-tweaks:flow`'s
materialize step — so `/specify`'s own Step 5 Multi-Persona Red-Team can scale with it too
(`fast-lane` leaves get one persona instead of three). The verdict is now an always-explicit
`ceremony:fast-lane`/`ceremony:standard` label, visible everywhere `risk:*`/`effort:*` already
are, instead of a materialize-only header field. `/claude-tweaks:review` gains matching
ceremony-aware step skipping (spec-compliance re-check, cross-spec-promise check, and hindsight
skip under `fast-lane`; the actual code-quality read of the diff never does), and
`/claude-tweaks:review-backlog` surfaces the tier as an advisory column. See
`docs/superpowers/specs/2026-07-20-lifecycle-ceremony-tiering-design.md`.

## v6.10.0 — design-wrapper rename + visual quality boost

`/claude-tweaks:design` is renamed `/claude-tweaks:design-wrapper` (clearer than a bare
"design" for a thin dispatcher around the Impeccable plugin). Three new capabilities close the
"bland UI" gap end to end: `/flow`'s polish phase now auto-dispatches audit's own Anti-Pattern
`suggestion` field instead of only fixed commands; `/visual-review`'s Creative Opportunities gets
a real one-click apply-gate, plus a new opt-in standalone "Boost" step (fix flagged issues, or
explore alternatives via a new `live` mode); and `/specify`'s shape-time flow can now spin up a
throwaway scaffold and hand off to `live` mode for real side-by-side variant comparison before
`/build` ever starts, recorded as a `Visual-reference:` body-metadata line. See
`docs/superpowers/specs/2026-07-19-visual-quality-boost-design.md`.

## v6.9.0 — /demo session-recall fallback

`/claude-tweaks:demo` now aggregates a second, independent source alongside `demo:pending`
records: work done directly in the current conversation with no backing record at all. When
`/demo` finds nothing pending and the session itself did unrecorded implementation/verification
work, it recaps that work in the same Verification Brief shape (composed from recall, not a
diff) and asks for a verdict. Approve/Skip leave no trace — the verdict lives in the
conversation — while Request changes files a real follow-up record, same as it always has for
record-backed items.

## v6.8.0 — The record-driven pipeline, exercised (2026-07-19)

The first release built almost entirely by running the work-record pipeline on
itself: records #13, #14, #15, #17, #21, #22, #32, #38 and #39 were each
materialized, built and closed in turn. Substantive changes include a native
`Blocked-by` dependency check in `/dispatch`, local-file record closure,
`--run` on `record-worktree` (fixing cross-run state corruption), a real
unblock-cascade check in wrap-up Step 8, and feedback-loop metrics for the
pipeline. `/review-backlog` was catalogued.

## v6.7.0 — Fast-lane pipeline profile

A new `ceremony-check` mode on `/claude-tweaks:assess-agent-autonomy` judges once, at materialize time, how much retrospective/documentation ceremony a record's actual content deserves — stored as a `ceremony:` materialized-header field and folded into a new `ceremony-profile` Manifesto lever (10th canonical lever; `unattended-tier` keeps its existing slot 9), letting small, clean records skip proportionate ceremony while a Safety-regression finding still trips an escape hatch back to full depth for the rest of the run.

- **`/claude-tweaks:reflect` light mode** — new `skills/reflect/light-mode.md`: 2 lenses (Near-misses, Fresh start), no tradeoff review. Runs instead of full mode when `config.yml`'s `ceremony-profile` is `fast-lane`.
- **`/claude-tweaks:build` audit skip conditions** — Plan Audit and Architecture Alignment steps skip under `ceremony-profile: fast-lane`, on top of their existing size-based skip conditions.
- **`/claude-tweaks:wrap-up` narrower ceremony** — Step 7's independent skill-curation scan caps at top ~2 instead of top ~5; Step 6's doc/CLAUDE.md/ADR sub-scans gain a mechanical pre-check gate that skips all three when the diff touches no registry-matched path, no new dependency, and no schema/config file.
- **Escape hatch** — a Safety-regression finding during light-mode reflect downgrades `config.yml`'s `ceremony-profile` to `standard` for the remainder of the run, falling back to full-depth ceremony.

See `docs/superpowers/specs/2026-07-15-fast-lane-pipeline-profile-design.md` for the full design.

## v6.6.0 — Docs-health expansion + wrap-up integration + genre templates

Extends `/claude-tweaks:docs-health` with three new/strengthened judging dimensions, two new CLI subcommands, an inline integration into `/claude-tweaks:wrap-up`, and a unified template library backing missing-doc scaffolding.

- **Three new/strengthened docs-health dimensions** — findability (is the doc discoverable/linked from where a reader would look, repo-scoped), placement-fit (does the doc live in the genre-appropriate location), and freshness-dependencies (does the doc's frontmatter track the source files it depends on, so drift can be detected) — added to `_shared/criteria-docs-diataxis.md`'s JUDGE procedure alongside the existing genre-drift, depth-mismatch, and dual-persona misleading-risk checks.
- **Two new CLI subcommands** — `find-refs <path> [--root <dir>]` (repo-scoped reference/backlink lookup backing the findability check) and `check-freshness <path> [--root <dir>]` (frontmatter-declared source-dependency staleness check) added to `bin/docs-health.js`.
- **`/claude-tweaks:wrap-up` docs-health integration** — new `skills/wrap-up/docs-health-integration.md`, loaded by Step 6.1: D1 applies the full docs-health JUDGE procedure inline to every doc this work's diff touched (additive findings fold into the Configuration Updates batch table; restructural findings file as `by:docs-health` GitHub issues through the same dedup/filing CLI machinery `/claude-tweaks:docs-health` itself uses), and D2 detects documentation this work should have produced but didn't, scaffolding new docs from the genre template library.
- **Unified 6-genre template library** — new `skills/_shared/diataxis-genre-templates.md` is now the single source of truth for all six doc genres `/claude-tweaks:docs-health` recognizes: the four core Diátaxis genres (Tutorial, How-To, Reference, Explanation — new) plus the two native-exempt genres it already judged, ADR and Journey, whose canonical skeletons migrated here from `_shared/decision-records.md` and `journeys/journey-template.md` (which now point here instead of duplicating the literal skeleton). Consumed by `/claude-tweaks:init` Phase 8.5's missing-doc backlog items and `/claude-tweaks:wrap-up`'s D2 missing-doc detection.
- `/claude-tweaks:wrap-up` Step 9/10 templates gained a `docs-health-issue` config-update type and two new Step 10 execution bullets (new-doc scaffolding from the template library, restructural docs-health filing) so approved docs-health findings from the Console/batch have somewhere to land.

### Demo walkthrough redesign — branch-numbered v6.5.0

`/claude-tweaks:demo`'s Verification Brief is now a self-contained digest instead of a pointer to
re-run another skill — vision/why, what shipped, and confirmed evidence (visual-review's result +
up to 3 committed screenshots, or a code-review digest + diff for non-UI work). `/wrap-up` gains a
safety-net gate that triggers a real visual-review pass before `demo:pending` is ever applied, for
the one path (`/review` outside `full` mode) where one might not have already run.
`/claude-tweaks:demo`'s verdict prompt reframes around vision/fit ("Does this do what you asked
for?") and gains an on-demand "Show me live" option for a live look via `agent-browser`.

## v6.4.0 — Unattended tier: fewer clicks in `auto` mode

A new opt-in policy lever, `unattended-tier` (off by default), lets three narrow, low-stakes
decision points — floor-clearing ledger residue, queue-write record creation, and ops-item
acknowledgment — resolve without a live click, everywhere `auto`/`hybrid` mode runs (headless
`/claude-tweaks:dispatch` firings or local `/claude-tweaks:flow` runs alike). Every action is
still logged to `decisions.md` and rolled into one consolidated push notification; HARD-GATEs,
merge conflicts, and every `Fix anyway`/`Accept`/`Drop` ledger disposition stay fully
human-gated regardless of the lever's state. See `skills/_shared/unattended-tier.md`.

### Human acceptance sign-off (`/claude-tweaks:demo`) — branch-numbered v6.3.0

A new seventh work-record axis (`demo:pending` / `demo:approved` / `demo:changes-requested`)
closes the gap between tests passing, spec completion, and an actual human verifying a built
feature does what was asked. `/claude-tweaks:wrap-up` applies `demo:pending` and writes a
Verification Brief (what changed, why, how to verify) while it still has full build context;
the new `/claude-tweaks:demo` skill aggregates every pending record — across parallel threads,
regardless of merge timing — and captures your verdict.

## v6.1.0 — assess-agent-autonomy, and one digest transport (2026-07-15)

- A new `/claude-tweaks:assess-agent-autonomy` skill brings content-aware judgment to
  `/triage` and `/dispatch`, replacing `tier.js`'s `recommendGrants`/`recommendTier` and the
  legacy label adapters, which were retired in the same release (skill catalog 29 → 30).
- The per-skill digest formats were unified into one transport, and the auto-merge-gate and
  failure-revocation prose was reconciled across the canonical contracts, which had drifted
  apart between `_shared/` and the skills quoting them.
- `merge-sensitive-paths` documented, and `harness-health`'s triage description corrected.

## v6.0.0 — The unified work record

Every captured idea, health-skill finding, and human-filed issue is now the same thing: **one durable work record** (a GitHub issue, or its `local-files` twin — a plain markdown file), tracked through a single spine instead of the old two-file backlog design and per-artifact frontmatter:

```
BACKLOG ──/specify shapes──► READY ──human grants──► AUTHORIZED ──/dispatch claims──► BUILDING ──user merges──► CLOSED
```

with `parked` (on hold, wakes on a trigger) and not-planned (wontfix/duplicate/absorbed) exits at any stage. Two storage drivers back the same taxonomy — `work-backend: github-issues` (labels + native Issue Types) or `work-backend: local-files` (frontmatter on a tracked file) — set once by `/init`, read identically by every consumer skill. See "Work Records" in README.md and `skills/_shared/work-record.md` for the full contract.

Human-granted `auto:build`/`auto:merge` labels replace the retired `tier:approved`/`tier:fast-track`/`tier:needs-review` three-way split — `/claude-tweaks:triage` is now the interactive grant gate only. A new skill, **`/claude-tweaks:dispatch`**, is the queue consumer: it claims an authorized record's whole file-overlap group and hands it to `/flow` — the `triage dispatch` headless subcommand no longer exists.

`/claude-tweaks:specify` and `/claude-tweaks:build`/`/flow` now **materialize** a record reference (`#N`) into a build-time header + spec-shaped body file rather than requiring a pre-existing numbered spec file — the legacy `specs/{n}-*.md` path still works as an alias for projects that haven't migrated. `/claude-tweaks:tidy` and `/claude-tweaks:help` scan the live record queue directly; the former INBOX scan, Deferred-Work scan, and the separate spec index they used to read are retired.

See "Migrating from 5.x" in README.md if a project still carries pre-6.0 state (live `tier:*`/`status:*` labels, `specs/backlog/` files, or the old `backlog-backend` flag name).

## v5.29.0 — The unified work record, in progress (2026-07-13)

Ninety-one commits building the unified work record that GA'd as 6.0.0:
consolidating user-facing docs onto the single record, regenerating the
lifecycle diagram around the spine, six axes, grants and dispatch, and deleting
the compatibility module once it had no callers.

## v5.28.0 — Routine setup friction reduction, planned (2026-07-13)

The implementation plan for reducing routine setup friction in `/init` and
`/routine`.

## v5.27.2 — Routine setup friction reduced (2026-07-12)

`/routine`'s CREATE flow collapsed its review gate into one preview+confirm with
a `--defaults` skip path, resolved the environment silently, cut the cadence
picker to four options, and moved the picker behind an explicit Customize
choice — the front-door-confirm pattern that is now house style. `/init`
Step 13 batches routine setup into a single multiSelect picklist.

## v5.27.1 — Document the upstream worktree/resume limitation (2026-07-12)

Recorded that a session vanishing from `claude --resume` after entering a
worktree is an upstream limitation, not a plugin bug. The version also carries
the GitHub-issues consistency pass: a reopen branch in dedup, harness-health
tiering via a kind-adapter chain, the gh-availability Detection Ladder wired
into `/triage`, `/wrap-up` and the multi-spec console, and the 4x-duplicated
label bootstrap loop extracted into `_shared/label-bootstrap.md`.

## v5.27.0 — Native diagram generation replaces the Diagram Design companion

**`/claude-tweaks:visualize`** replaces the external `diagram-design` companion-plugin integration introduced in v4.7 with a fully native skill — no separate plugin install. It generates self-contained HTML+SVG diagrams (architecture, flowchart, sequence, state, ER, timeline, swimlane, quadrant, nested, tree, org chart, layers, venn, pyramid), themed from the project's own `DESIGN.md` tokens (or a neutral default skin when Impeccable isn't set up). An optional D2-backed enhanced rendering path handles diagrams-as-code source generation for types with a native D2 construct. The same three soft-hook call sites — `/journeys` Step 3.6, `/specify` Step 2.5d, `/review` Lens 3i-diagram — now suggest invoking it directly, gated by `diagram-suggestions: enabled` in CLAUDE.md (renamed from `diagram-integration:`), written by `/init` Step 11. Diagrams co-locate with what they illustrate (`docs/journeys/`, `docs/plans/`) rather than a single central folder; `docs/diagrams/` is the fallback for context-free, direct invocations.

## v5.26.0 — journey-health deep-tier cursor fix (2026-07-11)

Fixed deep-tier cursor advancement on the QA-satisfied path.

## v5.25.1 — watchman-core extraction (2026-07-11)

The cache, run-log, fingerprint and dedup primitives that code-health,
harness-health and journey-health had each implemented separately were extracted
into a shared `watchman-core` and all three refactored onto it. journey-health
also gained a severity field, a deletion force-select phase, and a QA-evidence
module for its deep tier.

## v5.25.0 — Fix a stale reviewer description in build-options.md (2026-07-11)

`subagent-driven-development`'s reviewer description had drifted.

## v5.24.0 — /claude-tweaks:triage and the status lifecycle (2026-07-11)

Sixty commits. The scheduled headless routine moved out of `/flow`, leaving
`/flow` a pure executor, and landed in a new `/claude-tweaks:triage` skill —
bare for interactive authorization, `dispatch` for headless. Adds the unified
`status:*` tier lifecycle, a fast-track auto-merge short-circuit in the Review
Console (with a main-checkout branch check before it merges), retry-ceiling
comment tracking, and pending-authorization/blocked/auto-merged counts on
`/help`'s dashboard. `journey-health` shipped here too — CLI, scope selection,
light and deep tiers, coverage scan and routine template — and harness-health
became report-only, dropping its auto-apply path.

## v5.23.0 — Impeccable design-plugin integration batch (2026-07-09)

Score trend, harness-health design artifacts, a `/tidy` extract recommendation,
and a CLI schema-drift fix. Also `/routine --variant` for multi-instance
routines, `/tidy --scope` for partial sweeps, and `/init` Step 13 discovering
template variants rather than only skills.

## v5.22.0 — Renumbered from 5.21.0 after a collision (2026-07-09)

A concurrent session claimed 5.21.0 first, so the harness-health v2
budget/memory work was renumbered onto 5.22.0 — one of the collisions that
`[IL-12]` came from.

## v5.21.0 — harness-health memory-kind (2026-07-09)

Version bump and doc sync for the memory-kind feature.

## v5.20.0 — harness-health v2 + GitHub-issues backlog backend, Phase 2 (2026-07-08)

harness-health v2: self-declared tiered budgets, unscoped-rule structural
detection, a self-referential count check, a narrative-density heuristic, and
local-only memory health via `--kind memory --memory-dir`. Alongside it,
`/claude-tweaks:capture` and `/claude-tweaks:tidy` became backend-aware, filing
and sweeping GitHub issues under `backlog-backend: github-issues`.

## v5.19.1 — /init Step 15 (backlog-backend flag) (2026-07-08)

Added the backend flag and set it on this repo, added
`bin/lib/issues/backlog.js`, reworked the label taxonomy, and fixed a
GitHub Enterprise false negative in three `github.com` string-match checks.

## v5.19.0 — Browser backend policy + isolation guardrail (2026-07-08)

Established `agent-browser` as the only backend that works both interactively
and in hosted Routines, with a narrow `claude-in-chrome` escape hatch in
`/browse` and a CLAUDE.md guardrail against calling it directly.

## v5.18.0 — shadcn/ui bootstrap + Phase 0 step renumbering

`/init` gains a new Optional Enhancement step: on a detected frontend project without `components.json`, it offers to bootstrap [shadcn/ui](https://ui.shadcn.com/) — CLI init, plus wiring shadcn's own first-party MCP server into `.mcp.json` and installing shadcn's official Skill (`skills add shadcn/ui`), both of which give Claude Code live project context so it stops guessing at component APIs. Writes a `shadcn-integration: enabled | cli-only | disabled` flag to CLAUDE.md's `## Design integration` section (currently write-only — no other skill reads it yet). See `/init` Step 12.

Also folded in: Phase 0's internal step numbering (previously `Step 0.1`–`Step 0.97`, an ad-hoc decimal scheme approaching its practical ceiling) is now two clean sequential groups — Core Bootstrap (Steps 1–8) and Optional Enhancements (Steps 9–14, order-agnostic and append-only). Every cross-reference in README and the plugin's skill files was updated to match.

## v5.17.1 — Close three gaps from another project's process-feedback audit (2026-07-08)

Three gaps surfaced by running the plugin's own feedback audit from a different
project.

## v5.17.0 — Impeccable re-baseline + automatic hook integration (2026-07-08)

Re-baselined the Impeccable docs and wired its hook integration to happen
automatically.

## v5.16.0 — AskUserQuestion adoption (2026-07-08)

Version bump for adopting `AskUserQuestion` at the plugin's interaction points —
the decision surface every skill now uses.

## v5.15.0 — code-health: risk-based triage + closing-keyword safety net

`/claude-tweaks:recon` is renamed to `/claude-tweaks:code-health` (bare rename, no migration shim — the fingerprint-marker convention this rename introduced has since been unified into the single `work-fingerprint` marker every filing skill writes; see `skills/_shared/work-record.md`'s Fingerprint marker section). Findings now carry a `likelihood` and `effort` alongside `severity`; a new deterministic helper (`bin/lib/code-health/risk.js`) computes a `risk` tier (`severity × likelihood`, product-bucketed) the same way `dedup.js#decide()` already computes decisions — never LLM-judged. GitHub labels move from `code-health:{severity}` to `code-health:risk-{tier}` + `code-health:effort-{tier}` (criterion labels are kept, now with real descriptions); filing and CI gates move from `--min-severity`/`--fail-on critical` to `--min-risk`/`--fail-on risk-high`. Downstream, `/build` reads the `code-health-effort:` frontmatter to pick its implementer's model tier. (The `/flow --from-code-health`/`--quick-wins` batch-selection flags described here at v5.15.0 were later removed — issue selection and dispatch now live in `/claude-tweaks:triage` (grants authorization) and `/claude-tweaks:dispatch` (claims and executes); `/flow` itself never selects records.) Separately, a new harness-wide PostToolUse hook (warn tier, not gated on a resolved pipeline run) flags any commit that references a bare `#N` issue number without an immediately-preceding GitHub closing keyword — catching ad hoc fix commits that would otherwise silently leave the issue open.

## v5.14.0 — Commit-time closing-keyword safety net (2026-07-07)

A warn-tier `post-tool-use` hook that fires when a commit lands without an issue
closing keyword, anchored to avoid a false negative on comma-separated
multi-issue commits. The version also adds the `--quick-wins` selector
(`risk:high` AND `effort:low`), stamps `code-health-effort` onto derived specs,
and reads it in `/build` to pick the implementer model tier.

## v5.13.0 — recon renamed to code-health (2026-07-07)

Completed the `/recon` -> `/claude-tweaks:code-health` rename, including 17
files the original pass's literal-token grep missed — the incident behind
`[IL-21]`. Also drops `severity:critical` in favour of a deterministic
severity x likelihood risk matrix, and normalizes `med` to `medium`.

## v5.12.0 — skill-health generalized into harness-health (2026-07-07)

`/claude-tweaks:skill-health` became `/claude-tweaks:harness-health`, widening
its scope from `.claude/skills/*.md` to rules and CLAUDE.md as well, with
`--target`/`--kind` flags and a unified target pool.

## v5.11.0 — Always-worktree enforcement (2026-07-06)

The `worktree.always` policy landed: a run-independent PreToolUse gate requiring
an isolated worktree before any edit. This repo has run under it since.

## v5.10.0 — Fix silent GitHub issue-closure gaps (2026-07-06)

Issues that should have closed on merge were silently staying open.

## v5.9.0 — code-health signal-quality and granularity hardening (2026-07-06)

Workspace-aware slicing, a severity filter that files only high and critical by
default, `relatedAnchors` rendered as an "Also affects" list, a hard fail when
`validate-findings` runs without `--slice`, and a bundling rule for recurring
root-cause findings.

## v5.8.0 — Severity-filter validation (2026-07-05)

`pull-issues --min-severity` is validated against known severities, so a typo
can no longer silently disable the filter and suppress critical findings.

## v5.7.0 — The dispatch phase, documented across consumers (2026-07-04)

Issue-claims Phases 2-4 wrapped up: `agent:go` removal wired through,
unattended-console semantics, decline handling, and a statusline fallback to the
actual cwd so the project segment is never dropped.

## v5.6.0 — The issue dispatcher (2026-07-04)

A `/flow` routine template with the `agent:go`/`agent:eligible` lifecycle, a
`--from-milestone` selector, a `--require-eligible` gate, and a `requireLabels`
AND-filter — labels as maintainer signatures for dispatch authorization.

## v5.5.0 — Generic issue ingestion, documented across consumers (2026-07-04)

Wires translation staging and the current-branch carrier end to end.

## v5.4.0 — Generic issue ingestion (2026-07-04)

`issuesToBriefs` with shape detection, three selectors (`--from-label`,
`--from-issues`, `--from-milestone`) with `--from-recon` as an alias, a
GitHub issue form template offered at `/init` so human-filed issues arrive
pipeline-ready, and the current-branch closing carrier.

## v5.3.0 — Close issues via merge keywords (2026-07-04)

Issue closure moved from explicit close commands to `Fixes` lines riding the
merge artifact, with a mapping table surfaced at the Review Console,
ownership-checked claim releases, and blocked-checkpoint comments as resumable
breadcrumbs on claimed issues.

## v5.2.0 — The issue-claims contract (2026-07-04)

An atomic `refs/claims` lock with a comment mirror, TTL staleness folding that
fails closed on unreadable claims, and a stale-claim sweep in `/tidy` Step 4.7.
`parseClaimMarker` was hardened so a derived kind wins over marker JSON rather
than trusting it.

## v5.1.1 — /claude-tweaks:routine (2026-07-04)

The routine skill arrived with CREATE, UPDATE and STATUS workflows, backed by
`routine-template-schema` — the canonical schema for plugin templates and
project records — with code-health as its first consumer. Also scopes E1
enforcement to the owning session, fixing a foreign-session false deny.

## v5.1.0 — Hook surface: pipeline continuity + working-directory enforcement

A dispatcher-based hook surface (`bin/hooks.js`, registered via `hooks/hooks.json`) adds two things with no skill-level opt-in required:

- **Pipeline-run continuity across sessions and compaction** — SessionStart/SessionEnd/PreCompact hooks track the active pipeline run and re-surface it after a session restart or context compaction.
- **Mechanical working-directory enforcement during worktree runs** — PreToolUse/PostToolUse/SubagentStop hooks deny commits that land in the wrong checkout (scoped since v5.1.1 to the session that owns the run — commits from other sessions are allowed with a warning), log commit breadcrumbs, and flag Subagent Contract status-line violations.

Near-inert outside pipeline runs: SessionStart's dependency check always runs regardless of a resolved run directory, and each matched git command pays a ~30ms no-op spawn to check for one. With no run directory, there is no state to write or enforce — except three deliberate, run-independent exceptions added since this hook surface first shipped: a PostToolUse check warns (non-blocking) whenever a commit references a bare issue number without a recognized GitHub closing keyword immediately before it, since that gap matters most for ad hoc fix commits made outside any pipeline run; the `worktree.always` PreToolUse policy gate blocks Edit/Write/NotebookEdit/commit outside an isolated worktree, since its job is to require one even before any pipeline run exists; and a PostToolUse check warns on any write to a `docs/superpowers/specs/*-design.md` brainstorming artifact, since a session that hasn't reached `/specify` yet has no pipeline run to gate on either. See CLAUDE.md Conventions → Hooks for the full contract.

## v5.0.0 — Code-health v2: LLM-as-judge + scheduled Routine

Code-health v2 replaces the v1 mechanical-lens spine with an LLM-as-judge model: the LLM evaluates the repo against a criteria catalog, calling deterministic tool checks as evidence. Area-type routing, content-hash skip, hotspot priority, fingerprinting, and dedup are handled by deterministic helpers. The v1 subagent dance and `plan-judgment` / `ingest-judgment` phases are removed. Code-health now runs as a scheduled Routine for continuous, hands-off coverage — no manual invocation needed.

## v4.20.0 — /recon: an LLM-as-code-judge scheduled Routine (2026-06-15)

The largest release of the 4.x line. `/recon` — later renamed
`/claude-tweaks:code-health` — arrived as a proactive repo-improvement finder
built on an LLM judge with deterministic scaffolding around it: an area-type
classifier, a universal and domain criteria catalog (resilience, observability,
security-logic, scalability, a11y, i18n, api-stability, migration-safety,
iac-security, privacy-pii, concurrency), fingerprinting and dedup, a
confidence-floor gate, and issue-payload rendering. Mid-version the whole spine
was rewritten from v1 to v2: plan-judgment, ingest-judgment and the mechanical
lens were removed in favour of SCOPE -> JUDGE -> validate-findings -> file, with
content-hash scope rotation and a `next-slice` CLI.

## v4.17.0 — Pocock-inspired discipline skills (2026-06-14)

Added systematic debugging, ADRs, `/claude-tweaks:deepen`, and a depth survey
in `/flow`. Also documented the two-repo release process in CLAUDE.md — the
`Versioning` section that this release note's own convention now extends.

## v4.15.0 — Research delegates to the built-in /deep-research

`/claude-tweaks:research` no longer ships a vendored Python engine. It now delegates to Claude Code's built-in `/deep-research` Dynamic Workflow when available, and falls back to a lean inline model-driven method otherwise.

- **Removed** the vendored `skills/research/scripts/` (10 Python modules), `schemas/`, `templates/`, the Python `tests/`, `requirements.txt`, `UPSTREAM.md`, and `LICENSE-UPSTREAM` — ~6,800 lines.
- **`skills/research/SKILL.md`** rewritten: availability pre-check → delegate to `/deep-research` → inline fallback → write `report.md` + `sources.json` under `.claude-tweaks/research/`. Adds an "Enabling the built-in path" setup note and a Component-Skill Contract.
- **`skills/research/reference/methodology.md`** rewritten as the lean inline fallback (decompose → parallel `WebSearch`/`WebFetch` → adversarial-verify subagents → synthesize) with the salvaged citation-discipline rules.
- **Regressions accepted:** HTML/PDF report generation, deterministic Python citation/DOI validation, continuation/resume state, and source-credibility scoring are dropped. Citation validation is now a model self-check; output is markdown + `sources.json`.
- The built-in path requires Claude Code ≥ 2.1.154 with Dynamic Workflows enabled (Pro: enable via `/config`). When unavailable, the inline fallback runs automatically.

## v4.14.0 — Remove the bash-output filter + savings meter

The v4.2 "token-saver" — a `PostToolUse[Bash]` hook that compacted noisy command output and a statusline `saved: ↓Nk` meter that reported the reclaimed tokens — has been removed. The observed savings never justified the surface area, and the harness already manages context.

- **Deleted** `bin/filter-bash-output.js` (the parser), `bin/lib/jsonl.js` and `bin/lib/paths.js` (telemetry plumbing used only by the filter and the savings meter), and `tests/filter-bash-output.test.js`.
- **`hooks/hooks.json`** drops the `PostToolUse[Bash]` block. Only the `SessionStart` dependency check remains.
- **Statusline** loses `renderSavings`/`formatK` and the `saved:` segment. Everything else (project, model, `ctx:`, effort, git, rate limits, active spec, open-ledger count) is unchanged.
- No migration needed. Stale `~/.claude-tweaks/logs/` files (raw bash logs + `filter.jsonl`) are now inert and can be deleted by hand.
- The **Subagent Contract** (clean-room input, Templates A/B/C, model-tier selection) is unaffected — it's dispatch discipline, not part of the filter.

## v4.13.1 — Fix a stale research SKILL.md test (2026-06-13)

`Next Actions` had moved from `###` to `##` and the test still asserted the old
level.

## v4.13.0 — Filter compaction + universal Working Approach

Two additions, both folded in together: smarter bash-output compaction, and a standard task-execution guardrail block in every generated CLAUDE.md.

- **Bash filter now groups, not just clips.** `compactExcerpt` gained three shape-aware modes ahead of the old head/tail clip: file listings (git status / ls / find) collapse into a **by-directory histogram**, lint findings (ruff / flake8 / pylint / clippy / eslint stylish) collapse into a **by-rule histogram**, and identical adjacent runs **dedupe** into `line  (×N)`. Grouping only triggers when a clear majority of lines match the expected shape (ratio gates: 0.6 for paths, 0.5 for rules, min 8 lines) — otherwise it falls back to dedupe + clip, so prose output is never mangled. A new `Test summary:` section surfaces aggregate test-runner result lines (cargo `test result:`, jest `Tests:`/`Test Suites:`, pytest `N passed … in`, mocha `N passing`) that dedupe/clip would otherwise bury under per-test noise. New unit coverage for `dedupeLines`, `testSummaryLines`, `groupByDirectory`, `groupByRule`, and the `summarize` integration paths.
- **`/init` emits a `## Working Approach` block.** Every generated CLAUDE.md now carries a standard, non-adaptive block of universal task-execution guardrails — think-before-coding, simplicity-first, surgical-changes, goal-driven, read-before-write, checkpoint-multi-step, fail-loud — so ad-hoc work outside the pipeline (where no skill gate fires) gets the same discipline the lifecycle skills enforce. It complements the maturity-adaptive Philosophy section rather than repeating it, and **deliberately omits a token-budget rule** (context management is the harness's job; `_shared/auto-mode-contract.md` forbids the model from inserting context-window stop prompts).

## v4.12.0 — wrap-up generates skill candidates (2026-06-04)

`/claude-tweaks:wrap-up` began proposing skill candidates rather than only
filtering ones already tagged.

## v4.11.0 — Ephemeral worktree dev server for visual review (2026-05-25)

In `auto` mode, visual review starts its own throwaway dev server in the
worktree instead of requiring one to be running.

## v4.10.0 — Worktree base ref fix; one worktree per multi-spec flow (2026-05-25)

Corrected which ref a worktree branches from, and made a multi-spec `/flow`
share a single worktree across its specs instead of one each.

## v4.9.0 — Spec-committed pre-flight gate (2026-05-24)

`/flow` gained a pre-flight gate requiring the spec to be committed, and
`/claude-tweaks:specify` became terminal at its commit.

## v4.8.0 — /flow defaults to auto with an FYI Manifesto (2026-05-24)

`/flow` defaulted to `auto`, showing the Pipeline Config Manifesto as
information rather than a prompt, with a confirm gate ahead of it.

## v4.7.1 — Statusline ledger fix

- **Statusline `ledger` segment now sums open rows across *all* `-ledger.md` files in the current checkout's `docs/plans`**, instead of reading only the most-recently-modified file. The old "newest file wins" logic both undercounted (open items in older ledgers were invisible) and relied on mtimes that are unreliable right after a worktree checkout. Worktree isolation is preserved — the scan is relative to the session's `cwd`, so side-by-side worktrees never see each other's uncommitted ledgers. Added `findOpenLedger` test coverage (previously none).

## v4.7.0 — Deep web research + Diagram Design companion

`/claude-tweaks:research` was built by vendoring
`199-biotechnologies/claude-deep-research-skill` at `f2f2c0f`, kept with its
`UPSTREAM.md` and upstream licence, with output paths repatched to
`.claude-tweaks/research/`.

**`/claude-tweaks:research`** adds citation-audited deep web research to the plugin. Four runtime modes trade depth for time:

- **quick** (~2-5 min, 5+ sources) — fast scan
- **standard** (~5-10 min, 10+ sources) — balanced default
- **deep** (~10-20 min, 15+ sources) — comprehensive synthesis with broader source pool
- **ultradeep** (~20-45 min) — multi-persona red-team with adversarial review

As of v4.15.0 this delegates to Claude Code's built-in `/deep-research` Dynamic Workflow when available, with a lean inline fallback otherwise. Reports land under `.claude-tweaks/research/`.

**`/claude-tweaks:visualize`** — native diagram generation, replacing the former `diagram-design` companion-plugin integration. Generates self-contained HTML+SVG diagrams (architecture, flowchart, sequence, state, ER, timeline, swimlane, quadrant, nested, tree, org chart, layers, venn, pyramid), themed from the project's own `DESIGN.md` tokens (or a neutral default skin when Impeccable isn't set up), with an optional D2-backed enhanced rendering path. Soft-hook nudges in `/journeys` Step 3.6, `/specify` Step 2.5d, and `/review` Lens 3i-diagram suggest invoking it — gated by `diagram-suggestions: enabled` in CLAUDE.md, written by `/init` Step 11. Diagrams co-locate with what they illustrate (`docs/journeys/`, `docs/plans/`) rather than a single central folder; `docs/diagrams/` is the fallback for context-free, direct invocations.

## v4.6.4 — Multi-spec ordering, conflict detection, keep-going (2026-05-16)

Multi-spec runs gained ordering, conflict detection between specs, and a
keep-going posture on failure.

## v4.6.3 — Consolidated multi-spec Review Console (2026-05-16)

One Review Console for a whole multi-spec run rather than one per spec.

## v4.6.2 — Manifesto UX: pipeline preview + inline options (2026-05-15)

The Pipeline Config Manifesto gained a preview of what would run, with options
inline.

## v4.6.1 — Lazy-load entry points + /init contract-drift check (2026-05-15)

Entry points became lazy-loaded, and `/init` gained a check for drift against
the pipeline contract.

## v4.6.0 — Bookend Architecture + Auto-Mode Contract

The pipeline now has at most **two user-facing stops in `auto` mode**, regardless of how many decisions it makes:

- **Pipeline Config Manifesto** at the start (`/flow` Step 3) — one structured table pre-fills every policy lever (scope-creep, overlap, design-intent, leftover-routing, auto-fix-threshold, review-severity-floor, tidy-aggressiveness) with recommended defaults. Hit "Approve all recommendations" or override specific items.
- **Wrap-Up Review Console** at the end (`/wrap-up` Step 8.6) — one consolidated batch surfacing every auto-decided item, every staged item, skill updates, and config changes. Hit "Approve all" or override specific items.
- **Mid-flow** — pure automation. Every decision is logged to `.claude-tweaks/pipelines/{run-id}/decisions.md` with status (AUTO / STAGED / KEPT-PROMPT), rationale, and reversibility. The Review Console reads this log.

New shared files:
- `skills/_shared/auto-mode-contract.md` — single source of truth for what `auto` silences AND what it does not (ledger resolve Phase 2, INBOX/DEFERRED writes, `/challenge` lenses, governance gates, HARD-GATEs). Defines reversibility/confidence/severity floors and decision precedence.
- `skills/_shared/auto-decision-log.md` — audit-trail spec. Every auto-resolution logs a one-liner. The user reviews the log at wrap-up rather than upfront.

Per-pipeline state lives in `.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/` (config.yml + decisions.md + staged/) — collision-safe for parallel agents in the same checkout.

Per-skill rewrites: `/review` Step 3g (severity-based routing), `/tidy` (aggressiveness-based routing), `/init` Phase 3 (confidence-gated), `/build` Common Step 1.5 (scope-creep policy), `/specify` Step 1 + 2.5b + 2.5c (overlap + shape + design-intent policies), `/stories` Step 1 + 6 (legacy + journey-link auto), `/test` Step 3 (auto-fix-threshold), `/visual-review` Step 1 + 2 (auto-skip + log), `/capture` (`--route` arg), `/reflect` Step 3 (auto-route safety findings + stage rest), `/wrap-up` Step 4 + 7.5 (policy lookup + stage).

**Strict rule:** skills MUST NOT invent new mid-flow stops in `auto`. Mid-flow stops are reserved for HARD-GATEs and the explicit "not silenced" list.

## v4.5.2 — Pipeline contract: 2-tier taxonomy, shape gate, auto-mode (2026-05-03)

The pipeline contract took its two-tier taxonomy, a shape gate, and auto-mode
handling.

## v4.5.1 — Fix Impeccable install instructions; namespace slash commands (2026-05-03)

Corrected the Impeccable install instructions and namespaced every slash-command
reference.

## v4.5.0 — Impeccable Integration

Phases 1 and 2 were published as their own builds — `4.5.0-phase1` and
`4.5.0-phase2` — before Phase 3 and GA landed under 4.5.0 itself. Those are the
only two versions this plugin has ever shipped that are not plain `X.Y.Z`, and
they cannot carry their own heading here: the changelog parser requires a strict
three-component version, so `bin/lib/changelog.js` treats a prerelease build as
covered by its base version's entry.

Three-phase rollout of the `/claude-tweaks:design` wrapper for the [Impeccable](https://github.com/pbakaus/impeccable) frontend-design plugin:

- **Phase 1** — wrapper skeleton + read-only integration. The `/claude-tweaks:design` skill exposes 6 mode signatures; `test` (CLI gate) and `review` (advisory critique + audit) are active. `/init` Step 0.9 walks the user through Impeccable plugin install, CLI install, and `/impeccable teach` setup. `/test` Step 1.5 is the deterministic CLI gate; `/review` Step 6.5 surfaces "Design Quality" findings advisorily.
- **Phase 2** — code-modifying integration. `/build` Common Step 1.7 lazy-loads Impeccable reference files into the implementer subagent's context (`pre-build` mode). `/specify` accepts polymorphic input (topic name → invokes `/superpowers:brainstorming`; design doc path → existing behavior), runs the Impeccable `shape` pre-step on frontend design docs, asks the design-intent question, and writes `surface:` + `design-intent:` frontmatter on every generated spec. `/flow` adds a `polish` phase between review and wrap-up that dispatches Impeccable's auto-fit + issue-driven commands; a re-verify gate (`/test skip-qa`, one-cycle cap) catches polish-broke-verification cases. New `no-polish` flag on `/flow` and `skip-qa` flag on `/test` are the user-facing controls.
- **Phase 3** — creative surfacing system. Intent-driven dispatch lights up in `polish` mode (reads `design-intent:` frontmatter and dispatches `bolder`, `quieter`, `distill`, `delight`+`animate`, `onboard` per the value). The `survey` mode goes active and produces ranked Creative Opportunities recommendations rendered as **three independent anchors** so creative commands cannot get buried:
  - **Anchor 1 — `polish` mode intent dispatch.** Auto-runs the matching creative command(s) when intent is declared (no decline tracking — explicit frontmatter is consent).
  - **Anchor 2 — `/visual-review` Creative Opportunities block.** Survey runs against captured screenshots; recommendations rendered after the findings table. Read-only.
  - **Anchor 3 — `/flow` pipeline summary Creative Opportunities block.** Survey runs against the full diff; recommendations rendered before Next Actions. Read-only. Decline tracking suppresses recommendations the user repeatedly ignored (2-decline threshold; reset via `/claude-tweaks:design reset-recommendations <spec>`).

The manual-only commands (`colorize`, `extract`, `overdrive`) are surfaced via `survey` recommendations only — they remain user-invoked to avoid creative drift. All v4.5 changes are gated by Phase 1's 3-layer detection — non-frontend specs and projects without Impeccable installed skip cleanly. The integration is opt-in via `/init` Step 0.9.

**Caches written by the wrapper** live alongside the open items ledger at `docs/plans/YYYY-MM-DD-{feature}-{audit|recommendations|declined}.json`. All three are cleaned up by `/wrap-up` Step 5 alongside the ledger.

## v4.4.0 — Per-item consent for INBOX/DEFERRED writes (2026-05-03)

Writing an item to INBOX or DEFERRED required explicit per-item user consent.
Carries the Impeccable integration design spec and its decomposition into three
phase documents.

## v4.3.2 — Statusline survives plugin upgrades (2026-05-03)

The statusline is invoked through a stable wrapper at `~/.claude-tweaks/bin/`,
so a plugin upgrade no longer breaks a configured `statusLine.command`.

## v4.3.1 — /init Step 0.8 writes a literal `${CLAUDE_PLUGIN_ROOT}` (2026-05-03)

Step 0.8 had been expanding the variable at write time, baking one machine's
path into the config; it now writes the literal and migrates old paths.

## v4.3.0 — Statusline schema fix + /version skill (2026-05-03)

Fixed the statusline schema and added `/claude-tweaks:version`.

## v4.2.0 — Token Saver

Three additions that reduce token consumption with no behavior change to skills:

- **Bash output filter** — a `PostToolUse[Bash]` hook compacts noisy test/build/CI output (>16KB) while preserving failure lines. Matches governor's logic: head + tail clipping, failure-marker regex, threshold-based decision. Filtered output ends with `[full output: ~/.claude-tweaks/logs/bash-{ts}.log]` — `Read` that path for unfiltered detail. No bypass command; the saved log is the escape hatch.
- **Statusline** — a self-sufficient 9-segment line: `model · ctx% · effort · git · session · weekly · saved · spec · ledger`. Auto-hides empty segments. Semantic ANSI 8-color (red/yellow/green) with `NO_COLOR` respect. Wired up by `/claude-tweaks:init` Step 0.8 — never overwrites an existing `statusLine.command`. Cross-platform (macOS, Windows, Linux best-effort).
- **Subagent output contract** — `skills/_shared/subagent-output-contract.md` defines Templates A/B/C for parallel-dispatched Task agents. Used today by `/browse`, `/help`, `/review` (review-lens dispatch + parallel-fix dispatch), and `/tidy`.

**New dependency:** Node 18+ (used by the bash filter hook and statusline). `/claude-tweaks:init` Step 0.8 detects missing Node and offers to install via the platform's package manager (brew / winget / scoop on macOS+Windows; manual sudo command printed for Linux). Git CLI is optional; the `git` statusline segment hides when absent.

To disable color: `export NO_COLOR=1`. To inspect raw bash output: `cat ~/.claude-tweaks/logs/bash-{ts}.log` (path appears in the filter footer).

## v4.1.0 — Quality-of-life follow-through on the v4.0 migration

Quality-of-life improvements that emerged from doing the v4.0 migration. Non-breaking; opt in by adding the relevant settings to your project's `CLAUDE.md`.

- **Project-level defaults** — new `Worktree`, `Subagent`, `Brainstorm`, `Pre-flight`, and `Plan audit` sections in CLAUDE.md let you set defaults that claude-tweaks reads before invoking sub-skills (worktree directory, subagent pattern for markdown projects, section-batching behavior, merge-check toggle, scope-keyword enforcement).
- **`/build` Plan Audit step** — verifies plan-referenced paths exist; when the plan declares `Scope keywords:`, greps the repo and lists files outside the plan that match. Catches "remove X" plans that miss a file.
- **Pre-flight merge check** — `/build worktree` and `/flow` fetch `origin/main` before creating a worktree and warn on divergence. Surfaces "main shipped while you were working in a worktree" early instead of at branch finish.
- **Scope-aware `/flow` routing** — when a design doc / plan touches 10+ files, ships a major version bump, or runs 300+ lines, `/flow` surfaces a warning suggesting `/specify` decomposition first. Bypassed in `auto` mode.
- **`/flow auto` keyword** — symmetrical with `/build auto`. Silences the merge-check and scope-check prompts (each auto-acknowledged in the ledger), making `/flow … auto` a single-decision invocation.
- **Adaptive section batching** — when a multi-section approval flow gets 2 consecutive yeses, remaining sections are batched into one approval. Configurable via `Brainstorm / section-confirmation` (`adaptive` | `per-section` | `batch`).

### Breaking changes — branch-numbered v4.0

`main`'s tip went 3.23.0 straight to 4.1.0: the agent-browser migration and the
follow-up fixes merged together, so no install ever reported 4.0.0.

Two changes affect users upgrading from v3:

1. **Browser tooling switched to agent-browser.** Install: `npm install -g agent-browser`. Uninstall is optional but recommended: `npm uninstall -g @playwright/cli`. Chrome MCP support is removed entirely.
2. **`/stories` schema bumped to v2.** Existing v1 story files (with CSS selectors) are detected on first run and you'll be prompted to regenerate — `/stories <url>` reuses your existing story names, descriptions, and journey assignments while replacing CSS selectors with semantic locators (role / text / testid). No silent breakage.

Run `/claude-tweaks:init` against your existing project to refresh the configuration after upgrading.

## v3.23.0 — /build defaults to worktree mode (2026-05-01)

Worktree isolation became the default for `/claude-tweaks:build` rather than an
opt-in argument.

## v3.22.0 — Worktree cleanup hard-stop and visual-review skip bias (2026-03-09)

Fixed a hard-stop in worktree cleanup and a bias that let visual review skip
itself. Carries the design spec and implementation plan for the agent-browser
migration that became v4.0, and a `.gitignore` for `.worktrees` and `.DS_Store`.

## v3.21.0 — Superpowers transition friction, flow worktree default, init scope (2026-03-07)

Reduced friction in the handoffs to Superpowers skills, defaulted `/flow` to
worktree mode, and added scope selection to `/init`.

## v3.20.1 — Automatic worktree cleanup in wrap-up (2026-03-07)

`/claude-tweaks:wrap-up` began cleaning up its worktree without being asked.

## v3.20.0 — visual-review becomes a standalone component skill (2026-03-07)

Extracted `/claude-tweaks:visual-review` out of its callers, following the
same split v3.19.0 applied to reflect, simplify and journeys.

## v3.19.0 — reflect, simplify and journeys become standalone component skills (2026-03-07)

Three behaviors that had been inlined in larger skills became separately
invocable skills, callable both directly and as pipeline steps.

## v3.18.0 — Cross-reference drift, contradictions, missing error paths (2026-03-06)

A consistency pass across the skill set: fixed drifted cross-references,
resolved contradictions between skills, and added error paths that were
documented nowhere.

## v3.16.0 — Visual review optimization + reconnaissance pre-step (2026-03-04)

Added a reconnaissance pre-step to visual review and optimized the rest of it.
The bulk of the version is a README rewrite that cycled through ASCII and
Mermaid diagram layouts before settling, plus a switch to full
plugin-prefixed skill names throughout the README and reference card.

## v3.14.0 — Version bump and manifest fix (2026-03-01)

A version bump and a manifest correction, with no other content.

## v3.13.0 — Ledger skill, dev-URL persistence, flow resume (2026-03-01)

Added `/claude-tweaks:ledger`, persisted the dev URL between runs, and made
`/flow` resumable. Also a general interaction-efficiency pass.

## v3.12.0 — Journeys integrated into stories (2026-02-28)

Story generation became journey-aware: coverage tracking against documented
journeys, and detection of stories orphaned from any journey.

## v3.11.0 — Auth profiles for QA stories (2026-02-27)

QA stories gained credential discovery and named auth profiles, replacing
guesswork about how to log a persona in.

## v3.10.0 — Contextual Next Actions + Actions Performed table (2026-02-27)

Every skill gained a context-derived `Next Actions` block and an
`Actions Performed` table — the interaction conventions that still govern the
plugin.

## v3.9.0 — Skill updates redesigned across the lifecycle (2026-02-26)

Reworked how skill files get updated at each lifecycle stage.

## v3.8.0 — /test splits from /review; QA pipeline overhaul (2026-02-26)

Separated the mechanical "does it work" gate (`/claude-tweaks:test`) from the
judgment gate (`/claude-tweaks:review`), overhauled the QA pipeline, and fed QA
results into visual review inside `/flow`.

## v3.5.0 — QA story execution automated (2026-02-25)

Dev-URL detection, auto-trigger in `/flow`, and auto-validation in `/review`,
so stories ran without being invoked by hand.

## v3.4.0 — Drop the /superpowers: prefix from skill references (2026-02-25)

Skill references lost the `/superpowers:` prefix, and `/flow`'s worktree
default was corrected. Also standardized the worktree directory on
`.claude/worktrees/`.

## v3.3.0 — Windows compatibility (2026-02-25)

Fixed Windows incompatibilities across skills, hooks and agents.

## v3.2.0 — Tidy action vocabulary, verification step, help handoff gate (2026-02-25)

`/claude-tweaks:tidy` gained its action vocabulary and a verification step, and
`/help` gained a handoff gate.

## v3.1.1 — Build option prompts (2026-02-25)

Version bump for the build-option prompting added in 3.1.0.

## v3.1.0 — All Superpowers skills integrated via a 2x2 build matrix (2026-02-24)

`/claude-tweaks:build` routed to the full Superpowers skill set through a 2x2
matrix, prompted for build options when they weren't passed as arguments, and
renumbered its steps 1-7.

## v3.0.1 — Fix duplicate hooks error on install (2026-02-24)

Installing hit a duplicate-hooks error; the redundant manifest field causing it
was removed.

## v3.0.0 — browser-pilot merges into claude-tweaks (2026-02-24)

Absorbed the separate browser-pilot plugin. Also enforced one batch decision
table per message across all skills, fixed the agents manifest field to take an
array of paths, and dropped the redundant `hooks` field now that
`hooks/hooks.json` loads by convention.

## v2.9.0 — Correct Superpowers command names; /capture promote options split (2026-02-22)

Fixed wrong Superpowers command names and split `/capture`'s promote options.

## v2.8.0 — Parallel execution directives + multi-spec flow (2026-02-22)

Added the parallel-execution directives that skills still use to signal
concurrent work, and multi-spec support in `/flow`. Journey capture widened
from end users to all personas.

## v2.7.0 — Cross-spec intelligence (2026-02-22)

Pattern detection, journey regression checks and dependency awareness across
specs. Routing was biased toward fixing now — close small gaps early rather
than deferring them — with the hierarchy stated as fix now -> defer -> INBOX.

## v2.6.0 — Workflow friction reduction (2026-02-22)

Batched decisions, removed navigation menus, and fixed cross-references — the
first pass at the interaction conventions that became house style. Added design
mode to `/flow` (brainstorming straight to pipeline, skipping `/specify`) and
gave the plugin repo its own CLAUDE.md.

## v2.5.0 — Journey discovery mode for brownfield projects (2026-02-22)

Journeys could be discovered from an existing codebase rather than only written
for new work.

## v2.4.0 — Explicit routing gates (2026-02-21)

Every skill got explicit routing gates so nothing could be silently dropped —
the ancestor of the current "every surfaced item must be explicitly resolved"
rule.

## v2.3.0 — browser-review skill, user journeys, browser setup (2026-02-21)

Added the browser-review skill, user journey documentation, and browser setup.

## v2.2.0 — Build modes, help and flow skills (2026-02-21)

Added build modes (autonomous by default, plus guided and branched), the
`/help` and `/flow` skills, and lazy-loaded codebase onboarding. Also an audit
follow-up removing dead references and resolving contradictions.

## v2.0.0 — The workflow system replaces the hello skill (2026-02-21)

The placeholder skill gave way to the full workflow system: design mode in
`/build` (build straight from a design doc, skipping `/specify`), numbered
options for choices and skill transitions, and the `claude-tweaks:` prefix on
every skill name and cross-reference.

## v1.0.0 — Initial scaffold (2026-02-20)

The first commit: plugin scaffold.
