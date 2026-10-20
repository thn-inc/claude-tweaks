# Open Items — tidy Step 7.5: skip the scratch worktree when every approved Step 7 action is a forge-API write

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | flow Step 2.5 pre-flight branch-divergence-check: origin/main was 1 commit ahead of the inherited worktree branch at run start | observation | Resolved by build Common Step 1's post-creation catch-up (fast-forward 4cf12d1fd → 96ece857d); no divergence persists |
| 2 | build | step-7-5-worktree-always.md:11 "git metadata the gate does not intercept" is loose — the teardown gate does intercept `git worktree remove` (run-targeted, needs no worktree); name the `worktree-always` write gate instead | fixed | Fixed in review of #3339: names the `worktree-always` write gate instead of "git metadata the gate does not intercept" |
| 3 | build | Go-red control in tests/worktree-forge-api-carve-out.test.js mutates only the provisioning clause — a second mutation removing the carve-out citation would pin the citation assertion's ability to go red | fixed | Fixed in review of #3339: added a second go-red test mutating the carve-out citation |
| 4 | build | step-7-5-worktree-always.md:3-8 intro and tidy/SKILL.md:205 stub still say "Step 7 never mutates or commits without it" — now true only for worktree-always off, since an all-gh set mutates from the main checkout under worktree-always: true | fixed | Fixed in review of #3339: both parentheticals now read "no worktree is ever provisioned, and Step 7 runs from the checkout it is in" |
