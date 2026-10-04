# Open Items — Dream scan stages transcript command text without path redaction (#2968)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/ops | Pre-flight branch-divergence: local main was 6 commits ahead of origin/main (background `[reconcile] archive run` commits) and 2 behind (release 6.135.0 + changelog); the worktree branch carries the 6 reconcile commits as ride-along (baseRef: head) | observation | — |
| 2 | build | `plugin/skills/harness-health/dream-pass.md:35` credential-word list omits `PASSWD`, which `plugin/bin/lib/dream/scan.js:32` `SECRET_NAME` also matches — under-documents exact coverage (task review, Minor) | open | — |
| 3 | build | `plugin/bin/lib/dream/scan.js:39-41` quoted-value regexes stop at an escaped inner quote (`password="a\"b"`) — best-effort, disclaimed in dream-pass.md (task review, Minor) | open | — |
