---
record: 604
origin: human
risk: low
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 604: resolve-policy: make the merge-verification/integration-model dedup regression-testable

Surface: backend

Origin: ledger resolve gate (spec 559 wrap-up, run 2026-08-16T101528-spec-559-560)

## Current State

`bin/resolve-policy.js` reuses the already-resolved `integration-model` value when both `integration-model` and `merge-verification` are requested together (no second forge detection — one `gh` call instead of two per `--all`). The regression test added for it (`tests/merge-verification.test.js`, "requesting integration-model and merge-verification together reuses…") uses the AC1 fixture whose `integration-model` is set explicitly in `policy.yml`, so `resolveIntegrationModel` short-circuits before `detectIntegrationModel` runs either way — the test passes with or without the dedup and does not actually guard it.

A discriminating test needs a fixture where `integration-model` is *unset* and forge detection actually runs, which in a temp repo means a real remote + authenticated `gh` (non-deterministic across CI/gh-absent sandboxes) — or restructuring `resolve-policy.js` so the derivation dependencies are injectable/countable from a test. Either expands scope beyond the record (#559) that originally introduced the dedup, so it wasn't fixed in that run.

## Deliverables

Make the `integration-model`/`merge-verification` dedup regression-testable, via one of:

- Make `resolve-policy.js`'s computed-default blocks accept an injectable resolver map (test-only env var or module export) and count `detectIntegrationModel` calls in the test.
- Extract the two computed-default blocks into a small `bin/lib` helper with a unit-testable signature (`computeDerivedDefaults(result, keys, root, deps)`) and test the reuse there directly.

## Acceptance Criteria

- A new or rewritten test exercises a fixture where `integration-model` is unset (forge detection must actually run) and asserts `detectIntegrationModel` (or the equivalent forge-detection call) executes exactly once when both `integration-model` and `merge-verification` are requested together.
- Reverting the dedup makes this test fail — confirmed by a revert-and-rerun check, not just by reading the test.
- `npm test` green.

## Technical Approach

Prefer whichever of the two candidate directions keeps `bin/resolve-policy.js`'s existing external contract (its CLI flags and output shape) unchanged — the injectable-resolver approach is likely the smaller diff, but the extracted-helper approach is more directly unit-testable without CI-only non-determinism. Pick at build time based on which integrates more cleanly with the existing computed-default blocks.

### Key Files

- `bin/resolve-policy.js`
- `tests/merge-verification.test.js`

## Gotchas

- The existing `tests/merge-verification.test.js` test that doesn't discriminate must either be replaced or extended — not left alongside a new test as a redundant, non-discriminating duplicate.
- Avoid a fixture that depends on a real git remote + authenticated `gh` in CI — that reintroduces exactly the non-determinism this record exists to avoid.

## Original request

resolve-policy: make the merge-verification/integration-model dedup regression-testable

Origin: ledger resolve gate (spec 559 wrap-up, run 2026-08-16T101528-spec-559-560)

## Problem

bin/resolve-policy.js reuses the already-resolved integration-model value when both integration-model and merge-verification are requested (no second forge detection — one gh call instead of two per --all). The regression test added for it (tests/merge-verification.test.js, "requesting integration-model and merge-verification together reuses…") uses the AC1 fixture whose integration-model is set explicitly in policy.yml, so resolveIntegrationModel short-circuits before detectIntegrationModel either way — the test passes with or without the dedup and does not guard it.

## Why not fixed in-run

A discriminating test needs a fixture where integration-model is *unset* and forge detection actually runs, which in a temp repo means a real remote + authenticated gh (non-deterministic across CI/gh-absent sandboxes) — or restructuring resolve-policy.js so the derivation dependencies are injectable/countable from a test. Either expands scope beyond the record (#559) that introduced it.

## Options

- Make resolve-policy.js's computed-default blocks accept an injectable resolver map (test-only env var or module export) and count detectIntegrationModel calls, or

- Extract the two computed-default blocks into a small bin/lib helper with a unit-testable signature (`computeDerivedDefaults(result, keys, root, deps)`) and test the reuse there.

Files: bin/resolve-policy.js, tests/merge-verification.test.js (parked finding from the SDD whole-branch review of #559, ledger item #1).

