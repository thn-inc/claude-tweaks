# Open Items — Write gate misses a write behind a NAME=value, env or sudo prefix (#4448)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 branch-divergence: origin/main was 967 commits ahead of the resumed branch | observation | Caught up by the build's post-creation merge (a1be12fd1) before any task ran |
| 2 | build | SDD Task 1 controller ruling: fold the bash-version-split cd gap into fix round 2 (fixed 8cfef008a/fa14aeabf) (staged/sdd-ruling-1.md) | open | — |
| 3 | build/skill | shell-scanner-bash-differential enrichment: run the differential fuzz from both start dirs (main and wt, M/W swapped) plus an exhaustive short-chain supplement over the reserved/prefix words; #4448's wt-only alphabet fuzz held no bash 3.2/5-split row and missed the time-time-cd leak the final review caught | open | — |
