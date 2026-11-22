# 0035. Acceptance verdicts are a revocation input only

- **Status:** accepted
- **Date:** 2026-11-16
- **Context:** #4626, #4608

## Context

#4608's design says acceptance verdicts route work and do not feed an autonomy ladder. `plugin/bin/lib/issues/trust.js` contradicts that today. It counts an approved verdict label as positive evidence in the per-class trust table, and `plugin/bin/lib/issues/autonomy.js` and `plugin/bin/lib/issues/grant-gate.js` cap grants on that table's `verdict`. At `autonomy: unattended` an approval can therefore help a class earn a grant. The other half of `trust.js`, the revert detector, is reused by `plugin/bin/lib/issues/merge-lane-breaker.js` and is not part of this decision.

Evidence, from `node plugin/bin/backlog-grant-gate.js --limit 5000` against this repository's live records.

- 10:55 on 2026-11-16, before the change: 140 trust rows; 811 in-window closed records; 43 carry an approved verdict label (31 of them batch); 0 changes-requested; 512 operational known-good. 11 rows hold any approval. 12 rows are graded (10 clean, 2 mixed). 0 graded rows fall below `MIN_VERDICTS` once their approvals are removed.
- Later the same day, on the expand-step code: 140 rows; 810 in-window closed records; 42 approved (30 batch); 0 changes-requested; 511 operational known-good. Between the runs two records closed on 2026-10-17 aged out of the 30-day window and one record closed into it, a net of one. `verdict` matches the 10:55 run on every row.
- Of the 42 approved records, 8 are operationally good (merged and unreverted past `trust-revert-window-days`), 0 carry negative evidence and 34 have no operational outcome yet.
- Only `human:human|elevated` leans on approvals: 24 of its 57 dispositions (later run; 25 of 58 at 10:55). Human-filed classes are never machine-granted.

So approvals decide no grade today. They are a latent path: the first class whose approvals carry it over a floor would earn trust from a verdict.

## Decision

Option 2: acceptance verdicts route work; a rejection is a revocation input, an approval never promotes a class.

The spec named three options: keep verdicts in the trust table unchanged; keep them only as a revert-detection input; stop reading them for trust grading altogether. This record chooses the second. It reads "revert-detection input" this way: a changes-requested verdict still counts as a negative per-class input, beside reverts, and an approval counts for nothing.

Under the chosen rule an approved record is graded on its own operational outcome. Merged and unreverted past the revert window counts as good. A revert or a `correctness`/`ambiguous` failure marker counts as negative evidence. Anything else is undispositioned. A changes-requested verdict still counts as a disposition, and a cell that clears the `MIN_SAMPLES` and `MIN_VERDICTS` floors reads `mixed` while it holds one. A pending verdict stays undispositioned. The `batch-only` mixed reason has no meaning here, because an approval carries no weight.

This is how #4608's "verdicts route work; they do not feed an autonomy ladder" becomes true. Once the contract step lands, no acceptance verdict can raise a trust grade.

### Expand-contract

This release is the expand step. `trustRows` computes `row.revocationOnly` (`verdict`, `mixedReasons`, `dispositioned`, `coverage` and the counts behind them) beside today's `verdict` and changes no consumer. `autonomy.js` and `grant-gate.js` still act on `verdict`. `plugin/skills/_shared/trust-table.md` renders both columns.

The contract step switches `verdict` to the `revocationOnly` rule, then removes the approval-as-positive path, `batchOnly` and the `'batch-only'` mixed reason. Its removal condition is the check in parked record #5717 passing.

## Alternatives considered

- **Keep verdicts in the trust table unchanged.** Rejected: an approval climbs the autonomy ladder at `autonomy: unattended`, which is what #4608 rules out.
- **Stop reading verdicts for trust grading entirely.** Rejected: it drops the strongest negative signal from per-class grading. A human's changes-requested is the most direct evidence that a class's work is wrong.

## Consequences

- No row differs today. On the live run, `verdict` and `revocationOnly.verdict` agree on all 140 rows, so the contract step would change no grant. The two clean machine rows that hold approvals keep their grade: `producer:capture|low` stays `clean` (75 to 74 dispositions) and `side-effect:wrap-up leftover|low` stays `clean` (15 to 14). `producer:capture|elevated` stays `mixed` on its follow-up rate (53 to 47).
- The revert detector and `merge-lane-breaker.js` are unchanged. The breaker still trips on a changes-requested label and on a detected revert.
- Once contracted, an approved record becomes exposed to revert and failure-marker evidence. Today `verdict` reads an approval as good even when the closing commit was later reverted.
- **Defers:** #5717 (parked measurement and contract step, due 2026-12-16).
