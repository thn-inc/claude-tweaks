# Open Items — pr-scan fixed limits truncate results here

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — acceptance-queue `--limit 200` sizing deferred to a follow-up record (file at rail; Defer-reason: genuinely-larger): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — triage item 2 unfenced count keeps prose-only cap coverage (code stands): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — final review: fixed Important 1 + Minors 2/3/5/6, deferred the consumer render-template WARNING slot (Defer-reason: tangential): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — item 10 NaN-on-missing-createdAt left unguarded (unreachable; code stands): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build/skill | skill-prose-conformance-tests `executable-snippet-pins.md` (enrichment): a `gh()` stub that serves the first N rows of a larger fixture universe, N read from `--limit N`/`--limit=N` in `"$*"`, models fetch truncation, so a frozen pre-change fence reproduces a silent cap and the live fence proves sizing; pair the frozen fence with an in-memory revert-equals-frozen drift check (`tests/github-pr-scan-fetch-limit.test.js`) | open | — |
