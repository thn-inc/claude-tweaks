# Open Items — Add a lib-module-split project skill — pure-move proof and stale-location sweep

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD re-review out-of-scope note: `.claude/skills/lib-module-split/SKILL.md` has table rows and long-path bullets over 100 columns, and the check-3 bullet's heading says "green test suite" while its body says "checks 1 and 2 stay green" (the tests claim lives at SKILL.md:12) | observation | Informational. Table and path lines over 100 columns match sibling project skills. The heading/body wording is accurate taken together. Neither is a defect. |
| 2 | review/code | lib-module-split SKILL.md: pure-move.js check 2 hangs on a trailing semicolon-less declaration; #2805 fan-in stated as 75 (was 69 at 69bb514df^); "at HEAD one hit" claim self-invalidates; shape-3 grep noise unstated | fixed | Fixed in 1cdc0a038 (loop bounded + Limits note, 69 with 75-today note in skill and journey, self-match note, noise note); full suite re-verified at 1cdc0a038. |
