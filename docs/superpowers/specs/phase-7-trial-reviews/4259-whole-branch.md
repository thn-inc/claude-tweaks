### Strengths
- The change does what the record asks for in the smallest way. One predicate, `isTestTaggedEvent`, now sits beside `FRICTION_EVENT_TYPES` in `plugin/bin/lib/friction-lens-vocab.js:27-33`, and all three consumers use it: `friction-events.js:194`, `calibration/events-reader.js:23` and `timing/derive.js:462`.
- Acceptance criterion 2 is met. In `plugin/bin`, the `parsed.test === true` check now appears only at `friction-lens-vocab.js:32`.
- The record's second deliverable is decided and applied in the shared predicate. `gate-exempt-gitignored` is added to the tagged types, so calibration now drops the test-tagged breadcrumbs that `pre-tool-use.js:1204` and `:1927` write. For `friction-events.js` this changes nothing, because that type is not in `FRICTION_EVENT_TYPES`.
- The predicate's type list matches every write site that adds a test tag in `plugin/bin/lib/hooks/`: 4 `gate-denial`, 5 `wd-guard-refusal` and 2 `gate-exempt-gitignored` call sites. `wd-ambiguous` and `wd-deny`, which `countGuardEvents` also counts, are never tagged, so the `derive.js` guard reaches only `gate-denial`, which is the intended effect.
- `derive.js:462` keeps the existing `Object.hasOwn` lookup and the null guard `e &&`. `isTestTaggedEvent` also guards falsy input itself with `Boolean(parsed)`.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **No test was added, and acceptance criterion 1 is not shown to hold.** The diff touches only the 4 production files.
   - The record's first acceptance criterion asks for one fixture `events.jsonl` with one `test: true` and one real `gate-denial`, and for the same real-only count from `friction-events.js`, `calibration-report.js` and `phase-timing.js`'s guard-cost figure.
   - Tests already cover the first two: `tests/friction-events-cli.test.js` and `tests/bin-lib/calibration/cli.test.js:354`.
   - Nothing covers the behaviour this PR actually changes:
     - `countGuardEvents` dropping a `test: true` `gate-denial`. `tests/bin-lib/timing/derive.test.js` has no such case.
     - Calibration dropping a `test: true` `gate-exempt-gitignored` event. `tests/bin-lib/calibration/readers.test.js:98` covers only `gate-denial` and `wd-guard-refusal`.
   - Why it matters: if the `derive.js:462` guard were reverted, every test would still pass. The criterion meant to prove the three counts agree has no test behind it.
   - Fix: add one fixture test that sends the same two-event `events.jsonl` through all three entry points and asserts they agree. Also add `countGuardEvents` and `readEventsKinds` cases for the newly covered type. Revert the guard once to confirm the new tests go red.

#### Minor (Nice to Have)
1. **`plugin/bin/lib/friction-lens-vocab.js:30`: nothing checks `TEST_TAGGED_TYPES` against the hook writers.** The list is right today. But the record was filed because of drift risk, and the list was already widened once (#2282).
   - If a hook adds `...testTag` to a fourth event type, the predicate will silently stop covering it.
   - The record offered the simpler option of "drops every `test: true` event regardless of type", which would avoid this.
   - Fix: either use `parsed.test === true` for any type, or add a conformance test that collects every type in `plugin/bin/lib/hooks/*.js` whose `appendEvent` spreads a test tag and asserts it equals `TEST_TAGGED_TYPES`.
2. **`plugin/bin/friction-events.js:65`: formatting slip.** The line reads `} =require('./lib/friction-lens-vocab');` with no space after `=`. The rest of the file uses `} = require(...)`.
3. **Two comments are now out of date.**
   - `plugin/bin/friction-events.js:89-91` still names only "a gate-denial or wd-guard-refusal event" as the excluded types.
   - `plugin/bin/lib/calibration/events-reader.js:20-22` still describes the exclusion as "the same rule bin/friction-events.js's readEvents applies". In fact both files now call the shared predicate, and calibration also drops `gate-exempt-gitignored`.
   - Fix: point both comments at `isTestTaggedEvent` in `friction-lens-vocab.js`, so the rule is described in one place.

### Recommendations
- Settle the type-list question (Minor 1) together with the missing test (Important 1). A conformance test over the hooks' test-tagged write sites would remove the drift risk the record was filed for.
- Declined to judge:
  - Whether `wd-guard-refusal` should count toward the guard-cost figure: `countGuardEvents` never counted it, and the record does not ask for that.
  - Whether `friction-lens-vocab.js` is the right home for a predicate that is not about vocabulary: the record names this file explicitly.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The refactor is correct and minimal, and it matches the record's deliverables and its grep criterion. But no test covers the new guard-cost exclusion or the newly dropped `gate-exempt-gitignored` type, so the fixture criterion is not shown to hold.

DONE
