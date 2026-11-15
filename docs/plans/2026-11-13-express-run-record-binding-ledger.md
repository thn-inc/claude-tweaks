# Open Items — Express-lane runs record their issue (#5347)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD parked finding (Task 2 review): express-lane.md step 7's trailing clause reads awkwardly — Ruling: the code stands; the final whole-branch reviewer read it as correct and two prose tests pin the wording, so a reword only churns tests | observation | — |
| 2 | build | SDD parked finding (Task 2 review): tests/bin-lib/express/cli.test.js hand-built scDeps could drift from the set-config suite's deps helper — Ruling: the code stands; run() spreads overrides over realDeps and the test overrides only cwd/stdout/stderr, the surface the helper covers | observation | — |
| 3 | build/skill | Skill observation (extends run-directory-fact-packs): a new non-closing resolveRecords rung must also be excluded wherever records act as authority, since the console resolver's readMembers took the config rung from the pack until the final review caught it | observation | — |
| 4 | review | Review 3e (medium): the config-rung member exclusion was a second literal copy in console/resolve.js readMembers; now pack.js memberRecords (allowlist) decides it once | fixed | Fixed in c2e99e734 |
| 5 | review | Review 3c (low): pack.js config rung treated an unreadable manifest.yml as absent; now only ENOENT or a null read is absent | fixed | Fixed in c2e99e734 |
| 6 | review | Review 3a (low, contested 3a/3e, tiebreak confirmed low): manifesto-write.js appended spec directly, contradicting its header; now written through set-config with the other pairs | fixed | Fixed in c2e99e734 |
| 7 | review | Review 3a (low, tiebreak confirmed): pack.js configRecords restated the spec pattern; now reuses the exported PIN_PATTERNS.spec | fixed | Fixed in c2e99e734 |
