# Tidy — Step 6 Rationale Appendix

Cited from `tidy/step-6-auto.md`; holds the why behind rules stated there, never a rule an agent must follow.

## Auto-apply rows — why `local-files` matters most

From `step-6-auto.md`, the paragraph "An Auto-apply row must be safe for every finding its class can produce":

This matters most on
`local-files`, where no staging review downstream catches a misclassification before the edit
lands. The `Expiry summary` (`local-files`) row is the worked example: its unparseable-
`{provenance}` exclusion lives in `digest-sweep.md`'s Expiry procedure, so the row itself can
stay a one-line tier assignment.

## Staging — sidecar and `.md` prose sync

From `step-6-auto.md`, the paragraph after the sidecar-fields description in "Staging a Stage-tier item":

Nothing enforces that the sidecar's fields stay in sync with the `.md` file's own prose — both
describe the same proposal, but only the `.json` side is ever read back to render the report.
Keep the two consistent by hand when composing them; a future divergence between a staged item's
human-readable text and its machine-readable fields is a smaller, cosmetic version of the drift
this section closes, not eliminated by it.

## Archival compaction — where else stale run dirs are caught

From `step-6-auto.md`, the paragraph after the two rules in "Archival compaction":

These two rules cover `interrupted`/unreadable runs on a 30-day clock — not the only place a stale run dir gets caught. A run whose `run-state.json` reached `status: clean` without being archived surfaces immediately, no age wait, via `bin/residue.js`'s `pipeline-run` finding (`bin/lib/residue/probes/pipeline-runs.js`; a tidy/sweep standalone run still holding `staged/` items is exempt, left for `--approve` and the two 30-day archival-compaction rules (standalone runs; abandoned non-standalone runs), #4138) — but post-#1118, `/wrap-up`'s own `--scope blast-radius` residue sweep reads only the invoking run's own dir; every `/tidy` Step 4.5 `--scope repo` pass still reads them all.
