# Manifesto — Override Semantics

This Override semantics table is loaded only when the Manifesto runs as an approval gate (`confirm`/`hybrid`) and the user picks Override; the Merge verification values below are `_shared/pr-first-merge.md`'s gate vocabulary.

| Lever | Option | What changes |
|---|---|---|
| Mode | `hybrid` | Same as auto but skills still prompt when reversibility/confidence floors or the severity ceiling fail |
| Mode | `interactive` | Skips the Manifesto pipeline-wide; every skill presents decisions in-flow as today |
| Scope-creep | `stop-and-ask` | Pipeline pauses inline when files outside plan are referenced |
| Scope-creep | `drop` | Files outside plan are noted in `decisions.md` but not added |
| Leftover routing | `backlog` | Unfinished sections route to a new work record with no stage label, instead of `parked` |
| Leftover routing | `drop` | Unfinished sections are noted in `decisions.md` but no work record staged |
| Auto-fix threshold | `lint-only` | Type errors surface as prompts; tests always surface |
| Auto-fix threshold | `lint+type+test` | Mechanical test failures also auto-fixed (rare; risky — semantic changes hidden) |
| Review auto-apply ceiling | `none` | Every non-critical finding staged for the Review Console, nothing auto-applied (highest friction, lowest revert load); Critical still prompts. One exception: with `review-auto-apply-prose-exempt` on (the default), a Low fix touching only prose files routes at `low` and auto-applies |
| Review auto-apply ceiling | `low` | LOW auto-applied; MED and HIGH staged; only Critical prompts |
| Review auto-apply ceiling | `medium` | LOW + MED auto-applied; HIGH staged; only Critical prompts |
| Ceremony profile | `standard` | Forces full-depth wrap-up ceremony (reflect full mode, unrestricted skill-curation scan, doc/CLAUDE.md/ADR sub-scans) even though `ceremony-check` verdicted `fast-lane` for every record |
| Ceremony profile | `fast-lane` | Forces the fast-lane shape even if a record's `ceremony:*` label or ceremony-check verdict was `standard` (or one member of a bundle was) — an active, informed human override, not the automated default |
| Model stance | `economy` | Every profile's resolved effort drops one notch on `EFFORT_SCALE`; a Frontier resolution additionally degrades to Capable — lower cost, lower rigor |
| Model stance | `max-rigor` | Every profile's resolved effort rises one notch, capped at `max`; never promotes a profile's model upward |
| Merge verification | `merge-when-green` | Merge sites arm `--auto` and let the forge merge once checks are green (the derived recommendation on a default-branch pr-first repo with PR CI) |
| Merge verification | `wait` | Merge sites block on the checks before merging — explicit-config-only, never derived |
| Merge verification | `off` | Merge sites merge without consulting CI (the derived value for local-merge, no-PR-CI, or non-default-integration-branch repos) |
| Design critique | `full` | Every web-track UI diff gets the full critic roster at review time regardless of `DESIGN.md` presence |
| Design critique | `off` | No project-local critics run at review time; Impeccable's own `critique`/`audit` and the finish reviewer are unaffected |
| Merge authorization | `pre-authorized` | Pre-authorizes this run's own terminal merge — see `wrap-up/review-console.md`'s Auto-merge short-circuit. A live, explicit override answer; never a standing default. |
