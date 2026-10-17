# Dispatch Step 3 — Neighbour-in-Flight Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited after the Oversized-group report (refs #3278).

Read this run's session-scoped `dispatch-exclusions.json` (`queue-pull-script.md`'s output,
`bin/lib/dispatch/exclusions.js`'s `readExclusions`), filtered to `reason: 'neighbour-in-flight'`
entries (`records: [number], detail: {neighbours: [{number, files}]}` each). Non-empty: render one
line per entry before the rest of Step 3:

`#{n} waits — direct neighbour(s) in flight: #{m} ({files}); bare drain skips it this firing`

`{m}` lists each neighbour (`detail.neighbours[].number`), `{files}` the Key Files they share with
`#{n}`. The record stays in `dispatch-groups.json` — the exclusion is non-removing, so
`#N`/`#N,#M,...` print the same line and still dispatch it (naming one directly is the required
surfacing), while bare drain's ranking skips it exactly as it skips oversized groups — reused, not
new logic. Same drain+zero-eligible exception as the Blocked-exclusion report (`SKILL.md` Step 3);
omit when empty.
