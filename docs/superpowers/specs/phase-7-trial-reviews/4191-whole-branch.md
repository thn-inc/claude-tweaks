### Strengths
- The production change is one line at `plugin/bin/lib/reconcile/archive-merged.js:1138`. `RECORD_SLUG_RE` now accepts the `spec-` prefix, and the change stays inside `isClosedSlugStuck`'s existing guards, which this diff leaves alone. A dir with any `run-state.json` is still refused. `config.yml` is still required, the 7-day `STRUCTURALLY_STUCK_TTL_MS` still applies, and any unresolved, OPEN, or failed `gh` probe still fails closed. Widening the slug therefore does not loosen any of the safety checks. Deliverables 1 and 2 are met.
- The capture group is tighter now: `\d+(?:-\d+)*` replaces `[\d-]+`. That rejects slugs like `record--5` or a trailing `-` at the regex itself, instead of depending on the `.filter()` afterwards.
- The new test at `tests/bin-lib/reconcile/archive-merged-record-guards.test.js:1630` uses the `spec-11-12` fixture the record asks for. It checks both acceptance cases: all CLOSED gives true, and one OPEN gives false. It would fail on the old code, because the record-only regex returns `null` for a `spec-` slug and the first assertion then fails. That meets AC 3.
- Multi-spec parents normally keep `run-state.json` at the top level (`plugin/skills/flow/multi-spec.md:143`). So a parent dir with no top-level state, older than 7 days, with every record closed really is abandoned. Archiving it does not risk a live run.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. `plugin/bin/lib/reconcile/archive-merged.js:1162-1164`: the comment on `RUN_RECORD_SLUG_RE` is now false, and the code is duplicated. The comment says "Separate from RECORD_SLUG_RE on purpose: that regex stays record-only for isClosedSlugStuck". After this change the two regexes are byte-identical (`/-(?:record|spec)-(\d+(?:-\d+)*)$/`), and the reason given for keeping them apart is gone. The #3503 plan (commit 6db633c048) also said "Do not change `recordNumbersFromSlug` or `RECORD_SLUG_RE`. `isClosedSlugStuck` depends on their record-only shape". This diff reverses that decision on purpose but does not update the comment. A future maintainer will read the comment, believe `isClosedSlugStuck` is record-only, and could "fix" the regex back. Fix: delete `RUN_RECORD_SLUG_RE`, use `RECORD_SLUG_RE` in `runRecordSet`, and drop or rewrite the comment.
2. `plugin/bin/lib/reconcile/archive-merged.js:1127` and `:1140-1143`: the doc comments now contradict the code. Line 1127 still describes only `{timestamp}-record-{n}[-{m}...]`. The comment above `recordNumbersFromSlug` says it returns null for "a multi-spec `spec-{n}/` slug, etc. — none of those are this predicate's concern". It now returns numbers for a `spec-{n}-{m}` basename. `docs/reconcile-checks.md:412-416` also gives the slug as `{timestamp}-record-{n}[-{m}...]` only. Update all three to cover `spec-{n}[-{m}...]`, and note that the `spec-{N}/` subdirectories of a multi-spec parent are never iterated as run dirs.
3. `tests/bin-lib/reconcile/archive-merged-record-guards.test.js:1476`: the test title still says "null for a non-record slug (topic name, standalone, multi-spec parent)". After this change a multi-spec parent slug returns numbers, so the title is wrong. There is also no `recordNumbersFromSlug` assertion for a `spec-` slug, for example `recordNumbersFromSlug('/tmp/2026-08-17T125939-spec-783-784-781')` giving `[783, 784, 781]`. Fix the title and add that assertion to the parse test at line 1470.
4. AC 1 says the fixture "is archived by a reconcile pass", but the new test calls only the `isClosedSlugStuck` predicate. It never runs the sweep at `archive-merged.js:2515` or `archive()`. The existing `record-` tests have the same gap, and the sweep call site has no seam for injecting the issue-state resolver, so a sweep-level test would need one. As written, the AC is met for the predicate only, not for a full reconcile pass. Either thread an injectable `resolveIssueState` through the sweep options and add a sweep test, or record that the AC was judged at predicate level on purpose.

#### Minor (Nice to Have)
1. `tests/bin-lib/reconcile/archive-merged-record-guards.test.js:1630-1636`: the new test puts the positive and negative cases in one test, unlike its sibling `record-` tests, which use one case per test. If the first assertion fails, the second never runs. Splitting it would make failures easier to read.

### Recommendations
- Merge the two slug regexes into one constant, so the next change can't make them drift apart again.
- Name the real instances from #2724 (`2026-08-17T125939-spec-783-784-781`, `2026-08-30T105718-spec-1703-1704`) in the predicate's header comment, as the record-slug comment does with #1811's example.

**Declined to judge**
- Whether multi-spec parents ever legitimately run without a top-level `run-state.json` while live for more than 7 days. The docs say the parent holds it, and the TTL and all-CLOSED guards bound the risk anyway.
- Whether `isClosedSlugStuck` should consult `manifest.yml` (for example, skip a `failed` spec) the way `runRecordSet` does. The spec asks only for "every named record is CLOSED", and the implementation does exactly that.
- Whether the test suite passes. The review rules say not to run it.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The behavior change is correct, narrowly scoped and safe behind the existing fail-closed guards, and the new test checks both ACs and would fail on the old code. But the change leaves an "on purpose, stays record-only" comment that is now false, two identical regexes, stale doc comments, a stale test title and docs, and AC 1's "reconcile pass" is tested only at predicate level. These should be cleaned up before merge.

DONE_WITH_CONCERNS
