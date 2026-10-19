# Open Items — pr-first-merge Step 3: make the merge snippet guard-safe (#3522)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Decision (#2319) comment line in plugin/bin/lib/compose-subject.js longer than its neighbours (SDD Task 1 minor) | accepted | Cosmetic; final whole-branch review triaged it as leave |
| 2 | build | `--out-dir ''` passes parseArgs and exits 3 (mkdirSync('') throws) instead of a usage error (SDD Task 1 minor) | accepted | Fails safe (non-zero, nothing written); final review triaged it as leave |
| 3 | build | 'no files on an uncomposable record' test passes pre-change (SDD Task 1 minor) | accepted | Regression guard by design, per the plan's Review Focus #2 |
| 4 | build | pr-first-merge.md said 'paste the printed path' though session-tmp-resolve.js prints SUBJECT_DIR="<path>" (SDD Task 2 minor) | fixed | d6f2b0993 (path inside the printed quotes) |
| 5 | build | Conformance test F1 comment 'guards its own composer call' stale (SDD Task 2 minor) | fixed | 30729d2d8 |
| 6 | build | Go-red for the gh-$( regex runs on a synthetic string, not frozen text (SDD Task 2 minor) | accepted | The check is generic and the synthetic string exercises it; final review triaged it as leave |
| 7 | build | Ruling: the {subject-dir} key widened to {pr-number} (pr-first) / subject {issue} (local-merge) at the one canonical definition in pr-first-merge.md Step 3 (SDD Task 3) | observation | Ruling; implemented in d6f2b0993 |
| 8 | build | Local-sites conformance loop did not pin the {subject-dir} pointer sentence (SDD Task 3 minor) | fixed | 30729d2d8 |
| 9 | build | {subject-dir} pointer sentence sits after the fence rather than at first mention (SDD Task 3 minor) | accepted | Readable as-is; final review triaged it as leave |
| 10 | build | docs/plugin-structure.md:58 said 'JSON or --shell assignments' with no --out-dir (SDD controller minor) | fixed | 30729d2d8 |
| 11 | build | Multi-issue local fences pass {issue} {second-issue}; key text names only {issue} (SDD Task 3 minor) | accepted | Any member issue is a unique key and directory reuse is safe; final review triaged it as leave |
| 12 | build | Ruling: --shell kept (spec says 'alongside') as a manual/debug surface with no shipped merge-fence caller, stated in the compose-subject.js header comment, not deprecated (SDD final review) | observation | Ruling; implemented in 30729d2d8 |
| 13 | build | Repo-wide unquoted session-tmp path placeholders in other fences (e.g. {tmp-records-file}) split on a space in os.tmpdir(), the same failure the final review fixed for {subject-dir} — out of #3522 scope (SDD final review Ruling) | open | — |
| 14 | build | plugin/skills/wrap-up/residue-sweep.md:132,137 and docs/skill-graph.md:648 still say "Step 3's initial `gh pr merge --auto` call"; Step 3 is now compose + merge fences (SDD final review, parked) | open | — |
