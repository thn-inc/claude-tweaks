<!-- Sibling of `_shared/policy-schema.md` — its "## Efficiency budgets" lever-table detail, split out per IL-70 (split-by-unit) so the index file keeps headroom under its size ceiling. -->

## Efficiency budgets

Registered by #4029; the reader is `readEfficiencyCeilings(repoRoot, profile)` in `bin/lib/policy.js` (`profile` is `fast-lane` or `standard` — any other value throws a `TypeError`), called by `bin/phase-timing.js --check-budgets`, which compares a finished run's totals against the ceilings of that run's ceremony profile (`_shared/ceremony-profile.md`). A breach is reported and staged, never blocking: the check exits 0 in every derivable case. Every key is an integer with `min: 0`, resolved through `resolveValue`, so an absent, blank, non-integer or negative value falls back to the default. **`0` disables that one budget** (it is a legal value, not an invalid one). None is a Manifesto lever.

**Where the defaults come from.** Each default is the p90 of the 143 archived runs on 2026-10-24, rounded up to the next whole unit: fast-lane round trips 412 -> `420`, procedure 557.5 KB -> `560`, verify 20.1 min -> `21`; standard round trips 897 -> `900`, procedure 576.3 KB -> `580`, verify 36.1 min -> `37`. A ceiling at the p90 flags roughly the heaviest tenth of runs on the archive it was measured from; re-derive them from a newer archive rather than editing one in isolation.

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `fast-lane-run-round-trip-ceiling` | `policy.yml` | `bin/phase-timing.js --check-budgets` | `420` | Model round trips (assistant turns) one `fast-lane` run may total across all phases before the check reports a breach; `0` disables |
| `fast-lane-run-procedure-kb-ceiling` | `policy.yml` | `bin/phase-timing.js --check-budgets` | `560` | Kilobytes of skill procedure text (SKILL.md and lazy-loaded sub-files) one `fast-lane` run may load before the check reports a breach; `0` disables |
| `fast-lane-run-verify-minutes-ceiling` | `policy.yml` | `bin/phase-timing.js --check-budgets` | `21` | Minutes one `fast-lane` run may spend in verification (test/lint/typecheck runs) before the check reports a breach; `0` disables |
| `standard-run-round-trip-ceiling` | `policy.yml` | `bin/phase-timing.js --check-budgets` | `900` | Same measure as `fast-lane-run-round-trip-ceiling`, for a `standard` run; `0` disables |
| `standard-run-procedure-kb-ceiling` | `policy.yml` | `bin/phase-timing.js --check-budgets` | `580` | Same measure as `fast-lane-run-procedure-kb-ceiling`, for a `standard` run; `0` disables |
| `standard-run-verify-minutes-ceiling` | `policy.yml` | `bin/phase-timing.js --check-budgets` | `37` | Same measure as `fast-lane-run-verify-minutes-ceiling`, for a `standard` run; `0` disables |
