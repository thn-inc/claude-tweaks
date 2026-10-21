# Open Items — Add a hooks.js check-pass-reentry verb (#3553)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: `hooks.js check-pass-reentry` copies `reportWorktreeLocalFallback`'s disclosure string verbatim (the plan forbade calling the stdout helper). A `stream` parameter on the helper would dedupe it (`plugin/bin/hooks.js`) | open | — |
| 2 | build | SDD task-review minor: the `worktreeLocalFallback` stderr branch of `check-pass-reentry` has no test | accepted | Fail-closed by construction: if the notice regressed to stdout, the skill's "stdout that is not that JSON is a stop" rule stops the run. The #280 fallback path is unreachable for re-entry, because the banner names main-checkout run dirs (whole-branch review triage: can-defer). |
| 3 | build | SDD task-review minor: doubled "and" in `docs/hooks.md`'s exit-code exception sentence | fixed | 120235a2f |
| 4 | build | SDD task-review minor: `tests/hooks-check-pass-reentry.test.js`'s symlink-only PATH fixture had no Windows guard, and its temp dirs are not cleaned | fixed | Win32 skip added in 120235a2f. Temp-dir cleanup is left as is, matching the shared `reentryFixture` helper's existing pattern. |
| 5 | build | SDD task-review minor: the `'--online'` token in `flow-pass-reentry-conformance`'s AC1.2 list is redundant beside `VERB_CALL` | accepted | Harmless duplicate pin of a substring `VERB_CALL` already asserts. Plan-mandated, triaged can-defer by the whole-branch review. |
| 6 | build | SDD task-review minor: the AC2.2 negative control's `assert.throws` has no `/node -e/` matcher, so any throw satisfies it (`tests/flow-pass-reentry-conformance.test.js`) | open | — |
| 7 | build | SDD task-review minor: two test titles in `tests/flow-pass-reentry-conformance.test.js` both start `AC2.1` (the new verb pin and the existing retired-sentences test) | open | — |
| 8 | build | SDD final re-review out-of-scope: `plugin/bin/hooks.js:644` still says "these five verbs" inside `main()`'s KNOWN_FLAGS guard comment, though the table now holds more keys | open | — |
| 9 | build/skill | Adding a `hooks.js` subcommand touches six registration surfaces no project skill enumerates: the `USAGE` table, `KNOWN_FLAGS` for a flag-strict verb, `tests/hooks-help-guard.test.js`'s `runAccepting` list, `docs/hooks.md`'s anchored-`--run` count and list, `docs/plugin-structure.md`'s hooks.js line (count plus ordinal renumbering), and the exit-code exception sentence. [skill: NEW - hooks-js-verb-registration] | observation | Seen while building #3553. |
