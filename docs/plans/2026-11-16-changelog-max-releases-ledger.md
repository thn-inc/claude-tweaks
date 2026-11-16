# Open Items — Keep a bounded number of releases in CHANGELOG.md, set by a policy key (#5563)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | CRLF gap — [ \t] does not match \r, so a CRLF changelog loses its one-blank-line gap; folded into fix round 2 | fixed | Fixed in Task 2 fix round 2, commit 1fe4c7348; scoped re-review ADDRESSED |
| 2 | build | removing footer.newestRemoved !== null check survives every test (hand-edited footer with no Newest-removed line throws); folded into fix round 2 | fixed | Fixed in Task 2 fix round 2, commit 1fe4c7348; scoped re-review ADDRESSED |
| 3 | build | SDD ruling — T4 calls prepareTrim whenever the key read returns count > 0 OR a non-null error; with an error, prepareTrim p: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — per-task implementers run the fallback affected set (node --test on touched files plus their importers) instea: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — Task 3 checks the bound (would the trim remove anything) before the git ref/ancestry checks, departing from th: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — Task 4 default-branch fallback order becomes integration-branch policy → origin/HEAD → the checked-out branch : ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — Task 5 trims AFTER the release push succeeds (plan said before the push) and pushes the trim commit separately: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 8 | build | SDD ruling — the release-local restore-failed line keeps the exact `changelog trim: failed ({reason});` prefix and appends : ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 9 | build | SDD ruling — Task 8 gets no diff-based task review: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 10 | build | Follow-up record: a pr-first consumer project gets no CHANGELOG trim because only this repo's mirror-marketplace.yml runs bin/release-notes-publish.js — /claude-tweaks:init's release scaffolding (step-21-release.md) writes release-please.yml only; wiring a release:published step for consumers is out of #5563's Key Files (final whole-branch review, Important 1, doc half fixed in cf9f40c0e) | open | — |
| 11 | build/skill | gh-api-module-pattern / driver-skill-outcome-taxonomy extension: an engine that adds an optional post-release commit (trim) must run it only after the release has fully landed and push it through the same ancestry-checked path, dropping its own commit and restoring file and index on failure, so release recovery text never meets the extra commit [skill: enrichment of driver-skill-outcome-taxonomy] | observation | — |
