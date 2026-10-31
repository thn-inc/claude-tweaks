# Open Items — 4595: Add an untrusted-text-into-command rule to skill authoring and review lens 3b

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review/code | medium Security: docs/skill-authoring.md:184 offers process.argv as a safe channel, but through a Bash command line it is the same interpolation | fixed | Rule, lens 3b bullet and journey now say an argv array element passed with no shell (73da28691) |
| 2 | review/code | low Convention: docs/skill-authoring.md:184 cites pre-squash shas not on the integration branch | fixed | Cites squash commit 9d59ce045; pin and journey updated (73da28691) |
| 3 | review/code | low Convention: docs/skill-authoring.md:184 says shell metacharacters; the Resume-line set is backtick, dollar, double quote, backslash, line breaks | fixed | Allowed set named, with why it suffices (73da28691) |
| 4 | review/code | low Test: tests/untrusted-text-into-command-conformance.test.js:7 header overclaims a go-red control for every pin | fixed | Header says every pin except the ordering check (73da28691) |
| 5 | review/code | low Convention: lens 3b bullet added without a recorded Model-version prompting notes check | fixed | Checklist run: a detection question for a missed class, keep; logged in decisions.md |
| 6 | review/code | refuted or dropped by tiebreak: session-tmp location unnamed (docs/skill-authoring.md:184), lens bullet restates the rule (step3-lens-dispatch.md:195), helper copies in the test (test.js:41) | accepted | Tiebreak verdicts in decisions.md |
