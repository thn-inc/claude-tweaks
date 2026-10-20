# Open Items — log-decision.js: read entry text from a file so interpolated file names need no shell escaping

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Follow-up (final whole-branch review Important #1): other `log-decision.js --text "..."` call sites interpolate git- or user-supplied text with no escaping, contradicting `_shared/auto-decision-log.md`'s new Text from git or a user rule — `flow/multispec-parallel-waves.md` (~36 `{stderr reason}`, ~58 `{reason}`, ~62 `{paths}`, ~141 `{reason}`), `tidy/release-note-repair.md` (~86 `{stderr reason}`), `dispatch/two-call-gate.md` (~9 `{message}`), `_shared/pr-check-gate.md` (~76 `{: reason}`), `_shared/git-discipline.md` (~162 `{integration-branch}`), and `flow/steps-and-gates.md` ~62's first #3014 log call (`pr.value.conflictNote`). Out of #3671's named two-site scope; migrate them to `--text-file` via a spec-shaped follow-up record (Defer-reason: tangential). | open | — |
| 2 | build | log-decision.js:103 a UTF-8 BOM at file start is not stripped before the entry (final review verified formatEntry's trim() strips U+FEFF — non-issue) | deferred | SDD minor (deferred), Task 1 |
| 3 | build | cli.test.js blank-file case asserts exit+no-write only, not the 'required' message; no existing-but-unreadable (directory) path case | deferred | SDD minor (deferred), Task 1 |
| 4 | build | auto-decision-log.md 'timestamps and status-prefixes --text' sentence reads narrow now that --text-file feeds the same path | deferred | SDD minor (deferred), Task 1 |
| 5 | build | go-red controls' assert.throws regex /--text-file/ could match any later pin label mentioning --text-file; exact label match would be tighter | deferred | SDD minor (deferred), Task 2 |
| 6 | build | execution-and-verification.md restates 'never go in a double-quoted --text' alongside the citation | deferred | SDD minor (deferred), Task 2 |
| 7 | build | steps-and-gates.md first #3014 log call still passes pr.value.conflictNote (interpolates the integration branch name) as double-quoted --text; outside the two named sites (covered by item 1) | deferred | SDD minor (deferred), Task 2 |
| 8 | build | SDD ruling — out-of-scope git-text --text call sites routed to a follow-up record, not fixed in this PR: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 9 | build | SDD ruling — final-review Important #2 and Minors #1-#5 applied in the one fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
