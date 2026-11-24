### Strengths
- The refusal is put in the right place in `measure()` (`plugin/bin/context-gauge.js:206`). It runs after the measurement and the `over`/`nextSteps` early return, and before the caller-identification check, the wrap-up refusal and `readHandoffCount`. So a refused handoff never uses up one of the run's three handoffs, and nothing is written.
- It uses the gauge's existing fail-open path. The refusal comes back as `over: true, handoff: null` plus a `reason`, which `run()` already logs as a SKIP to decisions.md. The omission therefore shows at the Review Console, not silently, which is what AC1's "the gauge reports the omission" asks for.
- The ordering check is stricter than the record required, and rightly so. It refuses a list that names `stories` after `test` (`test,review,stories`), not only one that leaves `stories` out. The new test file pins that case.
- AC2 holds by construction. Without `--stories-owed`, behavior is byte-identical to before, so a `no-stories` run or a run with no UI changes hands off as it does today.
- The SKILL.md line reuses the existing "Automatic story generation" trigger (Layer 3 sniff, no `no-stories`) rather than defining "UI files changed" a second time, as the record's Gotcha asked.
- The tests run the real CLI against a git fixture and read the real `handoff.json`. They cover the refused list (`test,review`), the accepted list (`stories,test,review`, with `nextSteps` checked) and the wrong-order list.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **The fix depends on the caller asserting the very fact the reported failure lost** (`plugin/bin/context-gauge.js:106,206`, `plugin/skills/flow/SKILL.md:180`).
   - What's wrong: the gauge only notices an owed stories step if the orchestrator passes `--stories-owed`. In the reported run, the orchestrator broke the prose rule "gauge after `build`'s automatic `stories`" and gauged early. The new safeguard is one more prose rule ("Gauging before … adds `--stories-owed`") that the same orchestrator, in the same state, has to remember. If it gauges early and leaves the flag off, the handoff with `test,review,polish` is written exactly as before, and the step is still lost silently.
   - Why it matters: Deliverable 1 is "no longer loses that step silently". This change only closes that gap for a caller that already knows stories are owed, and that caller would just run stories first. The record's Technical Approach named a run-dir marker set by build, which works mechanically and does not depend on the orchestrator behaving.
   - How to fix: have build (or flow's Step 4 right after build, using the Layer 3 sniff) write a stories-pending marker into the run dir, and have the stories step or `no-stories` clear it. The gauge then reads the marker itself, keeping `--stories-owed` at most as an override. If the flag-only design is a deliberate choice, say so explicitly in the PR so the executor can rule on it.
2. **`context-handoff.md`, a Key File for this record, now contradicts SKILL.md** (`plugin/skills/flow/context-handoff.md:11`).
   - What's wrong: that file still says build and its automatic `stories` are "one unit: gauge after `build`'s automatic `stories` … never between them". The new SKILL.md:180 line describes gauging before stories and handing off with `stories` first. The resume procedure was not updated either: nothing tells the resumed agent that a leading `stories` step is the owed automatic step, or that it should run even though build is not in its list.
   - Why it matters: a resumed agent reading the canonical resume doc gets contradictory guidance.
   - How to fix: add a sentence to `context-handoff.md` that covers the sanctioned exception, worded the same way as the SKILL.md line.
3. **The new flag is undocumented everywhere the CLI documents itself** (`plugin/bin/context-gauge.js:7-69` header comment, `:87-95` `USAGE`, and `docs/plugin-structure.md:321`).
   - What's wrong: `--help` and the header synopsis do not list `--stories-owed`. The header's list of refusal reasons ("a handoff that cannot be written — …") and `plugin-structure.md`'s CLI entry both leave out the new refusal.
   - Why it matters: this file keeps a full contract in its header, and the CLAUDE.md philosophy is to rename or document a change everywhere. An agent running `--help` cannot discover the flag.
4. **`--stories-owed` is silently accepted with `--record-steps`, where it means nothing** (`plugin/bin/context-gauge.js:279-290,206`).
   - What's wrong: under `--record-steps`, `nextSteps` is the union of every record's steps, so the `indexOf('stories') < indexOf('test')` check compares positions in a union that has no single order. It can refuse or accept by accident. `--keep-going` and `--no-stories` both get an explicit usage error when used with the wrong form; this flag gets no such guard. `multi-spec.md`'s Context cap section also says nothing about it.
   - Why it matters: a multi-spec caller may pass the flag and get a meaningless verdict.
   - How to fix: add `if (o.storiesOwed && o.nextSteps === undefined) return usageError('--stories-owed is valid only with --next-steps')`, or define what it means per record.

#### Minor (Nice to Have)
1. `tests/bin-lib/timing/context-gauge.test.js:485-486`: the new test was inserted between the comment `// flow/context-handoff.md: a top-level run … never hands off wrap-up.` and the `TOP_LEVEL_WRAPUP_REASON` block that comment describes. The comment now labels the stories-owed test. Move the new test above the comment.
2. `tests/bin-lib/timing/context-gauge-stories-order.test.js`: this is a whole new file for one test. It copies about 40 lines of fixture code (`runFixture`, `transcriptAt`, `turnLines`, `cli`, `configYml`) from `context-gauge.test.js`, and reuses the unrelated `record-4027` run id. Fold the test into the existing suite next to the other stories-owed test.
3. `plugin/bin/context-gauge.js:206`: the refusal reason says "--next-steps omits stories" even when `stories` is present but placed after `test`. Something like "omits stories or puts it after test" would be accurate. The condition is also one dense expression; a named `storiesFirst` boolean would read better.
4. There is no test that a list with `stories` and no `test` (for example `stories,review`) is accepted. The code allows it, but nothing pins that behavior.

### Recommendations
- Choose between a caller-asserted flag and a build-written marker before merging. As shipped, the change protects only callers who already follow the ordering prose, and those callers were never at risk.
- After the docs fix, check that `tests/flow-context-handoff-conformance.test.js` and `tests/dispatch-handoff-continuation-conformance.test.js` still agree with the new SKILL.md sentence and any `context-handoff.md` wording. The second matters because a dispatched build/test call would now hand off `stories,test` instead of `test`, and that suite pins the continuation template's "Stop after the test gate" one-entry `test` list.

**Declined to judge:**
- Whether a resumed `stories` step can find "the new journeys" without build's in-context output. The record does not ask how `/stories` scopes its work.
- Whether the context-cap ordering should become a mechanical check on all of Step 4's boundaries (polish/re-verify too). The record covers stories only.
- The test suite's pass/fail status (AC3). I was told not to run tests and judged from the code only.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The gauge-side refusal is correct, well placed and tested. But it only triggers when the caller volunteers `--stories-owed`, so the reported failure (an orchestrator gauging out of order) can still drop the stories step silently. The canonical handoff doc and the CLI's own help and contract text were also not updated to match.

DONE_WITH_CONCERNS
