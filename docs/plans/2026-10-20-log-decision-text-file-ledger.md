# Open Items — log-decision.js: read entry text from a file so interpolated file names need no shell escaping

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Follow-up (final whole-branch review Important #1): other `log-decision.js --text "..."` call sites interpolate git- or user-supplied text with no escaping, contradicting `_shared/auto-decision-log.md`'s new Text from git or a user rule — `flow/multispec-parallel-waves.md` (~36 `{stderr reason}`, ~58 `{reason}`, ~62 `{paths}`, ~141 `{reason}`), `tidy/release-note-repair.md` (~86 `{stderr reason}`), `dispatch/two-call-gate.md` (~9 `{message}`), `_shared/pr-check-gate.md` (~76 `{: reason}`), `_shared/git-discipline.md` (~162 `{integration-branch}`), and `flow/steps-and-gates.md` ~62's first #3014 log call (`pr.value.conflictNote`). Out of #3671's named two-site scope; migrate them to `--text-file` via a spec-shaped follow-up record (Defer-reason: tangential). | open | — |
