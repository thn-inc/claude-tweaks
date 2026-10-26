Title: decideConsoleExecute skips the sdd-ruling gate when ctx.rulingTexts is absent (fail-open default on an exported pure function)
Kind: review-unconfirmed
Finding: plugin/bin/lib/reconcile/console-execute.js (the `ctx.rulingTexts` guard in decideConsoleExecute; low, lens 3c and lens 3f, one agent each)
Staged-at: d76e62881
Ledger: docs/plans/2026-10-22-sdd-deferral-ruling-gate-ledger.md#11

Lens 3c agent A and lens 3f agent B each flagged this; the lens pairs did not match each other, so it is unconfirmed by the reproduction rule.

`decideConsoleExecute` yields `rulingGateGaps: []` when `ctx.rulingTexts` is absent but fails closed when it is present and an item is missing. The one production caller (`consoleExecuteDetect`) always supplies it, so there is no live defect. The behavior is deliberate and pinned: `tests/console-execute.test.js` asserts the "legacy call shape" yields `[]`, matching how `mergeGrantGap` treats an absent `ctx` (the pre-#1802 shape). The risk is a future caller that omits the map and auto-ratifies every ruling row with no test going red.

Dispositions: apply (make an absent map fail closed -- every `isRulingRow` item unclassified -- and flip the pinning test) / reverse (keep the pre-feature call-shape convention shared with mergeGrantGap).
