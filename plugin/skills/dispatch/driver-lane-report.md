# Dispatch Step 3 — Driver-Lane Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited after the Neighbour-in-flight report (refs #6119).

The queue pull prints the report line itself, on stderr, on every pull that excludes a record
(`bin/lib/dispatch/driver-lane.js`), so Step 3 surfaces that line and renders no second one:

`driver-lane: left to the script job: #a, #b`

It names every record the pull excluded as `reason: 'driver-lane'` in this run's session-scoped
`dispatch-exclusions.json` (`bin/lib/dispatch/exclusions.js`'s `readExclusions`; `records: [number],
detail: {runner: 'script'}` each). Quote the line from the pull's output; do not rephrase it. No job drains
the lane unless a `drive.js --budget` script job runs, and the pull prints the line every firing, so a lane
nobody drains shows each time.

The records stay in `dispatch-groups.json`: the exclusion is non-removing, so `#N`/`#N,#M,...` still
dispatch them through the driver route (`driver-route.md`) and bare drain's ranking skips them, as it
skips oversized groups. Under the default `express-driver-runner: session` the pull prints no such line.
