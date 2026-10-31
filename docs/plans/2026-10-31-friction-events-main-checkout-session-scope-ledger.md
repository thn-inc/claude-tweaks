# Open Items — #4704 friction-events.js main-checkout union scoped to the current session

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.8 file-overlap warning: #4704 overlaps open #4522 (`plugin/bin/friction-events.js`, `plugin/bin/lib/hooks/context.js`), #4429 (`friction-events.js`, `tests/friction-events-cli.test.js`), #4259 (`friction-events.js`), #4286 (`friction-events-cli.test.js`), #3875/#3975/#4318 (`hooks/context.js`) | observation | Proceeded with #4704 only (warning, never a gate); #4522 widens the same worktree-path union #4704 narrows — expect a text conflict at whichever PR lands second |
