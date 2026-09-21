# Dispatch Step 3 — Oversized-Group Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited immediately after the Blocked-exclusion
report (refs #1228).

Read this run's session-scoped `dispatch-exclusions.json` (`queue-pull-script.md`'s output,
`bin/lib/dispatch/exclusions.js`'s `readExclusions`), filtered to `reason: 'oversized'` entries
(`records: number[], detail: {size, threshold}` each). Non-empty: render one line before the rest
of Step 3:

`{n} group(s) over the size guard (threshold {threshold}): #{a},#{b},... (size {size})`

These groups stay selectable via `#N`/`#N,#M,...` (naming one directly is the required
surfacing); drain's auto-selection excludes them exactly as `next`'s ranking already did —
reused, not new logic. Same drain+zero-eligible exception as the Blocked-exclusion report
(`SKILL.md` Step 3); omit when empty.
