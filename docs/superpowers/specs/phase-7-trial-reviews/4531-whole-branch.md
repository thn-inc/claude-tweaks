### Strengths
- The fix in `plugin/bin/lib/flow/pr-body.js:344-352` is small and correct. `locateSpecSummary` now builds the shared `fencedLineMask` from `markdown-blocks.js` instead of a new fence parser. It applies the mask both to the search for the `### Spec summary` start heading and to the search for the end heading, so a fenced heading can neither start nor end the span.
- `{ unclosedAsText: true }` is the right setting for this caller. `reviseSpecSummary` replaces everything from `span.start` to `span.end`, so with the default setting a stray unclosed fence would push the end to EOF, and a rewrite would delete `### Phases` and every section after it. The review-fix commit noticed this and pinned it with `tests/bin-lib/flow/pr-body-unclosed-fence-4531.test.js`.
- The tests exercise real behaviour through the public `reviseSpecSummary`, with no mocks. All three fail on the unfixed reader:
  - Fenced `### x` inside the span: the old reader ends the span early and keeps `### x`.
  - Fenced start heading: the old reader picks the fenced line as the start, rewrites inside the fence and leaves `Old.` behind.
  - Unclosed fence: this one only matters together with the new mask.
- AC2 is met, tested through `reviseSpecSummary` rather than by comparing spans directly. AC1 was already met before this PR: `splitSections` in `compose.js:24-30` already used `fencedLineMask` at base, and `tests/bin-lib/issues/materialize-format.test.js:736-745` already asserts that a fenced `## Original request` stays inside the Deliverables content. The PR body says this correctly ("already used 'fencedLineMask' on this branch, so I left it alone").

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **Deliverable 3 (the sweep by pattern) was not done, but the PR still closes the record.** The PR body says "I did not do ... the deliverable 3 sweep", yet the fixes span carries `Fixes #4531`, so merging closed the record with this deliverable silently dropped.
   - **Why it matters:** this breaks the project's "No implicit deferrals" rule. The sweep also had something to find.
   - **What a quick pattern grep at head turns up:** `plugin/bin/lib/issues/parent-gate.js:55` defines `HEADING_LINE_RE = /^## Closed below the oversight floor\s*$/m`. It is applied, with no fence skip, to a parent record's body at `:390` (`source === 'body'`) and to comment bodies at `:73` and `:397`.
   - **Effect:** a body or comment that quotes the marker heading inside a code fence is read as the close marker. For a body, idempotence becomes `close-only`, so the gate closes the parent without posting its comment.
   - **Already fence-aware:** `record-acceptance-target.js`, `record-risk-flags.js` and `record-payload.js` `ownOriginLine`.
   - **Out of scope, since they read decisions.md, CHANGELOG or CLAUDE.md templates rather than record or PR bodies:** `closing-tally.js:148`, `resume-eligibility.js:440`, `init/claude-md-conformance.js:59`, `changelog.js`, `residue/probes/release.js`.
   - **Fix:** finish the sweep as a follow-up. Either migrate `parent-gate.js` onto the shared mask or record why the marker check is exempt, and list the exclusions above with their reasons. Alternatively, file the sweep as its own record through the deferral gate rather than leaving it unrecorded.
2. **Deliverable 2 is reported as "not done", but it was already done before base.** At base, `release-note-repair/apply.js:24-33` `fenceInfo` already calls `fencedLineMask` and `unclosedFenceLine` and carries a comment explaining the convergence (#4350). The record's description of a divergent `fenceInfo` is out of date.
   - **Why it matters:** the deliverable is met, but the PR body tells the reader it was skipped. That leaves a false open item for whoever audits the closed record.
   - **Fix:** correct the record or PR note to say D2 was already met by #4350.

#### Minor (Nice to Have)
1. **`plugin/bin/lib/markdown-blocks.js` caller roster not updated.** Its header comment lists "The one fence rule. Its callers, from a grep of plugin/bin...", and under `fencedLineMask` it names each consumer. `locateSpecSummary` (`flow/pr-body.js`) is now a new consumer, and the only one using `unclosedAsText` besides the option's own description, but it was not added. The roster claims to be complete, so it is now stale. Add the entry.
2. **`plugin/bin/lib/flow/pr-body.js:341-343`:** the comment above `locateSpecSummary` still describes the span as running "up to the next level 1-3 heading". It does not mention that fenced lines are skipped, or why an unclosed fence is read as text here when `splitSections` uses the default. One clause would stop a future reader from "harmonising" the two.
3. **Test placement is inconsistent.** One #4531 test went into the existing `tests/bin-lib/flow/pr-body-premise-reversal.test.js`, while the other two were added as one-test files (`pr-body-fenced-start-4531.test.js`, `pr-body-unclosed-fence-4531.test.js`) beside it. Folding them into the existing suite would match where the first one went.
4. The head commit subject has a duplicated "— refs — refs #4531". It does not matter after the squash and is only noted for hygiene.

### Recommendations
- Before writing "Fixes #N" on a PR that skips deliverables, either finish them or route each skipped one through the deferral gate with a `Defer-reason:`. Do not close the record with them unaddressed.
- When a record's Current State describes code that later PRs have already changed (D2 here, and AC1's reader), say in the PR that the item was already met, rather than calling it "not done".

**Declined to judge:**
- Fence handling in `closing-tally.js`, `resume-eligibility.js`, `init/claude-md-conformance.js`, `changelog.js` and `residue/probes/release.js`: they parse decisions.md, CLAUDE.md templates or CHANGELOG text, not record or PR bodies, so they are outside D3's scope.
- Whether `parent-gate.js`'s comment-body scan should skip fences on the GitHub path: the record covers record and PR bodies, and comments are a neighbouring surface. I flagged it only as part of the sweep finding.
- AC3 (`npm test` passes): per my instructions I did not run the suite. The PR body admits the implementer ran only two test files, not the full suite.
- CRLF behaviour of `locateSpecSummary`: it is unchanged by this diff, and the shared fence rule already tolerates a trailing CR.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The `locateSpecSummary` change is correct, well tested, and uses the shared fence rule with the right unclosed-fence policy. But the PR closed #4531 with Deliverable 3's sweep undone, and that sweep has at least one real candidate (`parent-gate.js`). It also misreports D2, which was already met, as skipped.

DONE_WITH_CONCERNS
