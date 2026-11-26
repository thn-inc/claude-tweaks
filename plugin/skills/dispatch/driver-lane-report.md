# Dispatch Step 3 — Driver-Lane Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited after the Neighbour-in-flight report (refs #6119).

Read this run's session-scoped `dispatch-exclusions.json` (`bin/lib/dispatch/exclusions.js`'s
`readExclusions`), filtered to `reason: 'driver-lane'` entries (`records: [number], detail: {runner: 'script'}`
each). Non-empty: render one line before the rest of Step 3, comma-joining the record numbers:

`driver-lane: left to the script job: #{a}, #{b}; bare drain skips them under express-driver-runner: script`

The records stay in `dispatch-groups.json`: the exclusion is non-removing, so `#N`/`#N,#M,...` still
dispatch them through the driver route (`driver-route.md`) and bare drain's ranking skips them, as it
skips oversized groups. No job drains the lane unless a `drive.js --budget` script job runs, so print this
line on every firing that has entries, never only the first: a lane nobody drains must show each time.
Same drain+zero-eligible exception as the Blocked-exclusion report (`SKILL.md` Step 3); omit when empty.
