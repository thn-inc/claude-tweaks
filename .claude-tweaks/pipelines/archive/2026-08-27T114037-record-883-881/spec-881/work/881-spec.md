---
record: 881
origin: capture
risk: low
size: low
ceremony: standard
grants: [build]
surface: backend
---
# 881: test: suite-count regression stamp — flag when the suite gets quieter

Surface: backend

## Current State

IL-84 documented that fifteen tests silently never ran under an enumerated-glob `npm test` configuration — under-coverage looked identical to success, since `/claude-tweaks:test` verifies exit codes but never verifies that the run actually examined what it should have (IL-78). Related: #250, #892.

## Deliverables

- [ ] Record the test count (number of tests actually executed) for every `/claude-tweaks:test` verification run.
- [ ] Compare the current run's test count against the previous recorded run's count.
- [ ] When the count drops, surface it as a caveat line in the test run's output — not a silent pass — rather than treating a lower count as equivalent to success.

## Acceptance Criteria

1. `/claude-tweaks:test` (or the underlying test-running procedure it invokes) records the executed test count after each run, persisted somewhere queryable by the next run (e.g., a small state file).
2. A test-count drop between consecutive runs produces an explicit caveat line in the verification output, distinct from a normal pass/fail summary line.
3. A fixture reproducing IL-84's exact shape (a glob silently excluding files, dropping the count) is covered by a new test, confirming the caveat fires.
4. `npm test` passes with new coverage included.

## Technical Approach

Most test runners (including `node --test`'s own output) report a total test count in their summary; this feature just needs to capture that number, persist it between runs (a small JSON state file, similar to other lightweight state-tracking patterns already used in this repo, e.g. `reconcile-cache.json`), and diff against the previous value. The comparison and caveat-emission logic belongs in whatever wraps `npm test`'s invocation for `/claude-tweaks:test` — likely `plugin/skills/test/` prose plus a small helper in `plugin/bin/lib/`.

### Key Files

- `plugin/skills/test/SKILL.md` — invoke the count-capture and comparison
- `plugin/bin/lib/` — new small module for persisting/comparing test counts
- `tests/` — new fixture reproducing the IL-84 count-drop shape

## Gotchas

- A test count can legitimately drop when tests are deliberately removed (a refactor, a retired feature) — the caveat should flag the drop for human awareness, not treat every drop as an error to block on; this is a caveat/surfacing mechanism, not a hard gate.
- Persisted state (the previous run's count) needs a sensible reset/bootstrap behavior for the very first run, where there's nothing to compare against yet.

## Original request

test: suite-count regression stamp — flag when the suite gets quieter

**Related:** #250, #892

Context: IL-84 — fifteen tests silently never ran under an enumerated-glob npm test; under-coverage looks identical to success, and /test verifies exit codes but never that the run examined what it should (IL-78).

Scope: record the test count per verification run, compare against the previous run, and surface a drop as a caveat line instead of silence.

