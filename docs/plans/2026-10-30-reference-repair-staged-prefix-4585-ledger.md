# Open Items — Review Console files every staged reference repair under Pending review (#4585)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: origin/main was 1 commit ahead of local main (#4466) | fixed | Post-creation catch-up merged origin/main into this branch before the materialize commit. |
| 2 | review | Security (medium) plugin/bin/lib/console/resolve.js:83 — every staged reference repair resolved approve by prefix alone, so at unattended a test-file, merge-sensitive or ambiguous repair applied with no click | fixed | 62fd849e6 — Held: header line in the staged file resolves pending; over-budget and over-cap denials still approve. |
