### Strengths
- `pack.js:229-232`: the core fix is small and does what Deliverable 1 asks. `closingRecords` returns `null` only on the `unavailable` rung and keeps `records` / `[]` on every other rung. The comment at `pack.js:224-226` states the array-or-null meaning once, where the rule lives.
- `execution-and-verification.md:37-41` and `review-console.md:124` (step 11) follow the record's Decision. An array, empty included, is the set to use; an empty array stamps or records nothing; only a `null` field or a missing pack falls back to Phase 1. Both cite Section C step 2 and neither names a source rung, so `assertNoGateRestatement` holds.
- The Technical Approach asked for Section C step 2's bash to be confirmed by a test fixture rather than by reading. `tests/wrap-up-record-resolution-conformance.test.js` does this: it pulls the real `node -e` snippet out of `cleanup-procedures-execution.md` and runs it on `[]`, `null` and `[41,42]`, so the snippet's behaviour is checked against the actual text.
- `engine-verify.test.js:1355-1381`: the old manifest-rung test was turned around correctly to expect `[]`, and it keeps its check that the fixture really reaches the manifest rung. The new `unavailable` test checks the same way that its fixture reaches `unavailable`. Both acceptance-criteria cases (`issues: [41]` gives `[]` on manifest and `[41]` on unavailable) are pinned.
- The other `closingRecords` readers still read correctly with `null`: `review-console.md:26`, `auto-merge-short-circuit.md:9`, `SKILL.md:273`, `cleanup-procedures.md` item 4 and `two-call-gate.md`. Their "non-empty means a header exists" reading treats `null` as "no header", which is right for `unavailable`. The PR body names `two-call-gate.md` and `cleanup-procedures.md` item 4, as the Gotchas asked.
- I checked that the step-11 prose test's 2500-character slice reaches both pinned phrases (at about 1158 and 1197 characters), so the slice does not miss them.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **`plugin/bin/lib/wrap-up/engine-verify.js:463-468`: the config-rung exception departs from Deliverable 4, makes a second closing rule outside the pack, and does not match the new step-11 prose.**
   - **What's wrong:** Deliverable 4 says `resolvedIssueNumbers` "returns `closingRecords` whenever it is an array, empty included. It falls through to `verify-expectations.json` only when the value is `null`." The second commit adds `&& resolved.source !== 'config'`, so a consumer now decides a closing question by naming a rung. `pack.js`'s own comment says that decision is "Decided here once; consumers read the result."
   - **The mismatch:** on the config rung `closingRecords` is `[]`. Under the new `review-console.md` step 11 rule ("an empty array records no issues"), step 11 writes no `issues`, and `finish-console --approve-all` sources them "exactly as" that call. So the fallback this exception keeps reads a key the updated prose tells writers to leave out. It only does anything when some other writer has put `issues` there. The new test `engine-verify-config-rung-4108.test.js` writes `issues: [41]` by hand, which hides this.
   - **Why it matters:** the two readers of one field now disagree on what config-rung `[]` means. This is the same "one value, two meanings" problem the record set out to remove, just moved to a different rung. The next person to touch either reader cannot tell which reading is right.
   - **Possible fixes:**
     - Decide it in the pack. If config-rung runs have "no header decision, the PR body carries its own `Fixes`", have `closingRecords` return `null` for `config`. Every reader then falls back the same way, which matches pre-change behaviour, drops the rung name from `engine-verify.js`, and is safe for current-branch stamping because express runs are worktree-only (`flow/express-entry.md:12`).
     - Or drop the exception and accept the side effect the PR body already describes.
   - **Please confirm** whether this deviation from Deliverable 4 was intended. Also check the `pack.test.js` loop that still pins `config` to `[]` before choosing.

#### Minor (Nice to Have)
1. **PR #6173 body, Spec summary:** sentence two still says `resolvedIssueNumbers` "reads `verify-expectations.json` only when the value is `null`". The "Review fix" paragraph at the end contradicts it. Rewrite the first claim so the body describes the code that ships. The body also turned backticks into single quotes (`'pack.js''s 'closingRecords'`), which is hard to read.
2. **Commit subjects:**
   - `fc52e6fe4f` has empty parentheses: "Phase 1 record () — refs #4108".
   - `7584a149ef` repeats itself: "— refs — refs #4108".
   - Both use a `fix:` prefix, but CLAUDE.md wants feature-branch commits in the `{Verb} {what} — {detail}` style.
   - If the PR squash-merges, only the composed subject survives. Otherwise reword them.
3. **`tests/bin-lib/wrap-up/engine-verify-config-rung-4108.test.js`:** a whole new file holds one test that belongs with its siblings in `engine-verify.test.js`, next to the manifest/unavailable cases. It also builds its own `deps` object instead of using `makeTmpDir` and the file's shared helpers. Move it in, or delete it if Important #1 is fixed by having the pack return `null` on `config`.
4. **`tests/wrap-up-record-resolution-conformance.test.js` (new Section C test):** `/node -e '(const p=JSON\.parse[^']*closingRecords[^']*)'/.exec(block)[1]` throws a `TypeError` if the snippet ever changes shape. A plain assertion that the match is not null first would give a clearer failure.

### Recommendations
- Settle Important #1 in `pack.js`, so that `null` versus `[]` is decided in exactly one place for every rung, config included, and no consumer names a rung.
- After that, refresh the PR body so the summary and the "Review fix" paragraph agree.

Declined to judge:
- Whether a pure express run ever reaches `review-console.md` step 11 or `wrap-up-engine` verify. That depends on the express lane and merge-mode routing, outside this record. I judged Important #1 on its consistency and architecture, not on proven runtime impact.
- Whether the `unavailable` rung's Section C fallback to the worktree-mirror glob can ever find anything. The behaviour is unchanged and the record marks Section C as read-only.
- The acceptance criterion "revert each change and show which new test fails" and the `npm test` result. I was told not to run tests; the PR body claims both, and I did not verify those claims.
- The wording of the `review-console.md:26`, `auto-merge-short-circuit.md:9` and `SKILL.md:273` "non-empty" sentences. They read correctly with `null`, and the record did not ask for them to change.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The pack change, the two prose readers and their tests carry out the record's Decision correctly and keep the no-restatement rule. The second commit's config-rung exception in `engine-verify.js` departs from Deliverable 4, makes a second closing rule outside the pack, and conflicts with the new step-11 prose. It should be settled in `pack.js` or confirmed as intended before merge.

DONE_WITH_CONCERNS
