# Open Items — Refuse aggregate reproduction STAGED lines in log-decision.js (#4581)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — plan Task 2 Step 4 and Task 1 Step 3 name `node --test tests/bin-lib/{dir}/` (bare directory), wh...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 1 minor (finding-path.js lacks use strict and the sibling module header) is fixed in Task 2, not deferred: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — review minor 3 (a lens-less, noun-less multi-location line such as `reproduction: Low-confidence ...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — review minor 4b (the non-reproduction accept test does not alone discriminate the marker gate) ne...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — replace fix (1)s lens-token change with a zero-quantifier exclusion (no/zero/0 before findings = ...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — Minor 3 is fixed by rejecting a quote-preceded marker, not by anchoring the marker after the step...: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build/skill | `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (extends): its exit-code sweep rule covers changing a code, but adding a new reason under an unchanged code goes stale the same way — #4581's plan grepped `exits 2` and missed `auto-decision-log.md`'s writer refusal list, which reads "exits `2`"; the rule's own `grep -i exit` recipe would have caught it | open | — |
| 8 | review | Coincidence-line grammar restated in the detector and in resolve.js lineKeys, already diverging (3a/3e, aggregate-reproduction.js:17) | fixed | One shared COINCIDENCE pattern in console/finding-path.js — 865978155 |
| 9 | review | resolve.js lineKeys gave no pointer to the writer's twin coincidence pattern (3g, resolve.js:496) | fixed | lineKeys now builds from the shared pattern its comment names — 865978155 |
| 10 | review | DEBATE_ENTRY_RE dropped a quoted multi-word lens, so a converged debate never settled that finding (3a, resolve.js:511) | fixed | Shared FINDING_LENS form plus a resolve.test.js case — 865978155 |
| 11 | review | PATH_RE scanned quadratically on a long dot-free token (3b/3d, aggregate-reproduction.js:18) | fixed | Left-boundary lookbehind; 200k-char token 158511 ms to 78 ms, with a timing test — 865978155 |
| 12 | review | Zero-word marker-subject arm had no test (3f, aggregate-reproduction.js:22) | fixed | Refuse test, red under a {1,4} mutant — 865978155 |
| 13 | review | `zero` quantifier and a bare `0 findings` had no test (3f, aggregate-reproduction.js:15) | fixed | Two accept tests — 865978155 |
| 14 | review | AUTO severity-contested and absence-claim-refuted shapes the spec AC names had no test (3f, aggregate-reproduction.js:29) | fixed | Two AUTO accept tests — 865978155 |
| 15 | review | Test name at cli.test.js:467 claimed to pin path neutralization (3f) | fixed | Renamed to what it pins — 865978155 |
| 16 | review | fixture() leaked its ldcli- temp roots (3f, cli.test.js:13) | fixed | Roots removed in after() — 865978155 |
| 17 | review | Fixture comment called condensed lines verbatim (3f, cli.test.js:391) | fixed | Comment says condensed — 865978155 |
| 18 | review | Word windows {0,3}/{0,4} had no stated reason (3g, aggregate-reproduction.js:20) | fixed | Archive-derived rationale and the re-runnable probe in the module header — 865978155 |
| 19 | review | Coincidence-before-PATH_RE order unexplained (3g, aggregate-reproduction.js:42) | fixed | Comment naming the pinning test — 865978155 |
| 20 | review | Aggregate refusal lives in log-decision.js, not appendEntries (3a, append.js:172, info) | accepted | Don't fix: no direct appendEntries caller composes a STAGED Reproduction: line, and repeatsStep sits at the same CLI layer |
