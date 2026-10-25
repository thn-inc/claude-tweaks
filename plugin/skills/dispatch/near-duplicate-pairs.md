# Dispatch Step 3 — Predicted Conflict for an Explicit List (refs #3520)

Referenced by `skills/dispatch/SKILL.md` Step 3's `#N[,#M,...]` form, after `selectGroupsForExplicitList` and before Step 4.

Two records in one explicit list can be near-duplicates whose overlap shows in no `### Key Files` section, so
the neighbour-in-flight guard cannot see them (the 2026-10-17 `#3417,#3419,#3012` firing). The list is an explicit
choice, so both still dispatch; this step names the conflict and the merge order up front instead.

## Procedure

1. Read this firing's `$DISPATCH_NEAR_DUP_PAIRS` (`dispatch-near-dup-pairs.json`, session-scoped per
   `_shared/session-tmp-root.md`). Re-run `queue-pull-script.md`'s `DISPATCH_NEAR_DUP_PAIRS="$(node … --value dispatch-near-dup-pairs.json)"` line to recover the path in a fresh shell. The
   file holds `[{records: [A, B], signals, sharedAnchors}]` — strong pairs only (`isStrongNearDuplicate`), rewritten
   by every queue pull; weak pairs never reach it.
2. Call `predictedConflicts(pairs, selectedGroups)` from `bin/lib/dispatch/near-dup-pairs.js`, with `selectedGroups` as returned —
   already capped at `dispatch-batch-size`, the groups that dispatch this firing. It keeps only the pairs
   whose two members sit in two *different* selected groups (a same-group pair is co-built; omit it) and returns
   `[{first, second, signals, sharedAnchors}]`, `first`/`second` being issue numbers.
3. Per entry, print one line before Step 4:

   `#{A} / #{B} predicted to conflict (near-duplicate: {signals}; shared: {sharedAnchors}); dispatch order #{A} then #{B}, merge #{A} first`

   and log one line to `decisions.md`:

   ```
   AUTO {time} — dispatch: predicted conflict #{A} / #{B} (near-duplicate: {signals}); merge #{A} first. Reversibility: n/a.
   ```

   `{A}` is `first` and `{B}` is `second`. `selectedGroups`' order is the dispatch order, Step 5 dispatches in that order,
   and that order is the merge order to announce. `{signals}` and `{sharedAnchors}` are comma-joined.
4. Omit the step when `predictedConflicts` returns `[]`, or when the file is absent or unreadable — there is nothing to
   announce, and the dispatch is never blocked on this read.

Both records dispatch regardless. The line is a prediction, not a gate. Each group's report block repeats it per
`reporting.md`, and Step 4 and the Auto-merge gate carry the pair into the drain-PR overlap check
(`drain-pr-overlap.md`).
