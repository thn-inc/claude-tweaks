# Open Items — claim-targets: a network blip while bootstrapping the claims branch exits 6 instead of the transient exit 4

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — residual rewrap items fixed via one targeted dispatch after the final fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | Follow-up (whole-branch review, declined to judge): a `permission-denied` claim read or write still exits 4 as "transient" in claim-targets.js (now labelled `permission-denied`); spec Deliverable 1 kept every caller's exit unchanged, so routing it to a refusal is out of this record's scope | open | — |
| 3 | build/skill | `gh-api-module-pattern` (`batching-failure-posture.md`'s rate-limit bullet) needs extending (not edited in this run; wrap-up's Skills curation row owns it): `claim-store.js`'s `classifyGhApiError` now returns its own `permission-denied` outcome for a plain 401/403 (primary rate limit stays `network-failure`), and a bootstrap leg classifies transient vs refusal by one failure-kind set (`TRANSIENT_BOOTSTRAP_FAILURES`) rather than per-status lists | observation | — |
