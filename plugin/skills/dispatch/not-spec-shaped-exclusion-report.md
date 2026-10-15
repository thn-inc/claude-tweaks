# Dispatch Step 3 — Not-Spec-Shaped Exclusion Report

Referenced by `skills/dispatch/SKILL.md` Step 3, cited alongside the other exclusion reports
(refs #2829).

Read this run's session-scoped `dispatch-exclusions.json` (`queue-pull-script.md`'s output,
`bin/lib/dispatch/exclusions.js`'s `readExclusions`), filtered to `reason: 'not-spec-shaped'`
entries (`records: [number], detail: {missing: [...]}` each) — every otherwise-`auto:build`-
eligible candidate the queue pull dropped because its cached body fails `/flow`'s Materialization
hard gate (`shapeGate`, `bin/lib/issues/materialize-format.js`). Unlike the single aggregate line
the Blocked/Open-PR/Shipped reports render, render one line per excluded record — the missing
sections differ per record, and each needs its own remedy:

`#{number} excluded — not spec-shaped (missing: {missing, comma-joined}). Run {remedy}.`

**Remedy selection:** when `missing` is exactly `["Release Note"]`, the remedy is
`` `/claude-tweaks:tidy` `` — #2828's Shape 4.5 repairs a missing Release Note in place. Any other
`missing` set (one of the other three required sections, `unresolved-placeholder`, alone or
combined with a missing Release Note) gets `` `/claude-tweaks:specify #{number}` ``.

Same drain+zero-eligible silence exception as the Blocked-exclusion report (`SKILL.md` Step 3);
omit this block entirely when the filtered entry list is empty. Like the Open-PR and Shipped-
candidate exclusions, this one removes every excluded candidate from `dispatch-groups.json`
unconditionally — computed once, inside `queue-pull-script.md`'s own run, before any selection
form (`bare`/`next`/`#N`/`#N,#M,...`) reads that file. There is no bypass: naming the record
directly does not restore it, because `/flow`'s own Materialization gate would stop it anyway,
after a claim and a spent retry attempt — the same `oversized` does not get, since a spec-shape
failure is not a risk anyone can accept the way a human naming an oversized group accepts its
size.
