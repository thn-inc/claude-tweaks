# Curation Engine — reference appendix (#2546)

Rare-branch content split out of `curation-engine.md`'s operative head, read only when the head's
own citation points here. Nothing in this file runs on the common-case path — a run where the
engine itself runs successfully never needs it.

## 6. Prose fallback — full procedure

**When the engine fails for any reason, execute this same mechanism manually.** This is unconditional and takes no diagnosis `[IL-14]`: enumerate the failure modes and the enumeration will be missing one.

1. Walk SKILL.md's registry table top to bottom, in the order printed there.
2. Evaluate each row's gate by the condition stated in that table. A closed row resolves to `n/a` with the stated reason.
3. For each open row, apply its judge file to its scope — using the table's own cap where one is stated, narrowed under `fast-lane`.
4. Write the row's `SCANNED` line by hand in the section 3 format, into `decisions.md`.
5. Compose the phase-trace row by hand: `| {target} | {n/a | Clean | {n} applied | {n} staged | {a} applied, {s} staged} | {detail} |`.
6. Honor sections 3 and 5 unchanged — the stage-only-rows check and the vocabulary rule are engine-enforced; the remaining three clauses of the applied precondition (additive-only, reversibility, confidence) are judgment-only and not engine-validated — under the fallback all of them bind the judge directly. The fallback runs as a single thread, so that one thread plays both roles section 1's ownership cell splits under the engine: it applies each `"action": "applied"` finding as a judge would, then commits it serially per section 4's discipline (audit, commit, attribute) — the same "never a judge-side commit" rule still holds, it is simply the same thread that steps into the controller role afterward rather than a separate committer.

**The report MUST state `(engine unavailable — prose fallback ran)` in the Phase 2 table caption.** A hand-composed trace that looks engine-produced is worse than no trace: the trace's whole value is that it is mechanical, and a reader cannot tell the two apart from the table alone.

Engine failure is never permission to skip a row. The silent skip is the failure this architecture exists to prevent; a fallback that quietly curates less than the engine would has reintroduced it.
