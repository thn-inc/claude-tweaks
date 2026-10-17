# Open Items — #3395 Multi-spec parent console and design-wrapper still read materialized headers from the main-checkout run dir

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | unmirroredHeaderReads passes a block that names the mirror but also reads another main-checkout path as sole source (no mixed-block control) | deferred | Origin: SDD Task 1 review (minor). Affects tests/wrap-up-record-resolution-conformance.test.js. Revisit if a scope file gains a block naming two header paths. |
| 2 | build | design-wrapper-handling.md:53 --surface source clause is a deeply nested parenthetical | deferred | Origin: SDD Task 1 review + whole-branch Minor 5 (minor). Affects plugin/skills/_shared/design-wrapper-handling.md:53. Revisit on the next edit to that bullet. |
| 3 | build | multispec-review-console.md:208 back-to-back parentheticals '(above) (materialize.md's field...)' | deferred | Origin: SDD Task 2 review (minor). Fixed in-branch by the final fix wave e18e42f14 (F3); trigger: none remaining. |
| 4 | build | AC3.1 moved-mutation does not assert the step-7 anchor replace matched | deferred | Origin: SDD Task 2 review (minor). Fixed in-branch by e18e42f14 (F4, notStrictEqual guard + matchers); trigger: none remaining. |
| 5 | build | assertCaptureBeforeTeardown does not pin the current-branch fallback / worktreeAtClose wording | deferred | Origin: SDD Task 2 review (minor). Affects tests/wrap-up-record-resolution-conformance.test.js. Revisit if the capture paragraph's fallback wording is edited. |
| 6 | build | Ruling: fold final-review Minors #1-#4 into one fix wave rather than deferring (in-scope, few lines, #1 a same-class reader the AC1 path regex cannot see) — cost if wrong: one extra fix commit + scoped re-review | observation | Fix wave e18e42f14; scoped re-review: all 4 addressed. |
| 7 | build | parked — design-wrapper-handling.md:53 nested parenthetical and mixed-block AC1 control — Ruling: cosmetic / token-pin limitation, below materiality floor | observation | Parked at SDD Finish. |
