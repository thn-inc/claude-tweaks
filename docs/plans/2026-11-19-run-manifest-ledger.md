# Open Items — Write a run manifest.json when minting a run directory

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — ad-hoc hook-stamped run dirs carry no manifest.json (hook events must not read process.env): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | review | Low convention/architecture/test fixes (write.js:27/36 shared enums, set-config.js:92 loop reuse, set-config.js:235 stderr seam, mint-facts test for run-dir-resolve.js:338) | fixed | Applied in 8f04ed841 |
| 3 | review | Low architecture: adoptRun writes manifest.json outside its deps seam; driver/run.js:549 comment says nothing is written (plugin/bin/lib/driver/adopt.js:94) | deferred | Staged as staged/review-followup-1.md (Defer-reason: blocked-dependency — driver/*.js held by parallel session #5902) |
