### Strengths
- The routing rule is built from the two existing rules, as the record's Technical Approach asks. It cites the contract's "supply and re-dispatch once" for `NEEDS_CONTEXT`/`BLOCKED` and the partner-died single-read degrade, and it adds no third outcome path or extra Review Console item.
- It keeps the absence-claim order: "an absence claim takes the ground-truth check below first" (`plugin/skills/review/step3-lens-dispatch.md:109`). That matches the existing check at `:113`, which already covers a `BLOCKED`/`NEEDS_CONTEXT` reason that claims code is absent.
- It follows the hung-agent precedent (`:55`) for a dispatched reviewer: "a dispatched reviewer skips the re-prompt."
- The size limit holds. The file is 50,290 bytes at head against the 52,500 `RAIL_BYTES` rail. The new text went into the existing partner-death paragraph instead of a new paragraph, as the record's Gotchas suggest.
- The test reuses the suite's `between()` helper, anchors on the paragraph boundaries, and has a go-red mutant with `assert.notEqual(mutated, live)`, so a no-op mutation cannot pass by accident (`tests/review-absence-claim-ground-truth-conformance.test.js:93-111`).

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **The canonical `STAGED` template was not extended, so the new reason values have no template to fill** (`plugin/skills/review/step3-tier-variants.md:17`).
   - What's wrong: Deliverable 2 says "Extend the partner-died rule's `STAGED` line so its reason slot covers the new cause." The partner-died paragraph now lives in `step3-tier-variants.md`, and its template is still `Reproduction: lens "{lens}" {session limit twice | unavailable | timed out}; single-read coverage.` The diff only says, in `step3-lens-dispatch.md:109`, to fill "the paragraph's `STAGED` line with reason `blocked: {reason}` or `needs-context: {reason}`". That is a value the template's closed list doesn't allow.
   - Why it matters: a reader following the template sees three allowed values. The tier-variants paragraph's own text also still describes only session-limit, unavailable and timed-out causes. Its read-gate header (`:3`) lists only those cases, and the summary template's Coverage caveat example (`review-summary-template.md:25,43`) shows only timed out and unavailable. So the canonical rule and its consumers don't know the blocked case exists.
   - How to fix: add `| blocked: {reason} | needs-context: {reason}` to the alternation at `step3-tier-variants.md:17`. Add the blocked/needs-context cause to its read-gate sentence at `:3`. Optionally add an example to the caveat slot in `review-summary-template.md`.
2. **The machine reader of this line will not classify the new values** (`plugin/bin/lib/timing/pair-lines.js:151-152`).
   - What's wrong: the `single-read-coverage` form's pattern is `Reproduction: ${LENS} (?:session limit twice|unavailable|timed out); single-read coverage\.`. A `blocked: …` or `needs-context: …` line matches no form. `tests/bin-lib/timing/pair-lines.test.js:21,415-428` pins the template to the prose with the three-phrase list.
   - Why it matters: step-yield/timing reporting will silently undercount single-read degrades caused by a blocked lens. This is the silent-drop failure the record exists to remove, moved into telemetry.
   - How to fix: if issue 1 is fixed by extending the prose template, the AC3.3 pin will go red until `pair-lines.js` gets an additive pattern for `(?:blocked|needs-context): .+?`. The file's header requires additive patterns. Add the new phrases to `COVERAGE_PHRASES` too. These edits belong in this PR.
3. **The test pins only one site of an outcome that spans several** (`tests/review-absence-claim-ground-truth-conformance.test.js:93-100`).
   - What's wrong: the assertions check `step3-lens-dispatch.md` alone. Nothing pins the reason slot in the canonical template (`step3-tier-variants.md`), and `tests/review-dispatched-reviewer-degrade-conformance.test.js:44` byte-pins the old three-value literal.
   - Why it matters: the AC asks the test to show the coverage line's reason slot includes `blocked`/`needs-context`. Today that is only true of the instruction sentence, not of the template the dispatcher fills.
   - How to fix: once issue 1 is fixed, assert the extended alternation in `step3-tier-variants.md`. Update the `LOG_LINE_LITERAL` pin in the degrade conformance test to match.

#### Minor (Nice to Have)
1. **The go-red control mutates only part of the new text.** It replaces `is re-prompted once via \`SendMessage\`` rather than removing the whole sentence (`tests/...conformance.test.js:106-110`). It is red as it stands, but a second mutant that drops the `blocked: {reason}` clause would prove the reason-slot assertion discriminates too.
2. **`step3-lens-dispatch-record.md:26` does not name the new cause.** Its `failed` outcome lists "a session limit twice, unavailable, timed out, or the partner-died single-read degrade." The last item covers the blocked case transitively, but naming `blocked`/`needs-context` would keep the dispatch record's vocabulary in step with the `STAGED` line.
3. **The commit subject has empty parentheses.** It reads "…review Step 3 dispatch () — refs #3835", which looks like a placeholder that was never filled. It is harmless if the PR is squash-merged with a composed subject.

### Recommendations
- Treat this as a contract-reason extension across sites rather than a one-paragraph prose edit. The sites are:
  - the template in `step3-tier-variants.md` and its read-gate;
  - the `pair-lines.js` reader and its test;
  - the degrade conformance literal;
  - the summary template's caveat example.
- `dispatch/task-prompt.md` item 7 cites the partner-died paragraph by file and name, and that citation still resolves after this change.
- Declined to judge:
  - Whether a low-tier single-read agent (not in a reproduction pair) that replies `BLOCKED` should get the same rule. The new sentence sits in the Reproduction dispatch section, which is where the record scoped it.
  - Whether "truncated" needs a concrete length limit. The record says only "truncated."
  - The ordering problem when the absence check (which runs after the first `categorise-reproduction` call) refutes a reason after a re-prompt has already happened. The record says only "absence first", and the text says that.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The routing rule in `step3-lens-dispatch.md` is correct, well-placed and pinned. Deliverable 2 is not met at its source, though: the partner-died `STAGED` template in `step3-tier-variants.md` and its parser in `pair-lines.js` still allow only the three old reasons. The new coverage lines would be filled outside the template and missed by step-yield accounting.

DONE_WITH_CONCERNS
