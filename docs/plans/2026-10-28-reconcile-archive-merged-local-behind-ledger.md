# Open Items — reconcile archive-merged strands tracked work/ specs when the local integration branch is behind origin (#4387)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — dry-run keeps localHasMerge's origin fallback on the integration branch (preview assumes the mirror fast-forward succeeds): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | review/code | runBehindLocalIntegration passed `refs/heads/{integration}` to mergedEvidence, defeating its bare-name self-branch guard (archive-merged.js:765) | fixed | explicit `branch === integration` guard returns the skip direction |
| 3 | review/code | abandoned-interrupted guard re-derived the run branch with runDirBranch instead of reusing checkRunIntegrity's evidence.branch (archive-merged.js:763) | fixed | verdict kept at the classify site; guard reads `integrity.evidence.branch` |
| 4 | review/test | runBehindLocalIntegration's parked-checkout, indeterminate-probe and null-evidence arms had no test on the abandoned-interrupted path | fixed | three tests added; each proved red by a mutant (guard dropped, `!== 'on'`, `evidence === false`) |
| 5 | review/code | stale comment: local-behind-merge exclusion from the structurally-stuck escalation assumed a fetch always catches up (archive-merged.js:1770) | fixed | comment names the dirty/diverged-main case |
| 6 | review/code | integrationCheckoutState maps an ordinary (non-indeterminate) git error to 'other', keeping the origin fallback (archive-merged.js:697) | accepted | deliberate per the localHasMerge comment (git too old for `--show-current`); tiebreak: drop |
| 7 | review/code | archive-merged and mirror-ff probe the checkout's branch with different failure policies (mirror-ff.js:44) | accepted | mirror writes, archive reads; only an ordinary error on git < 2.22 diverges; tiebreak: drop |
| 8 | review/test | failBranchProbe is argv-coupled; several #4387 tests pin preserved behavior; diverged-main fixture untested; gitignore literal-line assertions pin an unchanged file | accepted | failure is loud, the preserved-behavior tests are the spec's own ACs, topology is not read by the rule; tiebreak: drop |
