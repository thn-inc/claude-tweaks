# Open Items — Plan and review should enumerate failure branches of a fail-closed skill-prose guard (#3965)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: `tests/specify-review-fail-closed-guard-conformance.test.js`'s `assertRedTeamStep` does not pin the severity/routing sentence of the new red-team section ("A missing class is a `critical` finding (persona column `Fail-Closed Guard Check`) … write-back step 5"), so deleting that sentence still passes | fixed | Added the severity/routing assertion to `assertRedTeamStep` plus a go-red control that removes each half of the sentence — `42e5bca73` |
| 2 | build | SDD task review minor: the word-level AC2.1 test has no go-red control of its own | accepted | Redundant: the per-bullet go-red control (`AC2.1 go-red: removing any one input-class bullet …`) mutates the same content and runs the shared assertion; reviewer rated it redundant, not wrong |
| 3 | build | SDD task review minor: the section-removal go-red control is vacuous if the heading is ever absent (`replace('', '')` is a no-op) | accepted | Harmless: test 1 (`AC1.1: red-team.md carries …`) fails first in that case, so the absent-heading state is always caught; reviewer rated it harmless |
