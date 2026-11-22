# Review — contested finding (cross-lens debate inconclusive)

**Region:** plugin/skills/_shared/pre-review-catchup.md:9-13
**Verdicts:** partial / agree → contested

## Positions

- **Finding A (lens 3a, low)** — plugin/skills/_shared/pre-review-catchup.md:13: The ## Outcomes table is a prose twin of the closed OUTCOMES vocabulary, but its pin is presence-only plus a length literal; an extra or renamed prose row would pass.
- **Finding B (lens 3e, medium)** — plugin/skills/_shared/pre-review-catchup.md:9: The procedure is stated twice, in _shared/pre-review-catchup.md and build/dispatch.md, violating stated-once-and-cited.

## Judge 1 (partial)

Both describe real defects; B is load-bearing and A overstates its failure mode. The row() lookups at tests/pre-review-catchup-conformance.test.js:187-195 catch a rename of six of the seven rows, and not-applicable is caught by includes; only an added row passes. A is downstream of B: tightening the pin on the shared table while dispatch.md stays the operative routing text pins the copy nobody executes.

## Judge 2 (agree)

Both stand and are orthogonal (pin strength vs duplication). A is correct by .claude/skills/prose-code-twin-pin: parse the table's first column and deepEqual against OUTCOMES, retiring the 7 literal; low is right. B is factually right; the consolidation is routes in the shared table, dispatch.md keeps the SDD wiring and cites it, and the ROUTING_FACTS span pin must relocate with the text.

## Decision-log reference

STAGED — Debate: lens "3a" cross-lens disagreement on plugin/skills/_shared/pre-review-catchup.md:13 inconclusive (partial, agree). Both verdicts staged.
