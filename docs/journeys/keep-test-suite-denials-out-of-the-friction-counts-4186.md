---
files:
  - plugin/bin/lib/calibration/events-reader.js
  - plugin/bin/calibration-report.js
  - plugin/skills/wrap-up/review-console.md
  - plugin/bin/friction-events.js
  - tests/review-console-events-test-exclusion-conformance.test.js
---

# Keep Test-Suite Denials Out of the Friction Counts

**Persona:** a claude-tweaks maintainer who runs `npm test` inside a pipeline run's worktree, then reads that run's wrap-up Review Console. Later they run `calibration-report.js` to decide whether a gate is earning its keep.
**Goal:** the console and the calibration read-out show only the hook denials that real operator work hit. The test suite's own deliberate exercise of the hooks' deny logic should not show up as friction.
**Entry point:** a test in the suite runs `plugin/bin/lib/hooks/pre-tool-use.js` with `CT_HOOKS_TEST_MODE=1` against a run dir. The hook appends a `gate-denial` (or `wd-guard-refusal`) event tagged `test: true` to that run's `events.jsonl` (#1337, widened #2282).
**Success state:** the Review Console's event list and `calibration-report.js`'s `### Friction events` section both count only untagged denials. A run whose `events.jsonl` holds one `test: true` gate-denial and one real one shows `gate-denial: 1`.

## Steps

### 1. Run the suite: the hook tags its own test denials
- **URL:** `npm test` (any suite that drives the PreToolUse dispatcher with `CT_HOOKS_TEST_MODE=1`)
- **Action:** the deny path writes a `gate-denial` event carrying `test: true` into whichever run dir the hook resolved. Real operator denials are written by the same code without the tag.
- **Should feel:** invisible. The maintainer does nothing extra, and the suite's assertions that the event is written still pass.
- **Should understand:** the tag is the only thing that distinguishes a test denial from a real one. Readers drop tagged events at read time and never at the write site, so the tests that assert the event exists still see it.
- **Red flags:** a test denial written with no `test` field. No reader can exclude it, and it shows up as friction. A denial that names a tmp/scratchpad path is not evidence of this on its own: the #4186 wrap-up found 238 such archived denials, and the sampled ones were real operator-session denials on a session scratchpad, not test-suite hook runs.

### 2. Read the run's events at the Review Console: wrap-up
- **URL:** `/claude-tweaks:wrap-up` → `plugin/skills/wrap-up/review-console.md` → Read inputs item 4 (`events.jsonl`)
- **Action:** the console surfaces `wd-deny`, `wd-push-mismatch`, `contract-violation`, and `gate-denial` events, and skips any `gate-denial` carrying `test: true`.
- **Should feel:** trustworthy. Every denial listed is one the maintainer's own session actually hit, so the list is worth reading line by line.
- **Should understand:** the console states the exclusion itself instead of routing through `friction-events.js`. That CLI's narrower vocabulary would drop `wd-push-mismatch`, and it also applies claim-boundary and attribution filters the console never used.
- **Red flags:**
  - a `gate-denial` naming a temp-dir fixture path appears at the console after a local `npm test`;
  - `wd-push-mismatch` disappears from the console's event list.

### 3. Read the calibration friction counts: calibration-report
- **URL:** `node plugin/bin/calibration-report.js [--runs N] [--json]` from the main checkout
- **Action:** `readEventsKinds` (`plugin/bin/lib/calibration/events-reader.js`) counts each archived run's event kinds, skipping `gate-denial` and `wd-guard-refusal` lines whose `test` is literally `true`. A `test: false` line, an untagged line, and a `test: true` line of any other type are all still counted.
- **Should feel:** a measurement the maintainer can act on. A gate's `gate-denial` count reflects operator cost, not how often the test suite ran.
- **Should understand:** the predicate means exactly what `friction-events.js`'s `readEvents` applies. Nothing else is filtered here (no attribution, claim-boundary, or contract-violation variant filtering).
- **Red flags:**
  - `--json`'s `frictionCounts["gate-denial"]` moves when only test-tagged lines were added to an archived run;
  - a `test: true` `commit` (or other non-denial) line disappears from the counts.

## Origin
- Created during build of #4186
- Steps 2-3 are the change; step 1 is the existing tagging (#1337, #2282) both readers rely on
- Related specs: #1337 (the `test: true` tag and `friction-events.js`'s exclusion), #2282 (widened to `wd-guard-refusal`), #2783 / #3442 (other `friction-events.js` read-boundary journeys: `see-an-ad-hoc-sessions-friction-at-wrap-up-2783.md`, `see-a-runs-friction-east-of-utc-3442.md`)
