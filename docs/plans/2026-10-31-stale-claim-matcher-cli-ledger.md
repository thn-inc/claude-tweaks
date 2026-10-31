# Open Items — 4596: Route the tidy and MCP stale-claim checks through one Node matcher over agent-fetched PR JSON

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — normalizePrListing rejects non-PR listing elements as failure: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Resume-line dir and target classes are allowlists: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — parseResumeLine keeps a typeof runId string guard: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — resumeLineUnder reads the last Resume heading: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Windows backslash run dirs read resolve, not resume: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Follow-up idea (final review recommendation): route `flow/claim-targets.md`'s tombstone-PR `### Resume` parse (line ~270-286) through `pr-body.js`'s `resumeLineUnder`/`parseResumeLine` — the last prose copy of that grammar | open | Defer-reason: tangential — a capture candidate, not a fix to this record's two named prose files |
| 7 | build | `_shared/issue-claims.md` grew 46,992 → 47,311 B; `docs/journeys/compose-a-per-run-context-bundle-1988.md` Step 8 measured-bytes note for the `claims` bundle is now stale (wrap-up refresh convention) | open | — |
| 8 | build/skill | [skill: mcp-agent-fetch-node-compute] `mcp-agent-fetch-node-compute` gains an instance: `bin/stale-claim-pr.js --listing` (normalizer `bin/lib/issues/mcp-pr-shape.js`, run on both transports, rejecting any non-PR element as failure) — enrichment for its "Instances to copy from" table | open | — |
| 9 | review/error | `mcp-pr-shape.js:39` — a non-null `head.repo` with no string `full_name` read as cross-repository, so a marked same-repo PR was a clean no-match (medium) | fixed | Throws `notAPr()`; new test red on the old normalizer |
| 10 | review/security | `pr-body.js:65` — `parseResumeLine` admitted a `..` dir segment (low) | fixed | Rejected; dotted names still pass |
| 11 | review/test | `claim-targets.test.js:647,745,816` — fixtures lacked `isCrossRepository`, so they hit the normalizer's rejection and never reached the matcher rules they name (medium/low) | fixed | Fixtures gain `isCrossRepository: false`; stale-pr-3 asserts no fail-open stderr line |
| 12 | review/test | `issue-claims-stale-open-pr-conformance.test.js:69` — the "restated only in flow/claim-targets.md" test checked a hard-coded file list (low) | fixed | Walks every `plugin/skills/**/*.md` |
| 13 | review/docs | `issue-claims.md:167,:180,:510` and `scan-procedures.md:243` — stale "no CLI to delegate to" claims; shell variable `${CLASSIFY_INPUT}` in a cross-call command (low) | fixed | Reworded; `{CLASSIFY_INPUT path}` placeholder |
| 14 | review/convention | `stale-claim-pr.js:85` — `defaultGh` duplicates `claim-targets.js`'s runner (low) | accepted | House pattern: shared constants, `windowsHide` pinned repo-wide, same options object in two older bins |
| 15 | review/hindsight | [skill: gh-api-module-pattern] `cli-wrapper-contract.md`'s bullet "A `gh`-absent caller hands the CLI already-fetched records as a file" names `materialize.js` and `preflight-records.js`; `stale-claim-pr.js` is a third instance, with exit 2 (gh absent and no `--listing`) as the caller's cue to fetch the MCP listing and re-run — name both in that bullet | open | — |
