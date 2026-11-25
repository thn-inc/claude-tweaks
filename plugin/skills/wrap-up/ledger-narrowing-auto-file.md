# Review Console — Ledger Narrowing Auto-File

Referenced by `skills/wrap-up/review-console.md`'s "Ledger narrowing auto-file" stub. Runs before rendering the console.

This step runs after proposal bundling (`proposal-bundling.md`): skip a staged proposal whose header carries `Bundled-into:` (a retired bundle member, now under `bundled/`), and any `decisions.md` entry whose staged path no longer resolves to a creatable proposal file.

Resolve the `ceiling` per `_shared/autonomy-ceiling.md`'s existing precedence ladder. If
`bookkeepingPermissions(ceiling).queueWriteAutoFile === true` (`bin/lib/issues/autonomy.js`), before building any of the tables
below: for every queue-write proposal already staged (from ledger Phase 2's narrowing, leftover
routing's staging (Phase 3), or `/reflect`'s tangential-idea routing Step 3 — all three run earlier
in `/wrap-up`'s own phase order, before this console) create the record directly via the same `gh issue
create` / `local-store.js` path "On approval" step 5 below already uses, log it as `AUTO` instead
of `STAGED`, and list it under **Auto-applied** instead of **Queue writes**. On a fully-on run
with no ambiguous residue, the Queue writes section below therefore renders empty.

Do not sweep up reflect's non-queue-write staged findings (convention drift, pattern
observations, skill-update proposals) here — identify a queue write the same way this console
already distinguishes one: a `decisions.md` `STAGED or AUTO` entry phrased as a record proposal
("-- backlog candidate" / a `leftover-` or `ledger-record-` staged file), not a bare stage path.
(Ledger Phase 2's own narrowing step logs its entry as `AUTO`, not `STAGED` — the detection
heuristic must catch both kinds, not just `STAGED`.)

Note: auto-filing a narrowed item here therefore produces two `AUTO` log entries — the
narrowing step's own entry plus this step's own entry for the same item. This is expected,
not a bug; it is just undocumented elsewhere.

Before auto-filing any proposal, run `refused-proposals.md`'s check (in this skill's directory) —
a refused proposal is never auto-filed; it renders under the refused row, not under Queue writes.
A *failed* create on a valid proposal is different: leave that one staged and let it render
normally in Queue writes below — do not drop it. Two different outcomes.
