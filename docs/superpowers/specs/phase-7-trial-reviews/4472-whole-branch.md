### Strengths
- The contract's Scratch rule (`plugin/skills/_shared/subagent-output-contract.md:39`) now names all three never-delete scopes the record asks for: a parent, the session scratchpad or temp root, and any path not textually under the `SCRATCH:` path. The wording follows the record's Deliverables text closely. It sits in the cleanup sentence itself, where an agent deciding what to `rm` will read it.
- The one-line prohibition added to the three `SCRATCH:` sites that were changed (`step3-debate-and-refutation.md:106`, `:140` and `step3-lens-dispatch.md:87`) is the same sentence each time. It goes right after the "must be deleted before your status word" clause, which is the moment the agent decides what to delete. The existing Bash and worktree guidance is left alone.
- In `step3-lens-dispatch.md:87` the prohibition is written as an instruction to the composer ("Tell the agent: ..."). That fits a site that describes the line rather than giving its literal text.
- The new test reads files through `readText` (CRLF-safe, which the `raw-markdown-read-conformance` rule requires). It counts matches per file with a floor, so one missing copy in the debate file fails it. The regex starts at `ever delete` so it matches both "Never" and "never".

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **`plugin/skills/review/step3-tiebreak.md:69` and `:105`: two `SCRATCH:` dispatch lines still lack the prohibition.** Both templates grant `SCRATCH: {ctx-dir}/agent-scratch/{agent-id}` with the same "must be deleted before your status word" wording as the debate templates, and neither got the new sentence. The record requires "every other dispatch template that grants a scratch path" to carry it, and its AC says "Every `SCRATCH:` dispatch line in plugin/skills carries the prohibition". The gap goes further than these two templates: `plugin/skills/tidy/console-backfill.md:105-113` pastes tiebreak's single-finding template verbatim into each backfill agent's prompt. So the tiebreak agents and the console-backfill agents, dispatched in waves of 8, all still get the unguarded wording that caused #4472. Fix: add the same sentence ("Never delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path.") after the Scratch-rule citation on both lines.
2. **`plugin/skills/review/step3-workflow-dispatch.md:17`: the Workflow-path `SCRATCH:` line lacks the prohibition.** It tells each lens worker to `mkdir -p {ctx-dir}/agent-scratch` and then `mktemp -d {ctx-dir}/agent-scratch/{lens}-XXXXXX`. Of all the sites, this one most needs the rule. The agent creates `agent-scratch` itself, so an agent cleaning up "what it created" can reasonably decide to delete that shared parent and with it every sibling lens's directory. That is the #4472 failure one level down. Fix: add the prohibition, worded for the `mktemp`-printed path, e.g. "Never delete `{ctx-dir}/agent-scratch` itself, a parent, the session scratchpad or temp root, or any path outside the directory mktemp printed." Also add a pin in `tests/review-lens-workflow-dispatch-conformance.test.js` or in the new suite.
3. **`tests/scratch-never-delete-conformance.test.js:14-20`: the test does not do what the AC asks.** The AC says "a conformance test fails when one is missing" for *every* `SCRATCH:` dispatch line in plugin/skills. The test hard-codes two files with minimum counts. It cannot see the tiebreak and workflow-dispatch lines (which is why issues 1–2 passed). It also stays green if someone adds a new `SCRATCH:` template to an existing file without the sentence, as long as the count floor still holds. Fix: scan `plugin/skills/**/*.md` for dispatch lines starting with `SCRATCH:` (or the backticked form), and check that each line (or its paragraph) carries the prohibition. Allow-list descriptive mentions such as `step3-lens-dispatch.md:61`, `_shared/subagent-dispatch-core.md:158` and `tidy/console-backfill.md:113`, and use a matched-site floor so a regex that breaks cannot pass vacuously.

#### Minor (Nice to Have)
1. **`plugin/skills/_shared/subagent-output-contract.md:39`: "that path" now points at the wrong thing.** The new clause sits between "The agent deletes what it created there" and "a dispatch granting write access must name that path". "That path" now reads as the last-mentioned path ("any path not textually under the `SCRATCH:` path") instead of the scratch directory. Fix: reword it to "must name its scratch directory", or move the new clause after that sentence.
2. **`tests/scratch-never-delete-conformance.test.js`: the new test was not shown failing.** The diff gives no evidence that someone reverted the prohibition to watch it fail. With a ≥min count against byte-exact literals it very likely does discriminate, but confirm by deleting one of the two debate copies and checking the test turns red.

### Recommendations
- After adding the missing sentences, grep `plugin/skills` once for `SCRATCH:` and `agent-scratch` and sort every hit into "dispatch template" (must carry the prohibition) or "descriptive mention". Write that list into the test's allow-list so the sorting is checked by the test rather than done by hand.
- Wording the workflow-dispatch line separately from the `{agent-id}` templates is justified, because there the agent creates the shared parent itself. The contract sentence covers this in general terms ("only paths created inside the exact `SCRATCH:` directory"), but the dispatch line should name `agent-scratch` outright.

### Declined to judge
- Callers deleting scratch from outside the agent (`step3-lens-dispatch.md:183`, the agent-scratch cleanup check). That runs in the orchestrator, not in a dispatched agent, and the record covers only agent-side cleanup.
- Enforcing the scope mechanically (for example, a PreToolUse gate that refuses `rm -rf` on a path above the `SCRATCH:` path). The record asks for prompt text and a conformance pin only; a hook gate would be a separate design.
- Scratch-like paths in non-review skills that are not written as `SCRATCH:` dispatch lines (`design-wrapper/modes/review.md:187`, `feedback/upstream-draft.md`). These are the skill's own scratch writes, not a scratch path granted to a dispatched agent.
- Whether `npm test` passes. I was told not to run the suite, and I saw no existing test that pins the changed lines byte-for-byte in a way that would break.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The contract change and the three changed sites are right and well placed. But three `SCRATCH:` dispatch lines are still missing the prohibition: two in `step3-tiebreak.md` (whose template console-backfill also pastes) and one in `step3-workflow-dispatch.md`, which is the site most exposed to deleting a shared parent. That fails the record's "every `SCRATCH:` dispatch line" deliverable and AC, and the test is built so it cannot catch the gap.

DONE_WITH_CONCERNS
